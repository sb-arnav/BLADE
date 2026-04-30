//! Doctor module — central diagnostic aggregator (Phase 17 / DOCTOR-01..10).
//!
//! Aggregates 5 signal classes (EvalScores | CapabilityGaps | TentacleHealth
//! | ConfigDrift | AutoUpdate) into a unified surface backed by 3 Tauri
//! commands and 1 Tauri event (`doctor_event`).
//!
//! Architecture per .planning/phases/17-doctor-module/17-CONTEXT.md
//! decisions D-01..D-21 (LOCKED). Sources self-classify (D-02); doctor.rs
//! is the aggregator + cache holder + transition detector + event emitter.
//!
//! Plan 17-02 ships the SKELETON: enums + struct + 3 stubbed commands +
//! prior-severity cache + exhaustive 15-arm suggested-fix match. Plans
//! 17-03 / 17-04 fill in signal-source bodies and the verbatim D-18
//! suggested-fix strings.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
// `Emitter` is imported eagerly because Plan 17-04 wires `app.emit("doctor_event", ...)`
// directly on top of this module without re-touching the import block. Keeping it
// here in Plan 17-02 keeps the diff for Plan 17-04 a pure additive insert.
#[allow(unused_imports)]
use tauri::{AppHandle, Emitter};

// ── Locked enum + struct definitions (CONTEXT D-02 / D-03 / D-04) ─────────────

/// Signal classes aggregated by Doctor (D-03). Wire form is `snake_case` so
/// the TS literal union in `src/lib/events/payloads.ts` (Plan 17-05) matches
/// exactly: `eval_scores | capability_gaps | tentacle_health | config_drift |
/// auto_update`. The `Hash + Eq + Copy` derives are required because this
/// type is used as a `HashMap<SignalClass, Severity>` key in PRIOR_SEVERITY.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum SignalClass {
    EvalScores,
    CapabilityGaps,
    TentacleHealth,
    ConfigDrift,
    AutoUpdate,
}

/// Severity tiers (D-04). Wire form is `lowercase` so the UI's
/// `data-severity="green|amber|red"` attribute matches exactly.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "lowercase")]
pub enum Severity {
    Green,
    Amber,
    Red,
}

/// One diagnostic signal record (D-02). `payload` is `serde_json::Value`
/// because each `SignalClass` has its own per-variant shape (eval scores
/// vs capability gaps vs tentacle heartbeats — no shared schema).
///
/// `last_changed_at` is unix milliseconds (matches the `doctor_event`
/// payload schema in CONTEXT § specifics).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DoctorSignal {
    pub class: SignalClass,
    pub severity: Severity,
    pub payload: serde_json::Value,
    pub last_changed_at: i64,
    pub suggested_fix: String,
}

// ── Static state holders ──────────────────────────────────────────────────────

/// Prior-severity map for transition detection (D-20). Plan 17-04 reads this
/// before each `doctor_run_full_check` to decide whether to emit
/// `doctor_event`. Plan 17-02 only initializes the cache lazily (smoke test
/// + symbol exists); Plan 17-04 wires the actual transition logic.
#[allow(dead_code)]
static PRIOR_SEVERITY: OnceLock<Mutex<HashMap<SignalClass, Severity>>> = OnceLock::new();

/// Last-cached run result (D-19 `doctor_get_recent` reads from this).
static LAST_RUN: OnceLock<Mutex<Vec<DoctorSignal>>> = OnceLock::new();

#[allow(dead_code)]
fn prior_severity_map() -> &'static Mutex<HashMap<SignalClass, Severity>> {
    PRIOR_SEVERITY.get_or_init(|| Mutex::new(HashMap::new()))
}

fn last_run_cache() -> &'static Mutex<Vec<DoctorSignal>> {
    LAST_RUN.get_or_init(|| Mutex::new(Vec::new()))
}

// ── Suggested-fix table (D-18) ────────────────────────────────────────────────

/// Suggested-fix copy table per (class, severity). Verbatim strings from
/// UI-SPEC § 15 land in Plan 17-04; Plan 17-02 ships placeholders so the
/// match is exhaustive over all 15 (class × severity) pairs and `cargo
/// check` doesn't warn about non-exhaustive arms.
pub(crate) fn suggested_fix(class: SignalClass, severity: Severity) -> &'static str {
    match (class, severity) {
        (SignalClass::EvalScores, Severity::Green) => "TODO Plan 17-04: EvalScores Green string",
        (SignalClass::EvalScores, Severity::Amber) => "TODO Plan 17-04: EvalScores Amber string",
        (SignalClass::EvalScores, Severity::Red) => "TODO Plan 17-04: EvalScores Red string",
        (SignalClass::CapabilityGaps, Severity::Green) => "TODO Plan 17-04: CapabilityGaps Green string",
        (SignalClass::CapabilityGaps, Severity::Amber) => "TODO Plan 17-04: CapabilityGaps Amber string",
        (SignalClass::CapabilityGaps, Severity::Red) => "TODO Plan 17-04: CapabilityGaps Red string",
        (SignalClass::TentacleHealth, Severity::Green) => "TODO Plan 17-04: TentacleHealth Green string",
        (SignalClass::TentacleHealth, Severity::Amber) => "TODO Plan 17-04: TentacleHealth Amber string",
        (SignalClass::TentacleHealth, Severity::Red) => "TODO Plan 17-04: TentacleHealth Red string",
        (SignalClass::ConfigDrift, Severity::Green) => "TODO Plan 17-04: ConfigDrift Green string",
        (SignalClass::ConfigDrift, Severity::Amber) => "TODO Plan 17-04: ConfigDrift Amber string",
        (SignalClass::ConfigDrift, Severity::Red) => "TODO Plan 17-04: ConfigDrift Red string",
        (SignalClass::AutoUpdate, Severity::Green) => "TODO Plan 17-04: AutoUpdate Green string",
        (SignalClass::AutoUpdate, Severity::Amber) => "TODO Plan 17-04: AutoUpdate Amber string",
        (SignalClass::AutoUpdate, Severity::Red) => {
            "TODO Plan 17-04: AutoUpdate Red string (per UI-SPEC § 15: sentinel — should never render)"
        }
    }
}

