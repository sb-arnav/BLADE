---
phase: 25-metacognitive-controller
plan: 03
status: complete
started: 2026-05-02T10:05:00Z
completed: 2026-05-02T11:35:00Z
---

# Plan 25-03 Summary — Metacognitive Signal in DoctorPane

## What was built

Added `SignalClass::Metacognitive` as the 7th signal source in the doctor system, wired from Rust through to the DoctorPane UI.

### doctor.rs

- **SignalClass::Metacognitive** variant added to enum (META-05)
- **compute_metacognitive_signal**: reads `metacognition::get_state()`, maps gap_count/uncertainty_count to Red/Amber/Green severity, produces DoctorSignal with confidence/counts payload
- **suggested_fix**: 3 severity arms with actionable guidance (Green = active monitoring, Amber = capability gap logged, Red = 3+ gaps logged)
- **emit_activity_for_doctor**: Metacognitive match arm added
- **doctor_run_full_check**: Extended `tokio::join!` from 6 to 7 signal sources, destructuring updated
- **Tests updated**: `suggested_fix_table_is_exhaustive` covers Metacognitive (7x3=21 arms), signal count assertion updated from 6 to 7, `test_metacognitive_signal` uncommented and exercises `compute_metacognitive_signal`

### admin.ts

- `SignalClass` type union extended with `| 'metacognitive'`

### DoctorPane.tsx

- `DISPLAY_NAME`: `metacognitive: 'Metacognitive'`
- `ROW_ORDER`: `'metacognitive'` appended at tail
- `rowRefs`: `metacognitive` entry added to Record

## Key files

### Created
None — all changes are modifications to existing files.

### Modified
- `src-tauri/src/doctor.rs` — +70/-21 lines: enum variant, compute function, match arms, join extension, test updates
- `src/lib/tauri/admin.ts` — +3/-1 lines: SignalClass union extension
- `src/features/admin/DoctorPane.tsx` — +4 lines: DISPLAY_NAME, ROW_ORDER, rowRefs entries

## Deviations
None — implemented exactly per plan.

## Self-Check: PASSED
- `cargo check` clean
- `npx tsc --noEmit` clean
- `cargo test --lib metacogniti` — test_metacognitive_signal passes
- All acceptance criteria met
