---
phase: 16
plan: 01
subsystem: eval-harness
tags: [evals, harness, scaffolding, test-infrastructure, EVAL-01]
requires: []
provides:
  - "src-tauri/src/evals/ module tree (mod.rs + harness.rs + 5 stub files)"
  - "harness::HasSourceId trait + SearchResult impl"
  - "harness::EvalRow / EvalSummary structs"
  - "harness::reciprocal_rank / top1_hit / topk_hit (generic over HasSourceId)"
  - "harness::summarize / print_eval_table (EVAL-06 ┌── format)"
  - "harness::temp_blade_env (TempDir + BLADE_CONFIG_DIR + db::init_db)"
  - "#[cfg(test)] mod evals registration in src-tauri/src/lib.rs"
affects:
  - "src-tauri/src/lib.rs (added 2 lines after mod embeddings;)"
tech_stack:
  added: []
  patterns:
    - "extracted helpers from embeddings.rs:586-601, :820-835, :870-899"
    - "HasSourceId trait abstraction lets RR/MRR helpers serve KG + typed_memory rows in Wave 2"
    - "EvalRow.relaxed flag carries adversarial-fixture gate-relaxation through summarize()"
key_files:
  created:
    - "src-tauri/src/evals/mod.rs (15 lines, declares pub harness + 5 cfg(test) submods)"
    - "src-tauri/src/evals/harness.rs (186 lines, all shared eval helpers)"
    - "src-tauri/src/evals/hybrid_search_eval.rs (stub — Wave 2 / Plan 16-02)"
    - "src-tauri/src/evals/real_embedding_eval.rs (stub — Wave 2 / Plan 16-03)"
    - "src-tauri/src/evals/kg_integrity_eval.rs (stub — Wave 2 / Plan 16-04)"
    - "src-tauri/src/evals/typed_memory_eval.rs (stub — Wave 2 / Plan 16-05)"
    - "src-tauri/src/evals/capability_gap_eval.rs (stub — Wave 2 / Plan 16-06)"
  modified:
    - "src-tauri/src/lib.rs (added #[cfg(test)] mod evals; after mod embeddings;)"
decisions:
  - "Used #[cfg(test)] gating on every evals declaration so release builds carry zero eval code (RESEARCH §3 contract)"
  - "Added 5 stub submodule files in Wave 1 (rather than Wave 2) to prevent a compile-broken intermediate state — mod hybrid_search_eval; etc. would fail without them"
  - "Made HasSourceId trait + impl-for-SearchResult generic so Wave 2's KG and typed_memory evals can reuse the same RR/MRR helpers without rewriting them per-row-type"
  - "Placed #[cfg(test)] mod evals; immediately after mod embeddings; (line 82) for discoverability — both modules are part of the same memory-recall surface"
metrics:
  duration_seconds: 3287
  duration_human: "54m47s (44m of which was cold cargo build)"
  tasks_completed: 3
  tasks_total: 3
  files_created: 7
  files_modified: 1
  completed_at: "2026-04-29T19:53:54Z"
---

# Phase 16 Plan 01: Eval Harness Scaffolding Summary

**One-liner:** Centralized RR/MRR scoring + EVAL-06 box-drawing scored-table printer + temp_blade_env helper into `src-tauri/src/evals/harness.rs` — extracted verbatim from the inlined duplicates in `embeddings.rs:586-601` / `:820-835` / `:870-899` — and registered `#[cfg(test)] mod evals;` in `lib.rs` so all 5 Wave 2 eval modules have a shared compile target.

## What Shipped

Wave 1 of Phase 16 — sole prerequisite for Wave 2. Three tasks, three commits, all green.

### Task 1 — Module tree root + 5 stub siblings

Created `src-tauri/src/evals/`:

```
src-tauri/src/evals/
├── mod.rs                       (declares `pub mod harness` + 5 cfg(test) submods)
├── harness.rs                   (Wave 1 — this plan; 186 lines)
├── hybrid_search_eval.rs        (stub; Wave 2 / Plan 16-02 fills in)
├── real_embedding_eval.rs       (stub; Wave 2 / Plan 16-03 fills in)
├── kg_integrity_eval.rs         (stub; Wave 2 / Plan 16-04 fills in)
├── typed_memory_eval.rs         (stub; Wave 2 / Plan 16-05 fills in)
└── capability_gap_eval.rs       (stub; Wave 2 / Plan 16-06 fills in)
```

`mod.rs` is gated 6× with `#[cfg(test)]` (one per declaration line). Stubs are 1-line `//! Phase 16 eval — populated in Wave 2 (Plan NN).` shells — present so `mod hybrid_search_eval;` etc. resolve in Wave 1, which prevents a compile-broken bisect zone between waves.

**Commit:** `d54a8fb`

### Task 2 — `harness.rs` shared helpers

Created `src-tauri/src/evals/harness.rs` (186 lines). Exported public symbols (line numbers in the file):

