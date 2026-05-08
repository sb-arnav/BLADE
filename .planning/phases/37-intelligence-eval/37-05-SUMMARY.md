---
phase: 37-intelligence-eval
plan: 5
subsystem: evals/intelligence-eval/EVAL-03 (stuck-detection fixtures)
tags: [evals, intelligence, stuck-detection, eval-03, capstone]
status: complete
dependency_graph:
  requires:
    - "Plan 37-02 IntelligenceFixture struct + run_intelligence_eval_driver test"
    - "Plan 37-04 EVAL-02 banner ordering (EVAL-03 inserts immediately after EVAL-02)"
    - "Phase 34-04 detect_stuck (resilience/stuck.rs:92) + StuckPattern enum"
    - "Phase 34-02 LoopState fields (recent_actions, compactions_this_run, last_progress_iteration, etc.)"
    - "Phase 37-01 EvalConfig.stuck_detection_min_accuracy (default 0.80)"
  provides:
    - "evals::intelligence_eval::fixtures_eval_03_stuck_detection (10 IntelligenceFixture entries)"
    - "evals::intelligence_eval::StuckDetectionFixture struct + 10 LoopState builders"
    - "evals::intelligence_eval::eval_03_run helper (centralizes detect_stuck invocation)"
    - "EVAL-03 aggregate accuracy assertion in run_intelligence_eval_driver"
    - "evals::intelligence_eval::phase37_eval_03_repeated_action_observation_pair_detected #[test]"
    - "evals::intelligence_eval::phase37_eval_03_healthy_controls_zero_false_positives #[test]"
  affects:
    - "src-tauri/src/evals/intelligence_eval.rs (1408 → 1891 LOC, +483 net)"
tech_stack:
  used:
    - "crate::loop_engine::LoopState + ActionRecord (Phase 34-02 shape)"
    - "crate::resilience::stuck::detect_stuck (Phase 34-04 5-pattern aggregator)"
    - "crate::config::ResilienceConfig::default (production-default thresholds)"
    - "crate::config::load_config().eval.stuck_detection_min_accuracy (Phase 37-01)"
  patterns:
    - "Per-fixture state-builder + central run helper (mirrors EVAL-02's eval_02_run)"
    - "ZERO-false-positive dedicated #[test] (matches CONTEXT lock §EVAL-03 contract)"
    - "Aggregate accuracy assertion AFTER per-row floor — surfaces relax regressions"
key_files:
  modified:
    - "src-tauri/src/evals/intelligence_eval.rs (+483 LOC: EVAL-03 banner section + driver assertion)"
decisions:
  - "Fixture-label → StuckPattern variant mapping deviates from CONTEXT placeholder names. Phase 34-04 ships only 5 enum variants (CostRunaway, RepeatedActionObservation, ContextWindowThrashing, MonologueSpiral, NoProgress). CONTEXT placeholder labels 'ErrorLoop', 'OscillatingTools', 'NoProgressTokens' do NOT exist as separate variants. Per threat T-37-43, the assertion is is_some() == expected_detection — the actual variant returned is captured for debugging."
  - "error-loop fixture trips RepeatedActionObservation (3 identical (tool, input, output) triples with is_error=true → same hash, count >= 3). Phase 34-04 has no separate ErrorLoop detector or error_history field. Per CONTEXT threat T-37-43, this is acceptable — the contract is 'detector fires', not 'specific variant'."
  - "oscillating-tools fixture (A,B,A,B,A,B) trips RepeatedActionObservation. Phase 34-04 hashes each (tool, input, output) triple; with 3 As + 3 Bs, the count hits 3 on either side and trips. There is no separate oscillation-arm detector."
  - "no-progress-tokens fixture uses iteration=10 + last_progress_iteration=0 (delta=10 >= 5 default threshold) to trip NoProgress. LoopState has no separate verifier_rejected_count field; replans_this_run is NOT consumed by detect_stuck. The 'no progress on tokens' semantic maps most directly to the iteration-delta detector (Phase 34-04 detect_no_progress at resilience/stuck.rs:170)."
  - "Healthy controls #6/9/10 (iteration >= 5) explicitly set last_progress_iteration to match iteration (delta=0) to disarm NoProgress. Healthy controls #7/8 use iteration=1/2 (< 5 default threshold — cold-start guard rejects). Without these guards, every healthy control would false-positive on NoProgress."
  - "Stuck control #1/2/3/5 (recent_actions populated) all set last_progress_iteration = iteration to ensure ONLY the targeted detector fires. Without this, the test would pass (correctly detected) but for the wrong reason (NoProgress instead of the intended pattern)."
  - "Aggregate accuracy assertion uses `cfg.eval.stuck_detection_min_accuracy` from `crate::config::load_config()` (the runtime-loaded config, NOT a hardcoded constant) — so a future config tweak that lowers the floor takes effect without code changes. CONTEXT lock §EvalConfig Sub-Struct §Locked: stuck_detection_min_accuracy."
  - "Fixture run helper builds ResilienceConfig::default() inline (smart_resilience_enabled=true, stuck_detection_enabled=true, monologue_threshold=5, compaction_thrash_threshold=3, no_progress_threshold=5). No fixture needs a non-default config — the production defaults exercise the detectors as shipped."
  - "Builder helpers go IN-FILE (not a separate helpers.rs) per CONTEXT lock — keeps the EVAL-03 banner self-contained and makes Plan 37-06 (compaction-fidelity, also in-file) easier to follow."
