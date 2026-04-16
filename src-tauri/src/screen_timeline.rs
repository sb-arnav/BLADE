/// BLADE Total Recall — Screen Timeline
///
/// Every N seconds BLADE captures a screenshot, fingerprints it (identical frames
/// are skipped), saves a JPEG + thumbnail to disk, asynchronously describes it with
/// a vision model, and embeds the description for semantic search.
///
/// "What error was I debugging 20 minutes ago?" → exact screenshot.
/// This is Rewind.ai, open-source, cross-platform, living inside BLADE.

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine as _;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{Emitter, Manager};

/// Flag set by the capture loop when a context switch is detected.
/// capture_timeline_tick checks this to decide whether to run the expensive
/// vision model call or just save the JPEG cheaply.
static DESCRIBE_NEXT_FRAME: AtomicBool = AtomicBool::new(true); // true on first frame

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScreenTimelineEntry {
    pub id: i64,
    pub timestamp: i64,
    pub screenshot_path: String,
    pub thumbnail_path: String,
    pub window_title: String,
    pub app_name: String,
    pub description: String,
    pub fingerprint: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimelineConfig {
    pub enabled: bool,
    pub capture_interval_secs: u32,
    pub retention_days: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimelineStats {
    pub total_entries: i64,
    pub disk_bytes: u64,
    pub oldest_timestamp: Option<i64>,
    pub newest_timestamp: Option<i64>,
}

// ---------------------------------------------------------------------------
// Storage paths
// ---------------------------------------------------------------------------

fn screenshots_dir() -> PathBuf {
    crate::config::blade_config_dir().join("screenshots")
}

fn db_path() -> PathBuf {
    crate::config::blade_config_dir().join("blade.db")
}

fn open_db() -> Option<rusqlite::Connection> {
    rusqlite::Connection::open(db_path()).ok()
}

fn day_dir(timestamp: i64) -> PathBuf {
    let dt = chrono::DateTime::from_timestamp(timestamp, 0)
        .unwrap_or_else(chrono::Utc::now);
    let local = dt.with_timezone(&chrono::Local);
    screenshots_dir().join(local.format("%Y-%m-%d").to_string())
}

fn frame_filename(timestamp: i64) -> String {
    let dt = chrono::DateTime::from_timestamp(timestamp, 0)
        .unwrap_or_else(chrono::Utc::now);
    let local = dt.with_timezone(&chrono::Local);
    local.format("%H-%M-%S").to_string()
}

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

fn insert_entry(
    conn: &rusqlite::Connection,
    timestamp: i64,
    screenshot_path: &str,
    thumbnail_path: &str,
    window_title: &str,
    app_name: &str,
    fingerprint: i64,
) -> Option<i64> {
    conn.execute(
        "INSERT INTO screen_timeline (timestamp, screenshot_path, thumbnail_path, window_title, app_name, description, fingerprint)
         VALUES (?1, ?2, ?3, ?4, ?5, '', ?6)",
        params![timestamp, screenshot_path, thumbnail_path, window_title, app_name, fingerprint],
    ).ok()?;
    Some(conn.last_insert_rowid())
}

fn update_description(conn: &rusqlite::Connection, id: i64, description: &str) {
    let _ = conn.execute(
        "UPDATE screen_timeline SET description = ?1 WHERE id = ?2",
        params![description, id],
    );
}

fn last_fingerprint() -> Option<i64> {
    let conn = open_db()?;
    conn.query_row(
        "SELECT fingerprint FROM screen_timeline ORDER BY timestamp DESC LIMIT 1",
        [],
        |row| row.get(0),
    ).ok()
}

// ---------------------------------------------------------------------------
// Caption / description
// ---------------------------------------------------------------------------

/// Ask the cheapest vision-capable model to describe the screenshot in 2-3 sentences.
async fn describe_screenshot(image_base64: &str) -> String {
    let config = crate::config::load_config();
    if config.api_key.is_empty() {
        return String::new();
    }

    let model = best_vision_model(&config.provider, &config.model);
    let prompt = "Describe what's visible on this screen in 2-3 sentences. \
                  Note: app names, file names, URLs, code, error messages, or important text you can see. \
                  Be concise and factual — no editorialising.";

    use crate::providers::ConversationMessage;
    let messages = vec![ConversationMessage::UserWithImage {
        text: prompt.to_string(),
        image_base64: image_base64.to_string(),
    }];

    match crate::providers::complete_turn(
        &config.provider,
        &config.api_key,
        &model,
        &messages,
        &[],
        config.base_url.as_deref(),
    )
    .await
    {
        Ok(turn) => turn.content.trim().to_string(),
        Err(_) => String::new(),
    }
}

/// Public wrapper for native_tools to describe a screenshot on demand.
pub async fn describe_screenshot_public(image_base64: &str) -> String {
    describe_screenshot(image_base64).await
}

fn best_vision_model(provider: &str, current: &str) -> String {
    crate::config::cheap_model_for_provider(provider, current)
}

// ---------------------------------------------------------------------------
// Embed + store in vector store
// ---------------------------------------------------------------------------

fn embed_timeline_entry(
    store: &crate::embeddings::SharedVectorStore,
    entry_id: i64,
    window_title: &str,
    app_name: &str,
    description: &str,
) {
    let text = format!(
        "{} | {} | {}",
        window_title.trim(),
        app_name.trim(),
        description.trim()
    );
    if text.trim_matches('|').trim().is_empty() {
        return;
    }
    match crate::embeddings::embed_texts(&[text.clone()]) {
        Ok(embeddings) => {
            if let Some(embedding) = embeddings.into_iter().next() {
                if let Ok(mut s) = store.lock() {
                    s.add(
                        text,
                        embedding,
                        "screen_timeline".to_string(),
                        entry_id.to_string(),
                    );
                }
            }
        }
        Err(e) => {
            eprintln!("[screen_timeline] embed failed: {}", e);
        }
    }
}

// ---------------------------------------------------------------------------
// Core capture tick
// ---------------------------------------------------------------------------

pub async fn capture_timeline_tick(app: &tauri::AppHandle) {
    let now = chrono::Utc::now().timestamp();

    // 1. Capture screen as JPEG
    // Omi uses H.264 video chunks for storage efficiency. We can't easily add
    // ffmpeg as a dependency (breaks CI on 3 platforms). Instead: use low quality
    // JPEG (30) for non-described frames (just for dedup, never shown to user),
    // and full quality (60) only on frames that get vision-described.
    let will_describe = DESCRIBE_NEXT_FRAME.load(std::sync::atomic::Ordering::Relaxed);
    let jpeg_quality = if will_describe { 60 } else { 25 };
    let (jpeg, thumb, _w, _h, fingerprint) =
        match crate::screen::capture_screen_as_jpeg(jpeg_quality) {
            Ok(v) => v,
            Err(e) => {
                eprintln!("[screen_timeline] capture failed: {}", e);
                return;
            }
        };

    // 2. Skip if screen hasn't changed (fingerprint dedup)
    let fp = fingerprint as i64;
    if last_fingerprint() == Some(fp) {
        return;
    }

    // 3. Get active window info
    let (window_title, app_name) = {
        match crate::context::get_active_window() {
            Ok(win) => (win.window_title, win.app_name),
            Err(_) => (String::new(), String::new()),
        }
    };

    // 4. Save JPEG + thumbnail to disk
    let day_dir = day_dir(now);
    if std::fs::create_dir_all(&day_dir).is_err() {
        return;
    }
    let base_name = frame_filename(now);
    let screenshot_path = day_dir.join(format!("{}.jpg", base_name));
    let thumbnail_path = day_dir.join(format!("{}_thumb.jpg", base_name));

    if std::fs::write(&screenshot_path, &jpeg).is_err() {
        return;
    }
    if std::fs::write(&thumbnail_path, &thumb).is_err() {
        return;
    }

    let screenshot_path_str = screenshot_path.to_string_lossy().to_string();
    let thumbnail_path_str = thumbnail_path.to_string_lossy().to_string();

    // 5. Insert DB row (description filled in async below)
    let entry_id = {
        let conn = match open_db() {
            Some(c) => c,
            None => return,
        };
        match insert_entry(
            &conn,
            now,
            &screenshot_path_str,
            &thumbnail_path_str,
            &window_title,
            &app_name,
            fp,
        ) {
            Some(id) => id,
            None => return,
        }
    };

    // 6. Emit to frontend so live timeline view can update
    let _ = app.emit(
        "timeline_tick",
        serde_json::json!({
            "id": entry_id,
            "timestamp": now,
            "window_title": &window_title,
            "app_name": &app_name,
        }),
    );
    // Notify HUD: screenshot taken (camera blink + blue screen flash)
    let _ = app.emit("screenshot_taken", ());

    // 7. Async: describe + embed
    // Omi approach: the CAPTURE is cheap (local JPEG, every 5s).
    // The DESCRIBE is expensive (vision API call). Only describe when:
    //   a) Context switched (app/window changed — detected in the capture loop)
    //   b) Every Nth unique frame as fallback
    // This drops vision API calls from ~12/min to ~2-3/min in practice.
    let should_describe = DESCRIBE_NEXT_FRAME.swap(false, std::sync::atomic::Ordering::SeqCst);

    let store = app.state::<crate::embeddings::SharedVectorStore>().inner().clone();
    let wt = window_title.clone();
    let an = app_name.clone();

    if should_describe {
        let thumb_b64 = B64.encode(&thumb);
        tauri::async_runtime::spawn(async move {
            let description = describe_screenshot(&thumb_b64).await;
            if !description.is_empty() {
                if let Some(conn) = open_db() {
                    update_description(&conn, entry_id, &description);
                }
                embed_timeline_entry(&store, entry_id, &wt, &an, &description);
            }
        });
    } else {
        // No vision call — still embed the window title + app name for search
        tauri::async_runtime::spawn(async move {
            embed_timeline_entry(&store, entry_id, &wt, &an, "");
        });
    }
}

// ---------------------------------------------------------------------------
// Capture loop
// ---------------------------------------------------------------------------

pub fn start_timeline_capture_loop(app: tauri::AppHandle) {
    // Omi approach: capture every 5s, but only run the EXPENSIVE vision model
    // call when the context changes (app/window switch). Identical/near-identical
    // frames are skipped via fingerprint dedup. This means:
    //   - 5s capture interval (fast, low-cost: just JPEG + fingerprint)
    //   - Vision model call only on context switch (~every few minutes in practice)
    //   - Near-zero cost during focused work in one app
    tauri::async_runtime::spawn(async move {
        let mut last_app = String::new();
        let mut last_title = String::new();
        let mut frames_since_describe: u32 = 0;
        let mut tick_count: u64 = 0;
        const CAPTURE_INTERVAL_SECS: u64 = 5;
        const FORCE_DESCRIBE_EVERY: u32 = 24; // force a description every ~2 min even without context switch
        const CLEANUP_EVERY: u64 = 720; // run cleanup every ~1 hour (720 * 5s)

        loop {
            crate::supervisor::heartbeat("screen_timeline");
            capture_timeline_tick(&app).await;

            // Context-switch detection: check if app or window changed
            let (current_app, current_title) = match crate::context::get_active_window() {
                Ok(w) => (w.app_name, w.window_title),
                Err(_) => (String::new(), String::new()),
            };

            let context_changed = current_app != last_app
                || (current_title != last_title && !current_title.is_empty());
            frames_since_describe += 1;

            if context_changed || frames_since_describe >= FORCE_DESCRIBE_EVERY {
                // Context switch or 2-min fallback — trigger vision description
                // on the NEXT captured frame (not this one — let the user settle)
                DESCRIBE_NEXT_FRAME.store(true, Ordering::SeqCst);

                // Emit context switch event for proactive assistants
                if !current_app.is_empty() {
                    let app_clone = app.clone();
                    let departing_app = last_app.clone();
                    let new_app = current_app.clone();
                    let new_title = current_title.clone();
                    tokio::spawn(async move {
                        // Emit context switch event for proactive assistants
                        let _ = app_clone.emit("screen_context_switch", serde_json::json!({
                            "from_app": departing_app,
                            "to_app": new_app,
                            "to_title": crate::safe_slice(&new_title, 100),
                        }));
                    });
                }
                last_app = current_app;
                last_title = current_title;
                frames_since_describe = 0;
            }

            tick_count += 1;

            // Auto-cleanup every ~1 hour: delete undescribed frames >1h old
            if tick_count % CLEANUP_EVERY == 0 {
                let retention = crate::config::load_config().timeline_retention_days;
                tokio::task::spawn_blocking(move || cleanup_old_screenshots(retention));
            }

            tokio::time::sleep(tokio::time::Duration::from_secs(CAPTURE_INTERVAL_SECS)).await;
        }
    });
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

pub fn cleanup_old_screenshots(retention_days: u32) {
    let now = chrono::Utc::now().timestamp();
    let cutoff = now - retention_days as i64 * 86400;

    if let Some(conn) = open_db() {
        // Phase 1: Delete non-described frames older than 1 hour.
        // At 5s intervals, these accumulate fast (720/hour). They exist only for
        // fingerprint dedup and were never described by the vision model.
        // Deleting their JPEG files saves ~80% of disk compared to keeping everything.
        let one_hour_ago = now - 3600;
        let stale_frames: Vec<(i64, String, String)> = conn.prepare(
            "SELECT id, screenshot_path, thumbnail_path FROM screen_timeline
             WHERE timestamp < ?1 AND (description = '' OR description IS NULL)"
        )
        .ok()
        .and_then(|mut stmt| {
            stmt.query_map(params![one_hour_ago], |row| {
                Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?))
            }).ok()
        })
        .map(|rows| rows.filter_map(|r| r.ok()).collect())
        .unwrap_or_default();

        for (id, screenshot_path, thumb_path) in &stale_frames {
            let _ = std::fs::remove_file(screenshot_path);
            let _ = std::fs::remove_file(thumb_path);
            let _ = conn.execute("DELETE FROM screen_timeline WHERE id = ?1", params![id]);
        }

        if !stale_frames.is_empty() {
            log::info!("[screen_timeline] Cleaned {} undescribed frames (>1h old)", stale_frames.len());
        }

        // Phase 2: Delete ALL frames (including described) older than retention_days
        let _ = conn.execute(
            "DELETE FROM screen_timeline WHERE timestamp < ?1",
            params![cutoff],
        );
    }

    // Remove old date directories
    let base = screenshots_dir();
    if !base.is_dir() {
        return;
    }
    let cutoff_date = chrono::DateTime::from_timestamp(cutoff, 0)
        .unwrap_or_else(chrono::Utc::now)
        .with_timezone(&chrono::Local)
        .date_naive();

    if let Ok(entries) = std::fs::read_dir(&base) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            // Expected format: YYYY-MM-DD
            if let Ok(date) = chrono::NaiveDate::parse_from_str(&name, "%Y-%m-%d") {
                if date < cutoff_date {
                    let _ = std::fs::remove_dir_all(entry.path());
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Query helpers (used by commands)
// ---------------------------------------------------------------------------

pub fn timeline_browse(date_str: Option<&str>, offset: usize, limit: usize) -> Vec<ScreenTimelineEntry> {
    let conn = match open_db() {
        Some(c) => c,
        None => return vec![],
    };

    let rows = if let Some(date) = date_str {
        // Parse date → unix range for that day (local time)
        use chrono::TimeZone;
        let naive = match chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d") {
            Ok(d) => d,
            Err(_) => return vec![],
        };
        let naive_midnight = match naive.and_hms_opt(0, 0, 0) {
            Some(dt) => dt,
            None => return vec![],
        };
        let start = chrono::Local
            .from_local_datetime(&naive_midnight)
            .earliest()
            .map(|d| d.timestamp())
            .unwrap_or(0);
        let end = start + 86400;

        let mut stmt = match conn.prepare(
            "SELECT id, timestamp, screenshot_path, thumbnail_path, window_title, app_name, description, fingerprint
             FROM screen_timeline WHERE timestamp >= ?1 AND timestamp < ?2
             ORDER BY timestamp DESC LIMIT ?3 OFFSET ?4",
        ) {
            Ok(s) => s,
            Err(_) => return vec![],
        };
        stmt.query_map(params![start, end, limit as i64, offset as i64], map_row)
            .ok()
            .map(|r| r.flatten().collect::<Vec<_>>())
            .unwrap_or_default()
    } else {
        let mut stmt = match conn.prepare(
            "SELECT id, timestamp, screenshot_path, thumbnail_path, window_title, app_name, description, fingerprint
             FROM screen_timeline ORDER BY timestamp DESC LIMIT ?1 OFFSET ?2",
        ) {
            Ok(s) => s,
            Err(_) => return vec![],
        };
        stmt.query_map(params![limit as i64, offset as i64], map_row)
            .ok()
            .map(|r| r.flatten().collect::<Vec<_>>())
            .unwrap_or_default()
    };

    rows
}

fn map_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ScreenTimelineEntry> {
    Ok(ScreenTimelineEntry {
        id: row.get(0)?,
        timestamp: row.get(1)?,
        screenshot_path: row.get(2)?,
        thumbnail_path: row.get(3)?,
        window_title: row.get(4)?,
        app_name: row.get(5)?,
        description: row.get(6)?,
        fingerprint: row.get(7)?,
    })
}

pub fn timeline_get_entry(id: i64) -> Option<ScreenTimelineEntry> {
    let conn = open_db()?;
    conn.query_row(
        "SELECT id, timestamp, screenshot_path, thumbnail_path, window_title, app_name, description, fingerprint
         FROM screen_timeline WHERE id = ?1",
        params![id],
        map_row,
    ).ok()
}

pub fn timeline_get_stats() -> TimelineStats {
    let conn = match open_db() {
        Some(c) => c,
        None => return TimelineStats { total_entries: 0, disk_bytes: 0, oldest_timestamp: None, newest_timestamp: None },
    };

    let total_entries: i64 = conn.query_row(
        "SELECT COUNT(*) FROM screen_timeline", [], |r| r.get(0)
    ).unwrap_or(0);

    let oldest_timestamp: Option<i64> = conn.query_row(
        "SELECT MIN(timestamp) FROM screen_timeline", [], |r| r.get(0)
    ).unwrap_or(None);

    let newest_timestamp: Option<i64> = conn.query_row(
        "SELECT MAX(timestamp) FROM screen_timeline", [], |r| r.get(0)
    ).unwrap_or(None);

    // Disk usage: walk screenshots dir
    let disk_bytes = dir_size(&screenshots_dir());

    TimelineStats { total_entries, disk_bytes, oldest_timestamp, newest_timestamp }
}

fn dir_size(path: &std::path::Path) -> u64 {
    if !path.is_dir() { return 0; }
    std::fs::read_dir(path)
        .ok()
        .map(|entries| {
            entries.flatten().map(|e| {
                let p = e.path();
                if p.is_dir() { dir_size(&p) }
                else { e.metadata().map(|m| m.len()).unwrap_or(0) }
            }).sum()
        })
        .unwrap_or(0)
}

/// Semantic search: embed query → hybrid search → join with DB for full entries.
/// `store` is the app-managed SharedVectorStore, passed down from the Tauri command.
pub fn timeline_search(
    store: &crate::embeddings::SharedVectorStore,
    query: &str,
    limit: usize,
) -> Vec<ScreenTimelineEntry> {
    let embeddings = match crate::embeddings::embed_texts(&[query.to_string()]) {
        Ok(e) => e,
        Err(_) => return vec![],
    };
    let query_embedding = match embeddings.into_iter().next() {
        Some(e) => e,
        None => return vec![],
    };

    let results = match store.lock() {
        Ok(s) => s.hybrid_search(&query_embedding, query, limit * 2),
        Err(_) => return vec![],
    };

    // Filter to screen_timeline source type only
    let ids: Vec<i64> = results
        .into_iter()
        .filter(|r| r.source_type == "screen_timeline")
        .take(limit)
        .filter_map(|r| r.source_id.parse::<i64>().ok())
        .collect();

    if ids.is_empty() {
        return vec![];
    }

    let conn = match open_db() {
        Some(c) => c,
        None => return vec![],
    };

    ids.into_iter()
        .filter_map(|id| {
            conn.query_row(
                "SELECT id, timestamp, screenshot_path, thumbnail_path, window_title, app_name, description, fingerprint
                 FROM screen_timeline WHERE id = ?1",
                params![id],
                map_row,
            ).ok()
        })
        .collect()
}
