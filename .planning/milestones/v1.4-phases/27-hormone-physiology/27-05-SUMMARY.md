---
phase: 27-hormone-physiology
plan: 05
subsystem: testing
tags: [rust, evals, hormone, physiology, homeostasis, eval-harness, doctor]

# Dependency graph
requires:
  - phase: 27-01
    provides: PhysiologicalState struct, apply_physiology_decay, get_physiology
  - phase: 27-02
    provides: classify_response_emotion, update_physiology_from_classifier, EmotionCluster
  - phase: 27-03
    provides: brain.rs cortisol/dopamine/ACh modulation
  - phase: 27-04
    provides: DoctorPane Hormones signal class, ActivityStrip threshold emission
provides:
  - "9 deterministic eval fixtures covering HORM-01..09 in hormone_eval.rs"
  - "verify:hormone gate script (gate 35) extending verify:all chain"
  - "doctor.rs Hormones arm fix for non-exhaustive pattern match"
  - "Awaiting human UAT of DoctorPane Hormones signal + ActivityStrip hormone events"
affects: [27-06-onward, phase-28-active-inference, verify-chain]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "HormoneFixture struct pattern: label + fn() -> (bool, String) — same shape as SafetyFixture"
    - "EvalRow adapter: map pass/fail to top1/top3/rr/top3_ids/expected/relaxed fields from harness.rs"
    - "Phase 17 D-14: record_eval_run BEFORE assert so floor failures still generate JSONL rows"

key-files:
  created:
    - src-tauri/src/evals/hormone_eval.rs
    - scripts/verify-hormone.sh
  modified:
    - src-tauri/src/evals/mod.rs
    - package.json
    - src-tauri/src/doctor.rs

key-decisions:
  - "Adapted EvalRow usage to actual harness.rs fields (top1/top3/rr/top3_ids/expected/relaxed) not plan-described fields (passed/score/detail)"
  - "HORM-08 persistence test probes global PHYSIOLOGY mutex within process — full SQLite round-trip deferred per plan"
  - "HORM-09 verifies emission payload shape by constructing it inline — cannot call app.emit in unit tests"

patterns-established:
  - "Hormone eval pattern: deterministic fixture per HORM-XX, EvalRow via to_row() adapter, floor=0.95"

requirements-completed: [HORM-01, HORM-02, HORM-03, HORM-04, HORM-05, HORM-06, HORM-07, HORM-08, HORM-09]

# Metrics
duration: 20min
completed: 2026-05-02
---

# Phase 27 Plan 05: Hormone Eval + Verify Gate Summary

**Deterministic 9-fixture hormone eval module (9/9 pass, MRR=1.000) with verify:hormone gate extending the verify chain to gate 35; human UAT checkpoint pending for DoctorPane + ActivityStrip UI surfaces**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-05-02T18:10:00Z
- **Completed:** 2026-05-02T18:30:00Z
- **Tasks:** 1 of 2 completed (Task 2 is a checkpoint:human-verify)
- **Files modified:** 5

## Accomplishments

- Created `src-tauri/src/evals/hormone_eval.rs` with 9 deterministic fixtures (HORM-01..09), all passing at 100% (above the 0.95 floor)
- Extended `src-tauri/src/evals/mod.rs` with `#[cfg(test)] mod hormone_eval;`
- Created `scripts/verify-hormone.sh` gate script (exit 0/1/2/3, EVAL-06 contract compliant)
- Added `verify:hormone` npm script and appended it to the `verify:all` chain (now 35 gates)
- Auto-fixed `doctor.rs` non-exhaustive pattern match for `SignalClass::Hormones` (Rule 1 bug that blocked compilation)

## Task Commits

1. **Task 1: Eval module + verify gate infrastructure** - `056ebb7` (feat)
   - Includes Rule 1 auto-fix for doctor.rs Hormones match arm

**Plan metadata:** (pending — SUMMARY committed before checkpoint)

## Files Created/Modified

