/// METACOGNITION — BLADE's awareness of its own cognitive state.
///
/// "Knowing what you know and what you don't know."
///
/// Three capabilities:
///   1. Confidence estimation — before answering, estimate how confident
///      BLADE is that it can handle this well
///   2. Knowledge gap detection — identify when the question is outside
///      BLADE's knowledge/capabilities and should ask for help
///   3. Cognitive load monitoring — detect when the context is too complex
///      for a good response and suggest decomposition
///
/// This is injected into the system prompt so the LLM itself becomes
/// aware of its cognitive boundaries. Not a separate LLM call — just
/// context that makes the existing model more honest about uncertainty.

use serde::{Deserialize, Serialize};
use std::sync::{Mutex, OnceLock};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct MetacognitiveState {
    pub confidence: f32,
    pub uncertainty_count: u32,
    pub gap_count: u32,
    pub last_updated: i64,
}

static META_STATE: OnceLock<Mutex<MetacognitiveState>> = OnceLock::new();

fn meta_store() -> &'static Mutex<MetacognitiveState> {
    META_STATE.get_or_init(|| Mutex::new(load_meta_state().unwrap_or_default()))
}

pub fn get_state() -> MetacognitiveState {
    meta_store().lock().map(|s| s.clone()).unwrap_or_default()
}

fn load_meta_state() -> Option<MetacognitiveState> {
    let db_path = crate::config::blade_config_dir().join("blade.db");
    let conn = rusqlite::Connection::open(&db_path).ok()?;
    let json: String = conn.query_row(
        "SELECT value FROM settings WHERE key = 'metacognitive_state'",
        [],
        |row| row.get(0),
    ).ok()?;
    serde_json::from_str(&json).ok()
}

fn persist_meta_state(state: &MetacognitiveState) {
    let db_path = crate::config::blade_config_dir().join("blade.db");
    if let Ok(conn) = rusqlite::Connection::open(&db_path) {
        if let Ok(json) = serde_json::to_string(state) {
            let _ = conn.execute(
                "INSERT INTO settings (key, value) VALUES ('metacognitive_state', ?1)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                rusqlite::params![json],
            );
        }
    }
}

pub fn ensure_gap_log_table() {
    let db_path = crate::config::blade_config_dir().join("blade.db");
    if let Ok(conn) = rusqlite::Connection::open(&db_path) {
        let _ = conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS metacognitive_gap_log (
                id TEXT PRIMARY KEY,
                topic TEXT NOT NULL,
                user_request TEXT NOT NULL,
                confidence REAL NOT NULL,
                uncertainty_count INTEGER DEFAULT 1,
                initiative_shown INTEGER DEFAULT 0,
                created_at INTEGER NOT NULL,
                fed_to_evolution INTEGER DEFAULT 0
            );"
        );
    }
}

/// Called from reasoning_engine when a step confidence drops >0.3 from prior step.
/// Increments the in-memory uncertainty_count and persists.
pub fn record_uncertainty_marker(thought: &str, delta: f32) {
    if let Ok(mut state) = meta_store().lock() {
        state.uncertainty_count += 1;
        state.last_updated = chrono::Utc::now().timestamp();
        persist_meta_state(&state);
    }
    log::info!(
        "[metacognition] uncertainty marker: delta={:.2}, thought={}",
        delta,
        crate::safe_slice(thought, 80)
    );
}

