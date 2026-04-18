/// BLADE Overlay Manager — HUD, toast notifications, and meeting overlay control.
///
/// Manages three overlay surfaces:
///   1. HUD bar   — slim always-on-top bar at top of screen (time, app, god mode, unread)
///   2. Toast     — BLADE-styled transient notification (not OS notification)
///   3. Ghost card — meeting suggestion card (toggled by Ctrl+G in ghost_mode.rs)
///
/// Tauri commands exposed:
///   overlay_show_hud, overlay_hide_hud,
///   overlay_update_hud(HudData),
///   overlay_show_notification(title, body, duration_ms)

use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{Emitter, Manager};

static HUD_VISIBLE: AtomicBool = AtomicBool::new(false);

// ── Data Types ─────────────────────────────────────────────────────────────────

/// Data pushed to the HUD bar every 10 seconds (or on demand).
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct HudData {
    /// Current local time string e.g. "14:32"
    pub time: String,
    /// Name of the active foreground application
    pub active_app: String,
    /// God Mode status: "off" | "normal" | "intermediate" | "extreme"
    pub god_mode_status: String,
    /// Number of unread OS notifications (0 if not available)
    pub unread_count: u32,
    /// Seconds until next calendar meeting (None = no meeting soon)
    pub next_meeting_secs: Option<u64>,
    /// Next meeting name (shown when meeting_secs is Some)
    pub next_meeting_name: Option<String>,
    /// Whether a meeting is currently active (switches HUD to meeting mode)
    pub meeting_active: bool,
    /// Current meeting name (when meeting_active)
    pub meeting_name: Option<String>,
    /// Speaker currently talking (from ghost_mode)
    pub speaker_name: Option<String>,
    /// Number of active Hive organs (tentacles monitoring platforms)
    pub hive_organs_active: usize,
    /// Number of pending decisions from Hive that need user attention
    pub hive_pending_decisions: usize,
    /// One-line hive status summary (most urgent item)
    pub hive_status_line: String,
}

/// A BLADE-styled toast notification payload.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToastPayload {
    pub title: String,
    pub body: String,
    pub duration_ms: u64,
    pub level: String, // "info" | "success" | "warning" | "error"
}

// ── Window Creation ────────────────────────────────────────────────────────────

