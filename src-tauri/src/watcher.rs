// src-tauri/src/watcher.rs
// BLADE Resource Watcher — ambient intelligence for the web.
//
// BLADE periodically fetches URLs you care about, hashes the content,
// and fires an alert (UI event + Discord + TTS) when something changes.
//
// Use cases:
//   - Watch your production URL for downtime
//   - Watch a competitor pricing page for changes
//   - Watch a GitHub release page for new versions
//   - Watch any URL that matters to you
//
// Content is hashed with FNV-1a so we only alert on actual changes.
// The AI is asked to summarise *what* changed (not just "it changed").

use rusqlite::params;
use serde::{Deserialize, Serialize};
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use tauri::Emitter;

// ── Row type ──────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Watcher {
    pub id: String,
    pub url: String,
    pub label: String,
    pub interval_mins: i64,
    pub last_content_hash: String,
    pub last_checked: i64,
    pub last_changed: i64,
    pub active: bool,
    pub created_at: i64,
}

// ── DB helpers ────────────────────────────────────────────────────────────────

fn open_db() -> Result<rusqlite::Connection, String> {
    let db_path = crate::config::blade_config_dir().join("blade.db");
    rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())
}

pub fn watcher_list() -> Vec<Watcher> {
    let Ok(conn) = open_db() else { return vec![] };
    let Ok(mut stmt) = conn.prepare(
        "SELECT id, url, label, interval_mins, last_content_hash, last_checked, last_changed, active, created_at FROM watchers ORDER BY created_at DESC"
    ) else { return vec![] };

    stmt.query_map([], |row| {
        Ok(Watcher {
            id: row.get(0)?,
            url: row.get(1)?,
            label: row.get(2)?,
            interval_mins: row.get(3)?,
            last_content_hash: row.get(4)?,
            last_checked: row.get(5)?,
            last_changed: row.get(6)?,
            active: row.get::<_, i64>(7)? != 0,
            created_at: row.get(8)?,
        })
    })
    .map(|rows| rows.flatten().collect())
    .unwrap_or_default()
}

fn watcher_update_hash(conn: &rusqlite::Connection, id: &str, hash: &str, now: i64, changed: bool) {
    let _ = conn.execute(
        "UPDATE watchers SET last_content_hash = ?1, last_checked = ?2, last_changed = CASE WHEN ?3 THEN ?2 ELSE last_changed END WHERE id = ?4",
        params![hash, now, changed as i64, id],
    );
}

// ── Content fetching + hashing ────────────────────────────────────────────────

async fn fetch_content(client: &reqwest::Client, url: &str) -> Result<String, String> {
    let resp = client
        .get(url)
        .timeout(std::time::Duration::from_secs(15))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let status = resp.status();
    let body = resp.text().await.map_err(|e| e.to_string())?;

    if !status.is_success() {
        return Err(format!("HTTP {}", status));
    }

    // Strip HTML tags + collapse whitespace for stable diffing
    Ok(strip_html_fast(&body))
}

/// Fast FNV-1a hash of a string — no crypto needed, just change detection.
fn content_hash(s: &str) -> String {
    let mut hasher = DefaultHasher::new();
    s.hash(&mut hasher);
    format!("{:x}", hasher.finish())
}

fn strip_html_fast(html: &str) -> String {
    let mut out = String::with_capacity(html.len() / 2);
    let mut in_tag = false;
    let mut prev_space = false;

    for ch in html.chars() {
        match ch {
            '<' => { in_tag = true; }
            '>' => { in_tag = false; out.push(' '); prev_space = true; }
            _ if in_tag => {}
            '\n' | '\r' | '\t' | ' ' => {
                if !prev_space { out.push(' '); prev_space = true; }
            }
            other => { out.push(other); prev_space = false; }
        }
    }

    out.trim().to_string()
}

// ── AI change summary ─────────────────────────────────────────────────────────

async fn summarise_change(
    config: &crate::config::BladeConfig,
    url: &str,
    label: &str,
    new_content: &str,
) -> String {
    if config.api_key.is_empty() && config.provider != "ollama" {
        return format!("Content changed at {}", url);
    }

    let preview = &new_content[..new_content.len().min(2000)];
    let prompt = format!(
        "The webpage at {} ({}) has changed. Here is the current content (truncated):\n\n{}\n\nIn one or two concise sentences, describe the most notable change or what this page currently shows. Be specific.",
        url,
        if label.is_empty() { "watched URL" } else { label },
        preview
    );

    let conv = vec![
        crate::providers::ConversationMessage::System(
            "You are a concise change analyst. Summarise webpage changes in 1-2 sentences.".to_string()
        ),
        crate::providers::ConversationMessage::User(prompt),
    ];

    let model = cheapest_model(&config.provider, &config.model);
    match crate::providers::complete_turn(&config.provider, &config.api_key, &model, &conv, &[], config.base_url.as_deref()).await {
        Ok(turn) => turn.content,
        Err(_) => format!("Content at {} has changed.", url),
    }
}

