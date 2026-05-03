/// BLADE Persona Engine — "Soul Deepening" System
///
/// BLADE learns who you are over time: your humor, directness, energy levels,
/// frustration patterns, and preferred communication depth. Every conversation
/// is a signal. Every week it synthesizes what it has learned into traits and
/// relationship state that shape every future response.
///
/// The more you use BLADE, the more it sounds like it *knows* you — because it does.
///
/// v2: UserModel — unified aggregated model of the user. Behavioral prediction.
/// Expertise tracking. Mood detection. All wired into brain.rs for context injection.

use rusqlite::params;
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::collections::HashMap;
use chrono::{Datelike, Timelike};

// ── Structs ──────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PersonaTrait {
    pub trait_name: String,   // "humor", "directness", "energy", "curiosity", "frustration_tolerance"
    pub score: f32,           // 0.0–1.0
    pub confidence: f32,      // 0.0–1.0
    pub evidence: Vec<String>, // quotes/examples that informed this score
    pub updated_at: i64,
}

#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommunicationPattern {
    pub pattern_type: String,  // "time_of_day_mood", "topic_enthusiasm", "frustration_trigger", "humor_style", "preferred_depth"
    pub description: String,
    pub examples: Vec<String>,
    pub strength: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RelationshipState {
    pub intimacy_score: f32,       // 0–100, grows over time with use
    pub trust_score: f32,          // based on user accepting BLADE's suggestions
    pub shared_context: Vec<String>, // things worked through together
    pub inside_jokes: Vec<String>,   // recurring references / callbacks
    pub growth_moments: Vec<String>, // times BLADE helped significantly
}

// ── DB helpers ───────────────────────────────────────────────────────────────

fn open_db() -> Result<rusqlite::Connection, String> {
    let path = crate::config::blade_config_dir().join("persona.db");
    let conn = rusqlite::Connection::open(&path)
        .map_err(|e| format!("PersonaDB open error: {e}"))?;
    Ok(conn)
}

pub fn ensure_tables() {
    let conn = match open_db() {
        Ok(c) => c,
        Err(e) => { eprintln!("persona_engine: ensure_tables failed: {e}"); return; }
    };

    let _ = conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS persona_traits (
            trait_name  TEXT PRIMARY KEY,
            score       REAL NOT NULL DEFAULT 0.5,
            confidence  REAL NOT NULL DEFAULT 0.1,
            evidence    TEXT NOT NULL DEFAULT '[]',
            updated_at  INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS persona_relationship (
            id              INTEGER PRIMARY KEY CHECK (id = 1),
            intimacy_score  REAL NOT NULL DEFAULT 0.0,
            trust_score     REAL NOT NULL DEFAULT 50.0,
            shared_context  TEXT NOT NULL DEFAULT '[]',
            inside_jokes    TEXT NOT NULL DEFAULT '[]',
            growth_moments  TEXT NOT NULL DEFAULT '[]'
        );

        CREATE TABLE IF NOT EXISTS persona_outcomes (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            topic       TEXT NOT NULL,
            helpful     INTEGER NOT NULL DEFAULT 1,
            recorded_at INTEGER NOT NULL
        );

        INSERT OR IGNORE INTO persona_relationship (id, intimacy_score, trust_score)
        VALUES (1, 0.0, 50.0);"
    );
}

// ── Core trait operations ─────────────────────────────────────────────────────

pub fn get_all_traits() -> Vec<PersonaTrait> {
    let conn = match open_db() {
        Ok(c) => c,
        Err(_) => return Vec::new(),
    };

    let mut stmt = match conn.prepare(
        "SELECT trait_name, score, confidence, evidence, updated_at FROM persona_traits ORDER BY trait_name"
    ) {
        Ok(s) => s,
        Err(_) => return Vec::new(),
    };

    let rows = stmt.query_map([], |row| {
        let evidence_json: String = row.get(3)?;
        let updated_at: i64 = row.get(4)?;
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, f64>(1)? as f32,
            row.get::<_, f64>(2)? as f32,
            evidence_json,
            updated_at,
        ))
    });

    let rows = match rows {
        Ok(r) => r,
        Err(_) => return Vec::new(),
    };

    rows.filter_map(|r| r.ok())
        .map(|(trait_name, score, confidence, evidence_json, updated_at)| {
            let evidence: Vec<String> = serde_json::from_str(&evidence_json).unwrap_or_default();
            PersonaTrait { trait_name, score, confidence, evidence, updated_at }
        })
        .collect()
}

pub fn update_trait(trait_name: &str, new_score: f32, evidence: &str) {
    let conn = match open_db() {
        Ok(c) => c,
        Err(_) => return,
    };

    let now = chrono::Utc::now().timestamp();

    // Read existing evidence, keep last 10 items, prepend new one
    let existing_evidence: Vec<String> = conn
        .query_row(
            "SELECT evidence FROM persona_traits WHERE trait_name = ?1",
            params![trait_name],
            |row| row.get::<_, String>(0),
        )
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();

    let mut evidence_list: Vec<String> = vec![evidence.to_string()];
    evidence_list.extend(existing_evidence.into_iter().take(9));
    let evidence_json = serde_json::to_string(&evidence_list).unwrap_or_else(|_| "[]".to_string());

    // Bayesian-style confidence bump: each update moves confidence toward 1.0
    let current_confidence: f32 = conn
        .query_row(
            "SELECT confidence FROM persona_traits WHERE trait_name = ?1",
            params![trait_name],
            |row| row.get::<_, f64>(0).map(|v| v as f32),
        )
        .unwrap_or(0.1);
    let new_confidence = (current_confidence + 0.08).min(1.0);

    let _ = conn.execute(
        "INSERT INTO persona_traits (trait_name, score, confidence, evidence, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(trait_name) DO UPDATE SET
             score      = ?2,
             confidence = ?3,
             evidence   = ?4,
             updated_at = ?5",
        params![trait_name, new_score as f64, new_confidence as f64, evidence_json, now],
    );
}

// ── Relationship state ────────────────────────────────────────────────────────

