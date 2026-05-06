---
phase: 35-auto-decomposition
plan: 4
subsystem: agentic-loop / decomposition trigger
tags:
  - decomposition
  - DECOMP-01
  - run-loop
  - trigger
  - recursion-gate
  - cost-interlock
  - catch-unwind
  - phase-35
dependency-graph:
  requires:
    - "Phase 35-01 DecompositionConfig (auto_decompose_enabled, min_steps_to_decompose, cost_guard_per_conversation_dollars on resilience.*)"
    - "Phase 35-02 LoopState.is_subagent + LoopHaltReason::DecompositionComplete + executor.rs stub returning DecompositionError::Internal"
    - "Phase 35-03 count_independent_steps_grouped real body (3-axis heuristic) + DECOMP_FORCE_STEP_COUNT seam"
    - "Phase 34 SessionWriter conversation_id thread-through (Plan 34-08)"
    - "Phase 34-04 catch_unwind discipline pattern (detect_stuck wrapper)"
  provides:
    - "Pre-iteration DECOMP-01 trigger in loop_engine::run_loop_inner — fires once per user turn before the iteration loop"
    - "synthetic_assistant_turn_from_summary helper — builds a ConversationMessage::Assistant from a SubagentSummary using the bracketed-prefix marker"
    - "DECOMP_FORCE_PLANNER_PANIC cfg(test) seam in decomposition::planner (panic-injection regression hook)"
    - "Three-gate trigger condition: `!loop_state.is_subagent && config.decomposition.auto_decompose_enabled && parent_budget_pct < 0.8`"
    - "catch_unwind(AssertUnwindSafe) wrapper around count_independent_steps_grouped — panic falls through to sequential"
    - "3 regression tests (recursion gate, disabled toggle, panic injection)"
  affects:
    - "src-tauri/src/decomposition/planner.rs (+9 lines: panic seam declaration + check)"
    - "src-tauri/src/loop_engine.rs (+155 lines: helper + trigger block + signature update; +114 lines: 3 tests; total +269)"
tech-stack:
  added: []
  patterns:
    - "Plan 34-04 catch_unwind discipline reused verbatim (AssertUnwindSafe; eprintln on panic; fall-through to existing path)"
    - "thread_local Cell<bool> panic seam pattern mirrors Plan 33-09 / 34-04 / 35-06 (DECOMP_FORCE_DISTILL_PANIC)"
    - "Pre-iteration boundary: trigger lives BEFORE the for-iteration loop (structurally distinct from per-iteration detect_stuck)"
    - "Halt-via-Err semantics: DecompositionComplete is surfaced as Err(LoopHaltReason::DecompositionComplete), not Ok(()) — matches existing Phase 33+34 halt branches"
    - "Belt-and-suspenders gate redundancy: gate at trigger condition AND auto_decompose_enabled check inside count_independent_steps_grouped"
key-files:
  created: []
  modified:
    - src-tauri/src/decomposition/planner.rs
    - src-tauri/src/loop_engine.rs
