---
phase: 35-auto-decomposition
reviewed: 2026-05-06T12:00:00Z
depth: deep
files_reviewed: 14
files_reviewed_list:
  - src-tauri/src/config.rs
  - src-tauri/src/loop_engine.rs
  - src-tauri/src/decomposition/mod.rs
  - src-tauri/src/decomposition/planner.rs
  - src-tauri/src/decomposition/executor.rs
  - src-tauri/src/decomposition/summary.rs
  - src-tauri/src/session/list.rs
  - src-tauri/src/session/log.rs
  - src-tauri/src/commands.rs
  - src-tauri/src/lib.rs
  - src/lib/events/payloads.ts
  - src/lib/tauri/sessions.ts
  - src/features/activity-log/index.tsx
  - src/features/sessions/SessionsView.tsx
  - src/features/chat/SubagentProgressBubble.tsx
  - src/features/chat/ChatPanel.tsx
findings:
  blocker: 1
  high: 4
  medium: 4
  low: 3
  total: 12
status: issues_found
---

# Phase 35: Auto-Decomposition — Code Review

**Depth:** deep · **Files reviewed:** 14 · **Status:** issues_found

## Summary

Phase 35 ships substrate + a placeholder dispatch — `run_subagent_to_halt` returns
`Ok((true, 0.0, 0))` per the documented v1 boundary (35-CONTEXT §DECOMP-02 deferred
to Plan 35-11 UAT). Recursion gate, panic-resistance, six-place config wire-up, and
merge-back validation are correct. However, the placeholder interacts poorly with
several real runtime paths: a disabled-JSONL session triggers fan-out, fails every
`fork_session`, and emits N "fork failed" synthetic AssistantTurns to chat. The
`subagent_isolation` and `max_parallel_subagents` config fields are declared but
never read. The cost-rollup arithmetic is correct in shape but always rolls 0.0
because the placeholder reports no cost, so the RES-04 interlock is structurally
unreachable in v1. `subagent_progress` events are typed in TS and rendered by
SubagentProgressBubble + ActivityStrip but never emitted from Rust — the inline
bubble seeds with status='running' on `subagent_started` and never updates.
build_swarm_from_groups produces a Swarm that is validated then discarded — the
swarm DB is never written.

The BLOCKER is the disabled-JSONL fan-out: any user with `jsonl_log_enabled = false`
who asks a 5-step question receives N synthetic fork-error messages instead of
sequential execution.

## BLOCKER

### BL-01: Disabled-JSONL session fans out into N "fork failed" messages

**Files:** `src-tauri/src/loop_engine.rs:906-984`, `src-tauri/src/decomposition/executor.rs:233-263`

**Reproduction:**
1. User sets `session.jsonl_log_enabled = false` (documented escape hatch).
2. `commands.rs:1076` falls back to `(SessionWriter::no_op(), String::new())` — `session_id = ""`.
3. Run `run_loop` with `conversation_id = ""`.
4. The DECOMP-01 trigger gates only on `!is_subagent && auto_decompose_enabled` (line 906) and `pct < 0.8`. Empty `conversation_id` is NOT gated.
5. `count_independent_steps_grouped` returns Some(groups) for any 5+ step query.
6. `execute_decomposed_task("", ...)` runs.
7. For each group, `spawn_isolated_subagent` calls `fork_session("".to_string(), 0)`. `validate_session_id("")` returns `Err("invalid session id: ")`.
8. spawn returns the fork-failed stub summary (executor.rs:248). All N sub-agents fail identically.
9. `Ok(summaries)` is returned with N stub summaries; run_loop pushes N synthetic AssistantTurns and halts via `LoopHaltReason::DecompositionComplete`.
10. The user's chat shows: `[Sub-agent summary — step 0, researcher, session …] [fork failed: invalid session id: ]` × N, no actual answer.

**Why blocker:** `auto_decompose_enabled = true` is the default, `jsonl_log_enabled = false` is a documented escape hatch (CONTEXT §Backward Compatibility), and any user combining both gets 5+ fake failures instead of normal sequential chat. This is a v1.1-class DOA — the feature is silently active for users who explicitly disabled session logging.

**Fix:** Add a guard in `run_loop_inner` before the trigger block:
```rust
if !loop_state.is_subagent
    && config.decomposition.auto_decompose_enabled
    && !conversation_id.is_empty()  // NEW — fork_session needs a valid parent ULID
{
    ...
}
```
And/or have `execute_decomposed_task` return `DecompositionError::Internal("session logging required for decomposition")` when `parent_session_id.is_empty()`, so the run_loop can fall through to sequential instead of pushing failed-stub turns.