fn cheapest_model(provider: &str, fallback: &str) -> String {
    match provider {
        "anthropic" => "claude-haiku-4-5-20251001".to_string(),
        "openai" => "gpt-4o-mini".to_string(),
        "gemini" => "gemini-2.0-flash".to_string(),
        "groq" => "llama-3.1-8b-instant".to_string(),
        _ => fallback.to_string(),
    }
}

// ── Background polling loop ───────────────────────────────────────────────────

pub fn start_watcher_loop(app: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        // First check 2 minutes after startup — don't hammer on boot
        tokio::time::sleep(std::time::Duration::from_secs(120)).await;

        let client = reqwest::Client::builder()
            .user_agent("Mozilla/5.0 (compatible; BLADE/1.0)")
            .build()
            .unwrap_or_else(|_| reqwest::Client::new());

        loop {
            let now = chrono::Utc::now().timestamp();
            let watchers = watcher_list();

            for w in watchers {
                if !w.active {
                    continue;
                }

                let due_at = w.last_checked + w.interval_mins * 60;
                if now < due_at {
                    continue;
                }

                // Fetch current content
                let content = match fetch_content(&client, &w.url).await {
                    Ok(c) => c,
                    Err(e) => {
                        log::warn!("[watcher] fetch failed for {}: {}", w.url, e);
                        continue;
                    }
                };

                let new_hash = content_hash(&content);
                let changed = !w.last_content_hash.is_empty() && new_hash != w.last_content_hash;
                let is_first_check = w.last_content_hash.is_empty();

                // Update the stored hash regardless
                if let Ok(conn) = open_db() {
                    watcher_update_hash(&conn, &w.id, &new_hash, now, changed);
                }

                if changed {
                    let config = crate::config::load_config();
                    let summary = summarise_change(&config, &w.url, &w.label, &content).await;

                    let label = if w.label.is_empty() { w.url.clone() } else { w.label.clone() };
                    let alert = format!("Change detected: {}\n\n{}", label, summary);

                    // Emit to frontend
                    let _ = app.emit(
                        "watcher_alert",
                        serde_json::json!({
                            "watcher_id": &w.id,
                            "url": &w.url,
                            "label": &label,
                            "summary": &summary,
                            "timestamp": now,
                        }),
                    );

                    // OS notification (works even when window is hidden)
                    use tauri_plugin_notification::NotificationExt;
                    let _ = app.notification()
                        .builder()
                        .title(format!("BLADE Watch: {}", &label[..label.len().min(40)]))
                        .body(summary.clone())
                        .show();

                    // Speak it
                    crate::tts::speak(&format!("Alert: {}. {}", label, summary));

                    // Discord
                    let discord_msg = format!("**Watch Alert: {}**\n{}\n<{}>", label, summary, w.url);
                    let discord_msg_clone = discord_msg.clone();
                    tauri::async_runtime::spawn(async move {
                        crate::discord::post_to_discord(&discord_msg_clone, true, 0xFF6B35).await;
                    });

                    // Timeline
                    if let Ok(conn) = open_db() {
                        let _ = crate::db::timeline_record(
                            &conn,
                            "watcher_alert",
                            &format!("Change: {}", &label[..label.len().min(60)]),
                            &alert,
                            &w.url,
                            "{}",
                        );
                    }

                    log::info!("[watcher] change detected at {}: {}", w.url, summary);
                } else if is_first_check {
                    log::info!("[watcher] baseline captured for {}", w.url);
                }
            }

            // Check every 60 seconds for due watchers
            tokio::time::sleep(std::time::Duration::from_secs(60)).await;
        }
    });
}

// ── Tauri commands ────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn watcher_add(url: String, label: String, interval_mins: Option<i64>) -> Result<String, String> {
    let url = url.trim().to_string();
    if url.is_empty() {
        return Err("URL cannot be empty".to_string());
    }
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Err("URL must start with http:// or https://".to_string());
    }

    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().timestamp();
    let mins = interval_mins.unwrap_or(30).clamp(5, 1440);

    let conn = open_db()?;
    conn.execute(
        "INSERT INTO watchers (id, url, label, interval_mins, last_content_hash, last_checked, last_changed, active, created_at) VALUES (?1, ?2, ?3, ?4, '', 0, 0, 1, ?5)",
        params![id, url, label, mins, now],
    ).map_err(|e| e.to_string())?;

    Ok(id)
}

#[tauri::command]
pub fn watcher_list_all() -> Vec<Watcher> {
    watcher_list()
}

#[tauri::command]
pub fn watcher_remove(id: String) -> Result<(), String> {
    let conn = open_db()?;
    conn.execute("DELETE FROM watchers WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn watcher_toggle(id: String, active: bool) -> Result<(), String> {
    let conn = open_db()?;
    conn.execute(
        "UPDATE watchers SET active = ?1 WHERE id = ?2",
        params![active as i64, id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}
