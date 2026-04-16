/// HOMEOSTASIS — BLADE's hypothalamus + neuromodulatory hormone bus.
///
/// A set of global state scalars that every module can read. These scalars
/// change how the ENTIRE system behaves — not just one module.
///
/// Biology: dopamine, cortisol, norepinephrine, serotonin, arousal.
/// BLADE: arousal, energy_mode, exploration, trust, urgency.
///
/// The hypothalamus controller runs every 60s and adjusts these scalars
/// based on system-wide health signals. Modules read from the bus and
/// adapt their behavior accordingly:
///   - Organs poll more/less frequently based on arousal
///   - Brain planner uses cheaper/better models based on energy_mode
///   - Decision gate thresholds shift based on trust
///   - Proactive suggestions become more/less aggressive based on exploration

use serde::{Deserialize, Serialize};
use std::sync::{Mutex, OnceLock};
use std::sync::atomic::{AtomicBool, Ordering};

// ── The Hormone Bus ──────────────────────────────────────────────────────────

/// Global state scalars that affect ALL modules. Read anywhere, written
/// only by the hypothalamus controller.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HormoneState {
    /// 0.0 = deep sleep/idle → 1.0 = critical alert.
    /// Affects: organ poll frequency, notification urgency, response speed.
    pub arousal: f32,

    /// 0.0 = conserve (cheap models, less polling) → 1.0 = full power (best models, max polling).
    /// Affected by: API budget remaining, time of day, user activity.
    pub energy_mode: f32,

    /// 0.0 = exploit only (stick to proven patterns) → 1.0 = explore (try new approaches).
    /// Affected by: recent success rate, user mood, time since last evolution.
    pub exploration: f32,

    /// 0.0 = paranoid (ask for everything) → 1.0 = full trust (act autonomously).
    /// Affected by: recent approval rate, consecutive successes, user feedback.
    pub trust: f32,

    /// 0.0 = calm → 1.0 = urgent (production incident, critical deadline).
    /// Affected by: hive critical reports, user stress signals, deadline proximity.
    pub urgency: f32,

    /// When the hypothalamus last updated these values.
    pub last_updated: i64,
}

impl Default for HormoneState {
    fn default() -> Self {
        Self {
            arousal: 0.3,      // calm by default
            energy_mode: 0.5,  // balanced
            exploration: 0.3,  // slightly conservative
            trust: 0.3,        // cautious with new users
            urgency: 0.0,      // no urgency
            last_updated: 0,
        }
    }
}

static HORMONES: OnceLock<Mutex<HormoneState>> = OnceLock::new();
static HYPOTHALAMUS_RUNNING: AtomicBool = AtomicBool::new(false);

fn hormone_store() -> &'static Mutex<HormoneState> {
    HORMONES.get_or_init(|| Mutex::new(load_from_db().unwrap_or_default()))
}

// ── Public API: Read hormones (called by every module) ───────────────────────

/// Get the current hormone state. This is the MAIN entry point — every module
/// that needs to adapt its behavior reads from here.
pub fn get_hormones() -> HormoneState {
    hormone_store().lock().map(|h| h.clone()).unwrap_or_default()
}

/// Get a single hormone value (convenience).
pub fn arousal() -> f32 { get_hormones().arousal }
pub fn energy_mode() -> f32 { get_hormones().energy_mode }
pub fn exploration() -> f32 { get_hormones().exploration }
pub fn trust() -> f32 { get_hormones().trust }
pub fn urgency() -> f32 { get_hormones().urgency }

// ── Hypothalamus: the controller that adjusts hormones ───────────────────────