// ── Tauri Commands (D-19) ─────────────────────────────────────────────────────

/// Run all signal sources synchronously, return aggregated list, cache
/// result, emit doctor_event + ActivityStrip line on transitions.
///
/// Plan 17-04 fills in the body. Plan 17-02 returns 5 placeholder Green
/// signals so the frontend can be exercised end-to-end without crashing
/// before the real signal sources land.
#[tauri::command]
pub async fn doctor_run_full_check(_app: AppHandle) -> Result<Vec<DoctorSignal>, String> {
    let now_ms = chrono::Utc::now().timestamp_millis();
    let stub = |class: SignalClass| DoctorSignal {
        class,
        severity: Severity::Green,
        payload: serde_json::json!({"stub": true, "plan": "17-02"}),
        last_changed_at: now_ms,
        suggested_fix: suggested_fix(class, Severity::Green).to_string(),
    };
    let signals = vec![
        stub(SignalClass::EvalScores),
        stub(SignalClass::CapabilityGaps),
        stub(SignalClass::TentacleHealth),
        stub(SignalClass::ConfigDrift),
        stub(SignalClass::AutoUpdate),
    ];
    if let Ok(mut cache) = last_run_cache().lock() {
        *cache = signals.clone();
    }
    Ok(signals)
}

/// Return the last cached run; if `class` is `Some(_)`, filter to that
/// class. Plan 17-04 may extend with history-window filtering per D-19.
#[tauri::command]
pub fn doctor_get_recent(class: Option<SignalClass>) -> Vec<DoctorSignal> {
    let lock = match last_run_cache().lock() {
        Ok(l) => l,
        Err(_) => return Vec::new(),
    };
    match class {
        Some(c) => lock.iter().filter(|s| s.class == c).cloned().collect(),
        None => lock.clone(),
    }
}

/// Return the most recent record for a single class (drill-down drawer).
/// Returns `None` on cache miss so the frontend can render an empty/
/// "no data yet" state without surfacing a Tauri-level error.
#[tauri::command]
pub fn doctor_get_signal(class: SignalClass) -> Option<DoctorSignal> {
    let lock = match last_run_cache().lock() {
        Ok(l) => l,
        Err(_) => return None,
    };
    lock.iter().find(|s| s.class == class).cloned()
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn signal_class_enum_serializes_snake_case() {
        let json = serde_json::to_string(&SignalClass::EvalScores).unwrap();
        assert_eq!(json, "\"eval_scores\"");
        let json = serde_json::to_string(&SignalClass::AutoUpdate).unwrap();
        assert_eq!(json, "\"auto_update\"");
    }

    #[test]
    fn severity_enum_serializes_lowercase() {
        assert_eq!(serde_json::to_string(&Severity::Green).unwrap(), "\"green\"");
        assert_eq!(serde_json::to_string(&Severity::Amber).unwrap(), "\"amber\"");
        assert_eq!(serde_json::to_string(&Severity::Red).unwrap(), "\"red\"");
    }

    #[test]
    fn doctor_get_signal_returns_none_when_cache_empty() {
        // Note: this test MAY race with other tests that populate LAST_RUN.
        // Run with --test-threads=1 (already enforced by harness convention).
        // For a clean fixture: clear LAST_RUN cache first.
        if let Ok(mut cache) = last_run_cache().lock() {
            cache.clear();
        }
        assert!(doctor_get_signal(SignalClass::EvalScores).is_none());
    }

    #[test]
    fn suggested_fix_table_is_exhaustive() {
        // All 15 (class × severity) pairs return a non-empty string.
        for class in [
            SignalClass::EvalScores,
            SignalClass::CapabilityGaps,
            SignalClass::TentacleHealth,
            SignalClass::ConfigDrift,
            SignalClass::AutoUpdate,
        ] {
            for severity in [Severity::Green, Severity::Amber, Severity::Red] {
                let s = suggested_fix(class, severity);
                assert!(!s.is_empty(), "missing string for ({:?}, {:?})", class, severity);
            }
        }
    }

    #[test]
    fn prior_severity_map_initializes() {
        // Smoke: lazy-init returns a usable lock. Plan 17-04's transition
        // detector relies on this. Touch + drop without mutating shared state.
        let _ = prior_severity_map().lock().map(|m| m.len());
    }
}
