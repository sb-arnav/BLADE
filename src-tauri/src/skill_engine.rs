/// SKILL ENGINE — Blade's self-improving reflex layer.
///
/// Blade watches its own tool loops. When it solves the same TYPE of problem
/// 3+ times with consistent tool patterns, it extracts a reusable "skill":
/// a named trigger + a prompt modifier that makes it better at that task forever.
///
/// This is evolutionary adaptation — Blade gets better at *your* workflows
/// without you having to explicitly teach it anything.
///
/// Flow:
///   successful tool loop → record_tool_pattern()
///   count hits 3 → maybe_synthesize_skill() → brain_skills table
///   next conversation → get_skill_injections() → injected into system prompt
///
/// Inspired by: Hermes GEPA, DSPy prompt optimization, Letta skills

use crate::db::{skill_candidate_delete, skill_candidate_record, skill_candidates_ripe};
use crate::providers::ConversationMessage;
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use tauri::Emitter;

const SKILL_SYNTHESIS_THRESHOLD: i64 = 3;
const MAX_ACTIVE_SKILLS: usize = 10;

/// Record a successful tool loop as a skill candidate.
/// Call this after every conversation where tools were used successfully.
///
/// `tool_names`: the sequence of tool names actually called
/// `user_query`: the user's original message
/// `result_summary`: brief summary of what was accomplished
pub fn record_tool_pattern(user_query: &str, tool_names: &[String], result_summary: &str) {
    if tool_names.is_empty() || user_query.len() < 10 {
        return;
    }

    // Hash the normalized query type to detect similar requests
    // Normalization: lowercase, strip punctuation, first 60 chars
    let normalized = normalize_query(user_query);
    let mut hasher = DefaultHasher::new();
    normalized.hash(&mut hasher);
    let query_hash = format!("{:x}", hasher.finish());

    let tool_sequence = serde_json::to_string(tool_names).unwrap_or_default();
    let summary = crate::safe_slice(&result_summary, 200);

    let db_path = crate::config::blade_config_dir().join("blade.db");
    if let Ok(conn) = rusqlite::Connection::open(&db_path) {
        let _ = skill_candidate_record(&conn, &query_hash, user_query, &tool_sequence, summary);
    }
}

/// Check if any candidates have hit the synthesis threshold.
/// If yes, synthesize them into brain_skills via LLM and delete the raw candidates.
/// Call this in the background after each conversation.
pub async fn maybe_synthesize_skills(app: tauri::AppHandle) {
    let config = crate::config::load_config();
    if config.api_key.is_empty() && config.provider != "ollama" {
        return;
    }

    let db_path = crate::config::blade_config_dir().join("blade.db");
    let candidates = {
        let conn = match rusqlite::Connection::open(&db_path) {
            Ok(c) => c,
            Err(_) => return,
        };
        match skill_candidates_ripe(&conn, SKILL_SYNTHESIS_THRESHOLD) {
            Ok(c) => c,
            Err(_) => return,
        }
    };

    for candidate in candidates {
        match synthesize_skill(&config, &candidate).await {
            Ok(skill) => {
                // Write synthesized skill to brain_skills table
                let conn = match rusqlite::Connection::open(&db_path) {
                    Ok(c) => c,
                    Err(_) => continue,
                };
                let now = chrono::Utc::now().timestamp_millis();
                let skill_id = format!("skill-{}", &candidate.query_hash[..8]);
                let _ = conn.execute(
                    "INSERT OR REPLACE INTO brain_skills(id, name, trigger_pattern, prompt_modifier, tools_json, usage_count, active, created_at)
                     VALUES(?1, ?2, ?3, ?4, ?5, 0, 1, ?6)",
                    rusqlite::params![
                        skill_id,
                        skill.name,
                        skill.trigger_pattern,
                        skill.prompt_modifier,
                        candidate.tool_sequence,
                        now
                    ],
                );
                // Delete the raw candidate — it's been promoted
                let _ = skill_candidate_delete(&conn, candidate.id);

                let _ = app.emit("skill_learned", serde_json::json!({
                    "name": skill.name,
                    "trigger_pattern": skill.trigger_pattern,
                }));
            }
            Err(e) => {
                eprintln!("[skill_engine] synthesis failed: {}", e);
            }
        }
    }
}

