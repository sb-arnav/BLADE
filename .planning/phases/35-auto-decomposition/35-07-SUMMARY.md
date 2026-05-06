---
phase: 35-auto-decomposition
plan: 7
subsystem: agentic-loop / decomposition / sub-agent dispatch wiring + halt-arm cadence
tags:
  - decomposition
  - DECOMP-01
  - DECOMP-02
  - sub-agent-dispatch
  - LoopHaltReason
  - SessionWriter
  - catch_unwind
  - integration-test
  - phase-35
dependency-graph:
  requires:
    - "Plan 35-01 — DecompositionConfig (auto_decompose_enabled, min_steps_to_decompose)"
    - "Plan 35-02 — LoopState.is_subagent + LoopHaltReason::DecompositionComplete + decomposition/ scaffold + DECOMP_FORCE_SUBAGENT_RESULT seam"
    - "Plan 35-03 — count_independent_steps_grouped + DECOMP_FORCE_STEP_COUNT seam (planner FORCE seam)"
    - "Plan 35-04 — pre-iteration trigger in run_loop_inner + recursion gate (loop_state.is_subagent guard)"
    - "Plan 35-05 — execute_decomposed_task body + spawn_isolated_subagent + cost rollup (run_subagent_to_halt v1 placeholder this plan replaces)"
    - "Plan 35-06 — distill_subagent_summary body (cheap-model + heuristic fallback)"
    - "Phase 34 SESS-04 — fork_session writes the forked JSONL the sub-agent writer attaches to"
    - "Phase 34 SESS-01 — SessionWriter struct (path, enabled fields)"
    - "futures crate (catch_unwind for async — already in Cargo.toml as `futures = \"0.3\"`)"
  provides:
    - "SessionWriter::open_existing — synchronous helper, attaches a writer to an existing {dir}/{id}.jsonl path (no rotation, no fresh ULID, no dir creation)"
    - "run_subagent_to_halt substrate filled — LoopState{is_subagent=true} + open_existing(forked JSONL) + ConversationMessage::User(group.goal) + futures::FutureExt::catch_unwind boundary; real run_loop invocation deferred to Plan 35-11 UAT (run_loop signature requires SharedMcpManager + ApprovalMap + SharedVectorStore + TurnAccumulator from commands::send_message_stream_inline closure scope)"
    - "LoopHaltReason::DecompositionComplete match arm in commands.rs §send_message_stream_inline post-run_loop branch — counts synthetic AssistantTurns + emits blade_loop_event { kind: \"decomposition_complete\", subagent_count: N } + chat_done; clean exit (no chat_error)"
    - "phase35_decomposition_full_pipeline_via_force_seams — end-to-end FORCE-seam integration test exercising planner seam → build_swarm → validate_dag → executor seam round-trip × 3 → cost rollup arithmetic → synthetic-turn prefix contract → single-shot drain"
  affects:
    - "src-tauri/src/decomposition/executor.rs (run_subagent_to_halt body filled; module header updated; integration test added)"
    - "src-tauri/src/session/log.rs (SessionWriter::open_existing helper added; new + new_with_id + no_op preserved)"
    - "src-tauri/src/commands.rs (DecompositionComplete arm enriched with subagent_count chip event)"
tech-stack:
  added: []
  patterns:
    - "Phase 33+34 panic-safety discipline — futures::FutureExt::catch_unwind on AssertUnwindSafe(async block) → sub-agent panic surfaces as (false, 0.0, 0) rather than tearing parent run_loop down"
    - "Recursion gate substrate (Plan 35-04 §run_loop_inner): LoopState.is_subagent=true short-circuits the pre-iteration auto-decompose trigger — sub-agents NEVER spawn grandchildren"
    - "FORCE-seam test pattern — planner DECOMP_FORCE_STEP_COUNT + executor DECOMP_FORCE_SUBAGENT_RESULT (single-shot, mirrored from spawn_isolated_subagent's borrow_mut().take()) lets every test exercise the full pipeline without an AppHandle"
    - "Synthetic-turn prefix contract — '[Sub-agent summary — step {i}, {role}, session {id8}…]' produced verbatim by loop_engine::synthetic_assistant_turn_from_summary; commands.rs DecompositionComplete arm reads this prefix to count subagents for the chip event"
key-files:
  created: []
  modified:
    - src-tauri/src/decomposition/executor.rs
    - src-tauri/src/session/log.rs
    - src-tauri/src/commands.rs
