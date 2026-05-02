---
phase: 27-hormone-physiology
plan: "04"
subsystem: ui
tags: [rust, tauri, react, typescript, doctor, diagnostics, hormones, physiology]

# Dependency graph
requires:
  - phase: 27-01
    provides: PhysiologicalState with all 7 hormone scalars in homeostasis.rs, get_physiology() function
  - phase: 25-metacognitive
    provides: SignalClass::Metacognitive pattern (compute_metacognitive_signal, suggested_fix arms, DoctorPane registration)
provides:
  - SignalClass::Hormones as the 8th diagnostic signal in doctor.rs
  - compute_hormones_signal() reading all 7 PhysiologicalState scalars from homeostasis.rs
  - Green/Amber/Red severity classification based on cortisol and norepinephrine thresholds
  - Frontend DoctorPane registration of 'hormones' signal class
affects: [28-active-inference, 29-vitality-engine, 30-organism-eval]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "DoctorPane signal extension: add Rust variant + compute fn + suggested_fix arms + tokio::join entry + signals Vec entry + test update + frontend SignalClass union + DISPLAY_NAME + ROW_ORDER"

key-files:
  created: []
  modified:
    - src-tauri/src/doctor.rs
    - src/lib/tauri/admin.ts
    - src/features/admin/DoctorPane.tsx

key-decisions:
  - "Severity thresholds: Red when cortisol AND norepinephrine both >0.7 (dual-axis dysregulation), Amber when any single hormone (cortisol, NE, or mortality_salience) exceeds 0.6"
  - "All 7 PhysiologicalState scalars exposed in payload for full diagnostic visibility"
  - "Hormones appended last in ROW_ORDER (least volatile compared to eval/capgap/tentacle)"

patterns-established:
  - "DoctorPane extension pattern: 6-step Rust edit (enum variant, 3 suggested_fix arms, compute fn, tokio::join, signals Vec, test) + 3-step frontend edit (SignalClass union, DISPLAY_NAME, ROW_ORDER)"

requirements-completed: [HORM-08, HORM-09]

# Metrics
duration: 15min
completed: 2026-05-02
---

# Phase 27 Plan 04: DoctorPane Hormones Signal Summary

**SignalClass::Hormones wired as 8th diagnostic signal: Rust compute function reads all 7 PhysiologicalState scalars from homeostasis.rs with cortisol/NE-based severity, frontend DoctorPane registered with display name and row position**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-05-02T17:10:00Z
- **Completed:** 2026-05-02T17:25:00Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- Added `SignalClass::Hormones` as the 8th variant in the doctor.rs enum, following Phase 25 Metacognitive precedent exactly
- Implemented `compute_hormones_signal()` reading all 7 hormone scalars (cortisol, dopamine, serotonin, acetylcholine, norepinephrine, oxytocin, mortality_salience) via `crate::homeostasis::get_physiology()`
- Red severity when cortisol AND norepinephrine both exceed 0.7; Amber when any single hormone (cortisol, NE, or mortality_salience) exceeds 0.6; Green otherwise
- 3 suggested_fix arms for all severity combinations, wired into tokio::join and signals Vec
- Test updated from 21 pairs (7x3) to 24 pairs (8x3) — `suggested_fix_table_is_exhaustive` now covers all 8 signal classes
- Frontend: `'hormones'` added to SignalClass union in admin.ts, `hormones: 'Hormones'` added to DISPLAY_NAME, `'hormones'` appended to ROW_ORDER in DoctorPane.tsx
- `cargo check` exits 0; `npx tsc --noEmit` exits 0

## Task Commits

Each task was committed atomically:

1. **Task 1: SignalClass::Hormones in doctor.rs** - `8a0c245` (feat)
2. **Task 2: Frontend DoctorPane registration (admin.ts + DoctorPane.tsx)** - `b0ab459` (feat)

## Files Created/Modified

- `src-tauri/src/doctor.rs` - Added Hormones enum variant, compute_hormones_signal(), 3 suggested_fix arms, tokio::join entry, signals Vec entry, test update (44 lines added)
- `src/lib/tauri/admin.ts` - Added 'hormones' to SignalClass union type
- `src/features/admin/DoctorPane.tsx` - Added hormones to DISPLAY_NAME Record and ROW_ORDER array

## Decisions Made

- Severity thresholds follow dual-axis logic: Red requires both cortisol AND norepinephrine elevated (>0.7), because single-hormone elevation is less clinically significant than concurrent stress response
- mortality_salience included in Amber threshold (>0.6) given its capped nature (0.8 max) and existential significance
- All 7 PhysiologicalState scalars exposed in the payload JSON for full diagnostic visibility in the DoctorPane

## Deviations from Plan

None - plan executed exactly as written. All 6 Rust edit steps and 3 frontend edit steps completed per plan specification.

## Issues Encountered

None. `cargo check` required ~5 min compile time (blocked on existing build lock) but completed cleanly.

## Known Stubs

None. The Hormones signal reads live data from `crate::homeostasis::get_physiology()` which reads from the `PHYSIOLOGY` OnceLock populated by homeostasis.rs at runtime.

## Next Phase Readiness

- HORM-08 (hormone state visible in DoctorPane) and HORM-09 (all 7 scalars in payload) are complete
- Plans 27-02 and 27-03 (hormone modulation in brain.rs and evolution.rs) are independent of this plan
- Plan 27-05 (close/verify) can now verify the full 8-signal DoctorPane surface

## Self-Check: PASSED

- doctor.rs: FOUND, contains Hormones variant, compute_hormones_signal, get_physiology call
- admin.ts: FOUND, contains 'hormones' in SignalClass union
- DoctorPane.tsx: FOUND, contains hormones in DISPLAY_NAME and ROW_ORDER
- Commit 8a0c245: FOUND (Task 1)
- Commit b0ab459: FOUND (Task 2)

---
*Phase: 27-hormone-physiology*
*Completed: 2026-05-02*
