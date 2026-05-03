---
phase: 29-vitality-engine
plan: 01
subsystem: backend
tags: [vitality, sdt, dormancy, reincarnation, rust, sqlite, hysteresis, organism]

requires:
  - phase: 29-00
    provides: "Wave 0 skeleton with VitalityState, VitalityBand, SDTSignals, DrainSignals types and stub functions"
  - phase: 28-active-inference-loop
    provides: "get_active_inference_state() for prediction error drain signal"
  - phase: 27-hormone-physiology
    provides: "homeostasis hypothalamus_tick() integration point, PhysiologicalState for reincarnation reset"
  - phase: 26-safety-bundle
    provides: "safety_eval_drain() hook for eval failure drain"
  - phase: 23-verifiable-reward-ood-eval
    provides: "reward::read_reward_history() for competence SDT signal"
provides:
  - "Complete VitalityState lifecycle: SDT replenishment, drain computation, hysteretic band transitions"
  - "Dormancy sequence with DORMANCY_STUB guard (test-safe process exit)"
  - "Reincarnation path: detect dormancy_record, reset hormones, start at 0.3"
  - "SQLite persistence: vitality_state, vitality_history (FIFO 5000), dormancy_records tables"
  - "3 Tauri commands: vitality_get_state, vitality_get_history, vitality_force_dormancy"
  - "ActivityStrip emissions on band transitions, blade_vitality_update events"
  - "apply_drain() public API for external drain sources (safety_bundle.rs)"
affects: [29-02, 29-03, 29-04, 29-05]

tech-stack:
  added: []
  patterns: ["Inlined cosine_sim for tedium drain (embeddings.rs cosine_similarity is private)", "pending_eval_drain accumulator pattern for inter-tick drain", "Drain floor with consecutive_floor_ticks counter"]

key-files:
  created: []
  modified:
    - src-tauri/src/vitality_engine.rs
    - src-tauri/src/db.rs
    - src-tauri/src/lib.rs

key-decisions:
  - "brain_reactions polarity is INTEGER (>0 = positive), not TEXT -- adapted query from plan's polarity='positive' to polarity>0"
  - "embed_texts takes &[String] not &[&str] -- adapted tedium drain to build owned String vec"
  - "Drain scale 0.025 and replenishment scale 0.01 calibrated so 1.0->0.0 takes ~2+ hours with all drains active"
  - "Cached tedium embeddings in VitalityState with hash-based invalidation to avoid blocking hypothalamus_tick"

patterns-established:
  - "pending_eval_drain accumulator: external callers add to pending, consumed on next tick"
  - "consecutive_floor_ticks: drain floor enforcement requiring 3 ticks at 0.05 with zero replenishment before dormancy"
  - "Inlined cosine_sim helper: when upstream module function is private, inline identical implementation"

requirements-completed: [VITA-01, VITA-02, VITA-03, VITA-04, VITA-06]

duration: 8min
completed: 2026-05-03
---

# Phase 29 Plan 01: Vitality Engine Core Computation Summary

**SDT-driven vitality scalar with hysteretic 5-band transitions, drain floor, dormancy/reincarnation lifecycle, and SQLite persistence across 3 new tables**

## Performance

- **Duration:** 8 min
- **Started:** 2026-05-03T09:07:20Z
- **Completed:** 2026-05-03T09:15:12Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Filled Wave 0 skeleton with complete computation logic: SDT replenishment (competence from reward EMA, autonomy from decision_gate ratio, relatedness from message frequency + reactions + message length), 5 drain channels (failure, eval, isolation, prediction error, tedium via inlined cosine similarity)
- Implemented hysteretic band transitions with 0.05 buffer, drain floor requiring 3 consecutive floor ticks, NaN guards, and f32 clamping on all paths
- Dormancy sequence with DORMANCY_STUB guard (logs intent in test, process::exit(0) in production), reincarnation detection on startup with hormone reset and vitality=0.3 start
- Added 3 SQLite tables (vitality_state, vitality_history with FIFO prune to 5000, dormancy_records) and wired 3 Tauri commands + startup calls in lib.rs