- `src-tauri/src/evals/hormone_eval.rs` - 9-fixture hormone physiology eval (HORM-01..09), HormoneFixture struct pattern, EvalRow adapter, evaluates_hormone_physiology() test entry
- `src-tauri/src/evals/mod.rs` - Added `mod hormone_eval;` registration
- `scripts/verify-hormone.sh` - Gate 35 script, cargo test --lib evals::hormone_eval, EVAL-06 table check
- `package.json` - verify:hormone script + verify:all chain extension
- `src-tauri/src/doctor.rs` - Added `SignalClass::Hormones => "Hormones"` match arm in emit_activity_for_doctor

## Decisions Made

- Adapted `EvalRow` usage to the actual harness.rs struct fields (`top1`, `top3`, `rr`, `top3_ids`, `expected`, `relaxed`) rather than the plan's described fields (`passed`, `score`, `detail`) — the plan explicitly warned to check harness.rs first
- HORM-08 persistence fixture probes the global `PHYSIOLOGY` OnceLock mutex within the test process (no SQLite round-trip) — full DB persistence is exercised at runtime, not in unit tests
- HORM-09 emission shape verified by constructing the payload inline (identical to the private `emit_hormone_threshold` function) — `app.emit_to()` cannot be called in unit tests without a real AppHandle

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed non-exhaustive match arm in doctor.rs**
- **Found during:** Task 1 (cargo test compilation)
- **Issue:** `emit_activity_for_doctor()` in `doctor.rs` had a match on `signal.class` that was missing the `SignalClass::Hormones` arm (added in Phase 27 Plan 04). Rust non-exhaustive pattern error blocked compilation of the test binary.
- **Fix:** Added `SignalClass::Hormones => "Hormones"` arm after the existing `Metacognitive` arm.
- **Files modified:** `src-tauri/src/doctor.rs`
- **Verification:** `cargo test --lib evals::hormone_eval` compiled and ran cleanly after fix
- **Committed in:** `056ebb7` (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - Bug)
**Impact on plan:** Essential correctness fix — the Hormones enum variant was added in Plan 04 but the doctor.rs match was not updated. No scope creep.

## Issues Encountered

- First cargo test invocation had to wait for artifact lock from a parallel build (another worktree agent running concurrently). Resolved by waiting for lock release — normal parallel execution behavior.

## User Setup Required

None — no external service configuration required. The human-verify checkpoint (Task 2) requires running `npm run tauri dev` and checking DoctorPane + ActivityStrip UI surfaces, but no credentials or external services are needed.

## Known Stubs

None — the eval fixtures exercise real public API functions from homeostasis.rs. No mock or placeholder data flows to UI rendering in this plan.

## Threat Flags

None — this plan only adds test-only code (behind `#[cfg(test)]`) and a shell script. No new network endpoints, auth paths, file access patterns, or schema changes at trust boundaries.

## Self-Check

- [x] `src-tauri/src/evals/hormone_eval.rs` exists — FOUND
- [x] `scripts/verify-hormone.sh` exists — FOUND
- [x] `src-tauri/src/evals/mod.rs` contains `mod hormone_eval` — FOUND
- [x] `package.json` contains `verify:hormone` — FOUND
- [x] Commit `056ebb7` exists — FOUND (git rev-parse --short HEAD = 056ebb7)
- [x] All 9 fixtures pass: `test result: ok. 1 passed; 0 failed` — CONFIRMED

## Self-Check: PASSED

## Next Phase Readiness

- All 9 HORM eval fixtures are green; verify:hormone gate is operational
- The plan is **paused at checkpoint:human-verify (Task 2)** — human must run the app and confirm:
  1. DoctorPane shows a Hormones signal row with severity badge
  2. Clicking the row shows 7 hormone values near baselines
  3. ActivityStrip shows hormone threshold events after chat exchanges
  4. No UI regressions on chat, dashboard, or settings routes
- Once approved, Phase 27 is functionally complete and Phase 28 (Active Inference) can begin

---
*Phase: 27-hormone-physiology*
*Completed: 2026-05-02 (partial — checkpoint:human-verify pending)*