decisions:
  - "Halt return shape: `Err(LoopHaltReason::DecompositionComplete)` rather than `Ok(())`. The unit-variant `DecompositionComplete` already exists in LoopHaltReason (Plan 35-02). Returning Err matches every other halt branch in run_loop_inner (CostExceeded, Cancelled, Stuck, ProviderFatal, CircuitOpen). commands.rs maps each LoopHaltReason variant to a UI render path; using Err keeps Plan 35-04 consistent with that contract. The helper-block comment notes that the conversation Vec already holds the synthetic AssistantTurns — the halt is a 'short-circuit, do not iterate' signal, not an error."
  - "ConversationMessage::Assistant is a struct-variant `{ content, tool_calls }`, not a tuple variant. The plan-spec showed `ConversationMessage::Assistant(content)` (tuple syntax). I built it as `ConversationMessage::Assistant { content, tool_calls: Vec::new() }` — empty tool_calls is correct because the synthetic turn is plain text; the parent loop never re-fires tools on a synthetic turn (Plan 35-05 will reaffirm)."
  - "id_excerpt uses `crate::safe_slice(&s.subagent_session_id, 8)` rather than `&s.subagent_session_id[..8]`. ULID strings are ASCII-safe today, so `&s[..8]` would not panic — but BLADE's CLAUDE.md discipline is 'always use safe_slice for any user-content slicing.' subagent_session_id is structurally controlled (ULID) but the safe_slice form survives a future schema edit and follows the discipline."
  - "Gate ordering at the trigger: `!is_subagent && auto_decompose_enabled` is checked BEFORE the cost interlock. Cheaper checks first (single bool reads), and the cost interlock requires a divide-by-cap-with-floor-0.01 which is the most expensive of the three gates. Short-circuit semantics ensure no wasted work."
  - "Cost interlock floor: `cap_dollars.max(0.01)` to avoid divide-by-zero if a user sets `cost_guard_per_conversation_dollars = 0` in their config. With cap=0, every conversation would have pct=infinity, which would always FAIL the `< 0.8` check — so the interlock would always block. The 0.01 floor inverts that: pct = spent / 0.01 = 100×spent_in_cents, which still triggers the interlock at very low spend (correct behavior — a 0-cap user wants the interlock to be conservative)."
  - "Conversation_id parameter threaded through run_loop_inner. The outer run_loop already accepts conversation_id (Plan 34-08 BL-01); previously run_loop_inner did not need it because the carry-over was loaded/saved at the outer boundary. Plan 35-04 needs it inside the trigger so executor::execute_decomposed_task can fork the parent SessionWriter from the same session_id. Empty conversation_id is honored — executor decides what to do with it (Plan 35-05 problem)."
  - "Trigger-block placement: AFTER `let mut turn_acc = turn_acc;` (after rebinding) and BEFORE `for iteration in 0..max_iter`. Choosing this exact line matters because `turn_acc` is moved by-value through the iteration loop's reward-computation branch — the trigger MUST NOT consume turn_acc. By inserting before the loop opens, turn_acc remains owned by the outer scope; if the trigger short-circuits via halt-Err, turn_acc is dropped naturally. If the trigger falls through, turn_acc proceeds into the loop unchanged."
  - "DECOMP_FORCE_PLANNER_PANIC seam placed AFTER the FORCE_STEP_COUNT short-circuit. If FORCE_STEP_COUNT is set, we want the synthetic_groups path (no panic) to take priority — that path is for tests that exercise the trigger trip without invoking real heuristic logic. The panic seam is for tests that need to invoke real planner code AND assert the catch_unwind boundary works. The test resets DECOMP_FORCE_STEP_COUNT to None before exercising the panic path."
  - "Panic test teardown ordering: reset DECOMP_FORCE_PLANNER_PANIC=false BEFORE the assert, so a failing assert does not leak the panic seam into other tests in the same thread (cargo test runs tests in parallel by default, but per-test thread-local state requires careful resetting because thread-local is per-OS-thread, not per-test). This mirrors Plan 33-09 / 34-04 teardown patterns."
metrics:
  duration: ~75 minutes (cargo test build dominated wall-clock — 35m + 15m verification compiles)
  completed: 2026-05-06
  tasks_completed: 3
  commits: 3
  tests_added: 3
  tests_green: 3
  files_modified: 2
---

# Phase 35 Plan 35-04: DECOMP-01 run_loop trigger + recursion gate + cost interlock + panic-injection regression Summary

DECOMP-01 trigger wiring lands in `loop_engine::run_loop_inner`. Before the iteration loop begins, three gates are evaluated: (1) the recursion gate `!loop_state.is_subagent`, (2) the kill switch `config.decomposition.auto_decompose_enabled`, (3) the cost-budget interlock `parent_budget < 80% × cost_guard_per_conversation_dollars`. When all three pass, `count_independent_steps_grouped` is called inside `std::panic::catch_unwind(AssertUnwindSafe(...))`. On `Some(groups) >= min_steps_to_decompose`, `execute_decomposed_task` is awaited; on `Ok(summaries)` the synthetic AssistantTurns are pushed and the parent loop halts with `Err(LoopHaltReason::DecompositionComplete)`. On `Err` (current Plan 35-02 stub returns `Internal("not yet wired")`), the trigger logs and falls through to the existing iteration body unchanged. 3 regression tests green; cargo check clean. Plan 35-05 fills `execute_decomposed_task` body — until then, the trigger compiles + falls through.

## What Shipped

### Task 1: DECOMP_FORCE_PLANNER_PANIC seam in planner.rs

**File modified:** `src-tauri/src/decomposition/planner.rs` (+9 lines)
**Commit:** `3c6c2b3`

New cfg(test) thread_local cell appended to the existing planner thread_local block:

```rust
pub(crate) static DECOMP_FORCE_PLANNER_PANIC: std::cell::Cell<bool> =
    std::cell::Cell::new(false);
```

Body check inserted at the top of `count_independent_steps_grouped`, AFTER the `DECOMP_FORCE_STEP_COUNT` short-circuit, BEFORE the `auto_decompose_enabled` gate:

