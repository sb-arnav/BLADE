---
phase: 37
plan: 8
subsystem: intelligence-eval
tags: [eval-01, eval-05, operator-benchmark, panic-injection, phase-close]
gsd_state_version: 1.0
status: code-complete
uat_status: operator-deferred (b); a + c PASS
dependency_graph:
  requires:
    - 37-01 (EvalConfig.baseline_path)
    - 37-02 (EVAL_FORCE_PROVIDER seam)
    - 37-03 (10 EVAL-01 fixture labels + first panic regression)
    - 37-07 (verify-intelligence.sh — gate 38)
  provides:
    - intelligence-benchmark bin (Cargo [[bin]] target)
    - scripts/run-intel-benchmark.sh wrapper (env-gated, opt-in)
    - phase37_eval_panic_in_seam_does_not_crash_driver test (8th v1.1 application)
    - Phase 37 close-out: STATE.md + ROADMAP.md updates
  affects: []
tech-stack:
  added: [chrono Utc::now (existing dep), serde_json::to_string_pretty (existing dep)]
  patterns:
    - cargo bin target separate from main blade binary (precedent: skill_validator)
    - env-gate via BLADE_RUN_BENCHMARK=true (mirrors BLADE_INTELLIGENCE_EVAL=false from 37-07)
    - structural-skeleton-with-operator-deferred-wiring (precedent: Plan 37-03 SUMMARY judgement #3)
key-files:
  created:
    - src-tauri/src/bin/intelligence_benchmark.rs (~200 LOC, real-LLM benchmark skeleton)
    - scripts/run-intel-benchmark.sh (~45 LOC, env-gated wrapper)
    - .planning/phases/37-intelligence-eval/37-08-SUMMARY.md (this file + Phase 37 close-out)
  modified:
    - src-tauri/Cargo.toml (+8 lines — [[bin]] entry)
    - src-tauri/src/evals/intelligence_eval.rs (+74 lines — 8th panic regression)
    - .planning/STATE.md (Phase 37 row in Current Position; progress 71→81)
    - .planning/ROADMAP.md (Phase 37 plans block 8/8 [x]; status "Code complete (UAT pending)")
decisions:
  - Ship intelligence-benchmark bin as STRUCTURAL SKELETON (not full run_loop wiring) per Plan 37-03 judgement #3 and authorized stop condition in Plan 37-08 lines 346-348
  - Re-declare 10 fixture labels in bin (parallel to intelligence_eval.rs cfg(test) const) rather than refactor cfg(test) machinery into a non-test module — duplication 10 lines, queries are stable, bin stays independent
  - Phase 37 closes at checkpoint:human-verify boundary (NOT marked complete) per memory feedback_deferred_uat_pattern.md — operator runs UAT (b) baseline.json post-Phase-37-close
  - Preserve unchecked `- [ ] Phase 37` summary checklist line in ROADMAP.md per user's explicit hard rule (boundary holds open until operator commits baseline)
metrics:
  duration: ~30min execution + ~13min cargo test (single-thread)
  tasks_completed: 8 of 8 (Plan 37-08 tasks 1-7 + Task 8 commit/SUMMARY/UAT)
  completed: 2026-05-08
phase_close: true
phase_close_status: checkpoint:human-verify open (operator-deferred UAT b)
---

# Phase 37 SUMMARY — Intelligence Eval (EVAL-01..05)

**One-liner:** EVAL-01 multi-step task fixtures (10 scripted-loop scenarios) + EVAL-02 context efficiency (3 LAST_BREAKDOWN inspections) + EVAL-03 stuck detection (5 stuck + 5 healthy) + EVAL-04 compaction marker survival (3 fixtures) + EVAL-05 verify-intelligence.sh as gate 38, plus operator-runnable real-LLM benchmark bin (structural skeleton, run_loop wiring operator-deferred) and 2 panic-injection regressions locking the v1.1 fallback discipline at the EVAL_FORCE_PROVIDER seam.

## Status: CODE COMPLETE (UAT pending — operator-deferred per memory feedback_deferred_uat_pattern.md)

## Static gates

| Gate | Result |
|------|--------|
| `cargo check` | PASS (19 pre-existing dead_code warnings only) |
| `cargo check --bin intelligence-benchmark` | PASS (the new bin compiles cleanly) |
| `tsc --noEmit` | PASS (no frontend changes in Phase 37) |
| `cargo test --lib evals::intelligence_eval -- --test-threads=1` | PASS (13/13 tests; driver emits 26 rows; top-1=26/26 top-3=26/26 MRR=1.000) |
| `bash scripts/verify-intelligence.sh` | PASS (38th gate green; OK msg) |
| `BLADE_INTELLIGENCE_EVAL=false bash scripts/verify-intelligence.sh` | PASS (skip path) |
| `bash scripts/run-intel-benchmark.sh` (no env) | PASS (SKIP usage + exit 0) |

## Panic-injection regressions (v1.1 fallback discipline)

| Test | Plan | Coverage |
|------|------|----------|
| `phase37_eval_panic_in_scripted_closure_handled_gracefully` | 37-03 | Direct seam-closure panic via EVAL_FORCE_PROVIDER; catch_unwind boundary returns Err |
| `phase37_eval_panic_in_seam_does_not_crash_driver` | 37-08 (this plan) | Driver-wrapper-style panic invocation; outer catch_unwind contains it; result.is_err() asserted |

Both pass under single-thread test harness; the panicked stderr lines are expected and confirm the catch_unwind boundary is exercised.

## UAT 3-step results

| Step | Description | Verdict |
|------|-------------|---------|
| (a) | `bash scripts/verify-intelligence.sh` exits 0 + EVAL-06 box-drawing table emitted via cargo test driver | **PASS** |
| (b) | `BLADE_RUN_BENCHMARK=true bash scripts/run-intel-benchmark.sh` creates eval-runs/v1.5-baseline.json | **DEFERRED** (operator-deferred per memory feedback_deferred_uat_pattern.md) |
| (c) | `BLADE_INTELLIGENCE_EVAL=false bash scripts/verify-intelligence.sh` exits 0 with `[verify-intelligence] SKIP -- disabled via BLADE_INTELLIGENCE_EVAL=false` | **PASS** |

UAT (b) — operator next-task: run the bin once per BLADE release, inspect/edit the per-fixture wiring as needed, then `git add eval-runs/v1.5-baseline.json` + commit `feat(37): commit v1.5 EVAL-01 baseline (N/10 passed)`. The deterministic CI lane (gate 38) handles a missing baseline gracefully per CONTEXT §Operator-Runnable Benchmark §Locked: Comparison logic — v1.5 ships without the baseline and the lane treats current pass-counts as absolute pass/fail.

## EVAL-01..05 verdict (Phase 37 close-out)

| Req | Coverage | Verdict |
|-----|----------|---------|
| EVAL-01 | 10 multi-step task fixtures (scripted-loop coverage of all 7 LoopHaltReason variants) | PASS — 10 fixtures green; 26-row driver table emits with MRR 1.000; baseline.json operator-deferred |
| EVAL-02 | 3 context efficiency fixtures via direct LAST_BREAKDOWN inspection (simple-time-query 1187/1500t; code-query-fixed-paths 1218/4000t; screen-anchor-query 1222/1500t) | PASS — all 3 under cap, no forbidden modules, all required modules present |
| EVAL-03 | 10 stuck/healthy fixtures via direct detect_stuck calls; aggregate accuracy reported by run_intelligence_eval_driver | PASS — 5/5 stuck detected + 5/5 healthy not flagged; aggregate 100% (>= 0.80 floor) |
| EVAL-04 | 3 compaction fidelity fixtures (auth-flow-decisions, bug-investigation-trace, multi-file-refactor) via build_compaction_summary_prompt + safe_slice marker assertions | PASS — all critical markers survive |
| EVAL-05 | scripts/verify-intelligence.sh gate 38 + BLADE_INTELLIGENCE_EVAL escape hatch (CTX-07 8th application) | PASS — gate 38 green; escape hatch verified by phase37_eval_05_verify_intelligence_short_circuits_when_disabled |

## Files touched (Phase 37 cumulative)

| File | Plans |
|------|-------|
| `src-tauri/src/config.rs` | 37-01 (EvalConfig sub-struct + 6-place wire-up; intelligence_eval_enabled, baseline_path, multi_step_iterations_cap, stuck_detection_min_accuracy, context_efficiency_strict) |
| `src-tauri/src/loop_engine.rs` | 37-02 (EVAL_FORCE_PROVIDER thread-local seam + maybe_force_provider helper) |
| `src-tauri/src/evals/mod.rs` | 37-02 (registered intelligence_eval submodule) |
| `src-tauri/src/evals/intelligence_eval.rs` | 37-02..37-06, 37-07, 37-08 (26 fixtures + driver + 2 panic regressions + EVAL-05 escape-hatch test) |
| `src-tauri/src/commands.rs` | 37-06 (build_compaction_summary_prompt visibility widened pub(crate)) |
| `scripts/verify-intelligence.sh` | 37-07 (38th verify gate; reads BLADE_INTELLIGENCE_EVAL escape hatch) |
| `package.json` | 37-07 (verify:intelligence script + verify:all chain extension) |
| `eval-runs/.gitkeep` | 37-01 (tracked directory; baseline.json operator-populated) |
| `src-tauri/Cargo.toml` | 37-08 (`[[bin]] intelligence-benchmark`) |
| `src-tauri/src/bin/intelligence_benchmark.rs` | 37-08 (operator-runnable benchmark — STRUCTURAL SKELETON) |
| `scripts/run-intel-benchmark.sh` | 37-08 (env-gated wrapper) |
| `.planning/STATE.md` | 37-08 (Phase 37 row + progress 71→81%) |
| `.planning/ROADMAP.md` | 37-08 (Phase 37 plans 8/8 [x]; status "Code complete (UAT pending)") |

## Operator next tasks (post-Phase-37-close)

1. **Inspect bin SKELETON** — `src-tauri/src/bin/intelligence_benchmark.rs` ships as a structural skeleton; the per-fixture body is an `OperatorDeferred` placeholder. Decide whether to:
   - Wire `loop_engine::run_loop` directly against real providers (requires LoopState + ConversationMessage assembly + Tauri AppHandle harness OR alternate signature), OR
   - Wrap the existing `commands::send_message_stream` Tauri command in a headless invocation harness.
2. **Run benchmark** — `BLADE_RUN_BENCHMARK=true bash scripts/run-intel-benchmark.sh`. Reads BladeConfig.provider + model; writes eval-runs/v1.5-baseline.json per locked schema; ~$5 cost ceiling.
3. **Commit baseline** — `git add eval-runs/v1.5-baseline.json` + `git commit -m "feat(37): commit v1.5 EVAL-01 baseline (N/10 passed)"`.
4. **Phase 38** — `/gsd-plan-phase 38` (README citations + CHANGELOG + milestone audit + phase archive — separate phase, not part of 37).

## Judgement calls (Plan 37-08 author)

1. **Bin target depth: STRUCTURAL SKELETON.** Per Plan 37-03 SUMMARY judgement #3, the EVAL-01 fixtures exercise `run_loop` indirectly via the per-fixture `run_fixture_via_seam` helper (cfg(test)-gated, not callable from bin). Wiring `run_loop` directly from a bin requires LoopState assembly, ConversationMessage history, ToolDefinition registry, ActivityStrip channel, and a Tauri AppHandle (run_loop's signature requirement) — larger than Plan 37-08's authorized scope. Per the plan's documented stop condition (lines 346-348), the bin ships as a SKELETON: `[[bin]]` entry registered, cargo bin compiles cleanly, env-gate works, BladeConfig.eval.baseline_path is resolved + parent dir creatable, 10 fixture labels declared in parallel to intelligence_eval.rs, JSON shape matches CONTEXT lock §Locked: Output schema, per-fixture row reports `passed=false halted="OperatorDeferred"` as an explicit operator signal. The operator's next-task surface is documented inline in the bin doc-comment header.

2. **Panic test result expectation: `is_err()` (not flexible).** Plan 37-08's task description for Task 3 said either Ok or Err is acceptable. I asserted `result.is_err()` matching Plan 37-03's existing test contract — the panicking closure invocation, when wrapped in catch_unwind, MUST return Err for the boundary to have done its job. If the closure didn't panic at all (Ok), the test would silently pass without proving the boundary holds. Asserting `is_err()` is the v1.1 fallback discipline regression check.

3. **Re-declare fixture labels (not refactor cfg(test) const):** The bin needs the 10 fixture labels but `intelligence_eval::FIXTURE_QUERIES` is buried inside `#[cfg(test)]`. Refactoring would require splitting the fixture data into a non-test module and re-importing — meaningful surface change for 10 stable strings. Re-declared in bin instead. Drift risk is mitigated by the test `phase37_eval_01_aggregator_label_alignment` (Plan 37-03) which asserts both label collections match — if intelligence_eval.rs labels change without the bin, the operator catches it the next time they run the benchmark (the bin's labels print to stdout). Acceptable.

4. **Phase 37 row in STATE.md "Current Position":** the existing format isn't a markdown table — it's a vertical list of `Phase NN — Name (M/N plans complete; checkpoint:human-verify open)` lines. Mirrored that exact shape rather than introducing a new table.

5. **STATE.md `completed_phases` unchanged at 0:** explicit hard rule from the user's resume directive. Phase 37 sits at the checkpoint:human-verify boundary; UAT operator-deferred. Six phases (32-37) are now in this state pending Arnav's runtime UAT pass.

6. **ROADMAP.md `- [ ] Phase 37` summary checklist (line 52) preserved unchecked:** explicit hard rule from the user's resume directive. The checklist line tracks formal phase closure, which requires UAT (b) operator commit. Boundary holds open.

## Self-Check: PASSED

- [x] `src-tauri/Cargo.toml` has `[[bin]] intelligence-benchmark` ✓
- [x] `src-tauri/src/bin/intelligence_benchmark.rs` exists, compiles, default = SKIP usage ✓
- [x] `scripts/run-intel-benchmark.sh` exists + executable + default = SKIP usage ✓
- [x] `phase37_eval_panic_in_seam_does_not_crash_driver` test green ✓
- [x] `.planning/STATE.md` has Phase 37 row in Current Position ✓
- [x] `.planning/ROADMAP.md` Phase 37 progress row "8/8 | Code complete (UAT pending)" ✓
- [x] `.planning/ROADMAP.md` 8/8 plans marked [x] in Phase 37 details block ✓
- [x] `cargo check` clean; 13/13 eval tests green; verify:intelligence green ✓
- [x] UAT (a) PASS, (c) PASS, (b) DEFERRED ✓
- [x] Plan 37-08 commit staged SPECIFIC files only (6 files; NEVER -A); 188 pre-existing deletions excluded ✓
- [x] Phase 37 closes at checkpoint:human-verify boundary; STOP per resume directive ✓

## Operator sign-off

[Arnav records here when UAT (b) completes]: PHASE 37 v1.5 CLOSED ✓