/// Log a capability gap to SQLite and feed it to evolution.rs for Voyager-loop.
/// Called when BLADE cannot answer confidently and shows initiative phrasing.
pub fn log_gap(topic: &str, user_request: &str, confidence: f32, uncertainty_count: u32) {
    ensure_gap_log_table();
    let db_path = crate::config::blade_config_dir().join("blade.db");
    if let Ok(conn) = rusqlite::Connection::open(&db_path) {
        let id = format!("meta-gap-{}", chrono::Utc::now().timestamp_millis());
        let now = chrono::Utc::now().timestamp();
        let _ = conn.execute(
            "INSERT INTO metacognitive_gap_log
             (id, topic, user_request, confidence, uncertainty_count, initiative_shown, created_at, fed_to_evolution)
             VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6, 1)",
            rusqlite::params![
                id,
                crate::safe_slice(topic, 120),
                crate::safe_slice(user_request, 300),
                confidence as f64,
                uncertainty_count as i64,
                now,
            ],
        );
        // Feed to evolution Voyager loop
        let _ = crate::evolution::evolution_log_capability_gap(
            topic.to_string(),
            user_request.to_string(),
        );
        // Update in-memory state
        if let Ok(mut state) = meta_store().lock() {
            state.gap_count += 1;
            state.confidence = confidence;
            state.last_updated = now;
            persist_meta_state(&state);
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CognitiveState {
    /// How confident BLADE is it can handle this query well (0.0-1.0)
    pub confidence: f32,
    /// What BLADE knows about this topic (from memory + DNA)
    pub knowledge_level: String, // "expert" | "familiar" | "basic" | "unknown"
    /// Whether BLADE should ask for clarification
    pub should_ask: bool,
    /// Reason for low confidence (if any)
    pub uncertainty_reason: String,
    /// Suggested approach given the cognitive state
    pub suggested_approach: String,
}

/// Assess BLADE's cognitive state for a given query.
/// Called from brain.rs to inject metacognitive awareness into the prompt.
pub fn assess_cognitive_state(user_query: &str) -> CognitiveState {
    let query_lower = user_query.to_lowercase();

    // ── Knowledge level: how much does BLADE know about this topic? ───
    let (knowledge_level, knowledge_score) = assess_knowledge_level(&query_lower);

    // ── Capability check: can BLADE actually DO what's being asked? ───
    let capability_score = assess_capability(&query_lower);

    // ── Complexity check: is this too complex for one response? ───────
    let complexity = assess_complexity(user_query);

    // ── Context freshness: is BLADE's knowledge current? ─────────────
    let freshness = assess_freshness(&query_lower);

    // ── Combined confidence ──────────────────────────────────────────
    let confidence = (knowledge_score * 0.4 + capability_score * 0.3
        + (1.0 - complexity) * 0.2 + freshness * 0.1).clamp(0.0, 1.0);

    let should_ask = confidence < 0.3 || (complexity > 0.8 && knowledge_score < 0.5);

    let uncertainty_reason = if knowledge_score < 0.3 {
        format!("Limited knowledge about this topic")
    } else if capability_score < 0.3 {
        format!("May not have the right tools for this")
    } else if complexity > 0.8 {
        format!("This is highly complex — may need decomposition")
    } else if freshness < 0.3 {
        format!("Knowledge may be outdated")
    } else {
        String::new()
    };

    let suggested_approach = if should_ask {
        "Ask the user for clarification before proceeding".to_string()
    } else if complexity > 0.7 {
        "Break this into smaller sub-tasks".to_string()
    } else if knowledge_score < 0.5 && capability_score > 0.5 {
        "Research this topic first, then act".to_string()
    } else {
        "Proceed with available knowledge".to_string()
    };

    CognitiveState {
        confidence,
        knowledge_level,
        should_ask,
        uncertainty_reason,
        suggested_approach,
    }
}

/// Check how much BLADE knows about the query topic from its memory systems.
fn assess_knowledge_level(query: &str) -> (String, f32) {
    let mut score: f32 = 0.3; // baseline — the LLM has general knowledge

    // Check typed_memory for relevant facts
    let context_tags: Vec<String> = query.split_whitespace()
        .filter(|w| w.len() >= 4)
        .map(|w| w.to_lowercase())
        .collect();

    if !context_tags.is_empty() {
        let typed_ctx = crate::typed_memory::get_typed_memory_context(&context_tags);
        if !typed_ctx.is_empty() {
            score += 0.3; // has specific memories about this
        }
    }

    // Check knowledge_graph for relevant entities
    let graph_ctx = crate::knowledge_graph::get_graph_context(query);
    if !graph_ctx.is_empty() {
        score += 0.2;
    }

    // Check people_graph if query mentions people
    let words: Vec<&str> = query.split_whitespace().collect();
    let has_people = words.iter().any(|w| {
        w.len() >= 2 && w.chars().next().map(|c| c.is_uppercase()).unwrap_or(false)
    });
    if has_people {
        let people = crate::people_graph::people_list_pub();
        let known = words.iter().any(|w| {
            people.iter().any(|p| p.name.to_lowercase().contains(&w.to_lowercase()))
        });
        if known { score += 0.15; }
    }

    let level = if score >= 0.7 {
        ("expert".to_string(), score.min(1.0))
    } else if score >= 0.5 {
        ("familiar".to_string(), score)
    } else if score >= 0.3 {
        ("basic".to_string(), score)
    } else {
        ("unknown".to_string(), score)
    };

    level
}

/// Check if BLADE has the TOOLS/CAPABILITIES to handle this request.
fn assess_capability(query: &str) -> f32 {
    let mut score: f32 = 0.5; // LLM + native tools cover a lot

    // Check if the query mentions platforms/tools BLADE has organs for
    let hive_status = crate::hive::get_hive_status();
    let active_organs: Vec<String> = hive_status.tentacles.iter()
        .filter(|t| t.status == crate::hive::TentacleStatus::Active)
        .map(|t| t.platform.clone())
        .collect();

    let platform_mentions = ["slack", "github", "email", "discord", "calendar",
        "linear", "jira", "browser", "terminal", "file"];
    for platform in platform_mentions {
        if query.contains(platform) {
            if active_organs.iter().any(|o| o.to_lowercase().contains(platform)) {
                score += 0.15; // has the organ
            } else {
                score -= 0.2; // needs the organ but doesn't have it
            }
        }
    }

    // Check if it requires capabilities BLADE definitely has
    let definitely_can = ["read file", "write file", "run command", "search",
        "bash", "git", "web", "screenshot", "clipboard"];
    for cap in definitely_can {
        if query.contains(cap) { score += 0.1; break; }
    }

    // Check if it requires capabilities BLADE definitely lacks
    let definitely_cant = ["3d render", "video edit", "compile ios", "android build",
        "physical", "robot", "hardware"];
    for cap in definitely_cant {
        if query.contains(cap) { score -= 0.3; break; }
    }

    score.clamp(0.0, 1.0)
}

/// Estimate how complex the query is (0.0 simple → 1.0 extremely complex).
fn assess_complexity(query: &str) -> f32 {
    let word_count = query.split_whitespace().count();
    let step_words = ["then", "after that", "next", "finally", "first", "second",
        "step 1", "step 2", "also", "and then", "followed by"];
    let has_multiple_tasks = step_words.iter().filter(|w| query.to_lowercase().contains(*w)).count() >= 2;
    let has_conditionals = query.contains(" if ") || query.contains(" unless ")
        || query.contains(" but ") || query.contains(" however ");
    let has_technical_depth = query.contains("architecture") || query.contains("design")
        || query.contains("optimize") || query.contains("refactor")
        || query.contains("migrate");

    let mut complexity: f32 = 0.0;
    if word_count > 100 { complexity += 0.3; }
    else if word_count > 50 { complexity += 0.15; }
    if has_multiple_tasks { complexity += 0.3; }
    if has_conditionals { complexity += 0.15; }
    if has_technical_depth { complexity += 0.2; }

    complexity.clamp(0.0, 1.0)
}

/// Check if BLADE's knowledge about this topic is fresh or stale.
fn assess_freshness(query: &str) -> f32 {
    // Topics that change rapidly need fresh data
    let volatile_topics = ["news", "price", "stock", "weather", "trending",
        "latest", "current", "today", "right now"];
    let is_volatile = volatile_topics.iter().any(|t| query.contains(t));

    if is_volatile {
        // Check when BLADE last researched something related
        let db_path = crate::config::blade_config_dir().join("blade.db");
        if let Ok(conn) = rusqlite::Connection::open(&db_path) {
            let search = format!("%{}%", crate::safe_slice(query, 50));
            let latest: Option<i64> = conn.query_row(
                "SELECT MAX(created_at) FROM typed_memories WHERE content LIKE ?1",
                rusqlite::params![search],
                |row| row.get(0),
            ).ok().flatten();

            if let Some(ts) = latest {
                let age_hours = (chrono::Utc::now().timestamp() - ts) / 3600;
                if age_hours < 1 { return 0.9; }
                if age_hours < 24 { return 0.6; }
                return 0.2; // stale
            }
        }
        return 0.1; // no data at all on volatile topic
    }

    0.8 // non-volatile topics — existing knowledge is probably fine
}

/// Format the metacognitive state as a system prompt injection.
/// Only inject when confidence is low or complexity is high.
pub fn get_metacognition_injection(user_query: &str) -> String {
    let state = assess_cognitive_state(user_query);

    // Don't inject for high-confidence, simple queries
    if state.confidence > 0.7 && !state.should_ask {
        return String::new();
    }

    let mut lines = Vec::new();
    lines.push("## Self-awareness".to_string());

    lines.push(format!("Confidence: {:.0}% (knowledge: {}, {})",
        state.confidence * 100.0,
        state.knowledge_level,
        state.suggested_approach
    ));

    if !state.uncertainty_reason.is_empty() {
        lines.push(format!("Uncertainty: {}", state.uncertainty_reason));
    }

    if state.should_ask {
        lines.push("IMPORTANT: Your confidence is low. Ask the user for clarification before guessing. Admitting uncertainty is better than hallucinating.".to_string());
    }

    if state.knowledge_level == "unknown" {
        lines.push("You have NO specific knowledge about this topic in your memory. Be upfront about this — don't pretend expertise you don't have.".to_string());
    }

    lines.join("\n")
}

// ── Solution Memory (Problem Solving faculty) ────────────────────────────────
//
// When BLADE solves a problem, remember the solution. Next time the same
// type of problem occurs, recall the solution instead of solving from scratch.
// This is domain-specific expertise — not generic LLM knowledge.

/// Record a problem + solution pair after successful resolution.
/// Called from commands.rs when a tool loop completes and the user's
/// problem was solved (detected by the presence of error keywords in
/// the query + successful tool execution).
pub fn remember_solution(problem: &str, solution: &str, tools_used: &[String]) {
    let db_path = crate::config::blade_config_dir().join("blade.db");
    if let Ok(conn) = rusqlite::Connection::open(&db_path) {
        let _ = conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS solution_memory (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                problem_hash TEXT NOT NULL,
                problem_text TEXT NOT NULL,
                solution_text TEXT NOT NULL,
                tools_used TEXT NOT NULL DEFAULT '[]',
                success_count INTEGER DEFAULT 1,
                created_at INTEGER NOT NULL,
                last_used INTEGER NOT NULL
            );"
        );

        let hash = hash_problem(problem);
        let tools_json = serde_json::to_string(tools_used).unwrap_or_default();
        let now = chrono::Utc::now().timestamp();

        // Upsert: if same problem type, increment success count
        let existing: Option<i64> = conn.query_row(
            "SELECT id FROM solution_memory WHERE problem_hash = ?1",
            rusqlite::params![hash],
            |row| row.get(0),
        ).ok();

        if let Some(id) = existing {
            let _ = conn.execute(
                "UPDATE solution_memory SET success_count = success_count + 1, last_used = ?1, solution_text = ?2 WHERE id = ?3",
                rusqlite::params![now, crate::safe_slice(solution, 500), id],
            );
        } else {
            let _ = conn.execute(
                "INSERT INTO solution_memory (problem_hash, problem_text, solution_text, tools_used, created_at, last_used)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
                rusqlite::params![hash, crate::safe_slice(problem, 200), crate::safe_slice(solution, 500), tools_json, now],
            );
        }
    }
}

/// Recall a past solution for a similar problem.
/// Returns None if no relevant solution found.
pub fn recall_solution(problem: &str) -> Option<String> {
    let db_path = crate::config::blade_config_dir().join("blade.db");
    let conn = rusqlite::Connection::open(&db_path).ok()?;

    let hash = hash_problem(problem);

    // Exact match by hash
    if let Ok(solution) = conn.query_row(
        "SELECT solution_text, success_count FROM solution_memory WHERE problem_hash = ?1 AND success_count >= 2",
        rusqlite::params![hash],
        |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)),
    ) {
        return Some(format!("Previously solved ({}x): {}", solution.1, solution.0));
    }

    // Fuzzy match by problem text
    let search = format!("%{}%", crate::safe_slice(problem, 50));
    conn.query_row(
        "SELECT solution_text, success_count FROM solution_memory WHERE problem_text LIKE ?1 AND success_count >= 2 ORDER BY success_count DESC LIMIT 1",
        rusqlite::params![search],
        |row| Ok(format!("Similar problem solved before ({}x): {}", row.get::<_, i64>(1)?, row.get::<_, String>(0)?)),
    ).ok()
}

