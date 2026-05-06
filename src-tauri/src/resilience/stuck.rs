// src-tauri/src/resilience/stuck.rs
//
// Phase 34 / RES-01 — 5-pattern stuck detector.
//
// Plan 34-03 ships the StuckPattern enum + detect_stuck stub returning None.
// Plan 34-04 fills the 5 detector functions + the priority-order aggregator.

use crate::config::ResilienceConfig;
use crate::loop_engine::LoopState;

/// RES-01 — stuck pattern discriminants. Ordered by detector priority
/// (CostRunaway > RepeatedActionObservation > ContextWindowThrashing >
/// MonologueSpiral > NoProgress per CONTEXT lock §Claude's Discretion).
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum StuckPattern {
    CostRunaway,
    RepeatedActionObservation,
    ContextWindowThrashing,
    MonologueSpiral,
    NoProgress,
}

impl StuckPattern {
    /// Stable string discriminant for the LoopHaltReason::Stuck { pattern }
    /// variant and the blade_loop_event { kind: "stuck_detected", pattern }
    /// emit. Front-end consumers match on these strings (see
    /// src/lib/events/payloads.ts BladeLoopEventPayload `stuck_detected`).
    pub fn discriminant(&self) -> &'static str {
        match self {
            Self::CostRunaway              => "CostRunaway",
            Self::RepeatedActionObservation => "RepeatedActionObservation",
            Self::ContextWindowThrashing    => "ContextWindowThrashing",
            Self::MonologueSpiral           => "MonologueSpiral",
            Self::NoProgress                => "NoProgress",
        }
    }
}

/// Plan 34-04 — test-only override seam. Mirrors loop_engine::FORCE_VERIFY_PANIC
/// (Plan 33-09). When set, `detect_stuck` returns the forced verdict without
/// walking the real detectors. Tests set the seam to assert the loop halts
/// with the right `LoopHaltReason::Stuck { pattern }` variant.
#[cfg(test)]
thread_local! {
    pub(crate) static RES_FORCE_STUCK: std::cell::Cell<Option<StuckPattern>> =
        const { std::cell::Cell::new(None) };
}

/// RES-01 aggregator. Walks the 5 detectors in priority order; first match wins.
///
/// Plan 34-03 ships the STUB returning None. Plan 34-04 fills the bodies.
/// The function signature is locked here so Wave 2-5 plans can wire the call
/// site into run_loop without waiting for Plan 34-04.
///
/// Behavior contract (Plan 34-04 enforces):
///   - returns None when smart_resilience_enabled OR stuck_detection_enabled is false
///   - returns Some(pattern) when any detector trips
///   - never panics (callers wrap in catch_unwind for CTX-07 fallback discipline)
#[allow(dead_code)]
pub fn detect_stuck(_state: &LoopState, _config: &ResilienceConfig) -> Option<StuckPattern> {
    #[cfg(test)]
    if let Some(p) = RES_FORCE_STUCK.with(|c| c.get()) {
        return Some(p);
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn phase34_stuck_pattern_serde_roundtrip() {
        let p = StuckPattern::MonologueSpiral;
        let json = serde_json::to_string(&p).expect("serialize");
        let parsed: StuckPattern = serde_json::from_str(&json).expect("parse");
        assert_eq!(p, parsed);
    }

    #[test]
    fn phase34_stuck_pattern_discriminant() {
        assert_eq!(StuckPattern::CostRunaway.discriminant(), "CostRunaway");
        assert_eq!(StuckPattern::RepeatedActionObservation.discriminant(), "RepeatedActionObservation");
        assert_eq!(StuckPattern::ContextWindowThrashing.discriminant(), "ContextWindowThrashing");
        assert_eq!(StuckPattern::MonologueSpiral.discriminant(), "MonologueSpiral");
        assert_eq!(StuckPattern::NoProgress.discriminant(), "NoProgress");
    }

    #[test]
    fn phase34_detect_stuck_returns_none_in_stub() {
        // Plan 34-03 stub — returns None unconditionally (Plan 34-04 fills bodies).
        let state = LoopState::default();
        let cfg = ResilienceConfig::default();
        assert!(detect_stuck(&state, &cfg).is_none(),
            "Plan 34-03 stub returns None; Plan 34-04 fills bodies");
    }

    #[test]
    fn phase34_res_force_stuck_seam_overrides_stub() {
        let state = LoopState::default();
        let cfg = ResilienceConfig::default();
        RES_FORCE_STUCK.with(|c| c.set(Some(StuckPattern::MonologueSpiral)));
        let v = detect_stuck(&state, &cfg);
        RES_FORCE_STUCK.with(|c| c.set(None));  // teardown
        assert_eq!(v, Some(StuckPattern::MonologueSpiral),
            "RES_FORCE_STUCK seam must short-circuit detect_stuck");
    }
}
