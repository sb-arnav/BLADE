---
phase: 29-vitality-engine
plan: 03
subsystem: backend, ui
tags: [vitality, doctor, signal-class, diagnostics, typescript, rust]

requires:
  - phase: 29-01
    provides: "VitalityState, VitalityBand, get_vitality() public API for compute_vitality_signal()"
  - phase: 28-active-inference-loop
    provides: "ActiveInference SignalClass variant in doctor.rs (pattern template for Vitality)"
provides:
  - "SignalClass::Vitality in doctor.rs with compute function, suggested_fix arms, tokio::join integration"
  - "TypeScript SignalClass union extended with 'active_inference' and 'vitality'"
  - "DoctorPane DISPLAY_NAME, ROW_ORDER, and rowRefs for both active_inference and vitality"
affects: [29-04, 29-05]

tech-stack:
  added: []
  patterns: ["VitalityBand-to-Severity mapping in compute function (Thriving/Waning=Green, Declining=Amber, Critical/Dormant=Red)"]

key-files:
  created: []
  modified:
    - src-tauri/src/doctor.rs
    - src/lib/tauri/admin.ts
    - src/features/admin/DoctorPane.tsx

key-decisions:
  - "Thriving and Waning both map to Green severity (healthy bands), Declining to Amber, Critical and Dormant to Red"
  - "Fixed Phase 28 gap where active_inference was missing from TS union and DoctorPane alongside adding vitality"

patterns-established:
  - "DoctorPane signal class addition requires 5 sites: TS union, DISPLAY_NAME, ROW_ORDER, rowRefs, plus Rust enum/compute/fix/join/test"

requirements-completed: [VITA-05]

duration: 6min
completed: 2026-05-03
---

# Phase 29 Plan 03: DoctorPane Vitality Signal Row Summary

**10th DoctorPane signal class (Vitality) with VitalityBand-to-Severity mapping, plus Phase 28 active_inference TS gap fix**

## Performance

- **Duration:** 6 min
- **Started:** 2026-05-03T09:21:26Z
- **Completed:** 2026-05-03T09:27:40Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Added SignalClass::Vitality to all 5 atomic sites in doctor.rs: enum variant, suggested_fix match (3 severity arms), compute_vitality_signal() function, tokio::join! tuple + signals vec (now 10 entries), and exhaustiveness test (10x3 = 30)
- Extended TypeScript SignalClass union with both 'active_inference' (Phase 28 gap) and 'vitality' (Phase 29)
- Updated DoctorPane.tsx DISPLAY_NAME, ROW_ORDER, and rowRefs Record to include both new signal classes

## Task Commits

Each task was committed atomically:

1. **Task 1: Add SignalClass::Vitality to doctor.rs (5 atomic sites)** - `2dfc0ef` (feat)
2. **Task 2: Fix TypeScript SignalClass union and DoctorPane display** - `8a5cc46` (feat)

## Files Created/Modified
- `src-tauri/src/doctor.rs` - Added Vitality enum variant, 3 suggested_fix arms, compute_vitality_signal() mapping VitalityBand to Severity, extended tokio::join to 10 entries, updated exhaustiveness test to 30 pairs, added emit_activity_for_doctor Vitality arm
- `src/lib/tauri/admin.ts` - Extended SignalClass type union with 'active_inference' and 'vitality'
- `src/features/admin/DoctorPane.tsx` - Added DISPLAY_NAME, ROW_ORDER, and rowRefs entries for active_inference and vitality

## Decisions Made
- **Severity mapping:** Thriving and Waning both map to Green (healthy), Declining to Amber (warning), Critical and Dormant to Red (alert). This matches the behavioral band semantics from 29-CONTEXT.md D-06 through D-10.
- **Phase 28 gap fix:** active_inference was present in Rust doctor.rs but missing from TypeScript SignalClass union and DoctorPane. Fixed alongside vitality addition rather than as a separate plan.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Missing Vitality arm in emit_activity_for_doctor match**
- **Found during:** Task 1 (cargo check)
- **Issue:** The plan identified 4 atomic sites but missed a 5th: the `emit_activity_for_doctor` function at line 946 has a `match signal.class` that was non-exhaustive after adding the Vitality variant
- **Fix:** Added `SignalClass::Vitality => "Vitality"` arm to the match
- **Files modified:** src-tauri/src/doctor.rs
- **Verification:** cargo check passes
- **Committed in:** 2dfc0ef (Task 1 commit)

**2. [Rule 3 - Blocking] Missing active_inference and vitality in DoctorPane rowRefs Record**
- **Found during:** Task 2 (pre-emptive check)
- **Issue:** The plan did not mention the rowRefs Record<SignalClass, ...> at line 132 which must be exhaustive
- **Fix:** Added active_inference and vitality entries to the rowRefs useMemo map
- **Files modified:** src/features/admin/DoctorPane.tsx
- **Verification:** npx tsc --noEmit passes
- **Committed in:** 8a5cc46 (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (2 blocking)
**Impact on plan:** Both fixes necessary for compilation. No scope creep.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Plan 03 complete: DoctorPane shows 10 signal rows including Vitality
- Plan 04 (frontend vitality indicator) can now display vitality status from DoctorPane data
- Plan 05 (eval suite) can verify DoctorPane signal generation via compute_vitality_signal()
- Both cargo check and tsc --noEmit clean

## Self-Check: PASSED

All 4 files verified present. Both commit hashes (2dfc0ef, 8a5cc46) found in git log.

---
*Phase: 29-vitality-engine*
*Completed: 2026-05-03*
