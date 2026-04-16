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

    /// 0.0 = satiated → 1.0 = starving (pending work not being executed).
    /// Affected by: pending hive decisions, queued tasks, unanswered messages.
    pub hunger: f32,

    /// 0.0 = fresh data → 1.0 = stale (perception/context hasn't been updated).
    /// Affected by: time since last perception tick, time since last user interaction.
    pub thirst: f32,

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
            hunger: 0.0,       // no pending work
            thirst: 0.0,       // fresh data
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

    // ── Power monitor: battery awareness (from Omi's PowerMonitor) ──────
    // On laptops, detect battery vs AC power and adjust energy accordingly.
    // Battery → lower energy (skip expensive vision calls, reduce poll rate)
    // AC → full power
    let on_battery = detect_battery_power();
    if on_battery {
        state.energy_mode = (state.energy_mode * 0.5).max(0.1);
        state.arousal = (state.arousal - 0.1).max(0.0);
    }

    // ── Pineal gland: LEARNED circadian rhythm ──────────────────────────
    // Instead of hardcoding "9-17 is work hours," BLADE learns the user's
    // actual schedule from activity_monitor data. A user who works 12pm-3am
    // gets a completely different circadian curve than a 9-5 worker.
    //
    // The learned profile is a 24-slot array (one per hour) where each slot
    // is the probability the user is active at that hour, based on the last
    // 14 days of observations.
    let config = crate::config::load_config();
    let hour = chrono::Local::now().format("%H").to_string().parse::<u32>().unwrap_or(12);

    let profile = load_circadian_profile();
    let activity_probability = profile[hour as usize];

    // Map activity probability to energy/arousal:
    // High probability (user usually active now) → full power
    // Low probability (user usually asleep now) → conservation
    let circadian_energy = if activity_probability > 0.7 {
        0.7  // peak hours for this user
    } else if activity_probability > 0.4 {
        0.5  // transition period (waking up or winding down)
    } else if activity_probability > 0.15 {
        0.3  // occasional activity (maybe checking phone)
    } else {
        0.15 // user is almost never active at this hour — deep sleep
    };

    let circadian_arousal_mod = if activity_probability > 0.7 {
        0.1   // work hours — slightly elevated
    } else if activity_probability > 0.4 {
        0.0   // transition — neutral
    } else if activity_probability > 0.15 {
        -0.1  // off hours — suppress
    } else {
        -0.2  // deep sleep — strong suppress
    };

    // Apply learned circadian rhythm as baseline
    state.energy_mode = circadian_energy;
    state.arousal = (state.arousal + circadian_arousal_mod).clamp(0.0, 1.0);

    if config.token_efficient {
        state.energy_mode *= 0.6;
    }

    // If user is actively working, override circadian suppression
    if user_state == "focused" {
        state.energy_mode = (state.energy_mode + 0.2).min(1.0);
        state.arousal = (state.arousal + 0.1).min(1.0);
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

    // ── Hunger: pending work not being executed ───────────────────────
    let pending_decisions = hive_status.pending_decisions;
    let pending_reports = hive_status.pending_reports;
    state.hunger = if pending_decisions > 5 || pending_reports > 10 {
        0.8 // lots of pending work
    } else if pending_decisions > 0 || pending_reports > 3 {
        0.4 // some pending work
    } else {
        0.1 // satiated
    };

    // ── Thirst: staleness of perception data ────────────────────────
    let perception_age = perception
        .as_ref()
        .map(|p| now - p.timestamp)
        .unwrap_or(300); // 5 min if no perception at all
    state.thirst = if perception_age > 120 {
        0.8 // very stale (>2 min, perception loop should run every 30s)
    } else if perception_age > 60 {
        0.4 // somewhat stale
    } else {
        0.1 // fresh
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
                "hunger": hormones.hunger,
                "thirst": hormones.thirst,
            }));
        }
    });
}

// ── Battery / Power Detection ─────────────────────────────────────────────────

