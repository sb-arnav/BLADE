/// BLADE AMBIENT RESEARCH ENGINE
///
/// Every 30 minutes, BLADE silently researches topics it detects from
/// your active work context — the thread you're tracking, the apps
/// you have open, the questions you've been asking.
///
/// Results are stored in the research_log table and injected into:
/// - Pulse thoughts ("I found something relevant while you were working")
/// - System prompt context ("Recent research: ...")
/// - The Evolution dashboard
///
/// This is not search-on-demand. This is BLADE staying current on your behalf.
#[allow(dead_code)]

use rusqlite::params;
use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager};

const RESEARCH_THROTTLE_SECS: i64 = 30 * 60; // at most once per 30 min
const RESEARCH_CONTEXT_CHARS: usize = 3_000;  // max chars to include in system prompt

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResearchEntry {
    pub id: i64,
    pub query: String,
    pub results: String,
    pub source: String,
    pub created_at: i64,
}

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

fn open_db() -> Option<rusqlite::Connection> {
    let db_path = crate::config::blade_config_dir().join("blade.db");
    rusqlite::Connection::open(&db_path).ok()
}

pub fn last_research_at() -> Option<i64> {
    let conn = open_db()?;
    conn.query_row(
        "SELECT MAX(created_at) FROM research_log WHERE source = 'auto'",
        [],
        |row| row.get::<_, Option<i64>>(0),
    )
    .ok()
    .flatten()
}

fn save_research(query: &str, results: &str, source: &str) -> bool {
    let conn = match open_db() {
        Some(c) => c,
        None => return false,
    };
    let now = chrono::Utc::now().timestamp();
    conn.execute(
        "INSERT INTO research_log (query, results, source, created_at) VALUES (?1, ?2, ?3, ?4)",
        params![query, results, source, now],
    )
    .is_ok()
}

/// Load recent research entries for context injection.
pub fn get_recent_research(limit: usize) -> Vec<ResearchEntry> {
    let conn = match open_db() {
        Some(c) => c,
        None => return vec![],
    };
    let mut stmt = match conn.prepare(
        "SELECT id, query, results, source, created_at FROM research_log ORDER BY created_at DESC LIMIT ?1",
    ) {
        Ok(s) => s,
        Err(_) => return vec![],
    };
    stmt.query_map(params![limit as i64], |row| {
        Ok(ResearchEntry {
            id: row.get(0)?,
            query: row.get(1)?,
            results: row.get(2)?,
            source: row.get(3)?,
            created_at: row.get(4)?,
        })
    })
    .ok()
    .map(|rows| rows.flatten().collect())
    .unwrap_or_default()
}

/// Format recent research as a concise context string for system prompts.
pub fn research_context_for_prompt() -> String {
    let entries = get_recent_research(3);
    if entries.is_empty() {
        return String::new();
    }

    let lines: Vec<String> = entries
        .iter()
        .map(|e| {
            let dt = chrono::DateTime::from_timestamp(e.created_at, 0)
                .map(|d| d.with_timezone(&chrono::Local).format("%-H:%M").to_string())
                .unwrap_or_else(|| "?".to_string());
            let snippet = crate::safe_slice(&e.results, 300);
            format!("**[{}] {}**\n{}", dt, e.query, snippet)
        })
        .collect();

    let full = lines.join("\n\n");
    if full.len() > RESEARCH_CONTEXT_CHARS {
        let end = full.char_indices().nth(RESEARCH_CONTEXT_CHARS).map(|(i, _)| i).unwrap_or(full.len());
        format!("{}\n...(research log truncated)", &full[..end])
    } else {
        full
    }
}

// ---------------------------------------------------------------------------
// Topic extraction — no LLM call, pure heuristic
// ---------------------------------------------------------------------------