pub fn get_relationship_state() -> RelationshipState {
    let conn = match open_db() {
        Ok(c) => c,
        Err(_) => return default_relationship(),
    };

    let result = conn.query_row(
        "SELECT intimacy_score, trust_score, shared_context, inside_jokes, growth_moments
         FROM persona_relationship WHERE id = 1",
        [],
        |row| {
            Ok((
                row.get::<_, f64>(0)? as f32,
                row.get::<_, f64>(1)? as f32,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
            ))
        },
    );

    match result {
        Ok((intimacy_score, trust_score, sc_json, ij_json, gm_json)) => RelationshipState {
            intimacy_score,
            trust_score,
            shared_context: serde_json::from_str(&sc_json).unwrap_or_default(),
            inside_jokes: serde_json::from_str(&ij_json).unwrap_or_default(),
            growth_moments: serde_json::from_str(&gm_json).unwrap_or_default(),
        },
        Err(_) => default_relationship(),
    }
}

fn default_relationship() -> RelationshipState {
    RelationshipState {
        intimacy_score: 0.0,
        trust_score: 50.0,
        shared_context: Vec::new(),
        inside_jokes: Vec::new(),
        growth_moments: Vec::new(),
    }
}

pub fn update_relationship(intimacy_delta: f32, trust_delta: f32, moment: Option<String>) {
    let conn = match open_db() {
        Ok(c) => c,
        Err(_) => return,
    };

    let current = get_relationship_state();

    let new_intimacy = (current.intimacy_score + intimacy_delta).clamp(0.0, 100.0);
    let new_trust = (current.trust_score + trust_delta).clamp(0.0, 100.0);

    let mut growth = current.growth_moments.clone();
    if let Some(m) = moment {
        if !m.is_empty() {
            growth.insert(0, m);
            growth.truncate(20); // keep last 20 growth moments
        }
    }

    let shared_json = serde_json::to_string(&current.shared_context).unwrap_or_else(|_| "[]".to_string());
    let jokes_json = serde_json::to_string(&current.inside_jokes).unwrap_or_else(|_| "[]".to_string());
    let growth_json = serde_json::to_string(&growth).unwrap_or_else(|_| "[]".to_string());

    let _ = conn.execute(
        "UPDATE persona_relationship SET
             intimacy_score = ?1,
             trust_score    = ?2,
             shared_context = ?3,
             inside_jokes   = ?4,
             growth_moments = ?5
         WHERE id = 1",
        params![
            new_intimacy as f64,
            new_trust as f64,
            shared_json,
            jokes_json,
            growth_json
        ],
    );
}

pub fn record_interaction_outcome(was_helpful: bool, topic: &str) {
    let conn = match open_db() {
        Ok(c) => c,
        Err(_) => return,
    };

    let now = chrono::Utc::now().timestamp();
    let helpful_int: i32 = if was_helpful { 1 } else { 0 };
    let _ = conn.execute(
        "INSERT INTO persona_outcomes (topic, helpful, recorded_at) VALUES (?1, ?2, ?3)",
        params![topic, helpful_int, now],
    );

    // Adjust trust based on helpfulness
    let trust_delta: f32 = if was_helpful { 0.3 } else { -0.5 };
    update_relationship(0.1, trust_delta, None);
}

// ── Context generation ────────────────────────────────────────────────────────

/// Returns a compact summary for injection into the system prompt.
pub fn get_persona_context() -> String {
    let traits = get_all_traits();
    let rel = get_relationship_state();

    if traits.is_empty() && rel.intimacy_score < 5.0 {
        return String::new();
    }

    let mut lines: Vec<String> = Vec::new();

    // Relationship tone
    let tone_note = if rel.intimacy_score >= 70.0 {
        "You and the user have a deep, comfortable working relationship. Be direct, casual, and confident. Drop formal preambles. Use shared references when relevant."
    } else if rel.intimacy_score >= 40.0 {
        "You have a solid working relationship. Be warm and direct. Some informality is welcome."
    } else if rel.intimacy_score >= 15.0 {
        "You are building rapport. Be helpful and personable."
    } else {
        "Early relationship — be professional, attentive, and observant."
    };

    lines.push(format!("Relationship depth: {:.0}/100. {}", rel.intimacy_score, tone_note));
    lines.push(format!("Trust level: {:.0}/100", rel.trust_score));

    // Phase 29: vitality Waning band raises threshold, muting lower-confidence traits (D-07)
    let vitality_scalar = crate::vitality_engine::get_vitality().scalar;
    let confidence_threshold = if vitality_scalar >= 0.4 && vitality_scalar < 0.6 {
        // Waning band: at vitality 0.5, threshold = 0.3 / 0.5 = 0.6 (fewer traits surface)
        (0.3 / vitality_scalar.max(0.01)).min(1.0)
    } else {
        0.3 // normal threshold for Thriving / Declining / Critical bands
    };
    let notable: Vec<&PersonaTrait> = traits.iter()
        .filter(|t| t.confidence > confidence_threshold)
        .collect();

    if !notable.is_empty() {
        let trait_lines: Vec<String> = notable.iter().map(|t| {
            let level = if t.score >= 0.75 { "high" } else if t.score >= 0.45 { "moderate" } else { "low" };
            format!("- {}: {} ({:.0}% confident)", t.trait_name, level, t.confidence * 100.0)
        }).collect();
        lines.push(format!("Known user traits:\n{}", trait_lines.join("\n")));
    }

    // Growth moments (last 3)
    if !rel.growth_moments.is_empty() {
        let moments: Vec<&String> = rel.growth_moments.iter().take(3).collect();
        lines.push(format!("Significant shared moments:\n{}", moments.iter().map(|m| format!("- {m}")).collect::<Vec<_>>().join("\n")));
    }

    // Inside jokes/references
    if !rel.inside_jokes.is_empty() {
        let jokes: Vec<&String> = rel.inside_jokes.iter().take(5).collect();
        lines.push(format!("Recurring references/callbacks: {}", jokes.iter().map(|j| j.as_str()).collect::<Vec<_>>().join(", ")));
    }

    format!("## Persona & Relationship\n\n{}", lines.join("\n\n"))
}