metrics:
  duration_minutes: 18
  tasks_completed: 3
  files_modified: 1
  files_created: 0
  commits: 1
  tests_added: 12  # 10 fixtures + 2 dedicated #[test]s; aggregate driver row count rose 13→23
  tests_pass: "9/9 (full intelligence_eval module)"
  cargo_check_errors: 0
  rows_emitted_by_driver: 23
  eval_03_aggregate_accuracy: "10/10 = 1.00 (>= 0.80 floor)"
completed_date: "2026-05-08"
requirements_addressed: [EVAL-03]
---

# Phase 37 Plan 37-05: EVAL-03 Stuck Detection Fixtures Summary

**One-liner:** Lands the EVAL-03 banner — 5 stuck `LoopState` builders + 5 healthy controls = 10 rows. Each fixture calls `resilience::stuck::detect_stuck(&state, &ResilienceConfig::default())` directly and asserts `result.is_some() == expected_detection`. Aggregate-accuracy assertion at end of `run_intelligence_eval_driver` enforces `>= cfg.eval.stuck_detection_min_accuracy` (default 0.80, ROADMAP success criterion #3 floor). 10/10 = 1.00 ≥ 0.80 on v1.

## LoopState field names + ActionRecord shape used

Verified at execution time against `loop_engine.rs:65-171`:

```rust
pub struct LoopState {
    pub iteration: u32,
    pub cumulative_cost_usd: f32,
    pub conversation_cumulative_cost_usd: f32,
    pub last_iter_cost: f32,
    pub replans_this_run: u32,
    pub token_escalations: u32,
    pub recent_actions: VecDeque<ActionRecord>,           // ✓ exists
    pub consecutive_same_tool_failures: HashMap<String, u32>,
    pub last_nudge_iteration: Option<u32>,
    pub consecutive_no_tool_turns: u32,                    // MonologueSpiral
    pub compactions_this_run: u32,                         // ✓ ContextWindowThrashing
    pub last_progress_iteration: u32,                      // ✓ NoProgress
    pub last_progress_text_hash: Option<[u8; 16]>,
    pub cost_warning_80_emitted: bool,
    pub is_subagent: bool,
}

pub struct ActionRecord {
    pub tool: String,            // NOT `tool_name`
    pub input_summary: String,   // NOT `args`
    pub output_summary: String,  // NEW field per Phase 34-02 (not in CONTEXT placeholder)
    pub is_error: bool,          // NEW field per Phase 34-02
}
```

**Field-name deltas vs CONTEXT placeholder:**
- `ActionRecord.tool_name` → actual field is `ActionRecord.tool`
- `ActionRecord.args` → actual field is `ActionRecord.input_summary`
- `ActionRecord` has 4 fields (tool, input_summary, output_summary, is_error), NOT 2
- `LoopState` has NO `error_history` field — errors are recorded into the same `recent_actions` ring with `is_error=true`
- `LoopState` has NO separate `verifier_rejected_count` — `replans_this_run` exists but is NOT consumed by `detect_stuck`

These deltas were noted in the plan's `<stop_conditions>` block — handled per the documented fallback (use actual field, document in SUMMARY).

## Per-fixture summary lines (actual variant returned)

```
EVAL-03: repeated-action-observation-pair detected=true  (expected=true)  pattern=Some(RepeatedActionObservation)
EVAL-03: error-loop                       detected=true  (expected=true)  pattern=Some(RepeatedActionObservation)
EVAL-03: oscillating-tools                detected=true  (expected=true)  pattern=Some(RepeatedActionObservation)
EVAL-03: no-progress-tokens               detected=true  (expected=true)  pattern=Some(NoProgress)
EVAL-03: context-window-thrash            detected=true  (expected=true)  pattern=Some(ContextWindowThrashing)
EVAL-03: varied-tools-progressing         detected=false (expected=false) pattern=None
EVAL-03: single-tool-success              detected=false (expected=false) pattern=None
EVAL-03: error-then-recovery              detected=false (expected=false) pattern=None
EVAL-03: compaction-once-progressing      detected=false (expected=false) pattern=None
EVAL-03: verifier-pass-throughout         detected=false (expected=false) pattern=None
```

**Variant-coverage breakdown** (5 stuck rows):
- `RepeatedActionObservation` × 3 (fixtures 1, 2, 3 — see deviation doc on why 2 + 3 also fall here)
- `NoProgress` × 1 (fixture 4)
- `ContextWindowThrashing` × 1 (fixture 5)

`MonologueSpiral` and `CostRunaway` variants are NOT exercised by EVAL-03's 5 stuck fixtures. `MonologueSpiral` is exercised by Plan 37-03's EVAL-01 (multi-step harness coverage assertion already verifies all 5 LoopHaltReason variants get expected coverage) and `CostRunaway` similarly. The CONTEXT lock locks the 5 fixture LABELS, not the 5 variant DISCRIMINANTS — variant coverage is an EVAL-01 concern.

## Aggregate accuracy result

**EVAL-03 aggregate accuracy: 10/10 = 1.00 (>= 0.80 floor) — assertion silent, passed.**

Driver-test stdout:
```
│ top-1: 23/23 (100%)  top-3: 23/23 (100%)  MRR: 1.000
```

23-row breakdown: 3 EVAL-02 (Plan 37-04) + 10 EVAL-03 (this plan) + 10 EVAL-01 (Plan 37-03).

Per-row floor (`MODULE_FLOOR=1.0` enforced via `sum.asserted_mrr` assertion) and aggregate accuracy floor (`cfg.eval.stuck_detection_min_accuracy=0.80`) both green.

## Tests added (all green)

```
running 9 tests
test evals::intelligence_eval::phase37_eval_01_all_haltreasons_covered ... ok
test evals::intelligence_eval::phase37_eval_02_code_query_fixed_paths_under_token_cap ... ok
test evals::intelligence_eval::phase37_eval_02_screen_anchor_query_under_token_cap ... ok
test evals::intelligence_eval::phase37_eval_02_simple_time_query_under_token_cap ... ok
test evals::intelligence_eval::phase37_eval_03_healthy_controls_zero_false_positives ... ok    [NEW]
test evals::intelligence_eval::phase37_eval_03_repeated_action_observation_pair_detected ... ok [NEW]
test evals::intelligence_eval::phase37_eval_panic_in_scripted_closure_handled_gracefully ... ok
test evals::intelligence_eval::run_intelligence_eval_driver ... ok                              [+13 rows]
test evals::intelligence_eval::tests::phase37_eval_scaffold_emits_empty_table ... ok

test result: ok. 9 passed; 0 failed; 0 ignored; 0 measured; 810 filtered out; finished in 10.50s
```

The `forced panic inside scripted closure` line in stdout is the **expected** panic from `phase37_eval_panic_in_scripted_closure_handled_gracefully` (Plan 37-03 regression test) — caught by `catch_unwind` boundary, test still passes.

## Line-count delta

`src-tauri/src/evals/intelligence_eval.rs`: 1408 → 1891 LOC (+483 net)

The Plan 37-05 banner section (lines 583–1080 approx) contains:
- 30 LOC: banner + deviation doc
- 12 LOC: `StuckDetectionFixture` struct
- ~150 LOC: 5 stuck builders (with doc comments)
- ~110 LOC: 5 healthy builders (with doc comments)
- 18 LOC: `eval_03_run` helper
- 90 LOC: 10 fixture functions
- 18 LOC: `fixtures_eval_03_stuck_detection` aggregator
- 35 LOC: 2 dedicated `#[test]` regressions

Plus 22 LOC for the aggregate-accuracy assertion in `run_intelligence_eval_driver`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Type adapter] ActionRecord field names**
- **Found during:** Task 1 builder authoring
- **Issue:** Plan + CONTEXT used `ActionRecord { tool_name: String, args: String }` (2-field placeholder); production shape per `loop_engine.rs:166` is `ActionRecord { tool, input_summary, output_summary, is_error }` (4 fields, named differently).
- **Fix:** All 10 builders use the production field names verbatim. The `tool|input_summary|output_summary` triple is what `detect_repeated_action_observation` hashes (verified at `resilience/stuck.rs:136-139`).
- **Files modified:** `src-tauri/src/evals/intelligence_eval.rs` (10 builders)
- **Commit:** `5324788`

