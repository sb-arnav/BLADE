//! Phase 29 / VITA-01..06 -- Vitality engine.
//!
//! Scalar 0.0-1.0 with 5 behavioral bands (Thriving/Waning/Declining/Critical/Dormant).
//! Replenishes from SDT signals (competence/autonomy/relatedness).
//! Drains from failures, isolation, prediction error, tedium.
//! Dormancy at 0.0 = process exit with state preserved; reincarnation on next launch.
//!
//! This file is the Wave 0 TYPE SKELETON -- all function bodies return defaults.
//! Plan 01 fills in real computation; Plan 02 wires behavioral band effects.

use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};

// ── Enums ──────────────────────────────────────────────────────────────────────

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

// ── Structs ────────────────────────────────────────────────────────────────────

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
}

impl Default for VitalityState {
    fn default() -> Self {
        Self {
            scalar: 0.8,
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
        }
    }
}

// ── Global state ───────────────────────────────────────────────────────────────

static VITALITY: OnceLock<Mutex<VitalityState>> = OnceLock::new();

/// When true, dormancy logs intent but does not call process::exit.
/// Test fixtures set this before any code that could reach the dormancy path.
pub static DORMANCY_STUB: AtomicBool = AtomicBool::new(false);

static VITALITY_APP: OnceLock<tauri::AppHandle> = OnceLock::new();

fn vitality_store() -> &'static Mutex<VitalityState> {
    VITALITY.get_or_init(|| Mutex::new(VitalityState::default()))
}

// ── Public API (stub bodies -- Plan 01 fills in real logic) ────────────────────

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
}

/// Main tick function -- called from hypothalamus_tick() every 60s.
/// Stub: does nothing yet. Plan 01 fills in real computation:
/// reads SDT signals, computes drain, applies band transitions, persists.
pub fn vitality_tick() {
    // Stub -- Plan 01 fills in real computation
}

/// Apply a drain amount from an external source (e.g., safety_eval_drain).
pub fn apply_drain(amount: f32, _source: &str) {
    if let Ok(mut state) = vitality_store().lock() {
        state.scalar = (state.scalar - amount).clamp(0.0, 1.0);
    }
}

/// Check if reincarnation is needed (dormancy_record with reincarnation_completed=false).
/// Stub: does nothing yet. Plan 01 fills in real logic.
pub fn check_reincarnation(_app: tauri::AppHandle) {
    // Stub -- Plan 01 fills in real logic
}

/// Test-only: set the entire vitality state for deterministic fixtures.
#[cfg(test)]
pub fn set_vitality_for_test(state: VitalityState) {
    if let Ok(mut guard) = vitality_store().lock() {
        *guard = state;
    }
}

// ── Band computation (stub -- Plan 01 adds hysteresis) ─────────────────────────

fn initial_band_from_scalar(scalar: f32) -> VitalityBand {
    if scalar >= 0.6 {
        VitalityBand::Thriving
    } else if scalar >= 0.4 {
        VitalityBand::Waning
    } else if scalar >= 0.2 {
        VitalityBand::Declining
    } else if scalar >= 0.1 {
        VitalityBand::Critical
    } else {
        VitalityBand::Dormant
    }
}

#[allow(dead_code)]
fn compute_band(scalar: f32, _current_band: &VitalityBand) -> VitalityBand {
    // Stub -- returns initial_band_from_scalar for now; Plan 01 adds hysteresis
    initial_band_from_scalar(scalar)
}

// ── Tauri commands (stub bodies -- wired into generate_handler! by Plan 01) ────

#[tauri::command]
pub async fn vitality_get_state() -> Result<String, String> {
    Ok(serde_json::to_string(&get_vitality()).unwrap_or_default())
}

#[tauri::command]
pub async fn vitality_get_history() -> Result<String, String> {
    let v = get_vitality();
    Ok(serde_json::to_string(&v.history).unwrap_or_default())
}

#[tauri::command]
pub async fn vitality_force_dormancy(_app: tauri::AppHandle) -> Result<String, String> {
    Ok("stub".to_string())
}