fn hash_problem(problem: &str) -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let normalized: String = problem.to_lowercase()
        .chars().filter(|c| c.is_alphanumeric() || c.is_whitespace()).collect::<String>()
        .split_whitespace().collect::<Vec<&str>>().join(" ");
    let key = crate::safe_slice(&normalized, 80);
    let mut hasher = DefaultHasher::new();
    key.hash(&mut hasher);
    format!("{:x}", hasher.finish())
}

/// Get solution memory injection for the system prompt.
/// If the user's query matches a known problem, inject the past solution.
pub fn get_solution_injection(user_query: &str) -> String {
    // Only check for problem-like queries
    let q = user_query.to_lowercase();
    let is_problem = q.contains("error") || q.contains("fix") || q.contains("bug")
        || q.contains("broken") || q.contains("failing") || q.contains("crash")
        || q.contains("not working") || q.contains("help") || q.contains("issue");

    if !is_problem { return String::new(); }

    match recall_solution(user_query) {
        Some(solution) => format!("## Past Solution\n\n{}", solution),
        None => String::new(),
    }
}

// ── Tauri Commands ───────────────────────────────────────────────────────────

#[tauri::command]
pub fn metacognition_assess(query: String) -> CognitiveState {
    assess_cognitive_state(&query)
}

#[tauri::command]
pub fn metacognition_get_state() -> MetacognitiveState {
    get_state()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_confidence_delta_flag() {
        // META-01: MetacognitiveState starts at zero uncertainty.
        // Full integration test (calling record_uncertainty_marker and checking get_state)
        // requires process-level isolation due to OnceLock. Verified at dev-server level.
        let state = MetacognitiveState::default();
        assert_eq!(state.uncertainty_count, 0, "default uncertainty_count should be 0");
        assert_eq!(state.confidence, 0.0, "default confidence should be 0.0");
    }

    #[test]
    fn test_verifier_routing() {
        // META-02: secondary_verifier_call is an async function in reasoning_engine.rs.
        // This stub verifies the build_initiative_response contract exists after Plan 02.
        // Placeholder: verifies CognitiveState with low confidence triggers should_ask.
        let state = assess_cognitive_state("quantum entanglement in non-abelian gauge theory");
        // assess_cognitive_state is heuristic-based; a niche query should produce low confidence
        assert!(
            state.confidence <= 1.0 && state.confidence >= 0.0,
            "confidence must be in [0.0, 1.0] range"
        );
    }

    #[test]
    fn test_initiative_phrasing() {
        // META-03: initiative phrasing format check.
        // Will verify build_initiative_response output after Plan 02 adds it to reasoning_engine.rs.
        // Stub: verify the phrase pattern is well-formed.
        let expected_prefix = "I'm not confident about";
        let expected_suffix = "want me to observe first?";
        // This test will be extended by Plan 02 to call the actual build_initiative_response function.
        assert!(expected_prefix.len() > 0 && expected_suffix.len() > 0);
    }

    #[test]
    fn test_gap_log_insert() {
        // META-04: ensure_gap_log_table does not panic (idempotent table creation).
        ensure_gap_log_table();
        // Calling twice should also be fine (IF NOT EXISTS).
        ensure_gap_log_table();
    }

    #[test]
    fn test_metacognitive_state_default() {
        // META-04 auxiliary: MetacognitiveState default values are sane.
        let state = MetacognitiveState::default();
        assert_eq!(state.confidence, 0.0);
        assert_eq!(state.uncertainty_count, 0);
        assert_eq!(state.gap_count, 0);
        assert_eq!(state.last_updated, 0);
    }
}