/// Run one hypothalamus cycle. Reads system-wide health signals and adjusts
/// hormone levels accordingly. Called every 60s from the background loop.
pub fn hypothalamus_tick() {
    let mut state = hormone_store().lock().unwrap_or_else(|e| e.into_inner()).clone();
    let now = chrono::Utc::now().timestamp();

    // ── Arousal: based on user activity + hive urgency ──────────────────
    let perception = crate::perception_fusion::get_latest();
    let user_state = perception.as_ref().map(|p| p.user_state.as_str()).unwrap_or("idle");

    state.arousal = match user_state {
        "focused" => 0.6,
        "idle" => 0.2,
        "away" => 0.1,
        _ => 0.3,
    };

    // Hive urgency signals raise arousal
    let hive_status = crate::hive::get_hive_status();
    if hive_status.pending_decisions > 0 {
        state.arousal = (state.arousal + 0.1 * hive_status.pending_decisions as f32).min(1.0);
    }
    if hive_status.pending_reports > 5 {
        state.arousal = (state.arousal + 0.1).min(1.0);
    }

    // ── Energy mode: based on API budget health + time of day ───────────
    let config = crate::config::load_config();
    let hour = chrono::Local::now().format("%H").to_string().parse::<u32>().unwrap_or(12);

    // Lower energy during user's likely sleep hours
    if hour < 6 || hour > 23 {
        state.energy_mode = 0.2; // conserve at night
    } else if config.token_efficient {
        state.energy_mode = 0.3; // user explicitly asked to conserve
    } else {
        state.energy_mode = 0.6; // normal
    }

    // If user is actively working, raise energy
    if user_state == "focused" {
        state.energy_mode = (state.energy_mode + 0.2).min(1.0);
    }

    // ── Exploration: based on success rate + time since last evolution ──
    // High success rate → exploit (keep doing what works)
    // Low success rate OR long time since evolution → explore
    let decision_log_size = crate::decision_gate::get_decision_log().len();
    let recent_correct = crate::decision_gate::get_decision_log()
        .iter()
        .rev()
        .take(20)
        .filter(|d| d.feedback_correct == Some(true))
        .count();

    if decision_log_size > 5 {
        let success_rate = recent_correct as f32 / 20.0f32.min(decision_log_size as f32);
        state.exploration = if success_rate > 0.8 {
            0.2 // high success → exploit
        } else if success_rate < 0.4 {
            0.7 // low success → explore more
        } else {
            0.4 // balanced
        };
    }

    // ── Trust: based on recent user approval rate ───────────────────────
    let recent_approved = crate::decision_gate::get_decision_log()
        .iter()
        .rev()
        .take(30)
        .filter(|d| d.feedback_correct == Some(true))
        .count();
    let recent_denied = crate::decision_gate::get_decision_log()
        .iter()
        .rev()
        .take(30)
        .filter(|d| d.feedback_correct == Some(false))
        .count();

    if recent_approved + recent_denied > 3 {
        let approval_rate = recent_approved as f32 / (recent_approved + recent_denied) as f32;
        state.trust = (approval_rate * 0.8).clamp(0.1, 0.9); // never fully 0 or 1
    }

    // ── Urgency: from hive critical signals ─────────────────────────────
    let critical_count = hive_status.tentacles.iter()
        .filter(|t| t.pending_report_count > 0)
        .count();

    state.urgency = if critical_count > 3 {
        0.8
    } else if critical_count > 0 {
        0.4
    } else {
        0.0
    };

    state.last_updated = now;

    // Write back
    if let Ok(mut guard) = hormone_store().lock() {
        *guard = state.clone();
    }

    // Persist to DB for restart recovery
    persist_to_db(&state);
}

/// Start the hypothalamus background loop (60s tick).
pub fn start_hypothalamus(app: tauri::AppHandle) {
    if HYPOTHALAMUS_RUNNING.swap(true, Ordering::SeqCst) {
        return;
    }
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(tokio::time::Duration::from_secs(60)).await;
            hypothalamus_tick();

            // Emit hormone state for HUD/dashboard
            let hormones = get_hormones();
            let _ = app.emit("homeostasis_update", serde_json::json!({
                "arousal": hormones.arousal,
                "energy_mode": hormones.energy_mode,
                "exploration": hormones.exploration,
                "trust": hormones.trust,
                "urgency": hormones.urgency,
            }));
        }
    });
}

// ── DB persistence ───────────────────────────────────────────────────────────

fn load_from_db() -> Option<HormoneState> {
    let db_path = crate::config::blade_config_dir().join("blade.db");
    let conn = rusqlite::Connection::open(&db_path).ok()?;
    let json: String = conn.query_row(
        "SELECT value FROM settings WHERE key = 'homeostasis'",
        [],
        |row| row.get(0),
    ).ok()?;
    serde_json::from_str(&json).ok()
}

fn persist_to_db(state: &HormoneState) {
    let db_path = crate::config::blade_config_dir().join("blade.db");
    if let Ok(conn) = rusqlite::Connection::open(&db_path) {
        if let Ok(json) = serde_json::to_string(state) {
            let _ = conn.execute(
                "INSERT INTO settings (key, value) VALUES ('homeostasis', ?1)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                rusqlite::params![json],
            );
        }
    }
}

// ── Tauri Commands ───────────────────────────────────────────────────────────

#[tauri::command]
pub fn homeostasis_get() -> HormoneState {
    get_hormones()
}

use tauri::Emitter;