/// Detect if the machine is running on battery power.
/// Returns true on battery, false on AC or if detection fails (desktops).
fn detect_battery_power() -> bool {
    #[cfg(target_os = "windows")]
    {
        // Windows: GetSystemPowerStatus
        #[repr(C)]
        #[allow(non_snake_case)]
        struct SystemPowerStatus {
            ACLineStatus: u8,
            BatteryFlag: u8,
            BatteryLifePercent: u8,
            SystemStatusFlag: u8,
            BatteryLifeTime: u32,
            BatteryFullLifeTime: u32,
        }
        extern "system" {
            fn GetSystemPowerStatus(status: *mut SystemPowerStatus) -> i32;
        }
        unsafe {
            let mut status = std::mem::zeroed::<SystemPowerStatus>();
            if GetSystemPowerStatus(&mut status) != 0 {
                // ACLineStatus: 0 = offline (battery), 1 = online (AC)
                return status.ACLineStatus == 0;
            }
        }
        false
    }

    #[cfg(target_os = "linux")]
    {
        // Linux: check /sys/class/power_supply/BAT0/status
        if let Ok(status) = std::fs::read_to_string("/sys/class/power_supply/BAT0/status") {
            return status.trim() == "Discharging";
        }
        // WSL or desktop without battery
        false
    }

    #[cfg(target_os = "macos")]
    {
        // macOS: pmset -g batt
        if let Ok(output) = std::process::Command::new("pmset").args(["-g", "batt"]).output() {
            let text = String::from_utf8_lossy(&output.stdout);
            return text.contains("Battery Power");
        }
        false
    }

    #[cfg(not(any(target_os = "windows", target_os = "linux", target_os = "macos")))]
    {
        false
    }
}

// ── Learned Circadian Profile ─────────────────────────────────────────────────
//
// A 24-slot array where each slot is the probability (0.0-1.0) that the user
// is active at that hour. Built from the last 14 days of activity_monitor data.
//
// For a user who works 12pm-3am:
//   hours 4-11: ~0.05 (asleep)
//   hour 12: ~0.4 (waking up)
//   hours 13-2: ~0.8 (peak work)
//   hour 3: ~0.3 (winding down)
//
// Cached in SQLite settings to avoid recomputing every 60s tick.
// Recomputed once per day (or on first run).

const CIRCADIAN_DB_KEY: &str = "circadian_profile";
const CIRCADIAN_RECOMPUTE_INTERVAL: i64 = 86400; // 24 hours

/// Returns a 24-element array of activity probabilities per hour.
/// Falls back to a flat 0.5 profile if no data is available.
fn load_circadian_profile() -> [f32; 24] {
    // Try cached profile first
    if let Some((profile, computed_at)) = load_cached_profile() {
        let now = chrono::Utc::now().timestamp();
        if now - computed_at < CIRCADIAN_RECOMPUTE_INTERVAL {
            return profile;
        }
    }

    // Recompute from activity_monitor data
    let profile = compute_circadian_from_activity();

    // Cache it
    save_cached_profile(&profile);

    profile
}

/// Compute circadian profile from the last 14 days of activity_monitor rows.
/// Each row has a timestamp + app_name. We count how many 30s observations
/// fell in each hour slot, then normalize to 0.0-1.0.
fn compute_circadian_from_activity() -> [f32; 24] {
    let db_path = crate::config::blade_config_dir().join("blade.db");
    let conn = match rusqlite::Connection::open(&db_path) {
        Ok(c) => c,
        Err(_) => return [0.5; 24], // no data — flat profile
    };

    let cutoff = chrono::Utc::now().timestamp() - (14 * 86400); // 14 days

    // Count observations per hour of day (local time)
    // We store UTC timestamps, so we convert to local hour in SQL
    let mut hour_counts = [0u32; 24];
    let mut total_days_observed = 0u32;

    // Get all timestamps from activity_monitor in the last 14 days
    let mut stmt = match conn.prepare(
        "SELECT timestamp FROM activity_monitor WHERE timestamp > ?1"
    ) {
        Ok(s) => s,
        Err(_) => return [0.5; 24],
    };

    let timestamps: Vec<i64> = stmt
        .query_map(rusqlite::params![cutoff], |row| row.get::<_, i64>(0))
        .ok()
        .map(|rows| rows.filter_map(|r| r.ok()).collect())
        .unwrap_or_default();

    if timestamps.is_empty() {
        return [0.5; 24]; // no data — flat profile
    }

    // Track which days we have data for
    let mut days_seen = std::collections::HashSet::new();

    for ts in &timestamps {
        if let Some(dt) = chrono::DateTime::from_timestamp(*ts, 0) {
            let local = dt.with_timezone(&chrono::Local);
            let hour = local.format("%H").to_string().parse::<usize>().unwrap_or(0);
            let day = local.format("%Y-%m-%d").to_string();
            hour_counts[hour] += 1;
            days_seen.insert(day);
        }
    }

    total_days_observed = days_seen.len() as u32;
    if total_days_observed == 0 {
        return [0.5; 24];
    }

    // Normalize: for each hour, probability = observations / (days * max_observations_per_hour)
    // Each hour can have at most 120 observations per day (30s intervals × 60 min)
    let max_per_hour_per_day = 120.0f32;
    let mut profile = [0.0f32; 24];

    for h in 0..24 {
        let raw = hour_counts[h] as f32 / (total_days_observed as f32 * max_per_hour_per_day);
        profile[h] = raw.clamp(0.0, 1.0);
    }

    // Smooth: apply a simple 3-hour moving average to reduce noise
    let mut smoothed = [0.0f32; 24];
    for h in 0..24 {
        let prev = if h == 0 { 23 } else { h - 1 };
        let next = if h == 23 { 0 } else { h + 1 };
        smoothed[h] = (profile[prev] * 0.2 + profile[h] * 0.6 + profile[next] * 0.2).clamp(0.0, 1.0);
    }

    smoothed
}

