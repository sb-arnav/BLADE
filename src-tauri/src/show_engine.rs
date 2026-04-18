/// SHOW ENGINE — BLADE proactively opens windows to show you things.
///
/// Not a notification. Not a toast. BLADE literally opens an overlay with
/// content — a screenshot, a code diff, a document, a card — because it
/// learned you want to see it in this situation.
///
/// Learning loop:
///   1. User asks "show me the PR" during CI failure → recorded
///   2. User asks again next CI failure → pattern strengthened
///   3. Third time → pattern graduates to auto-show
///   4. BLADE auto-opens the PR on CI failure without being asked
///   5. User dismisses → confidence drops. 2 dismissals → stop showing.
///
/// Show types:
///   - "card": proactive insight/task/focus card
///   - "document": file/PR/page content
///   - "screenshot": past screen capture
///   - "status": vital signs, organ status, hive digest
///   - "diff": code changes
///   - "transcript": meeting notes

use serde::{Deserialize, Serialize};
use rusqlite::params;
use tauri::{Emitter, Manager};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShowPattern {
    pub id: String,
    pub trigger: String,        // "ci_failure" | "slack_mention" | "meeting_start" | "error_detected"
    pub show_type: String,      // "card" | "document" | "screenshot" | "status" | "diff" | "transcript"
    pub content_query: String,  // what to show (e.g. "latest PR", "CI logs", "meeting transcript")
    pub times_requested: i32,   // how many times user manually asked for this
    pub times_auto_shown: i32,  // how many times BLADE showed it automatically
    pub times_dismissed: i32,   // how many times user dismissed auto-show
    pub auto_show: bool,        // graduated to auto-show (times_requested >= 3)
    pub suppressed: bool,       // user dismissed 2+ times → stop auto-showing
    pub created_at: i64,
    pub last_triggered: i64,
}

fn db_path() -> std::path::PathBuf {
    crate::config::blade_config_dir().join("blade.db")
}

fn ensure_table() {
    if let Ok(conn) = rusqlite::Connection::open(db_path()) {
        let _ = conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS show_patterns (
                id TEXT PRIMARY KEY,
                trigger TEXT NOT NULL,
                show_type TEXT NOT NULL,
                content_query TEXT NOT NULL,
                times_requested INTEGER DEFAULT 0,
                times_auto_shown INTEGER DEFAULT 0,
                times_dismissed INTEGER DEFAULT 0,
                auto_show INTEGER DEFAULT 0,
                suppressed INTEGER DEFAULT 0,
                created_at INTEGER NOT NULL,
                last_triggered INTEGER NOT NULL
            );"
        );
    }
}

/// Record that the user manually asked to see something in a context.
/// After 3 requests in the same context, it graduates to auto-show.
pub fn record_show_request(trigger: &str, show_type: &str, content_query: &str) {
    ensure_table();
    let conn = match rusqlite::Connection::open(db_path()) {
        Ok(c) => c,
        Err(_) => return,
    };

    let now = chrono::Utc::now().timestamp();
    let id = format!("{}:{}", trigger, show_type);

    // Upsert
    let existing: Option<i32> = conn.query_row(
        "SELECT times_requested FROM show_patterns WHERE id = ?1",
        params![id],
        |row| row.get(0),
    ).ok();

    if let Some(count) = existing {
        let new_count = count + 1;
        let auto = new_count >= 3;
        let _ = conn.execute(
            "UPDATE show_patterns SET times_requested = ?1, auto_show = ?2, last_triggered = ?3, suppressed = 0 WHERE id = ?4",
            params![new_count, auto as i32, now, id],
        );
    } else {
        let _ = conn.execute(
            "INSERT INTO show_patterns (id, trigger, show_type, content_query, times_requested, created_at, last_triggered)
             VALUES (?1, ?2, ?3, ?4, 1, ?5, ?5)",
            params![id, trigger, show_type, content_query, now],
        );
    }
}

/// Record that user dismissed an auto-shown item. 2 dismissals → suppress.
pub fn record_dismissal(trigger: &str, show_type: &str) {
    ensure_table();
    let conn = match rusqlite::Connection::open(db_path()) {
        Ok(c) => c,
        Err(_) => return,
    };

    let id = format!("{}:{}", trigger, show_type);
    let _ = conn.execute(
        "UPDATE show_patterns SET times_dismissed = times_dismissed + 1,
         suppressed = CASE WHEN times_dismissed + 1 >= 2 THEN 1 ELSE 0 END
         WHERE id = ?1",
        params![id],
    );
}

/// Check if a trigger should auto-show something. Returns the pattern if yes.
pub fn should_auto_show(trigger: &str) -> Vec<ShowPattern> {
    ensure_table();
    let conn = match rusqlite::Connection::open(db_path()) {
        Ok(c) => c,
        Err(_) => return vec![],
    };

    let mut stmt = match conn.prepare(
        "SELECT id, trigger, show_type, content_query, times_requested, times_auto_shown,
                times_dismissed, auto_show, suppressed, created_at, last_triggered
         FROM show_patterns WHERE trigger = ?1 AND auto_show = 1 AND suppressed = 0"
    ) {
        Ok(s) => s,
        Err(_) => return vec![],
    };

    stmt.query_map(params![trigger], |row| {
        Ok(ShowPattern {
            id: row.get(0)?,
            trigger: row.get(1)?,
            show_type: row.get(2)?,
            content_query: row.get(3)?,
            times_requested: row.get(4)?,
            times_auto_shown: row.get(5)?,
            times_dismissed: row.get(6)?,
            auto_show: row.get::<_, i32>(7)? != 0,
            suppressed: row.get::<_, i32>(8)? != 0,
            created_at: row.get(9)?,
            last_triggered: row.get(10)?,
        })
    })
    .ok()
    .map(|rows| rows.filter_map(|r| r.ok()).collect())
    .unwrap_or_default()
}

