// src-tauri/src/resilience/stuck.rs
//
// Phase 34 / RES-01 — 5-pattern stuck detector.
//
// Plan 34-03 shipped the StuckPattern enum + detect_stuck stub returning None.
// Plan 34-04 fills the 5 detector functions + the priority-order aggregator
// + the panic-injection test seam.
//
// Detector contract (CONTEXT lock §RES-01 verbatim):
//   1. RepeatedActionObservation — same (tool, args_hash, result_hash) triple
//      seen 3+ times in recent_actions. Hash via sha256(tool|input|output)
//      truncated to 16 bytes.
//   2. MonologueSpiral — consecutive_no_tool_turns >= monologue_threshold.
//   3. ContextWindowThrashing — compactions_this_run >= compaction_thrash_threshold.
//   4. NoProgress — iteration >= no_progress_threshold AND
//      iteration - last_progress_iteration >= no_progress_threshold.
//   5. CostRunaway — iteration >= 3 AND last_iter_cost > 2.0 × rolling avg.
//
// Priority order (CONTEXT lock §Claude's Discretion):
//   CostRunaway > RepeatedActionObservation > ContextWindowThrashing >
//   MonologueSpiral > NoProgress
// First match wins.
//
// CTX-07 fallback discipline: callers (run_loop) wrap detect_stuck in
// std::panic::catch_unwind(AssertUnwindSafe(...)). A panic anywhere in the
// detector code path is swallowed at the call site; the loop continues with
// no halt injected. The RES_FORCE_PANIC_IN_DETECTOR thread-local seam exists
// so the panic-injection regression test can verify the boundary.

use sha2::{Digest, Sha256};
use std::collections::HashMap;

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

// Plan 34-04 — test-only override seam. Mirrors loop_engine::FORCE_VERIFY_PANIC
// (Plan 33-09). When set, `detect_stuck` returns the forced verdict without
// walking the real detectors. Tests set the seam to assert the loop halts
// with the right `LoopHaltReason::Stuck { pattern }` variant.
//
// RES_FORCE_PANIC_IN_DETECTOR — separate panic-injection seam. When set, the
// FIRST real detector (detect_repeated_action_observation) panics. Tests use
// this to verify the catch_unwind boundary in run_loop catches detector
// panics. Mirrors Phase 33-09's FORCE_VERIFY_PANIC pattern.
#[cfg(test)]
thread_local! {
    pub(crate) static RES_FORCE_STUCK: std::cell::Cell<Option<StuckPattern>> =
        const { std::cell::Cell::new(None) };
    pub(crate) static RES_FORCE_PANIC_IN_DETECTOR: std::cell::Cell<bool> =
        const { std::cell::Cell::new(false) };
}

/// RES-01 aggregator. Walks the 5 detectors in priority order:
///   CostRunaway > RepeatedActionObservation > ContextWindowThrashing >
///   MonologueSpiral > NoProgress
/// First match wins. Returns None if no pattern fires OR if either kill switch
/// (smart_resilience_enabled OR stuck_detection_enabled) is off.
///
/// Behavior contract:
///   - returns None when smart_resilience_enabled OR stuck_detection_enabled is false
///   - returns Some(pattern) when any detector trips
///   - tests can override via RES_FORCE_STUCK thread-local seam (cfg(test))
///   - tests can force a panic in detector body via RES_FORCE_PANIC_IN_DETECTOR
///     to verify run_loop's catch_unwind boundary catches detector panics.
pub fn detect_stuck(state: &LoopState, config: &ResilienceConfig) -> Option<StuckPattern> {
    #[cfg(test)]
    if let Some(p) = RES_FORCE_STUCK.with(|c| c.get()) {
        return Some(p);
    }
    if !config.smart_resilience_enabled || !config.stuck_detection_enabled {
        return None;
    }
    if detect_cost_runaway(state, config) {
        return Some(StuckPattern::CostRunaway);
    }
    if detect_repeated_action_observation(state, config) {
        return Some(StuckPattern::RepeatedActionObservation);
    }
    if detect_context_window_thrashing(state, config) {
        return Some(StuckPattern::ContextWindowThrashing);
    }
    if detect_monologue_spiral(state, config) {
        return Some(StuckPattern::MonologueSpiral);
    }
    if detect_no_progress(state, config) {
        return Some(StuckPattern::NoProgress);
    }
    None
}

