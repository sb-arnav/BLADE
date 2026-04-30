---
phase: 17-doctor-module
plan: 03
subsystem: diagnostics
tags: [doctor, signal-sources, eval-history, capability-gaps, auto-update, severity-classification, phase-17]

# Dependency graph
requires:
  - phase: 17-doctor-module
    provides: "Plan 17-01 (record_eval_run + history_jsonl_path); Plan 17-02 (DoctorSignal struct + SignalClass/Severity enums + suggested_fix table + 3 stubbed Tauri commands)"
provides:
  - "compute_eval_signal: synchronous DOCTOR-02 source classifying severity per CONTEXT D-05 against tests/evals/history.jsonl tail-200 reads"
  - "compute_capgap_signal: synchronous DOCTOR-03 source classifying severity per CONTEXT D-06 against activity_timeline rows where event_type='capability_gap'"
  - "compute_autoupdate_signal: synchronous DOCTOR-10 source classifying severity per CONTEXT D-09 via filesystem grep of Cargo.toml + lib.rs anchors"
  - "classify_autoupdate(cargo_toml, lib_rs) -> Severity: testable inner helper bypassing the env!() compile-time constraint"
  - "eval_history_path() doctor.rs-local resolver mirroring harness::history_jsonl_path (the evals module is cfg(test)-gated so we cannot call it from production)"
  - "harness::record_eval_run wired into all 5 Phase 16 eval modules — history.jsonl now populates on every cargo test --lib evals run"
  - "13 new unit tests covering Red/Amber/Green branches of all 3 signal sources + 4 classify_autoupdate branch tests"
affects: ["17-04 (TentacleHealth + ConfigDrift signal sources + orchestrator wave)", "17-05 (doctor_run_full_check orchestrator + tokio::join! + transition detection)", "17-06 (DoctorPane.tsx frontend — consumes the snake_case enum wire format)"]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Synchronous signal-source signature returning Result<DoctorSignal, String> — bounded I/O, wrapped in tokio::spawn_blocking by Plan 17-05's tokio::join! orchestrator"
    - "Inner classifier helper pattern (classify_autoupdate) for bypassing env!() compile-time constraints in unit tests"
    - "BLADE_EVAL_HISTORY_PATH env override + BLADE_CONFIG_DIR env override + local EnvGuard RAII for test isolation (Pitfall 4 mitigation)"
    - "On-demand schema bootstrap in tests (init_capgap_test_db) avoiding full db::init_db cost"
    - "record_eval_run insertion BEFORE assert! block so failed evals still produce JSONL rows (RESEARCH § B2 recommendation A1)"
    - "#[allow(dead_code)] on Plan 17-03 signal sources awaiting Plan 17-05 wiring — same pattern Plan 17-02 used for prior_severity_map"

key-files:
  created: []
  modified:
    - "src-tauri/src/doctor.rs (+539 lines: 3 signal source bodies + 1 inner helper + 1 path resolver + 1 tail reader + 1 record struct + 13 unit tests)"
    - "src-tauri/src/evals/hybrid_search_eval.rs (+5 lines: record_eval_run call before floor asserts)"
    - "src-tauri/src/evals/real_embedding_eval.rs (+8 lines: record_eval_run call before floor asserts)"
    - "src-tauri/src/evals/kg_integrity_eval.rs (+8 lines: import summarize + record_eval_run call before floor asserts)"
    - "src-tauri/src/evals/typed_memory_eval.rs (+8 lines: import summarize + record_eval_run call before floor asserts)"
    - "src-tauri/src/evals/capability_gap_eval.rs (+8 lines: import summarize + record_eval_run call before floor asserts)"