/// Trigger auto-show for a given context. Called by hive, godmode, proactive_vision.
/// Emits "blade_auto_show" event with the content for the frontend to render.
pub async fn trigger_auto_show(app: &tauri::AppHandle, trigger: &str) {
    let patterns = should_auto_show(trigger);
    if patterns.is_empty() { return; }

    for pattern in &patterns {
        // Build the content to show based on show_type
        let content = match pattern.show_type.as_str() {
            "status" => {
                let vitals = crate::cardiovascular::check_vital_signs();
                serde_json::to_string(&vitals).unwrap_or_default()
            }
            "transcript" => {
                crate::dna::get_recent_audio_context()
            }
            "diff" | "document" => {
                // Use the content_query to search
                let results = crate::file_indexer::search_files(&pattern.content_query, None, 3);
                results.iter()
                    .map(|f| format!("{} ({})", f.filename, f.path))
                    .collect::<Vec<_>>()
                    .join("\n")
            }
            "screenshot" => {
                // Get the latest screen description
                crate::perception_fusion::get_latest()
                    .map(|p| p.screen_ocr_text.clone())
                    .unwrap_or_default()
            }
            _ => pattern.content_query.clone(),
        };

        let _ = app.emit_to("main", "blade_auto_show", serde_json::json!({
            "trigger": trigger,
            "show_type": pattern.show_type,
            "content_query": pattern.content_query,
            "content": content,
            "times_shown": pattern.times_auto_shown + 1,
            "pattern_id": pattern.id,
        }));

        // Increment auto_shown count
        if let Ok(conn) = rusqlite::Connection::open(db_path()) {
            let now = chrono::Utc::now().timestamp();
            let _ = conn.execute(
                "UPDATE show_patterns SET times_auto_shown = times_auto_shown + 1, last_triggered = ?1 WHERE id = ?2",
                params![now, pattern.id],
            );
        }
    }
}

/// Seed default show patterns — things BLADE should learn to show.
/// Called from skeleton init. These start with times_requested = 0
/// and won't auto-show until the user requests them 3 times.
pub fn seed_defaults() {
    ensure_table();
    let conn = match rusqlite::Connection::open(db_path()) {
        Ok(c) => c,
        Err(_) => return,
    };

    let defaults = [
        ("ci_failure", "diff", "failing CI logs and error"),
        ("ci_failure", "document", "the PR that caused the failure"),
        ("slack_mention", "card", "Slack message summary"),
        ("meeting_start", "transcript", "meeting prep notes"),
        ("meeting_end", "card", "action items from meeting"),
        ("error_detected", "screenshot", "the error on screen"),
        ("morning", "status", "morning briefing with vital signs"),
    ];

    let now = chrono::Utc::now().timestamp();
    for (trigger, show_type, query) in defaults {
        let id = format!("{}:{}", trigger, show_type);
        let _ = conn.execute(
            "INSERT OR IGNORE INTO show_patterns (id, trigger, show_type, content_query, created_at, last_triggered)
             VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
            params![id, trigger, show_type, query, now],
        );
    }
}

// ── Tauri Commands ───────────────────────────────────────────────────────────

#[tauri::command]
pub fn show_record_request(trigger: String, show_type: String, content_query: String) {
    record_show_request(&trigger, &show_type, &content_query);
}

#[tauri::command]
pub fn show_dismiss(trigger: String, show_type: String) {
    record_dismissal(&trigger, &show_type);
}

#[tauri::command]
pub fn show_get_patterns() -> Vec<ShowPattern> {
    ensure_table();
    let conn = match rusqlite::Connection::open(db_path()) {
        Ok(c) => c,
        Err(_) => return vec![],
    };
    let mut stmt = match conn.prepare(
        "SELECT id, trigger, show_type, content_query, times_requested, times_auto_shown,
                times_dismissed, auto_show, suppressed, created_at, last_triggered
         FROM show_patterns ORDER BY times_requested DESC"
    ) {
        Ok(s) => s,
        Err(_) => return vec![],
    };
    stmt.query_map([], |row| {
        Ok(ShowPattern {
            id: row.get(0)?,
            trigger: row.get(1)?,
            show_type: row.get(2)?,
            content_query: row.get(3)?,
            times_requested: row.get(4)?,
            times_auto_shown: row.get(5)?,
            times_dismissed: row.get(6)?,
            auto_show: row.get::<_, i32>(7)? != 0,
            suppressed: row.get::<_, i32>(8)? != 0,
            created_at: row.get(9)?,
            last_triggered: row.get(10)?,
        })
    })
    .ok()
    .map(|rows| rows.filter_map(|r| r.ok()).collect())
    .unwrap_or_default()
}
