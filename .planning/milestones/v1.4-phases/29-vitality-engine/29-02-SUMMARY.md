---
phase: 29-vitality-engine
plan: 02
subsystem: backend
tags: [vitality, integration, behavioral-bands, wiring, modulation, rust]

requires:
  - phase: 29-01
    provides: "VitalityState, VitalityBand, get_vitality(), vitality_tick(), apply_drain() public APIs"
provides:
  - "Vitality tick driven by hypothalamus 60s cycle (homeostasis.rs)"
  - "Real eval failure drain via safety_bundle.rs apply_drain"
  - "Band-specific personality modulation in brain.rs system prompt"
  - "Persona trait dampening in Waning band"
  - "Evolution exploration gated at vitality < 0.4"
  - "Dream session skipped at vitality < 0.2, skill tasks skipped at < 0.4"
  - "Metacognition heightened sensitivity in Critical band"
  - "Proactive engine halved in Waning, disabled in Declining"
  - "Screen timeline capture disabled in Critical band"
  - "Integration bridge polling doubled in Critical band"
affects: [29-03, 29-04, 29-05]

tech-stack:
  added: []
  patterns: ["Vitality gate pattern: read get_vitality() then early-return/continue based on scalar thresholds", "Extra-sleep frequency halving for loop-based subsystems"]

key-files:
  created: []
  modified:
    - src-tauri/src/homeostasis.rs
    - src-tauri/src/safety_bundle.rs
    - src-tauri/src/proactive_engine.rs
    - src-tauri/src/screen_timeline.rs
    - src-tauri/src/integration_bridge.rs
    - src-tauri/src/brain.rs
    - src-tauri/src/persona_engine.rs
    - src-tauri/src/evolution.rs
    - src-tauri/src/dream_mode.rs
    - src-tauri/src/metacognition.rs

key-decisions:
  - "Proactive engine Waning halving uses extra sleep(300) to double effective interval from 5 to 10 minutes"
  - "Screen timeline Critical guard placed before capture_timeline_tick, after heartbeat (heartbeat continues even when capture skipped)"
  - "Integration bridge Critical guard adds extra sleep(15) after run_due_polls to double effective tick"
  - "Persona confidence threshold formula: 0.3 / vitality_scalar in Waning band, capped at 1.0, with max(0.01) div-by-zero guard"
  - "Vitality Critical band check takes priority over ACh modulation in metacognition verify_threshold ladder"

patterns-established:
  - "Vitality gate: crate::vitality_engine::get_vitality() + scalar threshold check + early return/continue"
  - "Band-specific system prompt injection via match on VitalityBand enum with wildcard default"

requirements-completed: [VITA-01, VITA-02, VITA-03, VITA-04]

duration: 9min
completed: 2026-05-03
---

# Phase 29 Plan 02: Behavioral Integration -- 10-Module Vitality Wiring Summary

**Wired vitality engine into 10 existing modules to produce real behavioral differences across 5 bands: personality modulation, exploration gating, dream/skill suppression, proactive throttling, metacognition heightening, and background system conservation**

## Performance

- **Duration:** 9 min
- **Started:** 2026-05-03T09:22:02Z
- **Completed:** 2026-05-03T09:30:48Z
- **Tasks:** 2/2
- **Files modified:** 10

## Accomplishments

- Wired vitality_tick() into hypothalamus_tick() so vitality computation runs on the existing 60s cycle (D-03)
- Connected safety_eval_drain() to real vitality drain of -0.02 per eval failure, completing the SAFE-04 negative feedback loop (D-14)
- Added vitality band gating to proactive_engine: halved frequency in Waning (extra 5-min sleep), disabled entirely in Declining (D-07/D-08)
- Disabled screen_timeline capture loop in Critical band, conserving resources while maintaining heartbeat (D-09)
- Doubled integration_bridge polling interval in Critical band via extra 15s sleep (D-09)
- Injected band-specific personality modulation into brain.rs system prompt: Waning/Declining/Critical each get distinct first-person notes, plus reincarnation context on first post-dormancy prompt (D-07/D-08/D-09/D-18)
- Implemented vitality-scaled confidence threshold in persona_engine: Waning band raises threshold (0.3/scalar), muting lower-confidence traits (D-07)
- Gated evolution exploration at vitality < 0.4, preventing capability acquisition in Declining/Critical bands (D-08)
- Added blanket dream session guard at vitality < 0.2 (D-19) plus selective skill task guards (synthesis, prune, consolidate, from-trace) at < 0.4 (D-08)
- Lowered metacognition confidence-delta threshold from 0.3 to 0.15 in Critical band, heightening uncertainty flagging (D-09)