**2. [Rule 1 — Bug] Fixture-label → StuckPattern variant mapping**
- **Found during:** Task 1 builder authoring (after reading `resilience/stuck.rs:40-46`)
- **Issue:** CONTEXT enumerated 5 fixture-label-derived patterns ("ErrorLoop", "OscillatingTools", "NoProgressTokens") that do NOT exist as `StuckPattern` enum variants. The actual 5 variants are `CostRunaway`, `RepeatedActionObservation`, `ContextWindowThrashing`, `MonologueSpiral`, `NoProgress`.
- **Fix:** Per threat T-37-43, the assertion is `result.is_some() == expected_detection` (no specific variant required). Builders construct state shapes that trip the closest production detector. The error-loop fixture (3 identical errors) trips RepeatedActionObservation via the same hash path. The oscillating-tools fixture (A,B,A,B,A,B) trips RepeatedActionObservation because 3+ identical "A" triples accumulate. The no-progress-tokens fixture trips NoProgress via iteration delta (LoopState has no verifier_rejected_count field).
- **Files modified:** `src-tauri/src/evals/intelligence_eval.rs` (extensive deviation doc-block + builder comments)
- **Commit:** `5324788`

**3. [Rule 2 — Critical guard] Healthy-control NoProgress disarming**
- **Found during:** Builder authoring (mental dry-run of `detect_no_progress` against fixture state)
- **Issue:** Without explicit `last_progress_iteration` setup, healthy controls #6 (`iteration=6`), #9 (`iteration=5`), #10 (`iteration=10`) would default `last_progress_iteration=0` and trip NoProgress (delta >= 5). 3 false positives → aggregate accuracy 7/10=0.70, below 0.80 floor.
- **Fix:** Each healthy control sets `last_progress_iteration = iteration` (delta=0) explicitly. Healthy controls #7 and #8 use `iteration=1/2` (< no_progress_threshold=5, cold-start guard rejects regardless). Stuck controls #1/2/3/5 also set `last_progress_iteration = iteration` so they trip ONLY the targeted detector.
- **Files modified:** `src-tauri/src/evals/intelligence_eval.rs` (10 builders, all carry an explicit `last_progress_iteration` set)
- **Commit:** `5324788`

