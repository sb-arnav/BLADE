/// BLADE Health Guardian — Screen Time & Wellbeing Monitor
///
/// Runs a background loop every 5 minutes. Tracks continuous screen time,
/// fires health break reminders at 90 min and 3 hours, suggests winding down
/// after 22:00, and stores daily stats to blade.db.

use chrono::Timelike;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};
use tauri::Emitter;

// ── State ─────────────────────────────────────────────────────────────────────

/// Unix timestamp (seconds) when the current active streak started.
/// 0 = user was idle (no active session).
static ACTIVE_SINCE: AtomicI64 = AtomicI64::new(0);

/// Unix timestamp of the last recorded idle moment.
static LAST_BREAK: AtomicI64 = AtomicI64::new(0);

/// Unix timestamp of the last wind-down notification (to avoid spamming every tick).
static LAST_WINDDOWN: AtomicI64 = AtomicI64::new(0);

/// Unix timestamp of the last break reminder (90-min / 3-hour) — throttle to once per 30 min.
static LAST_BREAK_REMINDER: AtomicI64 = AtomicI64::new(0);

/// Whether the monitor loop is running.
static MONITOR_RUNNING: AtomicBool = AtomicBool::new(false);

// ── DB helpers ────────────────────────────────────────────────────────────────

fn db_path() -> std::path::PathBuf {
    crate::config::blade_config_dir().join("blade.db")
}

fn open_db() -> Option<rusqlite::Connection> {
    rusqlite::Connection::open(db_path()).ok()
}

pub fn ensure_tables() {
    if let Some(conn) = open_db() {
        let _ = conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS health_stats (
                date TEXT PRIMARY KEY,
                screen_time_minutes INTEGER NOT NULL DEFAULT 0,
                breaks_taken INTEGER NOT NULL DEFAULT 0,
                longest_streak_minutes INTEGER NOT NULL DEFAULT 0,
                first_active INTEGER NOT NULL DEFAULT 0,
                last_active INTEGER NOT NULL DEFAULT 0
            );",
        );
    }
}

// ── Types ─────────────────────────────────────────────────────────────────────

#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HealthStats {
    pub screen_time_minutes: i64,
    pub current_streak_minutes: i64,
    pub last_break_ago_minutes: i64,
    pub daily_total_minutes: i64,
    pub weekly_average_minutes: f64,
    pub breaks_today: i64,
    pub status: String, // "ok" | "warning" | "critical"
}

// ── Core logic ────────────────────────────────────────────────────────────────

/// Called every tick (5 min) to check screen time state and fire events.
async fn health_tick(app: &tauri::AppHandle) {
    let now = chrono::Utc::now().timestamp();
    let local_hour = chrono::Local::now().hour();

    let active_since = ACTIVE_SINCE.load(Ordering::Relaxed);
    let last_break = LAST_BREAK.load(Ordering::Relaxed);

    // Detect idleness by checking if the user has any recent activity.
    // We use a simple heuristic: if the context module sees activity, they're active.
    // Since we can't truly poll input devices from Rust easily without extra deps,
    // we use the screen timeline as a signal — if a screenshot was taken recently,
    // the user was active. Otherwise we assume idle.
    let is_idle = detect_idle();

    if is_idle {
        // User went idle — record break
        if active_since > 0 {
            let streak_mins = (now - active_since) / 60;
            ACTIVE_SINCE.store(0, Ordering::Relaxed);
            LAST_BREAK.store(now, Ordering::Relaxed);

            // Update DB: record the completed streak
            let today = chrono::Local::now().format("%Y-%m-%d").to_string();
            if let Some(conn) = open_db() {
                let _ = conn.execute(
                    "INSERT INTO health_stats (date, screen_time_minutes, breaks_taken, longest_streak_minutes, first_active, last_active)
                     VALUES (?1, ?2, 1, ?3, ?4, ?5)
                     ON CONFLICT(date) DO UPDATE SET
                       screen_time_minutes = screen_time_minutes + excluded.screen_time_minutes,
                       breaks_taken = breaks_taken + 1,
                       longest_streak_minutes = MAX(longest_streak_minutes, excluded.longest_streak_minutes),
                       last_active = excluded.last_active",
                    params![today, streak_mins, streak_mins, active_since, now],
                );
            }
        }
        return;
    }

    // User is active
    if active_since == 0 {
        // New active session starting
        ACTIVE_SINCE.store(now, Ordering::Relaxed);
        return;
    }

    let streak_mins = (now - active_since) / 60;

    // Update daily active time in DB every tick
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    if let Some(conn) = open_db() {
        let _ = conn.execute(
            "INSERT INTO health_stats (date, screen_time_minutes, breaks_taken, longest_streak_minutes, first_active, last_active)
             VALUES (?1, 5, 0, ?2, ?3, ?4)
             ON CONFLICT(date) DO UPDATE SET
               screen_time_minutes = screen_time_minutes + 5,
               longest_streak_minutes = MAX(longest_streak_minutes, excluded.longest_streak_minutes),
               last_active = excluded.last_active",
            params![today, streak_mins, active_since, now],
        );
    }

    // Fire break reminder events based on streak length.
    // Throttle to at most once every 30 minutes so we don't spam every 5-min tick.
    let last_reminder = LAST_BREAK_REMINDER.load(Ordering::Relaxed);
    let secs_since_reminder = if last_reminder > 0 { now - last_reminder } else { i64::MAX };
    if streak_mins >= 90 && secs_since_reminder > 1800 {
        LAST_BREAK_REMINDER.store(now, Ordering::Relaxed);
        if streak_mins >= 180 {
            // > 3 hours — urgent
            let _ = app.emit("health_break_reminder", serde_json::json!({
                "urgency": "critical",
                "streak_minutes": streak_mins,
                "message": format!(
                    "You have been working for {} hours without a break. Step away now — stretch, hydrate, rest your eyes.",
                    streak_mins / 60
                )
            }));
        } else {
            // 90–180 min — standard reminder
            let _ = app.emit("health_break_reminder", serde_json::json!({
                "urgency": "warning",
                "streak_minutes": streak_mins,
                "message": format!(
                    "You have been active for {} minutes. Time for a 5-minute break.",
                    streak_mins
                )
            }));
        }
    }

    // Wind-down after 22:00 — fire at most once per hour to avoid spamming every 5-min tick
    if local_hour >= 22 {
        let last_winddown = LAST_WINDDOWN.load(Ordering::Relaxed);
        let secs_since_winddown = if last_winddown > 0 { now - last_winddown } else { i64::MAX };
        // Only fire if user has been active (no break) for >30 min since 10pm
        // and we haven't sent a wind-down reminder in the last 60 minutes.
        let last_break_mins = if last_break > 0 { (now - last_break) / 60 } else { streak_mins };
        if last_break_mins > 30 && secs_since_winddown > 3600 {
            LAST_WINDDOWN.store(now, Ordering::Relaxed);
            let _ = app.emit("health_break_reminder", serde_json::json!({
                "urgency": "wind_down",
                "streak_minutes": streak_mins,
                "message": "It is past 10 PM. Consider wrapping up for the night — sleep is your best productivity multiplier."
            }));
        }
    }
}