/// RES-01 / Pattern 1 — same (tool, input, output) triple seen 3+ times in
/// recent_actions. Hash via sha256(tool|input|output) truncated to 16 bytes
/// (collisions theoretically possible but vanishingly unlikely at 6 entries).
///
/// Returns false when the buffer holds fewer than 3 entries (not enough data
/// for the "3 repeats" assertion).
fn detect_repeated_action_observation(state: &LoopState, _config: &ResilienceConfig) -> bool {
    #[cfg(test)]
    RES_FORCE_PANIC_IN_DETECTOR.with(|c| {
        if c.get() {
            panic!("test-only induced panic in detect_repeated_action_observation (Plan 34-04 regression)");
        }
    });
    if state.recent_actions.len() < 3 {
        return false;
    }
    let mut counts: HashMap<[u8; 16], u32> = HashMap::new();
    for action in &state.recent_actions {
        let triple = format!(
            "{}|{}|{}",
            action.tool, action.input_summary, action.output_summary
        );
        let mut hasher = Sha256::new();
        hasher.update(triple.as_bytes());
        let digest = hasher.finalize();
        let mut h: [u8; 16] = [0; 16];
        h.copy_from_slice(&digest[..16]);
        let entry = counts.entry(h).or_insert(0);
        *entry += 1;
        if *entry >= 3 {
            return true;
        }
    }
    false
}

/// RES-01 / Pattern 2 — N consecutive assistant turns with no tool calls.
/// Default threshold: 5 (config::default_monologue_threshold).
fn detect_monologue_spiral(state: &LoopState, config: &ResilienceConfig) -> bool {
    state.consecutive_no_tool_turns >= config.monologue_threshold
}

/// RES-01 / Pattern 3 — N compactions in current run_loop invocation.
/// Default threshold: 3 (config::default_compaction_thrash_threshold).
fn detect_context_window_thrashing(state: &LoopState, config: &ResilienceConfig) -> bool {
    state.compactions_this_run >= config.compaction_thrash_threshold
}

/// RES-01 / Pattern 4 — N iterations without new tool name OR new content.
/// Default threshold: 5 (config::default_no_progress_threshold).
/// Cold-start guard: iteration must reach the threshold before this can fire,
/// otherwise iteration 0 with last_progress_iteration=0 would trip immediately.
fn detect_no_progress(state: &LoopState, config: &ResilienceConfig) -> bool {
    if state.iteration < config.no_progress_threshold {
        return false;
    }
    state.iteration.saturating_sub(state.last_progress_iteration) >= config.no_progress_threshold
}

