---
phase: 35-auto-decomposition
plan: 5
subsystem: agentic-loop / decomposition executor
tags:
  - decomposition
  - DECOMP-02
  - executor
  - swarm-dispatch
  - fork-session
  - cost-rollup
  - catch-unwind
  - phase-35
dependency-graph:
  requires:
    - "Phase 35-01 DecompositionConfig (max_parallel_subagents, subagent_isolation, auto_decompose_enabled)"
    - "Phase 35-02 LoopState.is_subagent + DecompositionError enum + DECOMP_FORCE_SUBAGENT_RESULT seam + executor.rs stub"
    - "Phase 35-03 StepGroup struct (step_index, goal, role, depends_on, estimated_duration)"
    - "Phase 35-04 run_loop pre-iteration trigger calling execute_decomposed_task"
    - "Phase 35-06 distill_subagent_summary (filled in parallel commit c66e8ea)"
    - "Phase 34 SESS-04 fork_session(parent_id, fork_at_message_index)"
    - "swarm.rs Swarm/SwarmTask/validate_dag/SwarmStatus/SwarmTaskStatus/SwarmTaskType (reused, NOT modified)"
    - "Phase 33+34 catch_unwind / AssertUnwindSafe panic-safety pattern"
  provides:
    - "execute_decomposed_task body — Swarm build → validate_dag → walk groups → spawn → cost rollup"
    - "build_swarm_from_groups helper — StepGroup[] → Swarm{tasks: SwarmTask[]} with id=step_{idx} + depends_on=[step_{n}]"
    - "spawn_isolated_subagent helper — seam check → fork_session → emit started → run_subagent_to_halt → distill → emit complete"
    - "run_subagent_to_halt v1 placeholder (Plan 35-07 will fill with real run_loop dispatch)"
    - "emit_subagent_started + emit_subagent_complete chips matching 35-04 blade_loop_event contract"
    - "read_parent_msg_count helper — JSONL walk to compute fork_at_message_index"
    - "Cost rollup: parent_state.conversation_cumulative_cost_usd += summary.cost_usd (additive, NOT replace)"
    - "RES-04 parent-budget interlock checked per-iteration; over-cap returns Err(DecompositionError::ParentBudgetExceeded)"
    - "Async catch_unwind via futures::FutureExt on the entire orchestrator — panics surface as Internal err"
    - "6 unit tests + preserved 2 prior tests (8 total green)"
  affects:
    - "src-tauri/src/decomposition/executor.rs (+352 lines body fill; +170 lines tests; net +522)"
tech-stack:
  added:
    - "futures::FutureExt::catch_unwind for async panic catching (already a Cargo dep — futures = 0.3)"
  patterns:
    - "Plan 33+34 catch_unwind discipline — entire async orchestrator wrapped, panic logs eprintln + returns DecompositionError::Internal"
    - "Plan 35-04 belt-and-suspenders gate redundancy — interlock checked at trigger AND inside executor"
    - "Single-shot RefCell take seam — DECOMP_FORCE_SUBAGENT_RESULT.with(|c| c.borrow_mut().take()) clears on first read"
    - "Heuristic fallback chain — fork err → empty summary; distill err → bracket-prefixed err excerpt; siblings continue"
    - "Serial dispatch for v1 — deterministic cost rollup ordering; CONTEXT lock §DECOMP-02 documents future JoinSet path"
    - "Explicit struct construction — SwarmTask has no Default derive; full field-by-field literal"
key-files:
  created:
    - .planning/phases/35-auto-decomposition/35-05-SUMMARY.md
  modified:
    - src-tauri/src/decomposition/executor.rs