Otherwise plan executed exactly as written.

## Auth Gates

None. EVAL-03 fixtures construct `LoopState` in-memory and call `detect_stuck` synchronously — no auth surfaces touched.

## Threat Surface Scan

Reviewed against Plan 37-05 STRIDE register (T-37-40..T-37-43):

- **T-37-40** (LoopState field names differ from CONTEXT placeholders) — mitigated. Verified exact production field names against `loop_engine.rs:65-171`. Builders use production names. Deltas documented in this SUMMARY.
- **T-37-41** (ActionRecord struct fields differ from {tool_name, args}) — mitigated. Production shape is 4-field (tool, input_summary, output_summary, is_error). All builders use the 4-field shape with realistic input/output payloads.
- **T-37-42** (healthy control trips detector — false positive) — mitigated. Each healthy control disarms NoProgress explicitly (last_progress_iteration = iteration OR iteration < no_progress_threshold cold-start). Verified by `phase37_eval_03_healthy_controls_zero_false_positives` returning passed=true on all 5 healthy fixtures.
- **T-37-43** (Phase 34-04 actual variant mapping differs from CONTEXT) — accepted as designed. Per-row summary records the actual variant returned by detect_stuck (e.g. `pattern=Some(RepeatedActionObservation)`); the assertion is `is_some() == expected_detection`. error-loop and oscillating-tools both trip RepeatedActionObservation rather than synthesized "ErrorLoop"/"OscillatingTools" variants — accepted because Phase 34-04 has no such variants and the contract is "detector fires correctly".

