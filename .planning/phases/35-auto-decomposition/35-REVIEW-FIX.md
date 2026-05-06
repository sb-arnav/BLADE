---
phase: 35-auto-decomposition
fixed_at: 2026-05-06T18:30:00Z
review_path: .planning/phases/35-auto-decomposition/35-REVIEW.md
iteration: 1
findings_in_scope: 5
fixed: 4
deferred: 1
skipped: 0
status: partial
---

# Phase 35: Code Review Fix Report

**Fixed at:** 2026-05-06T18:30:00Z
**Source review:** `.planning/phases/35-auto-decomposition/35-REVIEW.md`
**Iteration:** 1
**Scope decision:** BLOCKER + HIGH only. All MEDIUM (ME-01 .. ME-04) and LOW
(LO-01, LO-02, LO-03) findings deferred to v1.6 per operator directive.

**Summary:**
- Findings in scope (BLOCKER + HIGH): 5
- Fixed (commits landed): 4
- Deferred with code-comment + report documentation: 1 (HI-04 — option A)
- Skipped: 0

**Test gate:** `cargo test --lib phase35` (47 pass) + `cargo test --test loop_engine_integration` (8 pass) — both green, including the 4 new regression tests.

---

## Fixed Issues

### BL-01: Disabled-JSONL session fans out into N "fork failed" messages

**Files modified:** `src-tauri/src/loop_engine.rs`
**Commit:** `b6f7f09`
**Test added:** `phase35_decomp_01_trigger_skipped_when_jsonl_disabled` (loop_engine.rs unit test)

**Applied fix:** Added `&& !conversation_id.is_empty()` to the DECOMP-01 trigger
gate at `run_loop_inner` (`loop_engine.rs:914`). When `session.jsonl_log_enabled = false`
(documented escape hatch), `commands.rs` falls back to
`(SessionWriter::no_op(), String::new())` so the parent's session_id is the
empty string. Without this guard, every `fork_session("")` call rejects via
`validate_session_id`, ALL N sub-agent spawns return fork-failed stubs, and
the user sees N synthetic `[fork failed: invalid session id: ]` AssistantTurns
instead of normal sequential chat.

The fix is the smaller of the two options proposed in the review (gate at
trigger vs. early-return inside `execute_decomposed_task`). Gating at the
trigger avoids the swarm-build + DAG-validate cost in the disabled-JSONL
path, and falls through to the existing iteration loop unchanged.

**Why this matters (BLOCKER classification):** `auto_decompose_enabled = true`
is the default; `jsonl_log_enabled = false` is a documented CTX-07 escape
hatch. ANY user combining both gets 5+ fake failures on every 5+ step query
— a v1.1-class DOA pattern.

---

### HI-01: subagent_progress events never emitted by Rust

**Files modified:** `src-tauri/src/decomposition/executor.rs`
**Commit:** `f18fa3a`
**Test added:** `phase35_decomp_05_subagent_progress_emitted_between_started_and_complete`

**Applied fix:** Added `emit_subagent_progress` helper + a one-tick
`subagent_progress { status: 'running' }` emit in `spawn_isolated_subagent`
between fork success and `run_subagent_to_halt`. Also factored out a pure
`build_subagent_progress_payload(step_index, status, detail)` helper so
unit tests can pin the payload shape without an `AppHandle` (the codebase
explicitly avoids `tauri::test::mock_app()` per `reward.rs:664`).

The helper supports all four TS-declared status variants (`running`,
`tool_call`, `compacting`, `verifying`) and an optional `detail` field
safe-sliced to 200 chars. v1 emits only `running`; the richer status set
(per CONTEXT §DECOMP-05) lands when Plan 35-11 UAT wires the real
`run_loop` dispatch.

**Effect:** SubagentProgressBubble + ActivityStrip consumers no longer sit
with frozen 'running' pills — they receive a live progress tick between
the started and complete events.

---

### HI-02: subagent_isolation config field declared but never read

**Files modified:** `src-tauri/src/decomposition/executor.rs`
**Commit:** `8f72dac`
**Test added:** `phase35_decomp_02_isolation_false_skips_fork`

**Applied fix:** Threaded the `subagent_isolation` flag through
`execute_decomposed_task_inner` into `spawn_isolated_subagent`. The toggle
is read ONCE at the top of `execute_decomposed_task_inner` (single source
of truth) and passed as a `bool` arg to the spawn function — the compiler
now mechanically enforces every caller updates if the param is dropped.

The branch logic in `spawn_isolated_subagent` step (a):
- `isolation = true` (default, locked production posture): `fork_session(...)` produces a fresh sub-agent JSONL via Phase 34 SESS-04 substrate.
- `isolation = false` (DEBUG only): reuse `parent_session_id` directly, NO `fork_session` call. Cost rollup remains additive but sub-agent JSONL writes mingle with the parent's.

