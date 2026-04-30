# Phase 16: Eval Scaffolding Expansion — Research

**Researched:** 2026-04-29
**Domain:** Rust eval/test scaffolding for memory cluster, knowledge graph, capability-gap detection
**Confidence:** HIGH (everything verified by reading the live source; no library APIs to chase)

## Summary

Phase 16 takes the existing **two inline test modules** in `embeddings.rs` (`memory_recall_eval` at line 510 — synthetic 4-dim, and `memory_recall_real_embedding` at line 748 — real fastembed) and turns them into a **named eval harness**: shared helpers in one place, four eval modules covering hybrid search / knowledge graph / typed memory / capability-gap detection, scored stdout tables in a fixed format, and a `verify:eval` gate wired into `verify:all` so floor breaches fail CI.

The work is almost entirely **Rust unit-test scaffolding**, no library research needed — `tempfile` and `fastembed` are already in `Cargo.toml`. The only library question is "where do these tests live so `cargo test --lib evals` resolves cleanly", and the live code answers it: the existing modules already use `#[cfg(test)] mod foo_eval { use super::*; ... }` inside each owning .rs file, but their names don't contain the substring `evals` (plural). REQ wording forces us to either rename or move.

**Primary recommendation:** Create a top-level `src-tauri/src/evals/` module tree with `mod evals;` in `lib.rs` (gated `#[cfg(test)]`) holding `mod harness; mod hybrid_search_eval; mod kg_integrity_eval; mod typed_memory_eval; mod capability_gap_eval;`. Move the two existing inline modules into this tree (rename `memory_recall_eval` → `evals::hybrid_search_eval`, `memory_recall_real_embedding` → keep as a sub-module of `evals::hybrid_search_eval` or hoist as `evals::real_embedding_eval`). Shared helpers (`reciprocal_rank`, `top1_hit`, `topk_hit`, the scored-table printer) move to `evals::harness`. `cargo test --lib evals -- --nocapture` then matches all four modules cleanly. `verify:eval` is a 25-line bash wrapper that runs that command and greps stdout for the `┌──` delimiter to confirm tables printed.

## User Constraints

CONTEXT.md does not exist for this phase (no `/gsd-discuss-phase` was run; orchestrator dispatched research directly per the workflow). All constraints come from `REQUIREMENTS.md` (EVAL-01..08), `notes/v1-2-milestone-shape.md` (locked 2026-04-29 by Arnav), and `ROADMAP.md` Phase 16 success criteria.

### Locked Decisions (from milestone shape + REQUIREMENTS)

- Phase numbering continues globally — this is **Phase 16** (M-05 carries over).
- 4 eval modules minimum, all in `cargo test --lib evals` resolution.
- Each eval prints a scored table in the `memory_recall_real_embedding` format (label / top1 / top3 / rr / top3-ids / wanted) with a `┌──` delimiter.
- Floors must be enforced — `assert!` failures fail the build.
- `verify:eval` gate added to `verify:all` chain (count moves 27 → 28+).
- LLM-API-dependent evals (extract_conversation_facts, weekly_memory_consolidation, evolution suggestion quality) are **deferred** to v1.3 with rationale + budget in `tests/evals/DEFERRED.md` — not implemented in Phase 16.
- Phase is `cargo test`-only; no UI surface, no UAT. The `blade-uat` protocol explicitly does NOT apply (CLAUDE.md "Verification protocol applies to runtime/UI changes" carve-out).

### Claude's Discretion

- Exact file layout under `evals/` (subject to "REQ wording wins where ambiguous" tie-breaker).
- Choice between bash wrapper vs direct cargo invocation for `verify:eval`.
- Adversarial fixture content (long content / unicode / near-duplicates) — author needs to pick concrete strings that exercise BM25 + cosine in interesting ways.
- KG fixture corpus content (concept names / edge types) — must be valid against `KnowledgeNode` / `KnowledgeEdge` schemas but the *content* is open.

### Deferred Ideas (OUT OF SCOPE)

- LLM-API-driven evals (precision of `extract_conversation_facts`, correctness of `weekly_memory_consolidation`, suggestion quality of `evolution.rs::run_evolution_cycle`) — listed in `DEFERRED.md` per EVAL-08, NOT implemented.
- Doctor-pane visualization of eval scores — that's Phase 17 (DOCTOR-02 reads what Phase 16 produces).
- Real-data corpora (export from a real BLADE install) — synthetic fixtures only in Phase 16.
- Replacing `embeddings.rs::memory_recall_real_embedding`'s 7-query corpus with 50+ queries — keep its current shape, add as new module.
- Multi-language fixtures beyond a single CJK + emoji adversarial entry — internationalization is its own phase.

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| EVAL-01 | `tests/evals/` directory with shared harness (fixture builders, RR/MRR helpers, scored-table printer); helpers used by ≥2 modules | §3 (shared harness module spec) — extract `reciprocal_rank` / `top1_hit` / `topk_hit` / `print_eval_table` from `embeddings.rs:586-601, 663-692, 820-835, 870-899` |
| EVAL-02 | Knowledge-graph integrity eval — fixture corpus stored, `consolidate_kg` invoked, asserts zero orphans | §5 (path resolution: REQ uses non-existent fn names; live API is `knowledge_graph::add_node` / `add_edge` / no `consolidate_kg` function — must build orphan-detection helper inline); §7 (kg fixture sketch) |
| EVAL-03 | BM25/hybrid regression — keep 8/8 floor, add 3 adversarial fixtures (long, unicode, near-dup), MRR ≥ 0.6 | §1 (existing baseline); §7 (concrete adversarial fixtures sketched) |
| EVAL-04 | typed_memory category recall — 7-category fixture, `recall_by_category` returns expected sets | §7 (typed_memory fixture sketch); `typed_memory.rs:267` is the call target |
| EVAL-05 | Capability-gap detection — synthetic stderr blobs to `detect_missing_tool`, asserts catalog entry | §5 (path resolution: live fn is `self_upgrade::detect_missing_tool`, NOT `evolution::`; verdict: import from real path, do NOT add a re-export); §7 (capability gap fixture sketch) |
| EVAL-06 | Every eval prints scored table with `┌──` delimiter | §4 (exact format spec extracted verbatim) |
| EVAL-07 | `verify:eval` gate added; `verify:all` count 27 → 28+ | §6 (wiring spec: bash wrapper at `scripts/verify-eval.sh`, exit-code contract, stdout assertions) |
| EVAL-08 | `DEFERRED.md` lists ≥3 LLM-API-dependent evals with rationale + budget | §8 (3-entry draft) |

## Project Constraints (from CLAUDE.md)

These are load-bearing for Phase 16 even though most are runtime-oriented:

- **Module registration 3-step:** `mod evals;` MUST be added to `lib.rs` (under `#[cfg(test)]`). No new `#[tauri::command]` here so `generate_handler!` is untouched. No new `BladeConfig` fields so 6-place pattern doesn't apply.
- **Don't run `cargo check` after every edit:** batch all edits, run `cargo test --lib evals` once at the end of each task.
- **Don't claim "done" from static gates alone:** the v1.1 lesson. **Carve-out:** Phase 16 has no runtime/UI surface — the test results ARE the runtime evidence. CLAUDE.md "Verification protocol applies to runtime/UI changes" + `blade-uat` skill scope-note explicitly exempt this phase. The build evidence is `cargo test --lib evals` green, not a screenshot.
- **`whisper-rs` is feature-flagged behind `local-whisper`:** default build does NOT need LLVM. `cargo test --lib evals` runs against the default feature set, so no env-var gymnastics.
- **`safe_slice` for non-ASCII:** the unicode adversarial fixture (EVAL-03) MUST use `crate::safe_slice` if it ever truncates user content. The eval's *fixture* content can be raw — only truncation paths need `safe_slice`.
- **Test mods are `#[cfg(test)]`:** the existing `mod memory_recall_eval` is gated. New `mod evals { ... }` MUST inherit the same gate so eval code never ships in release binaries.
- **No emojis in files unless asked:** the unicode fixture (EVAL-03) intentionally contains an emoji as a domain-realistic test character — this is the only emoji in the work product and it's load-bearing for the test, not decoration.
- **Cargo lib name is `blade_lib`** (verified `Cargo.toml` lines 1-3) — `cargo test --lib` targets that lib unambiguously.

## Architectural Responsibility Map

Pure-Rust phase. No multi-tier ownership questions. All work lives in the **library/test tier** of `src-tauri/`.

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Eval harness + fixtures | Rust lib `#[cfg(test)]` modules | — | Tests live with the lib they exercise; `cargo test --lib` is the canonical runner |
| Scored-table stdout | Rust `println!` inside test fn | — | Captured by `cargo test -- --nocapture`; consumed by `verify-eval.sh` grep |
| `verify:eval` gate | bash wrapper script | npm script | Mirrors existing `scripts/verify-*.sh` conventions (e.g. `verify-chat-rgba.sh`); npm script aliases bash wrapper |
| Floor enforcement | `assert!` inside test fn | — | Standard Rust; failed assertions exit non-zero, propagating through `cargo test` to the bash wrapper to npm to `verify:all` |

