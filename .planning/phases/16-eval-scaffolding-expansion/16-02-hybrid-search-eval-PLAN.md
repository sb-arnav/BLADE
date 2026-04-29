---
phase: 16-eval-scaffolding-expansion
plan: 02
type: execute
wave: 2
depends_on: [16-01]
files_modified:
  - src-tauri/src/evals/hybrid_search_eval.rs
autonomous: true
requirements: [EVAL-03]
must_haves:
  truths:
    - "`cargo test --lib evals::hybrid_search_eval -- --nocapture --test-threads=1` exits 0"
    - "stdout contains the `┌──` delimiter (EVAL-06 contract)"
    - "Synthetic 8-scenario asserted floor preserved: top-3 ≥ 80%, MRR ≥ 0.6"
    - "3 adversarial fixtures (long content, unicode CJK+emoji, near-duplicate pair) surface in the table marked `relaxed: true` so the asserted floor stays at 8/8"
  artifacts:
    - path: "src-tauri/src/evals/hybrid_search_eval.rs"
      provides: "Synthetic 4-dim hybrid-search regression eval with 8 baseline + 3 adversarial scenarios"
      min_lines: 240
      contains: "fn evaluates_synthetic_hybrid_recall"
  key_links:
    - from: "src-tauri/src/evals/hybrid_search_eval.rs"
      to: "src-tauri/src/evals/harness.rs"
      via: "use super::harness::*"
      pattern: "use super::harness"
    - from: "src-tauri/src/evals/hybrid_search_eval.rs"
      to: "src-tauri/src/embeddings.rs::VectorStore"
      via: "use crate::embeddings::{VectorStore, SearchResult}"
      pattern: "use crate::embeddings"
---

<objective>
Replace the Wave 1 stub at `src-tauri/src/evals/hybrid_search_eval.rs` with the full synthetic hybrid-search eval. Source: `embeddings.rs:510-728` (`mod memory_recall_eval`) — moved verbatim with helpers swapped to `harness::*`. Add 3 NEW adversarial fixtures (long content, unicode, near-duplicate pair) to surface BM25 + cosine edge cases.

Purpose: Preserve the 8/8 asserted-floor regression gate that has been protecting hybrid-search recall since 2026-04-28 baseline (commit `9c5674a`). The 3 adversarial fixtures are gate-relaxed in this iteration — they print to the table but do NOT contribute to the asserted-floor math, per RESEARCH §7 EVAL-03.

Output: A single `.rs` file with one `#[test] fn evaluates_synthetic_hybrid_recall` that exercises 11 scenarios (8 asserted + 3 relaxed) and prints the EVAL-06 scored table. The asserted floor `assert!((asserted_top3/8.0) >= 0.80)` and `assert!(asserted_mrr >= 0.6)` are preserved verbatim from `embeddings.rs:698-707`.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.planning/ROADMAP.md
@.planning/REQUIREMENTS.md
@.planning/phases/16-eval-scaffolding-expansion/16-RESEARCH.md
@.planning/phases/16-eval-scaffolding-expansion/16-PATTERNS.md
@.planning/phases/16-eval-scaffolding-expansion/16-VALIDATION.md
@.planning/phases/16-eval-scaffolding-expansion/16-01-harness-PLAN.md
@CLAUDE.md
@src-tauri/src/embeddings.rs

<interfaces>
<!-- From `harness.rs` (Plan 01): -->
```rust
pub trait HasSourceId { fn source_id(&self) -> &str; }
impl HasSourceId for SearchResult { fn source_id(&self) -> &str { &self.source_id } }
pub struct EvalRow { pub label, pub top1, pub top3, pub rr, pub top3_ids, pub expected, pub relaxed }
pub fn reciprocal_rank<T: HasSourceId>(results: &[T], expected: &str) -> f32;
pub fn top1_hit<T: HasSourceId>(results: &[T], expected: &str) -> bool;
pub fn topk_hit<T: HasSourceId>(results: &[T], expected: &str, k: usize) -> bool;
pub fn print_eval_table(title: &str, rows: &[EvalRow]);
pub fn summarize(rows: &[EvalRow]) -> EvalSummary;
pub fn temp_blade_env() -> tempfile::TempDir;
```