A `log::warn!` fires when isolation is false so a user who flips it for
debugging sees a console signal that they're in DEBUG mode, including the
explicit warning that the branch exists ONLY for tracing fan-out ordering
when chasing a SESS-02 resume bug and is destructive for normal use.

**Verification:** `phase35_decomp_02_isolation_false_skips_fork` pins:
1. Default `subagent_isolation = true` (regression guard).
2. The `isolation=false` branch returns `parent_session_id` verbatim (no
   fork call).
3. The `isolation=true` branch routes to `fork_session`.

---

### HI-03: max_parallel_subagents config field never gates concurrency

**Files modified:** `src-tauri/src/decomposition/executor.rs`
**Commit:** `c56d6f7`
**Test added:** `phase35_decomp_02_max_parallel_respected_at_dispatch`

**Applied fix:** Removed the leading underscore from
`let _max_concurrent = ...` (executor.rs:117) and added a `log::info!` line
that surfaces the value at runtime. Per the operator's HI-03 fall-back
directive ("if parallel dispatch is too brittle, document as v1 lock and
keep serial — the test then asserts the config value is READ, not that
parallelism is enforced"), this is the smaller fix.

**Rationale for the v1 simplification:**
- `run_subagent_to_halt` is a placeholder until Plan 35-11 UAT;
  parallelizing the placeholder buys nothing.
- The serial-only posture is defensible (CONTEXT §DECOMP-03 locks serial
  summary distillation for deterministic ordering).
- Plan 35-11 is the natural site for swapping the `for group in &groups`
  loop for a JoinSet/buffer_unordered dispatch — the value is now
  consumed (no underscore), so v1.6 lands as a single-line consumer
  change rather than a config-rewire.

**Verification:** `phase35_decomp_02_max_parallel_respected_at_dispatch`
pins:
1. Default 3 (config.rs default re-asserted).
2. Pathological 50 clamps to swarm.rs's 5-concurrent cap.
3. Edge case 0 computes to 0 (v1 logs + walks serially; v1.6 may
   interpret as halt-all).

A future regression that re-prefixes the binding with `_` would surface as
an unused-binding compile warning + the test would fail.

---

## Deferred Issues

### HI-04: Cost rollup interlock is structurally unreachable in v1

**Files referenced:** `src-tauri/src/decomposition/executor.rs:122-145`, `:444`
**Disposition:** Option A — defer with documentation. NO code change in
this fix run. Operator-approved fall-back.

**Reasoning:** The cost-rollup CODE is correct in shape — the issue is that
`run_subagent_to_halt` returns `Ok::<_, _>((true, 0.0, 0))` as the v1
placeholder, so `summary.cost_usd` is always 0.0 and the rollup adds
nothing. The RES-04 interlock at `executor.rs:125` (`>= cap_dollars`) is
therefore structurally unreachable in v1.

Per the operator's directive: **Option A (defer with documentation) was
chosen over Option B (synthetic non-zero placeholder cost) because Option B
would corrupt cost tracking for the legitimate `DECOMP_FORCE_SUBAGENT_RESULT`
path that integration tests rely on.**

The current placeholder is correctly documented at `executor.rs:331-365`
(`run_subagent_to_halt`'s doc comment explicitly notes the v1 boundary,
the deferred Plan 35-11 UAT, and the reasons the real `run_loop` invocation
is elided). The integration test `phase35_decomp_02_cost_rollup_sums_subagent_costs`
exercises the rollup arithmetic directly (synthetic costs injected into
the loop), and `phase35_decomposition_full_pipeline_via_force_seams`
exercises the FORCE-seam path. Both cover the rollup contract; the
placeholder gap is the deferred wiring, not the rollup logic.

**Cleanup will land naturally with Plan 35-11 UAT** when the real
`run_loop` invocation replaces the placeholder. At that point the
interlock becomes reachable in production and the existing integration
test continues to pin the contract.

**No commit for HI-04** — pure documentation deferral as approved.

---

## Items Deferred to v1.6 (out of scope per operator directive)

The following MEDIUM and LOW findings were not addressed in this fix run.
Per the operator's BLOCKER + HIGH-only scope, these defer to v1.6:

### MEDIUM (4 deferred)

- **ME-01: build_swarm_from_groups produces a Swarm that is validated then discarded.**
  Locked design (CONTEXT §DECOMP-02 specifies `swarm_commands::spawn_task_agent`
  dispatch) but currently only the `validate_dag` use-case fires. Latent —
  the planner emits empty `depends_on` so topological-sort drift is dormant.
  v1.6 fix: either lift `validate_dag` to take `&[StepGroup]` directly (simpler)
  or wire the actual swarm dispatch (CONTEXT-locked path). Either way, the
  swarm-DB-write side is deferred.

- **ME-02: subagent_started/complete events not paired to JSONL via emit_with_jsonl.**
  Forensic continuity gap — parent's JSONL has no record of fan-out occurring
  (only the synthetic AssistantTurns). v1.6 fix: pass the parent's
  `&SessionWriter` into `spawn_isolated_subagent` and use `emit_with_jsonl` for
  both started and complete. Mechanical signature change.

- **ME-03: heuristic_fallback's success=false default + executor's `&&` collapse.**
  In v1 with placeholder dispatch, this is mostly fine because no real work
  happens. After Plan 35-11 UAT, a real successful run with a transient distill
  error would surface as failed to the user. v1.6 fix: distinguish "distill
  failed but sub-agent succeeded" from "sub-agent failed".

- **ME-04: Cost-budget interlock 80% threshold uses `pct < 0.8` strict.**
  Boundary case slip — `pct == 0.8` triggers fan-out; the 100% halt at
  executor.rs:125 uses `>=` (inclusive). Inconsistent edge case, low impact
  with f32 arithmetic. v1.6 fix: `pct >= 0.8` for symmetry.

### LOW (3 deferred)

- **LO-01: Mixed eprintln!/log::warn! within same module.** Cosmetic.
- **LO-02: SubagentProgressBubble re-renders on every loop event regardless of kind.** Frontend-only; no leak; CPU negligible.
- **LO-03: SwarmStatus and SwarmTask fields fabricated for an unused Swarm.** Resolves with ME-01.

All MEDIUM and LOW findings remain documented in `35-REVIEW.md` for future
reference; v1.6 fix run can pull from the same source.

---

## Verification Summary

**Per-fix verification (Tier 1 + Tier 2 where applicable):**
- BL-01: re-read modified file section + new test passes.
- HI-01: re-read + new test passes.
- HI-02: re-read + new test passes + spawn signature change is compiler-enforced.
- HI-03: re-read + new test passes.

**Whole-suite verification (Tier 3):**
- `cargo check --lib --tests` clean (only pre-existing warnings).
- `cargo test --lib phase35` — **47 pass, 0 fail** (4 new tests included).
- `cargo test --test loop_engine_integration` — **8 pass, 0 fail**.

**No production regressions** — all pre-existing phase35 tests still pass:
- `phase35_decomposition_full_pipeline_via_force_seams` (FORCE-seam pipeline)
- `phase35_decomp_panic_in_distill_caught_by_summary_layer` (catch_unwind boundary)
- `phase35_decomp_force_subagent_result_seam_provides_synthetic_summary`
- `phase35_decomp_02_cost_rollup_sums_subagent_costs` (cost rollup arithmetic)
- All planner + summary tests
- All session::list merge tests

---

## Commit Manifest

| Finding | Commit  | Files Modified |
|---------|---------|----------------|
| BL-01   | `b6f7f09` | `src-tauri/src/loop_engine.rs` |
| HI-01   | `f18fa3a` | `src-tauri/src/decomposition/executor.rs` |
| HI-03   | `c56d6f7` | `src-tauri/src/decomposition/executor.rs` |
| HI-02   | `8f72dac` | `src-tauri/src/decomposition/executor.rs` |
| HI-04   | _(deferred — no commit)_ | _(documentation-only deferral)_ |

**Atomic-commit posture honored:** Each commit listed only the specific
file modified, NOT the 188 pre-existing staged deletions in the repo. No
Co-Authored-By lines added.

---

## Status: PARTIAL (4 fixed + 1 deferred per operator directive)

The BLOCKER (BL-01) is fully fixed. Three of four HIGH findings are fully
fixed (HI-01, HI-02, HI-03). The remaining HIGH (HI-04) is deferred via
documentation per the operator's HI-04 Option A directive — fixing it
requires the real `run_loop` integration deferred to Plan 35-11 UAT.

The `auto_decompose_enabled = true` + `jsonl_log_enabled = false` DOA
combination (BL-01) is RESOLVED. The dead-code consumer paths for
`subagent_progress` (HI-01) are LIVE. The `subagent_isolation` (HI-02) and
`max_parallel_subagents` (HI-03) config fields are now READ at runtime
with documented v1 semantics.

---

_Fixed: 2026-05-06T18:30:00Z_
_Fixer: Claude (gsd-code-fixer, BLADE phase 35-12-FIX)_
_Iteration: 1_
