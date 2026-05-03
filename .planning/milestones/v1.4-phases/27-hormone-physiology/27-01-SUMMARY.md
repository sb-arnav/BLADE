---
phase: 27-hormone-physiology
plan: 01
subsystem: homeostasis
tags: [rust, hormone, physiology, sqlite, tauri, decay, neuromodulator]

# Dependency graph
requires:
  - phase: 26-safety-bundle
    provides: safety_bundle.rs mortality_salience cap semantics preserved via pass-through

provides:
  - PhysiologicalState struct with 7 biologically-named f32 scalars and OnceLock global
  - apply_physiology_decay() with per-hormone exponential half-lives and 0.01 floor
  - SQLite persistence via settings key 'physiology'
  - Pituitary blend functions reading both operational (0.7) and physiological (0.3) layers
  - ActivityStrip threshold emission for cortisol/norepinephrine/mortality_salience
  - homeostasis_get_physiology Tauri command for frontend diagnostic access

affects:
  - 27-02 (emotion classifier writes PhysiologicalState scalars)
  - 27-03 (brain.rs behavioral modulation reads cortisol/oxytocin)
  - 27-04 (DoctorPane reads PhysiologicalState via homeostasis_get_physiology)
  - 27-05 (organism evals assert on PhysiologicalState values)
  - 28-active-inference (hormone bus receives prediction error updates)
  - 29-vitality (vitality modulates cortisol/dopamine levels)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "OnceLock<Mutex<T>> singleton with get_or_init for global state (mirrors HORMONES pattern)"
    - "Exponential decay: 0.5.powf(elapsed / half_life) with per-scalar half-life constants"
    - "Physiological blend: operational * 0.7 + physio_scalar * 0.3 in pituitary functions"
    - "SQLite settings table upsert for lightweight struct persistence"

key-files:
  created: []
  modified:
    - src-tauri/src/homeostasis.rs
    - src-tauri/src/lib.rs

key-decisions:
  - "Two completely separate structs (HormoneState / PhysiologicalState) per D-01 — zero cross-contamination"
  - "mortality_salience pass-through in hypothalamus_tick ensures safety_bundle.rs cap semantics are always current"
  - "Physiological decay runs inside hypothalamus_tick (every 60s) — no separate loop needed"
  - "0.01 floor on decay so hormones never fully zero out between classifier updates"
  - "Threshold emission only for cortisol/NE/mortality_salience per HORM-09 — not all 7 scalars"

patterns-established:
  - "Physiology read pattern: let p = get_physiology(); — used in all 5 pituitary functions"
  - "Pituitary blend formula: let blended = operational * 0.7 + p.scalar * 0.3;"
  - "Threshold guard pattern: if p.cortisol > 0.6 { emit_hormone_threshold(...) }"

requirements-completed: [HORM-01, HORM-08, HORM-09]

# Metrics
duration: 45min
completed: 2026-05-02
---

# Phase 27 Plan 01: PhysiologicalState Foundation Summary

**PhysiologicalState parallel hormone layer — 7 biologically-named scalars with individual exponential decay constants, SQLite persistence, and 0.7/0.3 pituitary blending into all 5 operational functions**

## Performance

- **Duration:** ~45 min
- **Started:** 2026-05-02T00:00:00Z
- **Completed:** 2026-05-02
- **Tasks:** 1
- **Files modified:** 2

## Accomplishments

- Added `PhysiologicalState` struct (7 f32 scalars: cortisol, dopamine, serotonin, acetylcholine, norepinephrine, oxytocin, mortality_salience) with individual half-lives ranging from 5 min (acetylcholine/norepinephrine) to 60 min (mortality_salience)
- OnceLock global `PHYSIOLOGY` with `physiology_store()` and `get_physiology()` public API — mirrors the existing `HORMONES` pattern exactly, zero interface friction for callers
- `apply_physiology_decay()` with per-hormone exponential decay (0.5.powf(elapsed/half_life)), clamped to 0.01 floor so hormones never fully zero out between classifier updates
- SQLite persistence: `load_physiology_from_db()` / `persist_physiology_to_db()` using settings key `'physiology'` — survives process restart
- `hypothalamus_tick()` integration: decay runs every 60s, persistence after each decay, and `mortality_salience` is passed through to the operational HormoneState so safety_bundle.rs cap semantics remain intact
- All 5 pituitary functions (acth, oxytocin, growth_hormone, thyroid_stimulating, adh) now blend `operational * 0.7 + physio_scalar * 0.3` — physiology influences behavior without overriding it
- `emit_hormone_threshold()` helper emitting to ActivityStrip `blade_activity_log` events; threshold detection in `start_hypothalamus()` loop for cortisol/NE/mortality_salience > 0.6
- `homeostasis_get_physiology` Tauri command registered in lib.rs — read-only frontend access for DoctorPane and diagnostics

## Task Commits

1. **Task 1: PhysiologicalState struct, global, decay, persistence, pituitary blend, threshold emission** - `c28a634` (feat)

**Plan metadata:** (created below)

## Files Created/Modified

- `src-tauri/src/homeostasis.rs` — Added ~205 lines: PhysiologicalState struct, OnceLock global, decay function, persistence functions, emit_hormone_threshold helper, hypothalamus_tick integration, pituitary blend updates, Tauri command
- `src-tauri/src/lib.rs` — Registered `homeostasis::homeostasis_get_physiology` in generate_handler![]

## Decisions Made

- Kept `PhysiologicalState` as a completely separate struct from `HormoneState` per D-01 — no shared fields, no shared global, no shared persistence key. The two layers communicate only through the mortality_salience pass-through in `hypothalamus_tick` and the pituitary blend coefficients.
- Chose 0.01 floor (not 0.0) in decay so downstream plans can reliably distinguish "no update" from "low but present" hormone level.
- Placed decay inside `hypothalamus_tick` rather than a separate loop — avoids a second 60s timer and ensures ordering: decay → persist → mortality pass-through → operational persist.

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

None. `cargo check` exited 0 on first run with one pre-existing warning in `reward.rs` (unrelated to this plan).

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- `PhysiologicalState` global is live and accessible via `get_physiology()` — Plan 27-02 (emotion classifier) can write to it immediately by locking `physiology_store()`
- `homeostasis_get_physiology` Tauri command is registered — Plan 27-04 (DoctorPane) can invoke it without any further Rust changes
- All 5 pituitary functions now read physiology — behavioral modulation plans (27-03) will see physiological influence as soon as the classifier starts updating scalars
- No blockers for any downstream plan in Phase 27

---

## Self-Check

**Files exist:**
- `src-tauri/src/homeostasis.rs` — FOUND (modified, 1070+ lines)
- `src-tauri/src/lib.rs` — FOUND (modified, homeostasis_get_physiology registered at line 1391)

**Commits exist:**
- `c28a634` — FOUND (feat(27-01): add PhysiologicalState foundation layer to homeostasis.rs)

## Self-Check: PASSED

*Phase: 27-hormone-physiology*
*Completed: 2026-05-02*