<!-- From `embeddings.rs` (production, public): -->
```rust
pub struct SearchResult { pub source_id: String, pub content: String, /* ... */ }
pub struct VectorStore { /* ... */ }
impl VectorStore {
    pub fn new() -> Self;
    pub fn add(&mut self, content: String, embedding: Vec<f32>, source: String, source_id: String);
    pub fn hybrid_search(&self, query: &str, query_embedding: &[f32], k: usize) -> Vec<SearchResult>;
}
```

<!-- The block being relocated — `embeddings.rs:510-728` — is roughly:
- Lines 517-566: `Fixture` struct + `corpus()` (8 baseline 4-dim fixtures)
- Lines 568-583: `build_test_store()` fixture-builder
- Lines 586-601: helpers (extracted to harness in Plan 01 — drop here)
- Lines 604-641: 9 scenarios (clean axis × 4, keyword boost × 2, adversarial × 1, kw-overrides × 1, noise-only relaxed × 1)
- Lines 643-707: the `#[test]` body iterating scenarios + computing rollup + asserting floors
- Lines 711-727: `empty_query_returns_empty` + `empty_store_returns_empty` smoke tests
-->
```
</interfaces>

<gotchas>
1. **Asserted floor MUST stay at 8/8** — the existing baseline has 9 scenarios (8 asserted + 1 noise-only relaxed). The 3 NEW adversarial fixtures get `relaxed: true` so they do NOT change the asserted denominator. Total: 12 rows in the table (8 asserted + 4 relaxed).
2. **`safe_slice` rule** — the unicode adversarial fixture contains CJK + emoji. The current `print_eval_table` uses `{:32}` (left-pad) which is safe. If the eval ever truncates fixture content for display, use `crate::safe_slice` not byte-slicing.
3. **`--test-threads=1` mandatory** — `temp_blade_env` mutates `BLADE_CONFIG_DIR` (RESEARCH §10 R1). Per-task verify command must include the flag.
4. **Visibility check** (RESEARCH §10 R8) — `SearchResult`, `VectorStore::add`, `VectorStore::hybrid_search`, `VectorStore::new` are already `pub` (they're called from `commands.rs`). No visibility flips needed for the move. Verify with `grep -n "pub struct SearchResult\|pub fn add\|pub fn new\|pub fn hybrid_search" src-tauri/src/embeddings.rs` before relying on them.
5. **Do NOT delete `embeddings.rs:510-728` in this plan** — Plan 07 owns the deletion AFTER all Wave 2 evals compile. Premature deletion creates a compile-broken intermediate state.
6. **Stay within `evals::hybrid_search_eval` namespace** — DO NOT change the test fn name to anything that doesn't include `evals` segment in its path; `cargo test --lib evals` filter matches by path-substring.
7. **The unicode fixture's emoji is load-bearing test data**, not decoration. CLAUDE.md "no emojis in files unless asked" carves this out (see RESEARCH §0 line 67).
</gotchas>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Extract synthetic eval to evals/hybrid_search_eval.rs (verbatim move + helper swap)</name>
  <files>src-tauri/src/evals/hybrid_search_eval.rs (REPLACE Wave 1 stub)</files>

  <read_first>
    - src-tauri/src/embeddings.rs (lines 496-728) — the entire `mod memory_recall_eval` block being moved (header comment + Fixture struct + corpus + helpers + scenarios + test body + smoke tests)
    - src-tauri/src/evals/harness.rs (Plan 01 output) — the imports the new file uses
    - .planning/phases/16-eval-scaffolding-expansion/16-PATTERNS.md (§ "src-tauri/src/evals/hybrid_search_eval.rs", lines 144-208) — full pattern assignment + adversarial fixture sketches
    - .planning/phases/16-eval-scaffolding-expansion/16-RESEARCH.md (§7 EVAL-03 — adversarial fixture content verbatim)
  </read_first>

  <action>
**Step 1: Confirm production-code visibility before relying on it.**
```bash
grep -nE "pub struct SearchResult|impl VectorStore|pub fn (new|add|hybrid_search|cosine_similarity)" src-tauri/src/embeddings.rs | head -10
```
Expected: all four items are already `pub`. If any are `pub(crate)` or private, escalate (this would be unexpected — RESEARCH §10 R8 confirms they're public production API).

**Step 2: Read `embeddings.rs:496-728` end-to-end** to capture the full block being relocated.

**Step 3: REPLACE the Wave 1 stub at `src-tauri/src/evals/hybrid_search_eval.rs`** with the full eval. The new file structure (per PATTERNS §"hybrid_search_eval.rs"):

```rust
//! Phase 16 / EVAL-03 (synthetic).
//!
//! Hand-picked 4-dim embeddings + scripted scenarios verify the RRF fusion
//! math without invoking the real fastembed model. Floor: top-3 ≥ 80% +
//! MRR ≥ 0.6 across 8 asserted scenarios. The 3 adversarial fixtures
//! (long content, unicode CJK+emoji, near-duplicate pair) are surfaced
//! `relaxed` per RESEARCH §7 EVAL-03 — they appear in the table but are
//! excluded from floor math in this iteration.
//!
//! Run with: `cargo test --lib evals::hybrid_search_eval -- --nocapture --test-threads=1`
//!
//! Source: this file is the relocated `mod memory_recall_eval` from
//! `embeddings.rs:496-728` (commit 9c5674a 2026-04-28 baseline). Helpers
//! are now centralized in `super::harness`.

