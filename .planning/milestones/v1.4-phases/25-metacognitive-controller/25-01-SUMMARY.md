---
phase: 25-metacognitive-controller
plan: "01"
subsystem: metacognition
tags: [metacognition, persistence, sqlite, tauri-command, test-stubs]
dependency_graph:
  requires: []
  provides:
    - MetacognitiveState struct with Default derive
    - get_state() — read in-memory MetacognitiveState
    - record_uncertainty_marker() — increment uncertainty_count, persist
    - log_gap() — write to metacognitive_gap_log, feed evolution Voyager loop
    - ensure_gap_log_table() — idempotent CREATE TABLE IF NOT EXISTS
    - metacognition_get_state Tauri command
    - Wave 0 test stubs for META-01 through META-05
  affects:
    - src-tauri/src/reasoning_engine.rs (Plan 02 calls record_uncertainty_marker, log_gap)
    - src-tauri/src/doctor.rs (Plan 03 adds SignalClass::Metacognitive, uncomments META-05 stub)
tech_stack:
  added:
    - rusqlite parameterized queries for metacognitive_gap_log table
    - OnceLock<Mutex<MetacognitiveState>> pattern (homeostasis.rs-style)
  patterns:
    - Settings-table persistence: INSERT ... ON CONFLICT DO UPDATE (same as homeostasis.rs)
    - safe_slice() for all user-supplied text before SQLite storage
    - evolution::evolution_log_capability_gap called from log_gap for Voyager-loop feed
key_files:
  created: []
  modified:
    - src-tauri/src/metacognition.rs
    - src-tauri/src/lib.rs
    - src-tauri/src/doctor.rs
decisions:
  - MetacognitiveState struct added in Task 0 (not Task 1) so test stubs compile immediately
  - OnceLock initialized lazily from blade.db settings table; falls back to Default on first run
  - doctor.rs META-05 test stub written as commented block — Plan 03 uncomments after adding SignalClass::Metacognitive
  - log_gap sets initiative_shown=1 and fed_to_evolution=1 at insert time (gap logging implies both already occurred)
metrics:
  duration: "~35 minutes (dominated by cargo test compile waits)"
  completed_date: "2026-05-02"
  tasks_completed: 3
  tasks_total: 3
  files_modified: 3
---

# Phase 25 Plan 01: MetacognitiveState Foundation Summary

**One-liner:** OnceLock-persisted MetacognitiveState struct with gap-log table, record/log/get functions, Tauri command, and Wave 0 test stubs for META-01 through META-05.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 0 | Wave 0 test stubs (META-01 through META-05) | 65d2673 | metacognition.rs, doctor.rs |
| 1 | MetacognitiveState persistence + gap log + functions | b3f10c0 | metacognition.rs |
| 2 | Register metacognition_get_state in lib.rs | 8f7d00c | lib.rs |

## What Was Built

### metacognition.rs additions

- `MetacognitiveState` struct (`confidence: f32`, `uncertainty_count: u32`, `gap_count: u32`, `last_updated: i64`) with `#[derive(Default)]`
- `static META_STATE: OnceLock<Mutex<MetacognitiveState>>` — process-lifetime singleton, initialized from blade.db settings table
- `get_state()` — public reader, returns clone; called by Plan 03 DoctorPane and Plan 02 reasoning engine
- `load_meta_state()` / `persist_meta_state()` — SQLite settings table I/O using `metacognitive_state` key
- `ensure_gap_log_table()` — creates `metacognitive_gap_log` table (idempotent)
- `record_uncertainty_marker(thought, delta)` — increments `uncertainty_count`, persists; called by Plan 02 on confidence drop >0.3
- `log_gap(topic, user_request, confidence, uncertainty_count)` — parameterized SQLite insert with `safe_slice` truncation, feeds `evolution::evolution_log_capability_gap`, updates in-memory state
- `metacognition_get_state()` Tauri command — wraps `get_state()` for TypeScript IPC

### lib.rs

- `metacognition::metacognition_get_state` added to `generate_handler![]` at line 1377

### doctor.rs

- Commented `test_metacognitive_signal` stub added after `drift_classify_red_on_ledger_and_missing_profile` test. Plan 03 Task 1 uncomments it after adding `SignalClass::Metacognitive`.

## Verification

```
test metacognition::tests::test_confidence_delta_flag ... ok
test metacognition::tests::test_initiative_phrasing ... ok
test metacognition::tests::test_metacognitive_state_default ... ok
test metacognition::tests::test_gap_log_insert ... ok
test metacognition::tests::test_verifier_routing ... ok

test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 440 filtered out
```

## Threat Mitigations Applied

| Threat ID | Mitigation |
|-----------|------------|
| T-25-01 | All SQLite writes in `log_gap` use `rusqlite::params![]` — no string interpolation |
| T-25-02 | `topic` truncated to 120 chars, `user_request` to 300 chars via `crate::safe_slice` |
| T-25-03 | `MetacognitiveState` contains only aggregate counts (no PII) — accepted |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Ordering] MetacognitiveState added in Task 0, not Task 1**
- **Found during:** Task 0 — test stubs reference `MetacognitiveState::default()` which must exist at compile time
- **Fix:** Added the struct (with `Default` derive and `OnceLock`/`Mutex` imports) in Task 0 so all 5 test stubs compile immediately
- **Impact:** None — Task 1 then added all the implementation on top of the already-present struct
- **Files modified:** metacognition.rs

No other deviations. Plan executed as written.

## Known Stubs

None — all functions are fully implemented. Test stubs for META-02 and META-03 (`test_verifier_routing`, `test_initiative_phrasing`) are intentionally lightweight placeholders; Plan 02 extends them with `build_initiative_response` calls.

## Self-Check: PASSED

| Item | Status |
|------|--------|
| src-tauri/src/metacognition.rs | FOUND |
| src-tauri/src/lib.rs | FOUND |
| 25-01-SUMMARY.md | FOUND |
| Commit 65d2673 (Task 0 test stubs) | FOUND |
| Commit b3f10c0 (Task 1 implementation) | FOUND |
| Commit 8f7d00c (Task 2 lib.rs registration) | FOUND |