```rust
#[cfg(test)]
{
    if let Some(forced) = DECOMP_FORCE_STEP_COUNT.with(|c| c.get()) {
        return Some(synthetic_groups(query, forced));
    }
    if DECOMP_FORCE_PLANNER_PANIC.with(|c| c.get()) {
        panic!("test-only induced panic in count_independent_steps_grouped (Plan 35-04 regression seam)");
    }
}
```

Production builds carry zero overhead via `#[cfg(test)]` gating.

### Task 2: synthetic_assistant_turn_from_summary helper + pre-iteration trigger

**File modified:** `src-tauri/src/loop_engine.rs` (+155 lines)
**Commit:** `6430432`

**`synthetic_assistant_turn_from_summary` helper (line 708):** builds a `ConversationMessage::Assistant { content, tool_calls: Vec::new() }` from a `SubagentSummary`. Bracketed prefix matches Phase 32-04 marker pattern:

```text
[Sub-agent summary — step {step_index}, {role}, session {ULID[..8]}…]
{summary_text}

(success={success}, tokens={tokens_used}, cost=${cost_usd:.4f}; full conversation in session {ULID})
```

`id_excerpt` uses `crate::safe_slice(&s.subagent_session_id, 8)` (CLAUDE.md discipline).

**Pre-iteration trigger block (line 881):** inserted after `let mut turn_acc = turn_acc;` and before `for iteration in 0..max_iter`. The exact gate expression:

```rust
if !loop_state.is_subagent && config.decomposition.auto_decompose_enabled {
    let cap_dollars =
        config.resilience.cost_guard_per_conversation_dollars.max(0.01);
    let pct = loop_state.conversation_cumulative_cost_usd / cap_dollars;
    if pct < 0.8 {
        let groups_result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            crate::decomposition::planner::count_independent_steps_grouped(
                last_user_text,
                config,
            )
        }));
        // ... match on groups_result; on Some(groups) >= threshold, await
        // execute_decomposed_task; on Ok(summaries), push synthetic turns +
        // return Err(LoopHaltReason::DecompositionComplete)
    } else {
        log::info!("[DECOMP-01] declined: budget at {}% of per-conversation cap", ...);
    }
}
```

**catch_unwind wrapper (line 911):** mirrors Plan 34-04's detect_stuck pattern. Panic logs `[DECOMP-01] count_independent_steps_grouped panicked; fall through to sequential` and the loop continues to the iteration body.

**Halt return (line 963):** `return Err(LoopHaltReason::DecompositionComplete)` after pushing synthetic turns. Surrounding 5 lines:

```rust
                            for s in &summaries {
                                conversation
                                    .push(synthetic_assistant_turn_from_summary(s));
                            }
                            return Err(LoopHaltReason::DecompositionComplete);
                        }
```

**Signature update:** `run_loop_inner` now accepts `conversation_id: &str` (threaded from outer `run_loop`). Outer wrapper updated to pass `conversation_id` through.

### Task 3: 3 regression tests

**File modified:** `src-tauri/src/loop_engine.rs` (+114 lines)
**Commit:** `194226d`

| Test | Status | Coverage |
|------|--------|----------|
| `phase35_decomp_01_subagent_does_not_recurse` | ✓ ok | Recursion-gate logic at trigger condition; flips is_subagent and verifies the gate is the discriminating factor (T-35-13) |
| `phase35_decomp_01_disabled_no_trigger` | ✓ ok | Disabled-toggle gate at BOTH layers (trigger condition AND planner body) |
| `phase35_decomp_01_panic_in_step_counter_caught` | ✓ ok | Catch_unwind discipline on count_independent_steps_grouped panic (T-35-12) |

**Test run output:**

```
running 3 tests
test loop_engine::tests::phase35_decomp_01_disabled_no_trigger ... ok
test loop_engine::tests::phase35_decomp_01_subagent_does_not_recurse ... ok
test loop_engine::tests::phase35_decomp_01_panic_in_step_counter_caught ... ok

test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 706 filtered out; finished in 0.02s
```

## Verification

**cargo check (lib + tests):** clean exit 0 (warnings only, all pre-existing or expected).

**cargo test --lib loop_engine::tests::phase35_decomp_01:** 3/3 green.

**Plan 35-03 regression check (cargo test --lib decomposition::planner::tests):** 8/8 still green:

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