/// Get prompt modifier injections for active skills matching the current query.
/// Called synchronously from build_system_prompt_with_recall.
pub fn get_skill_injections(user_query: &str) -> String {
    if user_query.len() < 5 {
        return String::new();
    }

    let db_path = crate::config::blade_config_dir().join("blade.db");
    let conn = match rusqlite::Connection::open(&db_path) {
        Ok(c) => c,
        Err(_) => return String::new(),
    };

    // Load active skills (max MAX_ACTIVE_SKILLS)
    let mut stmt = match conn.prepare(
        "SELECT name, trigger_pattern, prompt_modifier FROM brain_skills WHERE active=1 ORDER BY usage_count DESC LIMIT ?1"
    ) {
        Ok(s) => s,
        Err(_) => return String::new(),
    };

    let skills: Vec<(String, String, String)> = stmt
        .query_map(rusqlite::params![MAX_ACTIVE_SKILLS as i64], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?))
        })
        .ok()
        .map(|rows| rows.filter_map(|r| r.ok()).collect())
        .unwrap_or_default();

    if skills.is_empty() {
        return String::new();
    }

    let query_words: Vec<&str> = user_query.split_whitespace().collect();

    let matched: Vec<String> = skills
        .into_iter()
        .filter(|(_, trigger, _)| {
            // Simple keyword overlap: if >30% of trigger words appear in query
            let trigger_words: Vec<&str> = trigger.split_whitespace().collect();
            if trigger_words.is_empty() {
                return false;
            }
            let matches = trigger_words
                .iter()
                .filter(|tw| {
                    query_words
                        .iter()
                        .any(|qw| qw.to_lowercase().contains(&tw.to_lowercase()))
                })
                .count();
            matches as f32 / trigger_words.len() as f32 > 0.3
        })
        .map(|(name, _, modifier)| format!("**{}**: {}", name, modifier))
        .collect();

    if matched.is_empty() {
        return String::new();
    }

    // Increment usage_count for matched skills (best-effort, no await)
    // We skip this for now to keep it synchronous

    matched.join("\n")
}

// ── Private helpers ─────────────────────────────────────────────────────────

struct SynthesizedSkill {
    name: String,
    trigger_pattern: String,
    prompt_modifier: String,
}

async fn synthesize_skill(
    config: &crate::config::BladeConfig,
    candidate: &crate::db::SkillCandidateRow,
) -> Result<SynthesizedSkill, String> {
    let tool_names: Vec<String> = serde_json::from_str(&candidate.tool_sequence)
        .unwrap_or_default();

    let prompt = format!(
        r#"You are analyzing Blade's (AI assistant) tool usage patterns to extract reusable skills.

This task type was handled successfully {} times:
- Example user request: "{}"
- Tools used in sequence: {}
- What was accomplished: "{}"

Extract a reusable skill from this pattern.

Respond ONLY with valid JSON (no markdown):
{{
  "name": "short skill name (3-5 words, e.g. 'Debug Rust Build Errors')",
  "trigger_pattern": "when to apply this skill (natural language, 10-20 words)",
  "prompt_modifier": "behavioral instruction to inject (20-40 words, guides Blade's approach)"
}}"#,
        candidate.count,
        crate::safe_slice(&candidate.query_example, 200),
        tool_names.join(" → "),
        crate::safe_slice(&candidate.result_summary, 200),
    );

    let messages = vec![ConversationMessage::User(prompt)];
    let model = cheapest_model(&config.provider, &config.model);

    let turn = crate::providers::complete_turn(
        &config.provider,
        &config.api_key,
        &model,
        &messages,
        &[],
        config.base_url.as_deref(),
    )
    .await?;

    let raw = turn.content.trim();
    let v: serde_json::Value =
        serde_json::from_str(raw).map_err(|e| format!("JSON parse error: {} — raw: {}", e, raw))?;

    Ok(SynthesizedSkill {
        name: v["name"].as_str().unwrap_or("Unnamed Skill").to_string(),
        trigger_pattern: v["trigger_pattern"].as_str().unwrap_or("").to_string(),
        prompt_modifier: v["prompt_modifier"].as_str().unwrap_or("").to_string(),
    })
}

fn normalize_query(query: &str) -> String {
    // Strip punctuation, lowercase, take first 60 chars
    // Groups similar queries: "fix the bug" ≈ "fix bug" ≈ "fix this bug"
    let clean: String = query
        .chars()
        .filter(|c| c.is_alphanumeric() || c.is_whitespace())
        .collect::<String>()
        .split_whitespace()
        .filter(|w| !STOP_WORDS.contains(w))
        .take(8)
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase();
    clean
}

fn cheapest_model(provider: &str, current: &str) -> String {
    crate::config::cheap_model_for_provider(provider, current)
}

/// Common English stop words to strip before hashing query type
const STOP_WORDS: &[&str] = &[
    "a", "an", "the", "is", "it", "in", "on", "at", "to", "for", "of", "and",
    "or", "but", "this", "that", "my", "i", "me", "can", "you", "please",
    "help", "how", "what", "why", "when", "where", "do", "does", "with",
];