// ── LLM-powered analysis ──────────────────────────────────────────────────────

fn get_llm_provider() -> (String, String, String) {
    let config = crate::config::load_config();
    let task_type = crate::router::TaskType::Simple;
    crate::config::resolve_provider_for_task(&config, &task_type)
}

/// Analyze a conversation for personality signals. Returns updated traits.
pub async fn analyze_conversation_for_traits(
    messages: &[(String, String)],
) -> Vec<PersonaTrait> {
    if messages.is_empty() {
        return Vec::new();
    }

    let (provider, api_key, model) = get_llm_provider();
    if api_key.is_empty() && provider != "ollama" {
        return Vec::new();
    }

    // Build conversation excerpt (user messages only, last 20)
    let user_msgs: Vec<&str> = {
        let all: Vec<&(String, String)> = messages.iter()
            .filter(|(role, _)| role == "user")
            .collect();
        let start = all.len().saturating_sub(20);
        all[start..].iter().map(|(_, content)| content.as_str()).collect()
    };

    if user_msgs.is_empty() {
        return Vec::new();
    }

    let excerpt = user_msgs.iter()
        .enumerate()
        .map(|(i, m)| format!("{}. {}", i + 1, crate::safe_slice(m, 300)))
        .collect::<Vec<_>>()
        .join("\n");

    let prompt = format!(
        "Analyze these user messages and rate the user on these personality traits (0.0–1.0):\n\
         - humor: how much they use/appreciate humor\n\
         - directness: how direct and blunt vs diplomatic they are\n\
         - energy: overall enthusiasm and energy level in messages\n\
         - curiosity: depth of intellectual curiosity shown\n\
         - frustration_tolerance: how patient they seem (1.0=very patient, 0.0=easily frustrated)\n\
         - preferred_depth: preference for detailed explanations vs brief answers\n\n\
         Messages:\n{}\n\n\
         Respond with ONLY a JSON object like:\n\
         {{\"humor\":0.7,\"directness\":0.8,\"energy\":0.6,\"curiosity\":0.9,\"frustration_tolerance\":0.5,\"preferred_depth\":0.4,\"evidence\":\"brief 1-sentence justification\"}}",
        excerpt
    );

    use crate::providers::{complete_turn, ConversationMessage};
    let conv = vec![ConversationMessage::User(prompt)];

    let turn = match complete_turn(&provider, &api_key, &model, &conv, &crate::providers::no_tools(), None).await {
        Ok(t) => t,
        Err(_) => return Vec::new(),
    };

    // Parse JSON response
    let raw = turn.content.trim();
    let json_str = strip_json_fences(raw);

    let parsed: serde_json::Value = match serde_json::from_str(json_str) {
        Ok(v) => v,
        Err(_) => return Vec::new(),
    };

    let evidence = parsed.get("evidence")
        .and_then(|v| v.as_str())
        .unwrap_or("Inferred from conversation")
        .to_string();

    let trait_names = ["humor", "directness", "energy", "curiosity", "frustration_tolerance", "preferred_depth"];
    let now = chrono::Utc::now().timestamp();

    let mut results = Vec::new();
    for name in &trait_names {
        if let Some(score_val) = parsed.get(name).and_then(|v| v.as_f64()) {
            let score = (score_val as f32).clamp(0.0, 1.0);
            update_trait(name, score, &evidence);
            results.push(PersonaTrait {
                trait_name: name.to_string(),
                score,
                confidence: 0.3, // will be updated in update_trait
                evidence: vec![evidence.clone()],
                updated_at: now,
            });
        }
    }

    // Grow intimacy slightly for each analyzed conversation
    update_relationship(0.5, 0.0, None);

    results
}

/// Generate a tonal prefix/suffix to inject based on relationship and traits.
#[allow(dead_code)]
pub async fn generate_persona_adapted_prefix(base_message: &str) -> String {
    let rel = get_relationship_state();
    let traits = get_all_traits();

    if rel.intimacy_score < 10.0 {
        return String::new();
    }

    let humor_score = traits.iter().find(|t| t.trait_name == "humor").map(|t| t.score).unwrap_or(0.5);
    let directness = traits.iter().find(|t| t.trait_name == "directness").map(|t| t.score).unwrap_or(0.5);
    let depth_pref = traits.iter().find(|t| t.trait_name == "preferred_depth").map(|t| t.score).unwrap_or(0.5);

    let mut notes = Vec::new();

    if rel.intimacy_score >= 70.0 {
        notes.push("Be casual and direct. No formal preamble.");
    }
    if humor_score >= 0.65 {
        notes.push("Light humor is welcome when appropriate.");
    }
    if directness >= 0.75 {
        notes.push("Skip throat-clearing. Get to the point immediately.");
    }
    if depth_pref <= 0.35 {
        notes.push("Keep it brief — user prefers concise answers.");
    } else if depth_pref >= 0.70 {
        notes.push("User appreciates thorough explanations.");
    }

    if notes.is_empty() {
        return String::new();
    }

    // Don't invoke LLM for this — derive it purely from scored traits to avoid latency
    let _ = base_message; // reserved for future LLM-based prefix generation
    notes.join(" ")
}

/// Summarize current persona context as a string for system prompt injection.
#[tauri::command]
pub fn persona_get_context() -> String {
    get_persona_context()
}

