---
phase: 16-eval-scaffolding-expansion
plan: 07
subsystem: eval-gate
tags: [eval, verify-chain, ci, deletion, scope-cleanup]
requires:
  - 16-01-harness  # shared eval harness (RR/MRR helpers, scored-table printer)
  - 16-02-hybrid-search-eval  # synthetic 4-dim hybrid recall
  - 16-03-real-embedding-eval  # real fastembed AllMiniLML6V2 recall
  - 16-04-kg-integrity-eval  # KG round-trip + idempotent-merge
  - 16-05-typed-memory-eval  # 7-category recall + cross-category isolation
  - 16-06-capability-gap-eval  # detect_missing_tool classifier
provides:
  - eval-ci-gate  # `npm run verify:eval` enforces ≥5 scored tables
  - verify-chain-31  # `verify:all` count 30 → 31
  - deferred-evals-doc  # `tests/evals/DEFERRED.md` (LLM-API evals → v1.3)
  - reclaimed-lines  # 451 lines of obsolete inline tests removed from embeddings.rs
affects:
  - scripts/verify-eval.sh
  - scripts/verify-wiring-audit-shape.mjs  # Rule-3 scope expansion (see Deviations)
  - tests/evals/DEFERRED.md
  - package.json
  - src-tauri/src/embeddings.rs
tech-stack:
  added:
    - bash 4+ (verify-eval.sh wrapper)
  patterns:
    - "set -uo pipefail + cargo test --lib evals + grep -c '┌──' table-presence guard"
    - "package.json verify:all chain extension via && tail-append"
    - "ROADMAP/REQUIREMENTS [x] checkbox flip on plan close"
key-files:
  created:
    - scripts/verify-eval.sh
    - tests/evals/DEFERRED.md
  modified:
    - package.json  # verify:eval script + verify:all chain tail
    - scripts/verify-wiring-audit-shape.mjs  # Rule-3 deviation
    - src-tauri/src/embeddings.rs  # -451 lines (496-946 deleted)
    - .planning/REQUIREMENTS.md  # EVAL-06 / EVAL-07 / EVAL-08 → [x]
    - .planning/ROADMAP.md  # Plan 16-07 → [x]
    - .planning/STATE.md  # Phase 16 → ready-for-verification
decisions:
  - "wiring-audit module count excludes src-tauri/src/evals/ (test-only #[cfg(test)] tree) instead of backfilling 7 entries into 10-WIRING-AUDIT.json — production wiring audit should not inventory test code"
  - "verify:eval pinned to --test-threads=1 (BLADE_CONFIG_DIR env races without it) and --nocapture (println! must reach stdout for the ┌── grep target)"
  - "EXPECTED=5 in verify-eval.sh (not 4 per RESEARCH §6 sketch) — Wave 2 shipped 5 eval modules (hybrid_search + real_embedding + kg_integrity + typed_memory + capability_gap); plan-checker review caught the count discrepancy"
  - "DEFERRED.md committed at tests/evals/ (repo-root path) not src-tauri/src/evals/ — RESEARCH §10 R10 confirmed location"
  - "embeddings.rs deletion uses sed -i '496,946d' rather than block-Edit because the boundary lines (`}` line 494 and `// ─── Eval harness` line 496) are unique fence markers and the diff is verifiable as removal-only"
metrics:
  duration_minutes: ~25
  completed: 2026-04-29
  tasks_planned: 3
  tasks_completed: 3
  deviations: 1  # Rule-3 wiring-audit script fix
  commits: 4  # e17f8ca + bf3311d (prior executor) + bcb7c57 + 438740f (resumed)
  lines_added: ~7  # script comment + 5-line filter
  lines_deleted: 451  # embeddings.rs:496-946
  net_lines: -444
---

# Phase 16 Plan 07: Verify-Eval Gate Summary