decisions:
  - "Real run_loop invocation deferred to Plan 35-11 UAT (per the plan's WARNING + 35-CONTEXT lock §DECOMP-02): run_loop's signature at loop_engine.rs:767 requires SharedMcpManager + ApprovalMap + SharedVectorStore + TurnAccumulator + a current_message_id slot — all of which live inside commands::send_message_stream_inline's closure scope, not on AppHandle. Recreating that scope inside a sub-agent dispatch is a v1.6+ refactor. The v1 stub returns Ok((true, 0.0, 0)) so DECOMP_FORCE_SUBAGENT_RESULT short-circuits before this is called in every test. [Per plan-checker WARNING: this is the documented v1 boundary.]"
  - "Substrate filled even though dispatch is deferred — LoopState{is_subagent=true} is set, SessionWriter::open_existing attaches to the forked JSONL, ConversationMessage::User(group.goal) seeds the conversation Vec, futures::FutureExt::catch_unwind wraps the dispatch closure. The next commit that wires run_loop will not need to rewrite this scaffolding — only fill the gap between the writer construction and the catch_unwind tail."
  - "Avoided tauri::test::mock_app() in the integration test — the codebase explicitly avoids this pattern (reward.rs:664 + doctor.rs:1856 explicit comments). Instead, the integration test exercises the FORCE seam pipeline without an AppHandle and asserts on every observable output (planner returns groups, swarm validates DAG, seam round-trips, cost rolls up additively, synthetic-turn prefix contract holds). [Rule 3 — blocking constraint: test infra precedent.]"
  - "subagent_count chip event added in commands.rs DecompositionComplete arm — Plan 35-09 / 35-10 frontend consumers (ActivityStrip, SessionsView merge-back UI) need this chip to render the fan-out summary card. Counts AssistantTurns whose content starts with '[Sub-agent summary' (the verbatim prefix produced by loop_engine::synthetic_assistant_turn_from_summary). [Rule 2 — auto-add: Plan 35-02 scaffold only emitted chat_done; the chip is required for downstream wave-4 work.]"
  - "SessionWriter::open_existing chosen over reusing new_with_id(existing_id=Some(_)) because new_with_id runs rotation + creates the parent dir, both of which are unnecessary for a forked session that fork_session already wrote on disk. open_existing is also synchronous (no I/O at construction), making it safe to call from the async sub-agent dispatch hot-path. The two helpers compose: callers wanting a fresh ULID + rotation use new/new_with_id; callers attaching to an existing forked session use open_existing."
metrics:
  duration: ~28 minutes
  completed: 2026-05-06
---

# Phase 35 Plan 35-07: DECOMP-02 sub-agent dispatch wiring + LoopHaltReason::DecompositionComplete match arm + full-pipeline integration test Summary

