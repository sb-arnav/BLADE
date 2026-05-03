//! Phase 29 / VITA-01..06 -- Vitality engine.
//!
//! Scalar 0.0-1.0 with 5 behavioral bands (Thriving/Waning/Declining/Critical/Dormant).
//! Replenishes from SDT signals (competence/autonomy/relatedness).
//! Drains from failures, isolation, prediction error, tedium.
//! Dormancy at 0.0 = process exit with state preserved; reincarnation on next launch.

use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use tauri::Emitter;

// ── Constants ─────────────────────────────────────────────────────────────────

const HISTORY_RING_MAX: usize = 100;
const VITALITY_HISTORY_DB_CAP: usize = 5000;
const HYSTERESIS_BUFFER: f32 = 0.05;
const FRESH_INSTALL_VITALITY: f32 = 0.8;
const REINCARNATION_START_VITALITY: f32 = 0.3;

/// Drain multiplier: ensures max drain per tick ~0.01 so 1.0->0.0 takes ~2+ hours.
const DRAIN_SCALE: f32 = 0.025;
/// Replenishment scale: max replenishment per tick ~0.01.
const REPLENISHMENT_SCALE: f32 = 0.01;

// ── Enums ─────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum VitalityBand {
    Thriving,
    Waning,
    Declining,
    Critical,
    Dormant,
}

impl Default for VitalityBand {
    fn default() -> Self {
        VitalityBand::Thriving
    }
}

// ── Structs ───────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SDTSignals {
    pub competence: f32,
    pub autonomy: f32,
    pub relatedness: f32,
    pub net: f32,
}