decisions:
  - "RefCell semantics over Cell for DECOMP_FORCE_SUBAGENT_RESULT: the Plan 35-02 stub declared the seam as `RefCell<Option<SubagentSummary>>` (NOT `Cell<...>` as the plan-spec suggested). I preserved the existing RefCell shape verbatim because (a) other plans already reference it with `*c.borrow_mut() = Some(s)` and `c.borrow_mut().take()`, (b) SubagentSummary doesn't impl Copy so Cell would not work anyway, (c) preserving the seam shape matches Plan 35-05's plan-frontmatter `must_haves.truths` line 'preserve verbatim'."
  - "Serial-dispatch for v1: even though the `_max_concurrent` cap is computed (line 64 of body), the loop walks groups serially. CONTEXT lock §DECOMP-02 explicitly says serial is fine for v1 — the parallel JoinSet variant lives in Plan 35-07. Reasons: (1) deterministic cost-rollup ordering (parent's conversation_cumulative_cost_usd has a single mutable borrow, so += is naturally race-free), (2) distillation is also serial per CONTEXT lock §DECOMP-03, (3) v1 simplicity over throughput — most decomposition fan-outs are 5-7 sub-agents, the wall-clock difference is small."
  - "run_subagent_to_halt v1 placeholder returns (true, 0.0, 0): the plan explicitly says this is acceptable for Plan 35-05 — Plan 35-07 wires the real run_loop dispatch. The DECOMP_FORCE_SUBAGENT_RESULT seam short-circuits before run_subagent_to_halt is ever called in tests, so the cost-rollup tests still verify the arithmetic. Production path produces no-cost no-token sub-agents until 35-07 — explicitly intentional: better a v1 sub-agent that does no work than a half-wired one that may corrupt the parent's conversation."
  - "Async catch_unwind via futures::FutureExt — Rust's `std::panic::catch_unwind` does not work for async code (futures need to be polled across .await points; std catch_unwind is sync). The futures crate provides `FutureExt::catch_unwind` which wraps the future and catches panics from any of its poll() calls. Pattern: `AssertUnwindSafe(future).catch_unwind().await`. The futures crate is already a Cargo dep (line 37: `futures = \"0.3\"`)."
  - "AssertUnwindSafe for the inner future: catch_unwind requires `UnwindSafe` bound; async futures with mutable references (`&mut LoopState`) are not UnwindSafe by default. AssertUnwindSafe is the standard escape hatch — it asserts the developer has reasoned about which state may be left inconsistent on panic. Here: parent_state.conversation_cumulative_cost_usd may be partially incremented when a panic fires mid-rollup. That's acceptable — the parent's halt path will surface the Internal err and the partial cost is logged."
  - "title field on SwarmTask: SwarmTask.title is required (no Default derive). Used `crate::safe_slice(&g.goal, 80)` as a short title — distinct from the full goal which can be up to 500 chars. The title field appears in `/swarm` views; goal is the full text passed to the agent."
  - "task_type defaults to SwarmTaskType::Code via `SwarmTaskType::default()`: SwarmTaskType has 3 variants (Code/Research/Desktop) with `impl Default { fn default() -> Self { Self::Code } }`. Decomposition's per-step role is captured in the `role` field (researcher/coder/analyst/writer/reviewer). task_type stays at Code since the swarm-level dispatch in Plan 35-07 will route by `role`, not by `task_type` (which is /swarm-explicit invocation territory)."
  - "fork_at_message_index = current parent message count: the executor reads parent's JSONL and counts UserMessage + AssistantTurn ordinals to use as the fork point. CONTEXT lock §DECOMP-02 says sub-agents inherit the FULL pre-decomposition history. fork_session clamps to actual count anyway, so 0 (when parent JSONL doesn't exist yet — first-turn case) is safe."
  - "Heuristic fallback when distill_subagent_summary returns Err: build a SubagentSummary{success=false, summary_text=safe_slice(\"[summary distillation failed: {e}]\", 500)} so siblings continue + the rollup still sees the cost. The bracketed-prefix is the parent UI's visual cue. Plan 35-06 was filled in parallel — distill now returns Ok in normal cases, but the Err fallback is preserved for forward compatibility (e.g., if Plan 35-06's cheap-model dispatch hits a provider 5xx)."
  - "fork err returns SubagentSummary with EMPTY subagent_session_id: when fork_session fails (parent JSONL missing, validate_session_id rejects, etc.), there's no sub-agent ULID to record. Empty string signals 'no fork happened' to the parent UI. The emit_subagent_complete chip still fires so the chat surface doesn't see a hanging started chip — but the started chip was never emitted in this path either, so the UI just sees a complete chip with success=false and no started chip. That's the right semantics: the started→complete pair has 'never started, never finished' as a coherent special case."
  - "summary.success = summary.success && success: the AND-merge means EITHER distillation OR sub-agent dispatch can fail and surface as success=false. Today (Plan 35-05 v1) run_subagent_to_halt always returns success=true, so the merge collapses to summary.success. Plan 35-07 will wire run_subagent_to_halt to return real success based on the sub-agent's halt reason — at that point the AND-merge becomes meaningful."
  - "title clamped to 80 chars vs goal at 500: SwarmTask.title is shown in compact /swarm UI views; goal is the full text passed to the agent. 80 chars matches typical title-bar widths. safe_slice ensures non-ASCII safety even though planner.rs already safe_slices goal to 500."
  - "1.5 cost-rollup test: the test mutates parent_state.conversation_cumulative_cost_usd directly (mirroring the executor's += pattern) rather than driving execute_decomposed_task end-to-end. This is because end-to-end requires an AppHandle which isn't constructible in unit tests; the plan's `<acceptance_criteria>` tail explicitly says `Tests requiring tokio runtime + AppHandle live as integration tests in Plan 35-11 (full UAT path)`. The arithmetic property — additive, not replacing — is what the test asserts; that's the load-bearing contract."