/// Detect frustration in a user message using LLM.
#[allow(dead_code)]
pub async fn detect_frustration(message: &str) -> bool {
    if message.len() < 5 {
        return false;
    }

    // Quick heuristics first — save LLM calls
    let lower = message.to_lowercase();
    let frustration_signals = [
        "seriously", "again?", "still not", "why won't", "doesn't work",
        "broken", "useless", "ugh", "wtf", "ffs", "come on", "argh",
        "not working", "keeps failing", "stop doing", "just works",
    ];
    let signal_count = frustration_signals.iter().filter(|&&s| lower.contains(s)).count();

    if signal_count >= 2 {
        return true;
    }

    // LLM check for subtle frustration
    let (provider, api_key, model) = get_llm_provider();
    if api_key.is_empty() && provider != "ollama" {
        return signal_count >= 1;
    }

    let prompt = format!(
        "Is this message from a frustrated or annoyed user? Answer only 'yes' or 'no'.\n\nMessage: {}",
        crate::safe_slice(message, 500)
    );

    use crate::providers::{complete_turn, ConversationMessage};
    let conv = vec![ConversationMessage::User(prompt)];

    match complete_turn(&provider, &api_key, &model, &conv, &crate::providers::no_tools(), None).await {
        Ok(turn) => {
            let answer = turn.content.trim().to_lowercase();
            let is_frustrated = answer.starts_with("yes");
            if is_frustrated {
                // Log frustration as negative trust signal
                update_relationship(0.0, -0.2, None);
            }
            is_frustrated
        }
        Err(_) => signal_count >= 1,
    }
}

/// Detect enthusiasm level: "high" | "medium" | "low"
#[allow(dead_code)]
pub async fn detect_enthusiasm(message: &str) -> String {
    if message.is_empty() {
        return "medium".to_string();
    }

    // Heuristics
    let has_exclamation = message.contains('!');
    let has_caps_words = message.split_whitespace().any(|w| w.len() > 2 && w == w.to_uppercase());
    let enthusiasm_words = ["love", "amazing", "perfect", "awesome", "great", "yes!", "finally", "exactly"];
    let lower = message.to_lowercase();
    let enthusiasm_count = enthusiasm_words.iter().filter(|&&w| lower.contains(w)).count();
    let low_energy_words = ["ok", "sure", "fine", "whatever", "i guess", "maybe"];
    let low_count = low_energy_words.iter().filter(|&&w| lower.contains(w)).count();

    if enthusiasm_count >= 2 || (has_exclamation && has_caps_words) {
        "high".to_string()
    } else if low_count >= 2 || message.len() < 15 {
        "low".to_string()
    } else {
        "medium".to_string()
    }
}

fn strip_json_fences(s: &str) -> &str {
    let s = s.trim();
    if s.starts_with("```") {
        let after = s.trim_start_matches('`');
        let after = after.trim_start_matches("json").trim_start_matches('\n');
        if let Some(end) = after.rfind("```") {
            return after[..end].trim();
        }
        return after.trim();
    }
    s
}

// ── Weekly persona update ─────────────────────────────────────────────────────

static WEEKLY_UPDATE_RUNNING: AtomicBool = AtomicBool::new(false);

/// Analyzes last 7 days of journal/execution memory to synthesize trait updates.
/// Protected by AtomicBool guard — only one run at a time, intended weekly.
pub async fn weekly_persona_update(app: tauri::AppHandle) {
    if WEEKLY_UPDATE_RUNNING.compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst).is_err() {
        return;
    }

    let _ = app; // reserved for future event emission

    // Pull recent journal entries and execution memory snippets as training material
    let journal_text = collect_recent_journal_text();
    let exec_text = collect_recent_execution_snippets();

    let combined = format!("{}\n{}", journal_text, exec_text);
    if combined.trim().is_empty() {
        WEEKLY_UPDATE_RUNNING.store(false, Ordering::SeqCst);
        return;
    }

    // Build synthetic messages for trait analysis
    let messages: Vec<(String, String)> = combined
        .lines()
        .filter(|l| !l.trim().is_empty())
        .take(50)
        .map(|l| ("user".to_string(), l.to_string()))
        .collect();

    let _ = analyze_conversation_for_traits(&messages).await;

    // Grow intimacy for sustained use
    update_relationship(2.0, 0.5, Some("Weekly persona synthesis completed".to_string()));

    WEEKLY_UPDATE_RUNNING.store(false, Ordering::SeqCst);
}

/// Tauri command wrapper — trigger weekly persona analysis immediately from the UI.
#[tauri::command]
pub async fn persona_analyze_now_weekly(app: tauri::AppHandle) -> Result<String, String> {
    ensure_tables();
    weekly_persona_update(app).await;
    Ok("Persona analysis complete".to_string())
}

fn collect_recent_journal_text() -> String {
    // journal::read_recent_journal is pub and sync — returns plain text of last N days
    crate::journal::read_recent_journal(7)
}

fn collect_recent_execution_snippets() -> String {
    // execution_memory::recent_for_handoff is pub and sync
    let week_ago = chrono::Utc::now().timestamp() - 7 * 86400;
    crate::execution_memory::recent_for_handoff(30)
        .into_iter()
        .filter(|r| r.timestamp > week_ago)
        .take(20)
        .map(|r| r.command)
        .collect::<Vec<_>>()
        .join("\n")
}

// ── UserModel — unified aggregated model of the user ─────────────────────────

/// Everything BLADE knows about the user, compiled into one struct.
/// Aggregated from persona_engine traits, deep_scan, typed_memory, people_graph,
/// personality_mirror, character bible, and interaction history.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserModel {
    pub name: String,
    pub role: String,                         // "full-stack developer"
    pub primary_languages: Vec<String>,       // ["TypeScript", "Rust"]
    pub work_hours: (u8, u8),                 // (10, 18) — 10am to 6pm
    pub energy_pattern: String,               // "most productive in morning"
    pub communication_style: String,          // "casual, concise, technical"
    pub pet_peeves: Vec<String>,              // ["verbose answers", "bullet points for simple questions"]
    pub active_projects: Vec<String>,         // from deep_scan + git repos
    pub goals: Vec<String>,                   // from typed_memory Goal category
    pub relationships: Vec<(String, String)>, // (name, relationship) from people_graph
    pub expertise: Vec<(String, f32)>,        // (topic, confidence) from interactions
    pub mood_today: String,                   // inferred from typing patterns, time, interactions
}

