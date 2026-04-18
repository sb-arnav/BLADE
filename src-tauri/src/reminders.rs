// src-tauri/src/reminders.rs
// BLADE Reminders — time-based alerts with full context.
//
// Users can set reminders through conversation ("remind me about X in 30min")
// or through the UI. Reminders fire as OS notifications + TTS + Discord.
// Stored in SQLite, survive restarts.
//
// BLADE's AI can also extract reminder intent from conversation automatically
// via extract_reminder_from_message() — called after each assistant response.

use rusqlite::params;
use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager};

// ── DB helpers ────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Reminder {
    pub id: String,
    pub title: String,
    pub note: String,
    pub fire_at: i64, // unix timestamp
    pub fired: bool,
    pub created_at: i64,
}

fn open_db() -> Result<rusqlite::Connection, String> {
    let db_path = crate::config::blade_config_dir().join("blade.db");
    rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())
}

fn ensure_table(conn: &rusqlite::Connection) -> Result<(), rusqlite::Error> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS reminders (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            note TEXT NOT NULL DEFAULT '',
            fire_at INTEGER NOT NULL,
            fired INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_reminders_fire_at ON reminders(fire_at) WHERE fired = 0;"
    )
}

pub fn list_pending() -> Vec<Reminder> {
    let Ok(conn) = open_db() else { return vec![] };
    let _ = ensure_table(&conn);
    let Ok(mut stmt) = conn.prepare(
        "SELECT id, title, note, fire_at, fired, created_at FROM reminders WHERE fired = 0 ORDER BY fire_at ASC"
    ) else { return vec![] };

    stmt.query_map([], |row| {
        Ok(Reminder {
            id: row.get(0)?,
            title: row.get(1)?,
            note: row.get(2)?,
            fire_at: row.get(3)?,
            fired: row.get::<_, i64>(4)? != 0,
            created_at: row.get(5)?,
        })
    })
    .map(|rows| rows.flatten().collect())
    .unwrap_or_default()
}

fn mark_fired(conn: &rusqlite::Connection, id: &str) {
    let _ = conn.execute("UPDATE reminders SET fired = 1 WHERE id = ?1", params![id]);
}

// ── Background loop ───────────────────────────────────────────────────────────

pub fn start_reminder_loop(app: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(30)).await;

            let now = chrono::Utc::now().timestamp();
            let due: Vec<Reminder> = list_pending()
                .into_iter()
                .filter(|r| r.fire_at <= now)
                .collect();

            for reminder in due {
                fire_reminder(&app, &reminder).await;
            }
        }
    });
}

async fn fire_reminder(app: &tauri::AppHandle, reminder: &Reminder) {
    // Mark fired first to avoid double-fire
    if let Ok(conn) = open_db() {
        let _ = ensure_table(&conn);
        mark_fired(&conn, &reminder.id);
    }

    // OS notification
    {
        use tauri_plugin_notification::NotificationExt;
        let body = if reminder.note.is_empty() {
            reminder.title.clone()
        } else {
            format!("{}\n{}", reminder.title, crate::safe_slice(&reminder.note, 100))
        };
        let _ = app.notification()
            .builder()
            .title("BLADE Reminder")
            .body(body)
            .show();
    }

    // Emit to frontend
    let _ = app.emit("blade_reminder_fired", serde_json::json!({
        "id": &reminder.id,
        "title": &reminder.title,
        "note": &reminder.note,
        "timestamp": chrono::Utc::now().timestamp(),
    }));

    // TTS
    let spoken = if reminder.note.is_empty() {
        format!("Reminder: {}", reminder.title)
    } else {
        format!("Reminder: {}. {}", reminder.title, reminder.note)
    };
    crate::tts::speak(&spoken);

    // Discord
    let discord_msg = format!("**Reminder:** {}\n{}", reminder.title, reminder.note);
    let discord_clone = discord_msg.clone();
    tauri::async_runtime::spawn(async move {
        crate::discord::post_to_discord(&discord_clone, true, 0x57F287).await; // green
    });

    // Timeline
    if let Ok(conn) = open_db() {
        let _ = crate::db::timeline_record(
            &conn,
            "reminder",
            &reminder.title,
            &reminder.note,
            "BLADE",
            "{}",
        );
    }

    log::info!("[reminders] fired: {}", reminder.title);
}