metrics:
  duration: ~30 minutes (cargo check ~16m wall-clock for full rebuild after Plan 35-06 landed in parallel; cargo test ~7s incremental)
  completed: 2026-05-06
  tasks_completed: 1
  commits: 2
  tests_added: 6
  tests_green: 8
  files_modified: 1
---

# Phase 35 Plan 35-05: DECOMP-02 execute_decomposed_task body + spawn_isolated_subagent + cost rollup Summary

DECOMP-02's executor body lands in `src-tauri/src/decomposition/executor.rs`. The Plan 35-02 stub returning `Err(DecompositionError::Internal("not yet wired"))` is replaced with the real swarm-DAG dispatch + per-StepGroup `fork_session` (Phase 34 SESS-04) + cost rollup + emit-event chips. Plan 35-04's pre-iteration trigger now drives this real body — `count_independent_steps_grouped` returns 5+ groups, `execute_decomposed_task` walks them serially, each becomes a SwarmTask, the parent's `conversation_cumulative_cost_usd` accumulates per sub-agent, and the parent halts with `LoopHaltReason::DecompositionComplete`. The `run_subagent_to_halt` helper is a v1 placeholder returning `Ok((true, 0.0, 0))`; Plan 35-07 fills it with the real `run_loop` dispatch through the forked SessionWriter. Async `catch_unwind` (via `futures::FutureExt`) wraps the entire orchestrator. 6 new tests + 2 prior tests = 8/8 green; `cargo check` clean.

## What Shipped

### Task 1 (TDD RED + GREEN): execute_decomposed_task body + 5 helpers + 6 new tests

**File modified:** `src-tauri/src/decomposition/executor.rs` (+522 net lines: 352 body + 170 tests)
**Commits:**
- `f5366b7` — RED: 6 failing tests referencing `build_swarm_from_groups` + `read_parent_msg_count` (E0425 confirmed before GREEN)
- `0e11b58` — GREEN: body filled; cargo check clean; 8/8 tests green

### Helpers (5)