key-decisions:
  - "Plan-prescribed Option A chosen for eval_history_path — duplicate the 4-line resolution logic into doctor.rs because the evals module is #[cfg(test)] gated in lib.rs (line 84-85). Production doctor.rs cannot call crate::evals::harness::history_jsonl_path."
  - "Insertion order: super::harness::record_eval_run AFTER print_eval_table BUT BEFORE assert! block. RESEARCH § B2 recommendation A1 — Doctor's D-05 Red tier needs to see failures, not just successes."
  - "Per-module floor_passed formula matches each module's existing assert! exactly so JSONL records track the source-of-truth assertion. hybrid_search and real_embedding use top3>=80% AND mrr>=0.6; the three bool_row-pattern modules (kg_integrity, typed_memory, capability_gap) use asserted_top1_count == asserted_total which mirrors 'all assertions passed'."
  - "Used local EnvGuard RAII inside doctor::tests rather than re-exporting harness::tests::EnvGuard. The harness EnvGuard is private to its tests module; a 5-line copy is cleaner than widening the public surface."
  - "compute_capgap_signal opens its own rusqlite Connection (matching the evolution_log_capability_gap producer pattern at evolution.rs:1115). Defensive: missing DB OR missing table → Green with note (the table is created lazily by db::init_db, which has not run on a fresh install before any capgap event fires)."
  - "All 7 new private functions in doctor.rs received #[allow(dead_code)]. They are exercised by tests but not yet wired into the production doctor_run_full_check (Plan 17-05 owns that wiring). Same pattern Plan 17-02 used for prior_severity_map."

patterns-established:
  - "Doctor signal source body convention: synchronous fn name() -> Result<DoctorSignal, String> { ... }. Plan 17-05 wraps each in tokio::spawn_blocking via tokio::join! for parallel fetch."
  - "Test seam pattern: every signal source honors a test-isolation env override (BLADE_EVAL_HISTORY_PATH for eval, BLADE_CONFIG_DIR for capgap, classify_autoupdate(strs) inner for autoupdate)."
  - "JSONL append-only history pattern: 5 modules write to tests/evals/history.jsonl on every cargo test --lib evals run; the file is git-ignored (only .gitkeep is committed); Doctor reads tail-200 lines."

requirements-completed: [DOCTOR-02, DOCTOR-03, DOCTOR-10]

# Metrics
duration: ~40min execution + ~12min compile cycles
completed: 2026-04-30
---

# Phase 17 Plan 03: Wave 1 Signal Sources Summary

**3 doctor.rs signal-source bodies (compute_eval_signal / compute_capgap_signal / compute_autoupdate_signal) + record_eval_run wired into all 5 Phase 16 eval modules — history.jsonl now populates on every verify-eval run and the EvalScores / CapabilityGaps / AutoUpdate Red-Amber-Green ladders all classify correctly per CONTEXT D-05/D-06/D-09**

## Performance

- **Duration:** ~52 min wall-clock (3 long cargo compile cycles dominated)
- **Started:** 2026-04-30T09:11:50Z (approx — plan execution kickoff)
- **Completed:** 2026-04-30T10:04:05Z
- **Tasks:** 3
- **Files modified:** 6 (1 doctor.rs + 5 eval modules)

## Accomplishments

- **DOCTOR-02 wired:** EvalScores signal source reads tests/evals/history.jsonl (last 200 lines, missing-file = Green per D-16), groups by module, and classifies Red on floor breach / Amber on ≥10% absolute mrr drop / Green otherwise. Honors BLADE_EVAL_HISTORY_PATH env override for test isolation.
- **DOCTOR-03 wired:** CapabilityGaps signal source queries activity_timeline via json_extract(metadata, '$.capability') with 24h + 7d window aggregation. Red ≥3 in 7d / Amber ≥1 in 24h / Green otherwise. Defensive against missing DB and missing table.
- **DOCTOR-10 wired:** AutoUpdate signal source greps Cargo.toml for `tauri-plugin-updater` AND lib.rs for `tauri_plugin_updater::Builder::new().build()`. Inner classify_autoupdate(cargo_toml, lib_rs) helper bypasses env!() so all 4 branches are unit-testable. Live-tree integration test confirms Green on stock BLADE.
- **5 Phase 16 eval modules wired:** record_eval_run inserted AFTER print_eval_table and BEFORE assert! in each module. history.jsonl now populates on every cargo test --lib evals run (verified — file has 5 lines after the test run, one per module, all floor_passed: true at mrr 1.0).
- **13 new unit tests passing:** 4 eval-signal tests + 3 capgap tests + 4 classify_autoupdate branch tests + 1 autoupdate-stock-install integration + 1 ne smoke test pre-existing. Combined with Plan 17-02's 4 tests, doctor::tests now has 17 tests, all green.

## Task Commits

Each task was committed atomically on master:

1. **Task 1: compute_eval_signal classifies severity per D-05** — `d416c4c` (feat)
2. **Task 2: compute_capgap_signal + compute_autoupdate_signal** — `6e93fb0` (feat)
3. **Task 3: wire harness::record_eval_run into 5 Phase 16 eval modules** — `1227c39` (feat)

