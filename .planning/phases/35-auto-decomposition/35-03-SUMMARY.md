---
phase: 35-auto-decomposition
plan: 3
subsystem: agentic-loop / decomposition heuristic
tags:
  - decomposition
  - DECOMP-01
  - planner
  - heuristic
  - role-selection
  - phase-35
dependency-graph:
  requires:
    - "Phase 35-01 DecompositionConfig (auto_decompose_enabled, min_steps_to_decompose)"
    - "Phase 35-02 StepGroup struct + DECOMP_FORCE_STEP_COUNT seam + planner.rs scaffold"
    - "agents/mod.rs AgentRole (5 of the 8 roles consumed: Coder/Researcher/Analyst/Writer/Reviewer)"
    - "lib.rs safe_slice helper (pub(crate))"
    - "regex 1.x crate (already declared in Cargo.toml)"
  provides:
    - "count_independent_steps_grouped real body (3-axis heuristic; max(verb,file,tool) >= threshold)"
    - "count_verb_groups (connectors + action verbs + comparison heuristic)"
    - "count_file_groups (paths + URLs + repo nouns; deduped via HashSet)"
    - "count_tool_families (5 keyword groups: bash/read/search/web/write)"
    - "select_role_for_goal (heuristic mapping verb keywords → AgentRole)"
    - "build_step_groups + split_at_connectors with safe_slice 500-char cap on every goal"
  affects:
    - "src-tauri/src/decomposition/planner.rs (236 insertions, 26 deletions over Plan 35-02 stub)"
tech-stack:
  added: []
  patterns:
    - "Phase 35-02 thread_local force-seam pattern preserved (DECOMP_FORCE_STEP_COUNT short-circuits to synthetic_groups)"
    - "Phase 32+ MAX_INPUT_CHARS upstream cap (planner sees post-cap content; no in-planner length guard needed per T-35-09)"
    - "safe_slice goal cap mirrors Phase 33+34 user-content slicing discipline"
    - "regex Result::ok fallback (HashSet contributes 0 if a regex fails to compile rather than panicking)"
    - "commands.rs:671 count_task_steps logic mirrored verbatim for verb-group axis (intentional: same connectors + verb list keep classification stable)"
key-files:
  created: []
  modified:
    - src-tauri/src/decomposition/planner.rs
decisions:
  - "Verb-axis logic was mirrored from commands.rs:671 count_task_steps verbatim (same 13 connectors + 25 action verbs + comparison heuristic). Keeping the two heuristics in sync means the planner's trigger and the existing brain-prompt step-counter agree on what looks multi-step. Plan 35-04 may unify by importing commands::count_task_steps directly; for v1 the duplication keeps the decomposition module self-contained."
  - "Role-selection ordering: Coder → Reviewer → Writer → Analyst → Researcher (default). Reviewer ahead of Researcher because 'check' / 'verify' / 'audit' patterns must not be swallowed by the broader Researcher 'check'/'show' patterns. The plan's spec said `check` was a Reviewer keyword — the test query `compare option A and B` correctly resolves Analyst because `compare` matches before any later branch (the compare-branch is the Analyst arm)."
  - "Tweaked the plan-prescribed Reviewer pattern from 'check' (bare) to ' check' (leading space) to avoid false positives on words like 'checkpoint' / 'cheek'. Same defensive technique already used by build_step_groups for connector matching. All test cases still pass."
  - "Each regex compile uses `if let Ok(...)` rather than `.unwrap()` per Rule 1+2 (the regexes are static literals so unwrap would be fine, but the defensive form survives a future hand-edit and follows BLADE's 'never panic on user content' discipline). No measurable cost on the contained query length."
  - "split_at_connectors uses 8 connectors (subset of count_verb_groups's 13) — only those that introduce a new clause boundary ('next ', 'as well', 'plus ', 'once ', 'before ' are excluded because they're often parenthetical rather than separating)."
metrics:
  duration: ~10 minutes
  completed: 2026-05-06
---

# Phase 35 Plan 35-03: count_independent_steps_grouped 3-axis heuristic + role selection Summary

DECOMP-01 step-counter fills the Plan 35-02 stub with a 3-axis independence detector. `count_independent_steps_grouped(query, &config)` returns `Some(Vec<StepGroup>)` when `max(verb_groups, file_groups, tool_families) >= config.decomposition.min_steps_to_decompose` (default 5), else `None`. `auto_decompose_enabled = false` short-circuits to `None` unconditionally. The DECOMP_FORCE_STEP_COUNT seam from Plan 35-02 is preserved and now delegates to a `synthetic_groups` helper. 8 unit tests green; cargo (lib test build) compiles in 5m24s.

## What Shipped

### Task 1: Fill count_independent_steps_grouped + 3-axis heuristic + role selection

**File modified:** `src-tauri/src/decomposition/planner.rs` (+236 / −26)

**Helper signatures (paste):**

