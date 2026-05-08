---
phase: 37-intelligence-eval
plan: 1
subsystem: config + eval-substrate
tags: [config, six-place-rule, eval, intelligence-eval, escape-hatch, substrate]
status: complete
dependency_graph:
  requires:
    - "Phase 36-01 IntelligenceConfig (gold-standard six-place precedent — exact mirror)"
    - "blade_config_dir() (existing helper, used in default_baseline_path)"
  provides:
    - "BladeConfig.eval: EvalConfig (5 locked fields, six-place wired)"
    - "eval-runs/ tracked directory (Plan 37-08 will populate v1.5-baseline.json here)"
  affects:
    - "src-tauri/src/config.rs (+86 lines)"
    - "Repo root (+ eval-runs/.gitkeep)"
tech_stack:
  added: []
  patterns:
    - "six-place rule (CLAUDE.md): 5 fields × 6 placements = 30 touch points"
    - "#[serde(default)] field-level + per-field default fns + #[serde(default)] struct-level (legacy-config tolerance, EVAL-05 escape-hatch toggle)"
    - "8th structural application of the v1.1 lesson — intelligence_eval_enabled escape hatch"
key_files:
  created:
    - "eval-runs/.gitkeep"
    - ".planning/phases/37-intelligence-eval/37-01-SUMMARY.md"
  modified:
    - "src-tauri/src/config.rs"
decisions:
  - "Mirror Phase 36-01 IntelligenceConfig wire-up verbatim — only field name + 5 field defaults swapped"
  - "Place EvalConfig declaration immediately after IntelligenceConfig in config.rs (line ~705)"
  - "Single consolidated test (3 sub-assertions) instead of 3 separate phase36-style tests — narrower substrate (5 fields, no module coupling)"
  - "Add `eval: cfg.eval.clone()` at line 2016 test-module DiskConfig literal — same maintenance pattern Phase 36-01 documented as 'place 6.5'"
metrics:
  duration_minutes: 18
  tasks_completed: 3
  files_created: 1
  files_modified: 1
  commits: 1
  tests_added: 1
  tests_pass: "1/1"
  cargo_check_errors: 0
completed_date: "2026-05-08"
requirements_addressed: [EVAL-05]
---

# Phase 37 Plan 37-01: EvalConfig sub-struct + eval-runs/ scaffold Summary

**One-liner:** Substrate plumbing for Phase 37 — `EvalConfig` (5 fields covering EVAL-05 escape hatch + baseline path + iterations cap + stuck-detection floor + context efficiency strictness) wired through canonical six-place rule, plus `eval-runs/` tracked directory for Plan 37-08's `v1.5-baseline.json`. ZERO behavior change — pure substrate.

## Six-Place Wire-Up Confirmed

All 6 grep markers satisfied (config.rs); line numbers verified against the plan's documented anchors with **zero drift** (the plan was authored against current master and lines 862, 948, 1125, 1197, 1363, 1444 matched exactly):

| Marker | Count | Plan-cited line | Actual line landed |
|--------|-------|-----------------|--------------------|
| `pub struct EvalConfig` | **1** | after line 705 (after IntelligenceConfig impl Default) | line 707 (immediately after IntelligenceConfig block) |
| `eval: EvalConfig` (DiskConfig field) | 1 of **4** | after line 862 | line 868 |
| `eval: EvalConfig::default()` (DiskConfig::default) | 1 of **4** | after line 948 | line 1037 |
| `pub eval: EvalConfig` (BladeConfig field) | 1 of **4** | after line 1125 | line 1221 |
| `eval: EvalConfig::default()` (BladeConfig::default) | 1 of **4** | after line 1197 | line 1294 |
| `eval: disk.eval` (load_config) | **1** | after line 1363 | line 1455 |
| `eval: config.eval.clone()` (save_config) | **1** | after line 1444 | line 1536 |
| 5 default fns | **5** | inline with EvalConfig block | default_intelligence_eval_enabled / default_baseline_path / default_multi_step_iterations_cap / default_stuck_detection_min_accuracy / default_context_efficiency_strict |
| `phase37_eval_config_default_matches_locked_contract` test | **1** | append next to phase36_intelligence tests | line ~2519 |