/// Create the HUD window (slim 30px bar at top, full width).
/// The window is full-screen height but transparent — only the top 30px bar
/// has visible content; ghost cards and toasts float below via CSS position:fixed.
/// Reuses the existing window if already built.
pub fn create_hud_window(app: &tauri::AppHandle) -> Result<tauri::WebviewWindow, String> {
    if let Some(w) = app.get_webview_window("blade_hud") {
        return Ok(w);
    }

    // Get primary monitor dimensions
    let (screen_w, screen_h, scale) = get_primary_monitor_info(app);

    let builder = tauri::WebviewWindowBuilder::new(
        app,
        "blade_hud",
        tauri::WebviewUrl::App("hud.html".into()),
    )
    .title("BLADE HUD")
    // Full screen width, full screen height so floating cards can render below the bar.
    // The window is transparent; only visually active areas are rendered.
    .inner_size(screen_w / scale, screen_h / scale)
    .position(0.0, 0.0)
    .decorations(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .transparent(true)
    .resizable(false)
    .visible(false);

    let window = builder.build().map_err(|e| e.to_string())?;

    // Stretch to full monitor dimensions in physical pixels
    let _ = window.set_size(tauri::PhysicalSize::new(
        screen_w as u32,
        screen_h as u32,
    ));
    let _ = window.set_position(tauri::PhysicalPosition::new(0i32, 0i32));

    // Content protection — invisible to screen share
    apply_content_protection(&window);

    log::info!("[overlay_manager] HUD window created ({}x{})", screen_w as u32, screen_h as u32);
    Ok(window)
}

/// Apply Windows content protection (WDA_EXCLUDEFROMCAPTURE).
fn apply_content_protection(window: &tauri::WebviewWindow) {
    #[cfg(target_os = "windows")]
    {
        if let Ok(hwnd) = window.hwnd() {
            extern "system" {
                fn SetWindowDisplayAffinity(hwnd: *mut std::ffi::c_void, affinity: u32) -> i32;
            }
            unsafe {
                SetWindowDisplayAffinity(hwnd.0, 0x00000011);
            }
        }
    }
    let _ = window; // suppress unused warning on non-windows
}

fn get_primary_monitor_info(app: &tauri::AppHandle) -> (f64, f64, f64) {
    // Try to get from a known window first; fall back to defaults
    if let Some(w) = app.get_webview_window("main").or_else(|| app.get_webview_window("quickask")) {
        if let Ok(monitors) = w.available_monitors() {
            if let Some(m) = monitors.first() {
                let scale = m.scale_factor();
                let size = m.size();
                return (size.width as f64, size.height as f64, scale);
            }
        }
    }
    // Safe fallback for 1080p / 1.0 scale
    (1920.0, 1080.0, 1.0)
}

// ── HUD Data Builder ───────────────────────────────────────────────────────────

/// Build a fresh HudData snapshot from live system state.
pub fn build_hud_data() -> HudData {
    let now = chrono::Local::now();
    let time = now.format("%H:%M").to_string();

    // Active app
    let active_app = match crate::context::get_active_window() {
        Ok(w) if !w.app_name.is_empty() => w.app_name,
        _ => String::new(),
    };

    // God Mode status
    let config = crate::config::load_config();
    let god_mode_status = if config.god_mode {
        config.god_mode_tier.clone()
    } else {
        "off".to_string()
    };

    // Unread count from notification listener
    let unread_count = crate::notification_listener::get_unread_count();

    // Next meeting from meeting_intelligence timeline
    let (next_meeting_secs, next_meeting_name) = get_next_meeting_info();

    // Meeting active check (from ghost_mode platform detection)
    let meeting_platform = crate::ghost_mode::detect_active_platform();
    let meeting_active = meeting_platform != "none";
    let meeting_name = if meeting_active {
        Some(crate::ghost_mode::platform_display_name(&meeting_platform))
    } else {
        None
    };

    // Hive status for overlay
    let hive_status = crate::hive::get_hive_status();
    let hive_organs_active = hive_status.active_tentacles;
    let hive_pending_decisions = hive_status.pending_decisions;
    let hive_status_line = if !hive_status.running {
        String::new()
    } else if hive_status.pending_reports > 0 {
        format!("{} reports pending", hive_status.pending_reports)
    } else if hive_organs_active > 0 {
        format!("{} organs active", hive_organs_active)
    } else {
        String::new()
    };

    HudData {
        time,
        active_app,
        god_mode_status,
        unread_count,
        next_meeting_secs,
        next_meeting_name,
        meeting_active,
        meeting_name,
        speaker_name: None,
        hive_organs_active,
        hive_pending_decisions,
        hive_status_line,
    }
}

/// Look up the next scheduled meeting from the DB timeline.
fn get_next_meeting_info() -> (Option<u64>, Option<String>) {
    let db_path = crate::config::blade_config_dir().join("blade.db");
    let conn = match rusqlite::Connection::open(&db_path) {
        Ok(c) => c,
        Err(_) => return (None, None),
    };

    let now_ts = chrono::Utc::now().timestamp();
    // Look ahead up to 2 hours
    let lookahead = now_ts + 7200;

    let result: rusqlite::Result<(i64, String)> = conn.query_row(
        "SELECT start_ts, title FROM meetings WHERE start_ts > ?1 AND start_ts < ?2 ORDER BY start_ts ASC LIMIT 1",
        rusqlite::params![now_ts, lookahead],
        |row| Ok((row.get(0)?, row.get(1)?)),
    );

    match result {
        Ok((start_ts, title)) => {
            let secs_until = (start_ts - now_ts).max(0) as u64;
            (Some(secs_until), Some(title))
        }
        Err(_) => (None, None),
    }
}

// ── HUD Update Loop ────────────────────────────────────────────────────────────

/// Start the background loop that pushes HUD data every 10 seconds.
pub fn start_hud_update_loop(app: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(tokio::time::Duration::from_secs(10)).await;

            if !HUD_VISIBLE.load(Ordering::SeqCst) {
                continue;
            }

            let data = tokio::task::spawn_blocking(build_hud_data)
                .await
                .unwrap_or_default();

            // Emit to HUD window
            if let Some(hud) = app.get_webview_window("blade_hud") {
                let _ = hud.emit("hud_update", &data);
            }

            // Also emit to HUD window so dashboard-in-HUD can reflect state
            let _ = app.emit_to("hud", "hud_data_updated", &data);
        }
    });
}

// ── Tauri Commands ─────────────────────────────────────────────────────────────

/// Show the slim HUD bar.
#[tauri::command]
pub fn overlay_show_hud(app: tauri::AppHandle) -> Result<(), String> {
    let window = create_hud_window(&app)?;
    let _ = window.show();
    HUD_VISIBLE.store(true, Ordering::SeqCst);

    // Push initial data immediately
    let data = build_hud_data();
    let _ = window.emit("hud_update", &data);

    log::info!("[overlay_manager] HUD shown");
    Ok(())
}

/// Hide the slim HUD bar.
#[tauri::command]
pub fn overlay_hide_hud(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("blade_hud") {
        let _ = w.hide();
    }
    HUD_VISIBLE.store(false, Ordering::SeqCst);
    log::info!("[overlay_manager] HUD hidden");
    Ok(())
}

/// Push fresh data to the HUD (called by god mode, ghost mode, etc.).
#[tauri::command]
pub fn overlay_update_hud(app: tauri::AppHandle, data: HudData) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("blade_hud") {
        let _ = w.emit("hud_update", &data);
    }
    // Also broadcast to HUD window
    let _ = app.emit_to("hud", "hud_data_updated", &data);
    Ok(())
}

/// Show a BLADE-styled toast notification (not an OS notification).
/// The toast renders inside the HUD window as a floating card above it.
#[tauri::command]
pub fn overlay_show_notification(
    app: tauri::AppHandle,
    title: String,
    body: String,
    duration_ms: u64,
    level: Option<String>,
) -> Result<(), String> {
    let payload = ToastPayload {
        title,
        body,
        duration_ms: duration_ms.max(1000).min(30_000),
        level: level.unwrap_or_else(|| "info".to_string()),
    };

    // Ensure HUD is up (toast renders inside the HUD surface)
    if app.get_webview_window("blade_hud").is_none() {
        create_hud_window(&app)?;
    }
    if let Some(w) = app.get_webview_window("blade_hud") {
        let _ = w.show();
        let _ = w.emit("blade_toast", &payload);
    }

    // Also send to main window notification center
    let _ = app.emit("blade_toast", &payload);

    log::info!("[overlay_manager] toast: {} — {}", payload.title, payload.body);
    Ok(())
}