DECOMP-02 wiring closed at the v1 boundary documented in the plan-checker WARNING. `run_subagent_to_halt` substrate filled — `LoopState{is_subagent=true}` set (recursion gate ON), `SessionWriter::open_existing` attaches to the forked JSONL written by Phase 34 SESS-04 `fork_session`, `ConversationMessage::User(group.goal)` seeds the sub-agent's conversation Vec, and the dispatch closure is wrapped in `futures::FutureExt::catch_unwind` matching Phase 33+34 panic-safety discipline. The actual `run_loop` invocation is deferred to Plan 35-11 UAT (run_loop's signature requires shared closure state — `SharedMcpManager`, `ApprovalMap`, `SharedVectorStore`, `TurnAccumulator`, `current_message_id` — all of which live inside `commands::send_message_stream_inline`'s closure scope, a v1.6+ refactor). The `LoopHaltReason::DecompositionComplete` arm in `commands.rs` is enriched: it walks `conversation`, counts synthetic AssistantTurns by the `'[Sub-agent summary'` prefix produced by `loop_engine::synthetic_assistant_turn_from_summary`, emits a `blade_loop_event { kind: "decomposition_complete", subagent_count: N }` chip BEFORE `chat_done` (no `chat_error` — clean exit). 1 new integration test green via FORCE seams; 9 executor tests + 25 decomposition tests + 88 loop_engine tests green; cargo check clean.

## What Shipped

### Task 1: SessionWriter::open_existing helper + run_subagent_to_halt substrate

**Files modified:**
- `src-tauri/src/session/log.rs` (commit `6e84fbb`)
- `src-tauri/src/decomposition/executor.rs` (commit `6e84fbb`)

**SessionWriter::open_existing** (lines 171-193 of `session/log.rs`) — synchronous helper:
```rust
pub fn open_existing(jsonl_log_dir: &Path, id: &str, enabled: bool) -> Self {
    if !enabled {
        return Self { path: PathBuf::new(), enabled: false };
    }
    let path = jsonl_log_dir.join(format!("{}.jsonl", id));
    Self { path, enabled: true }
}
```

Distinct from `new` / `new_with_id`:
- Does NOT generate a fresh ULID (caller passes the forked id)
- Does NOT run rotation (the file already exists)
- Does NOT create the parent dir (fork_session created it)
- Does NOT touch I/O at construction (safe in async hot-path)

**run_subagent_to_halt body** (replaces Plan 35-05's `Ok((true, 0.0, 0))` placeholder) — substrate-only fill at the v1 boundary:

```rust
async fn run_subagent_to_halt(
    new_id: &str,
    group: &StepGroup,
    _app: &AppHandle,
    config: &BladeConfig,
) -> Result<(bool, f32, u32), String> {
    use futures::FutureExt;
    let inner = std::panic::AssertUnwindSafe(async move {
        // (a) Recursion gate ON.
        let mut state = LoopState::default();
        state.is_subagent = true;
        // (b) Synthetic User message seed.
        let mut _conversation = vec![
            crate::providers::ConversationMessage::User(group.goal.clone()),
        ];
        // (c) Open writer on the forked JSONL.
        let _writer = crate::session::log::SessionWriter::open_existing(
            &config.session.jsonl_log_dir, new_id, config.session.jsonl_log_enabled,
        );
        // (d) Provider/model — v1 falls through to parent (role-aware routing v1.6+).
        let _provider = config.provider.clone();
        let _api_key = config.api_key.clone();
        let _model = config.model.clone();
        // (e) Real run_loop invocation — DEFERRED to Plan 35-11 UAT.
        Ok::<(bool, f32, u32), String>((true, 0.0, 0))
    });
    match inner.catch_unwind().await {
        Ok(r) => r,
        Err(_panic) => {
            eprintln!(
                "[DECOMP-02] run_subagent_to_halt panicked for step {}; surfacing (false, 0.0, 0)",
                group.step_index
            );
            Ok((false, 0.0, 0))
        }
    }
}
```

The deferred `run_loop` invocation is documented inline with the exact call shape (per `loop_engine.rs:767`):

```rust
crate::loop_engine::run_loop(
    app.clone(),                  // shared with parent — sub-agent emit events
                                  // go to same frontend (Plan 35-09 filters
                                  // by step_index for chip routing)
    mcp_manager,                  // from commands.rs scope
    approvals,                    // from commands.rs scope
    vector_store,                 // from commands.rs scope
    &mut config_clone,
    &mut conversation,            // sub-agent's own thread
    &no_tools,                    // sub-agent v1: no tools
    &group.goal,                  // last_user_text
    false, false,                 // brain_plan_used, low_confidence
    &meta_pre_check,
    1,                            // input_message_count
    turn_acc,
    &mut current_message_id,
    &writer,
    new_id,                       // conversation_id
).await
```

### Task 2: LoopHaltReason::DecompositionComplete match arm enriched

**File modified:** `src-tauri/src/commands.rs` (commit `3b1ac6f`)

**Site:** `send_message_stream_inline` post-run_loop match block, lines 2107-2141 (existing arm at line 2107 from Plan 35-02 scaffold).

**Before (Plan 35-02 scaffold):**
```rust
Err(crate::loop_engine::LoopHaltReason::DecompositionComplete) => {
    emit_stream_event(&app, "chat_done", ());
    let _ = app.emit("blade_status", "idle");
    return Ok(());
}
```

**After (Plan 35-07):**
```rust
Err(crate::loop_engine::LoopHaltReason::DecompositionComplete) => {
    let subagent_count = conversation
        .iter()
        .filter(|m| matches!(m, ConversationMessage::Assistant { content, .. }
            if content.starts_with("[Sub-agent summary")))
        .count();
    log::info!(
        "[DECOMP-01] decomposition complete; {} synthetic turns added to conversation",
        subagent_count
    );
    emit_stream_event(&app, "blade_loop_event", serde_json::json!({
        "kind": "decomposition_complete",
        "subagent_count": subagent_count,
    }));
    emit_stream_event(&app, "chat_done", ());
    let _ = app.emit("blade_status", "idle");
    return Ok(());
}
```

The prefix `'[Sub-agent summary'` is produced verbatim by `loop_engine::synthetic_assistant_turn_from_summary` (lines 708-731). Plans 35-09 / 35-10 wire frontend consumers (ActivityStrip + SessionsView merge-back UI).

### Task 3: phase35_decomposition_full_pipeline_via_force_seams

**File modified:** `src-tauri/src/decomposition/executor.rs` (commit `9a4e825`)

End-to-end FORCE-seam test (139 lines added, no AppHandle dependency). Six gates in sequence:

| Gate | What it verifies |
|---|---|
| (1) Planner FORCE seam | `DECOMP_FORCE_STEP_COUNT(3)` → 3 synthetic StepGroups, step_index=i, no edges |
| (2) build_swarm + validate_dag | Synthetic 3-group DAG accepted; swarm.goal references parent session |
| (3) Executor FORCE seam round-trip × 3 | `DECOMP_FORCE_SUBAGENT_RESULT.set` → `take` returns the forced summary; mirrors spawn_isolated_subagent's `borrow_mut().take()` consumer |
| (4) Cost rollup arithmetic | parent_state.conversation_cumulative_cost_usd grew by 0.05+0.10+0.15 = 0.30 (additive `+=`) |
| (5) Synthetic-turn prefix contract | `'[Sub-agent summary — step {i}, {role}, session '` — the prefix the commands.rs DecompositionComplete arm reads |
| (6) Single-shot drain | Seam returns None after the test (no leak between runs) |

**Test runner output:**

```bash
$ cargo test --lib decomposition::executor::tests
running 9 tests
test decomposition::executor::tests::phase35_decomp_02_cost_rollup_sums_subagent_costs ... ok
test decomposition::executor::tests::phase35_decomp_02_force_executor_result_seam_works ... ok
test decomposition::executor::tests::phase35_decomp_02_max_parallel_respected ... ok
test decomposition::executor::tests::phase35_decomp_02_subagent_isolation_creates_fork ... ok
test decomposition::executor::tests::phase35_decomp_force_subagent_result_seam_declared ... ok
test decomposition::executor::tests::phase35_decomp_02_executor_dispatches_each_group ... ok
test decomposition::executor::tests::phase35_decomposition_error_serde_roundtrip ... ok
test decomposition::executor::tests::phase35_execute_decomposed_task_invalid_dag_returns_err ... ok
test decomposition::executor::tests::phase35_decomposition_full_pipeline_via_force_seams ... ok

test result: ok. 9 passed; 0 failed; 0 ignored; 0 measured
```

**Regression sweep (cross-module):**

```bash
$ cargo test --lib decomposition::
test result: ok. 25 passed; 0 failed; 0 ignored; 0 measured

$ cargo test --lib loop_engine::
test result: ok. 88 passed; 0 failed; 0 ignored; 0 measured
```

### Acceptance criteria

| Criterion | Status |
|---|---|
| `grep -c "is_subagent: true\|state.is_subagent = true" .../executor.rs` | **2** (target ≥ 1) |
| `grep -c "SessionWriter::open_existing\|crate::session::log::SessionWriter" .../executor.rs` | **2** (target ≥ 1) |
| `grep -c "DecompositionComplete" .../commands.rs` | **2** (target ≥ 1) |
| cargo non-exhaustive-patterns warning resolved | **yes** (no warning surfaces) |
| cargo check exits 0 | **yes** (1m 36s; 13 unrelated dead-code warnings) |
| phase35_decomposition_full_pipeline_via_force_seams green | **yes** (0.01s) |
| Plan 35-04 + 35-05 + 35-06 tests still green | **yes** (25/25 decomposition + 88/88 loop_engine) |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 — Auto-add] Subagent_count chip event in commands.rs DecompositionComplete arm**

- **Found during:** Task 2 (the plan's behavior block stated "emit chat_done + log info" but didn't specify the chip event Plans 35-09/35-10 need).
- **Issue:** Plans 35-09 (BladeLoopEventPayload subagent variants) and 35-10 (ActivityStrip subagent chips) consume `blade_loop_event { kind: "decomposition_complete", subagent_count: N }` to render the fan-out summary card. Without this chip in the arm, the frontend would have no way to know the fan-out happened or how many sub-agents ran. Counting synthetic AssistantTurns by their `'[Sub-agent summary'` prefix is the cheapest accurate count (the prefix is produced verbatim by `loop_engine::synthetic_assistant_turn_from_summary`).
- **Fix:** Added the chip emit BEFORE `chat_done`; the prefix-count traversal is O(N) over the conversation Vec. The arm remains a clean exit (no `chat_error`).
- **Files modified:** `src-tauri/src/commands.rs`
- **Commit:** `3b1ac6f`

### Architectural decisions deferred

**Real run_loop invocation deferred to Plan 35-11 UAT** — per the plan's WARNING + 35-CONTEXT lock §DECOMP-02. The `run_loop` signature at `loop_engine.rs:767` requires:
- `SharedMcpManager` (from `commands::send_message_stream_inline` scope)
- `ApprovalMap` (from `commands::send_message_stream_inline` scope)
- `SharedVectorStore` (from `commands::send_message_stream_inline` scope)
- `TurnAccumulator` (constructed per-call in `commands::send_message_stream_inline`)
- `&mut current_message_id` slot

Recreating that scope inside a sub-agent dispatch is a v1.6+ refactor — likely a `prepare_run_loop_args(app, config) -> RunLoopArgs` helper extracted from `send_message_stream_inline` that both the parent's first-call site and the sub-agent's dispatch site can call. Plan 35-11 closes the phase with end-to-end UAT against a real LLM, which is where this dispatch path will be exercised + verified.

The substrate scaffolded in this plan (`LoopState{is_subagent=true}` + `SessionWriter::open_existing` + `ConversationMessage::User(group.goal)` + `catch_unwind` boundary) is the exact code the next commit will keep — only the `Ok::<(bool, f32, u32), String>((true, 0.0, 0))` line will be replaced with the real `run_loop` call.

### Auth gates encountered

None — this plan is fully offline (no provider calls during tests).

## Threat Surface

| Threat ID | Disposition | Notes |
|---|---|---|
| T-35-26 (DoS — v1 stub returns no-cost) | accept (v1) | DECOMP_FORCE_SUBAGENT_RESULT short-circuits in tests. Production with `auto_decompose_enabled=false` (default-false in BladeConfig per Plan 35-01) bypasses the stub entirely. Plan 35-11 UAT verifies real LLM dispatch. |
| T-35-27 (Tampering — emit-before-seam regression) | mitigate | The FORCE-seam check at the top of `spawn_isolated_subagent` is preserved; Plan 35-07's full-pipeline test would fail loudly if a future commit moved an emit BEFORE the seam check. |

## Hand-off to Wave 4

- **Plan 35-08** (DECOMP-04 merge_fork_back) — adds the `merge_fork_back` Tauri command + `MergeResult` return shape + JSONL-append helpers. Consumes `SubagentSummary` from this plan's substrate; the SessionWriter::open_existing helper added here is reusable for the merge path.
- **Plan 35-09** (DECOMP-05 BladeLoopEventPayload subagent variants + mergeForkBack typed wrapper) — frontend types for the `blade_loop_event { kind: "decomposition_complete", subagent_count }` chip emitted by this plan's commands.rs arm.
- **Plan 35-10** (DECOMP-04 SessionsView Merge back UI + DECOMP-05 ActivityStrip subagent chips with throttling + SubagentProgressBubble) — UI consumers of the chip event.
- **Plan 35-11** (Phase-wide closure with panic-injection regression + checkpoint:human-verify 15-step UAT) — the runtime UAT that verifies the deferred `run_loop` invocation path with a real LLM dispatch. This plan's substrate (LoopState{is_subagent=true} + SessionWriter::open_existing + catch_unwind boundary) is the foundation Plan 35-11 will fill.

## Self-Check: PASSED

- `src-tauri/src/decomposition/executor.rs` exists and compiles ✓ (cargo check exit 0; 13 unrelated dead-code warnings; 1m 36s)
- `src-tauri/src/session/log.rs` SessionWriter::open_existing helper added (lines 171-193) ✓
- `src-tauri/src/commands.rs` DecompositionComplete arm enriched (lines 2107-2141) ✓
- Commits `6e84fbb`, `3b1ac6f`, `9a4e825` present in git log ✓
- 9/9 executor tests green (1 new + 8 prior) ✓
- 25/25 decomposition tests green (regression sweep clean) ✓
- 88/88 loop_engine tests green (regression sweep clean) ✓
- No accidental file deletions (only intentional edits via `git add <specific-path>`) ✓
- 188 pre-existing unstaged deletions in `.planning/phases/00..` left untouched ✓
- No Co-Authored-By line in any commit ✓
