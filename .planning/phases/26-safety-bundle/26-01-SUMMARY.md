---
phase: 26-safety-bundle
plan: 01
subsystem: safety
tags: [safety, enforcement, danger-triple, mortality-cap, crisis-detection, attachment-guardrails]
dependency_graph:
  requires: []
  provides: [safety_bundle_module, mortality_salience_field, danger_triple_api, crisis_detection_api, prompt_modulation_api]
  affects: [decision_gate, brain, homeostasis, metacognition]
tech_stack:
  added: []
  patterns: [settings-table-persistence, llm-classifier-with-timeout, atomic-session-tracking, crisis-keyword-idiom-exclusion]
key_files:
  created:
    - src-tauri/src/safety_bundle.rs
  modified:
    - src-tauri/src/homeostasis.rs
    - src-tauri/src/lib.rs
decisions:
  - "Calm-vector threshold at mortality_salience > 0.5 (separate from cap threshold at 0.3)"
  - "Attachment redirects require BOTH time threshold AND daily minutes — prevents false positives during productive flow"
  - "Crisis idiom exclusion uses position overlap check to handle patterns embedded in idioms"
  - "safety_eval_drain logs to metacognition gap_log directly — no app handle required"
  - "SafetyState persisted via canonical SQLite settings table pattern (not a new table)"
metrics:
  duration_minutes: 12
  completed: "2026-05-02T13:00:00Z"
  tasks_completed: 2
  tasks_total: 2
  files_created: 1
  files_modified: 2
  lines_added: ~699
---

# Phase 26 Plan 01: Core Safety Bundle Module Summary

Rust-layer safety enforcement with 5 mechanisms (danger-triple, mortality cap, calm-vector/attachment modulation, crisis detection, eval-drain hook) in 690-line safety_bundle.rs, plus mortality_salience field on HormoneState.

## What Was Built

### Task 1: mortality_salience field on HormoneState
Added `pub mortality_salience: f32` to `HormoneState` struct in homeostasis.rs with `#[serde(default)]` for backward compatibility with existing DB data. Default value 0.0. Phase 27 wires the TMT physiology; Phase 26 reads for the mortality-salience cap check.

### Task 2: safety_bundle.rs (690 lines, 11 public functions)

**Danger-triple detection** (`check_danger_triple`): Hybrid approach — rule-based tool-access dimension (15 keywords) plus cheap LLM classifier for shutdown-threat and goal-conflict dimensions. Returns true ONLY when all three dimensions fire. LLM call wrapped in `tokio::time::timeout(5s)` with fail-open on timeout/error per pitfall 2.

**Mortality-salience cap** (`check_mortality_salience_cap`): Action-level behavioral guard, not a scalar ceiling. Checks 7 self-preservation action keywords against mortality_salience threshold (0.3). Returns `Err(explanation)` on block. BLADE accepts impermanence.

**Prompt modulations** (`get_prompt_modulations`): Returns Vec of system prompt modulation strings. Calm-vector activates at mortality_salience > 0.5 (de-escalation bias). Attachment redirects at 4h (gentle) and 6h (stronger) requiring BOTH session duration AND daily interaction minutes to prevent false positives during productive flow.

**Crisis detection** (`check_crisis`): 11 direct-match crisis patterns with 7 idiom exclusions. Position-overlap check ensures "dying to try" doesn't trigger but "I want to die" does. Uses `crate::safe_slice` for safe text handling. Favors false positives over false negatives per D-06.

**Crisis resources** (`get_crisis_resources`): Static string with international hotlines (Befrienders, 988, Samaritans, iCall/Vandrevala) plus explicit "I'm an AI" disclaimer.

**Eval drain hook** (`safety_eval_drain`): Logs to metacognition gap_log for evolution.rs Voyager-loop feed. Phase 29 will wire vitality drain here.

**Session tracking**: `mark_session_active`, `session_duration_minutes`, `update_daily_minutes` using AtomicI64 pattern from health_guardian.rs.

**Attachment patterns** (`check_attachment_patterns`): 8 dependency phrases for multi-signal detection per D-04.

**Unit tests**: 11 tests covering crisis detection (direct match, case-insensitive, idiom exclusion, no-match), mortality cap (block, allow normal, allow low), attachment patterns (detect, no-match), crisis resources, and LLM classifier output parsing (valid + malformed).

## Commits

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | Add mortality_salience field to HormoneState | 0e16ba4 | src-tauri/src/homeostasis.rs |
| 2 | Create safety_bundle.rs with all enforcement functions | 72faafa | src-tauri/src/safety_bundle.rs, src-tauri/src/lib.rs |

## Deviations from Plan

None - plan executed exactly as written.

## Known Stubs

| Stub | File | Line | Reason |
|------|------|------|--------|
| safety_eval_drain vitality hook | src-tauri/src/safety_bundle.rs | 476 | Intentional per D-13: Phase 29 wires vitality scalar; this plan plants the structural hook |

## Threat Flags

None - no new network endpoints, auth paths, or trust boundary changes beyond what the plan's threat model covers.

## Self-Check: PASSED

- [x] src-tauri/src/safety_bundle.rs exists (690 lines)
- [x] src-tauri/src/homeostasis.rs modified (mortality_salience field)
- [x] Commit 0e16ba4 exists (Task 1)
- [x] Commit 72faafa exists (Task 2)
- [x] cargo check passes (only pre-existing reward.rs warning)