## 1. Existing Baseline Anatomy (verbatim)

**File:** `src-tauri/src/embeddings.rs` (verified read).

### `mod memory_recall_eval` (lines 510–728) — synthetic 4-dim

**Floor asserts (lines 698–707):**
```rust
assert!(
    (asserted_top3 as f32 / asserted_total) >= 0.80,
    "asserted top-3 recall {}/{} below 80% floor",
    asserted_top3, asserted_total as i32
);
assert!(
    asserted_mrr >= 0.6,
    "asserted MRR {:.3} below 0.6 floor",
    asserted_mrr
);
```

**Inlined helpers (lines 586–601):**
- `reciprocal_rank(results: &[SearchResult], expected: &str) -> f32` (line 586)
- `top1_hit(results: &[SearchResult], expected: &str) -> bool` (line 595)
- `topk_hit(results: &[SearchResult], expected: &str, k: usize) -> bool` (line 599)

**Fixture builder (lines 569–583):** `build_test_store() -> (TempDir, VectorStore)` — creates temp dir, sets `BLADE_CONFIG_DIR`, calls `crate::db::init_db()`, populates `VectorStore` from `corpus()`.

**Scenarios (lines 604–641):** 9 tuples, 5 tiers — clean axis (4), keyword boost (2), adversarial cross-domain (1), keyword-overrides-vector (1), noise-only relaxed (1).

**Edge tests:** `empty_query_returns_empty` (line 711), `empty_store_returns_empty` (line 720). These assert non-panic + bounded length, NOT recall floors.

**Sets `BLADE_CONFIG_DIR` env var** (line 571) — NOT thread-safe under `cargo test` parallelism. The current pattern only works because the two existing modules don't run their setup concurrently with each other on shared state. **This is a landmine** — see §10.

### `mod memory_recall_real_embedding` (lines 748–946) — real fastembed

**Floor asserts (lines 906–915):** identical floors (top-3 ≥ 80%, MRR ≥ 0.6) on a 7-query / 8-fact corpus.

**Inlined helpers (lines 820–835):** `reciprocal_rank`, `top1_hit`, `topk_hit` — duplicated from synthetic eval. **EVAL-01 mandates DRY-ing this.**

**Fixture (lines 760–795):** 8 BLADE-shaped facts (owner name, family, lang pref, exercise, meeting, food, oncall, birthday). Real `embed_texts` call (line 805) — same path production uses.

**Cost note (line 856):** "First-time model download can take 20-30s. Subsequent runs are fast (~1-2s for the embed pass + sub-second search)." This is the **cold-runner risk** on CI — see §10.

**Smoke test (line 922):** `embedder_produces_sane_vectors` — asserts dim 128–4096 (AllMiniLM-L6-v2 is 384), magnitude > 0.1, different inputs → cosine < 0.999.

### Verbatim scored-table format (the EVAL-06 contract)

From `memory_recall_real_embedding::evaluates_real_embedding_recall` (lines 870–899):

```text
┌── Memory recall eval (real fastembed AllMiniLML6V2) ──
│ <label:32}                top1=✓ top3=✓ rr=1.00 → top3=["a","b","c"] (want=mem_x)
│ <label:32}                top1=✗ top3=✓ rr=0.50 → top3=["b","c","a"] (want=mem_y)
├─────────────────────────────────────────────────────────
│ top-1: 7/7 (100%)  top-3: 7/7 (100%)  MRR: 1.000
└─────────────────────────────────────────────────────────
```

The synthetic eval (lines 663–692) uses an extra `asserted` summary row and a (relaxed) suffix marker. Both share the `┌── … ──` opening, `├─────…` mid-rule, `└─────…` close, and `│ ` per-row prefix. **§4 captures the exact format string for re-use.**

## 2. Canonical Eval Location — Recommendation

### Three plausible paths, evaluated

| Option | Path | `cargo test --lib evals` matches? | REQ-fidelity | Discoverability | Verdict |
|--------|------|-----------------------------------|--------------|-----------------|---------|
| (a) Inline `mod {x}_eval` per owning .rs | unchanged: `embeddings.rs::memory_recall_eval`, etc. | ✗ — current mod names contain "eval" not "evals"; renaming to `*_evals` would match but scatters helpers across files | LOW — REQ-01 says `tests/evals/` directory with shared helpers; impossible to share inline across files cleanly without a helpers module anyway | HIGH for that one file | ✗ |
| (b) `src-tauri/src/evals/` module tree under `mod evals;` in `lib.rs` | ✓ — `cargo test --lib evals` matches every fn whose path contains the segment `evals::*` | HIGH — mirrors REQ wording (`tests/evals/`) within Cargo's actual lib-test layout | HIGH — single dir to find all evals | ✓ **RECOMMENDED** |
| (c) Top-level `tests/evals/` integration tests (literal) | Resolves to `cargo test --test evals` not `--lib evals`; integration tests can't access `pub(crate)` items in `blade_lib` without re-exporting | LOW — REQ wording matches but ROADMAP success-criterion #1 says `cargo test --lib evals` (NOT `--test`); integration tests would fail that command | MEDIUM | ✗ |

### Verdict: Option (b)

`src-tauri/src/evals/` module tree, gated `#[cfg(test)]`, registered as `#[cfg(test)] mod evals;` in `lib.rs`.

**Reasoning:**
1. **REQ wording fidelity:** EVAL-01 says `tests/evals/`. ROADMAP success criterion #1 says `cargo test --lib evals`. (b) reconciles both: the *path* `src-tauri/src/evals/` reads as "tests/evals" within the test-mod tree of the lib, and `cargo test --lib evals` resolves it cleanly because the path contains the segment `evals`.
2. **Build-time:** identical to current — `#[cfg(test)]` skips the modules in release builds. No change to `cargo build` or `cargo check`.
3. **Discoverability:** one directory holds every eval module; `ls src-tauri/src/evals/` lists them all.
4. **Shared helpers:** trivial via `mod harness;` sibling module — every eval `use super::harness::*;`.
5. **REQ-02..05 are about modules that touch DIFFERENT subsystems** (kg / embeddings / typed_memory / self_upgrade) — keeping all four in one tree with one harness is strictly cleaner than scattering inline mods across four .rs files.

**Migration of existing tests:** move `mod memory_recall_eval` and `mod memory_recall_real_embedding` blocks out of `embeddings.rs` and into `src-tauri/src/evals/hybrid_search_eval.rs` (synthetic) + `src-tauri/src/evals/real_embedding_eval.rs` (fastembed) respectively. Scenarios + fixtures move with them; helpers extract to `src-tauri/src/evals/harness.rs`. The `embeddings.rs` file shrinks by ~436 lines.

**Trade-off documented:** (b) puts the corpus arrays one directory away from the production code they exercise. That's standard for any test tree and the REQ explicitly asks for `tests/evals/`. Worth it.

## 3. Shared Harness Module Spec

**File:** `src-tauri/src/evals/harness.rs` (new).

**Module declaration in `src-tauri/src/evals/mod.rs`:**
```rust
//! Eval harness — Phase 16 (.planning/phases/16-eval-scaffolding-expansion).
//!
//! Resolves with `cargo test --lib evals -- --nocapture`. Each submodule
//! prints a scored table in the format defined by `harness::print_eval_table`.

#[cfg(test)] pub mod harness;
#[cfg(test)] mod hybrid_search_eval;
#[cfg(test)] mod real_embedding_eval;
#[cfg(test)] mod kg_integrity_eval;
#[cfg(test)] mod typed_memory_eval;
#[cfg(test)] mod capability_gap_eval;
```

**Exported symbols from `harness.rs`:**