## HIGH

### HI-01: subagent_progress events never emitted by Rust — bubble + ActivityStrip handlers dead code

**Files:** `src-tauri/src/decomposition/executor.rs` (entire), `src/features/chat/SubagentProgressBubble.tsx:79-91`, `src/features/activity-log/index.tsx:234-252`

`grep -rn "subagent_progress" src-tauri/src/` returns zero hits. The TS union (`payloads.ts:949-954`) and consumers exist, but nothing in Rust calls `emit_stream_event` with `kind: "subagent_progress"`. CONTEXT §DECOMP-05 locks emission "from inside the sub-agent's run_loop at iteration boundaries / tool-call dispatch / compaction boundary / verification probe". Since `run_subagent_to_halt` is the placeholder `Ok((true, 0.0, 0))`, no inner loop runs — so no progress events fire.

**Effect:** SubagentProgressBubble seeds with status='running' on `subagent_started`, never updates, then disappears on `subagent_complete`. The user sees a frozen "running" pill for the placeholder duration (instant in v1). When Plan 35-11 UAT wires real dispatch, the lack of emit sites means the inline bubble continues to show stale data.

**Fix:** Either (a) explicitly document this as a v1 boundary with a regression test asserting "no subagent_progress emit until run_loop integration lands", or (b) emit a single synthetic `subagent_progress { status: 'running' }` from `spawn_isolated_subagent` between the started and complete events so the bubble lifecycle is exercised. Option (b) is 4 lines and matches the locked emit-site list in CONTEXT.

### HI-02: subagent_isolation config field declared but never read

**Files:** `src-tauri/src/config.rs:617`, `src-tauri/src/decomposition/executor.rs` (entire)

`subagent_isolation` is registered through all six config places, defaults to `true`, and is documented as "DEBUG ONLY when false; cost rollup breaks". `grep -rn "subagent_isolation" src-tauri/src/` returns ONE hit — the test name `phase35_decomp_02_subagent_isolation_creates_fork`. The runtime never branches on this value. Setting it to `false` in `config.json` has zero effect — sub-agents always get fresh LoopState + own SessionWriter.

**Why HIGH:** Six-place config plumbing promises a behavior that does not exist. A user who flips the flag debugging a cost-rollup issue sees no change and concludes the toggle is broken (it is). CONTEXT §DECOMP-02 explicitly locks "When `subagent_isolation = false`, sub-agents share the parent's LoopState and SessionWriter."

