---
phase: 28-active-inference-loop
plan: "01"
subsystem: active-inference
tags: [active-inference, hormones, prediction-error, sqlite, hive]
dependency_graph:
  requires: [homeostasis.rs PhysiologicalState (Phase 27), hive.rs TentacleReport (Phase 4), integration_bridge.rs CalendarEvent]
  provides: [active_inference.rs TentaclePrediction, compute_prediction_errors(), update_physiology_from_prediction_errors(), tentacle_predictions table, prediction_error_log table]
  affects: [homeostasis.rs hormone bus (second input channel), db.rs schema, evals/mod.rs]
tech_stack:
  added: [active_inference.rs module, tentacle_predictions SQLite table, prediction_error_log SQLite table]
  patterns: [OnceLock<Mutex<T>> global state, EMA learning (alpha per tentacle type), D-08 weighted aggregate (Error/Dormant = 0 weight), pure-function signal extraction for test isolation]
key_files:
  created: [src-tauri/src/active_inference.rs]
  modified: [src-tauri/src/db.rs, src-tauri/src/lib.rs, src-tauri/src/evals/mod.rs, src-tauri/src/homeostasis.rs]
decisions:
  - "Calendar signal extraction is a pure function (extract_calendar_signals) accepting &[CalendarEvent] — enables test fixture injection without global state"
  - "compute_aggregate_error_with_statuses() accepts explicit statuses for test isolation; production compute_aggregate_error() queries get_hive_status() internally"
  - "process_reports_for_test() uses all-Active statuses so eval fixtures don't depend on Hive global state"
  - "Worktree base was at 9253e1c (pre-Phase-27) so homeostasis.rs was copied from target commit 4a6b710 to provide PhysiologicalState layer"
metrics:
  duration: "6 minutes"
  completed: "2026-05-02"
  tasks_completed: 2
  tasks_total: 2
  files_created: 1
  files_modified: 4
---

# Phase 28 Plan 01: Active Inference Foundation Summary

**One-liner:** Active inference core with TentaclePrediction EMA learning, D-08 weighted aggregate, pure-function calendar extraction, and second hormone bus channel for prediction-error-driven cortisol/norepinephrine modulation.

## Tasks Completed

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | Create active_inference.rs core module | c2292ba | src-tauri/src/active_inference.rs, db.rs, lib.rs, evals/mod.rs |
| 2 | Add update_physiology_from_prediction_errors() | a45fe10 | src-tauri/src/homeostasis.rs |

## What Was Built

### active_inference.rs (~420 lines)

- `SignalExpectation`, `TentaclePrediction`, `ActiveInferenceState` structs
- `static PREDICTIONS: OnceLock<Mutex<HashMap<String, TentaclePrediction>>>` + `SUSTAINED_HIGH_TICKS: AtomicU32`
- `default_prediction(platform)` — cold-start expected values for calendar/slack/github (confidence=0.1)
- `extract_signals_from_report()` — parses TentacleReport.details for slack/github signals
- `extract_calendar_signals(events: &[CalendarEvent])` — **pure function** for test fixture isolation
- `normalize_error(expected, observed, range_max)` — [0,1] normalization
- `prediction_error_for_tentacle(pred, observed)` — confidence-weighted mean error
- `update_prediction_ema(prediction, observed)` — per-tentacle alpha (calendar=0.1, slack=0.08, github=0.05)
- `compute_aggregate_error_with_statuses(errors, statuses)` — D-08: Error/Dormant/Disconnected = 0 weight
- `compute_prediction_errors(app, reports)` — async main entry point (called by hive_tick in Plan 02)
- `process_reports_for_test(reports, calendar_events)` — sync test wrapper, no SQLite/emit
- SQLite persistence: `load_predictions_from_db`, `persist_predictions_to_db`, `log_prediction_error` (FIFO prune at 999)

### homeostasis.rs additions

- `update_physiology_from_prediction_errors(aggregate_error, sustained_high_ticks, is_single_spike)` — second hormone input channel
- Sustained high (>=2 ticks, >0.6): cortisol + norepinephrine via alpha=0.05 EMA
- Sustained low (<0.2, 0 ticks): serotonin → 0.7
- Novel spike: norepinephrine → 0.9 independently
- Does NOT touch mortality_salience, dopamine, acetylcholine, oxytocin

### db.rs additions

Two new tables appended after `typed_memories` execute_batch block:
- `tentacle_predictions (platform TEXT PK, data TEXT, updated_at INTEGER)`
- `prediction_error_log (id AUTOINCREMENT, platform, aggregate_error, top_signal, timestamp)` — capped at 1000 rows

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Worktree base at pre-Phase-27 commit missing PhysiologicalState in homeostasis.rs**
- **Found during:** Task 2 (attempted to add `update_physiology_from_prediction_errors` after `update_physiology_from_classifier`, which didn't exist)
- **Issue:** Worktree was based on commit `9253e1c` (pre Phase 21); `git reset --hard` was denied. homeostasis.rs in worktree had only the operational HormoneState layer, not the Phase 27 PhysiologicalState layer that Plan 28-01 extends.
- **Fix:** Copied homeostasis.rs from target commit `4a6b710` (master) via `git show 4a6b710:src-tauri/src/homeostasis.rs`, then applied Task 2's addition on top.
- **Files modified:** src-tauri/src/homeostasis.rs
- **Commit:** a45fe10

**2. [Rule 2 - Missing] evals/mod.rs in worktree missing Phase 23-27 eval registrations**
- **Found during:** Task 1 (evals/mod.rs was at older version, missing adversarial_eval, safety_eval, hormone_eval lines)
- **Fix:** Added all missing eval module registrations (Phase 23-27) plus the new active_inference_eval in one edit to keep the file consistent with master.
- **Files modified:** src-tauri/src/evals/mod.rs
- **Commit:** c2292ba

## Threat Model Coverage

All T-28 mitigations implemented:
- **T-28-01** (Tampering): All extracted signal values clamped to [0.0, range_max] in `extract_signals_from_report`
- **T-28-02** (DoS): FIFO prune (DELETE ... LIMIT 999) runs before every insert to `prediction_error_log`
- **T-28-04** (Elevation): `aggregate_error` clamped to [0,1] by `compute_aggregate_error_with_statuses`; `sustained_high_ticks >= 2` gate before cortisol modification; alpha=0.05 prevents sudden jumps

## Known Stubs

None — no hardcoded empty values or placeholders that prevent this plan's goal. The `active_inference_eval` module reference in evals/mod.rs will fail to compile until Plan 04 creates the eval file; this is explicitly noted in the plan as acceptable within Wave 1.

## Self-Check: PASSED

- src-tauri/src/active_inference.rs: EXISTS
- src-tauri/src/homeostasis.rs updated with `update_physiology_from_prediction_errors`: VERIFIED (line 415)
- src-tauri/src/db.rs contains `tentacle_predictions`: VERIFIED (line 546)
- src-tauri/src/lib.rs contains `mod active_inference`: VERIFIED (line 67)
- Commit c2292ba exists: VERIFIED
- Commit a45fe10 exists: VERIFIED
