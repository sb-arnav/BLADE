//! DECOMP-02: sub-agent spawn + swarm dispatch + cost rollup.
//!
//! `execute_decomposed_task` orchestrates per-step `fork_session` (Phase 34
//! SESS-04) + a fresh `LoopState::default()` with `is_subagent = true` + own
//! SessionWriter. Sub-agents run through the existing `swarm.rs` DAG +
//! `resolve_ready_tasks` 5-concurrent cap.
//!
//! Plan 35-02 STUB — body returns Err. Real implementation in Plans 35-05/06/07.

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::config::BladeConfig;
use crate::decomposition::planner::StepGroup;
use crate::decomposition::summary::SubagentSummary;
use crate::loop_engine::LoopState;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum DecompositionError {
    /// swarm::validate_dag rejected the StepGroups (cycle or bad edge).
    DagInvalid(String),
    /// Every chain element exhausted retries without producing a sub-agent result.
    SwarmExhausted(String),
    /// Parent's per-conversation cost cap tripped during fan-out.
    /// Locked behavior (35-CONTEXT.md §DECOMP-02): in-flight sub-agents
    /// finish their iteration; future sub-agents are skipped.
    ParentBudgetExceeded,
    /// Catch-all for serialization / IO / panic-fallback paths.
    Internal(String),
}

#[cfg(test)]
thread_local! {
    /// Plan 35-05 — tests inject a sub-agent summary without spawning real
    /// tokio tasks. When Some(s), spawn_isolated_subagent returns s
    /// immediately. Lets pass-through tests run in milliseconds.
    pub(crate) static DECOMP_FORCE_SUBAGENT_RESULT: std::cell::RefCell<Option<SubagentSummary>> =
        std::cell::RefCell::new(None);
}

/// Orchestrate per-StepGroup fork + spawn + collect.
///
/// Plan 35-02 STUB — returns Err(DecompositionError::Internal("not yet wired")).
/// Plan 35-05 fills the body with the swarm dispatch + cost rollup logic.
pub async fn execute_decomposed_task(
    _parent_session_id: &str,
    _parent_state: &mut LoopState,
    _groups: Vec<StepGroup>,
    _app: &AppHandle,
    _config: &BladeConfig,
) -> Result<Vec<SubagentSummary>, DecompositionError> {
    Err(DecompositionError::Internal(
        "Plan 35-02 stub — execute_decomposed_task body wired in Plan 35-05".to_string(),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn phase35_decomposition_error_serde_roundtrip() {
        let e = DecompositionError::DagInvalid("cycle".to_string());
        let json = serde_json::to_string(&e).expect("serialize");
        let _parsed: DecompositionError = serde_json::from_str(&json).expect("parse");
    }

    #[test]
    fn phase35_decomp_force_subagent_result_seam_declared() {
        // Verify the seam compiles + can be set/cleared.
        let s = SubagentSummary {
            step_index: 0,
            subagent_session_id: "TEST".to_string(),
            role: "researcher".to_string(),
            success: true,
            summary_text: "ok".to_string(),
            tokens_used: 0,
            cost_usd: 0.0,
        };
        DECOMP_FORCE_SUBAGENT_RESULT.with(|c| *c.borrow_mut() = Some(s));
        let got = DECOMP_FORCE_SUBAGENT_RESULT.with(|c| c.borrow_mut().take());
        assert!(got.is_some(), "seam round-trips a SubagentSummary");
    }

    #[tokio::test]
    async fn phase35_execute_decomposed_task_stub_returns_internal_err() {
        // Plan 35-02 STUB — verify the locked signature returns the locked
        // Err shape before Plan 35-05 fills the real body. The body must
        // remain non-Ok in Plan 35-02 so downstream wave-2 plans can detect
        // they are still standing on the stub.
        //
        // Note: We can't easily construct an AppHandle in a unit test, so we
        // skip the full call here and just assert the DecompositionError
        // discriminants serialize as expected.
        let e = DecompositionError::Internal("stub".to_string());
        let json = serde_json::to_string(&e).expect("serialize Internal");
        assert!(json.contains("Internal"));
    }
}