**Fix:** Either implement the false branch (share parent's state — simple if-gate around the LoopState::default() + SessionWriter::open_existing in `run_subagent_to_halt`), or remove the field entirely and document the DEBUG path as v1.6+ (current scope is "not yet wired"). Removing requires reverting the six-place adds in config.rs.

### HI-03: max_parallel_subagents config field never gates concurrency

**Files:** `src-tauri/src/decomposition/executor.rs:117`, `src-tauri/src/config.rs:613`

`let _max_concurrent = (config.decomposition.max_parallel_subagents.min(5)) as usize;` — note the underscore prefix. The variable is computed and discarded. The sub-agents walk serially via the `for group in &groups` loop, so concurrency is implicitly 1 regardless of the config.

The unit test `phase35_decomp_02_max_parallel_respected` (line 559) only verifies `min(50, 5) = 5` math — does NOT exercise that runtime concurrency obeys the cap. Test passes; production ignores the config.

**Why HIGH:** Same posture as HI-02 — six-place config field with promised semantics that does not run. A user who sets `max_parallel_subagents = 1` to debug serial behavior sees the same serial behavior as `max_parallel_subagents = 50`. The "documented for Plan 35-07's parallel JoinSet variant" comment doesn't help — Plan 35-07 shipped without parallelism, so the config remains decorative.

**Fix:** Either implement a `JoinSet` / `FuturesUnordered` parallel dispatch gated by `_max_concurrent`, or document the field as v1.6+ in the doc comment ("Currently ignored — sub-agents run serially. Parallelism deferred to v1.6"). The serial-only posture is defensible (CONTEXT §DECOMP-03 locks serial summary distillation for deterministic ordering), but the config name is misleading without the doc warning.

### HI-04: Cost rollup interlock is structurally unreachable in v1

**Files:** `src-tauri/src/decomposition/executor.rs:122-145`, `src-tauri/src/decomposition/executor.rs:444`

The RES-04 interlock at executor.rs:125 (`if parent_state.conversation_cumulative_cost_usd >= cap_dollars`) checks the parent's running total before each spawn. The rollup at line 143 (`parent_state.conversation_cumulative_cost_usd += summary.cost_usd`) accumulates each sub-agent's cost.

But `run_subagent_to_halt` (line 444) returns `Ok::<_, _>((true, 0.0, 0))` — the v1 placeholder. So `summary.cost_usd` is always 0.0, and the rollup adds nothing. The interlock can only fire if the parent's cost was already at cap BEFORE decomposition started — which the run_loop trigger gate at line 910 (`pct < 0.8`) already catches. The "halt remaining sub-agents at cap" code path is unreachable in v1.

**Why HIGH:** The integration test `phase35_decomp_02_cost_rollup_sums_subagent_costs` (line 618) injects synthetic cost values directly into the rollup loop — it does NOT exercise the production path. A regression in `run_subagent_to_halt` that started rolling actual costs would silently bypass the test (test still passes; production now misbehaves). CONTEXT §DECOMP-02 locks "Sub-agent cost rolls up to parent's `conversation_cumulative_cost_usd`" — currently a no-op.

**Fix:** Document the v1 boundary in `execute_decomposed_task_inner`'s doc comment with a TODO pointing to Plan 35-11 UAT, AND add an integration test that asserts the path is no-op-but-correct in v1: "given placeholder dispatch, parent cost rollup delta == 0.0 across N sub-agents". The current test misleads — it implies real rollup, but production is dead code.

## MEDIUM

### ME-01: build_swarm_from_groups produces a Swarm that is validated then discarded

**Files:** `src-tauri/src/decomposition/executor.rs:104-201`

`execute_decomposed_task_inner` line 105 calls `build_swarm_from_groups`, line 106 validates the DAG, but the resulting `Swarm` value is never persisted (no swarm DB write), never dispatched through `swarm.rs::resolve_ready_tasks`, and never emitted as a swarm progress event. The actual sub-agent spawn at line 137 walks `&groups` directly, bypassing the swarm infrastructure entirely.

CONTEXT §DECOMP-02 locks "Swarm dispatch via existing `swarm.rs` infrastructure" with a 5-step locked algorithm including "Build a `Swarm` … For each StepGroup, build a `SwarmTask` … Call into existing `swarm_commands::spawn_task_agent` for each ready task". None of that happens. The Swarm is built only to run `validate_dag(&swarm.tasks)` for cycle detection — a 50-line build for a 1-line validation.

**Effect:** A `/swarm` view that lists active swarms will not show auto-decompositions. The depends_on edges encoded in StepGroup.depends_on are validated but never used to topologically order execution — the `for group in &groups` loop walks step_index order, NOT topological order. Currently the planner only emits empty depends_on, so this is latent — but a future planner change that emits real edges would silently violate ordering.

**Fix:** Either (a) extract `validate_dag` from the Swarm, drop the build entirely, and use a free-standing topological sort over `Vec<StepGroup>`, or (b) wire the actual `swarm_commands::spawn_task_agent` dispatch as CONTEXT specifies. (a) is smaller; (b) is the locked design.

### ME-02: subagent_started/complete events not paired to JSONL via emit_with_jsonl

**Files:** `src-tauri/src/decomposition/executor.rs:459-484`

`emit_subagent_started` and `emit_subagent_complete` use `emit_stream_event`, NOT `emit_with_jsonl`. Compare with the Phase 34 emit sites in loop_engine.rs (`stuck_detected`, `verification_fired`, `cost_warning`, etc.) — all use `emit_with_jsonl(app, session_writer, kind, payload)` so the chip + JSONL forensic line co-emit atomically.

**Effect:** SESS-02 resume cannot replay sub-agent activity from the parent's JSONL. The forensic continuity claim ("full conversation in session {subagent_session_id}") only holds if the user manually navigates to the sub-agent JSONL — the parent's JSONL has no record that fan-out occurred (only the synthetic AssistantTurns).

**Fix:** Pass the parent's `&SessionWriter` into `spawn_isolated_subagent` and use `emit_with_jsonl` for both started and complete. The signature change is mechanical; the emit sites change from `emit_stream_event(app, ...)` to `emit_with_jsonl(app, parent_writer, ...)`.

### ME-03: heuristic_fallback's success=false default + executor's `&&` collapse

**Files:** `src-tauri/src/decomposition/executor.rs:316-318`, `src-tauri/src/decomposition/summary.rs:286`

`heuristic_fallback` always returns `success: false` (summary.rs:286). When distill panics or load_session fails (missing JSONL), the catch_unwind layer at summary.rs:73-79 calls `heuristic_fallback`. The executor at executor.rs:316 runs `summary.success = summary.success && success;` — the `&&` collapse means even if the placeholder dispatch returned `success=true`, the heuristic forces it to false.

**Effect:** A successful sub-agent that happens to hit the missing-JSONL fallback path is reported to the user as `success=false` in the synthetic AssistantTurn. In v1 with placeholder dispatch, this is mostly fine because no real work happens. After Plan 35-11 wiring, a real successful run with a transient distill error would surface as failed to the user.

**Fix:** Distinguish "distill failed but sub-agent succeeded" from "sub-agent failed". Heuristic fallback should preserve the dispatch's success value when possible, e.g., `success: indicates_failure_via_jsonl(path)` (the helper exists at summary.rs:241 but only `distill_inner` uses it). Or, executor should not `&&`-collapse — use the dispatch's success value with the fallback's text.

### ME-04: Cost-budget interlock 80% threshold uses `pct < 0.8` strict — boundary case slips through

**Files:** `src-tauri/src/loop_engine.rs:910`

The trigger gate uses `if pct < 0.8` to decide whether to fan out. A pct of exactly 0.8 (parent at 80% of cap) DOES trigger fan-out. The CONTEXT lock says "Don't fan out when the budget is nearly exhausted" with the boundary at 80%. Inclusive vs exclusive matters when costs land precisely on the threshold (rare with f32 arithmetic, but possible).

The 100% halt at executor.rs:125 uses `>=` (inclusive). Inconsistent — fan-out gate is exclusive of 80% but interlock is inclusive of 100%.

**Fix:** Use `pct >= 0.8` (decline at exactly 80%) to match the inclusive 100% interlock. Or document the asymmetry. Low-impact bug; flagged for consistency.

## LOW

### LO-01: Mixed eprintln!/log::warn! within same module

**Files:** `src-tauri/src/decomposition/executor.rs` (4 eprintln!), `src-tauri/src/decomposition/summary.rs` (log::warn!)

executor.rs uses `eprintln!` for panic-fallback diagnostics while summary.rs and loop_engine.rs use `log::warn!`/`log::info!`. Both reach stderr in dev, but only `log::*` flows through the env_logger filter and structured-log infrastructure. Minor consistency.

**Fix:** Convert executor.rs eprintln! to log::warn!/log::error! per project convention. Mechanical.

### LO-02: SubagentProgressBubble re-renders on every loop event regardless of kind

**Files:** `src/features/chat/SubagentProgressBubble.tsx:66-115`

The `handleLoopEvent` callback calls `setActive(...)` for every blade_loop_event payload. When `payload.kind` is unrelated (e.g., `verification_fired`, `cost_update`), the switch hits `default` and returns `prev` — React's setState bails on identity, so no re-render. But the callback STILL runs for every event. With `cost_update` firing every iteration in long parent-loops, this is hundreds of no-op callback invocations per minute.

Not a leak. Negligible CPU. Flagged because it conflicts with the "throttle running/tool_call" discipline the activity-log applies (which DOES short-circuit early for cost_update at activity-log/index.tsx:212).

**Fix:** Add an early-return at the top of `handleLoopEvent` for non-subagent kinds: `if (!payload.kind.startsWith('subagent_') && payload.kind !== 'decomposition_complete') return;`.

### LO-03: SwarmStatus and SwarmTask fields fabricated for an unused Swarm

**Files:** `src-tauri/src/decomposition/executor.rs:155-201`

build_swarm_from_groups fills 14 SwarmTask fields (`scratchpad_key: None`, `created_at: now`, `started_at: None`, etc.) for a Swarm that's only used to run `validate_dag` on its tasks. Most fields are placeholder defaults — the Swarm struct's contract assumes a swarm DB row exists, but this Swarm never reaches the DB. Dead-data construction.

**Fix:** Lift `validate_dag` to take `&[StepGroup]` directly (or transform inline), drop build_swarm_from_groups entirely. Or pursue ME-01's option (b) and actually persist the Swarm.

---

_Reviewed: 2026-05-06_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