**Plan metadata:** _to follow_ (docs commit with SUMMARY + STATE + ROADMAP)

## Module name strings used for record_eval_run

These string literals are stable contract — Plan 17-06 frontend can filter eval rows by them:

- `"hybrid_search_eval"`
- `"real_embedding_eval"`
- `"kg_integrity_eval"`
- `"typed_memory_eval"`
- `"capability_gap_eval"`

## Function signatures shipped

```rust
// In src-tauri/src/doctor.rs (all #[allow(dead_code)] until Plan 17-05 wiring):
fn eval_history_path() -> std::path::PathBuf;
fn read_eval_history(limit: usize) -> Vec<EvalRunRecord>;
fn compute_eval_signal() -> Result<DoctorSignal, String>;
fn compute_capgap_signal() -> Result<DoctorSignal, String>;
fn classify_autoupdate(cargo_toml: &str, lib_rs: &str) -> Severity;
fn compute_autoupdate_signal() -> Result<DoctorSignal, String>;

#[derive(Debug, Clone, Deserialize)]
struct EvalRunRecord {
    timestamp: String,
    module: String,
    top1: usize, top3: usize, mrr: f32,
    floor_passed: bool,
    asserted_count: usize, relaxed_count: usize,
}
```

## Files Created/Modified

- `src-tauri/src/doctor.rs` — 3 signal-source bodies + EvalRunRecord struct + eval_history_path resolver + read_eval_history tail-reader + classify_autoupdate inner helper + 13 unit tests
- `src-tauri/src/evals/hybrid_search_eval.rs` — record_eval_run insert before floor asserts
- `src-tauri/src/evals/real_embedding_eval.rs` — record_eval_run insert before floor asserts
- `src-tauri/src/evals/kg_integrity_eval.rs` — added `summarize` to imports + record_eval_run insert
- `src-tauri/src/evals/typed_memory_eval.rs` — added `summarize` to imports + record_eval_run insert
- `src-tauri/src/evals/capability_gap_eval.rs` — added `summarize` to imports + record_eval_run insert

## Decisions Made

- **eval_history_path duplication:** Honored Plan's prescribed Option A — duplicate the 4-line path resolution into doctor.rs. The evals module is `#[cfg(test)] mod evals;` at lib.rs:84-85, making `crate::evals::harness::history_jsonl_path` unreachable from production code. Option B (widening evals to public) was rejected: would expose test-only fixtures and helpers (`temp_blade_env`, `EvalRow`, etc.) that intentionally live behind cfg(test).
- **floor_passed formula per module:** Matched each module's existing assert! exactly:
  - hybrid_search_eval: `(asserted_top3 / asserted_total) >= 0.80 && asserted_mrr >= 0.6` (asserted denominator excludes 4 relaxed adversarial rows)
  - real_embedding_eval: `(top3 / total) >= 0.80 && mrr >= 0.6` (no relaxed rows; the existing assert uses total not asserted_total)
  - kg_integrity_eval, typed_memory_eval, capability_gap_eval: `asserted_top1_count == asserted_total` (bool_row pattern — every dimension/case must pass)
- **Test isolation strategy:** Local EnvGuard RAII per tests module, tempdir-scoped env vars, on-demand schema bootstrap for capgap (init_capgap_test_db) avoiding full db::init_db cost. Pitfall 4 (history.jsonl pollution) cleanly mitigated via BLADE_EVAL_HISTORY_PATH override.
- **#[allow(dead_code)] on Plan 17-03 functions:** They will be wired by Plan 17-05's `doctor_run_full_check` orchestrator. Same pattern Plan 17-02 used for `prior_severity_map`. Tests exercise all 7 new symbols, so cargo check is clean (zero warnings).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Added #[allow(dead_code)] to all 7 new private fns/struct in doctor.rs**

- **Found during:** Final cargo check after Task 3
- **Issue:** cargo check emitted 7 dead-code warnings — Plan 17-03 signal sources are not yet wired into `doctor_run_full_check` (Plan 17-05 owns that wiring), but the Plan's success criteria requires `cargo check` clean.
- **Fix:** Added `#[allow(dead_code)]` annotation to `EvalRunRecord`, `eval_history_path`, `read_eval_history`, `compute_eval_signal`, `compute_capgap_signal`, `classify_autoupdate`, `compute_autoupdate_signal`. This is the same pattern Plan 17-02 used on `prior_severity_map` for the same forward-wiring reason.
- **Files modified:** src-tauri/src/doctor.rs
- **Verification:** Final `cargo check` exits clean with zero warnings; all 17 doctor::tests still pass; tests reach the symbols directly so the annotations don't hide a real dead-code bug.
- **Committed in:** Task 3 commit `1227c39`