// ── Natural language time parser ──────────────────────────────────────────────

/// Parse simple relative time expressions like "30 minutes", "2 hours", "tomorrow 9am".
/// Returns unix timestamp or None if unparseable.
pub fn parse_time_expression(expr: &str) -> Option<i64> {
    let lower = expr.to_lowercase();
    let now = chrono::Utc::now().timestamp();

    // "in X minutes/hours/days"
    if let Some(mins) = extract_quantity_unit(&lower, &["minute", "min", "m"]) {
        return Some(now + mins * 60);
    }
    if let Some(hours) = extract_quantity_unit(&lower, &["hour", "hr", "h"]) {
        return Some(now + hours * 3600);
    }
    if let Some(days) = extract_quantity_unit(&lower, &["day", "d"]) {
        return Some(now + days * 86400);
    }

    // "tomorrow" → next day 09:00
    if lower.contains("tomorrow") {
        let tomorrow = chrono::Local::now()
            .date_naive()
            .succ_opt()?
            .and_hms_opt(9, 0, 0)?;
        let ts = tomorrow.and_local_timezone(chrono::Local).single()?.timestamp();
        return Some(ts);
    }

    // "tonight" → today 20:00
    if lower.contains("tonight") {
        let tonight = chrono::Local::now()
            .date_naive()
            .and_hms_opt(20, 0, 0)?;
        let ts = tonight.and_local_timezone(chrono::Local).single()?.timestamp();
        return Some(ts);
    }

    None
}

fn extract_quantity_unit(text: &str, unit_variants: &[&str]) -> Option<i64> {
    // Match patterns: "30 minutes", "in 30 minutes", "30min", "2h"
    for unit in unit_variants {
        // Try "NUMBER unit"
        for part in text.split_whitespace() {
            if part.ends_with(unit) {
                let num_str = part.trim_end_matches(unit);
                if let Ok(n) = num_str.parse::<i64>() {
                    return Some(n);
                }
            }
        }
        // Try "NUMBER" before "unit"
        let words: Vec<&str> = text.split_whitespace().collect();
        for (i, word) in words.iter().enumerate() {
            if word.starts_with(unit) || *word == *unit {
                if i > 0 {
                    if let Ok(n) = words[i - 1].parse::<i64>() {
                        return Some(n);
                    }
                }
            }
        }
    }
    None
}

// ── Intent extraction ─────────────────────────────────────────────────────────

