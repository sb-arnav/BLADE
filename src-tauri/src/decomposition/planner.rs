//! DECOMP-01: step counter + role-selection heuristic.
//!
//! `count_independent_steps_grouped(query, &config)` returns
//! `Some(Vec<StepGroup>)` when `max(verb_groups, file_groups, tool_families)
//! >= config.decomposition.min_steps_to_decompose` (default 5), else `None`.
//!
//! Phase 35 Plan 35-02: STUB. Body returns None unconditionally. Real
//! implementation in Plan 35-03.

use serde::{Deserialize, Serialize};

use crate::agents::AgentRole;
use crate::config::BladeConfig;

/// One step in a decomposed plan. Output by DECOMP-01's heuristic; consumed
/// by DECOMP-02's executor (built into a SwarmTask + spawn_isolated_subagent).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StepGroup {
    pub step_index: u32,
    /// safe_slice'd to 500 chars at construction time.
    pub goal: String,
    pub role: AgentRole,
    /// By step_index — empty for independent groups.
    pub depends_on: Vec<u32>,
    /// "fast" | "medium" | "slow" — used by ActivityStrip estimate displays.
    pub estimated_duration: String,
}

#[cfg(test)]
thread_local! {
    /// Plan 35-03 — tests inject a step count without crafting real complex
    /// queries. When set to Some(n), count_independent_steps_grouped returns
    /// Some(synthetic groups of length n). Production builds carry zero
    /// overhead.
    pub(crate) static DECOMP_FORCE_STEP_COUNT: std::cell::Cell<Option<u32>> =
        std::cell::Cell::new(None);
}

/// Returns `Some(Vec<StepGroup>)` when the query implies enough independent
/// steps to trigger decomposition; `None` otherwise.
///
/// Plan 35-02 STUB — returns None unconditionally. Plan 35-03 fills the body
/// with the 3-axis heuristic (verb groups, file/project nouns, tool families).
pub fn count_independent_steps_grouped(
    _query: &str,
    _config: &BladeConfig,
) -> Option<Vec<StepGroup>> {
    #[cfg(test)]
    {
        if let Some(forced) = DECOMP_FORCE_STEP_COUNT.with(|c| c.get()) {
            // Build synthetic groups so downstream tests can verify the dispatch path.
            let groups: Vec<StepGroup> = (0..forced)
                .map(|i| StepGroup {
                    step_index: i,
                    goal: format!("synthetic step {}", i),
                    role: AgentRole::Researcher,
                    depends_on: vec![],
                    estimated_duration: "fast".to_string(),
                })
                .collect();
            return Some(groups);
        }
    }
    // Plan 35-03 fills this body. For now: never trigger decomposition.
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn phase35_step_group_serde_roundtrip() {
        let g = StepGroup {
            step_index: 0,
            goal: "test".to_string(),
            role: AgentRole::Coder,
            depends_on: vec![],
            estimated_duration: "fast".to_string(),
        };
        let json = serde_json::to_string(&g).expect("serialize");
        let parsed: StepGroup = serde_json::from_str(&json).expect("parse");
        assert_eq!(parsed.step_index, g.step_index);
        assert_eq!(parsed.goal, g.goal);
    }

    #[test]
    fn phase35_count_independent_steps_grouped_stub_returns_none() {
        // Plan 35-02 STUB body — verify before Plan 35-03 fills it.
        let cfg = BladeConfig::default();
        DECOMP_FORCE_STEP_COUNT.with(|c| c.set(None));
        assert!(count_independent_steps_grouped("anything", &cfg).is_none());
    }

    #[test]
    fn phase35_decomp_force_step_count_seam_returns_synthetic_groups() {
        let cfg = BladeConfig::default();
        DECOMP_FORCE_STEP_COUNT.with(|c| c.set(Some(7)));
        let result = count_independent_steps_grouped("anything", &cfg);
        DECOMP_FORCE_STEP_COUNT.with(|c| c.set(None)); // teardown
        let groups = result.expect("seam should produce groups");
        assert_eq!(groups.len(), 7);
        assert_eq!(groups[0].step_index, 0);
        assert_eq!(groups[6].step_index, 6);
    }
}