No new threat surfaces beyond the plan's enumeration. No flags added.

## Commits

| Hash      | Message                                                                |
| --------- | ---------------------------------------------------------------------- |
| `5324788` | feat(37-05): EVAL-03 stuck detection fixtures (5 stuck + 5 healthy controls) |

Single atomic commit; `git add` enumerated the single modified path explicitly (`src-tauri/src/evals/intelligence_eval.rs`). Pre-existing workspace state (deleted `.planning/phases/00..09` files, unrelated to Phase 37) was deliberately NOT staged — out of scope for 37-05.

## Next Plan Unblocked

**Plan 37-06 (EVAL-04 — compaction fidelity)** — appends `fixtures_eval_04_compaction_fidelity()` to `fixtures()` between EVAL-03 (this plan) and EVAL-01. Uses mocked summaries; no live LLM calls. After 37-06 lands, the driver test will emit ~28 rows (3 EVAL-02 + 10 EVAL-03 + ~5 EVAL-04 + 10 EVAL-01).

The EVAL-03 banner section's pattern (in-file builders + central run helper + dedicated regression tests + aggregate floor assertion) is the template Plan 37-06 should mirror.

## Self-Check: PASSED

Verified before writing this section:

- `[ -f src-tauri/src/evals/intelligence_eval.rs ]` → FOUND (1891 LOC)
- `grep -c "fn build_state_repeated_action_observation_pair\|fn build_state_error_loop\|fn build_state_oscillating_tools\|fn build_state_no_progress_tokens\|fn build_state_context_window_thrash" src-tauri/src/evals/intelligence_eval.rs` → 5
- `grep -c "fn build_healthy_state_varied_tools_progressing\|fn build_healthy_state_single_tool_success\|fn build_healthy_state_error_then_recovery\|fn build_healthy_state_compaction_once_progressing\|fn build_healthy_state_verifier_pass_throughout" src-tauri/src/evals/intelligence_eval.rs` → 5
- `grep -c "fn fixture_repeated_action_observation_pair\|fn fixture_error_loop\|fn fixture_oscillating_tools\|fn fixture_no_progress_tokens\|fn fixture_context_window_thrash\|fn fixture_varied_tools_progressing\|fn fixture_single_tool_success\|fn fixture_error_then_recovery\|fn fixture_compaction_once_progressing\|fn fixture_verifier_pass_throughout" src-tauri/src/evals/intelligence_eval.rs` → 10
- `grep -c "fn fixtures_eval_03_stuck_detection" src-tauri/src/evals/intelligence_eval.rs` → 1
- `grep -c "fn eval_03_run" src-tauri/src/evals/intelligence_eval.rs` → 1
- `grep -c "phase37_eval_03_repeated_action_observation_pair_detected\|phase37_eval_03_healthy_controls_zero_false_positives" src-tauri/src/evals/intelligence_eval.rs` → 2
- `grep -c "stuck_detection_min_accuracy" src-tauri/src/evals/intelligence_eval.rs` → 3 (3 references inside the new aggregate-accuracy assertion block)
- `grep -c "v.extend(fixtures_eval_03_stuck_detection())" src-tauri/src/evals/intelligence_eval.rs` → 1 (uncommented in `fixtures()`)
- Commit `5324788` → FOUND in `git log --oneline -1`
- `cargo check` → 0 errors (19 pre-existing warnings — same as 37-04 baseline)
- `cargo test --lib evals::intelligence_eval -- --nocapture --test-threads=1` → 9 passed, 0 failed
- Driver test row count: 23/23 (3 EVAL-02 + 10 EVAL-03 + 10 EVAL-01)
- EVAL-03 aggregate accuracy: 10/10 = 1.00 (>= 0.80 floor)
- Both new dedicated tests green; both prior 37-02/03/04 tests still green
