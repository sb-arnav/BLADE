//! Phase 35: Auto-Decomposition module root.
//!
//! When the brain planner detects a task with 5+ independent steps, the loop
//! dispatches them as parallel sub-agents instead of running sequentially.
//! Each sub-agent runs in full isolation — its own LoopState, its own
//! SessionWriter (forked from the parent at the decomposition point), its own
//! per-conversation cost rollup that bubbles up to the parent's
//! `conversation_cumulative_cost_usd`, its own compaction cycle. When a
//! sub-agent halts, a single 1-paragraph (≤ 800 token) summary is distilled
//! and injected into the parent's conversation as ONE synthetic AssistantTurn.
//!
//! Submodules:
//!   - `planner`  — DECOMP-01: count_independent_steps_grouped + StepGroup +
//!                  role-selection heuristic + DECOMP_FORCE_STEP_COUNT seam
//!   - `executor` — DECOMP-02: execute_decomposed_task + spawn_isolated_subagent +
//!                  cost rollup + DECOMP_FORCE_SUBAGENT_RESULT seam
//!   - `summary`  — DECOMP-03: distill_subagent_summary + SubagentSummary +
//!                  cheap-model fallback + DECOMP_FORCE_DISTILL_PANIC seam
//!
//! Phase boundary: per 35-CONTEXT.md §Phase Boundary, this module is the
//! orchestrator ABOVE run_loop, not inside it. The Phase 33 LoopState +
//! Phase 34 SessionWriter substrate is reused VERBATIM per sub-agent.
//!
//! Plan 35-02 ships the substrate ONLY (this file + planner.rs + executor.rs
//! + summary.rs); the function bodies are stubs. Plans 35-03 through 35-11
//! fill the bodies with real logic.

pub mod planner;
pub mod executor;
pub mod summary;

