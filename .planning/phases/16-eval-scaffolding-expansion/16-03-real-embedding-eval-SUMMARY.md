---
phase: 16-eval-scaffolding-expansion
plan: 03
subsystem: evals
tags: [eval, real-embedding, fastembed, AllMiniLML6V2, harness-consumer, wave-2]
requires:
  - .planning/phases/16-eval-scaffolding-expansion/16-01-harness-SUMMARY.md
provides:
  - real-embedding-floor: "7-query fastembed corpus; top-3 ≥ 80%, MRR ≥ 0.6 (observed 7/7 top-1, MRR 1.000)"
  - eval-module: "src-tauri/src/evals/real_embedding_eval.rs"
  - smoke-test: "embedder_produces_sane_vectors (dim ∈ [128,4096], magnitude > 0.1, distinct inputs distinct vectors)"
affects:
  - src-tauri/src/evals/real_embedding_eval.rs (replaced Wave 1 stub)
tech-stack:
  added: []
  patterns: [harness-consumer, real-fastembed-end-to-end-recall]
key-files:
  created: []
  modified:
    - src-tauri/src/evals/real_embedding_eval.rs
key-decisions:
  - "Inlined a 6-line local `cosine_similarity` helper in the smoke test rather than widening `embeddings::cosine_similarity` to `pub`. Keeps `embeddings.rs` line count invariant at 946 (Plan 16-07's deletion arithmetic depends on this) and avoids exporting a math primitive purely for one test."
  - "Original `mod memory_recall_real_embedding` block at `embeddings.rs:730-946` left in place; deletion is Plan 16-07's responsibility after all Wave 2 evals are green."
  - "7-query corpus moved verbatim — RESEARCH §'Deferred Ideas' explicitly defers 50+ query expansion to v1.3."
patterns-established:
  - "Real-fastembed harness consumer: temp_blade_env() for isolated db, embed_texts(&[...]) for both corpus + query embedding (same path production uses), summarize+print_eval_table+top1_hit/topk_hit/reciprocal_rank/EvalRow drawn from super::harness::*."
requirements-completed: [EVAL-03]
metrics:
  duration: "~6 min wall (Write + 2m cargo build cold + 4s test run)"
  started: "2026-04-29T20:23:10Z"
  completed: "2026-04-29T20:29:01Z"
  tasks_completed: 1
  tasks_total: 1
  files_modified: 1
  commits: 1
requirements: [EVAL-03]
---

# Phase 16 Plan 03: Real Embedding Eval Summary

**Relocated end-to-end fastembed `AllMiniLML6V2` recall eval from `embeddings.rs:730-946` into `evals/real_embedding_eval.rs`, swapped inlined helpers for `super::harness::*`, and proved the 7-query / 8-fact baseline still scores 7/7 top-1 / MRR 1.000 against the real model.**

## Performance

- **Duration:** ~6 min wall (5m51s)
- **Started:** 2026-04-29T20:23:10Z
- **Completed:** 2026-04-29T20:29:01Z
- **Tasks:** 1/1
- **Files modified:** 1
- **Commits:** 1 (test) + 1 (docs metadata) = 2

## Accomplishments