fn load_cached_profile() -> Option<([f32; 24], i64)> {
    let db_path = crate::config::blade_config_dir().join("blade.db");
    let conn = rusqlite::Connection::open(&db_path).ok()?;
    let json: String = conn.query_row(
        "SELECT value FROM settings WHERE key = ?1",
        rusqlite::params![CIRCADIAN_DB_KEY],
        |row| row.get(0),
    ).ok()?;

    #[derive(Deserialize)]
    struct CachedProfile {
        profile: [f32; 24],
        computed_at: i64,
    }

    let cached: CachedProfile = serde_json::from_str(&json).ok()?;
    Some((cached.profile, cached.computed_at))
}

fn save_cached_profile(profile: &[f32; 24]) {
    let db_path = crate::config::blade_config_dir().join("blade.db");
    if let Ok(conn) = rusqlite::Connection::open(&db_path) {
        let data = serde_json::json!({
            "profile": profile,
            "computed_at": chrono::Utc::now().timestamp(),
        });
        if let Ok(json) = serde_json::to_string(&data) {
            let _ = conn.execute(
                "INSERT INTO settings (key, value) VALUES (?1, ?2)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                rusqlite::params![CIRCADIAN_DB_KEY, json],
            );
        }
    }
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

// ── Pituitary Gland: translate hormones → per-module directives ──────────────
//
// The hypothalamus produces abstract state (arousal, energy, trust...).
// Individual modules don't know what "energy 0.3" means for THEM.
// The pituitary translates into concrete settings per module.

/// Directive for a specific module — what it should do right now.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModuleDirective {
    /// Which LLM tier to use: "quality" | "balanced" | "cheap" | "skip"
    pub model_tier: String,
    /// How frequently to poll/tick (multiplier: 1.0 = normal, 0.5 = half, 2.0 = double)
    pub poll_rate: f32,
    /// Whether to run expensive operations (LLM calls, web fetches, etc.)
    pub allow_expensive_ops: bool,
    /// Whether to act autonomously or ask first
    pub autonomous: bool,
    /// One-line reason for these settings (for debugging/display)
    pub reason: String,
}

/// GH (Growth Hormone) — should BLADE actively seek new capabilities?
pub fn growth_hormone() -> f32 {
    let h = get_hormones();
    // Grow when: energy is high, user is idle (exploration opportunity), trust is decent
    let base = h.exploration * 0.5 + h.energy_mode * 0.3 + h.trust * 0.2;
    base.clamp(0.0, 1.0)
}

/// TSH (Thyroid-Stimulating) — how aggressively should background modules run?
pub fn thyroid_stimulating() -> f32 {
    let h = get_hormones();
    // High metabolism when: energy is high, arousal is moderate (not sleeping, not panicking)
    let base = h.energy_mode * 0.6 + (1.0 - h.urgency.abs()) * 0.2 + h.arousal * 0.2;
    base.clamp(0.0, 1.0)
}

/// ACTH — how cautious should decision-making be?
/// High ACTH = high cortisol = more cautious
pub fn acth() -> f32 {
    let h = get_hormones();
    // Cautious when: urgency is high (something's wrong), trust is low
    let base = h.urgency * 0.5 + (1.0 - h.trust) * 0.3 + (1.0 - h.exploration) * 0.2;
    base.clamp(0.0, 1.0)
}

/// Oxytocin — how personal/warm should BLADE be?
pub fn oxytocin() -> f32 {
    let h = get_hormones();
    // Warm when: trust is high, urgency is low (not in crisis mode)
    let base = h.trust * 0.6 + (1.0 - h.urgency) * 0.3 + h.arousal * 0.1;
    base.clamp(0.0, 1.0)
}

/// ADH (vasopressin) — how aggressively should BLADE conserve resources?
pub fn adh() -> f32 {
    let h = get_hormones();
    // Conserve when: energy is low, hunger is low (no urgent work needing resources)
    let base = (1.0 - h.energy_mode) * 0.5 + (1.0 - h.hunger) * 0.3 + h.thirst * 0.2;
    base.clamp(0.0, 1.0)
}

