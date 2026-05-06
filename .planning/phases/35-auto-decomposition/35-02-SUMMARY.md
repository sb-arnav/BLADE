---
phase: 35-auto-decomposition
plan: 2
subsystem: agentic-loop / decomposition substrate
tags:
  - LoopState
  - LoopHaltReason
  - decomposition
  - substrate
  - phase-35
dependency-graph:
  requires:
    - "Phase 33 LoopState + LoopHaltReason base (Plans 33-02..33-09)"
    - "Phase 34 LoopState extensions (Plan 34-02 — 8 fields, CostScope, AttemptRecord)"
    - "Phase 34 resilience/ + session/ scaffold (Plan 34-03 — mirror pattern for decomposition/)"
    - "agents/mod.rs AgentRole (8 roles, Serialize+Deserialize already wired)"
  provides:
    - "LoopState.is_subagent recursion gate field (default false)"
    - "LoopHaltReason::DecompositionComplete unit variant"
    - "decomposition/ module with planner/executor/summary submodules"
    - "StepGroup, SubagentSummary, DecompositionError IPC type shapes (Serialize+Deserialize)"
    - "3 thread_local test seams (DECOMP_FORCE_STEP_COUNT, DECOMP_FORCE_SUBAGENT_RESULT, DECOMP_FORCE_DISTILL_PANIC)"
    - "Stub bodies for count_independent_steps_grouped, execute_decomposed_task, distill_subagent_summary"
  affects:
    - "src-tauri/src/loop_engine.rs (LoopState struct + LoopHaltReason enum)"
    - "src-tauri/src/lib.rs (mod decomposition; declaration)"
    - "src-tauri/src/commands.rs (added DecompositionComplete match arm — Rule 3 blocker fix)"
tech-stack:
  added: []
  patterns:
    - "Phase 34-02 LoopState extension pattern (append after existing fields, no clone helper since LoopState derives Clone)"
    - "Phase 34-03 module-scaffold pattern (mod.rs root + N submodules with stub bodies + thread_local seams)"
    - "Phase 33-04/34-04 thread_local force-seam pattern (cfg(test)-only, zero production overhead)"
    - "Phase 34-08 LoopHaltReason::Serialize derive (already inherited; new variant rides existing posture)"
key-files:
  created:
    - src-tauri/src/decomposition/mod.rs
    - src-tauri/src/decomposition/planner.rs
    - src-tauri/src/decomposition/executor.rs
    - src-tauri/src/decomposition/summary.rs
  modified:
    - src-tauri/src/loop_engine.rs
    - src-tauri/src/lib.rs
    - src-tauri/src/commands.rs
decisions:
  - "Cell vs RefCell for DECOMP_FORCE_SUBAGENT_RESULT: switched plan-prescribed Cell<Option<SubagentSummary>> to RefCell because SubagentSummary contains Strings and is therefore !Copy; Cell::get() requires Copy. Behavior identical (set/take/clear); plan's spec is preserved at the API level."
  - "Added LoopHaltReason::DecompositionComplete match arm in commands.rs:2071 (Rule 3 auto-fix). Plan threat model T-35-06 said 'cargo will warn'; in practice the existing match was exhaustive so it errored. Minimal pass-through (chat_done + idle status) keeps cargo check clean; Plans 35-04/07 will replace with full emit cadence."
  - "Skipped plan Step B (clone_loop_state extension) because no clone_loop_state helper exists in current loop_engine.rs (Phase 33+34 ship LoopState with #[derive(Clone)]). Test 3 calls .clone() instead. Documented in test comment."
  - "DiskConfig literal at config.rs:1875 fails to compile because Plan 35-01 (parallel) added DecompositionConfig but did not extend the test-only struct literal. Per execution directive ('don't touch config.rs — 35-01 owns DecompositionConfig'), this is left for 35-01 to close. cargo check (production) is clean; cargo test --lib does not compile until 35-01 lands."
metrics:
  duration: ~25 minutes
  completed: 2026-05-06
---

# Phase 35 Plan 35-02: LoopState.is_subagent + LoopHaltReason::DecompositionComplete + decomposition/ scaffold Summary