Wires the 5 Phase-16 eval modules into the verify chain via `scripts/verify-eval.sh` + `npm run verify:eval` + a `verify:all` chain-tail entry. Documents 3 LLM-API-dependent evals as v1.3 candidates in `tests/evals/DEFERRED.md`. Deletes the now-obsolete inline test modules from `embeddings.rs` (lines 496-946; -451 lines). Closes Phase 16.

## Files Created

### `scripts/verify-eval.sh` (Task 1, prior executor — commit `e17f8ca`)

47-line bash wrapper. `set -uo pipefail` + `command -v cargo` PATH check + `(cd src-tauri && cargo test --lib evals --quiet -- --nocapture --test-threads=1)` + `grep -c '┌──'` table-presence guard. Exit-code contract:

| Exit | Meaning |
|------|---------|
| 0 | cargo green AND ≥5 scored tables emitted |
| 1 | cargo failed (assertion regression) |
| 2 | <5 `┌──` headers (some module forgot `print_eval_table` or `--nocapture` was stripped) |
| 3 | cargo not on PATH or build error before tests ran |

Header documents the contract verbatim; references RESEARCH §6 + harness.rs + mod.rs.

### `tests/evals/DEFERRED.md` (Task 2, prior executor — commit `bf3311d`)

3 structured entries — each with **Rationale**, **Budget**, and **Promotion Trigger** paragraphs:

1. **`extract_conversation_facts` precision** — needs hand-labelled corpus + live LLM calls (~$0.15-$0.30/CI run). Promotion trigger: v1.3 ships curated 50-transcript corpus + budget allocation.
2. **`weekly_memory_consolidation` correctness** — stochastic LLM-driven; deterministic seed unsupported. Promotion trigger: temperature=0 config + statistical floor framework (~$0.50/CI run).
3. **`evolution` suggestion quality** — human-judgement ground truth needs telemetry BLADE deliberately doesn't collect (zero-telemetry per PROJECT.md, $0.50-$1.00/cycle). Promotion trigger: opt-in feedback channel on `CapabilityReports.tsx`.

Zero TBD placeholders. `grep -c '^## '` returns 3 (≥3 EVAL-08 floor).

## Files Modified

### `package.json` (Task 2, prior executor — commit `bf3311d`)

- Added `"verify:eval": "bash scripts/verify-eval.sh"` script entry (line 40).
- Appended `&& npm run verify:eval` to the `verify:all` chain tail. Live chain count moved 30 → 31. (REQUIREMENTS.md spec count was "27 → 28+"; both correct — REQ counts the spec, live counts the actual chain.)
- JSON parses cleanly via `node -e "JSON.parse(require('fs').readFileSync('package.json'))"`.

### `scripts/verify-wiring-audit-shape.mjs` (Rule-3 deviation — commit `bcb7c57`)

**Not in original Plan 16-07 scope.** See "Deviations" section below for full rationale.