- `src-tauri/src/evals/real_embedding_eval.rs` populated (1 line stub → 277 lines).
- Source `embeddings.rs:730-946` (`mod memory_recall_real_embedding` + smoke sub-fn) moved verbatim with helpers swapped to `super::harness::*`.
- 8-fact BLADE-shaped corpus (`mem_owner_name`, `mem_family_mom`, `mem_lang_pref`, `mem_exercise`, `mem_meeting`, `mem_food`, `mem_oncall`, `mem_birthday`) preserved exactly.
- 7 natural-language scenarios (direct possessive / paraphrase / semantic association / lexical-light) preserved exactly.
- Floor enforcement (`top-3 ≥ 80%, MRR ≥ 0.6`) routed through `harness::summarize` instead of inlined arithmetic.
- Smoke test `embedder_produces_sane_vectors` retained verbatim from `embeddings.rs:921-945` (dim ∈ [128, 4096], magnitude > 0.1, distinct inputs produce distinct vectors).
- Original `embeddings.rs:730-946` block left in place — line count invariant at 946 (Plan 16-07 deletes).
- Second harness consumer of the real-fastembed path (alongside Plan 16-02's synthetic path) — strengthens EVAL-01's "≥2 modules use the harness" satisfaction.

## Task Commits

1. **Task 1: Extract real-embedding eval to evals/real_embedding_eval.rs** — `c3005ed` (test)

**Plan metadata:** to be appended in the final commit (this SUMMARY + STATE.md update).

## Files Created/Modified

- `src-tauri/src/evals/real_embedding_eval.rs` — replaced Wave 1 stub with full eval (277 lines): module doc, `use super::harness::*` imports, local `cosine_similarity` helper for smoke test, `Fact` struct + `fact_corpus()` (8 verbatim entries), `build_real_store()` calling real `embed_texts(&texts)`, `RealScenario` struct + `real_scenarios()` (7 verbatim entries), `#[test] fn evaluates_real_embedding_recall` (per-row push to `Vec<EvalRow>`, `print_eval_table`, `summarize`-driven floor asserts), `#[test] fn embedder_produces_sane_vectors` (smoke verbatim from src 921-945).

## Eval Result

```
┌── Memory recall eval (real fastembed AllMiniLML6V2) ──
│ direct_mom_name                  top1=✓ top3=✓ rr=1.00 → top3=["mem_family_mom", "mem_owner_name", "mem_birthday"] (want=mem_family_mom)
│ direct_birthday                  top1=✓ top3=✓ rr=1.00 → top3=["mem_birthday", "mem_meeting", "mem_exercise"] (want=mem_birthday)
│ paraphrase_exercise              top1=✓ top3=✓ rr=1.00 → top3=["mem_exercise", "mem_birthday", "mem_meeting"] (want=mem_exercise)
│ paraphrase_standup               top1=✓ top3=✓ rr=1.00 → top3=["mem_meeting", "mem_birthday", "mem_exercise"] (want=mem_meeting)
│ paraphrase_lang                  top1=✓ top3=✓ rr=1.00 → top3=["mem_lang_pref", "mem_food", "mem_owner_name"] (want=mem_lang_pref)
│ semantic_pizza                   top1=✓ top3=✓ rr=1.00 → top3=["mem_food", "mem_birthday", "mem_lang_pref"] (want=mem_food)
│ direct_oncall                    top1=✓ top3=✓ rr=1.00 → top3=["mem_oncall", "mem_meeting", "mem_exercise"] (want=mem_oncall)
├─────────────────────────────────────────────────────────
│ top-1: 7/7 (100%)  top-3: 7/7 (100%)  MRR: 1.000
└─────────────────────────────────────────────────────────
```

### Asserted floor (7 baseline scenarios)

| Metric | Floor | Observed | Margin |
|---|---|---|---|
| top-1 | (informational) | 7/7 (100%) | n/a |
| top-3 | ≥ 80% | 7/7 (100%) | +20pp |
| MRR | ≥ 0.6 | 1.000 | +0.40 |

### Cold-start runtime

- **Cold compile + run (this session):** Initial `cargo test --no-run` — `2m 1s` (full lib rebuild after touching evals tree).
- **Test run wall time:** `3.85s` reported by `cargo test` for both tests combined. The fastembed model was warm from a prior verification run earlier in the day, so the 20-30s cold-download window was already paid; subsequent runs reuse the global `OnceLock<EMBEDDER>`.
- **Expected first-run cold path on a clean machine:** 30-90s (RESEARCH §10 R3). Documented in module header.

## Verification

**Cargo command:**
```bash
cd src-tauri && cargo test --lib evals::real_embedding_eval -- --nocapture --test-threads=1
```

**Exit code:** 0
**Test result:** `2 passed; 0 failed; 0 ignored; 0 measured; 149 filtered out; finished in 3.85s`

- `evaluates_real_embedding_recall` — passed (top-3 7/7 ≥ 80%, MRR 1.000 ≥ 0.6)
- `embedder_produces_sane_vectors` — passed (dim 384 ∈ [128, 4096], magnitude non-zero, two distinct inputs produced cosine < 0.999)

**EVAL-06 contract:** stdout contains `┌──` (U+250C U+2500 U+2500) opening — confirmed via `grep -q '┌──' /tmp/16-03-out.log`.

## Acceptance criteria — all green

- [x] `src-tauri/src/evals/real_embedding_eval.rs` exists (277 lines, ≥200 floor)
- [x] File is no longer the Wave 1 stub
- [x] `use super::harness` import present (named imports of `print_eval_table`, `reciprocal_rank`, `summarize`, `temp_blade_env`, `top1_hit`, `topk_hit`, `EvalRow`)
- [x] `use crate::embeddings::` import present (`embed_texts`, `SearchResult`, `VectorStore`)
- [x] `fn evaluates_real_embedding_recall` defined and passes
- [x] `fn embedder_produces_sane_vectors` defined and passes
- [x] `AllMiniLML6V2` model name in title
- [x] Zero `todo!()` markers
- [x] `cargo test --lib evals::real_embedding_eval --no-run` exits 0
- [x] `cargo test --lib evals::real_embedding_eval -- --nocapture --test-threads=1` exits 0
- [x] Stdout contains `┌──`
- [x] MRR ≥ 0.6 (observed 1.000)
- [x] top-3 ≥ 80% (observed 100%)
- [x] Original `mod memory_recall_real_embedding` block in `embeddings.rs` STILL PRESENT (file unchanged at 946 lines)
- [x] EVAL-03 (real) requirement covered (already marked complete by Plan 16-02; this plan adds the real-fastembed half of the gate)

## Decisions Made

1. **Inlined a local `cosine_similarity` helper rather than widening `embeddings::cosine_similarity` to `pub`.** The original `mod memory_recall_real_embedding` had `use super::*;` access to private items in `embeddings.rs`; the relocated module is in a sibling tree so it cannot. The 6-line dot-product/norm calc is duplicated only in the smoke test path; the recall eval itself never calls it. Trade-off: tiny code duplication vs. exporting a math primitive purely for an eval. Chose duplication — keeps the production surface narrow and `embeddings.rs` line count invariant at 946 so Plan 16-07's deletion arithmetic stays clean.
2. **Did NOT expand the 7-query corpus.** RESEARCH §"Deferred Ideas" explicitly defers 50+ query expansion to v1.3. Verbatim move only.
3. **Did NOT delete `embeddings.rs:730-946`.** Plan 16-07 owns the deletion in Wave 3.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] Replaced `crate::embeddings::cosine_similarity` import with a local copy**
- **Found during:** Task 1 compile-check (`cargo test --no-run`)
- **Issue:** `error[E0603]: function cosine_similarity is private` — `embeddings.rs:33` defines it as `fn`, not `pub fn`. The original `mod memory_recall_real_embedding` accessed it via `use super::*;` from inside `embeddings.rs`; the relocated module is in `evals/`, a sibling tree, so private access is no longer possible.
- **Fix:** Inlined a local 6-line `cosine_similarity(a, b)` helper in `real_embedding_eval.rs` (verbatim formula: `dot / (norm_a * norm_b)` with zero-norm guard returning 0.0). Used only by the smoke test; the recall eval itself doesn't call it.
- **Files modified:** `src-tauri/src/evals/real_embedding_eval.rs`
- **Verification:** `cargo test --lib evals::real_embedding_eval --no-run` exit 0; smoke test passes (cosine of "hello world" vs "rust async tokio" < 0.999 as expected).
- **Committed in:** `c3005ed` (Task 1 commit)

