---
phase: 16-eval-scaffolding-expansion
plan: 02
subsystem: evals
tags: [eval, hybrid-search, synthetic, adversarial, harness-consumer, wave-2]
requires:
  - .planning/phases/16-eval-scaffolding-expansion/16-01-harness-SUMMARY.md
provides:
  - synthetic-hybrid-search-floor: "8/8 asserted scenarios; top-3 ≥ 80%, MRR ≥ 0.6"
  - eval-module: "src-tauri/src/evals/hybrid_search_eval.rs"
  - adversarial-fixtures: "long-content, unicode-CJK-emoji, near-duplicate-pair (all relaxed)"
affects:
  - src-tauri/src/evals/hybrid_search_eval.rs (replaced Wave 1 stub)
tech-stack:
  added: []
  patterns: [harness-consumer, gate-relaxed-adversarial, synthetic-4-dim-embeddings]
key-files:
  created: []
  modified:
    - src-tauri/src/evals/hybrid_search_eval.rs
decisions:
  - "Adversarial fixtures (3) added as relaxed in this iteration — surface in table, excluded from floor math. Promotion to asserted deferred until baseline behavior observed across multiple runs (RESEARCH §7 EVAL-03)."
  - "Original mod memory_recall_eval block at embeddings.rs:510-728 left in place; deletion is Plan 16-07's responsibility after all Wave 2 evals are green."
metrics:
  duration: "~9 min (8m05s build + 1m wall test/verify)"
  completed: "2026-04-29T20:18:32Z"
  tasks_completed: 1
  tasks_total: 1
  files_modified: 1
  commits: 1
requirements: [EVAL-03]
---

# Phase 16 Plan 02: Hybrid Search Eval Summary

**One-liner:** Relocated synthetic 4-dim hybrid-search regression eval from `embeddings.rs:496-728` into `evals/hybrid_search_eval.rs`, swapped inline helpers for `super::harness::*`, and added 3 relaxed adversarial fixtures (long content / CJK+emoji / near-duplicate pair) — asserted 8/8 floor preserved (top-3 100%, MRR 1.000).

## What shipped

- **File replaced (Wave 1 stub → full eval module):** `src-tauri/src/evals/hybrid_search_eval.rs` (1 line → 355 lines).
- **Source relocated:** `embeddings.rs:496-728` (`mod memory_recall_eval`) — header doc comment + `Fixture` struct + 8-fixture `corpus()` + `build_test_store()` + 9 baseline scenarios + `evaluates_recall_quality` test body + 2 smoke tests (`empty_query_returns_empty`, `empty_store_returns_empty`).
- **Helper swap:** Three inlined helpers (`reciprocal_rank`, `top1_hit`, `topk_hit` — formerly at `embeddings.rs:586-601`) replaced with named imports from `super::harness::*`. The roll-up + table printing now go through `harness::summarize` and `harness::print_eval_table` — second harness consumer beyond Wave 1's smoke tests, satisfying EVAL-01's "≥2 modules use the harness" criterion.
- **Adversarial fixtures added (3, all `relaxed: true`):**
  - `mem_long_capability_gap` (~1.4KB) — realistic BLADE-shaped capability-gap log entry stressing BM25 length normalisation on long documents.
  - `mem_unicode_food` — `ユーザーはラーメン (Tonkotsu, シェフAkira at 谷中の店) を週2回食べる 🍜` — CJK + emoji to stress Unicode tokenization in BM25 + safe printing in the table.
  - `mem_runs_wednesday` — single-token variant of `mem_personal_runs` (Tuesday → Wednesday); identical embedding `[0.0, 0.85, 0.10, 0.0]` to expose ranking ties.
- **Original block preserved:** `embeddings.rs` still 946 lines; `mod memory_recall_eval` block intact at lines 510-728. Plan 16-07 owns the deletion.

## Eval result

```
┌── Hybrid search regression eval (synthetic 4-dim) ──
│ rust_async_intent                top1=✓ top3=✓ rr=1.00 → top3=[mem_rust_async, mem_long_capability_gap, mem_rust_macro] (want=mem_rust_async)
│ work_standup_intent              top1=✓ top3=✓ rr=1.00 → top3=[mem_work_standup, mem_work_oncall, mem_long_capability_gap] (want=mem_work_standup)
│ personal_runs_intent             top1=✓ top3=✓ rr=1.00 → top3=[mem_personal_runs, mem_runs_wednesday, mem_personal_birthday] (want=mem_personal_runs)
│ food_pizza_intent                top1=✓ top3=✓ rr=1.00 → top3=[mem_food_pizza, mem_unicode_food, mem_food_coffee] (want=mem_food_pizza)
│ keyword_boost_pizza              top1=✓ top3=✓ rr=1.00 → top3=[mem_food_pizza, mem_rust_async, mem_rust_macro] (want=mem_food_pizza)
│ keyword_boost_async              top1=✓ top3=✓ rr=1.00 → top3=[mem_rust_async, mem_food_coffee, mem_long_capability_gap] (want=mem_rust_async)
│ adversarial_morning_disambig     top1=✓ top3=✓ rr=1.00 → top3=[mem_personal_runs, mem_runs_wednesday, mem_unicode_food] (want=mem_personal_runs)
│ adversarial_keyword_overrides_vector top1=✓ top3=✓ rr=1.00 → top3=[mem_food_pizza, mem_rust_async, mem_rust_macro] (want=mem_food_pizza)
│ adversarial_stopwords_only       top1=✗ top3=✗ rr=0.00 → top3=[mem_rust_async, mem_rust_macro, mem_personal_birthday] (want=mem_food_coffee) (relaxed)
│ adversarial_long_content         top1=✓ top3=✓ rr=1.00 → top3=[mem_long_capability_gap, mem_work_oncall, mem_work_standup] (want=mem_long_capability_gap) (relaxed)
│ adversarial_unicode              top1=✓ top3=✓ rr=1.00 → top3=[mem_unicode_food, mem_food_coffee, mem_food_pizza] (want=mem_unicode_food) (relaxed)
│ adversarial_near_duplicate       top1=✗ top3=✓ rr=0.50 → top3=[mem_personal_runs, mem_runs_wednesday, mem_personal_birthday] (want=mem_runs_wednesday) (relaxed)
├─────────────────────────────────────────────────────────
│ top-1: 10/12 (83%)  top-3: 11/12 (92%)  MRR: 0.875
│ asserted (gate floors): top-1: 8/8 (100%)  top-3: 8/8 (100%)  MRR: 1.000
└─────────────────────────────────────────────────────────
```