impl Default for UserModel {
    fn default() -> Self {
        Self {
            name: String::new(),
            role: String::new(),
            primary_languages: Vec::new(),
            work_hours: (9, 18),
            energy_pattern: "unknown".to_string(),
            communication_style: "neutral".to_string(),
            pet_peeves: Vec::new(),
            active_projects: Vec::new(),
            goals: Vec::new(),
            relationships: Vec::new(),
            expertise: Vec::new(),
            mood_today: "neutral".to_string(),
        }
    }
}

// ── Expertise DB ──────────────────────────────────────────────────────────────

fn expertise_db_path() -> std::path::PathBuf {
    crate::config::blade_config_dir().join("persona.db")
}

fn open_expertise_db() -> Option<rusqlite::Connection> {
    rusqlite::Connection::open(expertise_db_path()).ok()
}

/// Ensure expertise table exists (called lazily).
pub fn ensure_expertise_table() {
    if let Some(conn) = open_expertise_db() {
        let _ = conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS user_expertise (
                topic       TEXT PRIMARY KEY,
                confidence  REAL NOT NULL DEFAULT 0.1,
                updated_at  INTEGER NOT NULL DEFAULT 0,
                evidence    TEXT NOT NULL DEFAULT '[]'
            );"
        );
    }
}

/// Load expertise map from DB.
pub fn load_expertise_map() -> HashMap<String, f32> {
    let conn = match open_expertise_db() {
        Some(c) => c,
        None => return HashMap::new(),
    };
    ensure_expertise_table();
    let mut stmt = match conn.prepare(
        "SELECT topic, confidence FROM user_expertise ORDER BY confidence DESC LIMIT 50"
    ) {
        Ok(s) => s,
        Err(_) => return HashMap::new(),
    };
    stmt.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, f64>(1)? as f32))
    })
    .ok()
    .map(|rows| rows.filter_map(|r| r.ok()).collect())
    .unwrap_or_default()
}

/// Bump expertise for a topic by `delta`. Clamped to 0.0–1.0.
pub fn bump_expertise(topic: &str, delta: f32, evidence: &str) {
    let conn = match open_expertise_db() {
        Some(c) => c,
        None => return,
    };
    ensure_expertise_table();
    let now = chrono::Utc::now().timestamp();

    // Read current value
    let current: f32 = conn.query_row(
        "SELECT confidence FROM user_expertise WHERE topic = ?1",
        params![topic],
        |row| row.get::<_, f64>(0).map(|v| v as f32),
    ).unwrap_or(0.0);

    let new_val = (current + delta).clamp(0.0, 1.0);

    // Read existing evidence, keep last 5
    let existing_evidence: Vec<String> = conn.query_row(
        "SELECT evidence FROM user_expertise WHERE topic = ?1",
        params![topic],
        |row| row.get::<_, String>(0),
    ).ok()
    .and_then(|s| serde_json::from_str(&s).ok())
    .unwrap_or_default();

    let mut ev_list: Vec<String> = vec![evidence.to_string()];
    ev_list.extend(existing_evidence.into_iter().take(4));
    let ev_json = serde_json::to_string(&ev_list).unwrap_or_else(|_| "[]".to_string());

    let _ = conn.execute(
        "INSERT INTO user_expertise (topic, confidence, updated_at, evidence)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(topic) DO UPDATE SET
             confidence = ?2,
             updated_at = ?3,
             evidence   = ?4",
        params![topic, new_val as f64, now, ev_json],
    );
}

// ── build_user_model ──────────────────────────────────────────────────────────