## Task Commits

Each task was committed atomically:

1. **Task 1: Wire hypothalamus_tick, safety_eval_drain, and Critical-band background system guards** - `add9b67` (feat)
2. **Task 2: Wire brain.rs, persona_engine.rs, evolution.rs, dream_mode.rs, metacognition.rs behavioral modulation** - `cea260a` (feat)

## Files Modified

- `src-tauri/src/homeostasis.rs` - Added vitality_tick() call at end of hypothalamus_tick() (+2 lines)
- `src-tauri/src/safety_bundle.rs` - Added apply_drain(0.02, "eval_failure") in safety_eval_drain() (+2 lines)
- `src-tauri/src/proactive_engine.rs` - Added Declining disable + Waning frequency halving after energy_mode guard (+10 lines)
- `src-tauri/src/screen_timeline.rs` - Added Critical band capture skip with sleep+continue after heartbeat (+7 lines)
- `src-tauri/src/integration_bridge.rs` - Added Critical band extra sleep to double polling interval (+6 lines)
- `src-tauri/src/brain.rs` - Added VitalityBand match for personality modulation notes + reincarnation context injection (+18 lines)
- `src-tauri/src/persona_engine.rs` - Replaced hardcoded 0.3 threshold with vitality-scaled confidence_threshold (+7 lines)
- `src-tauri/src/evolution.rs` - Added vitality < 0.4 guard after GH check (+6 lines)
- `src-tauri/src/dream_mode.rs` - Added session guard (< 0.2) + 4 skill task guards (< 0.4) (+34 lines)
- `src-tauri/src/metacognition.rs` - Extended verify_threshold ladder with vitality Critical band check (+5 lines)

## Decisions Made

- **Proactive frequency halving:** Used extra sleep(300) rather than variable interval tracking. Simplest correct approach given the existing fixed-sleep loop structure.
- **Screen timeline heartbeat preservation:** Vitality guard placed after heartbeat but before capture_timeline_tick, so the supervisor still sees the process as alive even when capture is skipped.
- **Metacognition threshold priority:** Vitality Critical check placed before ACh modulation because Critical band (organism-level deterioration) is a stronger signal than acetylcholine (attention-level modulation).
- **Persona threshold formula:** Uses 0.3 / scalar with max(0.01) guard, following the plan exactly. At vitality 0.5 (mid-Waning), threshold becomes 0.6, meaning only high-confidence traits surface.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Known Stubs

None - all integrations are real behavioral gates, not placeholders.

## Next Phase Readiness

- Plan 02 complete: all 10 behavioral integration points wired
- Vitality bands now produce observable behavioral differences without code inspection (VITA-01 satisfied)
- Plan 03 (DoctorPane signal) can read band state for monitoring display
- Plan 04 (frontend indicator) can observe behavioral changes in real-time
- Plan 05 (eval suite) can verify band transitions produce expected behavioral gating
- cargo check clean (warnings only, no errors)

## Self-Check: PASSED

- All 10 modified files verified present on disk
- Commit add9b67 (Task 1) verified in git log
- Commit cea260a (Task 2) verified in git log
- SUMMARY.md created at .planning/phases/29-vitality-engine/29-02-SUMMARY.md
- cargo check passed with 0 errors, 3 warnings (all pre-existing)
- All 10 files contain vitality_engine references (verified via grep -c)

---
*Phase: 29-vitality-engine*
*Completed: 2026-05-03*