| Function | Purpose |
|----------|---------|
| `execute_decomposed_task` | Public entry point. Wraps `execute_decomposed_task_inner` in async catch_unwind via `futures::FutureExt`. |
| `execute_decomposed_task_inner` | Real body: build_swarm_from_groups → validate_dag → walk groups → spawn → cost rollup → return Vec<SubagentSummary>. |
| `build_swarm_from_groups` | StepGroup[] → Swarm{tasks: SwarmTask[]}. id=`step_{idx}`; depends_on=[`step_{n}`]; full field-by-field SwarmTask construction (no Default derive). |
| `spawn_isolated_subagent` | DECOMP_FORCE_SUBAGENT_RESULT seam → `fork_session(parent_id, parent_msg_count)` → emit_subagent_started → run_subagent_to_halt → distill_subagent_summary → emit_subagent_complete → SubagentSummary. |
| `run_subagent_to_halt` | **v1 placeholder** — returns `Ok((true, 0.0, 0))`. Plan 35-07 fills with real run_loop dispatch through forked SessionWriter + LoopState{is_subagent=true}. |
| `emit_subagent_started` | `blade_loop_event` chip with `kind=subagent_started`, `step_index`, `role`, `goal_excerpt` (safe_slice 120). |
| `emit_subagent_complete` | `blade_loop_event` chip with `kind=subagent_complete`, `step_index`, `success`, `summary_excerpt`, `subagent_session_id`. |
| `read_parent_msg_count` | Walks parent JSONL, counts `UserMessage`+`AssistantTurn` events. Returns Err on missing file → caller defaults to 0. |

### Tests (8 total — 6 new, 2 preserved from Plan 35-02 stub)

| Test | Status | Coverage |
|------|--------|----------|
| `phase35_decomposition_error_serde_roundtrip` | preserved (Plan 35-02) | DecompositionError serde shape |
| `phase35_decomp_force_subagent_result_seam_declared` | preserved (Plan 35-02) | RefCell seam round-trip |
| `phase35_decomp_02_max_parallel_respected` | NEW | min(max_parallel_subagents, 5) clamp logic — both default (3, untouched) and pathological (50→5) |
| `phase35_decomp_02_executor_dispatches_each_group` | NEW | build_swarm_from_groups produces 1 SwarmTask per StepGroup with correct id + role + depends_on; validate_dag accepts |
| `phase35_decomp_02_subagent_isolation_creates_fork` | NEW | read_parent_msg_count returns Err on missing JSONL — fork point defaults to 0 |
| `phase35_decomp_02_cost_rollup_sums_subagent_costs` | NEW | additive arithmetic — 0.10 + (0.5+0.5+0.5) = 1.60 (delta=1.5) |
| `phase35_decomp_02_force_executor_result_seam_works` | NEW | DECOMP_FORCE_SUBAGENT_RESULT round-trip + single-shot semantics |
| `phase35_execute_decomposed_task_invalid_dag_returns_err` | NEW | cyclic DAG (0→1, 1→0) rejected by validate_dag |

**Test run output (HEAD = 0e11b58):**

```
running 8 tests
test decomposition::executor::tests::phase35_decomp_02_cost_rollup_sums_subagent_costs ... ok
test decomposition::executor::tests::phase35_decomp_02_force_executor_result_seam_works ... ok
test decomposition::executor::tests::phase35_decomp_force_subagent_result_seam_declared ... ok
test decomposition::executor::tests::phase35_decomp_02_max_parallel_respected ... ok
test decomposition::executor::tests::phase35_decomp_02_subagent_isolation_creates_fork ... ok
test decomposition::executor::tests::phase35_decomposition_error_serde_roundtrip ... ok
test decomposition::executor::tests::phase35_decomp_02_executor_dispatches_each_group ... ok
test decomposition::executor::tests::phase35_execute_decomposed_task_invalid_dag_returns_err ... ok

test result: ok. 8 passed; 0 failed; 0 ignored; 0 measured; 711 filtered out; finished in 0.01s
```

