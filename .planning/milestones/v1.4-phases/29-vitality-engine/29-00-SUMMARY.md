---
phase: 29-vitality-engine
plan: 00
subsystem: testing
tags: [vitality, eval-harness, rust, onceLock, sdt, dormancy, wave-0]

requires:
  - phase: 28-active-inference-loop
    provides: "active_inference_eval pattern, evals/mod.rs registration convention"
  - phase: 26-safety-bundle
    provides: "safety_eval pattern, DORMANCY_STUB AtomicBool pattern"
provides:
  - "VitalityState, VitalityBand, SDTSignals, DrainSignals, VitalitySnapshot public types"
  - "get_vitality(), apply_drain(), enable_dormancy_stub(), vitality_tick() stub API"
  - "6 vitality eval fixture stubs (compilable, all fail -- Plan 05 fills logic)"
  - "verify-vitality.sh Gate 37 script"
affects: [29-01, 29-02, 29-03, 29-04, 29-05]

tech-stack:
  added: []
  patterns: ["Wave 0 test-first scaffolding -- types + eval stubs before implementation"]

key-files:
  created:
    - src-tauri/src/vitality_engine.rs
    - src-tauri/src/evals/vitality_eval.rs
    - scripts/verify-vitality.sh
  modified:
    - src-tauri/src/lib.rs
    - src-tauri/src/evals/mod.rs

key-decisions:
  - "Stubs return defaults (scalar 0.8, Thriving) -- Plan 01 fills real computation"
  - "Wave 0 test does NOT assert floor_passed -- Plan 05 upgrades to assert after fixture logic"
  - "Module declared in lib.rs but commands NOT wired into generate_handler -- Plan 01 Task 2 handles that"

patterns-established:
  - "VitalityFixture struct + to_row helper: same pattern as AinfFixture / HormoneFixture"
  - "enable_dormancy_stub() called in every fixture before any code that could reach dormancy path (T-29-W0-01 mitigation)"

requirements-completed: []

duration: 11min
completed: 2026-05-03
---

# Phase 29 Plan 00: Vitality Engine Wave 0 Scaffolding Summary

**Type skeleton with all public vitality types/stubs + 6 eval fixture stubs + Gate 37 verify script -- test-first foundation for Plans 01-05**

## Performance

- **Duration:** 11 min
- **Started:** 2026-05-03T08:50:03Z
- **Completed:** 2026-05-03T09:01:53Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- Created vitality_engine.rs (218 lines) with VitalityState, VitalityBand, SDTSignals, DrainSignals, VitalitySnapshot structs and all 9 public function stubs
- Created vitality_eval.rs (113 lines) with 6 named fixture stubs matching VITA-01 through VITA-04 requirements
- Created verify-vitality.sh (Gate 37) following verify-inference.sh template
- Scored table emits correctly with U+250C delimiter (EVAL-06 contract satisfied)

## Task Commits

Each task was committed atomically:

1. **Task 1: Create skeleton vitality_engine.rs with public types and stub API** - `d2616ac` (feat)
2. **Task 2: Create vitality_eval.rs fixture stubs, mod.rs registration, and verify-vitality.sh** - `7a4c5a9` (test)

## Files Created/Modified
- `src-tauri/src/vitality_engine.rs` - Skeleton module: VitalityState, VitalityBand, SDTSignals, DrainSignals, VitalitySnapshot structs; get_vitality(), apply_drain(), enable_dormancy_stub(), vitality_tick(), check_reincarnation(), set_vitality_for_test(), start_vitality_engine() stubs; 3 Tauri command stubs; initial_band_from_scalar() and compute_band() helpers
- `src-tauri/src/evals/vitality_eval.rs` - 6 fixture stubs: band degradation, SDT replenishment, drain, dormancy, reincarnation, hysteresis. All return (false, "STUB: not yet implemented")
- `scripts/verify-vitality.sh` - Gate 37 verification script (executable), checks cargo test exit + U+250C table presence
- `src-tauri/src/lib.rs` - Added `mod vitality_engine;` after `mod active_inference;`
- `src-tauri/src/evals/mod.rs` - Added `#[cfg(test)] mod vitality_eval;` after active_inference_eval

## Decisions Made
- Module declared in lib.rs immediately (not deferred) so eval stubs can reference `crate::vitality_engine::` -- required for compilation
- Tauri commands NOT wired into generate_handler! yet -- Plan 01 Task 2 handles that, avoiding premature command exposure
- Wave 0 test entry deliberately does NOT assert floor_passed -- stubs all fail, assertion added by Plan 05 after fixture logic is implemented
- Default vitality scalar is 0.8 (Thriving, slightly below max) per CONTEXT.md D-25 / Claude's discretion

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Wave 0 complete: all types compile, eval stubs print scored table, verify script exists
- Plans 01-05 can reference `cargo test --lib evals::vitality_eval` in their verify blocks
- Plan 01 will fill in real vitality_tick() computation and wire commands into generate_handler!
- Plan 05 will fill in fixture logic and upgrade test to assert floor_passed

---
*Phase: 29-vitality-engine*
*Completed: 2026-05-03*