5-line addition in `checkModules()` filter — skips files whose path contains `/evals/` (or `\evals\`). Inline comment documents why: "evals/ is `#[cfg(test)]`-gated test code; not in production wiring audit". Live `.rs` count under `src-tauri/src/` drops 203 → 196, matching the 196 entries in `10-WIRING-AUDIT.json`. Gate green.

### `src-tauri/src/embeddings.rs` (Task 3, this executor — commit `438740f`)

Deleted lines 496-946 (the `// ─── Eval harness` comment block + `mod memory_recall_eval` + `mod memory_recall_real_embedding`). File shrinks 946 → 495 lines (-451). Production code (lines 1-489: `embed_texts`, `VectorStore`, `SearchResult`, `cosine_similarity`, `hybrid_search`, RRF math, all `#[tauri::command]` entry points) is **byte-identical** — verified via `git diff --stat` showing `1 file changed, 0 insertions(+), 451 deletions(-)`.

The relocated test modules are now their own canonical homes:
- `mod memory_recall_eval` → `src-tauri/src/evals/hybrid_search_eval.rs` (Plan 16-02)
- `mod memory_recall_real_embedding` → `src-tauri/src/evals/real_embedding_eval.rs` (Plan 16-03)

The new evals carry their own private `cosine_similarity` helper (verbatim formula) so they don't need the original to be `pub` — confirmed via `grep -rn cosine_similarity src-tauri/src/evals/`.

## Deviations from Plan

### Rule-3 Auto-fix: wiring-audit script scope expansion

**Found during:** Pre-Task-3 verify chain run (resumed executor's startup verification).

**Issue:** Phase 16 Wave 1 (Plan 16-01) scaffolded `src-tauri/src/evals/{mod,harness}.rs` and Wave 2 (Plans 16-02 through 16-06) added 5 more eval modules — a total of 7 new `.rs` files. Live `.rs` count under `src-tauri/src/` climbed 196 → 203. The wiring-audit JSON (`.planning/milestones/v1.1-phases/10-inventory-wiring-audit/10-WIRING-AUDIT.json`) carries 196 production module rows. The AUDIT-01 gate (`scripts/verify-wiring-audit-shape.mjs --check=modules`) compares `audit.modules.length` against the live `.rs` walk and threw `modules.length (196) !== live .rs count under src-tauri/src/ (203)` — failing `npm run verify:all` and blocking the Plan-16-07 deletion safety gate.

**Fix:** Two valid options were considered:

1. **Backfill 7 entries into `10-WIRING-AUDIT.json`** — represent each `evals/` file as a `module` row with classification `ACTIVE`. Pros: keeps the script unchanged. Cons: pollutes a production-wiring inventory with `#[cfg(test)]`-gated code; the audit's `classification` enum doesn't have a "test-only" value; downstream consumers (DOCTOR signals, dead-code analysis) would have to special-case test modules.
2. **Filter out `src-tauri/src/evals/` from the script's `.rs` walk** — treat the `evals/` tree as out-of-scope for the wiring audit because every file in it is `#[cfg(test)]`-gated test infrastructure. Pros: conceptually correct (a wiring audit inventories runtime modules, not test code); 5-line change; future eval modules are auto-excluded. Cons: cements a directory-name convention.

**Chose option 2** — orchestrator's call. The fix is a 5-line filter in `checkModules()` with an inline comment naming the convention. After the edit, `npm run verify:wiring-audit-shape` reports `196 .rs files match modules.length` and exits 0.

**Files modified:** `scripts/verify-wiring-audit-shape.mjs`
**Commit:** `bcb7c57` — `fix(16-07): exclude test-only evals/ tree from wiring-audit module count`

This was a Rule 3 (auto-fix blocking issue) deviation — the existing chain was failing on a gate unrelated to Plan 16-07's intent, and the fix was a small mechanical script edit, not an architectural change. Not Rule 4 — no architectural decisions, just a directory-name filter.

## Pre/Post-Deletion Gates

| Gate | Pre-Deletion (after script fix) | Post-Deletion |
|------|-----|------|
| `npm run verify:all` | exit 0 (31 gates green) | exit 0 (31 gates green) |
| `cargo test --lib evals -- --nocapture --test-threads=1` | exit 0; 8 passed | exit 0; 8 passed |
| `bash scripts/verify-eval.sh` | exit 0; 5/5 scored tables | exit 0; 5/5 scored tables |
| `wc -l src-tauri/src/embeddings.rs` | 946 | 495 |

`git diff` of the deletion commit: `1 file changed, 451 deletions(-)` — confirmed zero additions. Production code lines 1-489 byte-identical.

## Eval Module Test Results (Post-Deletion)

| Module | Tests | Top-1 | Top-3 | MRR |
|--------|-------|-------|-------|-----|
| `evals::hybrid_search_eval` | 12 (8 asserted + 4 relaxed) | 10/12 (asserted 8/8 100%) | 11/12 (asserted 8/8 100%) | 0.875 (asserted 1.000) |
| `evals::real_embedding_eval` | 7 | 7/7 (100%) | 7/7 (100%) | 1.000 |
| `evals::kg_integrity_eval` | 5 | 5/5 (100%) | 5/5 (100%) | 1.000 |
| `evals::typed_memory_eval` | 8 | 8/8 (100%) | 8/8 (100%) | 1.000 |
| `evals::capability_gap_eval` | 7 | 7/7 (100%) | 7/7 (100%) | 1.000 |

All asserted floors met. `cargo test --lib evals` reports `8 passed; 0 failed; 0 ignored`. Build time post-deletion: ~7s warm-cache.

## Phase 16 Wrap-Up

ROADMAP Phase 16 Success Criteria — all 4 green:

- **SC-1**: `cargo test --lib evals` runs ≥4 eval modules with all green — **YES** (5 modules, 39 test cases, 0 failures)
- **SC-2**: `verify:eval` gate present in `verify:all` chain (count moves from 27 → 28+) — **YES** (live chain 30 → 31; spec said 27 → 28+, both correct per VALIDATION §"REQ-vs-Live")
- **SC-3**: Each eval module prints scored stdout table in the existing `┌──` format — **YES** (5/5 tables emitted, verified by `grep -c '┌──'` ≥ 5 in `verify-eval.sh`)
- **SC-4**: `tests/evals/DEFERRED.md` documents LLM-API-dependent evals as v1.3 candidates — **YES** (3 entries: extract_conversation_facts / weekly_memory_consolidation / evolution suggestion quality; each with Rationale + Budget + Promotion Trigger)

Phase 16 = 7 plans / 3 waves / 6 commits + meta = closed.

## REQ-vs-Live Count Note

REQUIREMENTS.md (line 24) said `verify:all` chain "moves from 27 → 28+". Live `package.json:41` shows the chain has 30 entries pre-Plan-16-07 and 31 after. Both numbers are consistent: REQUIREMENTS counts the v1.1-locked spec (which itself counted 27 gates at v1.1 close); the chain accreted 3 more during late-v1.1 / interphase work without REQUIREMENTS-MD updates. VALIDATION.md acknowledges this drift and treats both as authoritative for their respective scopes.

## Self-Check: PASSED

- [x] `scripts/verify-eval.sh` exists, executable, contains `set -uo pipefail`, `cargo test --lib evals`, `test-threads=1`, `EXPECTED=5`, `┌──`
- [x] `bash scripts/verify-eval.sh` exits 0 (5/5 scored tables)
- [x] `tests/evals/DEFERRED.md` exists, ≥3 `## ` sections, each with Rationale + Budget + Promotion Trigger paragraphs, zero TBDs
- [x] `package.json` carries `"verify:eval": "bash scripts/verify-eval.sh"` and `verify:all` chain tail `&& npm run verify:eval`
- [x] `npm run verify:all` exits 0 (31 gates green)
- [x] `src-tauri/src/embeddings.rs` is 495 lines (was 946); zero hits for `memory_recall_eval`, `memory_recall_real_embedding`, `Eval harness`; production API (`pub fn embed_texts`, `pub struct VectorStore`, `pub struct SearchResult`) intact
- [x] `cargo test --lib evals -- --nocapture --test-threads=1` exits 0 (8 passed)
- [x] `git log --oneline -5` shows `438740f`, `bcb7c57`, `bf3311d`, `e17f8ca` — all 4 Plan-16-07 commits land
- [x] EVAL-06 / EVAL-07 / EVAL-08 → `[x]` in REQUIREMENTS.md
- [x] Plan 16-07 → `[x]` in ROADMAP.md
- [x] STATE.md frontmatter `total_plans: 72 / completed_plans: 72 / percent: 100`; status updated to "Phase 16 ready for `/gsd-execute-phase` verification step"
- [x] No Co-Authored-By lines in any of the 4 commits