**Rationale for not exporting:** Two alternatives were considered. (a) Add `pub` to `embeddings::cosine_similarity:33` — widens the public surface for one test. (b) Add a `pub fn cosine_similarity` to `harness.rs` — same widening, just relocated, plus pulls a math primitive into the harness which currently only contains eval-shaped helpers (RR/MRR/top-k/box-printer). Inlining keeps the harness focused on eval shape, keeps `embeddings.rs` line count invariant at 946 (Plan 16-07's deletion arithmetic depends on this), and isolates the duplication to the test path where it belongs.

---

**Total deviations:** 1 auto-fixed (Rule 3 — blocking)
**Impact on plan:** Minimal — the inline helper is 6 lines and isolated to the smoke test. No scope creep. `embeddings.rs` surface unchanged.

## Issues Encountered

None beyond the deviation logged above. Cold compile took ~2m (full lib rebuild after touching `evals/`); subsequent test runs are sub-5s.

## Threat surface scan

No new security-relevant surface introduced. The eval is `#[cfg(test)]`-gated (via Cargo's automatic test config when running `cargo test --lib`), runs only under `cargo test`, exposes no new IPC commands, and the 8-fact corpus is fully synthetic (Arnav / Priya / Mumbai / Tuesday / Neapolitan / payments-oncall / March 15 — fictional template content per T-16-03-01). The fastembed model download (T-16-03-02) is gated by HTTPS + checksum verification per the `fastembed` crate; cold-start latency (T-16-03-03) is documented in the module header. No production code paths modified.

## TDD Gate Compliance

This plan was a relocation, not a new-feature TDD cycle. The frontmatter `type: execute` (not `type: tdd`) reflects that. The single commit is type `test(...)` because the moved content is itself test code. RED/GREEN/REFACTOR gate sequence does not apply to verbatim relocations.

## Next Plan Readiness

- Wave 2 progress: 2/5 plans complete (16-02 ✅ done, 16-03 ✅ done; 16-04, 16-05, 16-06 still parallel-ready).
- Real-fastembed harness consumer #1 live; harness usage count for EVAL-01 satisfaction now sits at hybrid_search_eval + real_embedding_eval (≥ 2 modules ✅).
- Plan 16-07's deletion target — `embeddings.rs:496-728` (synthetic mod) + `embeddings.rs:730-946` (real mod) — both still in place; line count invariant at 946.
- No blockers for downstream Wave 2 work or for Plan 16-07's eventual deletion sweep.

## Self-Check: PASSED

- File exists: `src-tauri/src/evals/real_embedding_eval.rs` (277 lines) — FOUND
- Commit: `c3005ed test(16-03): replace real_embedding_eval stub with full fastembed AllMiniLML6V2 recall eval` — FOUND in `git log`
- Original `embeddings.rs:730-946` preservation — FOUND (`grep "memory_recall_real_embedding"` hits, file still 946 lines)
- Test pass: `cargo test --lib evals::real_embedding_eval -- --nocapture --test-threads=1` exit 0 — VERIFIED
- EVAL-06 delimiter `┌──` in stdout — VERIFIED
- Floor 7/7 (top-3 100%, MRR 1.000) — VERIFIED, exceeds 80%/0.6 floor

---
*Phase: 16-eval-scaffolding-expansion*
*Completed: 2026-04-29*