test result: ok. 8 passed; 0 failed; 0 ignored; 0 measured; 701 filtered out; finished in 0.24s
```

The new `DECOMP_FORCE_PLANNER_PANIC` seam does NOT trip when unset (default `false`), so all existing planner tests are unaffected.

**Acceptance criteria grep checks:**

| Criterion | Target | Actual | Status |
|-----------|--------|--------|--------|
| `fn synthetic_assistant_turn_from_summary` in loop_engine.rs | 1 | 1 | ✓ |
| `count_independent_steps_grouped` in loop_engine.rs | ≥1 | 4 (call + comments) | ✓ |
| `execute_decomposed_task` in loop_engine.rs | ≥1 | 4 (call + comments) | ✓ |
| `DecompositionComplete` in loop_engine.rs | ≥2 (variant + return site) | 9 | ✓ |
| `is_subagent` in loop_engine.rs | ≥2 (struct field + trigger gate) | 11 | ✓ |
| `auto_decompose_enabled` in loop_engine.rs | ≥1 | 2 | ✓ |
| `DECOMP_FORCE_PLANNER_PANIC` in planner.rs | ≥2 (decl + check) | 2 | ✓ |
| 3 regression tests green | 3/3 | 3/3 | ✓ |
| cargo check exit 0 | 0 | 0 | ✓ |

**Three-gate boolean expression (canonical site, line 906–910):**

```rust
if !loop_state.is_subagent && config.decomposition.auto_decompose_enabled {
    let cap_dollars =
        config.resilience.cost_guard_per_conversation_dollars.max(0.01);
    let pct = loop_state.conversation_cumulative_cost_usd / cap_dollars;
    if pct < 0.8 {
        // ... trigger body (catch_unwind + planner call + executor await + halt)
    }
}
```

**catch_unwind wrapper site:** line 911 (`std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| { count_independent_steps_grouped(last_user_text, config) }))`).

## Deviations from Plan

### Plan-Spec Adjustments (data shape, not behavior)

**1. ConversationMessage::Assistant is struct-variant, not tuple-variant**
- **Found during:** Task 2 implementation (helper compile)
- **Issue:** Plan-prescribed code used `ConversationMessage::Assistant(content)` (tuple syntax). The actual variant is `Assistant { content: String, tool_calls: Vec<ToolCall> }` (struct).
- **Fix:** Constructed as `ConversationMessage::Assistant { content, tool_calls: Vec::new() }`. Empty `tool_calls` is correct: the synthetic turn is plain assistant text; the parent loop never re-fires tools on a synthetic turn.
- **Files modified:** `src-tauri/src/loop_engine.rs`
- **Commit:** `6430432`

**2. id_excerpt uses safe_slice rather than direct byte-index**
- **Found during:** Task 2 helper draft
- **Issue:** Plan-prescribed code used `&s.subagent_session_id[..8]` for the 8-char prefix. While ULID strings are ASCII-safe (no panic risk today), CLAUDE.md discipline is "always use safe_slice for any user-content slicing."
- **Fix:** Used `crate::safe_slice(&s.subagent_session_id, 8)`. Behavior identical for ULID-shaped IDs; survives a future schema edit that introduces non-ASCII session_ids.
- **Files modified:** `src-tauri/src/loop_engine.rs`
- **Commit:** `6430432`

**3. Halt return is `Err(LoopHaltReason::DecompositionComplete)`, not `Ok(LoopHaltReason::DecompositionComplete)`**
- **Found during:** Task 2 cargo check pass
- **Issue:** Plan-prescribed code (and user prompt context) showed `return Ok(LoopHaltReason::DecompositionComplete)`. But `run_loop_inner` returns `Result<(), LoopHaltReason>` — `Ok(...)` would be `Ok(())`. Returning `Ok(())` here means "loop produced a normal final answer" which mismatches the loop-engine's halt-via-Err convention. Every other halt branch (CostExceeded, Cancelled, Stuck, ProviderFatal, CircuitOpen) uses `Err(LoopHaltReason::*)`.
- **Fix:** Used `return Err(LoopHaltReason::DecompositionComplete)`. commands.rs maps each `LoopHaltReason` variant to a UI render path; this keeps Plan 35-04 consistent with the existing contract.
- **Files modified:** `src-tauri/src/loop_engine.rs`
- **Commit:** `6430432`

**4. conversation_id threaded through run_loop_inner signature**
- **Found during:** Task 2 implementation
- **Issue:** The trigger needs `conversation_id` to pass to `execute_decomposed_task` as `_parent_session_id`, but `run_loop_inner`'s pre-Plan 35-04 signature did not accept it (the outer `run_loop` consumed it for carry-over load/save and did not forward).
- **Fix:** Added `conversation_id: &str` as the trailing parameter to `run_loop_inner`; updated the outer `run_loop` call site to pass it through. Empty conversation_id is honored — executor handles it (Plan 35-05 problem).
- **Files modified:** `src-tauri/src/loop_engine.rs`
- **Commit:** `6430432`

**5. DECOMP_FORCE_PLANNER_PANIC ordered AFTER FORCE_STEP_COUNT, not BEFORE**
- **Found during:** Task 1 placement decision
- **Issue:** Plan-prescribed text said "Insert panic check in count_independent_steps_grouped body, after FORCE_STEP_COUNT check, before auto_decompose_enabled gate" — which was followed verbatim. But initially I considered inverting the order to ensure panic always fires when set. Settled on the plan's ordering because: (a) tests using FORCE_STEP_COUNT want the synthetic_groups path (no panic) to take priority; (b) tests using DECOMP_FORCE_PLANNER_PANIC reset FORCE_STEP_COUNT first, so the order does not affect their outcome; (c) the order matches the plan-spec.
- **Fix:** None — adopted plan ordering after the analysis.

### No Auto-fixed Bugs

No Rule 1 / Rule 2 / Rule 3 deviations. Plan 35-03 left the planner in a clean state; the only adjustments above are data-shape mismatches between the plan-spec syntax and the live code's actual types.

## Threat Flags

None — Plan 35-04 introduces no new network endpoints, auth paths, file-access patterns, or schema changes at trust boundaries. The plan's threat register is unchanged:

- **T-35-12 (catch_unwind regression silently removed)** — Mitigated by `phase35_decomp_01_panic_in_step_counter_caught` test. Removing the wrapper at line 911 fails the test loudly.
- **T-35-13 (recursion gate silently removed)** — Mitigated by `phase35_decomp_01_subagent_does_not_recurse` test. The belt-and-suspenders second assertion (gate re-enables when is_subagent flips back) makes the test failure-mode informative.
- **T-35-14 (80% interlock false positive)** — Locked behavior per 35-CONTEXT §DECOMP-02. Soft gate; in-flight sub-agents finish their iteration; future siblings skipped.
- **T-35-15 (last_user_text disclosure via planner)** — last_user_text is already in the conversation Vec; no NEW disclosure surface introduced by Plan 35-04.

## Forward Pointers

This plan supplies the run_loop trigger that **Plan 35-05** will exercise:

- Plan 35-05 fills `decomposition::executor::execute_decomposed_task` body. Once that lands, the trigger's `Ok(summaries)` branch becomes a real fan-out + summary path; the parent halts with `DecompositionComplete` and commands.rs renders the synthetic AssistantTurns to the chat UI.
- Plan 35-06 fills `decomposition::summary::distill_subagent_summary` (cheap-model summary pass). The synthetic turn's `summary_text` field becomes the distilled output; today (Plan 35-02 stub) the field is empty.
- Plan 35-07 wires the `commands::send_message_stream_inline` halt-handling for `LoopHaltReason::DecompositionComplete` (today, the variant exists but is not yet mapped to a UI render path; Plan 35-07 maps it to a normal end-of-turn no-error completion).
- Plan 35-08 wires the `subagent_isolation` config field (LoopState recursion gate already implemented; isolation refers to per-subagent SessionWriter forks).
- Plan 35-11 closes the phase with UAT: "5+ verb query triggers fan-out; 3 sub-agents finish in parallel; parent renders ONE synthetic turn per sub-agent."

## Self-Check: PASSED

**Files exist:**
- FOUND: /home/arnav/blade/src-tauri/src/decomposition/planner.rs
- FOUND: /home/arnav/blade/src-tauri/src/loop_engine.rs
- FOUND: /home/arnav/blade/.planning/phases/35-auto-decomposition/35-04-SUMMARY.md

**Commits exist:**
- FOUND: 3c6c2b3 (feat(35-04): add DECOMP_FORCE_PLANNER_PANIC seam)
- FOUND: 6430432 (feat(35-04): wire pre-iteration DECOMP-01 trigger + cost-budget interlock + recursion gate)
- FOUND: 194226d (test(35-04): add 3 DECOMP-01 trigger regression tests)

**Acceptance criteria:** all 9 grep + test checks satisfied (helper present + planner+executor refs + DecompositionComplete + is_subagent + auto_decompose_enabled + DECOMP_FORCE_PLANNER_PANIC + 3/3 tests green + cargo check clean + Plan 35-03 regression intact).