/// RES-01 / Pattern 5 — current iteration's marginal cost > 2× rolling avg.
/// Cold-start guard: requires iteration >= 3 to avoid flagging iteration 2 as
/// runaway just because iteration 1 was anomalously cheap.
fn detect_cost_runaway(state: &LoopState, _config: &ResilienceConfig) -> bool {
    if state.iteration < 3 {
        return false;
    }
    if state.cumulative_cost_usd <= 0.0 {
        return false;
    }
    let avg = state.cumulative_cost_usd / state.iteration as f32;
    state.last_iter_cost > 2.0 * avg
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::loop_engine::ActionRecord;

    fn cfg() -> ResilienceConfig {
        ResilienceConfig::default()
    }

    fn build_state_with_actions(actions: Vec<ActionRecord>) -> LoopState {
        let mut s = LoopState::default();
        for a in actions {
            s.record_action(a);
        }
        s
    }

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
    fn phase34_res_01_repeated_action_observation() {
        let action = ActionRecord {
            tool: "read_file".to_string(),
            input_summary: "/tmp/x".to_string(),
            output_summary: "no such file".to_string(),
            is_error: true,
        };
        let s = build_state_with_actions(vec![action.clone(), action.clone(), action.clone()]);
        assert_eq!(
            detect_stuck(&s, &cfg()),
            Some(StuckPattern::RepeatedActionObservation)
        );
    }

    #[test]
    fn phase34_res_01_repeated_does_not_trip_with_two_repeats() {
        let action = ActionRecord {
            tool: "read_file".to_string(),
            input_summary: "/tmp/x".to_string(),
            output_summary: "no such file".to_string(),
            is_error: true,
        };
        let s = build_state_with_actions(vec![action.clone(), action.clone()]);
        // Only 2 repeats — must NOT trip. The CONTEXT lock specifies "3+".
        assert!(
            detect_stuck(&s, &cfg()).is_none(),
            "2 repeats must not trip RepeatedActionObservation (need 3+)"
        );
    }

    #[test]
    fn phase34_res_01_repeated_does_not_trip_with_three_distinct_actions() {
        // T-34-16 mitigation surface — three different tools / paths must not
        // trip RepeatedActionObservation just because they share a tool name.
        let s = build_state_with_actions(vec![
            ActionRecord {
                tool: "read_file".to_string(),
                input_summary: "/tmp/a".to_string(),
                output_summary: "ok".to_string(),
                is_error: false,
            },
            ActionRecord {
                tool: "read_file".to_string(),
                input_summary: "/tmp/b".to_string(),
                output_summary: "ok".to_string(),
                is_error: false,
            },
            ActionRecord {
                tool: "read_file".to_string(),
                input_summary: "/tmp/c".to_string(),
                output_summary: "ok".to_string(),
                is_error: false,
            },
        ]);
        assert!(
            detect_stuck(&s, &cfg()).is_none(),
            "3 distinct read_file calls (different paths) must NOT trip RepeatedActionObservation"
        );
    }

    #[test]
    fn phase34_res_01_monologue_spiral() {
        let mut s = LoopState::default();
        s.consecutive_no_tool_turns = 5;
        assert_eq!(detect_stuck(&s, &cfg()), Some(StuckPattern::MonologueSpiral));
    }

    #[test]
    fn phase34_res_01_monologue_spiral_below_threshold() {
        let mut s = LoopState::default();
        s.consecutive_no_tool_turns = 4; // default threshold is 5
        assert!(
            detect_stuck(&s, &cfg()).is_none(),
            "4 consecutive no-tool turns must NOT trip MonologueSpiral (default threshold = 5)"
        );
    }

    #[test]
    fn phase34_res_01_context_thrashing() {
        let mut s = LoopState::default();
        s.compactions_this_run = 3;
        assert_eq!(
            detect_stuck(&s, &cfg()),
            Some(StuckPattern::ContextWindowThrashing)
        );
    }

    #[test]
    fn phase34_res_01_no_progress() {
        let mut s = LoopState::default();
        s.iteration = 10;
        s.last_progress_iteration = 4; // 10 - 4 = 6 >= 5 (default threshold)
        assert_eq!(detect_stuck(&s, &cfg()), Some(StuckPattern::NoProgress));
    }

    #[test]
    fn phase34_res_01_no_progress_below_iteration_threshold() {
        let mut s = LoopState::default();
        s.iteration = 4; // < 5 default threshold — cold-start guard rejects
        s.last_progress_iteration = 0;
        assert!(
            detect_stuck(&s, &cfg()).is_none(),
            "iteration < no_progress_threshold must reject (cold-start guard)"
        );
    }

    #[test]
    fn phase34_res_01_cost_runaway() {
        let mut s = LoopState::default();
        s.iteration = 5;
        s.cumulative_cost_usd = 5.0; // avg = 1.0
        s.last_iter_cost = 3.0; // 3.0 > 2.0 × 1.0 = 2.0 — fires
        assert_eq!(detect_stuck(&s, &cfg()), Some(StuckPattern::CostRunaway));
    }

    #[test]
    fn phase34_res_01_cost_runaway_cold_start_guard() {
        let mut s = LoopState::default();
        s.iteration = 2; // < 3 — guard rejects
        s.cumulative_cost_usd = 0.5;
        s.last_iter_cost = 100.0; // would otherwise fire
        assert!(
            detect_stuck(&s, &cfg()).is_none(),
            "cold-start guard must reject iteration < 3"
        );
    }

    #[test]
    fn phase34_res_01_cost_runaway_zero_cumulative_no_div_by_zero() {
        // Defensive: cumulative_cost_usd == 0.0 and iteration >= 3 must NOT
        // fire CostRunaway specifically (rolling avg = 0; any positive
        // last_iter_cost would otherwise trip with a divide-by-zero-style
        // "infinitely greater than 0" judgment). Test the detector function
        // directly to isolate from other detectors that might fire on the
        // same state shape (e.g. NoProgress at iteration >= no_progress_threshold).
        let mut s = LoopState::default();
        s.iteration = 5;
        s.cumulative_cost_usd = 0.0;
        s.last_iter_cost = 0.01;
        s.last_progress_iteration = 5; // disarm NoProgress for this isolated assertion
        assert!(
            !detect_cost_runaway(&s, &cfg()),
            "cumulative_cost_usd = 0 must not trip CostRunaway (defensive guard)"
        );
        // Sanity: with the NoProgress disarming above, detect_stuck must also
        // return None — confirming no other detector picks up zero-cost state.
        assert!(
            detect_stuck(&s, &cfg()).is_none(),
            "zero-cost state with NoProgress disarmed must produce no stuck verdict"
        );
    }

    #[test]
    fn phase34_res_01_priority_order_cost_runaway_wins() {
        // Build a state that satisfies ALL 5 patterns; assert CostRunaway wins.
        let action = ActionRecord {
            tool: "read_file".to_string(),
            input_summary: "/tmp/x".to_string(),
            output_summary: "no such file".to_string(),
            is_error: true,
        };
        let mut s =
            build_state_with_actions(vec![action.clone(), action.clone(), action.clone()]);
        s.consecutive_no_tool_turns = 5;
        s.compactions_this_run = 3;
        s.iteration = 10;
        s.last_progress_iteration = 0;
        s.cumulative_cost_usd = 5.0;
        s.last_iter_cost = 100.0;
        assert_eq!(
            detect_stuck(&s, &cfg()),
            Some(StuckPattern::CostRunaway),
            "CostRunaway has highest priority per CONTEXT lock §Claude's Discretion"
        );
    }

    #[test]
    fn phase34_res_01_priority_repeated_beats_monologue() {
        // With CostRunaway disarmed (iteration < 3), RepeatedActionObservation
        // should beat both ContextWindowThrashing and MonologueSpiral.
        let action = ActionRecord {
            tool: "read_file".to_string(),
            input_summary: "/tmp/x".to_string(),
            output_summary: "no such file".to_string(),
            is_error: true,
        };
        let mut s =
            build_state_with_actions(vec![action.clone(), action.clone(), action.clone()]);
        s.consecutive_no_tool_turns = 5;
        s.compactions_this_run = 3;
        // CostRunaway disarmed: iteration < 3
        assert_eq!(
            detect_stuck(&s, &cfg()),
            Some(StuckPattern::RepeatedActionObservation)
        );
    }

    #[test]
    fn phase34_res_01_smart_off_returns_none() {
        let mut c = cfg();
        c.smart_resilience_enabled = false;
        let action = ActionRecord {
            tool: "read_file".to_string(),
            input_summary: "/tmp/x".to_string(),
            output_summary: "no such file".to_string(),
            is_error: true,
        };
        let s = build_state_with_actions(vec![action.clone(), action.clone(), action.clone()]);
        assert!(
            detect_stuck(&s, &c).is_none(),
            "smart_resilience_enabled=false must short-circuit detect_stuck"
        );
    }

    #[test]
    fn phase34_res_01_stuck_detection_disabled_returns_none() {
        let mut c = cfg();
        c.stuck_detection_enabled = false;
        let mut s = LoopState::default();
        s.consecutive_no_tool_turns = 100;
        assert!(
            detect_stuck(&s, &c).is_none(),
            "stuck_detection_enabled=false must short-circuit detect_stuck"
        );
    }

    #[test]
    fn phase34_res_01_force_panic_seam_propagates_panic() {
        // The panic catches at the call site (run_loop catch_unwind), not here.
        // This test verifies the seam itself works: forcing the cell to true
        // makes the detector panic. Wrapping in catch_unwind here proves that.
        RES_FORCE_PANIC_IN_DETECTOR.with(|c| c.set(true));
        let s = LoopState::default();
        let c = cfg();
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            detect_stuck(&s, &c)
        }));
        RES_FORCE_PANIC_IN_DETECTOR.with(|c| c.set(false)); // teardown
        assert!(
            result.is_err(),
            "RES_FORCE_PANIC_IN_DETECTOR must induce a panic; got Ok({:?})",
            result.as_ref().map(|_| "Ok")
        );
    }

    #[test]
    fn phase34_res_force_stuck_seam_overrides_detectors() {
        // RES_FORCE_STUCK takes priority over real detectors in cfg(test).
        let state = LoopState::default();
        let c = cfg();
        RES_FORCE_STUCK.with(|cell| cell.set(Some(StuckPattern::NoProgress)));
        let v = detect_stuck(&state, &c);
        RES_FORCE_STUCK.with(|cell| cell.set(None)); // teardown
        assert_eq!(
            v,
            Some(StuckPattern::NoProgress),
            "RES_FORCE_STUCK seam must short-circuit detect_stuck"
        );
    }
}