use super::harness::{print_eval_table, reciprocal_rank, top1_hit, topk_hit, temp_blade_env, EvalRow};
use crate::embeddings::{SearchResult, VectorStore};

// ────────────────────────────────────────────────────────────
// Fixtures
// ────────────────────────────────────────────────────────────

struct Fixture {
    source_id: &'static str,
    content: &'static str,
    embedding: [f32; 4],
}

/// Baseline 8-fixture corpus — copy verbatim from `embeddings.rs:517-566`.
/// 4 axes: family / running / oncall / food.
fn corpus() -> Vec<Fixture> {
    // [VERBATIM from embeddings.rs:517-566]
    // executor: copy the exact 8 fixtures here (mom_name, dad_name, sister_name,
    // brother_name, runs_tuesday, runs_friday, oncall_pager, oncall_chef,
    // food_ramen, food_pasta — adjust to match the actual baseline content
    // exactly as it stands today). Do NOT alter content or embedding values.
    todo!("copy 8 baseline fixtures from embeddings.rs:517-566")
}

/// 3 NEW adversarial fixtures (RESEARCH §7 EVAL-03). All `relaxed` in this
/// iteration — they surface in the table but do NOT contribute to floor math.
fn adversarial_corpus() -> Vec<Fixture> {
    vec![
        Fixture {
            source_id: "mem_long_capability_gap",
            content: "Capability gap detected on 2026-04-29T14:32:11Z while attempting to fulfill \
                      user request 'export Linear ticket LIN-1247 to Markdown and post to #eng-updates': \
                      missing tool `linear-cli` from capability catalog. Stderr blob: '/bin/sh: linear-cli: \
                      command not found'. Routed to evolution_log_capability_gap. Catalog miss; falling \
                      back to search_npm_for_mcp(\"linear\") which returned 4 candidates: \
                      mcp-server-linear (npm v0.3.1, 1.2k weekly downloads, last published 2026-03-14, \
                      repo: github.com/example/mcp-server-linear, license: MIT), linear-mcp-bridge \
                      (npm v0.0.7, 23 weekly downloads, last published 2025-11-02, repo: \
                      github.com/example/linear-mcp-bridge, license: Apache-2.0), wrap-linear-cli \
                      (npm v1.0.0, 4 weekly downloads, last published 2025-08-21, repo: \
                      github.com/example/wrap-linear-cli, license: MIT), linear-tools-experimental \
                      (npm v0.0.0-alpha.4, 1 weekly download, last published 2025-12-30, repo: \
                      github.com/example/linear-tools-experimental, license: GPL-3.0). \
                      Recommendation: install mcp-server-linear via auto_install path; fallback \
                      to manual install if cooldown gate triggers. End of capability_gap_detected \
                      event payload.",
            embedding: [0.10, 0.20, 0.85, 0.05], // work-axis dominant
        },
        Fixture {
            source_id: "mem_unicode_food",
            content: "ユーザーはラーメン (Tonkotsu, シェフAkira at 谷中の店) を週2回食べる 🍜",
            embedding: [0.0, 0.30, 0.0, 0.85], // food-axis primary
        },
        Fixture {
            source_id: "mem_runs_wednesday",
            content: "User runs 5K every Wednesday morning at the riverside park",
            embedding: [0.0, 0.85, 0.10, 0.0], // INTENTIONALLY identical to baseline mem_runs_tuesday
        },
    ]
}