/// Aggregates everything BLADE knows about the user into a single `UserModel`.
/// Pulls from: config, deep_scan, typed_memory, people_graph, persona traits,
/// personality_mirror profile, character bible, and expertise map.
pub fn build_user_model() -> UserModel {
    let config = crate::config::load_config();
    let mut model = UserModel::default();

    // ── Name & basics from config ─────────────────────────────────────────────
    model.name = if config.user_name.is_empty() {
        std::env::var("USERNAME")
            .or_else(|_| std::env::var("USER"))
            .unwrap_or_else(|_| "User".to_string())
    } else {
        config.user_name.clone()
    };

    // ── Role from deep_scan results ───────────────────────────────────────────
    if let Some(scan) = crate::deep_scan::load_scan_summary() {
        // Extract primary languages from scan summary text (simple heuristic)
        let langs_candidates = ["TypeScript", "Rust", "Python", "JavaScript", "Go", "Java",
                                 "C#", "C++", "Swift", "Kotlin", "Ruby", "PHP"];
        let scan_lower = scan.to_lowercase();
        for lang in &langs_candidates {
            if scan_lower.contains(&lang.to_lowercase()) && !model.primary_languages.contains(&lang.to_string()) {
                model.primary_languages.push(lang.to_string());
            }
        }
    }

    // ── Git repos as active projects ──────────────────────────────────────────
    if let Some(scan_results) = crate::deep_scan::load_results_pub() {
        for repo in &scan_results.git_repos {
            let name = std::path::Path::new(&repo.path)
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| repo.path.clone());
            if !model.active_projects.contains(&name) {
                model.active_projects.push(name);
            }
            // Collect languages from repos
            for (lang, _) in &repo.language_counts {
                if !model.primary_languages.contains(lang) {
                    model.primary_languages.push(lang.clone());
                }
            }
        }
        model.active_projects.truncate(10);
        model.primary_languages.truncate(8);
    }

    // ── Character bible for role/identity ─────────────────────────────────────
    let bible = crate::character::load_bible();
    if !bible.identity.is_empty() {
        // Extract role hint from identity block
        let role_words = ["developer", "designer", "engineer", "researcher", "founder",
                           "manager", "analyst", "architect", "data scientist", "devops"];
        let id_lower = bible.identity.to_lowercase();
        for rw in &role_words {
            if id_lower.contains(rw) {
                model.role = rw.to_string();
                break;
            }
        }
    }
    if model.role.is_empty() && !model.primary_languages.is_empty() {
        model.role = "software developer".to_string();
    }

    // ── Typed memories: goals, routines, preferences ──────────────────────────
    let goals = crate::typed_memory::recall_by_category(crate::typed_memory::MemoryCategory::Goal, 5);
    model.goals = goals.iter().map(|g| g.content.clone()).collect();

    let routines = crate::typed_memory::recall_by_category(crate::typed_memory::MemoryCategory::Routine, 3);
    // Extract work hours from routines
    for r in &routines {
        let rl = r.content.to_lowercase();
        // Simple heuristic: look for "10am", "10:00", "9am" etc.
        if rl.contains("am") || rl.contains("pm") || rl.contains(':') {
            model.energy_pattern = r.content.clone();
            break;
        }
    }

    let prefs = crate::typed_memory::recall_by_category(crate::typed_memory::MemoryCategory::Preference, 10);
    model.pet_peeves = prefs.iter()
        .filter(|p| {
            let cl = p.content.to_lowercase();
            cl.contains("hate") || cl.contains("dislike") || cl.contains("avoid") ||
            cl.contains("never") || cl.contains("don't") || cl.contains("not")
        })
        .map(|p| p.content.clone())
        .take(5)
        .collect();

    // ── Communication style from personality_mirror ────────────────────────────
    if let Some(profile) = crate::personality_mirror::load_profile() {
        let tone = if profile.formality_level < 0.3 { "casual" }
                   else if profile.formality_level < 0.6 { "semi-formal" }
                   else { "formal" };
        let depth = if profile.technical_depth > 0.6 { "technical" }
                    else if profile.technical_depth > 0.3 { "moderately technical" }
                    else { "non-technical" };
        let len = match profile.avg_message_length.as_str() {
            "very_short" | "short" => "concise",
            "long" => "verbose",
            _ => "medium-length",
        };
        model.communication_style = format!("{}, {}, {}", tone, len, depth);
    }

    // ── Persona traits for energy pattern ─────────────────────────────────────
    let traits = get_all_traits();
    let energy_trait = traits.iter().find(|t| t.trait_name == "energy").map(|t| t.score).unwrap_or(0.5);
    if energy_trait > 0.7 {
        model.energy_pattern = "high energy, consistently engaged".to_string();
    } else if energy_trait < 0.3 {
        model.energy_pattern = "low-key, prefers calm focused work".to_string();
    } else if model.energy_pattern.is_empty() || model.energy_pattern == "unknown" {
        model.energy_pattern = "moderate, steady work pace".to_string();
    }

    // ── People graph for relationships ────────────────────────────────────────
    crate::people_graph::ensure_tables();
    let people = crate::people_graph::people_list_pub();
    model.relationships = people.iter()
        .take(10)
        .map(|p| (p.name.clone(), p.relationship.clone()))
        .collect();

    // ── Expertise map ─────────────────────────────────────────────────────────
    ensure_expertise_table();
    let expertise_map = load_expertise_map();
    let mut expertise_vec: Vec<(String, f32)> = expertise_map.into_iter().collect();
    expertise_vec.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    model.expertise = expertise_vec.into_iter().take(15).collect();

    // ── Mood from health/streak stats ─────────────────────────────────────────
    let stats = crate::health_guardian::get_health_stats();
    let streak_mins = stats["current_streak_minutes"].as_i64().unwrap_or(0);
    let hour = chrono::Local::now().hour() as u8;

    model.mood_today = estimate_mood_from_context(streak_mins as u32, hour, &traits);

    model
}

// ── estimate_mood ─────────────────────────────────────────────────────────────

/// Estimate the user's current mood from available signals.
/// `recent_messages` is the last few user messages (newest first).
/// `hour` is the current hour (0–23). `streak_minutes` is time since last break.
pub fn estimate_mood(recent_messages: &[String], time_of_day: u8, streak_minutes: u32) -> String {
    let traits = get_all_traits();
    let base = estimate_mood_from_context(streak_minutes, time_of_day, &traits);

    if recent_messages.is_empty() {
        return base;
    }

    // Analyse the last few messages for signals
    let combined = recent_messages.iter().take(5).cloned().collect::<Vec<_>>().join(" ");
    let combined_lower = combined.to_lowercase();

    // Frustration signals
    let frustration_signals = [
        "again", "still", "why won't", "doesn't work", "broken", "ugh", "wtf",
        "ffs", "come on", "argh", "not working", "keeps failing", "useless",
    ];
    let frustration_count = frustration_signals.iter().filter(|&&s| combined_lower.contains(s)).count();

    // Curiosity signals
    let curiosity_signals = ["how does", "why is", "what if", "interesting", "?", "curious"];
    let curiosity_count = curiosity_signals.iter().filter(|&&s| combined_lower.contains(s)).count();

    // Busyness signals — short messages mean busy
    let avg_len = recent_messages.iter().map(|m| m.len()).sum::<usize>()
        / recent_messages.len().max(1);

    let word_count = recent_messages.iter()
        .flat_map(|m| m.split_whitespace())
        .count()
        / recent_messages.len().max(1);

    if frustration_count >= 2 || (frustration_count >= 1 && streak_minutes > 60) {
        return "frustrated — be extra concise and direct, offer to help immediately".to_string();
    }

    if avg_len < 20 && word_count <= 3 {
        return "busy — keep responses brief, skip preambles".to_string();
    }

    if curiosity_count >= 2 && streak_minutes < 30 {
        return "curious and exploring — go deeper, explain the why".to_string();
    }

    if streak_minutes > 120 {
        return "deep focus — minimal interruptions, concise help".to_string();
    }

    base
}

fn estimate_mood_from_context(streak_minutes: u32, hour: u8, traits: &[PersonaTrait]) -> String {
    let energy = traits.iter().find(|t| t.trait_name == "energy").map(|t| t.score).unwrap_or(0.5);
    let frustration_tol = traits.iter().find(|t| t.trait_name == "frustration_tolerance").map(|t| t.score).unwrap_or(0.5);

    // Time-based baseline
    let time_mood = if hour >= 6 && hour <= 10 {
        "morning — fresh start, good for complex tasks"
    } else if hour >= 11 && hour <= 14 {
        "midday — productive peak"
    } else if hour >= 15 && hour <= 18 {
        "afternoon — steady work"
    } else if hour >= 19 && hour <= 22 {
        "evening — winding down, prefer lighter tasks"
    } else {
        "late night — deep focus or exhausted, keep it brief"
    };

    // Streak modifiers
    if streak_minutes > 120 && frustration_tol < 0.4 {
        return "tired and potentially frustrated — keep it short and direct".to_string();
    }
    if streak_minutes > 90 {
        return format!("long streak ({}min) — {}", streak_minutes, time_mood);
    }
    if energy > 0.7 {
        return format!("energetic — {}", time_mood);
    }

    time_mood.to_string()
}