**All 24 decomposition module tests green** (planner: 8, summary: 8, executor: 8) — confirms my body fill did not regress Plan 35-03 or Plan 35-06's parallel work.

### Body shape (canonical site)

```rust
pub async fn execute_decomposed_task(
    parent_session_id: &str,
    parent_state: &mut LoopState,
    groups: Vec<StepGroup>,
    app: &AppHandle,
    config: &BladeConfig,
) -> Result<Vec<SubagentSummary>, DecompositionError> {
    use futures::FutureExt;
    let inner = std::panic::AssertUnwindSafe(execute_decomposed_task_inner(
        parent_session_id, parent_state, groups, app, config,
    ));
    match inner.catch_unwind().await {
        Ok(r) => r,
        Err(_panic) => Err(DecompositionError::Internal(
            "execute_decomposed_task panicked (catch_unwind)".to_string(),
        )),
    }
}
```

The inner body:
1. `build_swarm_from_groups(&groups, parent_session_id)` → Swarm
2. `swarm::validate_dag(&swarm.tasks)` → Result; map_err to `DecompositionError::DagInvalid`
3. `read_parent_msg_count(&config.session.jsonl_log_dir, parent_session_id)` → fork point (defaults to 0 on Err)
4. `_max_concurrent = (config.decomposition.max_parallel_subagents.min(5)) as usize` (cap documented; serial dispatch for v1)
5. For each group: cost-budget interlock (`>= cost_guard_per_conversation_dollars` → `Err(ParentBudgetExceeded)`); spawn_isolated_subagent; rollup `parent_state.conversation_cumulative_cost_usd += summary.cost_usd`
6. `Ok(summaries)` after all groups walked

### spawn_isolated_subagent flow

```rust
async fn spawn_isolated_subagent(group, parent_session_id, parent_msg_count, app, config) -> SubagentSummary {
    // (test-only seam) — short-circuit; emit chips so event-shape tests pass.
    #[cfg(test)] { let forced = DECOMP_FORCE_SUBAGENT_RESULT.with(|c| c.borrow_mut().take());
                   if let Some(f) = forced { emit_started; emit_complete; return f; } }

    // (a) fork_session — Phase 34 SESS-04. On Err: stub summary, no started emit.
    let new_id = match fork_session(parent.to_string(), parent_msg_count).await { Ok(id) => id, Err(e) => return stub };

    // (b) emit_subagent_started AFTER fork, BEFORE run_loop.
    emit_subagent_started(app, group);

    // (c) run_subagent_to_halt — v1 placeholder Ok((true, 0.0, 0)); Plan 35-07 fills.
    let (success, sub_cost, tokens_used) = run_subagent_to_halt(&new_id, group, app, config).await.unwrap_or((false, 0.0, 0));

    // (d) distill_subagent_summary — Plan 35-06 (filled in parallel commit c66e8ea).
    //     Err fallback: heuristic SubagentSummary with bracket-prefixed err excerpt.
    let mut summary = match distill_subagent_summary(&new_id, group.role.clone(), config).await { ... };
    summary.step_index = group.step_index;
    summary.success = summary.success && success;

    // (e) emit_subagent_complete AFTER distill, BEFORE return.
    emit_subagent_complete(app, group, &summary);
    summary
}
```

### Verification

| Acceptance Criterion | Target | Actual | Status |
|---|---|---|---|
| `fn build_swarm_from_groups\|fn spawn_isolated_subagent\|fn emit_subagent_started\|fn emit_subagent_complete\|fn read_parent_msg_count` | 5 | 5 | ✓ |
| `DECOMP_FORCE_SUBAGENT_RESULT` refs | ≥2 | 9 | ✓ |
| `fork_session` refs | ≥1 | 11 | ✓ |
| `validate_dag` refs | ≥1 | 7 | ✓ |
| `ParentBudgetExceeded\|cost_guard_per_conversation_dollars` refs | ≥2 | 3 | ✓ |
| cargo check exit 0 | 0 | 0 | ✓ |
| phase35 executor tests green | all | 8/8 | ✓ |