// ────────────────────────────────────────────────────────────
// Fixture builder
// ────────────────────────────────────────────────────────────

fn build_test_store() -> (tempfile::TempDir, VectorStore) {
    let temp = temp_blade_env();
    let mut store = VectorStore::new();
    for f in corpus() {
        store.add(
            f.content.to_string(),
            f.embedding.to_vec(),
            "test_fixture".to_string(),
            f.source_id.to_string(),
        );
    }
    for f in adversarial_corpus() {
        store.add(
            f.content.to_string(),
            f.embedding.to_vec(),
            "test_fixture_adversarial".to_string(),
            f.source_id.to_string(),
        );
    }
    (temp, store)
}

// ────────────────────────────────────────────────────────────
// Scenarios — (query, expected_source_id, label, query_embedding, relaxed)
// ────────────────────────────────────────────────────────────

#[derive(Clone)]
struct Scenario {
    query: &'static str,
    expected: &'static str,
    label: &'static str,
    embedding: [f32; 4],
    relaxed: bool,
}

fn scenarios() -> Vec<Scenario> {
    let mut s = Vec::new();
    // [VERBATIM from embeddings.rs:604-641]
    // executor: copy the 9 baseline scenarios here (8 asserted + 1 noise-only relaxed).
    // Each scenario gets `relaxed: false` UNLESS it's the noise-only scenario which
    // already had relaxed semantics in the original test body.
    // ...
    // After the 9 baseline scenarios, append 3 adversarial scenarios:
    s.push(Scenario {
        query: "operational log linear capability gap",
        expected: "mem_long_capability_gap",
        label: "adversarial_long_content",
        embedding: [0.10, 0.20, 0.85, 0.05],
        relaxed: true,
    });
    s.push(Scenario {
        query: "ラーメン preference Tonkotsu",
        expected: "mem_unicode_food",
        label: "adversarial_unicode",
        embedding: [0.0, 0.30, 0.0, 0.85],
        relaxed: true,
    });
    s.push(Scenario {
        query: "wednesday morning run",
        expected: "mem_runs_wednesday",
        label: "adversarial_near_duplicate",
        embedding: [0.0, 0.85, 0.10, 0.0],
        relaxed: true,
    });
    s
}

// ────────────────────────────────────────────────────────────
// Test
// ────────────────────────────────────────────────────────────

#[test]
fn evaluates_synthetic_hybrid_recall() {
    let (_temp, store) = build_test_store();
    let mut rows: Vec<EvalRow> = Vec::new();

    for sc in scenarios() {
        let results: Vec<SearchResult> = store.hybrid_search(sc.query, &sc.embedding, 3);
        let top3_ids: Vec<String> = results.iter().take(3).map(|r| r.source_id.clone()).collect();
        rows.push(EvalRow {
            label: sc.label.to_string(),
            top1: top1_hit(&results, sc.expected),
            top3: topk_hit(&results, sc.expected, 3),
            rr: reciprocal_rank(&results, sc.expected),
            top3_ids,
            expected: sc.expected.to_string(),
            relaxed: sc.relaxed,
        });
    }

    print_eval_table("Hybrid search regression eval (synthetic 4-dim)", &rows);

    // Floor enforcement — preserved verbatim from `embeddings.rs:698-707`,
    // generalised to use harness::summarize.
    let s = super::harness::summarize(&rows);
    let asserted_total = s.asserted_total as f32;
    assert!(
        (s.asserted_top3_count as f32 / asserted_total) >= 0.80,
        "asserted top-3 recall {}/{} below 80% floor",
        s.asserted_top3_count,
        s.asserted_total,
    );
    assert!(
        s.asserted_mrr >= 0.6,
        "asserted MRR {:.3} below 0.6 floor",
        s.asserted_mrr,
    );
}

// ────────────────────────────────────────────────────────────
// Smoke tests — preserve from embeddings.rs:711-727
// ────────────────────────────────────────────────────────────