| Symbol | Line | Source |
|--------|------|--------|
| `pub trait HasSourceId` | 25 | new abstraction (lets KG + typed_memory rows reuse same helpers) |
| `impl HasSourceId for SearchResult` | 30 | new — bridge to embeddings module |
| `pub struct EvalRow` | 38 | new — per-row scored-table state |
| `pub struct EvalSummary` | 54 | new — both "all" and "asserted" rollups |
| `pub fn reciprocal_rank<T: HasSourceId>` | 67 | extracted from `embeddings.rs:586` |
| `pub fn top1_hit<T: HasSourceId>` | 79 | extracted from `embeddings.rs:595` |
| `pub fn topk_hit<T: HasSourceId>` | 85 | extracted from `embeddings.rs:599` |
| `pub fn summarize` | 90 | new — drives both "all" and "asserted" math at once |
| `pub fn print_eval_table` | 135 | extracted from `embeddings.rs:870-899` (canonical `{:32}` format) |
| `pub fn temp_blade_env` | 181 | extracted from `embeddings.rs:570-572` |

Module-level doc comment locks 3 contracts:

1. **EVAL-06:** every eval calls `print_eval_table` which leads with `┌──` (U+250C U+2500 U+2500). `verify-eval.sh` greps stdout for this prefix.
2. **`safe_slice` rule (CLAUDE.md):** current label width is `{:32}` (left-pad — UTF-8 safe). If a future edit changes to `{:.32}` (byte-truncate), the unicode adversarial fixture in `hybrid_search_eval` will panic. Future edits MUST use `crate::safe_slice` for any width-truncating change.
3. **Cargo parallelism (RESEARCH §10 R1):** `temp_blade_env` mutates `BLADE_CONFIG_DIR` (process-global env var). All eval invocations MUST pin `--test-threads=1`.

**Commit:** `57457ea`

### Task 3 — Register `mod evals;` in `lib.rs` + verify compile

Inserted 2 lines after `mod embeddings;` (line 82):

```rust
mod embeddings;
#[cfg(test)]
mod evals;
mod files;
```

CLAUDE.md "Module registration (EVERY TIME)" 3-step rule: only step 1 applies. No `#[tauri::command]` (no flat-namespace collision risk), no `BladeConfig` field changes (no 6-place rule).

**Compile verification:** `cd src-tauri && cargo test --lib evals::harness --no-run` — exit 0, last line `Finished \`test\` profile [unoptimized + debuginfo] target(s) in 44m 53s`. The 44-minute cold compile is the dependency graph rebuilding; subsequent runs hit the cache. Five `dead_code` warnings on the harness's pub fns are expected — Wave 2 evals consume them; nothing in Wave 1 imports them yet.

**Commit:** `e6a0b02`

## Verification Evidence

Per Phase 16's "no UI surface" carve-out (RESEARCH.md "Project Constraints" + CLAUDE.md "blade-uat applies to runtime/UI changes"), the build evidence here is `cargo test` green, NOT a screenshot. Stop hook trigger on "done" claim is a documented false positive for this phase.