### Asserted floor (8 baseline scenarios)
| Metric | Floor | Observed | Margin |
|---|---|---|---|
| top-1 | (informational) | 8/8 (100%) | n/a |
| top-3 | ≥ 80% | 8/8 (100%) | +20pp |
| MRR | ≥ 0.6 | 1.000 | +0.40 |

### Relaxed rows (4 — surfaced for inspection only)
| Label | top-1 | top-3 | RR | Notes |
|---|---|---|---|---|
| `adversarial_stopwords_only` | ✗ | ✗ | 0.00 | Pre-existing relaxed scenario; stop-words query returns rust mems by BM25 noise — expected behavior on noise input. |
| `adversarial_long_content` | ✓ | ✓ | 1.00 | NEW — long-doc fixture wins clean (work-axis embedding aligned). |
| `adversarial_unicode` | ✓ | ✓ | 1.00 | NEW — CJK+emoji fixture wins clean (food-axis embedding aligned, "ラーメン Tonkotsu" tokens hit). |
| `adversarial_near_duplicate` | ✗ | ✓ | 0.50 | NEW — Tuesday wins top-1 over Wednesday (stable order on tied embedding); Wednesday lands at rank 2 via BM25 token boost. **Expected** behavior — captures the ranking-tie surface for future promotion. |

## Verification

**Cargo command:**
```bash
cd src-tauri && cargo test --lib evals::hybrid_search_eval -- --nocapture --test-threads=1
```

**Exit code:** 0
**Test result:** `3 passed; 0 failed; 0 ignored; 0 measured; 146 filtered out; finished in 1.11s`

- `evaluates_synthetic_hybrid_recall` — passed (asserted floor satisfied)
- `empty_query_returns_empty` — passed (no panic, ≤ top_k results)
- `empty_store_returns_empty` — passed (empty input → empty output)

**EVAL-06 contract:** stdout contains `┌──` (U+250C U+2500 U+2500) opening — confirmed via `grep -q '┌──' /tmp/16-02-out.log`.

## Acceptance criteria — all green

- [x] `src-tauri/src/evals/hybrid_search_eval.rs` exists (355 lines, ≥240 floor)
- [x] `use super::harness` import present (named imports of `print_eval_table`, `reciprocal_rank`, `summarize`, `temp_blade_env`, `top1_hit`, `topk_hit`, `EvalRow`)
- [x] `use crate::embeddings::{SearchResult, VectorStore}` import present
- [x] `fn evaluates_synthetic_hybrid_recall` defined and passes
- [x] `mem_long_capability_gap`, `mem_unicode_food`, `mem_runs_wednesday` all present
- [x] `ラーメン` (CJK content) present
- [x] Zero `todo!()` markers
- [x] `cd src-tauri && cargo test --lib evals::hybrid_search_eval --no-run --test-threads=1` exits 0
- [x] `cd src-tauri && cargo test --lib evals::hybrid_search_eval -- --nocapture --test-threads=1` exits 0
- [x] Stdout contains `┌──`
- [x] Asserted-rollup line shows MRR 1.000 (≥ 0.6 floor)
- [x] Asserted-rollup line shows top-3 100% (≥ 80% floor)
- [x] `mod memory_recall_eval` block in `embeddings.rs` STILL PRESENT (file unchanged at 946 lines)
- [x] EVAL-03 (synthetic) requirement satisfied

## Deviations from Plan

None — plan executed exactly as written. Single task, single commit, all gates green on first run.

## Threat surface scan

No new security-relevant surface introduced. The eval is `#[cfg(test)]`-gated, runs only under `cargo test`, exposes no new IPC commands, and the long-content fixture text is fully synthetic with `example.com` repos / fictional npm package names. No production code paths modified. Threat register T-16-02-01/02/03 all hold at LOW severity.

## Self-Check: PASSED

- File exists: `src-tauri/src/evals/hybrid_search_eval.rs` (355 lines) — FOUND
- Commit: `bbdd0f6 test(16-02): replace hybrid_search_eval stub with full synthetic 4-dim eval` — FOUND in `git log`
- Original `embeddings.rs:510-728` preservation — FOUND (`grep "mod memory_recall_eval"` hits, file still 946 lines)
- Test pass: `cargo test --lib evals::hybrid_search_eval -- --nocapture --test-threads=1` exit 0 — VERIFIED
- EVAL-06 delimiter `┌──` in stdout — VERIFIED
- Asserted floor 8/8 (top-3 100%, MRR 1.000) — VERIFIED
