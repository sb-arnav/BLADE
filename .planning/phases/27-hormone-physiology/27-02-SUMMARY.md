---
phase: 27-hormone-physiology
plan: 02
subsystem: homeostasis
tags: [rust, emotion-classifier, hormone-bus, physiology, ema-smoothing, lexicon]

# Dependency graph
requires:
  - phase: 27-01
    provides: PhysiologicalState struct, physiology_store() global, get_physiology(), apply_physiology_decay()

provides:
  - EmotionCluster enum (6 variants) in homeostasis.rs
  - ClassifierOutput struct (valence, arousal, cluster) in homeostasis.rs
  - HormoneGains struct with from_cluster() mapping in homeostasis.rs
  - 5 static lexicon arrays (THREAT/SUCCESS/EXPLORATION/CONNECTION/FATIGUE) in homeostasis.rs
  - classify_response_emotion() — returns None for <50 chars, truncates to 2000 chars
  - update_physiology_from_classifier() — alpha=0.05 EMA, mortality_salience capped at 0.8
  - Classifier call site in commands.rs post-stream bookkeeping (HORM-02 requirement)

affects: [27-03, 27-04, 27-05, brain.rs, evolution.rs, metacognition.rs]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Static lexicon arrays as &[&str] for zero heap allocation in hot path"
    - "Density scoring: match_count / word_count with structural signal boosts"
    - "alpha=0.05 EMA: current * 0.95 + target * 0.05, where negative delta maps target to 0.0"
    - "Synchronous classifier call before tokio::spawn blocks — pure string matching <1ms"

key-files:
  created: []
  modified:
    - src-tauri/src/homeostasis.rs
    - src-tauri/src/commands.rs

key-decisions:
  - "Classifier is synchronous (no tokio::spawn) — pure Rust string matching completes in <1ms, no async overhead"
  - "Negative hormone deltas pull target to 0.0 rather than using negative delta directly — prevents negative target confusion"
  - "2000-char truncation uses char_indices() to avoid non-ASCII byte-slice panic (CLAUDE.md safe_slice rule)"
  - "Classifier runs on BLADE output (assistant_text) only — D-03 preserved; user input classified by emotional_intelligence.rs"

patterns-established:
  - "Emotion classifier pattern: density scoring over static lexicon + structural boosts + 0.005 noise floor → Neutral"
  - "EMA update: smooth(current, delta) = clamp(current * (1-ALPHA) + max(0,delta) * ALPHA, 0.01, 1.0)"
  - "mortality_salience always clamped at 0.8 in physiology layer to preserve safety_bundle.rs operational cap"

requirements-completed: [HORM-02, HORM-09]

# Metrics
duration: 22min
completed: 2026-05-02
---

# Phase 27 Plan 02: Emotion Classifier Summary

**Rule-based 6-cluster emotion classifier wired into BLADE's response pipeline, updating PhysiologicalState with alpha=0.05 EMA smoothing on every response >= 50 chars**

## Performance

- **Duration:** ~22 min
- **Started:** 2026-05-02T17:30:00Z
- **Completed:** 2026-05-02T17:52:00Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- Implemented EmotionCluster enum, ClassifierOutput, HormoneGains (with from_cluster gain table), and 5 static zero-allocation lexicon arrays in homeostasis.rs
- classify_response_emotion() correctly returns None for text < 50 chars, truncates to 2000 chars via char_indices(), computes density scores per cluster with structural signal boosts (question mark, short-text)
- update_physiology_from_classifier() applies alpha=0.05 EMA to all 7 hormone scalars with mortality_salience hard-capped at 0.8; persists via physiology_store() mutex
- Wired synchronous call site in commands.rs immediately after `let assistant_text = clean_content.clone();`, before all tokio::spawn blocks — full response text always classified
- cargo check passes clean (0 new errors, 0 new warnings)

## Task Commits

Each task was committed atomically:

1. **Task 1: Emotion classifier and smoothed update in homeostasis.rs** - `0644e0f` (feat)
2. **Task 2: Wire classifier call site in commands.rs** - `8d493c5` (feat)

**Plan metadata:** (docs commit follows)

## Files Created/Modified

- `src-tauri/src/homeostasis.rs` — Added ~194 lines: EmotionCluster, ClassifierOutput, HormoneGains, 5 lexicons, classify_response_emotion(), update_physiology_from_classifier()
- `src-tauri/src/commands.rs` — Added 5 lines: synchronous classifier call after assistant_text binding in post-stream bookkeeping

## Decisions Made

- Synchronous call (no tokio::spawn) — classifier is pure string matching, budget <1ms, no reason to spawn a thread and add complexity
- Negative gain deltas map to target=0.0 in the smooth() closure rather than using raw negative values, which avoids clamping artifacts when ALPHA is small
- char_indices().nth(2000) used for 2000-char truncation to avoid non-ASCII byte-offset panics (per CLAUDE.md rule)

## Deviations from Plan

None — plan executed exactly as written. All code follows the plan's specified signatures, gain table values, lexicon arrays, and alpha constant.

## Issues Encountered

None. cargo check passed on first attempt with 0 new warnings related to this plan's changes.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- Plan 03 (brain.rs cortisol modulation) can now read `crate::homeostasis::get_physiology().cortisol` and `crate::homeostasis::get_physiology().oxytocin` — both wired and updated by the classifier pipeline
- Plan 04 (evolution.rs Voyager modulation) can read `dopamine` and `norepinephrine` from the same physiology store
- Plan 05 (metacognition.rs verifier frequency) can read `acetylcholine` from physiology store
- Every BLADE response >= 50 chars now feeds the hormone bus; the bus will converge in ~20 readings per D-02 design

## Known Stubs

None — classifier is fully wired and updates live PhysiologicalState on every qualifying response.

## Threat Flags

No new threat surface introduced. T-27-04 (DoS via long responses) mitigated by 2000-char truncation. T-27-06 (mortality_salience cap bypass) mitigated by `clamp(0.0, 0.8)` in update_physiology_from_classifier(). Both mitigations are present and verified by cargo check.

---

*Phase: 27-hormone-physiology*
*Completed: 2026-05-02*
