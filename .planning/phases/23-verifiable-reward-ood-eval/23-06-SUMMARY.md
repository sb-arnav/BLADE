---
phase: 23-verifiable-reward-ood-eval
plan: 06
subsystem: testing

tags: [evals, ood, harness, cargo-test, cfg-test, reward-05]

requires:
  - phase: 23-verifiable-reward-ood-eval
    provides: "OOD eval module sources (adversarial_eval.rs, ambiguous_intent_eval.rs, capability_gap_stress_eval.rs) authored in Plans 23-03/04/05"
provides:
  - "evals/mod.rs registers all 3 OOD modules behind #[cfg(test)] in lockstep"
  - "cargo test --lib evals exercises 8 modules and emits 8 EVAL-06 box-drawing tables"
  - "tests/evals/history.jsonl gains rows for all 3 OOD modules with floor_passed:true"
affects: [23-07-doctor-ood-card, 23-08-claude-md-update, 23-09-verify-eval-bump]

tech-stack:
  added: []
  patterns:
    - "Module registration matches existing eval pattern: #[cfg(test)] mod <name>_eval; (no pub qualifier)"
    - "OOD module ordering mirrors MODULE_FLOOR descent (0.85 → 0.80 → 0.75)"

key-files:
  created:
    - .planning/phases/23-verifiable-reward-ood-eval/23-06-SUMMARY.md
  modified:
    - src-tauri/src/evals/mod.rs

key-decisions:
  - "Append-after-capability_gap_eval (not alphabetical sort) — preserves MODULE_FLOOR descending order pattern from PATTERNS.md"
  - "verify-eval.sh EXPECTED=5 left untouched — Plan 23-09 owns the bump (LAST-of-phase ordering constraint)"

patterns-established:
  - "Lockstep mod-registration: 3 OOD modules added together, not staged across plans"
  - "EVAL-06 contract verified per-module via grep '┌──' on --nocapture stdout, in addition to cargo exit code"

requirements-completed: [REWARD-05]

duration: 19m 25s
completed: 2026-05-01
---

# Phase 23 Plan 06: OOD Module Registration Summary

**3-line `#[cfg(test)] mod` append in `evals/mod.rs` brings adversarial / ambiguous-intent / capability-gap-stress eval modules online; `cargo test --lib evals` now exercises 8 modules and emits 8 EVAL-06 tables.**

## Performance

- **Duration:** 19m 25s (dominated by initial `cargo test` build at 7m 09s + `cargo build --lib` at 11m 07s for `#[cfg(test)]` gate verification)
- **Started:** 2026-05-01T13:55:45Z
- **Completed:** 2026-05-01T14:15:10Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments
- 3 OOD eval modules now mod-registered behind `#[cfg(test)]`, matching the existing 5-module pattern verbatim
- All 3 module floors pass on first invocation (top-1=100%, top-3=100%, MRR=1.000) — well above the 0.85 / 0.80 / 0.75 floors
- `tests/evals/history.jsonl` gained rows for each new module with `floor_passed:true`
- Production build (`cargo build --lib`) finishes cleanly — `#[cfg(test)]` gate confirmed by Rust compiler (modules absent from non-test artifact)
- `verify-eval.sh` reports `8/5 scored tables emitted, all floors green` (exit 0) — EXPECTED floor still 5, satisfied with 8

## Task Commits

1. **Task 1: Register 3 OOD modules in evals/mod.rs (lockstep)** — `5e105f7` (feat)

## Files Created/Modified

- `src-tauri/src/evals/mod.rs` — Appended 3 lines after `#[cfg(test)] mod capability_gap_eval;`:
  ```rust
  #[cfg(test)] mod adversarial_eval;            // Phase 23 / REWARD-05
  #[cfg(test)] mod ambiguous_intent_eval;       // Phase 23 / REWARD-05
  #[cfg(test)] mod capability_gap_stress_eval;  // Phase 23 / REWARD-05
  ```

## Verification Evidence

### Per-module floors (cargo test --lib evals::<module> -- --nocapture)