| Symbol | Signature | Source | Why shared |
|--------|-----------|--------|------------|
| `reciprocal_rank` | `fn reciprocal_rank<T: HasSourceId>(results: &[T], expected: &str) -> f32` | `embeddings.rs:586` (generalize over `SearchResult` via trait) | Used by hybrid_search_eval, real_embedding_eval, kg_integrity_eval (search-style asserts) |
| `top1_hit` | `fn top1_hit<T: HasSourceId>(results: &[T], expected: &str) -> bool` | `embeddings.rs:595` | Same |
| `topk_hit` | `fn topk_hit<T: HasSourceId>(results: &[T], expected: &str, k: usize) -> bool` | `embeddings.rs:599` | Same |
| `HasSourceId` | `pub trait HasSourceId { fn source_id(&self) -> &str; }` (impl for `embeddings::SearchResult` + any custom result type) | new | Lets the same RR/top-k helpers work across `SearchResult` (embeddings) and any kg/typed_memory result struct |
| `EvalRow` | `pub struct EvalRow { pub label: String, pub top1: bool, pub top3: bool, pub rr: f32, pub top3_ids: Vec<String>, pub expected: String, pub relaxed: bool }` | new | Single payload format every eval emits |
| `print_eval_table` | `fn print_eval_table(title: &str, rows: &[EvalRow])` | extracted from `embeddings.rs:663-692` and `:870-899` | The EVAL-06 contract — same format string everywhere |
| `summarize` | `fn summarize(rows: &[EvalRow]) -> EvalSummary` returning `{top1_pct, top3_pct, mrr, asserted_top3_pct, asserted_mrr}` | new — computes both "all" and "asserted" rollups | Lets each eval `assert!(summary.asserted_mrr >= 0.6)` without re-doing the math |
| `temp_blade_env` | `fn temp_blade_env() -> tempfile::TempDir` — sets `BLADE_CONFIG_DIR` to a fresh temp + initialises db | extracted from `embeddings.rs:570-572` | Every eval that touches SQLite-backed storage needs this. **Must serialize** — see §10 cargo parallelism landmine |

**Helper count: 7 (4 functions + 1 trait + 2 structs).** Used by ≥3 modules in the worst case (every search-style eval uses RR/top1/top3/print_eval_table); EVAL-01's "≥2 modules" floor is comfortably met.

**Optional later:** `fn assert_floor(summary: &EvalSummary, top3_floor: f32, mrr_floor: f32)` to centralize the assert-message format. Defer if it adds nothing — the current explicit `assert!` lines in each module are self-documenting.

## 4. Scored-Table Format Spec

**Extracted verbatim** from `embeddings.rs:870-899` (real-embedding eval, the EVAL-06 reference).

### Layout

```text
┌── {title} ──{horizontal rule to ~58 chars}
│ {label:<32}  top1={tick} top3={tick} rr={rr:.2} → top3={top3_ids:?} (want={expected}){relaxed_marker}
│ {label:<32}  top1={tick} top3={tick} rr={rr:.2} → top3={top3_ids:?} (want={expected}){relaxed_marker}
├─────────────────────────────────────────────────────────
│ top-1: {n}/{N} ({pct:.0}%)  top-3: {n}/{N} ({pct:.0}%)  MRR: {mrr:.3}
└─────────────────────────────────────────────────────────
```

### Format strings (Rust)

```rust
// Header (line 870 reference)
println!("\n┌── {} ──", title);

// Per-row (line 887 — :32 width on label is the canonical column)
println!(
    "│ {:32} top1={} top3={} rr={:.2} → top3={:?} (want={}){}",
    row.label,
    if row.top1 { "✓" } else { "✗" },
    if row.top3 { "✓" } else { "✗" },
    row.rr,
    row.top3_ids,
    row.expected,
    if row.relaxed { " (relaxed)" } else { "" },
);

// Mid-rule (line 892)
println!("├─────────────────────────────────────────────────────────");

// Summary row (line 893–898)
println!(
    "│ top-1: {}/{} ({:.0}%)  top-3: {}/{} ({:.0}%)  MRR: {:.3}",
    summary.top1_count, summary.total,
    (summary.top1_count as f32 / summary.total as f32) * 100.0,
    summary.top3_count, summary.total,
    (summary.top3_count as f32 / summary.total as f32) * 100.0,
    summary.mrr,
);

// Close (line 899)
println!("└─────────────────────────────────────────────────────────\n");
```

### Column widths

- **Label:** `{:32}` (left-padded to 32 chars). Synthetic eval uses `{:38}` (line 679); real eval uses `{:32}` (line 887). **Pick `{:32}` as canonical** — fits the "label / top1 / top3 / rr / top3-ids / wanted" header in 80 cols.
- **`rr`:** `{:.2}` (two decimals).
- **Summary `mrr`:** `{:.3}` (three decimals).
- **Percent columns:** `{:.0}%` (no decimals).

### Delimiter character (EVAL-06 grep target)

Box-drawing **`┌──`** (U+250C U+2500 U+2500). The synthetic and real evals both open with this exact 3-character prefix. `verify-eval.sh` greps stdout for this substring to confirm a table was emitted.

### "Asserted" vs "all" rollup

The synthetic eval (lines 685–691) prints both an "all" and an "asserted (gate floors)" line because it has one relaxed scenario. Most evals will have zero relaxed scenarios — they print only the single rollup line. The helper supports the relaxed path optionally; defaults to a single-line summary when no row has `relaxed: true`.

## 5. `detect_missing_tool` Path Resolution

### Findings (verified by grep)

- `pub fn detect_missing_tool(stderr: &str, command: &str) -> Option<CapabilityGap>` lives at **`src-tauri/src/self_upgrade.rs:260`**.
- `evolution.rs` does **NOT** import or re-export it. `grep -n "detect_missing_tool\|self_upgrade::" src-tauri/src/evolution.rs` returns ZERO matches.
- The closest thing in `evolution.rs` is `pub fn evolution_log_capability_gap(capability: String, user_request: String) -> String` at line 1115 — a **different function** that LOGS a gap to the timeline. It does not detect; it records.

### Verdict

REQ EVAL-05 wording (`evolution::detect_missing_tool`) is **descriptive-but-wrong** — it conflates the detector (`self_upgrade::detect_missing_tool`) with the gap logger (`evolution::evolution_log_capability_gap`). Both are real, related, but different.

**Resolution:** the eval imports the real path:
```rust
use crate::self_upgrade::{detect_missing_tool, CapabilityGap, capability_catalog};
```

**Do NOT add a re-export** in `evolution.rs`. Reasons:
1. The function genuinely belongs to `self_upgrade` — that module owns the catalog (`capability_catalog()`, lines 110–242), the cooldown gate, and `auto_install`. Re-exporting from `evolution.rs` would be misleading.
2. The REQ wording is locked but its purpose (test the detector against synthetic stderr blobs) is satisfied either way.
3. Adding a re-export would be silent product-surface drift. CLAUDE.md "don't add features for features' sake" applies.

**Note in plan:** the `evals/capability_gap_eval.rs` file should carry a doc comment explaining the path mismatch:
```rust
//! Phase 16 / EVAL-05.
//!
//! REQUIREMENTS.md names `evolution::detect_missing_tool` but the live
//! function is `self_upgrade::detect_missing_tool` (verified at
//! `self_upgrade.rs:260`). `evolution.rs` only exposes the related
//! `evolution_log_capability_gap` (line 1115). The eval imports the
//! real path; no re-export added — see Phase 16 RESEARCH §5.
```

## 6. `verify:eval` Wiring Story

### Recommendation: bash wrapper at `scripts/verify-eval.sh`

**Reasoning vs direct `cargo test --lib evals` in package.json:**

| Concern | Direct cargo | bash wrapper |
|---------|-------------|--------------|
| Mirrors existing `scripts/verify-*.sh` convention | ✗ | ✓ (e.g. `verify-chat-rgba.sh`, `verify-no-raw-tauri.sh`, `verify-ghost-no-cursor.sh` are all bash) |
| Can grep stdout to enforce table-printed contract (EVAL-06) | ✗ — `cargo test` exits 0 if assertions pass even when `--nocapture` is missing | ✓ — wrapper greps `┌──` to confirm tables emitted |
| Documents the contract in a self-contained file | ✗ | ✓ (header comment with REQ refs, like `verify-chat-rgba.sh:1-22`) |
| Honors WSL libspa-sys env limit (CLAUDE.md POLISH-02 carve-out) | ✗ — Rust full builds break in WSL | ✓ — wrapper can detect and skip with a documented skip-code |

### Exit-code contract

| Exit code | Meaning |
|-----------|---------|
| 0 | All eval modules passed. ≥4 `┌──` delimiters seen in stdout. |
| 1 | `cargo test --lib evals` exited non-zero (a floor breach OR a panic). |
| 2 | `cargo test` exited 0 but stdout did NOT contain ≥4 `┌──` delimiters — either a module forgot `print_eval_table` or `--nocapture` was stripped. EVAL-06 contract violated. |
| 3 | Cargo not on PATH OR build failed before tests ran. |
| 77 | (autoconf convention) Skip — env precondition unmet (WSL libspa-sys, etc.). Documented but not used in CI. |

### Stdout assertions (the grep contract)

```bash
TABLE_COUNT=$(printf '%s' "$STDOUT" | grep -c '┌──' || true)
if [ "$TABLE_COUNT" -lt 4 ]; then
  echo "[verify-eval] FAIL: only $TABLE_COUNT scored tables emitted, expected ≥4 (EVAL-06)"
  exit 2
fi
```

### Floor-enforcement strategy

The Rust `assert!`s already enforce `top-3 ≥ 80%` and `MRR ≥ 0.6` per module. **The bash wrapper does NOT re-grep for these numbers** — duplicating thresholds in two places guarantees drift. Cargo's exit code is the source of truth; bash only adds the table-presence check.