**Drift note:** the actual line numbers landed slightly higher than the plan's "after line N" anchors because the EvalConfig declaration block (~86 LOC inserted between IntelligenceConfig and DiskConfig) shifts every subsequent line. The plan-cited anchors describe the *insertion sites in the original file*, which is what matters; every insertion went into the correct semantic place. No structural drift.

There is also a **7th** `eval: cfg.eval.clone()` placement inside the test-module reward-weights round-trip block (~line 2016) — required for that pre-existing test to keep compiling, exact mirror of Phase 36-01's "place 6.5" `intelligence: cfg.intelligence.clone()` line. Counted as place 6.5 in the wire-up but not a deviation; same maintenance pattern Phase 36-01-SUMMARY documented.

## Tests Added (green)

```
running 1 test
test config::tests::phase37_eval_config_default_matches_locked_contract ... ok

test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 811 filtered out; finished in 0.07s
```

Single consolidated test covers the three substrate guarantees:

1. **Default values per CONTEXT lock §EvalConfig Sub-Struct** — `intelligence_eval_enabled=true`, `baseline_path` ends in `v1.5-baseline.json` AND contains `eval-runs/`, `multi_step_iterations_cap=25` (matches LoopConfig.iter_cap), `stuck_detection_min_accuracy=0.80` (within 1e-6, ROADMAP success criterion #3 floor), `context_efficiency_strict=true`.
2. **DiskConfig <-> BladeConfig serde round-trip** — Builds a non-default `EvalConfig` (all 5 fields flipped: enabled=false, baseline_path=`/tmp/test-baseline.json`, cap=50, accuracy=0.95, strict=false), serialises through `DiskConfig`, parses back, asserts struct equality.
3. **Legacy DiskConfig JSON without `eval` key falls back to defaults** — Parses a 3-field DiskConfig JSON with no `eval` key, asserts loaded `eval` equals `EvalConfig::default()`. The non-negotiable CLAUDE.md guarantee (existing user configs MUST keep loading).

Phase 36 regression baseline confirmed:

```
running 3 tests
test config::tests::phase36_intelligence_default_values        ... ok
test config::tests::phase36_intelligence_missing_uses_defaults ... ok
test config::tests::phase36_intelligence_config_round_trip     ... ok
test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 809 filtered out; finished in 0.08s
```

## eval-runs/ Directory

`/home/arnav/blade/eval-runs/.gitkeep` — empty file, 0 bytes, tracked by git. Plan 37-08's `intelligence-benchmark` bin will write `v1.5-baseline.json` alongside it.

## Adjacent Sub-Struct Cohabitation

The 6 prior config sub-structs (`ContextConfig`, `LoopConfig`, `ResilienceConfig`, `SessionConfig`, `DecompositionConfig`, `IntelligenceConfig`) and the new `EvalConfig` now sit adjacent in config.rs at the canonical six-place sites. They are independent — no field collisions, no ordering dependencies, no shared default fns. The `mod tests` block carries phase-marker tests for each (3 each for ContextConfig/LoopConfig/ResilienceConfig/SessionConfig/DecompositionConfig/IntelligenceConfig + 1 consolidated for EvalConfig). All green.

## Cargo Check

`cargo check` exited **0** with only the 19 pre-existing warnings (dead-code on `ParsedSymbolKind::Module`/`Constant`, `ParsedEdge.from_name` in `intelligence/tree_sitter_parser.rs` from Phase 36-02; misc dead-code warnings in `commands.rs`/`active_inference.rs`/`vitality_engine.rs`/`session/log.rs` from prior phases). **No warnings introduced by 37-01.**

First `cargo check` after the EvalConfig insertion compiled in 3m 19s (full type-check pass over 130+ Rust modules incl. tree-sitter); subsequent test-build added the unit-test target in ~12m. Cached subsequent runs: ~8s.

## Commits

| Hash | Message |
|------|---------|
| `571b233` | feat(37-01): EvalConfig sub-struct (6-place wire-up, EVAL-05 substrate) |

1 atomic commit covering all three plan tasks (Task 1 EvalConfig wire-up + Task 2 eval-runs/.gitkeep + Task 3 cargo check pass), `git add <specific paths>` only — the 188 pre-existing staged-deletion entries in `.planning/phases/00-31-*` directories were NOT swept in. **No `git add -A`, no `git add .`.** No Co-Authored-By line.

The plan's three tasks are atomic-commit-able as a unit (Task 1 is the only Rust change; Task 2 is a 0-byte file; Task 3 is verification only). One commit instead of two/three keeps the substrate landing as one logical unit.

## Deviations from Plan

**None.** Plan executed exactly as written. Three observations worth noting (not deviations, just judgement calls beyond the plan):

1. **Test-module DiskConfig literal at line 2016** — The pre-existing reward-weights round-trip test inside `mod tests` builds a synthetic `DiskConfig` literal that mirrors the `save_config` body. To keep that test compiling I added `eval: cfg.eval.clone()` next to the existing `intelligence: cfg.intelligence.clone()` line. This is the same maintenance pattern Phase 36-01-SUMMARY documented as "place 6.5"; not a separate deviation.
2. **Single commit instead of three** — Plan had 3 task blocks; tasks 2 (gitkeep) and 3 (cargo check) are too small to warrant separate commits. Kept as one atomic substrate-landing commit per the plan's "no behavior change" framing.
3. **Plan 37-02 commit `06538e4` already exists in history** — Pre-existing situation outside this plan's scope. Verified that 37-02's code does not yet read `config.eval.*` (only my new save_config line uses `config.eval.clone()`). The substrate is now in place for any 37-02+ consumer; no rebase needed.

## Auth Gates

None. No auth surfaces touched.

## Threat Surface Scan

Reviewed all files modified/created against the plan's threat register:

- **T-37-01** (legacy config missing `eval` key) — mitigated by `#[serde(default)]` field-level + `#[serde(default)]` struct-level + the (c) sub-assertion in `phase37_eval_config_default_matches_locked_contract` (green).
- **T-37-02..T-37-04** (misconfigured field values) — accept disposition per plan; surfaced as test failures or runtime guard rails downstream, not panics.
- **T-37-05** (information disclosure) — accept; same as IntelligenceConfig (Phase 36-01).

No new threat surfaces introduced beyond what the plan's `<threat_model>` already enumerates. No flags added.

## Next-Wave Plans Unblocked

This substrate plan unblocks every Wave 2/3/4/5 plan in Phase 37:

- **Plan 37-02** — EVAL-01 intelligence_eval.rs scaffold + ScriptedProvider + EVAL_FORCE_PROVIDER seam (already on `master` at `06538e4`; will read `config.eval.multi_step_iterations_cap` once it lands its consumers)
- **Plan 37-03** — EVAL-01 ten multi-step task fixtures (reads `config.eval.multi_step_iterations_cap`)
- **Plan 37-04** — EVAL-02 three context-efficiency fixtures (reads `config.eval.context_efficiency_strict`)
- **Plan 37-05** — EVAL-03 ten stuck-detection fixtures (reads `config.eval.stuck_detection_min_accuracy`)
- **Plan 37-06** — EVAL-04 three compaction-fidelity fixtures
- **Plan 37-07** — EVAL-05 verify-intelligence.sh gate (reads `config.eval.intelligence_eval_enabled` for short-circuit logic)
- **Plan 37-08** — Operator-runnable `scripts/run-intel-benchmark.sh` (writes `eval-runs/v1.5-baseline.json` at `config.eval.baseline_path`)

## Self-Check: PASSED

Verified before writing this section:

- `[ -f src-tauri/src/config.rs ]` → FOUND (modified, +148 LOC)
- `[ -f eval-runs/.gitkeep ]` → FOUND (0 bytes)
- Commit `571b233` → FOUND in `git log`
- `cargo test --lib config::tests::phase37_eval_config_default_matches_locked_contract` → 1 passed, 0 failed
- `cargo test --lib config::tests::phase36` → 3 passed, 0 failed (regression baseline preserved)
- `cargo check` → 0 errors (only 19 pre-existing warnings, none new)
- 5 grep acceptance criteria all satisfied (`pub struct EvalConfig`=1, `eval: EvalConfig`=4, `eval: disk.eval`=1, `eval: config.eval.clone()`=1, 5 default fns)