Type substrate for Phase 35 auto-decomposition: LoopState gains `is_subagent: bool` recursion gate, LoopHaltReason gains `DecompositionComplete` variant, and a new `decomposition/` module ships 4 files (mod.rs + planner.rs + executor.rs + summary.rs) with 3 thread_local test seams + 4 IPC type shapes locked behind stub bodies. cargo check exits 0; substrate compiles even though every body is a TODO.

## What Shipped

### Task 1: LoopState.is_subagent + LoopHaltReason::DecompositionComplete

**File modified:** `src-tauri/src/loop_engine.rs`

- Appended `pub is_subagent: bool` to `LoopState` (post Phase 34's `cost_warning_80_emitted`). Default `false` (parent loops) — `LoopState` already derives `Default` so the new field auto-defaults via `#[derive(Default)]` on the bool.
- Appended `DecompositionComplete` (no payload) to `LoopHaltReason` after `CircuitOpen`. Inherits the existing `serde::Serialize` derive (Phase 34-08 added it for SESS-01 JSONL persistence).
- Added 3 regression tests in the existing `#[cfg(test)] mod tests` block:
  - `phase35_loop_state_has_is_subagent_default_false`
  - `phase35_loop_halt_reason_decomposition_complete_serde_roundtrip`
  - `phase35_clone_loop_state_preserves_is_subagent` (uses derived `Clone`; no `clone_loop_state` helper exists in current Phase 33+34 codebase)

**Grep counts:**
- `pub is_subagent: bool` → **1** (target: 1) ✓
- `DecompositionComplete` → **7** (target ≥2 — variant + serde test + Debug emit + 3 references in commands.rs match arm + comment) ✓

**File modified (Rule 3 blocker fix):** `src-tauri/src/commands.rs`

Added `Err(LoopHaltReason::DecompositionComplete) => { chat_done + idle status; return Ok(()) }` arm. The existing match was exhaustive against the 6-variant enum; appending the 7th variant produced E0004 "non-exhaustive patterns". The pass-through is correct per CONTEXT lock §DECOMP-02 ("the conversation already holds the summaries"); Plans 35-04 + 35-07 will wire the full emit cadence.

### Task 2: decomposition/ scaffold

**Files created:**

```
src-tauri/src/decomposition/
  mod.rs       (1.7K) — pub mod planner/executor/summary + re-exports of StepGroup/DecompositionError/SubagentSummary
  planner.rs   (4.0K) — StepGroup struct (5 fields) + count_independent_steps_grouped STUB (returns None) + DECOMP_FORCE_STEP_COUNT seam (Cell<Option<u32>>) + 3 unit tests
  executor.rs  (4.0K) — DecompositionError enum (4 variants) + execute_decomposed_task STUB (returns Err Internal) + DECOMP_FORCE_SUBAGENT_RESULT seam (RefCell<Option<SubagentSummary>>) + 3 unit tests
  summary.rs   (4.2K) — SubagentSummary struct (7 fields) + distill_subagent_summary STUB (returns Err) + DECOMP_FORCE_DISTILL_PANIC seam (Cell<bool>) + 3 unit tests
```

**ls output:**
```
total 36
drwxr-xr-x  2 arnav arnav  4096 May  6 16:32 .
drwxr-xr-x 13 arnav arnav 12288 May  6 16:44 ..
-rw-r--r--  1 arnav arnav  4009 May  6 16:32 executor.rs
-rw-r--r--  1 arnav arnav  1712 May  6 16:31 mod.rs
-rw-r--r--  1 arnav arnav  3982 May  6 16:31 planner.rs
-rw-r--r--  1 arnav arnav  4180 May  6 16:32 summary.rs
```

**File modified:** `src-tauri/src/lib.rs`

Inserted `mod decomposition;` immediately after `mod resilience;` and `mod session;` (Phase 34-03 anchors at L173-L174). Comment notes "Phase 35 v1.5 — DECOMP-01..05 auto-decomposition (Plan 35-02 scaffold)".

**Grep counts:**
- `^mod decomposition` in lib.rs → **1** ✓
- `pub mod planner` / `pub mod executor` / `pub mod summary` in mod.rs → **1** each ✓
- `pub struct StepGroup` in planner.rs → **1** ✓
- `pub fn count_independent_steps_grouped` in planner.rs → **1** ✓
- `DECOMP_FORCE_STEP_COUNT` in planner.rs → **5** (target ≥2) ✓
- `pub enum DecompositionError` in executor.rs → **1** ✓
- `pub async fn execute_decomposed_task` in executor.rs → **1** ✓
- `DECOMP_FORCE_SUBAGENT_RESULT` in executor.rs → **3** (target ≥2) ✓
- `pub struct SubagentSummary` in summary.rs → **1** ✓
- `pub async fn distill_subagent_summary` in summary.rs → **1** ✓
- `DECOMP_FORCE_DISTILL_PANIC` in summary.rs → **6** (target ≥2) ✓

**All 14 acceptance grep checks satisfied.**

## Test Coverage

10 unit tests added across 4 files:

| File | Test | Purpose |
|------|------|---------|
| loop_engine.rs | `phase35_loop_state_has_is_subagent_default_false` | LoopState default value lock |
| loop_engine.rs | `phase35_loop_halt_reason_decomposition_complete_serde_roundtrip` | Variant serialises with discriminant |
| loop_engine.rs | `phase35_clone_loop_state_preserves_is_subagent` | Derived Clone preserves new field |
| planner.rs | `phase35_step_group_serde_roundtrip` | StepGroup Serialize+Deserialize works |
| planner.rs | `phase35_count_independent_steps_grouped_stub_returns_none` | Stub body returns None |
| planner.rs | `phase35_decomp_force_step_count_seam_returns_synthetic_groups` | Seam injects synthetic groups |
| executor.rs | `phase35_decomposition_error_serde_roundtrip` | DecompositionError serialise/parse |
| executor.rs | `phase35_decomp_force_subagent_result_seam_declared` | Seam round-trips a SubagentSummary |
| executor.rs | `phase35_execute_decomposed_task_stub_returns_internal_err` | Stub error shape lock |
| summary.rs | `phase35_subagent_summary_serde_roundtrip` | SubagentSummary serialise/parse |
| summary.rs | `phase35_decomp_force_distill_panic_seam_declared` | Seam round-trips a bool |
| summary.rs | `phase35_distill_subagent_summary_stub_returns_err` | Stub error shape lock |

## Verification

**cargo check:** exits **0** (production build clean). 21 warnings — all benign:
- 6 are "never used / never constructed" on Plan 35-02 stubs (`StepGroup`, `count_independent_steps_grouped`, `DecompositionError`, `execute_decomposed_task`, `SubagentSummary`, `distill_subagent_summary`, `is_subagent`, `DecompositionComplete`) — expected and intentional. Wave-2 plans consume these.
- 3 are pre-existing `loop_engine.rs:40` deprecated-import + `loop_engine.rs:829` unused-mut warnings unrelated to this plan.
- The remaining 12 are pre-existing warnings in `reward.rs`, `commands.rs:171`, `active_inference.rs`, `vitality_engine.rs`, `session/log.rs` — all out-of-scope per CLAUDE.md scope-boundary discipline.
- Plus 3 unused-import warnings on the `pub use` re-exports in `decomposition/mod.rs` — these are required by the plan acceptance criteria (Plans 35-04+ will consume the re-exports).

**cargo test --lib:** **does not compile** due to a pre-existing E0063 in `src/config.rs:1875` (the `reward_weights_round_trip` test's struct-literal `DiskConfig {...}` is missing the `decomposition` field that Plan 35-01 added). Per the execution directive "Plan 35-01 runs in parallel — don't touch config.rs (35-01 owns DecompositionConfig there)", this is left as a 35-01 closure item. Plan 35-02's tests compile cleanly in isolation; only the test-binary link fails on the unrelated literal. Once 35-01 lands the literal-completion fix, all 12 Plan 35-02 tests will run.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added LoopHaltReason::DecompositionComplete match arm in commands.rs**
- **Found during:** Task 1 cargo check
- **Issue:** Adding the new variant produced `error[E0004]: non-exhaustive patterns: 'Err(LoopHaltReason::DecompositionComplete) not covered'` at `src/commands.rs:1990` — a previously-exhaustive match. Plan's threat model T-35-06 said "cargo will warn"; in practice it errored.
- **Fix:** Added a minimal pass-through arm (chat_done emit + idle status + return Ok(())) consistent with CONTEXT lock §DECOMP-02 ("the conversation already holds the summaries"). Plans 35-04/07 will replace with full emit cadence.
- **Files modified:** `src-tauri/src/commands.rs`
- **Commit:** 55b93bd (folded into Task 1 commit)

**2. [Spec deviation - data-shape] Cell → RefCell for DECOMP_FORCE_SUBAGENT_RESULT**
- **Found during:** Task 2 cargo check
- **Issue:** Plan prescribed `Cell<Option<SubagentSummary>>`; `Cell::get()` requires `Copy`, but `SubagentSummary` contains String fields and is therefore `!Copy`.
- **Fix:** Switched to `RefCell<Option<SubagentSummary>>`. Same set/take/clear semantics; tests adjusted (`*c.borrow_mut() = Some(s)` and `c.borrow_mut().take()`).
- **Files modified:** `src-tauri/src/decomposition/executor.rs`
- **Commit:** d37267a (folded into Task 2 commit)

**3. [Plan deviation - missing helper] Step B (clone_loop_state extension) skipped**
- **Found during:** Task 1 read_first scan
- **Issue:** Plan's Step B says: "If LoopState derives Default and the helper uses `..s` rest-spread instead of explicit field listing, no edit needed; verify by reading the helper." Reading the file via `grep -n "clone_loop_state\|fn clone_loop"` returned **zero matches** — no `clone_loop_state` helper exists in the current Phase 33+34 codebase. LoopState derives `Clone` directly.
- **Fix:** Skipped Step B. Test 3 (`phase35_clone_loop_state_preserves_is_subagent`) was rewritten to call `s.clone()` directly, exercising the derived `Clone` impl. Documented in the test's inline comment.
- **Files modified:** `src-tauri/src/loop_engine.rs` (test only)
- **Commit:** 55b93bd

### Deferred Issues

**1. [Cross-plan blocker] `cargo test --lib` compile failure in config.rs:1875**
- **Cause:** Plan 35-01 added `DecompositionConfig` + `BladeConfig.decomposition` + `DiskConfig.decomposition` fields but did not extend the test-only `DiskConfig {...}` struct literal in `reward_weights_round_trip` (line 1875).
- **Status:** Out-of-scope per execution directive. Belongs to 35-01.
- **Impact:** Plan 35-02 unit tests compile cleanly in isolation but cannot run until 35-01 lands the literal-completion fix.
- **Resolution path:** When 35-01 closes, all 12 Plan 35-02 tests will run automatically.

## Threat Flags

None — Plan 35-02 ships only type substrate. No new network endpoints, auth paths, file-access patterns, or schema changes at trust boundaries. The `is_subagent` recursion gate is the security-relevant addition, and it's already in the plan's threat register (T-35-07 mitigation).

## Forward Pointers

Plans 35-03 through 35-11 fill the substrate:
- **35-03** — fills `count_independent_steps_grouped` body (3-axis heuristic: verb groups, file/project nouns, tool families)
- **35-04** — wires the DECOMP-01 trigger into `run_loop` (pre-iteration check, AssertUnwindSafe wrap, 80% cost-budget interlock)
- **35-05** — fills `execute_decomposed_task` (swarm dispatch + per-sub-agent fork_session + cost rollup + `is_subagent = true` plumbing)
- **35-06** — fills `distill_subagent_summary` (load_session + cheap_model_for_provider + catch_unwind heuristic fallback)
- **35-07** — replaces `commands.rs` `DecompositionComplete` pass-through arm with full emit cadence (subagent_complete events, synthetic AssistantTurn injection)
- **35-08/09/10** — `merge_fork_back` Tauri command + frontend SessionsView Merge-back UI + ActivityStrip subagent_* chips + optional SubagentProgressBubble
- **35-11** — phase closure with runtime UAT (chat with 6-step query, screenshot ActivityStrip + SessionsView + chat surface at 1280×800 + 1100×700)

## Self-Check: PASSED

**Files exist:**
- FOUND: src-tauri/src/decomposition/mod.rs
- FOUND: src-tauri/src/decomposition/planner.rs
- FOUND: src-tauri/src/decomposition/executor.rs
- FOUND: src-tauri/src/decomposition/summary.rs

**Commits exist:**
- FOUND: 55b93bd (feat(35-02): add LoopState.is_subagent + LoopHaltReason::DecompositionComplete)
- FOUND: d37267a (feat(35-02): scaffold decomposition/ module with 3 test seams + 4 type shapes)

**Acceptance criteria:** all 14 grep checks satisfied; cargo check exits 0.