| Check | Command | Result |
|-------|---------|--------|
| Files created | `ls src-tauri/src/evals/*.rs \| wc -l` | 7 (1 mod + 1 harness + 5 stubs) |
| Public fns in harness | `grep -c '^pub fn ' src-tauri/src/evals/harness.rs` | 6 (`reciprocal_rank`, `top1_hit`, `topk_hit`, `summarize`, `print_eval_table`, `temp_blade_env`) — ≥ 3 floor satisfied |
| Trait + struct exports | `grep -cE '^pub (trait\|struct) ' src-tauri/src/evals/harness.rs` | 3 (`HasSourceId`, `EvalRow`, `EvalSummary`) |
| Box-drawing prefix | `grep -q '┌──' src-tauri/src/evals/harness.rs` | exit 0 — EVAL-06 contract met |
| `safe_slice` doc | `grep -q 'safe_slice' src-tauri/src/evals/harness.rs` | exit 0 |
| `lib.rs` registration | `grep -A1 '^#\[cfg(test)\]$' src-tauri/src/lib.rs \| grep -q '^mod evals;$'` | exit 0 |
| Single registration | `grep -c '^mod evals;$' src-tauri/src/lib.rs` | 1 (no duplication) |
| Compile gate | `cd src-tauri && cargo test --lib evals::harness --no-run` | exit 0, "Finished `test` profile" |
| `embeddings.rs` preservation (Plan 16-07's job, NOT this one) | `grep -n "mod memory_recall_eval" src-tauri/src/embeddings.rs` | line 510 — STILL PRESENT |
| `embeddings.rs` length | `wc -l src-tauri/src/embeddings.rs` | 946 lines — unchanged |

## Deviations from Plan

None. Plan 16-01 executed exactly as written. The PLAN.md spelled out the stub-files-in-Task-1 strategy explicitly; the harness symbol set, the 6-place compile-target list, and the lib.rs insertion point were all locked verbatim. No Rule 1/2/3 auto-fixes triggered. No Rule 4 architectural questions surfaced.

## Authentication Gates

None — Phase 16 is `cargo test`-only with zero network surface (the synthetic eval is hand-rolled vectors; the real-embedding eval downloads model weights but lives in Plan 16-03, not here).

## TDD Gate Compliance

N/A — Plan 16-01 is `type: execute` (not `type: tdd`). The harness has zero `#[test]` functions of its own — it's pure plumbing. EVAL-01's "exported helpers used by ≥2 eval modules" floor is satisfied transitively when Wave 2 lands (each of Plans 02–06 imports `super::harness::*`).

## Known Stubs

Five 1-line stub files exist as scaffolding for Wave 2:

| File | Stub line | Resolved by |
|------|-----------|-------------|
| `src-tauri/src/evals/hybrid_search_eval.rs` | `//! Phase 16 eval — populated in Wave 2 (Plan 16-02).` | Plan 16-02 |
| `src-tauri/src/evals/real_embedding_eval.rs` | `//! Phase 16 eval — populated in Wave 2 (Plan 16-03).` | Plan 16-03 |
| `src-tauri/src/evals/kg_integrity_eval.rs` | `//! Phase 16 eval — populated in Wave 2 (Plan 16-04).` | Plan 16-04 |
| `src-tauri/src/evals/typed_memory_eval.rs` | `//! Phase 16 eval — populated in Wave 2 (Plan 16-05).` | Plan 16-05 |
| `src-tauri/src/evals/capability_gap_eval.rs` | `//! Phase 16 eval — populated in Wave 2 (Plan 16-06).` | Plan 16-06 |

These are intentional. Each carries a forward-pointer to the Wave 2 plan that fills it in. They were specified verbatim by Plan 16-01 (Task 1, "Files this task creates" list) and explicitly justified there: without the stubs, `mod hybrid_search_eval;` etc. in `mod.rs` fail to resolve, breaking `cargo test --lib evals --no-run` in Wave 1 and creating a broken-bisect window between Waves 1 and 2.

## Threat Flags

None. The plan's `<threat_model>` accepted all 3 STRIDE entries (T-16-01-01 through T-16-01-03) as LOW severity:

- T-16-01-01 (Information disclosure via `BLADE_CONFIG_DIR`) — accepted; `#[cfg(test)]` gating + `--test-threads=1` mitigates.
- T-16-01-02 (Tampering with eval files) — accepted; commit-access boundary covers it.
- T-16-01-03 (TempDir leak on panic) — accepted; `tempfile::TempDir` Drop is well-established + OS auto-cleans.

No new surface was introduced beyond what `embeddings.rs:570-572` already shipped.

## Wave 2 Readiness

Plan 16-01's `provides:` list is complete. Wave 2 plans (16-02 through 16-06) can now `use super::harness::*;` and consume:

- `HasSourceId` trait + the `SearchResult` impl (search-style evals get RR/MRR for free)
- `EvalRow { label, top1, top3, rr, top3_ids, expected, relaxed }` (per-row scored-table state)
- `EvalSummary` (rollup over rows — both "all" and "asserted" math)
- `reciprocal_rank` / `top1_hit` / `topk_hit` / `summarize` (the math primitives)
- `print_eval_table` (locked EVAL-06 box-drawing format)
- `temp_blade_env` (TempDir + BLADE_CONFIG_DIR + db::init_db one-shot)

EVAL-01's "exported helpers used by ≥2 eval modules" criterion will go green when Plan 16-02 (hybrid_search_eval) and Plan 16-03 (real_embedding_eval) both import `super::harness::*` — both planned imports are documented in 16-PATTERNS.md and 16-RESEARCH.md.

**DO NOT delete `embeddings.rs:496-946` in this plan.** That's Plan 16-07's job, gated on Wave 2 evals being green (so the move is provably equivalent).

## Self-Check: PASSED

- `src-tauri/src/evals/mod.rs` — FOUND
- `src-tauri/src/evals/harness.rs` — FOUND (186 lines, ≥120 floor)
- `src-tauri/src/evals/hybrid_search_eval.rs` — FOUND (stub)
- `src-tauri/src/evals/real_embedding_eval.rs` — FOUND (stub)
- `src-tauri/src/evals/kg_integrity_eval.rs` — FOUND (stub)
- `src-tauri/src/evals/typed_memory_eval.rs` — FOUND (stub)
- `src-tauri/src/evals/capability_gap_eval.rs` — FOUND (stub)
- `src-tauri/src/lib.rs` — `#[cfg(test)] mod evals;` registered (single occurrence, post-`mod embeddings;`)
- `cargo test --lib evals::harness --no-run` — exit 0 (`Finished test profile`)
- `embeddings.rs:496-946` — STILL PRESENT (line 510 + line 748 confirmed; 946 total LoC unchanged)
- Commit `d54a8fb` (Task 1) — FOUND in `git log --oneline`
- Commit `57457ea` (Task 2) — FOUND in `git log --oneline`
- Commit `e6a0b02` (Task 3) — FOUND in `git log --oneline`