```rust
pub fn count_independent_steps_grouped(query: &str, config: &BladeConfig) -> Option<Vec<StepGroup>>
fn count_verb_groups(q_lower: &str) -> u32
fn count_file_groups(q_raw: &str) -> u32
fn count_tool_families(q_lower: &str) -> u32
fn select_role_for_goal(goal: &str) -> AgentRole
fn matches_any(text: &str, patterns: &[&str]) -> bool
fn build_step_groups(query: &str, n: u32) -> Vec<StepGroup>
fn split_at_connectors(query: &str) -> Vec<String>
#[cfg(test)] fn synthetic_groups(query: &str, n: u32) -> Vec<StepGroup>
```

**Axis behavior:**

| Axis | Trigger inputs | Returns |
|------|----------------|---------|
| `count_verb_groups` | 13 connectors + 25 action verbs + comparison phrases (vs / versus / compared to / compare) | `connector_count + saturating(verb_count - 1) + (comparison ? 1 : 0)` |
| `count_file_groups` | regex `\b[\w./-]+\.\w{1,5}\b` (paths) + `https?://\S+` (URLs) + `\bthe-[\w-]+\b` (repo nouns) | HashSet count (deduped) |
| `count_tool_families` | 5 keyword groups: bash/shell/run/execute · read/cat/show/open · search/grep/find · web/fetch/curl/http · write/save/create | Count of groups with any match (cap 5) |

**Role-selection priority order:** Coder → Reviewer → Writer → Analyst → Researcher (default fallback).

**Goal cap:** Every `StepGroup.goal` runs through `crate::safe_slice(text, 500)` at construction time inside `build_step_groups`.

**DECOMP_FORCE_STEP_COUNT seam:** Preserved verbatim. When `Some(n)`, returns `synthetic_groups(query, n)`. Production builds carry zero overhead via `#[cfg(test)]` gating.

## Test Coverage

8 unit tests in `decomposition::planner::tests` (1 inherited serde + 7 phase35_decomp_01_*):

| Test | Status | Purpose |
|------|--------|---------|
| `phase35_step_group_serde_roundtrip` | ✓ ok | StepGroup Serialize+Deserialize lock (carried over from Plan 35-02) |
| `phase35_decomp_01_step_counter_thresholds` | ✓ ok | 1-verb query → None; 6-step query → Some(≥5 groups) |
| `phase35_decomp_01_role_selection_heuristic` | ✓ ok | All 5 expected AgentRole variants reachable; default fallback Researcher |
| `phase35_decomp_01_disabled_returns_none` | ✓ ok | auto_decompose_enabled=false short-circuits unconditionally |
| `phase35_decomp_01_file_groups_axis` | ✓ ok | 5 unique file paths trip threshold via file axis (1 verb only) |
| `phase35_decomp_01_tool_families_axis` | ✓ ok | 5 distinct tool families trip threshold via tool-family axis |
| `phase35_decomp_01_goal_safe_slice_to_500` | ✓ ok | Long query → every group goal ≤ 500 chars |
| `phase35_decomp_force_step_count_seam_returns_synthetic_groups` | ✓ ok | Plan 35-02 seam still fires (synthetic_groups path) |

**Run output:**
```
running 8 tests
test decomposition::planner::tests::phase35_decomp_01_disabled_returns_none ... ok
test decomposition::planner::tests::phase35_decomp_01_role_selection_heuristic ... ok
test decomposition::planner::tests::phase35_decomp_01_goal_safe_slice_to_500 ... ok
test decomposition::planner::tests::phase35_decomp_force_step_count_seam_returns_synthetic_groups ... ok
test decomposition::planner::tests::phase35_step_group_serde_roundtrip ... ok
test decomposition::planner::tests::phase35_decomp_01_tool_families_axis ... ok
test decomposition::planner::tests::phase35_decomp_01_file_groups_axis ... ok
test decomposition::planner::tests::phase35_decomp_01_step_counter_thresholds ... ok

test result: ok. 8 passed; 0 failed; 0 ignored; 0 measured; 698 filtered out; finished in 0.21s
```

## Verification

**cargo (lib test build):** compiled successfully in 5m 24s (warm-cached); 16 lib-test warnings — all pre-existing or expected (`function 'execute_decomposed_task' is never used` is the Plan 35-02 stub awaiting Plan 35-05; `unused_assignments` / `unused_variables` in evals/active_inference_eval.rs are pre-existing out-of-scope per CLAUDE.md scope-boundary discipline).

**Acceptance criteria grep checks:**