## Task Commits

Each task was committed atomically:

1. **Task 1: Implement vitality_engine.rs -- structs, computation, persistence, dormancy, reincarnation** - `888dc38` (feat)
2. **Task 2: Add SQLite table migrations and complete lib.rs registration** - `c608961` (feat)

## Files Created/Modified
- `src-tauri/src/vitality_engine.rs` - Complete vitality engine: VitalityState lifecycle with SDT replenishment, drain computation, hysteretic band transitions, dormancy sequence, reincarnation path, SQLite persistence, event emissions, 3 Tauri commands (886 lines replacing 33-line skeleton)
- `src-tauri/src/db.rs` - Added vitality_state (single-row CHECK(id=1)), vitality_history (AUTOINCREMENT + FIFO), dormancy_records tables
- `src-tauri/src/lib.rs` - Wired vitality_get_state, vitality_get_history, vitality_force_dormancy into generate_handler; added start_vitality_engine + check_reincarnation startup calls

## Decisions Made
- **brain_reactions polarity type:** Plan/CONTEXT.md referenced `polarity = 'positive'` (string), but actual schema uses INTEGER (`polarity > 0` = thumbs up). Adapted relatedness query accordingly.
- **embed_texts signature:** Takes `&[String]` not `&[&str]`. Built owned String vec from safe_slice results for tedium drain computation.
- **Drain/replenishment scaling:** DRAIN_SCALE=0.025, REPLENISHMENT_SCALE=0.01. With all 5 drains active at maximum values, net drain per tick is ~0.01, meaning 1.0->0.0 takes ~100 ticks = ~100 minutes, satisfying the D-15 "2+ hours" constraint.
- **Tedium embedding caching:** Uses hash-based invalidation in VitalityState to avoid re-embedding unchanged messages, addressing RESEARCH Pitfall 3 (embedding blocking hypothalamus_tick).
- **Decision gate returns Vec not VecDeque:** `get_decision_log()` returns `Vec<DecisionRecord>`, adapted autonomy computation accordingly.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] brain_reactions polarity is INTEGER, not TEXT**
- **Found during:** Task 1 (relatedness computation)
- **Issue:** Plan specified `polarity = 'positive'` but db.rs schema has `polarity INTEGER NOT NULL` where >0 = thumbs up
- **Fix:** Changed query to `WHERE polarity > 0 AND created_at > ?1`
- **Files modified:** src-tauri/src/vitality_engine.rs
- **Committed in:** 888dc38

**2. [Rule 3 - Blocking] VitalityState needed additional fields not in skeleton**
- **Found during:** Task 1 (drain floor and tedium caching)
- **Issue:** Skeleton lacked `pending_eval_drain`, `consecutive_floor_ticks`, `last_tedium_hash`, `cached_tedium_embeddings` fields needed by computation logic
- **Fix:** Added 4 new fields with `#[serde(default)]` for backward compatibility
- **Files modified:** src-tauri/src/vitality_engine.rs
- **Committed in:** 888dc38

---

**Total deviations:** 2 auto-fixed (1 bug, 1 blocking)
**Impact on plan:** Both fixes necessary for correctness. No scope creep.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Plan 01 complete: all public APIs available for Plan 02 (behavioral integration into brain.rs, evolution.rs, dream_mode.rs, metacognition.rs, persona_engine.rs, safety_bundle.rs, homeostasis.rs)
- Plan 03 (DoctorPane signal) can read vitality state via get_vitality()
- Plan 04 (frontend indicator) can listen for blade_vitality_update events
- Plan 05 (eval suite) can exercise all vitality_engine public APIs with synthetic signals
- cargo check clean; 3 Tauri commands registered; startup calls wired

---
*Phase: 29-vitality-engine*
*Completed: 2026-05-03*