**2. [Rule 3 - Blocking] Added `summarize` to imports of 3 eval modules**

- **Found during:** Task 3 (kg_integrity_eval, typed_memory_eval, capability_gap_eval)
- **Issue:** Plan instructed reusing `let s = summarize(&rows);` but those 3 modules did not have `summarize` in their `use super::harness::{...}` import block. Plan called this out explicitly ("3 of 5 modules already declare `let s = summarize(&rows);`") but the missing import side of the equation needed a one-token edit.
- **Fix:** Added `summarize` to the three import blocks. hybrid_search_eval and real_embedding_eval already had it.
- **Files modified:** kg_integrity_eval.rs, typed_memory_eval.rs, capability_gap_eval.rs
- **Verification:** All 9 cargo test --lib evals tests pass; verify-eval.sh exits 0.
- **Committed in:** Task 3 commit `1227c39`

---

**Total deviations:** 2 auto-fixed (1 missing critical clean-warnings pass, 1 blocking import)
**Impact on plan:** Both auto-fixes were forced by the plan's success criteria (`cargo check` clean) and scope (`reuse summarize`). Zero scope creep.

## Issues Encountered

- **Compile time dominated wall-clock:** Three sequential cargo test cycles (~3-5 min each on this WSL machine) consumed ~12-15 min of execution time. No regressions surfaced; each cycle was a clean pass.
- **Plan-vs-tree drift on lib.rs anchor:** Plan said `lib.rs:555` for the updater Builder; actual position is `lib.rs:556` (the `tauri-plugin-updater` line on Cargo.toml is at line 25 as documented). The autoupdate signal works regardless because the check is substring-grep, not line-based; documenting the drift here in case Plan 17-04/17-05 also references the line number.

## User Setup Required

None — no external service configuration required for Plan 17-03. tests/evals/history.jsonl is auto-populated on every cargo test --lib evals run; the directory was already established in Plan 17-01 (.gitkeep at tests/evals/.gitkeep).

## Next Phase Readiness

- **Plan 17-04 unblocked:** Wave 1's other half (TentacleHealth + ConfigDrift signal sources + orchestrator + event emission) can now proceed. The signal-source signature pattern is established (synchronous `fn -> Result<DoctorSignal, String>`).
- **Plan 17-05 unblocked:** doctor_run_full_check orchestrator can wire all 5 sources via tokio::join! once Plan 17-04 lands the remaining two. The Plan 17-03 sources are #[allow(dead_code)]; that suppression is removed when 17-05 calls them.
- **Plan 17-06 unblocked for prototyping:** DoctorPane.tsx can stub against the live snake_case wire format (`eval_scores | capability_gaps | tentacle_health | config_drift | auto_update`) — Plan 17-02 + 17-03's serde annotations are stable.

## Self-Check: PASSED

Verified:
- `src-tauri/src/doctor.rs` exists and contains all 7 new symbols (`compute_eval_signal`, `compute_capgap_signal`, `compute_autoupdate_signal`, `classify_autoupdate`, `eval_history_path`, `read_eval_history`, `EvalRunRecord`) — 20 grep matches across acceptance markers
- `src-tauri/src/evals/{hybrid_search,real_embedding,kg_integrity,typed_memory,capability_gap}_eval.rs` each contain exactly one `super::harness::record_eval_run("<module_name>"` line, placed AFTER `print_eval_table(...)` and BEFORE the floor `assert!` block
- Commits exist: d416c4c (Task 1), 6e93fb0 (Task 2), 1227c39 (Task 3) — all on master
- `cargo test --lib doctor::tests -- --test-threads=1` → 17/17 pass, 0 failed
- `cargo test --lib evals -- --test-threads=1` → 9/9 pass, 0 failed (no Phase 16 regression)
- `bash scripts/verify-eval.sh` → exits 0, all 5 floors green, 5 scored tables emitted
- `cargo check` → clean, zero warnings
- `tests/evals/history.jsonl` populated with 5 lines after the verify-eval run (one per module, all floor_passed: true at mrr 1.0)

---
*Phase: 17-doctor-module*
*Completed: 2026-04-30*