impl Default for SDTSignals {
    fn default() -> Self {
        Self {
            competence: 0.0,
            autonomy: 0.0,
            relatedness: 0.0,
            net: 0.0,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DrainSignals {
    pub failure: f32,
    pub eval_failure: f32,
    pub isolation: f32,
    pub prediction_error: f32,
    pub tedium: f32,
    pub net: f32,
}

impl Default for DrainSignals {
    fn default() -> Self {
        Self {
            failure: 0.0,
            eval_failure: 0.0,
            isolation: 0.0,
            prediction_error: 0.0,
            tedium: 0.0,
            net: 0.0,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VitalitySnapshot {
    pub timestamp: i64,
    pub scalar: f32,
    pub band: VitalityBand,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VitalityState {
    pub scalar: f32,
    pub band: VitalityBand,
    pub trend: f32,
    pub replenishment: SDTSignals,
    pub drain: DrainSignals,
    pub history: VecDeque<VitalitySnapshot>,
    pub last_updated: i64,
    pub reincarnation_count: u32,
    pub last_dormancy_at: Option<i64>,
    pub sustained_high_error_ticks: u32,
    pub needs_reincarnation_context: bool,
    /// Accumulated eval drain from safety_eval_drain() calls between ticks.
    #[serde(default)]
    pub pending_eval_drain: f32,
    /// Ticks spent at drain floor (scalar <= 0.05) with zero replenishment.
    #[serde(default)]
    pub consecutive_floor_ticks: u32,
    /// Cached last-5-messages hash for tedium embedding caching.
    #[serde(default)]
    pub last_tedium_hash: u64,
    /// Cached tedium embedding vectors (avoid recomputing when messages unchanged).
    #[serde(default, skip)]
    pub cached_tedium_embeddings: Option<Vec<Vec<f32>>>,
}

impl Default for VitalityState {
    fn default() -> Self {
        Self {
            scalar: FRESH_INSTALL_VITALITY,
            band: VitalityBand::Thriving,
            trend: 0.0,
            replenishment: SDTSignals::default(),
            drain: DrainSignals::default(),
            history: VecDeque::new(),
            last_updated: 0,
            reincarnation_count: 0,
            last_dormancy_at: None,
            sustained_high_error_ticks: 0,
            needs_reincarnation_context: false,
            pending_eval_drain: 0.0,
            consecutive_floor_ticks: 0,
            last_tedium_hash: 0,
            cached_tedium_embeddings: None,
        }
    }
}

// ── Global state ──────────────────────────────────────────────────────────────

static VITALITY: OnceLock<Mutex<VitalityState>> = OnceLock::new();

/// When true, dormancy logs intent but does not call process::exit.
/// Test fixtures set this before any code that could reach the dormancy path.
pub static DORMANCY_STUB: AtomicBool = AtomicBool::new(false);

static VITALITY_APP: OnceLock<tauri::AppHandle> = OnceLock::new();

fn vitality_store() -> &'static Mutex<VitalityState> {
    VITALITY.get_or_init(|| Mutex::new(load_vitality_from_db().unwrap_or_default()))
}

// ── Public API ────────────────────────────────────────────────────────────────

/// Get a clone of the current vitality state.
pub fn get_vitality() -> VitalityState {
    vitality_store()
        .lock()
        .map(|v| v.clone())
        .unwrap_or_default()
}

/// Enable the dormancy stub so tests never call process::exit.
pub fn enable_dormancy_stub() {
    DORMANCY_STUB.store(true, Ordering::SeqCst);
}

/// Start the vitality engine (stores AppHandle for event emission).
/// Called once from `run()` in lib.rs after setup.
pub fn start_vitality_engine(app: tauri::AppHandle) {
    let _ = VITALITY_APP.set(app);
    // Ensure store is initialized (triggers DB load if first access)
    let _ = vitality_store();
}

/// Apply a drain amount from an external source (e.g., safety_eval_drain).
/// Accumulates into pending_eval_drain -- consumed on next vitality_tick().
pub fn apply_drain(amount: f32, source: &str) {
    if let Ok(mut state) = vitality_store().lock() {
        state.pending_eval_drain += amount.clamp(0.0, 1.0);
        log::debug!(
            "[vitality] apply_drain({:.3}, {}) -- pending_eval_drain={:.3}",
            amount,
            source,
            state.pending_eval_drain
        );
    }
}

/// Check if reincarnation is needed (dormancy_record with reincarnation_completed=0).
/// Runs once on startup from lib.rs.
pub fn check_reincarnation(app: tauri::AppHandle) {
    let db_path = crate::config::blade_config_dir().join("blade.db");
    let conn = match rusqlite::Connection::open(&db_path) {
        Ok(c) => c,
        Err(_) => return,
    };

    // Check for pending dormancy records
    let has_pending: bool = conn
        .query_row(
            "SELECT COUNT(*) FROM dormancy_records WHERE reincarnation_completed = 0",
            [],
            |row| row.get::<_, i64>(0),
        )
        .unwrap_or(0)
        > 0;

    if !has_pending {
        return;
    }

    log::info!("[vitality] Reincarnation detected -- resetting hormones, starting at {}", REINCARNATION_START_VITALITY);

    // Reset hormones to defaults (D-18: affect resets, memory doesn't)
    // PhysiologicalState and HormoneState reset to defaults
    if let Ok(mut guard) = vitality_store().lock() {
        guard.scalar = REINCARNATION_START_VITALITY;
        guard.band = initial_band_from_scalar(REINCARNATION_START_VITALITY);
        guard.reincarnation_count += 1;
        guard.needs_reincarnation_context = true;
        guard.trend = 0.0;
        guard.sustained_high_error_ticks = 0;
        guard.pending_eval_drain = 0.0;
        guard.consecutive_floor_ticks = 0;
        guard.last_dormancy_at = Some(chrono::Utc::now().timestamp());
        persist_vitality(&guard);
    }

    // Mark reincarnation complete in dormancy_records
    let _ = conn.execute(
        "UPDATE dormancy_records SET reincarnation_completed = 1 WHERE reincarnation_completed = 0",
        [],
    );

    // Emit reincarnation event
    let _ = app.emit_to(
        "main",
        "blade_reincarnation",
        serde_json::json!({
            "reincarnation_count": get_vitality().reincarnation_count,
            "vitality_start": REINCARNATION_START_VITALITY,
            "memories_intact": true,
        }),
    );

    // Emit ActivityStrip event
    let summary = format!(
        "BLADE reincarnated (#{}) -- starting at vitality {:.2}",
        get_vitality().reincarnation_count,
        REINCARNATION_START_VITALITY
    );
    let _ = app.emit_to(
        "main",
        "blade_activity_log",
        serde_json::json!({
            "module":        "vitality_engine",
            "action":        "reincarnation",
            "human_summary": crate::safe_slice(&summary, 200),
            "payload_id":    serde_json::Value::Null,
            "timestamp":     chrono::Utc::now().timestamp(),
        }),
    );
}

/// Main tick function -- called from hypothalamus_tick() every 60s.
/// Reads SDT signals, computes drain, applies band transitions, persists.
pub fn vitality_tick() {
    let now = chrono::Utc::now().timestamp();

    // Step 1: Compute SDT replenishment
    let sdt = compute_replenishment();

    // Step 2: Compute drain (needs mutable access to read pending_eval_drain)
    // compute_drain returns (DrainSignals, DrainDeferred) -- deferred fields
    // are written back in Step 7 to avoid re-entrant lock deadlock (T-29-15 fix).
    let (drain, drain_deferred, old_scalar, old_band) = {
        let guard = match vitality_store().lock() {
            Ok(g) => g,
            Err(_) => return,
        };
        let (d, deferred) = compute_drain(&guard);
        (d, deferred, guard.scalar, guard.band)
    };

    // Step 3: Apply net delta
    let scaled_replenishment = sdt.net * REPLENISHMENT_SCALE;
    let scaled_drain = drain.net * DRAIN_SCALE;
    let net_delta = scaled_replenishment - scaled_drain;

    let mut new_scalar = old_scalar + net_delta;

    // NaN guard (T-29-02)
    if new_scalar.is_nan() {
        log::warn!("[vitality] NaN detected in scalar computation -- defaulting to 0.5");
        new_scalar = 0.5;
    }

    new_scalar = new_scalar.clamp(0.0, 1.0);

    // Step 4: Drain floor (D-16)
    let at_floor = new_scalar <= 0.05;
    let zero_replenishment = sdt.net <= 0.001;

    let mut floor_ticks = {
        vitality_store()
            .lock()
            .map(|g| g.consecutive_floor_ticks)
            .unwrap_or(0)
    };

    if at_floor && zero_replenishment {
        floor_ticks += 1;
    } else {
        floor_ticks = 0;
    }

    // Clamp to 0.05 unless 3+ consecutive ticks at floor with zero replenishment
    if new_scalar < 0.05 && floor_ticks < 3 {
        new_scalar = 0.05;
    }

    // Step 5: Compute band with hysteresis
    let new_band = compute_band(new_scalar, &old_band);

    // Step 6: Detect band change and compute trend
    let band_changed = new_band != old_band;
    let trend = new_scalar - old_scalar;

    // Step 7: Update state
    {
        let mut guard = match vitality_store().lock() {
            Ok(g) => g,
            Err(_) => return,
        };

        guard.scalar = new_scalar;
        guard.band = new_band;
        guard.trend = trend;
        guard.replenishment = sdt.clone();
        guard.drain = drain.clone();
        guard.last_updated = now;
        guard.consecutive_floor_ticks = floor_ticks;
        guard.sustained_high_error_ticks = drain_deferred.sustained_high_error_ticks;

        // Write back tedium embedding cache (deferred from compute_tedium_drain)
        if let Some((hash, embeddings)) = drain_deferred.tedium_cache {
            guard.last_tedium_hash = hash;
            guard.cached_tedium_embeddings = Some(embeddings);
        }

        // Reset pending_eval_drain (consumed by compute_drain)
        guard.pending_eval_drain = 0.0;

        // Push snapshot to ring buffer
        if guard.history.len() >= HISTORY_RING_MAX {
            guard.history.pop_front();
        }
        guard.history.push_back(VitalitySnapshot {
            timestamp: now,
            scalar: new_scalar,
            band: new_band,
        });

        // Persist to SQLite
        persist_vitality(&guard);
        persist_vitality_history(&guard);
    }

    // Step 8: Emit events (outside lock)
    if let Some(app) = VITALITY_APP.get() {
        // Emit ActivityStrip on band change
        if band_changed {
            emit_band_transition(app, old_band, new_band, new_scalar);
        }

        // Emit blade_vitality_update on band change or significant delta
        if band_changed || trend.abs() > 0.05 {
            emit_vitality_update(app, new_scalar, new_band, trend, &sdt, &drain);
        }

        // Step 9: If Dormant -> trigger dormancy
        if new_band == VitalityBand::Dormant {
            trigger_dormancy(app);
        }
    }

    log::trace!(
        "[vitality] tick: scalar={:.3} band={:?} trend={:+.4} sdt_net={:.3} drain_net={:.3}",
        new_scalar,
        new_band,
        trend,
        sdt.net,
        drain.net
    );
}

/// Test-only: set the entire vitality state for deterministic fixtures.
#[cfg(test)]
pub fn set_vitality_for_test(state: VitalityState) {
    if let Ok(mut guard) = vitality_store().lock() {
        *guard = state;
    }
}

// ── Band computation ──────────────────────────────────────────────────────────

/// Simple threshold-based band assignment (no hysteresis).
/// Used only on cold start / DB load.
fn initial_band_from_scalar(scalar: f32) -> VitalityBand {
    if scalar >= 0.6 {
        VitalityBand::Thriving
    } else if scalar >= 0.4 {
        VitalityBand::Waning
    } else if scalar >= 0.2 {
        VitalityBand::Declining
    } else if scalar > 0.0 {
        VitalityBand::Critical
    } else {
        VitalityBand::Dormant
    }
}

/// Hysteretic band transition (D-11).
/// Moving DOWN requires crossing the threshold.
/// Moving UP requires exceeding threshold + HYSTERESIS_BUFFER.
fn compute_band(scalar: f32, current_band: &VitalityBand) -> VitalityBand {
    match current_band {
        VitalityBand::Thriving => {
            if scalar < 0.6 {
                VitalityBand::Waning
            } else {
                VitalityBand::Thriving
            }
        }
        VitalityBand::Waning => {
            if scalar >= 0.6 + HYSTERESIS_BUFFER {
                VitalityBand::Thriving
            } else if scalar < 0.4 {
                VitalityBand::Declining
            } else {
                VitalityBand::Waning
            }
        }
        VitalityBand::Declining => {
            if scalar >= 0.4 + HYSTERESIS_BUFFER {
                VitalityBand::Waning
            } else if scalar < 0.2 {
                VitalityBand::Critical
            } else {
                VitalityBand::Declining
            }
        }
        VitalityBand::Critical => {
            if scalar >= 0.2 + HYSTERESIS_BUFFER {
                VitalityBand::Declining
            } else if scalar <= 0.0 {
                VitalityBand::Dormant
            } else {
                VitalityBand::Critical
            }
        }
        VitalityBand::Dormant => {
            // Dormant stays Dormant — only changed by reincarnation
            VitalityBand::Dormant
        }
    }
}

// ── SDT replenishment (D-12, D-13) ───────────────────────────────────────────

fn compute_replenishment() -> SDTSignals {
    let competence = compute_competence();
    let autonomy = compute_autonomy();
    let relatedness = compute_relatedness();

    let net = 0.4 * competence + 0.3 * autonomy + 0.3 * relatedness;

    SDTSignals {
        competence,
        autonomy,
        relatedness,
        net: net.clamp(0.0, 1.0),
    }
}

/// Competence: EMA over last 10 reward.rs composite scores.
/// Score > 0.7 = full competence signal.
fn compute_competence() -> f32 {
    let history = crate::reward::read_reward_history(10);
    let n = history.len() as f32;
    if n <= 0.0 {
        return 0.5; // neutral default
    }
    let avg_score = history.iter().map(|r| r.reward).sum::<f32>() / n;
    // Normalize: 0.7 = full competence
    (avg_score / 0.7_f32).clamp(0.0, 1.0)
}

/// Autonomy: ratio of ActAutonomously decisions not overridden, last 20 decisions.
fn compute_autonomy() -> f32 {
    let log = crate::decision_gate::get_decision_log();
    let recent: Vec<_> = log.iter().rev().take(20).collect();
    if recent.is_empty() {
        return 0.5; // neutral default
    }
    let act_not_overridden = recent
        .iter()
        .filter(|d| {
            matches!(
                &d.outcome,
                crate::decision_gate::DecisionOutcome::ActAutonomously { .. }
            ) && d.feedback != Some(false)
        })
        .count();
    (act_not_overridden as f32 / recent.len() as f32).clamp(0.0, 1.0)
}

/// Relatedness: composite of message frequency, positive reactions, avg message length.
/// Formula: 0.4 * msg_freq + 0.3 * reactions_norm + 0.3 * avg_len_signal
fn compute_relatedness() -> f32 {
    let db_path = crate::config::blade_config_dir().join("blade.db");
    let conn = match rusqlite::Connection::open(&db_path) {
        Ok(c) => c,
        Err(_) => return 0.0,
    };

    let now = chrono::Utc::now().timestamp();
    let one_hour_ago = now - 3600;

    // Message frequency in last hour (cap at 10 = 1.0)
    let msg_count: f32 = conn
        .query_row(
            "SELECT COUNT(*) FROM messages WHERE role = 'user' AND timestamp > ?1",
            rusqlite::params![one_hour_ago],
            |row| row.get::<_, i64>(0),
        )
        .unwrap_or(0) as f32;
    let msg_freq = (msg_count / 10.0).clamp(0.0, 1.0);

    // Positive reactions in last hour (polarity > 0, cap at 5 = 1.0)
    let positive_count: f32 = conn
        .query_row(
            "SELECT COUNT(*) FROM brain_reactions WHERE polarity > 0 AND created_at > ?1",
            rusqlite::params![one_hour_ago],
            |row| row.get::<_, i64>(0),
        )
        .unwrap_or(0) as f32;
    let reactions_norm = (positive_count / 5.0).clamp(0.0, 1.0);

    // Average message length in last hour (> 50 chars = 1.0)
    let avg_len: f32 = conn
        .query_row(
            "SELECT COALESCE(AVG(LENGTH(content)), 0) FROM messages WHERE role = 'user' AND timestamp > ?1",
            rusqlite::params![one_hour_ago],
            |row| row.get::<_, f64>(0),
        )
        .unwrap_or(0.0) as f32;
    let avg_len_signal = (avg_len / 50.0).clamp(0.0, 1.0);

    let relatedness = 0.4 * msg_freq + 0.3 * reactions_norm + 0.3 * avg_len_signal;
    relatedness.clamp(0.0, 1.0)
}

// ── Drain computation (D-14, D-15, D-16) ─────────────────────────────────────

/// Deferred state updates from compute_drain -- written back after lock release.
struct DrainDeferred {
    sustained_high_error_ticks: u32,
    tedium_cache: Option<(u64, Vec<Vec<f32>>)>,
}

/// Returns (DrainSignals, DrainDeferred).
/// The caller must write deferred fields back into state AFTER releasing the lock
/// (compute_drain is called while the VITALITY mutex is held, so it cannot
/// re-acquire the lock -- doing so would deadlock; T-29-15 fix).
fn compute_drain(state: &VitalityState) -> (DrainSignals, DrainDeferred) {
    let failure = compute_failure_drain();
    let eval_failure = state.pending_eval_drain.clamp(0.0, 1.0);
    let isolation = compute_isolation_drain();
    let (prediction_error, new_sustained) = compute_prediction_error_drain(state);
    let (tedium, tedium_cache) = compute_tedium_drain(state);

    let raw_net = failure + eval_failure + isolation + prediction_error + tedium;
    let net = raw_net;

    (DrainSignals {
        failure,
        eval_failure,
        isolation,
        prediction_error,
        tedium,
        net: net.clamp(0.0, f32::MAX), // unbounded sum, clamped at tick level
    }, DrainDeferred {
        sustained_high_error_ticks: new_sustained,
        tedium_cache,
    })
}

/// Failure drain: last reward composite < 0.3 => drain proportional to (0.3 - score).
fn compute_failure_drain() -> f32 {
    let history = crate::reward::read_reward_history(1);
    if let Some(last) = history.last() {
        if last.reward < 0.3 {
            return (0.3 - last.reward).clamp(0.0, 0.3);
        }
    }
    0.0
}

/// Isolation drain: no user message in last 2 hours => 0.01.
fn compute_isolation_drain() -> f32 {
    let db_path = crate::config::blade_config_dir().join("blade.db");
    let conn = match rusqlite::Connection::open(&db_path) {
        Ok(c) => c,
        Err(_) => return 0.0,
    };

    let now = chrono::Utc::now().timestamp();
    let two_hours_ago = now - 7200;

    let recent_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM messages WHERE role = 'user' AND timestamp > ?1",
            rusqlite::params![two_hours_ago],
            |row| row.get(0),
        )
        .unwrap_or(0);

    if recent_count == 0 {
        0.01
    } else {
        0.0
    }
}

/// Prediction error drain: aggregate_error > 0.6 sustained > 5 ticks.
/// Returns (drain_value, new_sustained_high_error_ticks).
/// The caller writes new_sustained back into state after releasing the lock
/// to avoid re-entrant lock deadlock (T-29-15 fix).
fn compute_prediction_error_drain(state: &VitalityState) -> (f32, u32) {
    let ai_state = crate::active_inference::get_active_inference_state();

    // Update sustained tick count
    let sustained = if ai_state.aggregate_error > 0.6 {
        state.sustained_high_error_ticks + 1
    } else {
        0
    };

    // Only drain after 5 sustained ticks
    let drain = if sustained > 5 {
        let excess = (sustained - 5).min(5) as f32;
        0.01 * excess
    } else {
        0.0
    };

    (drain, sustained)
}

/// Tedium drain: if last 5 user messages have avg pairwise cosine similarity > 0.85.
/// Returns (drain_value, Option<(hash, embeddings)>) -- the caller writes the cache
/// back into state after releasing the lock to avoid re-entrant deadlock (T-29-15 fix).
fn compute_tedium_drain(state: &VitalityState) -> (f32, Option<(u64, Vec<Vec<f32>>)>) {
    let db_path = crate::config::blade_config_dir().join("blade.db");
    let conn = match rusqlite::Connection::open(&db_path) {
        Ok(c) => c,
        Err(_) => return (0.0, None),
    };

    // Get last 5 user messages
    let mut stmt = match conn.prepare(
        "SELECT content FROM messages WHERE role = 'user' ORDER BY timestamp DESC LIMIT 5",
    ) {
        Ok(s) => s,
        Err(_) => return (0.0, None),
    };

    let messages: Vec<String> = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .ok()
        .map(|rows| rows.filter_map(|r| r.ok()).collect())
        .unwrap_or_default();

    // Guard: need at least 2 messages for pairwise comparison
    if messages.len() < 2 {
        return (0.0, None);
    }

    // Hash messages to check if cache is valid
    let hash = {
        use std::hash::{Hash, Hasher};
        let mut hasher = std::collections::hash_map::DefaultHasher::new();
        messages.hash(&mut hasher);
        hasher.finish()
    };

    // Truncate messages safely before embedding
    let safe_messages: Vec<String> = messages
        .iter()
        .map(|m| crate::safe_slice(m, 2000).to_string())
        .collect();

    // Get embeddings (use cache if messages unchanged)
    let embeddings = if hash == state.last_tedium_hash {
        if let Some(cached) = &state.cached_tedium_embeddings {
            cached.clone()
        } else {
            match crate::embeddings::embed_texts(&safe_messages) {
                Ok(e) => e,
                Err(_) => return (0.0, None),
            }
        }
    } else {
        match crate::embeddings::embed_texts(&safe_messages) {
            Ok(e) => e,
            Err(_) => return (0.0, None),
        }
    };

    // Compute average pairwise cosine similarity
    let n = embeddings.len();
    let mut total_sim = 0.0_f32;
    let mut pairs = 0_u32;
    for i in 0..n {
        for j in (i + 1)..n {
            total_sim += cosine_sim(&embeddings[i], &embeddings[j]);
            pairs += 1;
        }
    }

    if pairs == 0 {
        return (0.0, Some((hash, embeddings)));
    }

    let avg_sim = total_sim / pairs as f32;

    let drain = if avg_sim > 0.85 { 0.005 } else { 0.0 };
    (drain, Some((hash, embeddings)))
}

// ── Dormancy sequence (D-17) ─────────────────────────────────────────────────

fn trigger_dormancy(app: &tauri::AppHandle) {
    log::warn!("[vitality] Dormancy triggered -- vitality reached 0.0");

    // Step 1: Persist full state (already persisted in tick, but ensure final state)
    if let Ok(guard) = vitality_store().lock() {
        persist_vitality(&guard);
    }

    // Step 2: Emit blade_dormancy event to frontend
    let state = get_vitality();
    let _ = app.emit_to(
        "main",
        "blade_dormancy",
        serde_json::json!({
            "reincarnation_count": state.reincarnation_count,
            "top_drain_factors": top_drain_factors(&state.drain),
            "total_uptime_secs": 0,
            "vitality_at_dormancy": state.scalar,
        }),
    );

    // Step 3: Write dormancy_record to SQLite
    write_dormancy_record(&state);

    // Step 4: Emit ActivityStrip event
    let summary = format!(
        "BLADE entering dormancy (reincarnation #{}) -- vitality={:.2}",
        state.reincarnation_count, state.scalar
    );
    let _ = app.emit_to(
        "main",
        "blade_activity_log",
        serde_json::json!({
            "module":        "vitality_engine",
            "action":        "dormancy",
            "human_summary": crate::safe_slice(&summary, 200),
            "payload_id":    serde_json::Value::Null,
            "timestamp":     chrono::Utc::now().timestamp(),
        }),
    );

    // Step 5: DORMANCY_STUB guard
    if DORMANCY_STUB.load(Ordering::SeqCst) {
        log::warn!("[vitality] DORMANCY_STUB active -- skipping std::process::exit(0)");
        return;
    }

    // Production: grace period then exit
    std::thread::sleep(std::time::Duration::from_secs(5));
    std::process::exit(0);
}

// ── SQLite persistence ────────────────────────────────────────────────────────

fn db_path() -> std::path::PathBuf {
    crate::config::blade_config_dir().join("blade.db")
}

fn load_vitality_from_db() -> Option<VitalityState> {
    let conn = rusqlite::Connection::open(db_path()).ok()?;

    let row = conn.query_row(
        "SELECT scalar, band, trend, sdt_signals, drain_signals, reincarnation_count, last_dormancy_at, updated_at FROM vitality_state WHERE id = 1",
        [],
        |row| {
            Ok((
                row.get::<_, f64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, f64>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, i64>(5)?,
                row.get::<_, Option<i64>>(6)?,
                row.get::<_, i64>(7)?,
            ))
        },
    ).ok()?;

    let scalar = row.0 as f32;
    let band_str = row.1;
    let trend = row.2 as f32;
    let sdt: SDTSignals = serde_json::from_str(&row.3).unwrap_or_default();
    let drain: DrainSignals = serde_json::from_str(&row.4).unwrap_or_default();
    let reincarnation_count = row.5 as u32;
    let last_dormancy_at = row.6;
    let last_updated = row.7;

    let band = match band_str.as_str() {
        "Thriving" => VitalityBand::Thriving,
        "Waning" => VitalityBand::Waning,
        "Declining" => VitalityBand::Declining,
        "Critical" => VitalityBand::Critical,
        "Dormant" => VitalityBand::Dormant,
        _ => initial_band_from_scalar(scalar),
    };

    Some(VitalityState {
        scalar,
        band,
        trend,
        replenishment: sdt,
        drain,
        history: VecDeque::new(), // history is loaded separately if needed
        last_updated,
        reincarnation_count,
        last_dormancy_at,
        sustained_high_error_ticks: 0,
        needs_reincarnation_context: false,
        pending_eval_drain: 0.0,
        consecutive_floor_ticks: 0,
        last_tedium_hash: 0,
        cached_tedium_embeddings: None,
    })
}

fn persist_vitality(state: &VitalityState) {
    let conn = match rusqlite::Connection::open(db_path()) {
        Ok(c) => c,
        Err(_) => return,
    };

    let sdt_json = serde_json::to_string(&state.replenishment).unwrap_or_default();
    let drain_json = serde_json::to_string(&state.drain).unwrap_or_default();
    let now = chrono::Utc::now().timestamp();
    let band_str = format!("{:?}", state.band);

    let _ = conn.execute(
        "INSERT INTO vitality_state (id, scalar, band, trend, sdt_signals, drain_signals, reincarnation_count, last_dormancy_at, updated_at)
         VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
         ON CONFLICT(id) DO UPDATE SET
            scalar = excluded.scalar,
            band = excluded.band,
            trend = excluded.trend,
            sdt_signals = excluded.sdt_signals,
            drain_signals = excluded.drain_signals,
            reincarnation_count = excluded.reincarnation_count,
            last_dormancy_at = excluded.last_dormancy_at,
            updated_at = excluded.updated_at",
        rusqlite::params![
            state.scalar as f64,
            band_str,
            state.trend as f64,
            sdt_json,
            drain_json,
            state.reincarnation_count as i64,
            state.last_dormancy_at,
            now
        ],
    );
}

fn persist_vitality_history(state: &VitalityState) {
    let conn = match rusqlite::Connection::open(db_path()) {
        Ok(c) => c,
        Err(_) => return,
    };

    let now = chrono::Utc::now().timestamp();
    let band_str = format!("{:?}", state.band);
    let factor = top_factor(&state.replenishment, &state.drain);

    // FIFO prune before insert (T-29-03: cap at VITALITY_HISTORY_DB_CAP)
    let limit = (VITALITY_HISTORY_DB_CAP - 1) as i64;
    let _ = conn.execute(
        "DELETE FROM vitality_history WHERE id NOT IN (SELECT id FROM vitality_history ORDER BY id DESC LIMIT ?1)",
        rusqlite::params![limit],
    );

    let _ = conn.execute(
        "INSERT INTO vitality_history (timestamp, scalar, band, top_factor) VALUES (?1, ?2, ?3, ?4)",
        rusqlite::params![now, state.scalar as f64, band_str, factor],
    );
}

fn write_dormancy_record(state: &VitalityState) {
    let conn = match rusqlite::Connection::open(db_path()) {
        Ok(c) => c,
        Err(_) => return,
    };

    let now = chrono::Utc::now().timestamp();

    // Serialize descent history from ring buffer
    let descent_json = serde_json::to_string(&state.history).unwrap_or_else(|_| "[]".to_string());
    let drain_factors_json = serde_json::to_string(&top_drain_factors(&state.drain))
        .unwrap_or_else(|_| "[]".to_string());

    let _ = conn.execute(
        "INSERT INTO dormancy_records (timestamp, descent_history, top_drain_factors, session_count, reincarnation_completed)
         VALUES (?1, ?2, ?3, ?4, 0)",
        rusqlite::params![now, descent_json, drain_factors_json, 0_i64],
    );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/// Inlined cosine similarity (embeddings.rs cosine_similarity is private).
/// dot(a,b) / (mag(a) * mag(b)) with zero-vector guard.
fn cosine_sim(a: &[f32], b: &[f32]) -> f32 {
    if a.len() != b.len() || a.is_empty() {
        return 0.0;
    }
    let dot: f32 = a.iter().zip(b.iter()).map(|(x, y)| x * y).sum();
    let mag_a: f32 = a.iter().map(|x| x * x).sum::<f32>().sqrt();
    let mag_b: f32 = b.iter().map(|x| x * x).sum::<f32>().sqrt();
    if mag_a == 0.0 || mag_b == 0.0 {
        return 0.0;
    }
    dot / (mag_a * mag_b)
}

/// Determine the top contributing factor (for vitality_history top_factor column).
fn top_factor(replenishment: &SDTSignals, drain: &DrainSignals) -> String {
    let mut best = ("competence", replenishment.competence);

    if replenishment.autonomy > best.1 {
        best = ("autonomy", replenishment.autonomy);
    }
    if replenishment.relatedness > best.1 {
        best = ("relatedness", replenishment.relatedness);
    }

    // Check if drain dominates
    let max_drain_val = drain
        .failure
        .max(drain.eval_failure)
        .max(drain.isolation)
        .max(drain.prediction_error)
        .max(drain.tedium);

    if max_drain_val > best.1 {
        // Which drain is highest?
        if drain.failure >= max_drain_val {
            return "failure".to_string();
        }
        if drain.eval_failure >= max_drain_val {
            return "eval_failure".to_string();
        }
        if drain.isolation >= max_drain_val {
            return "isolation".to_string();
        }
        if drain.prediction_error >= max_drain_val {
            return "prediction_error".to_string();
        }
        if drain.tedium >= max_drain_val {
            return "tedium".to_string();
        }
    }

    best.0.to_string()
}

/// Get the top drain factor names for dormancy records.
fn top_drain_factors(drain: &DrainSignals) -> Vec<String> {
    let mut factors: Vec<(&str, f32)> = vec![
        ("failure", drain.failure),
        ("eval_failure", drain.eval_failure),
        ("isolation", drain.isolation),
        ("prediction_error", drain.prediction_error),
        ("tedium", drain.tedium),
    ];
    factors.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    factors
        .iter()
        .filter(|(_, v)| *v > 0.0)
        .map(|(name, _)| name.to_string())
        .collect()
}

fn emit_band_transition(app: &tauri::AppHandle, old: VitalityBand, new: VitalityBand, scalar: f32) {
    let summary = format!(
        "Vitality entered {:?} band (was {:?}, scalar={:.2})",
        new, old, scalar
    );
    let _ = app.emit_to(
        "main",
        "blade_activity_log",
        serde_json::json!({
            "module":        "vitality_engine",
            "action":        "band_transition",
            "human_summary": crate::safe_slice(&summary, 200),
            "payload_id":    serde_json::Value::Null,
            "timestamp":     chrono::Utc::now().timestamp(),
        }),
    );
}

fn emit_vitality_update(
    app: &tauri::AppHandle,
    scalar: f32,
    band: VitalityBand,
    trend: f32,
    sdt: &SDTSignals,
    drain: &DrainSignals,
) {
    let factor = top_factor(sdt, drain);
    let _ = app.emit_to(
        "main",
        "blade_vitality_update",
        serde_json::json!({
            "scalar": scalar,
            "band": format!("{:?}", band),
            "trend": trend,
            "top_factor": factor,
        }),
    );
}

// ── Tauri commands ────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn vitality_get_state() -> Result<String, String> {
    Ok(serde_json::to_string(&get_vitality()).unwrap_or_default())
}

#[tauri::command]
pub async fn vitality_get_history() -> Result<String, String> {
    // Return both in-memory ring buffer and recent DB history
    let state = get_vitality();
    Ok(serde_json::to_string(&state.history).unwrap_or_default())
}

#[tauri::command]
pub async fn vitality_force_dormancy(app: tauri::AppHandle) -> Result<String, String> {
    // Set scalar to 0.0 and trigger dormancy
    if let Ok(mut guard) = vitality_store().lock() {
        guard.scalar = 0.0;
        guard.band = VitalityBand::Dormant;
        persist_vitality(&guard);
    }

    trigger_dormancy(&app);
    Ok("dormancy_triggered".to_string())
}