/// Detect whether the user appears idle by checking if there's been a recent screen timeline entry.
fn detect_idle() -> bool {
    let conn = match open_db() {
        Some(c) => c,
        None => return false,
    };

    // If screen_timeline table doesn't exist or is empty, assume active
    let last_ts: Option<i64> = conn.query_row(
        "SELECT MAX(timestamp) FROM screen_timeline",
        [],
        |row| row.get(0),
    ).unwrap_or(None);

    match last_ts {
        Some(ts) => {
            let now = chrono::Utc::now().timestamp();
            // If last screenshot is > 8 minutes old, assume idle
            (now - ts) > 480
        }
        None => false, // timeline not running — assume active
    }
}

// ── Public API ────────────────────────────────────────────────────────────────

/// Start the background health monitor loop (fires every 5 minutes).
pub fn start_health_monitor(app: tauri::AppHandle) {
    if MONITOR_RUNNING.swap(true, Ordering::SeqCst) {
        return; // already running
    }
    ensure_tables();
    ACTIVE_SINCE.store(chrono::Utc::now().timestamp(), Ordering::Relaxed);

    tauri::async_runtime::spawn(async move {
        loop {
            health_tick(&app).await;
            tokio::time::sleep(tokio::time::Duration::from_secs(300)).await;
        }
    });
}

/// Return current health stats.
pub fn get_health_stats() -> serde_json::Value {
    ensure_tables();

    let now = chrono::Utc::now().timestamp();
    let active_since = ACTIVE_SINCE.load(Ordering::Relaxed);
    let last_break_ts = LAST_BREAK.load(Ordering::Relaxed);

    let current_streak_mins = if active_since > 0 {
        (now - active_since) / 60
    } else {
        0
    };

    let last_break_ago_mins = if last_break_ts > 0 {
        (now - last_break_ts) / 60
    } else {
        -1 // never taken a break this session
    };

    let today = chrono::Local::now().format("%Y-%m-%d").to_string();

    let (daily_total, breaks_today): (i64, i64) = open_db()
        .and_then(|conn| {
            conn.query_row(
                "SELECT screen_time_minutes, breaks_taken FROM health_stats WHERE date = ?1",
                params![today],
                |row| Ok((row.get(0)?, row.get(1)?)),
            ).ok()
        })
        .unwrap_or((0, 0));

    // Weekly average
    let week_ago = (chrono::Local::now() - chrono::Duration::days(7))
        .format("%Y-%m-%d").to_string();
    let weekly_avg: f64 = open_db()
        .and_then(|conn| {
            conn.query_row(
                "SELECT AVG(screen_time_minutes) FROM health_stats WHERE date >= ?1",
                params![week_ago],
                |row| row.get(0),
            ).ok()
        })
        .unwrap_or(None)
        .unwrap_or(0.0);

    let status = if current_streak_mins >= 180 {
        "critical"
    } else if current_streak_mins >= 90 {
        "warning"
    } else {
        "ok"
    };

    serde_json::json!({
        "screen_time_minutes": daily_total,
        "current_streak_minutes": current_streak_mins,
        "last_break_ago_minutes": last_break_ago_mins,
        "daily_total_minutes": daily_total,
        "weekly_average_minutes": (weekly_avg * 10.0).round() / 10.0,
        "breaks_today": breaks_today,
        "status": status
    })
}

/// Reset the current streak counter (user manually acknowledged a break).
pub fn take_break() {
    let now = chrono::Utc::now().timestamp();
    LAST_BREAK.store(now, Ordering::Relaxed);
    ACTIVE_SINCE.store(0, Ordering::Relaxed);
    // Reset reminder throttle so next streak will fire again when due
    LAST_BREAK_REMINDER.store(0, Ordering::Relaxed);
}

// ── Tauri Commands ────────────────────────────────────────────────────────────

#[tauri::command]
pub fn health_guardian_stats() -> serde_json::Value {
    get_health_stats()
}

#[tauri::command]
pub fn health_take_break() -> serde_json::Value {
    take_break();
    serde_json::json!({ "ok": true, "message": "Break recorded. Screen time counter reset." })
}
