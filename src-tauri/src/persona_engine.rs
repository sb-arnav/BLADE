/// BLADE Persona Engine — "Soul Deepening" System
///
/// BLADE learns who you are over time: your humor, directness, energy levels,
/// frustration patterns, and preferred communication depth. Every conversation
/// is a signal. Every week it synthesizes what it has learned into traits and
/// relationship state that shape every future response.
///
/// The more you use BLADE, the more it sounds like it *knows* you — because it does.

use rusqlite::params;
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};

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

    // High-confidence traits only (confidence > 0.3)
    let notable: Vec<&PersonaTrait> = traits.iter()
        .filter(|t| t.confidence > 0.3)
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

    let turn = match complete_turn(&provider, &api_key, &model, &conv, &[], None).await {
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

    match complete_turn(&provider, &api_key, &model, &conv, &[], None).await {
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