### Wrapper sketch (final shape, not pseudo-code)

```bash
#!/usr/bin/env bash
# scripts/verify-eval.sh — EVAL-07 invariant (Phase 16).
#
# Runs the Phase-16 eval harness and confirms every module printed its
# scored table. Floor enforcement (top-3 ≥ 80%, MRR ≥ 0.6) lives in the
# `assert!`s of each eval module — this wrapper checks (a) cargo exit
# code and (b) that ≥4 `┌──` table headers appear in stdout (EVAL-06).
#
# @see .planning/phases/16-eval-scaffolding-expansion/16-RESEARCH.md §6
# @see src-tauri/src/evals/harness.rs (print_eval_table format spec)

set -uo pipefail

cd "$(dirname "$0")/../src-tauri" || exit 3

if ! command -v cargo >/dev/null 2>&1; then
  echo "[verify-eval] FAIL: cargo not on PATH"
  exit 3
fi

# Run the eval harness with --nocapture so println! reaches stdout.
# --quiet suppresses cargo build chatter; per-test output remains.
STDOUT=$(cargo test --lib evals --quiet -- --nocapture 2>&1)
RC=$?

if [ $RC -ne 0 ]; then
  echo "$STDOUT"
  echo "[verify-eval] FAIL: cargo test --lib evals exited $RC"
  exit 1
fi

TABLE_COUNT=$(printf '%s' "$STDOUT" | grep -c '┌──' || true)
if [ "$TABLE_COUNT" -lt 4 ]; then
  echo "$STDOUT"
  echo "[verify-eval] FAIL: only $TABLE_COUNT scored tables emitted, expected ≥4 (EVAL-06)"
  exit 2
fi

echo "$STDOUT" | grep -E '^(┌──|│|├|└)' || true
echo "[verify-eval] OK — $TABLE_COUNT scored tables, all floors green"
exit 0
```

### npm wiring

Add to `package.json` `scripts` (after the existing `verify:empty-states-copy`):
```json
"verify:eval": "bash scripts/verify-eval.sh",
```

Append to `verify:all` chain (currently 30 chained gates per `package.json:40`; the count in REQUIREMENTS / ROADMAP says "27 → 28+" — that count appears to track only the *originally specified* 27 of v1.1; the actual chain has more):
```
... && npm run verify:empty-states-copy && npm run verify:eval
```

**Note for plan:** the "27 → 28+" claim in REQ EVAL-07 references the *spec count* not the *actual* count. The actual chain has 30 gates today; after Phase 16 it has 31. Both numbers are right; document both in the plan SUMMARY to avoid confusion at verification time.

## 7. Per-Module Fixture Sketches

### EVAL-02 — `evals/kg_integrity_eval.rs`

**Live API (verified `knowledge_graph.rs`):**
- `pub fn add_node(n: KnowledgeNode) -> Result<String, String>` (line 200) — returns id
- `pub fn add_edge(from_id: &str, to_id: &str, relation: &str, strength: f32) -> Result<(), String>` (line 337)
- `pub fn ensure_tables()` (line 86) — schema setup; eval calls explicitly after temp env
- `pub fn get_node(id: &str) -> Option<KnowledgeNode>` (line 270)
- `pub fn get_edges(node_id: &str) -> Vec<KnowledgeEdge>` (line 355)
- **`consolidate_kg` does NOT exist** — verified via grep. **Verdict:** the eval cannot "invoke `consolidate_kg`" because it isn't a function. The REQ wording is aspirational on this point too.

**Resolution:**
- Phase 16 ships **the orphan-detection assertion** (the load-bearing part of EVAL-02) and **explicitly defers `consolidate_kg` itself** — there's nothing to consolidate without first defining what the consolidation does.
- The eval does an end-to-end round-trip: insert nodes, insert edges, query back, assert (a) every edge endpoint resolves to a real node via `get_node`, (b) every node appears in at least one edge (the orphan check), (c) `get_edges(id)` for each node sums to the expected count.
- The "consolidation" step the REQ names is satisfied by `add_node`'s built-in merge logic (lines 221–248) — when the same concept is added twice with overlapping sources, sources merge and importance takes the max. The eval exercises this and asserts the merged state is consistent. Document in the eval doc comment that "consolidate_kg" in REQ-02 is interpreted as "add_node's idempotent merge path".

**Sketched corpus (5 nodes, 5 edges — minimal connected mix-of-types):**

```rust
let nodes = vec![
    KgFixture { concept: "BLADE",            node_type: "project",    importance: 0.95 },
    KgFixture { concept: "Tauri",            node_type: "technology", importance: 0.80 },
    KgFixture { concept: "Rust",             node_type: "technology", importance: 0.85 },
    KgFixture { concept: "Arnav",            node_type: "person",     importance: 0.90 },
    KgFixture { concept: "JARVIS demo",      node_type: "event",      importance: 0.70 },
];
let edges = vec![
    Edge { from: "BLADE",        to: "Tauri",       relation: "depends_on", strength: 0.9 },
    Edge { from: "BLADE",        to: "Rust",        relation: "depends_on", strength: 0.95 },
    Edge { from: "Tauri",        to: "Rust",        relation: "depends_on", strength: 0.7 },
    Edge { from: "Arnav",        to: "BLADE",       relation: "related_to", strength: 1.0 },
    Edge { from: "JARVIS demo",  to: "BLADE",       relation: "part_of",    strength: 0.85 },
];
```

**Connectivity check:** every node appears in ≥1 edge — `BLADE` (4), `Tauri` (2), `Rust` (2), `Arnav` (1), `JARVIS demo` (1). Zero orphans by construction.

**Asserts:**
1. After all `add_node` calls, `get_node(id)` returns `Some(_)` for every returned id.
2. After all `add_edge` calls, every `(from_id, to_id)` resolves via `get_node` (no dangling endpoints).
3. For each node id, `get_edges(id).len() >= 1` — this is the orphan-zero assertion.
4. **Idempotent merge path:** call `add_node` again with one existing concept and additional sources; assert returned id is the same as the first call (line 248), and assert `get_node(id).sources.len()` equals the union (de-duplicated).
5. **Re-add same edge:** `add_edge` is `INSERT … ON CONFLICT DO UPDATE` (line 346); calling twice with different strengths must leave exactly one edge with the second strength.

**Run:** `cargo test --lib evals::kg_integrity_eval -- --nocapture`. Prints a scored table with one row per "integrity dimension" (round-trip / no-orphan / idempotent merge / edge upsert) — label / top1 (pass) / top3 (pass) / rr=1.0 if pass, all using the harness format even though "rr" is degenerate for boolean asserts (set rr to 1.0 on pass, 0.0 on fail; this re-uses the EVAL-06 contract uniformly).

### EVAL-03 — `evals/hybrid_search_eval.rs` adversarial extensions

The 8/8 synthetic floor (current line 698) MUST be preserved. Add 3 fixtures + 3 scenarios:

**Long content fixture:**
```rust
Fixture {
    source_id: "mem_long_capability_gap",
    // ~4 KB blob — realistic capability-gap log entry shape from evolution.rs:1119
    content: "Capability gap detected on 2026-04-29T14:32:11Z while attempting to fulfill \
              user request 'export Linear ticket LIN-1247 to Markdown and post to #eng-updates': \
              missing tool `linear-cli` from capability catalog. Stderr blob: '/bin/sh: linear-cli: \
              command not found'. Routed to evolution_log_capability_gap. Catalog miss; falling \
              back to search_npm_for_mcp(\"linear\") which returned 4 candidates: \
              mcp-server-linear (npm v0.3.1, 1.2k weekly downloads, last published 2026-03-14, \
              repo: github.com/example/mcp-server-linear, license: MIT), ..." // ~3.5 KB more
              ,
    embedding: [0.10, 0.20, 0.85, 0.05], // work-axis dominant — long log is operational
},
```
- **Scenario:** query `("operational log linear capability gap", expected="mem_long_capability_gap")` — confirms BM25 still picks up rare tokens (`linear-cli`, `mcp-server-linear`) without choking on the length.
- **Risk to 8/8 floor:** the long content adds many tokens to the BM25 corpus, potentially shifting IDF for shared terms. Pick the rare-token query so the unique tokens dominate — this should be additive, not displacing.

**Unicode fixture:**
```rust
Fixture {
    source_id: "mem_unicode_food",
    content: "ユーザーはラーメン (Tonkotsu, シェフAkira at 谷中の店) を週2回食べる 🍜",
    // CJK + romaji + emoji — exercises BM25's tokenization + cosine on multibyte chars.
    embedding: [0.0, 0.30, 0.0, 0.85], // food-axis primary
},
```
- **Scenario:** query `("ラーメン preference Tonkotsu", expected="mem_unicode_food")` — confirms unicode tokens roundtrip without panic and rank correctly.
- **`safe_slice` note:** the eval does NOT slice this string. If the eval ever truncates user content for display in the scored table, it MUST use `crate::safe_slice` (CLAUDE.md). The current `print_eval_table` does NOT slice — it formats `top3_ids` (string IDs, ASCII by construction) and `expected` (also ASCII). Safe.