| Module                        | Top-1   | Top-3   | MRR   | Floor | Result |
|-------------------------------|---------|---------|-------|-------|--------|
| adversarial_eval              | 17/17 (100%) | 17/17 (100%) | 1.000 | 0.85  | PASS   |
| ambiguous_intent_eval         | 18/18 (100%) | 18/18 (100%) | 1.000 | 0.80  | PASS   |
| capability_gap_stress_eval    | 17/17 (100%) | 17/17 (100%) | 1.000 | 0.75  | PASS   |

### Full evals run (cargo test --lib evals -- --nocapture --test-threads=1)
- `test result: ok. 12 passed; 0 failed; 0 ignored; 0 measured; 377 filtered out; finished in 3.42s`
- 8 `┌──` headers emitted (`grep -c '┌──' = 8`)
- All 8 modules visible: hybrid_search, real_embedding, kg_integrity, typed_memory, capability_gap, adversarial, ambiguous_intent, capability_gap_stress

### history.jsonl (last 10 rows captured)
- `module:"adversarial_eval"` × 2 rows (single-module run + full-suite run), `floor_passed:true`, MRR=1.0
- `module:"ambiguous_intent_eval"` × 2 rows, `floor_passed:true`, MRR=1.0
- `module:"capability_gap_stress_eval"` × 2 rows, `floor_passed:true`, MRR=1.0

### verify-eval.sh (EXPECTED unchanged)
- `grep -q '^EXPECTED=5' scripts/verify-eval.sh` exits 0
- `bash scripts/verify-eval.sh` exits 0 with: `[verify-eval] OK — 8/5 scored tables emitted, all floors green`
- Plan 23-09 owns the bump to `EXPECTED=8` per LAST-of-phase ordering constraint

### #[cfg(test)] gate (production exclusion)
- `cargo build --lib` completes successfully — no OOD modules linked in non-test artifact (Rust compiler enforces `#[cfg(test)]` automatically)

## Decisions Made

- **Insertion point:** Appended after `#[cfg(test)] mod capability_gap_eval;` (line 15 → 16-18) rather than alphabetical sort. PATTERNS.md called for MODULE_FLOOR-descending order (0.85 → 0.80 → 0.75) which matches plan-specified order. Future eval modules should continue this pattern (most-stable first).
- **EXPECTED=5 left alone:** Per PATTERNS.md §"MOD" §Gotchas, raising EXPECTED mid-wave with only some modules wired would break the gate. Plan 23-09 is the dedicated owner of the bump.

## Deviations from Plan

None — plan executed exactly as written. The 3-line append, the per-module test invocation, the full-suite run, and the verify-eval.sh non-bump all landed precisely as specified in `<tasks>` and `<phase_constraints>`.

## Issues Encountered

None. Initial `cargo test` invocation took 7m 09s for the test-profile incremental build (expected for a first compile after upstream OOD module additions); subsequent invocations under 6 seconds.

## User Setup Required

None — no external service configuration touched.

## Next Phase Readiness

- **Plan 23-07 (Doctor OOD card):** Ready. The 3 new history.jsonl rows are in place; Doctor reader plumbing already supports per-module rows from Phase 17 D-14.
- **Plan 23-08 (CLAUDE.md update):** Ready. Module names are now stable for documentation references.
- **Plan 23-09 (verify-eval.sh EXPECTED bump):** Ready. With 8 modules emitting 8 tables, the bump from 5 → 8 is a safe one-liner change.

## Self-Check: PASSED

- `src-tauri/src/evals/mod.rs` exists and contains all 3 new mod lines (verified via `grep`)
- Commit `5e105f7` exists in `git log` (verified)
- `tests/evals/history.jsonl` exists and contains 2 rows per new OOD module (verified via `grep -c`)
- All 3 cargo test invocations exited 0 (verified)
- `bash scripts/verify-eval.sh` exits 0 (verified)

---
*Phase: 23-verifiable-reward-ood-eval*
*Completed: 2026-05-01*