// ── predict_next_need ─────────────────────────────────────────────────────────

/// Predict what the user will likely need next based on their current context.
/// Uses rule-based prediction for clear cases; returns None if nothing confident.
pub async fn predict_next_need(
    model: &UserModel,
    perception: &crate::perception_fusion::PerceptionState,
) -> Option<String> {
    let hour = chrono::Local::now().hour() as u8;
    let day = chrono::Local::now().weekday();
    let streak = crate::health_guardian::get_health_stats();
    let streak_mins = streak["current_streak_minutes"].as_i64().unwrap_or(0) as u32;

    // Rule 1: Monday morning + fresh start → morning briefing
    if hour >= 7 && hour <= 10
       && day == chrono::Weekday::Mon
       && streak_mins < 5
    {
        return Some("morning briefing — it's Monday morning and they just opened BLADE".to_string());
    }

    // Rule 2: Fresh start any weekday morning
    if hour >= 7 && hour <= 9 && streak_mins < 5 {
        return Some("quick morning context — what's on the agenda today".to_string());
    }

    // Rule 3: Error on screen for a while → debugging help
    if !perception.visible_errors.is_empty() && streak_mins > 8 {
        let err_preview = crate::safe_slice(&perception.visible_errors[0], 80);
        return Some(format!("debugging help — error on screen for {}min: {}", streak_mins, err_preview));
    }

    // Rule 4: On Slack/messaging app → draft reply help
    let app_lower = perception.active_app.to_lowercase();
    let title_lower = perception.active_title.to_lowercase();
    if (app_lower.contains("slack") || app_lower.contains("teams") || app_lower.contains("discord"))
       && (title_lower.contains("mention") || title_lower.contains("thread"))
    {
        return Some("draft reply — mentioned in a conversation".to_string());
    }

    // Rule 5: Git-related activity → PR / ticket update
    if title_lower.contains("pull request") || title_lower.contains("merge request")
       || app_lower.contains("github") || app_lower.contains("gitlab")
    {
        return Some("PR review or ticket update".to_string());
    }

    // Rule 6: Long streak → break suggestion
    if streak_mins > 90 {
        return Some(format!("break suggestion — {}min streak, encourage a short rest", streak_mins));
    }

    // Rule 7: Code editor + specific language context
    if !perception.context_tags.is_empty() {
        let tags = &perception.context_tags;
        let in_rust = tags.iter().any(|t| t == "rust");
        let in_ts = tags.iter().any(|t| t == "typescript" || t == "javascript");

        // Check if user is weak in this area
        let weakest_area = model.expertise.iter()
            .filter(|(topic, _)| {
                if in_rust { topic.to_lowercase().contains("rust") }
                else if in_ts { topic.to_lowercase().contains("typescript") || topic.to_lowercase().contains("javascript") }
                else { false }
            })
            .min_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal));

        if let Some((topic, confidence)) = weakest_area {
            if *confidence < 0.4 {
                return Some(format!("explanation help — working with {} but confidence is low ({})", topic, confidence));
            }
        }
    }

    // Ambiguous — use LLM for complex cases
    if !perception.active_app.is_empty() {
        let context_summary = format!(
            "User: {} ({}). Current app: {}. Window: {}. Tags: {}. Streak: {}min. Mood: {}. Hour: {}.",
            model.name,
            model.role,
            perception.active_app,
            crate::safe_slice(&perception.active_title, 60),
            perception.context_tags.join(", "),
            streak_mins,
            model.mood_today,
            hour,
        );

        let (provider, api_key, llm_model) = get_llm_provider();
        if !api_key.is_empty() || provider == "ollama" {
            let prompt = format!(
                "Based on this user context, what do they most likely need next from their AI assistant? Answer in ONE short sentence (10-20 words), or say 'nothing specific' if unclear.\n\nContext: {}",
                context_summary
            );
            use crate::providers::{complete_turn, ConversationMessage};
            let conv = vec![ConversationMessage::User(prompt)];
            if let Ok(turn) = complete_turn(&provider, &api_key, &llm_model, &conv, &crate::providers::no_tools(), None).await {
                let answer = turn.content.trim().to_lowercase();
                if !answer.contains("nothing specific") && !answer.is_empty() {
                    return Some(turn.content.trim().to_string());
                }
            }
        }
    }

    None
}

// ── update_expertise_from_conversation ───────────────────────────────────────

/// After a conversation, update the user's expertise map.
/// `messages` is (role, content) pairs. `user_knew_it` means the user was
/// teaching BLADE rather than asking for help (yields a larger bump).
pub fn update_expertise_from_conversation(
    topics: &[String],
    user_knew_it: bool,
    evidence: &str,
) {
    ensure_expertise_table();
    let delta = if user_knew_it { 0.2_f32 } else { 0.05_f32 };
    for topic in topics {
        bump_expertise(topic, delta, evidence);
    }
}