**Near-duplicate fixture pair:**
```rust
Fixture {
    source_id: "mem_runs_tuesday",
    content: "User runs 5K every Tuesday morning at the riverside park",
    embedding: [0.0, 0.85, 0.10, 0.0], // already in baseline; reuse exact entry
},
Fixture {
    source_id: "mem_runs_wednesday",
    content: "User runs 5K every Wednesday morning at the riverside park",
    embedding: [0.0, 0.85, 0.10, 0.0], // INTENTIONALLY identical embedding to force lexical disambig
},
```
- **Scenario:** query `("tuesday morning run", expected="mem_runs_tuesday")` — embedding is a tie; only BM25 on the literal token "tuesday" can break it.
- **Floor implication:** this is the highest-risk new scenario. If hybrid search can't disambiguate near-dups by the unique BM25 token, MRR drops. The eval MUST gate-relax this scenario (mark `relaxed: true`, exclude from floor) for the first commit, then promote to asserted-floor in a later iteration if hybrid search consistently breaks the tie. **First iteration: surface in table, do NOT include in floor math** — the synthetic 8/8 stays at 8/8 asserted, plus 3 surfaced rows.

**Resulting count:** 8 asserted (unchanged) + 3 surfaced = 11 rows in the table. Floor `assert!(asserted_top3 / 8 >= 0.80)` and `asserted_mrr >= 0.6` unchanged.

### EVAL-04 — `evals/typed_memory_eval.rs`

**Live API (verified `typed_memory.rs`):**
- `pub fn store_typed_memory(category: MemoryCategory, content: &str, source: &str, confidence: Option<f64>) -> Result<String, String>` (need to verify the exact signature — typed_memory.rs:267 only shows `recall_by_category`; store fn must exist by name `store_typed_memory` since `memory_store_typed` (line 545) calls it. Plan task should `grep -n "fn store_typed_memory" src-tauri/src/typed_memory.rs` first task to lock signature.)
- `pub fn recall_by_category(category: MemoryCategory, limit: usize) -> Vec<TypedMemory>` (line 267) — primary call target.
- `pub enum MemoryCategory { Fact, Preference, Decision, Relationship, Skill, Goal, Routine }` (line 35).

**Fixture corpus (one entry per category, 7 total):**

```rust
let fixtures: Vec<(MemoryCategory, &str)> = vec![
    (MemoryCategory::Fact,         "User's birthday is March 15"),
    (MemoryCategory::Preference,   "User prefers dark mode and dislikes verbose AI replies"),
    (MemoryCategory::Decision,     "Chose React over Vue for the BLADE Settings dashboard"),
    (MemoryCategory::Relationship, "Sarah leads the API team at $employer; she is the on-call escalation"),
    (MemoryCategory::Skill,        "Expert in Rust async/tokio; intermediate in Go; novice in Elixir"),
    (MemoryCategory::Goal,         "Ship BLADE v1.2 (Acting Layer) by end of May 2026"),
    (MemoryCategory::Routine,      "Morning standup is 9:30 AM PT on Zoom; 5K run every Tuesday"),
];
```

**Asserts:**
1. After storing all 7, `recall_by_category(MemoryCategory::Fact, 10).len() == 1` and content contains "March 15".
2. Repeat for each of the 7 categories — exactly one entry returned, content matches (substring).
3. `recall_by_category(MemoryCategory::Fact, 10)[0].confidence` is the default (the `store_typed_memory` `Option<f64>` arg defaults to some value — verify in plan task 1).
4. **Cross-category isolation:** `recall_by_category(Fact, 10)` does NOT contain the Preference entry's content. (Catches a bug where the SQL `WHERE category = ?1` is dropped or wrong.)
5. **Conflict resolution path:** store a SECOND `Preference` with content "User prefers light mode" — assert the older entry's `confidence` dropped (lines 253–260 do `MAX(confidence - 0.2, 0.1)`), and both rows still exist (no deletion).

**Scored-table mapping:** label = category name (e.g. `fact_recall_singleton`), expected = the unique source_id, top1 = whether the recall returned that id first. 7 rows + 1 conflict-resolution row = 8.

**Floor:** all 7 category-recall asserts pass (boolean → top1=✓ rr=1.0). Strict floor: `assert_eq!(7, success_count)` rather than the 80% / MRR ≥ 0.6 pattern — this isn't ranking, it's exact recall.

### EVAL-05 — `evals/capability_gap_eval.rs`

**Live API (verified `self_upgrade.rs`):**
- `pub fn detect_missing_tool(stderr: &str, command: &str) -> Option<CapabilityGap>` (line 260). Strict matcher: requires (a) one of 4 not-found patterns in stderr AND (b) first token of `command` matches a `capability_catalog()` key.
- `pub fn capability_catalog() -> HashMap<&'static str, CapabilityGap>` (line 110) — 16 keys verified by line numbers: node, python3, rust, docker, git, ffmpeg, claude, aider, jq, ripgrep, fd, bat, go, htop, tmux (CLAUDE.md note says 10 — the live count is higher; document the discrepancy in plan).

**Synthetic stderr/command fixtures:**

```rust
struct GapCase {
    label: &'static str,
    stderr: &'static str,
    command: &'static str,
    expected_suggestion_contains: Option<&'static str>, // Some → expect Some(gap) with suggestion containing this; None → expect None
}

let cases = vec![
    GapCase { label: "linux_apt_jq",
              stderr: "/bin/sh: 1: jq: not found",
              command: "jq '.foo' data.json",
              expected_suggestion_contains: Some("jq") },
    GapCase { label: "linux_bash_ripgrep",
              stderr: "bash: rg: command not found",
              command: "rg 'pattern' src/",
              expected_suggestion_contains: Some("ripgrep") },
    GapCase { label: "windows_cmd_node",
              stderr: "'node' is not recognized as an internal or external command,\noperable program or batch file.",
              command: "node script.js",
              expected_suggestion_contains: Some("Node") },
    GapCase { label: "macos_zsh_ffmpeg",
              stderr: "zsh: command not found: ffmpeg",
              command: "ffmpeg -i input.mp4 out.webm",
              expected_suggestion_contains: Some("FFmpeg") },
    GapCase { label: "false_positive_cargo_mentions_fd",
              // Stderr mentions "fd" inside an unrelated cargo error — must NOT trigger
              stderr: "error: failed to read file `/tmp/fd-build.log`: No such file or directory",
              command: "cargo build",
              expected_suggestion_contains: None }, // detector is strict — first-token must match catalog
    GapCase { label: "negative_unknown_tool",
              stderr: "/bin/sh: foobarbaz-cli: not found",
              command: "foobarbaz-cli arg",
              expected_suggestion_contains: None }, // not in catalog
    GapCase { label: "negative_no_not_found",
              stderr: "Error: invalid argument",
              command: "jq '.foo' data.json",
              expected_suggestion_contains: None }, // stderr lacks any not-found phrase
];
```

**Asserts:**
- For each case with `Some(expected)`: `detect_missing_tool(stderr, command)` returns `Some(gap)` AND `gap.suggestion.to_lowercase().contains(expected.to_lowercase())`.
- For each `None` case: returns `None`.

**False-positive coverage:** the `false_positive_cargo_mentions_fd` case is **the regression test** for the fix documented in `self_upgrade.rs:256-258` ("the old loose behaviour … caused spurious installs"). This is THE case that proves the strict matcher works.

**Scored-table mapping:** label per case, top1 = (actual matches expected), rr = 1.0/0.0 boolean. 7 rows. Floor: `assert!(success_count == cases.len())` — 100%, no slop tolerated.

## 8. `tests/evals/DEFERRED.md` Draft (EVAL-08)

**Location:** `src-tauri/src/evals/DEFERRED.md` (per option-(b) location decision in §2). Or, if the Phase 16 plan prefers exposing this at the repo root for visibility, `tests/evals/DEFERRED.md` literal — both are fine; the REQ wording uses the latter so default to **`tests/evals/DEFERRED.md`** and create the directory just to hold this single file. (The actual eval modules live in `src-tauri/src/evals/`; the literal-path doc satisfies the REQ-prose convention without forcing the test code into integration-test layout.)

### Draft content (3 entries minimum per EVAL-08; including all four named in REQUIREMENTS.md + milestone shape):