| Criterion | Target | Actual | Status |
|-----------|--------|--------|--------|
| `fn count_verb_groups\b\|fn count_file_groups\b\|fn count_tool_families\b\|fn select_role_for_goal\b` | 4 | 4 | ✓ |
| `DECOMP_FORCE_STEP_COUNT` references | ≥3 | 10 | ✓ |
| `safe_slice` references | ≥1 | 5 | ✓ |
| `AgentRole::Coder\|Researcher\|Analyst\|Writer\|Reviewer` | ≥5 | 14 | ✓ |
| All 7 phase35 planner tests green | 7/7 | 8/8 (incl. inherited serde) | ✓ |
| cargo check clean | exit 0 | exit 0 | ✓ |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Defensive] regex::Regex::new wrapped in `if let Ok(...)` rather than `.unwrap()`**
- **Found during:** Task 1 implementation
- **Issue:** Plan-prescribed code used `.unwrap()` on three static-literal regex compiles inside `count_file_groups`. While the literals are correct, the unwrap would panic if a future hand-edit introduced a typo, and BLADE's CLAUDE.md discipline is "never panic on user content path."
- **Fix:** Switched all three compiles to `if let Ok(re) = regex::Regex::new(...)` with the corresponding `find_iter` block inside. Failed regex contributes 0 to the file-group axis (graceful degradation). Behavior identical when regexes compile (always, with literal patterns).
- **Files modified:** `src-tauri/src/decomposition/planner.rs`
- **Commit:** 202e074

**2. [Rule 1 - Bug] `select_role_for_goal` Reviewer pattern: `check` → ` check` (leading space)**
- **Found during:** Task 1 test design
- **Issue:** Plan-prescribed Reviewer pattern list included bare `check`, which would false-match `checkpoint`, `cheek`, `chess`, `chechen`, etc. The Researcher branch later in the priority list also has a `show` pattern that benefits from the same defense.
- **Fix:** Changed Reviewer pattern from `"check"` to `" check"` (leading space). Verified `phase35_decomp_01_role_selection_heuristic` test still passes for `"review the PR"` (matches `"review"` before reaching `" check"`).
- **Files modified:** `src-tauri/src/decomposition/planner.rs`
- **Commit:** 202e074

### Plan-Spec Adjustments (data shape, not behavior)

**1. `synthetic_groups` extracted as a private helper**
- Plan inlined the synthetic-groups construction inside `count_independent_steps_grouped`'s `#[cfg(test)]` block. The Plan 35-02 stub already inlined it. Refactored into a dedicated `synthetic_groups(query, n)` helper to (a) match the structure of `build_step_groups`, (b) let `phase35_decomp_01_goal_safe_slice_to_500` test exercise the same safe_slice cap that production uses (since the seam returns synthetic_groups, and synthetic_groups now also runs through safe_slice). Behavior of the seam is identical.

## Threat Flags

None — Plan 35-03 ships only the heuristic body. No new network endpoints, auth paths, file-access patterns, or schema changes at trust boundaries. The plan's threat register (T-35-09 / T-35-10 / T-35-11) is unchanged:

- **T-35-09 (DoS via 10MB query)** — Phase 32 caps user input at MAX_INPUT_CHARS upstream. Planner only sees post-cap content; regex passes are bounded.
- **T-35-10 (URL-batched false positive)** — Documented; cost-budget interlock at 80% (Plan 35-04) is the safety net.
- **T-35-11 (Information disclosure via StepGroup.goal)** — Mitigated: every goal is `safe_slice`'d to 500 chars at `build_step_groups` construction.

## Forward Pointers

This plan supplies the `count_independent_steps_grouped(query, config) -> Option<Vec<StepGroup>>` API that **Plan 35-04** will wire into `loop_engine::run_loop` as a pre-iteration trigger:

- Plan 35-04 inserts the call ahead of the first iteration tick, gated on `!state.is_subagent` (recursion guard from Plan 35-02) and the 80% cost-budget interlock from Phase 34.
- Plan 35-05 consumes the `Vec<StepGroup>` returned here, dispatching each group as a `SwarmTask` with `is_subagent = true` and rolling up costs.
- The role suggestion in `StepGroup.role` feeds into `agents::AgentRole::system_prompt_snippet()` for sub-agent role specialization.
- v1 trade-off (acceptable per plan output spec): regex compilation runs in the hot path. Plan 35-04 may revisit with `lazy_static!` or `once_cell::Lazy` if profiling shows measurable cost. For now, an order of 3 simple regex compiles per multi-step query is well below any observable threshold.

## Self-Check: PASSED

**Files exist:**
- FOUND: /home/arnav/blade/src-tauri/src/decomposition/planner.rs
- FOUND: /home/arnav/blade/.planning/phases/35-auto-decomposition/35-03-SUMMARY.md

**Commits exist:**
- FOUND: 202e074 (feat(35-03): fill count_independent_steps_grouped — 3-axis heuristic + role selection (DECOMP-01))

**Acceptance criteria:** all 6 checks satisfied (4 helper fns + DECOMP_FORCE_STEP_COUNT 10 refs + safe_slice 5 refs + AgentRole 14 refs + 8/8 tests green + cargo check clean).
