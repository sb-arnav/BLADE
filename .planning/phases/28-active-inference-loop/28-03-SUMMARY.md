---
phase: 28-active-inference-loop
plan: "03"
subsystem: doctor
tags: [active-inference, doctor, signal, observability, prediction-error]
dependency_graph:
  requires: [active_inference.rs get_active_inference_state() (Plan 28-01)]
  provides: [SignalClass::ActiveInference, compute_active_inference_signal(), 3 suggested_fix strings, updated exhaustiveness test]
  affects: [src-tauri/src/doctor.rs, DoctorPane UI signal row]
tech_stack:
  added: []
  patterns: [compute_*_signal() pattern, tokio::join! parallel execution, suggested_fix match table]
key_files:
  created: []
  modified: [src-tauri/src/doctor.rs]
decisions:
  - "Severity thresholds for ActiveInference: >0.7 = Red, >0.4 = Amber, else Green — matches the plan's D-18 spec"
  - "Payload includes all 4 ActiveInferenceState fields: aggregate_error, top_tentacle, tracked_count, demo_loop_active"
metrics:
  duration: "2 minutes"
  completed: "2026-05-02"
  tasks_completed: 1
  tasks_total: 1
  files_created: 0
  files_modified: 1
---

# Phase 28 Plan 03: Doctor ActiveInference Signal Summary

**One-liner:** DoctorPane D-18 signal for active inference — SignalClass::ActiveInference with Green/Amber/Red thresholds on aggregate_error, compute function reading get_active_inference_state(), and exhaustiveness test updated to 9×3 = 27.

## Tasks Completed

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | Add SignalClass::ActiveInference to doctor.rs with compute function, suggested_fix strings, and updated test | 248f3bd | src-tauri/src/doctor.rs |

## What Was Built

### doctor.rs changes (41 lines added, 3 modified)

**SignalClass enum** — Added `ActiveInference` variant after `Hormones`:
- `ActiveInference,  // Phase 28 / AINF-01`

**suggested_fix table** — 3 new match arms:
- Green: "Prediction errors are low across all tentacles. BLADE's world-model is well-calibrated."
- Amber: "Aggregate prediction error elevated (>0.4). One or more tentacles showing unexpected activity. Check the payload for top_tentacle."
- Red: "Sustained high prediction error (>0.6 for 2+ ticks). Cortisol and norepinephrine are rising. Review the active tentacles and allow idle time for EMA recalibration."

**compute_active_inference_signal()** — New function:
- Reads `crate::active_inference::get_active_inference_state()`
- Severity: aggregate_error > 0.7 → Red, > 0.4 → Amber, else Green
- Payload: aggregate_error, top_tentacle, tracked_count, demo_loop_active

**tokio::join!** — Expanded from 8-tuple to 9-tuple; `active_inference` added as 9th element

**signals vec** — `active_inference.map_err(...)` appended after hormones

**Exhaustiveness test** — Comment updated from `8×3 = 24` to `9×3 = 27`; `SignalClass::ActiveInference` added to the for-loop array

## Deviations from Plan

None — plan executed exactly as written.

## Threat Model Coverage

- **T-28-08** (Information Disclosure): DoctorPane payload contains aggregate_error (float), top_tentacle (string), tracked_count (int), demo_loop_active (bool) — no PII or credentials; all local display only. Disposition: accept (no mitigation required).

## Known Stubs

None — no hardcoded empty values or placeholders that prevent this plan's goal. compute_active_inference_signal() reads live state from the global PREDICTIONS + SUSTAINED_HIGH_TICKS atomics set up in Plan 28-01.

## Threat Flags

None — no new network endpoints, auth paths, file access patterns, or schema changes introduced.

## Self-Check: PASSED

- `SignalClass::ActiveInference` in enum: VERIFIED (line 43)
- `(SignalClass::ActiveInference, Severity::Green)` in suggested_fix: VERIFIED (line 162)
- `(SignalClass::ActiveInference, Severity::Amber)` in suggested_fix: VERIFIED (line 164)
- `(SignalClass::ActiveInference, Severity::Red)` in suggested_fix: VERIFIED (line 166)
- `fn compute_active_inference_signal()`: VERIFIED (line 1027)
- `crate::active_inference::get_active_inference_state()`: VERIFIED (line 1028)
- `async { compute_active_inference_signal() }` in tokio::join!: VERIFIED (line 1076)
- `active_inference.map_err` in signals vec: VERIFIED (line 1091)
- `SignalClass::ActiveInference,` in test array: VERIFIED (line 1195)
- Test comment says `9×3 = 27`: VERIFIED (line 1185)
- grep -c "ActiveInference" returns >= 10: VERIFIED (13 total occurrences)
- Commit 248f3bd exists: VERIFIED