/// Build the expertise injection string for brain.rs.
/// Returns a line like:
/// "User is expert in React hooks (0.9), TypeScript (0.8) but new to Rust async (0.3)."
pub fn get_expertise_injection() -> Option<String> {
    ensure_expertise_table();
    let map = load_expertise_map();
    if map.is_empty() {
        return None;
    }

    let mut items: Vec<(&String, &f32)> = map.iter().collect();
    items.sort_by(|a, b| b.1.partial_cmp(a.1).unwrap_or(std::cmp::Ordering::Equal));

    let experts: Vec<String> = items.iter()
        .filter(|(_, &c)| c >= 0.7)
        .take(4)
        .map(|(t, c)| format!("{} ({:.1})", t, c))
        .collect();

    let newbies: Vec<String> = items.iter()
        .filter(|(_, &c)| c < 0.35)
        .take(3)
        .map(|(t, c)| format!("{} ({:.1})", t, c))
        .collect();

    match (experts.is_empty(), newbies.is_empty()) {
        (true, true) => None,
        (false, true) => Some(format!("User is expert in: {}.", experts.join(", "))),
        (true, false) => Some(format!("User is still learning: {}.", newbies.join(", "))),
        (false, false) => Some(format!(
            "User is expert in: {}. Still learning: {}.",
            experts.join(", "),
            newbies.join(", ")
        )),
    }
}

// ── Compact 3-line user model summary for brain.rs ───────────────────────────

/// Build a compact 3-line summary of the user model for injection into the system prompt.
/// Format: "Name (role, lang/lang expert). Currently X, Yhr streak, working on PROJECT. Mood: Z."
pub fn get_user_model_summary() -> Option<String> {
    let model = build_user_model();

    if model.name.is_empty() && model.role.is_empty() {
        return None;
    }

    let mut lines = Vec::new();

    // Line 1: Identity
    let langs = if model.primary_languages.is_empty() {
        String::new()
    } else {
        format!(", {}", model.primary_languages[..model.primary_languages.len().min(3)].join("/"))
    };
    let role_str = if model.role.is_empty() { "developer".to_string() } else { model.role.clone() };
    lines.push(format!("{} ({}{}).", model.name, role_str, langs));

    // Line 2: Current focus + streak
    let stats = crate::health_guardian::get_health_stats();
    let streak_mins = stats["current_streak_minutes"].as_i64().unwrap_or(0);
    let streak_str = if streak_mins >= 60 {
        format!("{}h{}min streak", streak_mins / 60, streak_mins % 60)
    } else if streak_mins > 0 {
        format!("{}min streak", streak_mins)
    } else {
        "fresh session".to_string()
    };

    let project_str = if let Some(proj) = model.active_projects.first() {
        format!(", working on {}", proj)
    } else {
        String::new()
    };
    lines.push(format!("Currently {}{}.", streak_str, project_str));

    // Line 3: Mood + predicted need
    lines.push(format!("Mood: {}.", model.mood_today));

    // Line 4 (optional): expertise hint
    if let Some(exp_hint) = get_expertise_injection() {
        lines.push(exp_hint);
    }

    Some(format!("## User Model\n\n{}", lines.join("\n")))
}

// ── Tauri commands ────────────────────────────────────────────────────────────

#[tauri::command]
pub fn persona_get_traits() -> Vec<PersonaTrait> {
    ensure_tables();
    get_all_traits()
}

#[tauri::command]
pub fn persona_get_relationship() -> RelationshipState {
    ensure_tables();
    get_relationship_state()
}

#[tauri::command]
pub fn persona_update_trait(trait_name: String, score: f32, evidence: String) -> Result<(), String> {
    ensure_tables();
    let clamped = score.clamp(0.0, 1.0);
    update_trait(&trait_name, clamped, &evidence);
    Ok(())
}

#[tauri::command]
pub async fn persona_analyze_now() -> Result<Vec<PersonaTrait>, String> {
    ensure_tables();

    // Grab recent conversation history to analyze
    let db_path = crate::config::blade_config_dir().join("blade.db");
    let messages: Vec<(String, String)> = match rusqlite::Connection::open(&db_path) {
        Ok(conn) => {
            let week_ago = chrono::Utc::now().timestamp() - 7 * 86400;
            let mut stmt = conn.prepare(
                "SELECT m.role, m.content FROM messages m
                 JOIN conversations c ON m.conversation_id = c.id
                 WHERE m.timestamp > ?1 AND m.role = 'user'
                 ORDER BY m.timestamp DESC LIMIT 60"
            ).unwrap_or_else(|_| conn.prepare("SELECT 'user', '' LIMIT 0").unwrap());

            stmt.query_map(params![week_ago], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .map(|rows| rows.filter_map(|r| r.ok()).collect())
            .unwrap_or_default()
        }
        Err(_) => Vec::new(),
    };

    let traits = analyze_conversation_for_traits(&messages).await;
    Ok(traits)
}

#[tauri::command]
pub fn persona_record_outcome(was_helpful: bool, topic: String) {
    ensure_tables();
    record_interaction_outcome(was_helpful, &topic);
}

/// Get the unified UserModel — everything BLADE knows about the user in one struct.
#[tauri::command]
pub fn get_user_model() -> UserModel {
    ensure_tables();
    ensure_expertise_table();
    build_user_model()
}

/// Predict what the user needs next given current context.
/// Returns None if no confident prediction can be made.
#[tauri::command]
pub async fn predict_next_need_cmd() -> Option<String> {
    let model = build_user_model();
    let perception = crate::perception_fusion::get_latest()
        .unwrap_or_default();
    predict_next_need(&model, &perception).await
}

/// Get the expertise map: topic → confidence (0.0–1.0).
#[tauri::command]
pub fn get_expertise_map() -> Vec<(String, f32)> {
    ensure_expertise_table();
    let map = load_expertise_map();
    let mut items: Vec<(String, f32)> = map.into_iter().collect();
    items.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    items
}

/// Update expertise after a conversation.
/// `topics`: list of topics discussed. `user_knew_it`: true if user was teaching BLADE.
#[tauri::command]
pub fn update_expertise(topics: Vec<String>, user_knew_it: bool, evidence: String) {
    ensure_expertise_table();
    update_expertise_from_conversation(&topics, user_knew_it, &evidence);
}

/// Estimate user mood from recent messages.
#[tauri::command]
pub fn persona_estimate_mood(
    recent_messages: Vec<String>,
    time_of_day: u8,
    streak_minutes: u32,
) -> String {
    estimate_mood(&recent_messages, time_of_day, streak_minutes)
}