/// Extract up to 3 search queries from the current work context using multi-query expansion.
/// Generates a broader, a narrower, and a lateral variant per topic to maximise recall.
/// No LLM call — pure heuristic to keep this fast and free.
pub fn extract_research_queries(thread: &str, brain_ctx: &str) -> Vec<String> {
    let mut queries = Vec::new();

    // ── Core topic: first meaningful line of the active thread ──────────────
    let core_topic = if !thread.trim().is_empty() {
        thread
            .lines()
            .find(|l| l.trim().len() > 10)
            .unwrap_or("")
            .trim()
            .trim_start_matches('#')
            .trim_start_matches('*')
            .trim_end_matches('*')
            .trim()
            .to_string()
    } else {
        String::new()
    };

    if core_topic.len() >= 6 {
        let short = crate::safe_slice(&core_topic, 60);
        // Variant 1 (broad): topic + year for freshness
        queries.push(format!("{} 2025", short));
        // Variant 2 (narrower): best practices / implementation
        queries.push(format!("{} implementation best practices", short));
    }

    // ── Lateral: extract notable tech terms from brain/thread combined ──────
    let src = format!("{} {}", thread, brain_ctx);
    let stop: &[&str] = &[
        "this", "that", "with", "from", "have", "been", "they", "your",
        "will", "when", "what", "blade", "user", "the", "and", "for",
        "are", "was", "has", "its", "into", "all", "can", "you",
    ];
    let tech_words: Vec<&str> = src
        .split_whitespace()
        .filter(|w| {
            let clean = w.trim_matches(|c: char| !c.is_alphanumeric());
            let first = clean.chars().next().unwrap_or(' ');
            first.is_uppercase()
                && clean.len() >= 4
                && !stop.contains(&clean.to_lowercase().as_str())
        })
        .take(5)
        .collect();

    if tech_words.len() >= 2 && queries.len() < 3 {
        let term = tech_words[..tech_words.len().min(3)].join(" ");
        queries.push(format!("{} alternative tools 2025", term));
    }

    queries
}

// ---------------------------------------------------------------------------
// Main research cycle
// ---------------------------------------------------------------------------

/// Run a single research cycle. Called from the evolution loop every 15 min,
/// but internally throttled to 30 min to avoid burning API quota.
pub async fn run_research_cycle(app: &tauri::AppHandle) {
    // Throttle
    let now = chrono::Utc::now().timestamp();
    if let Some(last) = last_research_at() {
        if now - last < RESEARCH_THROTTLE_SECS {
            return;
        }
    }

    // Get context
    let thread = crate::thread::get_active_thread().unwrap_or_default();
    let brain_ctx = {
        let db_path = crate::config::blade_config_dir().join("blade.db");
        rusqlite::Connection::open(&db_path)
            .map(|c| crate::db::brain_build_context(&c, 150))
            .unwrap_or_default()
    };

    let queries = extract_research_queries(&thread, &brain_ctx);
    if queries.is_empty() {
        return;
    }

    let mut researched: Vec<String> = Vec::new();

    for query in queries.iter().take(3) {
        let (results_str, is_err) = crate::native_tools::execute(
            "blade_search_web",
            &serde_json::json!({ "query": query, "max_results": 4 }),
            None,
        )
        .await;

        if !is_err && results_str.len() > 80 {
            if save_research(query, &results_str, "auto") {
                researched.push(query.clone());

                // Also push to activity timeline so it shows up in briefings/pulse
                let db_path = crate::config::blade_config_dir().join("blade.db");
                if let Ok(conn) = rusqlite::Connection::open(&db_path) {
                    let _ = crate::db::timeline_record(
                        &conn,
                        "research",
                        &format!("Researched: {}", crate::safe_slice(&query, 60)),
                        crate::safe_slice(&results_str, 600),
                        "BLADE",
                        "{}",
                    );
                }
            }
        }
    }

    if !researched.is_empty() {
        log::info!("[research] Completed: {:?}", researched);
        let _ = app.emit_to("main", "blade_research_update",
            serde_json::json!({ "queries": researched }),
        );
    }
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

/// Get recent research entries for the frontend
#[tauri::command]
pub fn research_get_recent(limit: Option<usize>) -> Vec<ResearchEntry> {
    get_recent_research(limit.unwrap_or(10))
}

/// Trigger a manual research cycle on a specific query
#[tauri::command]
pub async fn research_query(query: String) -> Result<String, String> {
    let (results, is_err) = crate::native_tools::execute(
        "blade_search_web",
        &serde_json::json!({ "query": &query, "max_results": 5 }),
        None,
    )
    .await;

    if is_err {
        return Err(results);
    }

    save_research(&query, &results, "manual");

    Ok(results)
}

/// Clear old research entries (older than N days)
#[tauri::command]
pub fn research_clear(older_than_days: Option<i64>) -> Result<usize, String> {
    let conn = open_db().ok_or("DB unavailable")?;
    let cutoff =
        chrono::Utc::now().timestamp() - older_than_days.unwrap_or(7) * 86400;
    let deleted = conn
        .execute(
            "DELETE FROM research_log WHERE created_at < ?1",
            params![cutoff],
        )
        .map_err(|e| e.to_string())?;
    Ok(deleted)
}
