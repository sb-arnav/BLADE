/// Tauri commands for the Total Recall screen timeline feature.

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine as _;
use tauri::Manager;

use crate::screen_timeline::{
    ScreenTimelineEntry, TimelineConfig, TimelineStats,
    cleanup_old_screenshots, timeline_browse, timeline_get_entry,
    timeline_get_stats, timeline_search,
};

/// Search timeline semantically. "that error I was debugging" → matching screenshots.
#[tauri::command]
pub async fn timeline_search_cmd(
    store: tauri::State<'_, crate::embeddings::SharedVectorStore>,
    query: String,
    limit: Option<usize>,
) -> Result<Vec<ScreenTimelineEntry>, String> {
    let results = timeline_search(store.inner(), &query, limit.unwrap_or(12));
    Ok(results)
}

/// Browse timeline by date (YYYY-MM-DD) or all entries if date is None.
#[tauri::command]
pub fn timeline_browse_cmd(
    date: Option<String>,
    offset: Option<usize>,
    limit: Option<usize>,
) -> Vec<ScreenTimelineEntry> {
    timeline_browse(date.as_deref(), offset.unwrap_or(0), limit.unwrap_or(24))
}

/// Return full-resolution JPEG as base64 for a specific entry.
#[tauri::command]
pub fn timeline_get_screenshot(id: i64) -> Result<String, String> {
    let entry = timeline_get_entry(id).ok_or("Entry not found")?;
    let bytes = std::fs::read(&entry.screenshot_path)
        .map_err(|e| format!("Could not read screenshot: {}", e))?;
    Ok(B64.encode(bytes))
}

/// Return thumbnail JPEG as base64 for a specific entry.
#[tauri::command]
pub fn timeline_get_thumbnail(id: i64) -> Result<String, String> {
    let entry = timeline_get_entry(id).ok_or("Entry not found")?;
    let path = if entry.thumbnail_path.is_empty() {
        &entry.screenshot_path
    } else {
        &entry.thumbnail_path
    };
    let bytes = std::fs::read(path)
        .map_err(|e| format!("Could not read thumbnail: {}", e))?;
    Ok(B64.encode(bytes))
}

/// Get current timeline config (reads from BladeConfig).
#[tauri::command]
pub fn timeline_get_config() -> TimelineConfig {
    let config = crate::config::load_config();
    TimelineConfig {
        enabled: config.screen_timeline_enabled,
        capture_interval_secs: config.timeline_capture_interval,
        retention_days: config.timeline_retention_days,
    }
}

/// Update timeline config fields.
#[tauri::command]
pub fn timeline_set_config(
    app: tauri::AppHandle,
    enabled: Option<bool>,
    capture_interval_secs: Option<u32>,
    retention_days: Option<u32>,
) -> Result<TimelineConfig, String> {
    let mut config = crate::config::load_config();

    let was_enabled = config.screen_timeline_enabled;

    if let Some(v) = enabled { config.screen_timeline_enabled = v; }
    if let Some(v) = capture_interval_secs { config.timeline_capture_interval = v.max(10); }
    if let Some(v) = retention_days { config.timeline_retention_days = v.max(1); }

    crate::config::save_config(&config)?;

    // Start capture loop if just enabled
    if !was_enabled && config.screen_timeline_enabled {
        crate::screen_timeline::start_timeline_capture_loop(app);
    }

    Ok(TimelineConfig {
        enabled: config.screen_timeline_enabled,
        capture_interval_secs: config.timeline_capture_interval,
        retention_days: config.timeline_retention_days,
    })
}

/// Statistics: total entries, disk usage, date range.
#[tauri::command]
pub fn timeline_get_stats_cmd() -> TimelineStats {
    timeline_get_stats()
}

/// Manually trigger cleanup of old screenshots.
#[tauri::command]
pub fn timeline_cleanup() -> Result<(), String> {
    let config = crate::config::load_config();
    cleanup_old_screenshots(config.timeline_retention_days);
    Ok(())
}

// ---------------------------------------------------------------------------
// Audio Timeline commands
// ---------------------------------------------------------------------------

/// Unified semantic search across screenshots, audio transcripts, conversations,
/// and knowledge graph facts. Returns results sorted by relevance.
#[tauri::command]
pub async fn timeline_search_everything(
    store: tauri::State<'_, crate::embeddings::SharedVectorStore>,
    query: String,
    limit: Option<usize>,
) -> Result<Vec<crate::audio_timeline::UnifiedSearchResult>, String> {
    let results = crate::audio_timeline::search_everything(
        store.inner(),
        &query,
        limit.unwrap_or(20),
    )
    .await;
    Ok(results)
}

/// Browse or search audio timeline entries.
#[tauri::command]
pub async fn timeline_get_audio(
    store: tauri::State<'_, crate::embeddings::SharedVectorStore>,
    query: Option<String>,
    from_ts: Option<i64>,
    to_ts: Option<i64>,
    offset: Option<usize>,
    limit: Option<usize>,
) -> Result<Vec<crate::audio_timeline::AudioTimelineEntry>, String> {
    let lim = limit.unwrap_or(20);
    if let Some(q) = query.filter(|q| !q.trim().is_empty()) {
        Ok(crate::audio_timeline::audio_timeline_search(store.inner(), &q, lim))
    } else {
        Ok(crate::audio_timeline::audio_timeline_browse(from_ts, to_ts, lim, offset.unwrap_or(0)))
    }
}

/// Generate (or retrieve) the meeting summary for a given meeting_id.
/// Call this after a meeting ends or manually for any meeting_id.
#[tauri::command]
pub async fn timeline_meeting_summary(
    meeting_id: String,
) -> Result<crate::audio_timeline::MeetingSummary, String> {
    crate::audio_timeline::generate_meeting_summary(&meeting_id).await
}

/// Get all extracted action items from audio timeline entries.
#[tauri::command]
pub fn timeline_get_action_items(limit: Option<usize>) -> Vec<serde_json::Value> {
    crate::audio_timeline::get_all_action_items(limit.unwrap_or(50))
}

/// Enable or disable always-on audio capture. Starts the loop if not already running.
#[tauri::command]
pub fn timeline_set_audio_capture(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    let mut config = crate::config::load_config();
    config.audio_capture_enabled = enabled;
    crate::config::save_config(&config)?;
    if enabled {
        crate::audio_timeline::start_audio_timeline_capture(app);
    } else {
        use tauri::Emitter;
        let _ = app.emit_to("main", "audio_capture_state", serde_json::json!({ "active": false }));
    }
    Ok(())
}

/// Check whether a video call / meeting is currently active.
#[tauri::command]
pub fn timeline_detect_meeting() -> bool {
    crate::audio_timeline::detect_meeting_in_progress()
}