```markdown
# Deferred Evals — v1.3 candidates

These evals require live LLM API calls, which means budget per CI run and
non-determinism that doesn't fit the Phase-16 floor model. Each entry documents
the rationale, a per-run cost estimate at current OpenAI/Anthropic pricing, and
the trigger condition that would justify promoting it from a stub to a live
eval module.

Phase 16 (2026-04-29) does NOT implement these. It implements only the
deterministic, embedding-and-keyword-driven evals where local fastembed +
hand-crafted fixtures produce reproducible floor checks.

---

## 1. `extract_conversation_facts` precision

**Source:** `memory.rs::extract_conversation_facts` (LLM-driven fact extraction).

**Why deferred:** the function calls a chat-completion model with a fact-extraction
prompt, then parses JSON output into `TypedMemory` rows. Eval requires (a) a corpus
of conversation transcripts with hand-labelled "facts that should be extracted"
ground truth, (b) live LLM call per transcript, (c) precision/recall comparison
against ground truth. None of (a)–(c) lands in 2 days.

**Per-run cost estimate:** 50 transcripts × ~1k input tokens × ~300 output tokens
on a cheap model (Haiku / GPT-4o-mini) ≈ $0.15–$0.30 per CI run. Manageable but
unbudgeted.

**Promotion trigger:** when v1.3 ships a curated 50-transcript corpus with
ground-truth labels (probably hand-labelled from real BLADE conversation logs
after operator consent), AND when CI cost budget is allocated for $5–$10/month.

## 2. `weekly_memory_consolidation` correctness

**Source:** `memory.rs::weekly_memory_consolidation` (merges duplicates, lowers
confidence on conflicts, drops stale).

**Why deferred:** consolidation is a stochastic LLM-driven process — given the
same input on different days, the merge decisions can differ. Eval requires
either (a) deterministic seed + fixed-prompt assertion, which fights the LLM,
or (b) statistical assertions across N runs, which is multi-run-cost. Neither
fits the Phase-16 single-run floor model.

**Per-run cost estimate:** 1 consolidation pass = ~5k input tokens × ~2k output ≈
$0.05 per run on a cheap model. Cheap individually but multi-run statistical
assertions multiply.

**Promotion trigger:** when v1.3 introduces a "consolidation determinism" config
(e.g. temperature=0, fixed seed if model supports), enabling assert-on-output.
Or when statistical floor framework lands (e.g. "merge correctness ≥ 80% across
10 runs"), which is its own eval-infra investment.

## 3. Evolution suggestion quality

**Source:** `evolution.rs::run_evolution_cycle` (the autonomous loop that
suggests capability upgrades based on detected app patterns).

**Why deferred:** "is this suggestion useful?" is fundamentally a human-judgement
call. Eval requires either (a) hand-labelled ground truth ("for app context X,
suggestion Y is good / Y' is bad"), which requires periodic re-labelling as the
catalog evolves, or (b) downstream metric ("suggestion led to install AND user
didn't dismiss within N days"), which requires telemetry BLADE deliberately
doesn't collect (zero telemetry, per PROJECT.md).

**Per-run cost estimate:** $0.50–$1.00 per cycle (full cycle is many tool
calls + LLM reasoning). Highest cost of the deferred set.

**Promotion trigger:** when the user opt-in feedback channel for evolution
suggestions ships (thumbs-up/down on `CapabilityReports.tsx`), accumulated
feedback becomes the eval corpus. Deferred to v1.3+ feedback-loop work.

## 4. (Optional 4th — only if a fourth is needed for ≥3 floor) `auto_resolve_unknown_gap` resolution quality

**Source:** `self_upgrade.rs::auto_resolve_unknown_gap` (npm/MCP search fallback when capability isn't in catalog).

**Why deferred:** searches npm registry + MCP catalogs live. Network-dependent,
non-deterministic (registry contents change), and the "did this resolve well?"
check is again human-judgement.

**Per-run cost estimate:** $0 LLM, but ~5 HTTPS calls per run; CI flakiness risk.

**Promotion trigger:** when a frozen npm-registry mirror or fixture-mode for
`search_npm_for_mcp` ships, eval becomes deterministic.

---

*Phase 16 ships the deterministic 4-eval baseline. These four are queued for
v1.3 once budget + corpora + feedback channels exist.*
```

**Three entries minimum is met; four is the natural set drawn from `notes/v1-2-self-improvement-maturity.md` lines 78–83 + ROADMAP.md.**

## 9. Module-by-Module File Plan

Single source-of-truth table for the planner. All paths absolute from repo root.