#[test]
fn empty_query_returns_empty() {
    // [VERBATIM copy from embeddings.rs:711-718]
    // Asserts non-panic + bounded length when query is empty.
    todo!("copy from embeddings.rs:711-718 — uses build_test_store + empty query")
}

#[test]
fn empty_store_returns_empty() {
    // [VERBATIM copy from embeddings.rs:720-727]
    // Asserts non-panic + bounded length on empty VectorStore.
    todo!("copy from embeddings.rs:720-727 — uses VectorStore::new + any query")
}
```

**The four `todo!()` markers** are EXPLICIT executor-handoff points where the verbatim content from `embeddings.rs` must be copied:
- `corpus()` — copy fixtures from `embeddings.rs:517-566` (8 entries)
- `scenarios()` baseline section — copy from `embeddings.rs:604-641` (9 entries — 8 asserted + 1 originally-relaxed)
- `empty_query_returns_empty` — copy from `embeddings.rs:711-718`
- `empty_store_returns_empty` — copy from `embeddings.rs:720-727`

**Replace each `todo!()` with the verbatim source — no edits to fixture content, embedding values, query strings, or expected source_ids.** The only edits permitted: change inlined-helper calls (`reciprocal_rank(&results, expected)`) to harness-imported calls (already done in the test body above) and change `std::env::set_var` etc. to `temp_blade_env()` calls.

**Step 4: Verify compilation** (CLAUDE.md "batch edits"):
```bash
cd src-tauri && cargo test --lib evals::hybrid_search_eval --no-run --test-threads=1 2>&1 | tail -10
```

**Step 5: Run the eval and confirm floors hold:**
```bash
cd src-tauri && cargo test --lib evals::hybrid_search_eval -- --nocapture --test-threads=1 2>&1 | tail -40
```
Expected: scored table prints with `┌──` opening, 12 rows (9 baseline + 3 adversarial), summary line + asserted-rollup line, exit 0. The asserted rollup must show top-3 ≥ 80% and MRR ≥ 0.6 (these are the original 8/8 floors).

**Important: do NOT delete `embeddings.rs:510-728`** — Plan 07 owns the deletion after Wave 2 evals are all green.
  </action>

  <acceptance_criteria>
- `test -f src-tauri/src/evals/hybrid_search_eval.rs` exits 0
- File is no longer the Wave 1 stub: `wc -l src-tauri/src/evals/hybrid_search_eval.rs` ≥ 240
- `grep -q "use super::harness" src-tauri/src/evals/hybrid_search_eval.rs` exits 0
- `grep -q "use crate::embeddings::" src-tauri/src/evals/hybrid_search_eval.rs` exits 0
- `grep -q "fn evaluates_synthetic_hybrid_recall" src-tauri/src/evals/hybrid_search_eval.rs` exits 0
- `grep -q "mem_long_capability_gap" src-tauri/src/evals/hybrid_search_eval.rs` exits 0 (long-content adversarial fixture present)
- `grep -q "mem_unicode_food" src-tauri/src/evals/hybrid_search_eval.rs` exits 0 (unicode adversarial fixture present)
- `grep -q "mem_runs_wednesday" src-tauri/src/evals/hybrid_search_eval.rs` exits 0 (near-duplicate adversarial fixture present)
- `grep -q "ラーメン" src-tauri/src/evals/hybrid_search_eval.rs` exits 0 (CJK content present)
- File contains zero `todo!()` markers — `! grep -q "todo!" src-tauri/src/evals/hybrid_search_eval.rs` (executor must replace ALL stubs)
- `cd src-tauri && cargo test --lib evals::hybrid_search_eval --no-run --test-threads=1` exits 0
- `cd src-tauri && cargo test --lib evals::hybrid_search_eval -- --nocapture --test-threads=1` exits 0
- Stdout from above command contains `┌──` — `cd src-tauri && cargo test --lib evals::hybrid_search_eval -- --nocapture --test-threads=1 2>&1 | grep -q '┌──'`
- Stdout shows MRR ≥ 0.6 in the asserted-rollup line — `... | grep -E 'asserted.*MRR: 0\.([6-9]|[0-9][0-9])|MRR: 1\.0'` (asserted MRR floor)
- The literal `embeddings.rs:510-728` block is STILL PRESENT — `grep -q "mod memory_recall_eval" src-tauri/src/embeddings.rs` (Plan 07 deletes it later)
  </acceptance_criteria>

  <verify>
    <automated>cd src-tauri && cargo test --lib evals::hybrid_search_eval -- --nocapture --test-threads=1 2>&1 | tee /tmp/16-02-out.log | tail -20 && grep -q '┌──' /tmp/16-02-out.log && ! grep -q "todo!" src-tauri/src/evals/hybrid_search_eval.rs</automated>
  </verify>

  <done>`evals/hybrid_search_eval.rs` is fully populated (no `todo!()` markers); `cargo test --lib evals::hybrid_search_eval -- --nocapture --test-threads=1` exits 0; stdout carries the `┌──` table with 12 rows; asserted-floor (8/8) holds; the original `embeddings.rs:510-728` is left in place for Plan 07 to delete.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| (none in this plan) | All test fixtures are synthetic; no untrusted input. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-16-02-01 | I (Information disclosure) | Fixture content (e.g. mom_name, oncall_chef) — could be construed as PII if real | mitigate | Fixtures are SYNTHETIC test data per RESEARCH §7. Names like "Akira" / "Sarah" / "User" are fictional. Plan-checker MUST verify no real-personal-data appears in this corpus. |
| T-16-02-02 | T (Tampering) | Floor assertion bypass — a future edit could weaken `>= 0.80` to `>= 0.50` | accept | Plan 07's `verify-eval.sh` does NOT re-grep thresholds (would create drift). The Rust `assert!` line in this file IS the source of truth. Code review is the protective control. |
| T-16-02-03 | D (DoS) | Long-content fixture (~3KB) inflates BM25 corpus stats | mitigate | The fixture is gate-relaxed (RESEARCH §7) so a recall regression on it does NOT fail CI; surfaces visibly instead. Memory cost: ~3KB × 1 fixture × 1 test run = negligible. |

**Severity rollup:** all LOW. Synthetic fixtures + relaxed adversarial gating + verbatim verification means this plan does not introduce new exposures.
</threat_model>

<verification>
After the 1 task completes:

```bash
cd src-tauri && cargo test --lib evals::hybrid_search_eval -- --nocapture --test-threads=1 2>&1 | tail -25
# Expected: scored table with `┌── Hybrid search regression eval (synthetic 4-dim) ──` header,
# 12 rows (9 baseline labels + 3 adversarial_*), one or more rows tagged `(relaxed)`,
# summary line `│ top-1: X/12 (Y%)  top-3: X/12 (Y%)  MRR: Z.ZZZ`,
# asserted-rollup line `│ asserted (gate floors): top-1: 8/8 (100%)  top-3: ≥7/8 (≥87%)  MRR: ≥0.6`,
# closing `└──...─┘`, then `test result: ok` and exit 0.
```
</verification>

<success_criteria>
1. `evals/hybrid_search_eval.rs` is no longer a stub — full eval body present, all 4 `todo!()` markers replaced with verbatim content from `embeddings.rs`
2. `cargo test --lib evals::hybrid_search_eval -- --nocapture --test-threads=1` exits 0
3. Stdout carries `┌──` opening (EVAL-06 contract)
4. Asserted rollup proves the 8-scenario baseline floor holds: top-3 ≥ 80%, MRR ≥ 0.6
5. The 3 adversarial fixtures appear in the table (verifiable via `grep` on stdout for `adversarial_long_content`, `adversarial_unicode`, `adversarial_near_duplicate`)
6. The original `embeddings.rs:510-728` block remains in place (Plan 07 deletes it)
7. EVAL-03 (synthetic) requirement satisfied
</success_criteria>

<output>
After completion, create `.planning/phases/16-eval-scaffolding-expansion/16-02-SUMMARY.md` documenting:
- File replaced (Wave 1 stub → full eval module)
- Source line ranges relocated from `embeddings.rs` (496-728)
- Adversarial fixtures added (3, all `relaxed: true` in this iteration)
- Asserted floor result (e.g. "top-3: 8/8 (100%), MRR: 0.97")
- Relaxed-row results (e.g. which adversarial scenarios passed/failed for visibility)
- Cargo command + exit code
</output>