/// Get a concrete directive for a specific module based on current pituitary output.
/// Modules call this instead of reading raw hormones.
pub fn get_directive(module: &str) -> ModuleDirective {
    let tsh = thyroid_stimulating();
    let gh = growth_hormone();
    let cortisol = acth();
    let conserve = adh();
    let warmth = oxytocin();
    let h = get_hormones();

    match module {
        // Evolution: controlled by GH (growth) + energy
        "evolution" => ModuleDirective {
            model_tier: if gh > 0.6 { "balanced" } else { "skip" }.to_string(),
            poll_rate: gh,
            allow_expensive_ops: gh > 0.4 && h.energy_mode > 0.3,
            autonomous: h.trust > 0.5 && gh > 0.5,
            reason: format!("GH={:.1}, energy={:.1}", gh, h.energy_mode),
        },

        // Hive tentacles: controlled by TSH (metabolism) + arousal
        "hive" | "tentacle" => ModuleDirective {
            model_tier: if tsh > 0.6 { "balanced" } else { "cheap" }.to_string(),
            poll_rate: (tsh * 1.5).clamp(0.3, 2.0), // 0.3x to 2x normal rate
            allow_expensive_ops: tsh > 0.5,
            autonomous: h.trust > 0.6,
            reason: format!("TSH={:.1}, arousal={:.1}", tsh, h.arousal),
        },

        // Brain planner: energy determines model quality
        "brain_planner" => ModuleDirective {
            model_tier: if h.energy_mode > 0.7 { "quality" }
                else if h.energy_mode > 0.4 { "balanced" }
                else { "cheap" }.to_string(),
            poll_rate: 1.0, // always runs on demand
            allow_expensive_ops: h.energy_mode > 0.3,
            autonomous: false, // brain planner never acts autonomously
            reason: format!("energy={:.1}", h.energy_mode),
        },

        // Decision gate: ACTH controls caution level
        "decision_gate" => ModuleDirective {
            model_tier: "cheap".to_string(), // decisions are always cheap
            poll_rate: 1.0,
            allow_expensive_ops: false,
            autonomous: cortisol < 0.4, // low cortisol = more autonomous
            reason: format!("ACTH={:.1}, trust={:.1}", cortisol, h.trust),
        },

        // Dream mode: runs during conservation (ADH high, arousal low)
        "dream_mode" => ModuleDirective {
            model_tier: "cheap".to_string(),
            poll_rate: if h.arousal < 0.3 { 1.5 } else { 0.5 }, // more active when idle
            allow_expensive_ops: conserve > 0.5 && h.arousal < 0.3,
            autonomous: true, // dream mode is always autonomous
            reason: format!("ADH={:.1}, arousal={:.1}", conserve, h.arousal),
        },

        // Persona/communication: oxytocin controls warmth
        "persona" | "communication" => ModuleDirective {
            model_tier: "balanced".to_string(),
            poll_rate: 1.0,
            allow_expensive_ops: true,
            autonomous: false,
            reason: format!("oxytocin={:.1}, trust={:.1}", warmth, h.trust),
        },

        // Background research: GH + low arousal (idle time)
        "research" => ModuleDirective {
            model_tier: if gh > 0.5 { "cheap" } else { "skip" }.to_string(),
            poll_rate: gh * 0.8,
            allow_expensive_ops: gh > 0.5 && h.arousal < 0.4,
            autonomous: true,
            reason: format!("GH={:.1}, arousal={:.1}", gh, h.arousal),
        },

        // Default: balanced, follow energy level
        _ => ModuleDirective {
            model_tier: if h.energy_mode > 0.5 { "balanced" } else { "cheap" }.to_string(),
            poll_rate: tsh,
            allow_expensive_ops: h.energy_mode > 0.4,
            autonomous: h.trust > 0.5,
            reason: format!("energy={:.1}, trust={:.1}", h.energy_mode, h.trust),
        },
    }
}

// ── Tauri Commands ───────────────────────────────────────────────────────────

#[tauri::command]
pub fn homeostasis_get() -> HormoneState {
    get_hormones()
}

#[tauri::command]
pub fn homeostasis_get_directive(module: String) -> ModuleDirective {
    get_directive(&module)
}

/// Returns the learned 24-hour circadian profile.
/// Each element is the probability (0.0-1.0) the user is active at that hour.
/// Index 0 = midnight, index 12 = noon, index 23 = 11pm.
#[tauri::command]
pub fn homeostasis_get_circadian() -> Vec<f32> {
    load_circadian_profile().to_vec()
}

/// Force recompute the circadian profile from activity data.
/// Useful after first week of use or if schedule changed.
#[tauri::command]
pub fn homeostasis_relearn_circadian() -> Vec<f32> {
    let profile = compute_circadian_from_activity();
    save_cached_profile(&profile);
    profile.to_vec()
}

use tauri::Emitter;