| REQ | New/modified files | API touched | Assertion shape | Cargo command |
|-----|--------------------|-------------|-----------------|---------------|
| EVAL-01 | NEW: `src-tauri/src/evals/mod.rs`<br>NEW: `src-tauri/src/evals/harness.rs`<br>MOD: `src-tauri/src/lib.rs` (add `#[cfg(test)] mod evals;`) | own — defines `HasSourceId`, `EvalRow`, `EvalSummary`, `print_eval_table`, `summarize`, `temp_blade_env`, `reciprocal_rank`, `top1_hit`, `topk_hit` | none (it's the harness — used by ≥3 modules) | `cargo test --lib evals::harness` (compiles only; no asserts of its own) |
| EVAL-02 | NEW: `src-tauri/src/evals/kg_integrity_eval.rs` | `knowledge_graph::{add_node, add_edge, get_node, get_edges, ensure_tables, KnowledgeNode, KnowledgeEdge}` | `assert!(no_orphans)`; `assert!(every_edge_endpoint_resolves)`; `assert!(idempotent_merge_returns_same_id)` | `cargo test --lib evals::kg_integrity_eval -- --nocapture` |
| EVAL-03 | MOD: extract `embeddings.rs::memory_recall_eval` (lines 510–728) → `src-tauri/src/evals/hybrid_search_eval.rs`<br>MOD: extract `embeddings.rs::memory_recall_real_embedding` (lines 748–946) → `src-tauri/src/evals/real_embedding_eval.rs`<br>MOD: `embeddings.rs` — delete extracted blocks; ensure `pub(crate)` visibility on any items the evals need (likely `SearchResult`, `VectorStore`, `embed_texts`, `cosine_similarity` already pub) | `embeddings::{VectorStore, SearchResult, embed_texts, cosine_similarity}` | preserve existing `(asserted_top3 / total) >= 0.80`, `asserted_mrr >= 0.6`; add 3 new fixtures (long content, unicode, near-duplicate pair) — first iteration **gate-relaxes the new ones**, asserted floor stays at 8/8 | `cargo test --lib evals::hybrid_search_eval -- --nocapture` |
| EVAL-04 | NEW: `src-tauri/src/evals/typed_memory_eval.rs` | `typed_memory::{store_typed_memory, recall_by_category, MemoryCategory, TypedMemory}` (verify `store_typed_memory` signature in plan task 1) | `assert_eq!(recall_by_category(cat, 10).len(), 1)` per category × 7; `assert!(content_substring_match)`; conflict-resolution lowers confidence | `cargo test --lib evals::typed_memory_eval -- --nocapture` |
| EVAL-05 | NEW: `src-tauri/src/evals/capability_gap_eval.rs` | `self_upgrade::{detect_missing_tool, CapabilityGap, capability_catalog}` | per-case `assert_eq!` between `detect_missing_tool(stderr, cmd)` result and expected `Option<&CapabilityGap>` shape; explicit false-positive case (`cargo build` mentioning `fd`) returns `None` | `cargo test --lib evals::capability_gap_eval -- --nocapture` |
| EVAL-06 | (no new files; satisfied by `harness::print_eval_table` being called from each of the 4+ eval modules) | own | each eval prints `┌──` delimiter; verified by `verify-eval.sh` | covered by EVAL-07 wrapper |
| EVAL-07 | NEW: `scripts/verify-eval.sh`<br>MOD: `package.json` — add `"verify:eval": "bash scripts/verify-eval.sh"` and append to `verify:all` chain | shell + cargo | exit 0 only if cargo exits 0 AND ≥4 `┌──` substrings in stdout | `npm run verify:eval` and `npm run verify:all` |
| EVAL-08 | NEW: `tests/evals/DEFERRED.md` (literal path at repo root, holding ≥3 entries with rationale + budget + promotion trigger) | docs only | n/a (markdown file) | n/a |

**Total files:** 7 new (`evals/mod.rs`, `evals/harness.rs`, 4 eval modules, `verify-eval.sh`, `DEFERRED.md`) + 3 modified (`lib.rs`, `embeddings.rs`, `package.json`).

**Net LoC delta in `embeddings.rs`:** ~ –436 (lines 510–946 extracted out). The file shrinks meaningfully.

**Compilation order:** `harness.rs` first (no dependencies on other evals), then any of the 4 eval modules (parallel-safe). `lib.rs` registration last so `cargo check` doesn't fail mid-batch.

## 10. Risks & Landmines

### R1 — `BLADE_CONFIG_DIR` env-var thread-safety under cargo parallelism

**Severity:** HIGH if hit, blocks the whole eval run.

**Cause:** `embeddings.rs:571` does `std::env::set_var("BLADE_CONFIG_DIR", temp.path())`. `cargo test` runs tests in parallel by default. If two evals call `temp_blade_env` concurrently they race on the env var — second test wins, first test reads the wrong dir, db state leaks across tests, asserts go non-deterministic.

**Mitigations (any one is sufficient):**
1. Run with `cargo test --lib evals -- --nocapture --test-threads=1` in `verify-eval.sh`. Cheap, mechanical, deterministic.
2. Use a `Mutex<()>` + lazy_static guard around `temp_blade_env()` so set-var is serialized.
3. Refactor BLADE config-dir resolution to accept an explicit override parameter (large change, not scoped for Phase 16).

**Plan recommendation:** **option 1 in the bash wrapper**. Document why in the script header. Cost: total runtime ~1-2s slower; given the fastembed model load already dominates, negligible.

### R2 — Fastembed cold-start on CI

**Severity:** MEDIUM (timing-only; not correctness).

**Cause:** `memory_recall_real_embedding` notes (line 856) "first run downloads ~80MB of model weights and compiles the model graph (~20-30s)". CI runners typically don't have the model cached.

**Mitigation:** keep `real_embedding_eval` in the harness — the floor IS the value. Document that first CI run after cache reset takes ~30s. If WSL/CI flakiness emerges, gate the real-embedding eval behind a cargo feature (e.g. `eval-real-embedding`) and skip in environments without network. Phase 16 default: NOT feature-gated; let it run; document the cold-start in the wrapper output.

### R3 — Cargo test parallelism affecting fixture state across the 4 evals

**Severity:** MEDIUM (mitigated by R1.1).

**Cause:** kg_integrity_eval, typed_memory_eval, hybrid_search_eval, real_embedding_eval all hit SQLite via `crate::db::init_db()` and each sets `BLADE_CONFIG_DIR`. Even with each using its own `tempfile::TempDir`, the env-var globals collide.

**Mitigation:** same as R1. `--test-threads=1` solves both. Document in `harness::temp_blade_env` doc comment.

### R4 — Unicode normalization in BM25

**Severity:** LOW (the unicode fixture is gate-relaxed in first iteration anyway).

**Cause:** BM25 in `embeddings.rs` tokenizes by ASCII whitespace (verify in plan; this is the standard implementation). Japanese characters won't tokenize at character boundaries — they appear as one giant "token" that only matches the literal full string. This MAY make the unicode fixture's recall poor.

**Mitigation:** the unicode scenario is in the **gate-relaxed** set initially (per §7 EVAL-03). It surfaces in the table for inspection but doesn't fail the floor. If hybrid recall is fundamentally broken on unicode, that's a real product bug worth surfacing — Phase 16's job is to make it visible, not to fix it.

### R5 — `cargo test --lib evals` matching unintended modules

**Severity:** LOW.

**Cause:** `cargo test --lib evals` matches any test path containing `evals` as a substring. If anywhere in `blade_lib` someone has a function called `format_evals_summary` inside an unrelated test, it'd run too.

**Verification:** `grep -rn "fn.*eval" src-tauri/src/ --include="*.rs"` shows the existing two eval modules and no other matches. Safe today; document as a "watch out" for future contributors.

### R6 — REQ-text-vs-live-API drift (already captured)

**Severity:** LOW because already documented.

**Cause:** REQ EVAL-02 references `kg_add_node`, `kg_add_edge`, `consolidate_kg` — none of which exist by those names. REQ EVAL-05 references `evolution::detect_missing_tool` — wrong module.

**Mitigation:** this research file documents the gap (§5 + §7 EVAL-02). Plan should embed the path-resolution decision in the SUMMARY.md so PR reviewers see the rationale.

### R7 — `verify:eval` running in WSL where Rust full-build was previously gated

**Severity:** LOW.

**Cause:** STATE.md notes "WSL libspa-sys/libclang env limit" for `cargo check --no-default-features`. Eval tests use the **default** feature set (which excludes `whisper-rs` + libspa transitive deps for whisper-only paths). Should compile fine in WSL.

**Mitigation:** if WSL environments break, document a 77-exit skip code in the wrapper. CI Linux runner is the source of truth.

### R8 — File extraction breaking visibility

**Severity:** MEDIUM, easy to fix.

**Cause:** moving `mod memory_recall_eval` out of `embeddings.rs` may require flipping some items from `pub(super)` or implicit-private to `pub(crate)`. Specifically: `SearchResult`, `VectorStore::add`, `VectorStore::hybrid_search`, `VectorStore::new`, `embed_texts`, `cosine_similarity`. Verify each is already `pub` (they should be — they're called from production code in `commands.rs` etc.).

**Mitigation:** plan task 1 of EVAL-03 = "verify visibility, fix any private items the extracted tests need".

### R9 — `print_eval_table` emoji-vs-ASCII regression

**Severity:** LOW.

**Cause:** the existing format uses `✓` and `✗` (U+2713, U+2717) for top1/top3 hit markers (line 680, 887). The bash `verify-eval.sh` greps for `┌──` (U+250C U+2500), not the ticks — bash matching of those box chars works fine on UTF-8-safe terminals. CI runners usually OK; Windows cmd.exe can mangle U+2500.

**Mitigation:** stick with current chars. They work on the existing CI per the 2026-04-28 baseline run. If a Windows-only build environment breaks, add an `--ascii` flag to `print_eval_table` later — out of scope for Phase 16.

### R10 — `tests/evals/DEFERRED.md` location

**Severity:** LOW (documentation only).

**Cause:** REQ wording says `tests/evals/DEFERRED.md`. Eval *code* lives at `src-tauri/src/evals/`. Two locations.

**Verdict:** put the doc at REQ-literal `tests/evals/DEFERRED.md`. Create the directory just to hold it. Cross-reference from `src-tauri/src/evals/mod.rs` doc-comment so future readers find it.

## 11. Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | `cargo test --lib` (rustc 1.85+, default test harness) |
| Config file | `src-tauri/Cargo.toml` (no separate test config) |
| Quick run command | `cd src-tauri && cargo test --lib evals -- --nocapture --test-threads=1` |
| Full suite command | `bash scripts/verify-eval.sh` (wraps quick run + table-presence assertion) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| EVAL-01 | Shared harness compiles + is used by ≥2 modules | unit (compile-only) | `cd src-tauri && cargo test --lib evals::harness --no-run` | ❌ Wave 0 (NEW: `evals/mod.rs`, `evals/harness.rs`) |
| EVAL-02 | KG round-trip: 5 nodes, 5 edges, no orphans, idempotent merge | unit | `cd src-tauri && cargo test --lib evals::kg_integrity_eval -- --nocapture` | ❌ Wave 0 (NEW: `evals/kg_integrity_eval.rs`) |
| EVAL-03 | Synthetic 8/8 floor preserved + 3 adversarial fixtures surfaced | unit | `cd src-tauri && cargo test --lib evals::hybrid_search_eval -- --nocapture` | ⚠️ EXTRACTED from `embeddings.rs:510-728` |
| EVAL-03 (real) | 7-query fastembed floor MRR ≥ 0.6 / top3 ≥ 80% preserved | unit | `cd src-tauri && cargo test --lib evals::real_embedding_eval -- --nocapture` | ⚠️ EXTRACTED from `embeddings.rs:748-946` |
| EVAL-04 | typed_memory 7-category recall returns expected sets | unit | `cd src-tauri && cargo test --lib evals::typed_memory_eval -- --nocapture` | ❌ Wave 0 (NEW: `evals/typed_memory_eval.rs`) |
| EVAL-05 | `detect_missing_tool` correctly classifies 7 stderr/cmd cases including false-positive | unit | `cd src-tauri && cargo test --lib evals::capability_gap_eval -- --nocapture` | ❌ Wave 0 (NEW: `evals/capability_gap_eval.rs`) |
| EVAL-06 | Each module emits `┌──` delimiter | smoke | `bash scripts/verify-eval.sh` (greps stdout) | ❌ Wave 0 (NEW: `scripts/verify-eval.sh`) |
| EVAL-07 | `verify:all` chain includes eval gate, exits 0 | smoke (CI) | `npm run verify:all` | ⚠️ MOD: `package.json` adds `verify:eval` to chain |
| EVAL-08 | `tests/evals/DEFERRED.md` exists with ≥3 structured entries | manual-only | `test -f tests/evals/DEFERRED.md && grep -c '^## ' tests/evals/DEFERRED.md` (expect ≥3) | ❌ Wave 0 (NEW: `tests/evals/DEFERRED.md`) |

### Sampling Rate

- **Per task commit:** `cd src-tauri && cargo test --lib evals::<module> -- --nocapture` for the specific eval module touched. Runtime ~5–30s depending on whether the touched module pulls fastembed.
- **Per wave merge:** `bash scripts/verify-eval.sh` (full eval suite, ~30–60s including fastembed cold path).
- **Phase gate:** `npm run verify:all` green before `/gsd-verify-work` — full 30+ gate chain plus the new `verify:eval`.

### Wave 0 Gaps

- [ ] `src-tauri/src/evals/mod.rs` — module tree root (covers EVAL-01)
- [ ] `src-tauri/src/evals/harness.rs` — shared helpers (covers EVAL-01)
- [ ] `src-tauri/src/evals/hybrid_search_eval.rs` — extracted from `embeddings.rs` + 3 adversarial (covers EVAL-03 synthetic)
- [ ] `src-tauri/src/evals/real_embedding_eval.rs` — extracted from `embeddings.rs` (covers EVAL-03 real)
- [ ] `src-tauri/src/evals/kg_integrity_eval.rs` — new (covers EVAL-02)
- [ ] `src-tauri/src/evals/typed_memory_eval.rs` — new (covers EVAL-04)
- [ ] `src-tauri/src/evals/capability_gap_eval.rs` — new (covers EVAL-05)
- [ ] `scripts/verify-eval.sh` — new bash wrapper (covers EVAL-06, EVAL-07)
- [ ] `tests/evals/DEFERRED.md` — new doc (covers EVAL-08)
- [ ] `src-tauri/src/lib.rs` — add `#[cfg(test)] mod evals;` (touch only)
- [ ] `src-tauri/src/embeddings.rs` — DELETE lines 496–946 (the two existing inline eval modules, after their content has been moved to `evals/hybrid_search_eval.rs` and `evals/real_embedding_eval.rs`); leave the production code (lines 1–489) untouched
- [ ] `package.json` — add `verify:eval` script + chain it into `verify:all`

Framework install: none — `cargo test` is built into the Rust toolchain BLADE already requires.

## 12. Out of Scope

Explicit non-goals for Phase 16 (the planner MUST NOT generate tasks for these):

- **LLM-API-driven evals.** `extract_conversation_facts`, `weekly_memory_consolidation`, `evolution` suggestion quality, `auto_resolve_unknown_gap` — all listed in `tests/evals/DEFERRED.md` per EVAL-08.
- **Doctor-pane visualization of eval scores.** That's Phase 17 (DOCTOR-02). Phase 16 only produces the data; consumption is Phase 17's problem.
- **Real-data corpora.** Synthetic fixtures only. Real-conversation corpora require operator export + hand-labelling — not budgeted.
- **Determinism harness for non-deterministic LLM calls.** Out of scope; would need its own infra phase.
- **Performance benchmarking** of `embed_texts`, `hybrid_search`, etc. Phase 16 measures recall quality, not latency. Latency is its own benchmarking dimension.
- **Multi-language fixtures beyond one CJK + emoji adversarial entry.** Internationalization eval is its own work.
- **Replacing the existing 7-query real-embedding corpus with 50+ queries.** Keep its current shape. Expansion is v1.3.
- **`consolidate_kg` function** — the function REQ-02 names doesn't exist, and inventing one is product scope-creep. Phase 16 satisfies the REQ via `add_node`'s existing idempotent-merge path (lines 221–248).
- **Re-export of `detect_missing_tool` from `evolution.rs`.** REQ wording mismatch resolved by importing from the real path; no surface-area change.
- **Tightening floors** beyond what the live baseline holds (`top-3 ≥ 80%`, `MRR ≥ 0.6`). The current floor is conservative on purpose; tightening is a v1.3 hardening pass.
- **CI-cache for fastembed model download.** First-run cost is ~30s; if it becomes a real CI pain, that's a separate ops task.
- **UAT / screenshot evidence** for this phase. CLAUDE.md "Verification protocol applies to runtime/UI changes" + `blade-uat` skill scope-note both exempt non-runtime phases. Build evidence = `cargo test --lib evals` + `npm run verify:eval` green.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `store_typed_memory` is the production fn signature called by `memory_store_typed` (line 545) | §7 EVAL-04 | Plan task 1 verifies signature; if name is different (e.g. `store_typed`, `insert_typed_memory`), the eval imports change but logic is the same — low risk |
| A2 | `cargo test --lib evals` correctly resolves the proposed `mod evals { ... }` path | §2 | Verified by Cargo test-filter docs (path-segment match); if Cargo behaviour differs in some edge case, fall back to explicit `cargo test --lib evals::` prefix |
| A3 | Box-drawing characters (`┌──`) round-trip through CI stdout without re-encoding | §4, §6 | The existing `memory_recall_real_embedding` test has been running in CI since 2026-04-28 (commit 9c5674a) — if box chars broke we'd already know |
| A4 | `verify:all` chain count "27" in REQUIREMENTS.md is the spec count, not the actual chain count (which is 30 today) | §6 | Both numbers documented; planner picks one for the SUMMARY commit message |
| A5 | The unicode adversarial fixture (CJK + emoji) won't break BM25 tokenization in a way that fails `cargo test` outright (e.g. byte-boundary panic) | §7 EVAL-03, §10 R4 | Mitigation: fixture is gate-relaxed in first iteration. If it actually panics, the fixture content gets simplified to romaji + emoji only |
| A6 | `tempfile::TempDir` cleanup on test panic is reliable enough that a failed eval doesn't leak ~10MB of temp dirs over many CI runs | §3, §10 R1 | Standard TempDir Drop semantics; well-established |

**Open question for the discuss-phase or planner to resolve, NOT for research:**
- Does the planner want to gate-relax the unicode + near-duplicate adversarial fixtures in the first iteration (as recommended), OR push them straight into the asserted floor and accept that the floor may dip below 80% on first run? Recommendation: gate-relax first, then promote in a follow-on commit once the recall numbers are known.

## Open Questions

1. **`store_typed_memory` exact signature** (§7 EVAL-04, A1) — needs `grep` in plan task 1, not research.
2. **Whether `tests/evals/DEFERRED.md` lives at repo-root literal path or co-located with eval code** (§8, §10 R10) — recommendation: REQ-literal path. Planner can override.
3. **First-iteration treatment of adversarial fixtures** (§7 EVAL-03) — gate-relax recommended; planner decides.

## Sources

### Primary (HIGH confidence — read directly in this session)

- `src-tauri/src/embeddings.rs` lines 490–946 — existing eval baseline (synthetic + real-fastembed)
- `src-tauri/src/typed_memory.rs` lines 1–100, 200–330, 450–580 — `MemoryCategory` enum, `recall_by_category`, `memory_store_typed`
- `src-tauri/src/self_upgrade.rs` lines 1–242, 244–410 — `CapabilityGap`, `capability_catalog`, `detect_missing_tool`
- `src-tauri/src/knowledge_graph.rs` lines 1–370 — `KnowledgeNode`, `KnowledgeEdge`, `add_node`, `add_edge`, `get_node`, `get_edges`, `ensure_tables`
- `src-tauri/src/evolution.rs` lines 1100–1135 — `evolution_log_capability_gap` (and the verified absence of `detect_missing_tool` re-export)
- `src-tauri/src/lib.rs` lines 1–30 — module registration pattern
- `src-tauri/Cargo.toml` — `tempfile` 3, `fastembed` 5, `whisper-rs` feature-gated
- `package.json` — verify chain inventory; `verify:all` is currently 30 chained gates
- `scripts/verify-chat-rgba.sh` — bash wrapper convention reference
- `.planning/STATE.md`, `.planning/ROADMAP.md`, `.planning/REQUIREMENTS.md`, `.planning/notes/v1-2-milestone-shape.md`, `.planning/notes/v1-2-self-improvement-maturity.md` — milestone shape, REQ definitions, audit context

### Secondary

- `CLAUDE.md` (project) and `~/CLAUDE.md` (workspace) — project rules, verification protocol carve-outs
- Memory `feedback_uat_evidence.md` — UAT-rule scope (does not apply to Phase 16)

### Tertiary

- None. Phase 16 is fully grounded in the live codebase + locked planning docs.

## Metadata

**Confidence breakdown:**
- Existing baseline anatomy: HIGH — read every line cited
- Canonical eval location: HIGH — verified `cargo test` filter semantics + lib name `blade_lib`
- Shared harness spec: HIGH — extracted from real source
- Scored-table format: HIGH — copied verbatim
- `detect_missing_tool` path: HIGH — verified by grep showing zero `evolution::` re-export
- Verify-eval wiring: HIGH — modeled on existing `verify-chat-rgba.sh` bash wrapper
- Fixture sketches: MEDIUM-HIGH — APIs verified; specific fixture content is the author's best fit and may need 1-2 iterations once the eval runs
- DEFERRED.md draft: HIGH — sourced directly from `notes/v1-2-self-improvement-maturity.md`
- Risks: HIGH — every risk traced to a specific file/line

**Research date:** 2026-04-29
**Valid until:** 2026-05-15 (16 days — until Phase 16 ships and the source layout stabilizes; nothing in Phase 16 depends on a fast-moving external library)