/// Scan a conversation exchange for implicit reminder intent.
/// If the user expressed a time-bound commitment ("I need to call X tomorrow",
/// "don't let me forget to…", "remind me to…"), silently create a reminder.
/// Returns the reminder ID if one was created, or None.
pub async fn extract_reminder_from_message(
    app: &tauri::AppHandle,
    user_text: &str,
) -> Option<String> {
    // Quick regex pre-filter to avoid LLM calls on every message.
    // Only invoke AI when the text looks like it contains time or reminder language.
    let lower = user_text.to_lowercase();
    let has_time_signal = [
        "remind", "reminder", "don't forget", "dont forget", "remember to",
        "tomorrow", "tonight", "next week", "in an hour", "in a minute",
        "later today", "this evening", "by end of day", "by eod", "by monday",
        "by tuesday", "by wednesday", "by thursday", "by friday",
        "at noon", "at midnight", "in 30", "in 15", "need to call", "need to email",
        "need to send", "have to follow up", "follow up with", "check in with",
        "schedule", "meeting at", "appointment at",
    ].iter().any(|kw| lower.contains(kw));

    if !has_time_signal {
        return None;
    }

    let config = crate::config::load_config();
    if config.api_key.is_empty() && config.provider != "ollama" {
        return None;
    }

    // Short prompt to extract structured reminder intent
    let now = chrono::Local::now();
    let prompt = format!(
        r#"Extract reminder intent from this user message. Current time: {}.

Message: "{}"

If the user expressed intent to be reminded about something or has a time-bound commitment, respond with EXACTLY this JSON format (no markdown, no explanation):
{{"title": "short action", "note": "optional detail", "time_expression": "when"}}

time_expression must be one of: "X minutes", "X hours", "X days", "tomorrow", "tonight"

If there is NO clear reminder intent, respond with exactly: null"#,
        now.format("%H:%M on %A %B %d"),
        user_text.chars().take(500).collect::<String>()
    );

    use crate::providers::{self, ConversationMessage};
    let messages = vec![ConversationMessage::User(prompt)];
    let model = crate::config::cheap_model_for_provider(&config.provider, &config.model);

    let Ok(turn) = providers::complete_turn(
        &config.provider,
        &config.api_key,
        &model,
        &messages,
        &[],
        config.base_url.as_deref(),
    ).await else { return None; };

    let raw = turn.content.trim();
    if raw == "null" || raw.is_empty() {
        return None;
    }

    // Parse the JSON response
    let Ok(val) = serde_json::from_str::<serde_json::Value>(raw) else {
        return None;
    };

    let title = val["title"].as_str()?.to_string();
    let note = val["note"].as_str().unwrap_or("").to_string();
    let time_expr = val["time_expression"].as_str()?.to_string();

    if title.is_empty() || time_expr.is_empty() {
        return None;
    }

    match reminder_add_natural(title.clone(), note, time_expr) {
        Ok(id) => {
            // Silently emit so UI can surface a toast — don't interrupt with TTS
            use tauri::{Emitter, Manager};
            let _ = app.emit_to("main", "blade_reminder_created", serde_json::json!({
                "id": &id,
                "title": &title,
                "source": "auto_extract",
            }));
            log::info!("[reminders] auto-extracted reminder: {} (id: {})", title, id);
            Some(id)
        }
        Err(e) => {
            log::debug!("[reminders] auto-extract failed to create: {}", e);
            None
        }
    }
}

// ── Tauri commands ────────────────────────────────────────────────────────────

#[tauri::command]
pub fn reminder_add(title: String, note: String, fire_at: i64) -> Result<String, String> {
    if title.trim().is_empty() {
        return Err("Reminder title cannot be empty".to_string());
    }
    if fire_at <= chrono::Utc::now().timestamp() {
        return Err("Reminder time must be in the future".to_string());
    }

    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().timestamp();
    let conn = open_db()?;
    ensure_table(&conn).map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO reminders (id, title, note, fire_at, fired, created_at) VALUES (?1, ?2, ?3, ?4, 0, ?5)",
        params![id, title.trim(), note.trim(), fire_at, now],
    ).map_err(|e| e.to_string())?;

    Ok(id)
}

#[tauri::command]
pub fn reminder_add_natural(
    title: String,
    note: String,
    time_expression: String,
) -> Result<String, String> {
    let fire_at = parse_time_expression(&time_expression)
        .ok_or_else(|| format!("Couldn't understand time '{}'. Try '30 minutes' or '2 hours'.", time_expression))?;

    reminder_add(title, note, fire_at)
}

#[tauri::command]
pub fn reminder_list() -> Vec<Reminder> {
    list_pending()
}

#[tauri::command]
pub fn reminder_delete(id: String) -> Result<(), String> {
    let conn = open_db()?;
    ensure_table(&conn).map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM reminders WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn reminder_parse_time(expression: String) -> Option<i64> {
    parse_time_expression(&expression)
}