## Integration Notes

### Phase 34 SESS-04 fork_session linkage
- **Call site:** `crate::session::list::fork_session(parent_session_id.to_string(), parent_msg_count).await` at `src-tauri/src/decomposition/executor.rs` line ~155 (inside spawn_isolated_subagent, branch (a))
- **fork_session signature** (`src-tauri/src/session/list.rs:241`): `pub async fn fork_session(parent_id: String, fork_at_message_index: u32) -> Result<String, String>`
- **Returns:** new ULID-named JSONL session ID. The forked JSONL inherits parent's `SessionMeta.parent` set to parent_id and `fork_at` set to the clamped index.
- **Grandchild rejection:** fork_session itself rejects forking a session that is itself a fork. Plan 35-04's recursion gate (`!loop_state.is_subagent`) prevents calling fork on a child anyway, so this is belt-and-suspenders.

### swarm.rs validate_dag linkage
- **Call site:** `crate::swarm::validate_dag(&swarm.tasks)` at executor.rs line ~85 (inside execute_decomposed_task_inner, step 1)
- **validate_dag signature** (`src-tauri/src/swarm.rs:594`): `pub fn validate_dag(tasks: &[SwarmTask]) -> Result<(), String>`
- **Algorithm:** Kahn's topological sort — counts in-degrees, walks zero-in-degree nodes, asserts processed count == task count
- **Map to DecompositionError:** `validate_dag(...).map_err(DecompositionError::DagInvalid)?` — String error becomes the variant payload

