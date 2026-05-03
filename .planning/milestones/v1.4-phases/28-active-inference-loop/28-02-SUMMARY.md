---
phase: 28-active-inference-loop
plan: "02"
subsystem: active-inference
tags: [active-inference, hive, dream-mode, prediction-error, hippocampal-replay, typed-memory]
dependency_graph:
  requires: [active_inference.rs compute_prediction_errors() (Plan 01), hive.rs TentacleReport, dream_mode.rs run_task! macro, typed_memory.rs store_typed_memory()]
  provides: [hive_tick prediction error hook, task_prediction_replay() dream task, AINF-04 wired, AINF-05 wired]
  affects: [src-tauri/src/hive.rs (hive_tick loop), src-tauri/src/dream_mode.rs (dream session task order)]
tech_stack:
  added: []
  patterns: [run_task! macro for dream tasks, DREAMING AtomicBool checkpoint, rusqlite::Connection::open pattern, crate::typed_memory::store_typed_memory async call]
key_files:
  created: []
  modified: [src-tauri/src/hive.rs, src-tauri/src/dream_mode.rs]
decisions:
  - "Hook uses .await (not tokio::spawn) to keep ordering deterministic — prediction errors computed before emit/log calls that follow"
  - "task_prediction_replay takes no AppHandle — SQLite and typed_memory are sufficient; run_task! macro handles timeout and DREAMING abort"
  - "Inserted prediction_replay run_task! AFTER skill_synthesis and BEFORE skill_prune so replay results inform which skills to prune/consolidate"
metrics:
  duration: "4 minutes"
  completed: "2026-05-02"
  tasks_completed: 2
  tasks_total: 2
  files_created: 0
  files_modified: 2
---

# Phase 28 Plan 02: Active Inference Integration Summary

**One-liner:** Wired compute_prediction_errors into hive_tick (every 30s poll cycle) and added hippocampal replay task to dream_mode (high-error events -> typed memory consolidation before skill lifecycle).

## Tasks Completed

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | Hook active inference into hive_tick | 2448080 | src-tauri/src/hive.rs |
| 2 | Add task_prediction_replay to dream_mode.rs | d523061 | src-tauri/src/dream_mode.rs |

## What Was Built

### hive.rs change (Task 1)

Inserted a 4-line block at line 2466 in `hive_tick()`, immediately after the people enrichment `for` loop and before the `ci_failures` auto-fix pipeline:

```rust
// ── Active inference: compute prediction errors from this tick's reports (Phase 28 / AINF-04) ──
if !all_reports.is_empty() {
    crate::active_inference::compute_prediction_errors(&app, &all_reports).await;
}
```

- Guard `!all_reports.is_empty()` mirrors the existing early-return guard at line 2323
- `.await` (not `tokio::spawn`) keeps prediction error computation ordered before downstream emit/log calls
- No new imports needed — `mod active_inference` was registered in lib.rs in Plan 01

### dream_mode.rs changes (Task 2)

**Function added (~55 lines):** `task_prediction_replay() -> String`

- Opens blade.db via `rusqlite::Connection::open`
- Queries `prediction_error_log WHERE aggregate_error > 0.5 ORDER BY aggregate_error DESC LIMIT 10`
- Returns early with informative string if table doesn't exist yet (graceful degradation)
- Iterates over records, checking `DREAMING.load(Ordering::Relaxed)` between each store
- Calls `crate::typed_memory::store_typed_memory("Decision", &content, error.min(1.0), "prediction_replay")` for each high-error record
- Content format: "High prediction error on {platform}: aggregate={:.3}, top_signal={}, at={}. This means BLADE's world model was significantly wrong about {platform} activity. Future predictions should account for this pattern."

**run_task! invocation added** in `run_dream_session()`:

```
skill_synthesis (Task 4) → prediction_replay (Phase 28/AINF-05) → skill_prune (Phase 24)
```

Ordering rationale: replay results are stored to typed_memory before skill_prune runs, so the memory consolidation step informs subsequent skill lifecycle decisions.

## Full Active Inference Cycle (now complete)

After Plans 01 and 02, the full cycle runs automatically:

1. **Poll** — hive tentacles collect external signals every 30s
2. **Report** — TentacleReports assembled into `all_reports`
3. **Predict** — `compute_prediction_errors` looks up stored TentaclePredictions
4. **Error** — per-signal normalized errors computed, EMA predictions updated
5. **Hormones** — `update_physiology_from_prediction_errors` modulates cortisol/norepinephrine/serotonin
6. **Behavior** — hormone state feeds brain.rs system prompt (existing homeostasis channel)
7. **Replay** — during dream_mode, high-error events (>0.5) replayed into typed_memory before skill pruning

## Deviations from Plan

None — plan executed exactly as written. Both insertion points were exactly as documented in the plan's `<interfaces>` section.

## Threat Model Coverage

- **T-28-05** (DoS / hive_tick): Accept — ~1ms computation per tick, O(tentacle_count * signal_count), both bounded
- **T-28-06** (Tampering / typed_memory writes): Mitigated — content generated from prediction metadata (platform name, numeric error value, signal name), not from external input; confidence capped at `.min(1.0)`
- **T-28-07** (DoS / dream replay): Mitigated — `LIMIT 10` on SQL query; `DREAMING.load(Ordering::Relaxed)` checked before each `store_typed_memory` call

## Known Stubs

None — both integrations are fully wired. The prediction_error_log table was created in Plan 01 (db.rs); task_prediction_replay gracefully handles the not-yet-populated case by returning an informative string rather than panicking.

## Self-Check: PASSED

- src-tauri/src/hive.rs contains `crate::active_inference::compute_prediction_errors(&app, &all_reports).await`: VERIFIED (line 2468)
- Hook appears after people enrichment block closing `}` (line 2464) and before `ci_failures` declaration (line 2474): VERIFIED
- src-tauri/src/dream_mode.rs contains `async fn task_prediction_replay() -> String`: VERIFIED (line 435)
- src-tauri/src/dream_mode.rs contains `run_task!("prediction_replay", task_prediction_replay())`: VERIFIED (line 675)
- run_task! for prediction_replay appears after skill_synthesis (line 672) and before skill_prune (line 679): VERIFIED
- Commit 2448080 exists: VERIFIED
- Commit d523061 exists: VERIFIED
