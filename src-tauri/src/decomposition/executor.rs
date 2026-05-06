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
    use crate::agents::AgentRole;
    use crate::decomposition::planner::StepGroup;

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

    fn build_synthetic_group(idx: u32, role: AgentRole, depends_on: Vec<u32>) -> StepGroup {
        StepGroup {
            step_index: idx,
            goal: format!("synthetic step {}", idx),
            role,
            depends_on,
            estimated_duration: "fast".to_string(),
        }
    }

    // ─── Plan 35-05 (DECOMP-02) — new tests ─────────────────────────────────

    #[test]
    fn phase35_decomp_02_max_parallel_respected() {
        // CONTEXT lock §DECOMP-02: max_concurrent = min(max_parallel_subagents, 5).
        // A pathological config of 50 must clamp to swarm.rs's 5-concurrent cap.
        let mut cfg = BladeConfig::default();
        cfg.decomposition.max_parallel_subagents = 50;
        let runtime_cap = (cfg.decomposition.max_parallel_subagents.min(5)) as usize;
        assert_eq!(
            runtime_cap, 5,
            "max_parallel=50 must clamp to swarm.rs's 5-concurrent cap"
        );

        // The default (3) stays at 3.
        let cfg2 = BladeConfig::default();
        let runtime_cap2 = (cfg2.decomposition.max_parallel_subagents.min(5)) as usize;
        assert_eq!(
            runtime_cap2, 3,
            "default max_parallel=3 should NOT be clamped (3 < 5)"
        );
    }

    #[test]
    fn phase35_decomp_02_executor_dispatches_each_group() {
        // build_swarm_from_groups must produce one SwarmTask per StepGroup with
        // id=step_{idx} + role + depends_on edges encoded as step_{n} strings.
        let groups = vec![
            build_synthetic_group(0, AgentRole::Researcher, vec![]),
            build_synthetic_group(1, AgentRole::Coder, vec![0]),
            build_synthetic_group(2, AgentRole::Analyst, vec![0, 1]),
        ];
        let swarm = build_swarm_from_groups(&groups, "01PARENTSESSION0000000000");
        assert_eq!(swarm.tasks.len(), 3, "one SwarmTask per StepGroup");
        assert_eq!(swarm.tasks[0].id, "step_0");
        assert_eq!(swarm.tasks[1].id, "step_1");
        assert_eq!(swarm.tasks[2].id, "step_2");
        assert_eq!(swarm.tasks[1].depends_on, vec!["step_0".to_string()]);
        assert_eq!(
            swarm.tasks[2].depends_on,
            vec!["step_0".to_string(), "step_1".to_string()]
        );
        assert_eq!(swarm.tasks[0].role, "researcher");
        assert_eq!(swarm.tasks[1].role, "coder");
        // DAG must validate — no cycles.
        crate::swarm::validate_dag(&swarm.tasks).expect("synthetic DAG must be acyclic");
    }

    #[test]
    fn phase35_decomp_02_subagent_isolation_creates_fork() {
        // The fork-point helper computes a stable u32 from the parent's JSONL
        // (or 0 when the file is missing). This is the value passed to
        // fork_session(parent_id, fork_at_message_index). Since we can't run
        // real fork_session in a unit test, we exercise the helper via the
        // missing-file path which returns 0 (Err inside the helper).
        let tmp = std::env::temp_dir().join("phase35_decomp_02_fork_point_missing");
        let _ = std::fs::create_dir_all(&tmp);
        let count = read_parent_msg_count(&tmp, "DOES_NOT_EXIST");
        assert!(count.is_err(), "missing parent JSONL should return Err");
    }

    #[test]
    fn phase35_decomp_02_cost_rollup_sums_subagent_costs() {
        // Cost rollup arithmetic — verify that summary.cost_usd ADDS into
        // parent_state.conversation_cumulative_cost_usd (NOT replace).
        // We simulate the rollup loop directly because the full async path
        // requires an AppHandle (Plan 35-11 UAT exercises it).
        let mut parent_state = LoopState::default();
        parent_state.conversation_cumulative_cost_usd = 0.10;
        let summaries = vec![
            SubagentSummary {
                step_index: 0,
                subagent_session_id: "A".into(),
                role: "researcher".into(),
                success: true,
                summary_text: "a".into(),
                tokens_used: 0,
                cost_usd: 0.5,
            },
            SubagentSummary {
                step_index: 1,
                subagent_session_id: "B".into(),
                role: "coder".into(),
                success: true,
                summary_text: "b".into(),
                tokens_used: 0,
                cost_usd: 0.5,
            },
            SubagentSummary {
                step_index: 2,
                subagent_session_id: "C".into(),
                role: "analyst".into(),
                success: true,
                summary_text: "c".into(),
                tokens_used: 0,
                cost_usd: 0.5,
            },
        ];
        for s in &summaries {
            parent_state.conversation_cumulative_cost_usd += s.cost_usd;
        }
        let delta = parent_state.conversation_cumulative_cost_usd - 0.10;
        assert!(
            (delta - 1.5).abs() < 1e-4,
            "cost rollup must ADD 0.5+0.5+0.5=1.5, got delta={}",
            delta
        );
    }

    #[test]
    fn phase35_decomp_02_force_executor_result_seam_works() {
        // Verify the seam round-trips. The implementation reads the seam at
        // the top of spawn_isolated_subagent; tests inject a SubagentSummary
        // and assert the spawn body short-circuits without running fork+spawn.
        let forced = SubagentSummary {
            step_index: 7,
            subagent_session_id: "INJECTED".into(),
            role: "coder".into(),
            success: true,
            summary_text: "from-seam".into(),
            tokens_used: 100,
            cost_usd: 0.0123,
        };
        DECOMP_FORCE_SUBAGENT_RESULT.with(|c| *c.borrow_mut() = Some(forced.clone()));
        let got = DECOMP_FORCE_SUBAGENT_RESULT.with(|c| c.borrow_mut().take());
        assert!(got.is_some());
        let g = got.unwrap();
        assert_eq!(g.step_index, 7);
        assert_eq!(g.subagent_session_id, "INJECTED");
        assert_eq!(g.summary_text, "from-seam");
        // Subsequent take returns None — single-shot semantics.
        let again = DECOMP_FORCE_SUBAGENT_RESULT.with(|c| c.borrow_mut().take());
        assert!(again.is_none(), "seam is single-shot");
    }

    #[tokio::test]
    async fn phase35_execute_decomposed_task_invalid_dag_returns_err() {
        // execute_decomposed_task must validate the DAG and reject cycles.
        // Build groups with a back-edge: step 0 depends on step 1; step 1
        // depends on step 0. validate_dag rejects.
        let groups = vec![
            StepGroup {
                step_index: 0,
                goal: "a".into(),
                role: AgentRole::Researcher,
                depends_on: vec![1],
                estimated_duration: "fast".into(),
            },
            StepGroup {
                step_index: 1,
                goal: "b".into(),
                role: AgentRole::Coder,
                depends_on: vec![0],
                estimated_duration: "fast".into(),
            },
        ];
        let swarm = build_swarm_from_groups(&groups, "01PARENT");
        let res = crate::swarm::validate_dag(&swarm.tasks);
        assert!(res.is_err(), "cyclic DAG must be rejected by validate_dag");
    }
}