### Plan 35-06 distill_subagent_summary linkage
Plan 35-06 was filled in parallel (commit `c66e8ea` landed during Plan 35-05's run). My executor calls `distill_subagent_summary(&new_id, group.role.clone(), config).await` and falls back to a heuristic SubagentSummary on Err. The heuristic carries `success=false` + bracketed err excerpt as `summary_text`; tokens_used and cost_usd are inherited from the run_subagent_to_halt result. **No Plan 35-06 file was touched** — the integration is purely through the function signature.

## Forward Pointers

This plan supplies the executor body that **Plan 35-07** will exercise:

- **Plan 35-07** fills `run_subagent_to_halt`. Today the v1 placeholder returns `Ok((true, 0.0, 0))`. Plan 35-07 will dispatch real sub-agent run_loop through the forked SessionWriter with `LoopState{is_subagent=true}`, capture the halt cost, and return real (success, cost, tokens). At that point, `distill_subagent_summary` will see real conversation content in the forked JSONL and the `summary_text` field will be meaningful.
- **Plan 35-08** wires the `subagent_isolation` config field — today the executor honors fork-per-sub-agent unconditionally (the config flag is read but not branched on). Plan 35-08 may add a `subagent_isolation=false` debug-only path that skips fork.
- **Plan 35-09** wires the parent UI's session_id filter — sub-agent's run_loop emits go to the same AppHandle today, but the parent's chat surface filters by session_id and ignores foreign-session tokens.
- **Plan 35-11** closes the phase with UAT: 5+ verb query → 3 sub-agents fork from parent → finish in parallel (or serial) → parent renders ONE synthetic AssistantTurn per sub-agent + chat shows subagent_started/complete chips for each step.

## Deviations from Plan

### Plan-Spec Adjustments (data shape, not behavior)

**1. RefCell, not Cell, for DECOMP_FORCE_SUBAGENT_RESULT**
- **Found during:** Plan reconnaissance — Plan 35-02 stub already declared seam as `RefCell<Option<SubagentSummary>>`; Plan 35-05's prescribed code showed `Cell<Option<SubagentSummary>>`.
- **Issue:** SubagentSummary doesn't impl Copy (it has String fields), so Cell would not compile. The Plan 35-02 stub used the correct RefCell shape. Other plans in the wave already reference it with `*c.borrow_mut() = Some(s)` and `c.borrow_mut().take()`.
- **Fix:** Preserved the existing RefCell shape verbatim. Plan-frontmatter `must_haves.truths` line says "DECOMP_FORCE_SUBAGENT_RESULT seam preserved verbatim from Plan 35-02"; that's what I did.
- **Files modified:** `src-tauri/src/decomposition/executor.rs`
- **Commit:** `0e11b58`

**2. SwarmTask explicit field-by-field construction (no Default derive)**
- **Found during:** Task 1 GREEN compile attempt
- **Issue:** Plan-prescribed code used `..Default::default()` to fill SwarmTask. SwarmTask does NOT derive Default — it has 17 required fields including i64 timestamps, Option fields, and enum fields. The plan-spec parenthetical noted this might happen: "If `..Default::default()` doesn't compile, replace with explicit field initializers per swarm.rs's struct definition."
- **Fix:** Wrote explicit field literals for all 17 fields. `SwarmTaskType::default()` is used (the type itself has Default → Code variant). status defaults to `SwarmTaskStatus::Pending`; created_at = chrono::Utc::now().timestamp(); started_at/completed_at/error/agent_id/scratchpad_key/result default to None.
- **Files modified:** `src-tauri/src/decomposition/executor.rs`
- **Commit:** `0e11b58`

**3. Swarm explicit field-by-field construction (no Default derive)**
- **Found during:** Task 1 GREEN compile attempt
- **Issue:** Same root cause as #2 — Swarm has 9 fields including HashMap, Vec, and timestamp; no Default.
- **Fix:** Explicit literals: `id` from `ulid::Ulid::new().to_string()`; `goal` from formatted parent session linkage; `status: SwarmStatus::Planning`; `scratchpad: HashMap::new()`; `scratchpad_entries: Vec::new()`; `final_result: None`; `tasks` from the iter().collect(); `created_at` = `updated_at` = current Unix timestamp.
- **Files modified:** `src-tauri/src/decomposition/executor.rs`
- **Commit:** `0e11b58`

**4. Tests synchronous (no AppHandle path) — full async dispatch deferred to Plan 35-11 UAT**
- **Found during:** Task 1 RED test design
- **Issue:** Plan-prescribed test names (`phase35_decomp_02_subagent_isolation_separate_loop_state`, `phase35_decomp_02_parent_budget_exceeded_halts_remaining`) require driving `execute_decomposed_task` end-to-end with an AppHandle. AppHandle is not constructible in unit tests (Tauri builder requires a manager/event-loop runtime). The plan's `<acceptance_criteria>` tail explicitly notes: "Tests requiring tokio runtime + AppHandle live as integration tests in Plan 35-11 (full UAT path). Plan 35-05 keeps unit tests synchronous + compile-only verifications of contract."
- **Fix:** Adjusted test names to match the synchronous + contract-verification pattern: `phase35_decomp_02_max_parallel_respected`, `phase35_decomp_02_executor_dispatches_each_group`, `phase35_decomp_02_subagent_isolation_creates_fork`, `phase35_decomp_02_cost_rollup_sums_subagent_costs`, `phase35_decomp_02_force_executor_result_seam_works`, `phase35_execute_decomposed_task_invalid_dag_returns_err`. Each test exercises one contract: the cost-rollup arithmetic, the swarm-build shape, the seam round-trip, the DAG validation, the helper failure modes.
- **Coverage gap:** Full async path (parent_state mutation through real fork→spawn→distill) lives in Plan 35-11 UAT.
- **Files modified:** `src-tauri/src/decomposition/executor.rs`
- **Commit:** `f5366b7`

**5. run_subagent_to_halt v1 placeholder returns success/no-cost**
- **Found during:** Task 1 GREEN body draft
- **Issue:** Plan explicitly says (line 175 of 35-05-PLAN.md): "Phase 35 v1 stub-style runner: returns (true, 0.0, 0) until Plan 35-07 (or a follow-up) wires real swarm dispatch." This is intentional design, not a deviation — but I'm calling it out so future readers don't think the executor is fully wired.
- **Effect:** Production-path sub-agents do no work and accumulate no cost until Plan 35-07. Tests bypass run_subagent_to_halt via the DECOMP_FORCE_SUBAGENT_RESULT seam. The DECOMP-01 trigger from Plan 35-04 will see the parent halt with `LoopHaltReason::DecompositionComplete` and synthetic AssistantTurns populated, but each turn's `summary_text` will be the heuristic fallback "[summary distillation failed: ...]" because run_subagent_to_halt produces an empty forked session.
- **Acceptance:** documented in Plan 35-05 frontmatter; matches the explicit handoff to Plan 35-07.

### No Auto-fixed Bugs

No Rule 1 / Rule 2 / Rule 3 deviations. Plan 35-02's stub already had the right shape (DecompositionError enum, DECOMP_FORCE_SUBAGENT_RESULT seam); Plan 35-05's body fill is purely additive over the stub.

## Threat Flags

None — Plan 35-05 introduces no new network endpoints, auth paths, file-access patterns beyond what Phase 34 SESS-04 already exposes, or schema changes at trust boundaries. The plan's threat register from 35-05-PLAN.md remains valid:

- **T-35-16 (recursion gate silently removed)** — Mitigated by Plan 35-04's `phase35_decomp_01_subagent_does_not_recurse` test. Plan 35-05's body propagates is_subagent through the run_subagent_to_halt boundary (currently a no-op; Plan 35-07 enforces the gate at the real run_loop call site).
- **T-35-17 (cost rollup race)** — Accepted for v1: serial dispatch via `for group in &groups` enforces single-writer; mutable `parent_state` borrow forbids parallel access at the type level. Plan 35-07 may add `Arc<Mutex<f32>>` if it adopts JoinSet.
- **T-35-18 (pathological N=1000 StepGroups)** — Mitigated: swarm.rs's 5-concurrent cap + `min(max_parallel_subagents, 5)`. The serial loop in execute_decomposed_task_inner doesn't itself cap N — but Plan 35-04's pre-iteration trigger only fires when `count_independent_steps_grouped` returns Some, and the heuristic axes are bounded by query length.
- **T-35-19 (sub-agent JSONL information disclosure)** — Accepted v1: documented behavior. Sub-agent JSONL is in user's own filesystem at `jsonl_log_dir`; no IPC exposure introduced by Plan 35-05.
- **T-35-20 (panic propagation)** — Mitigated: async catch_unwind via `futures::FutureExt::catch_unwind` on the entire `execute_decomposed_task_inner` future. Panics anywhere in the body (build_swarm_from_groups, fork_session, distill, emit) surface as `DecompositionError::Internal`, the parent loop logs and falls through to sequential.

## Self-Check: PASSED

**Files exist:**
- FOUND: /home/arnav/blade/src-tauri/src/decomposition/executor.rs
- FOUND: /home/arnav/blade/.planning/phases/35-auto-decomposition/35-05-SUMMARY.md

**Commits exist:**
- FOUND: f5366b7 (test(35-05): add failing tests for execute_decomposed_task body — DECOMP-02 RED)
- FOUND: 0e11b58 (feat(35-05): fill execute_decomposed_task body + spawn_isolated_subagent + cost rollup — DECOMP-02 GREEN)

**Acceptance criteria:** all 7 grep + test checks satisfied (5 helper fn names + DECOMP_FORCE_SUBAGENT_RESULT≥2 + fork_session≥1 + validate_dag≥1 + ParentBudgetExceeded/cost_guard≥2 + cargo check exit 0 + 8/8 tests green).
