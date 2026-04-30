---
phase: 16-eval-scaffolding-expansion
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src-tauri/src/evals/mod.rs
  - src-tauri/src/evals/harness.rs
  - src-tauri/src/lib.rs
autonomous: true
requirements: [EVAL-01]
must_haves:
  truths:
    - "`cargo test --lib evals::harness --no-run` exits 0 (harness compiles)"
    - "`harness::print_eval_table` is callable with the EVAL-06 box-drawing format"
    - "`harness::temp_blade_env` returns a TempDir with `BLADE_CONFIG_DIR` set + db initialized"
    - "`HasSourceId` trait is implemented for `embeddings::SearchResult` so search-style helpers work uniformly"
  artifacts:
    - path: "src-tauri/src/evals/mod.rs"
      provides: "Module-tree root declaring 5 eval submodules + pub harness"
      contains: "#[cfg(test)] pub mod harness"
    - path: "src-tauri/src/evals/harness.rs"
      provides: "Shared helpers: HasSourceId, EvalRow, EvalSummary, reciprocal_rank, top1_hit, topk_hit, summarize, print_eval_table, temp_blade_env"
      min_lines: 120
    - path: "src-tauri/src/lib.rs"
      provides: "`#[cfg(test)] mod evals;` registration"
      contains: "mod evals"
  key_links:
    - from: "src-tauri/src/lib.rs"
      to: "src-tauri/src/evals/mod.rs"
      via: "#[cfg(test)] mod evals declaration"
      pattern: "#\\[cfg\\(test\\)\\]\\s*mod evals"
    - from: "src-tauri/src/evals/harness.rs"
      to: "src-tauri/src/embeddings.rs::SearchResult"
      via: "impl HasSourceId for SearchResult"
      pattern: "impl HasSourceId for SearchResult"
---

<objective>
Scaffold the `evals/` module tree under `src-tauri/src/` and ship the shared harness that all five eval modules will import. This plan blocks every other plan in Phase 16 — without `harness::print_eval_table` and `harness::temp_blade_env`, the four eval modules in Wave 2 cannot compile.

Purpose: De-duplicate the helpers currently inlined in `embeddings.rs:586-601, 820-835, 870-899` and centralize the EVAL-06 scored-table format spec so every eval prints the same shape (`┌──` delimiter + per-row + mid-rule + summary + close).

Output: Three files (`evals/mod.rs`, `evals/harness.rs`, `lib.rs` registration line). Zero asserts in this plan — the harness is plumbing, not a test. EVAL-01's "≥2 modules use the helpers" floor is satisfied transitively when Wave 2 lands.
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
@CLAUDE.md
@src-tauri/src/embeddings.rs
@src-tauri/src/lib.rs
@src-tauri/src/agents/mod.rs
@src-tauri/src/providers/mod.rs

<interfaces>
<!-- Key types/contracts the executor needs. Verbatim from `embeddings.rs`. -->
<!-- Use these directly — no codebase exploration needed for this plan. -->

From src-tauri/src/embeddings.rs (production, public):
```rust
pub struct SearchResult {
    pub source_id: String,
    pub content: String,
    // ... other fields exist; only source_id matters for HasSourceId
}
pub struct VectorStore { /* ... */ }
impl VectorStore {
    pub fn new() -> Self;
    pub fn add(&mut self, content: String, embedding: Vec<f32>, source: String, source_id: String);
    pub fn hybrid_search(&self, query: &str, query_embedding: &[f32], k: usize) -> Vec<SearchResult>;
}
pub fn embed_texts(texts: Vec<String>) -> Result<Vec<Vec<f32>>, String>;
pub fn cosine_similarity(a: &[f32], b: &[f32]) -> f32;
```

From src-tauri/src/db.rs:
```rust
pub fn init_db() -> Result<(), String>;
```

From `embeddings.rs:586-601` (helpers being extracted):
```rust
fn reciprocal_rank(results: &[SearchResult], expected: &str) -> f32 {
    for (i, r) in results.iter().enumerate() {
        if r.source_id == expected { return 1.0 / ((i + 1) as f32); }
    }
    0.0
}
fn top1_hit(results: &[SearchResult], expected: &str) -> bool {
    results.first().map(|r| r.source_id == expected).unwrap_or(false)
}
fn topk_hit(results: &[SearchResult], expected: &str, k: usize) -> bool {
    results.iter().take(k).any(|r| r.source_id == expected)
}
```

From `embeddings.rs:570-572` (temp-env pattern):
```rust
let temp = TempDir::new().expect("tempdir");
std::env::set_var("BLADE_CONFIG_DIR", temp.path());
let _ = crate::db::init_db();
```

From `embeddings.rs:870-899` (the scored-table format — EVAL-06 contract):
```text
┌── {title} ──
│ {label:32} top1=✓ top3=✓ rr=1.00 → top3=["a","b","c"] (want=mem_x)
├─────────────────────────────────────────────────────────
│ top-1: 7/7 (100%)  top-3: 7/7 (100%)  MRR: 1.000
└─────────────────────────────────────────────────────────
```
</interfaces>

<gotchas>
1. **`safe_slice` rule (CLAUDE.md):** the harness MUST use `crate::safe_slice` if it ever truncates `row.label` for display. Current `{:32}` width pads-not-truncates (safe). Document this in the file header so future edits don't regress to `{:.32}` byte-truncation which panics on multi-byte CJK.
2. **`harness` MUST be `pub`** (or `pub(crate)`) inside `evals/mod.rs` — the four sibling eval modules `use super::harness::*;`. Other 5 submodules can stay private (they're test-only, never imported elsewhere).
3. **`#[cfg(test)]` everywhere** — release builds must NOT carry eval code. Both `mod.rs` declarations and `harness.rs` content are gated.
4. **Lib name is `blade_lib`** (Cargo.toml) — `cargo test --lib` targets it unambiguously.
5. **No `cargo check` after every edit** (CLAUDE.md) — batch all three files, then run `cargo test --lib evals::harness --no-run` once at the end.
6. **No `#[tauri::command]` in evals/** — these are internal test modules; the flat-namespace gotcha doesn't fire.
</gotchas>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Create evals module tree root</name>
  <files>src-tauri/src/evals/mod.rs (NEW)</files>

  <read_first>
    - src-tauri/src/agents/mod.rs (lines 1-7) — flat `pub mod` block analog
    - src-tauri/src/providers/mod.rs (lines 1-5) — even simpler all-pub-mod analog
    - .planning/phases/16-eval-scaffolding-expansion/16-RESEARCH.md (§3, lines 170-183) — exact module-declaration block to write
    - .planning/phases/16-eval-scaffolding-expansion/16-PATTERNS.md (§ "src-tauri/src/evals/mod.rs", lines 31-72) — pattern assignment
  </read_first>

  <action>
Create `src-tauri/src/evals/mod.rs` with this EXACT content (verbatim from RESEARCH §3):

```rust
//! Eval harness — Phase 16 (.planning/phases/16-eval-scaffolding-expansion).
//!
//! Resolves with `cargo test --lib evals -- --nocapture --test-threads=1`.
//! Each submodule prints a scored table in the format defined by
//! `harness::print_eval_table` (EVAL-06 contract: lead with `┌──`).
//!
//! See also: `tests/evals/DEFERRED.md` for v1.3 candidates (EVAL-08).
//! See also: `scripts/verify-eval.sh` for the CI gate (EVAL-07).

#[cfg(test)] pub mod harness;
#[cfg(test)] mod hybrid_search_eval;
#[cfg(test)] mod real_embedding_eval;
#[cfg(test)] mod kg_integrity_eval;
#[cfg(test)] mod typed_memory_eval;
#[cfg(test)] mod capability_gap_eval;
```

NOTE: At this point in Wave 1, the five sibling submodule files do NOT yet exist. That is INTENTIONAL — Plans 02-06 create them in Wave 2. The `mod harness;` declaration alone must compile in this wave; the other five `mod foo;` lines reference files that will exist after Wave 2.

**Compilation strategy:** since cargo will fail to compile `mod hybrid_search_eval;` etc. in Wave 1 if the files don't exist, add the four placeholder files as empty stubs in this same task (Task 1). For each of `hybrid_search_eval.rs`, `real_embedding_eval.rs`, `kg_integrity_eval.rs`, `typed_memory_eval.rs`, `capability_gap_eval.rs`, create a one-line stub:

```rust
//! Phase 16 eval — populated in Wave 2 (Plan NN).
```

Wave 2 plans replace these stubs with their full eval modules. The stubs prevent a compile-broken intermediate state between Wave 1 and Wave 2 merges.

**Files this task creates:**
1. `src-tauri/src/evals/mod.rs` (full content above)
2. `src-tauri/src/evals/hybrid_search_eval.rs` (stub)
3. `src-tauri/src/evals/real_embedding_eval.rs` (stub)
4. `src-tauri/src/evals/kg_integrity_eval.rs` (stub)
5. `src-tauri/src/evals/typed_memory_eval.rs` (stub)
6. `src-tauri/src/evals/capability_gap_eval.rs` (stub)
  </action>

  <acceptance_criteria>
- `test -f src-tauri/src/evals/mod.rs` exits 0
- `test -f src-tauri/src/evals/harness.rs` is NOT YET checked (Task 2 creates it)
- `test -f src-tauri/src/evals/hybrid_search_eval.rs` exits 0 (stub present)
- `test -f src-tauri/src/evals/real_embedding_eval.rs` exits 0 (stub present)
- `test -f src-tauri/src/evals/kg_integrity_eval.rs` exits 0 (stub present)
- `test -f src-tauri/src/evals/typed_memory_eval.rs` exits 0 (stub present)
- `test -f src-tauri/src/evals/capability_gap_eval.rs` exits 0 (stub present)
- `grep -q "pub mod harness" src-tauri/src/evals/mod.rs` exits 0
- `grep -c "#\[cfg(test)\]" src-tauri/src/evals/mod.rs` returns ≥6 (one per declaration)
- `grep -q "mod hybrid_search_eval" src-tauri/src/evals/mod.rs` exits 0
  </acceptance_criteria>

  <verify>
    <automated>test -f src-tauri/src/evals/mod.rs && grep -q "pub mod harness" src-tauri/src/evals/mod.rs && [ $(ls src-tauri/src/evals/*.rs | wc -l) -ge 6 ]</automated>
  </verify>

  <done>`src-tauri/src/evals/` directory exists with `mod.rs` + 5 stub `.rs` files; `mod.rs` declares `pub mod harness` plus 5 private cfg(test) submodule references.</done>
</task>

<task type="auto">
  <name>Task 2: Write harness.rs with shared helpers + scored-table printer + temp-env</name>
  <files>src-tauri/src/evals/harness.rs (NEW)</files>

  <read_first>
    - src-tauri/src/embeddings.rs (lines 510-728) — synthetic eval, source of `reciprocal_rank` (586), `top1_hit` (595), `topk_hit` (599), `build_test_store` (568-583), scored-table printer (663-692)
    - src-tauri/src/embeddings.rs (lines 820-899) — real-embedding eval, source of duplicate helpers (820-835) + canonical printer (870-899) — `{:32}` width is the chosen canonical
    - .planning/phases/16-eval-scaffolding-expansion/16-RESEARCH.md (§3 — exported-symbols spec table; §4 — scored-table format strings verbatim)
    - .planning/phases/16-eval-scaffolding-expansion/16-PATTERNS.md (§ "src-tauri/src/evals/harness.rs", lines 75-141) — full pattern assignment with verbatim code excerpts
    - src-tauri/src/db.rs — confirm `pub fn init_db() -> Result<(), String>` exists (the temp-env helper calls it)
  </read_first>

  <action>
Create `src-tauri/src/evals/harness.rs` containing the EXACT shape below. Sources: `embeddings.rs:586-601` (helpers), `embeddings.rs:570-572` (temp-env), `embeddings.rs:870-899` (printer). Each function annotated with its source line.

```rust
//! Shared eval harness — Phase 16 (.planning/phases/16-eval-scaffolding-expansion).
//!
//! Centralises helpers extracted from `embeddings.rs:586-601, 820-835, 870-899`
//! so all 5 eval modules emit the same EVAL-06 scored-table format.
//!
//! ## EVAL-06 contract
//! Every eval calls [`print_eval_table`] which leads with `┌──` (U+250C U+2500 U+2500).
//! `scripts/verify-eval.sh` greps stdout for that prefix to confirm tables emitted.
//!
//! ## `safe_slice` rule (CLAUDE.md)
//! Current label width is `{:32}` (left-pad — safe for any UTF-8 input).
//! If a future edit changes to `{:.32}` (byte-truncate), the unicode adversarial
//! fixture in `hybrid_search_eval` will panic. Use `crate::safe_slice` instead.
//!
//! ## Cargo parallelism (RESEARCH §10 R1)
//! [`temp_blade_env`] mutates the `BLADE_CONFIG_DIR` env var — a process-global.
//! `verify-eval.sh` and per-task commands MUST pin `--test-threads=1`.

use tempfile::TempDir;

use crate::embeddings::SearchResult;

/// Trait letting the same RR/top-k helpers work for `SearchResult` (embeddings)
/// and any custom result row a future eval invents (e.g. KG / typed_memory).
pub trait HasSourceId {
    fn source_id(&self) -> &str;
}

impl HasSourceId for SearchResult {
    fn source_id(&self) -> &str {
        &self.source_id
    }
}

/// One row in the scored-table output. Carries enough state for both the
/// per-row `│ ...` line and the summary roll-up.
#[derive(Debug, Clone)]
pub struct EvalRow {
    pub label: String,
    pub top1: bool,
    pub top3: bool,
    pub rr: f32,
    pub top3_ids: Vec<String>,
    pub expected: String,
    /// `true` → row surfaces in the table but is excluded from floor math.
    /// Used for adversarial fixtures (long content, unicode, near-duplicates)
    /// in their first iteration before promotion to asserted floor.
    pub relaxed: bool,
}

/// Roll-up over a slice of [`EvalRow`]. Computes both "all" and "asserted"
/// (gate-floor) statistics so evals can `assert!(summary.asserted_mrr >= 0.6)`
/// without re-doing the math.
#[derive(Debug, Clone, Copy)]
pub struct EvalSummary {
    pub total: usize,
    pub top1_count: usize,
    pub top3_count: usize,
    pub mrr: f32,
    pub asserted_total: usize,
    pub asserted_top1_count: usize,
    pub asserted_top3_count: usize,
    pub asserted_mrr: f32,
}

/// Reciprocal Rank: `1 / (1-indexed rank of expected source_id)` or `0` if absent.
/// Source: `embeddings.rs:586`.
pub fn reciprocal_rank<T: HasSourceId>(results: &[T], expected: &str) -> f32 {
    for (i, r) in results.iter().enumerate() {
        if r.source_id() == expected {
            return 1.0 / ((i + 1) as f32);
        }
    }
    0.0
}

/// `true` iff the first result's `source_id` matches `expected`.
/// Source: `embeddings.rs:595`.
pub fn top1_hit<T: HasSourceId>(results: &[T], expected: &str) -> bool {
    results.first().map(|r| r.source_id() == expected).unwrap_or(false)
}

/// `true` iff `expected` appears in the first `k` results.
/// Source: `embeddings.rs:599`.
pub fn topk_hit<T: HasSourceId>(results: &[T], expected: &str, k: usize) -> bool {
    results.iter().take(k).any(|r| r.source_id() == expected)
}

/// Compute "all" + "asserted" (i.e. non-relaxed-only) summaries from a row slice.
pub fn summarize(rows: &[EvalRow]) -> EvalSummary {
    let total = rows.len();
    let top1_count = rows.iter().filter(|r| r.top1).count();
    let top3_count = rows.iter().filter(|r| r.top3).count();
    let mrr = if total == 0 {
        0.0
    } else {
        rows.iter().map(|r| r.rr).sum::<f32>() / total as f32
    };

    let asserted: Vec<&EvalRow> = rows.iter().filter(|r| !r.relaxed).collect();
    let asserted_total = asserted.len();
    let asserted_top1_count = asserted.iter().filter(|r| r.top1).count();
    let asserted_top3_count = asserted.iter().filter(|r| r.top3).count();
    let asserted_mrr = if asserted_total == 0 {
        0.0
    } else {
        asserted.iter().map(|r| r.rr).sum::<f32>() / asserted_total as f32
    };

    EvalSummary {
        total,
        top1_count,
        top3_count,
        mrr,
        asserted_total,
        asserted_top1_count,
        asserted_top3_count,
        asserted_mrr,
    }
}

/// Print the EVAL-06 box-drawing scored table.
///
/// Format reference (`embeddings.rs:870-899`):
/// ```text
/// ┌── {title} ──
/// │ {label:32} top1=✓ top3=✓ rr=1.00 → top3=["a","b","c"] (want=mem_x)
/// ├─────────────────────────────────────────────────────────
/// │ top-1: 7/7 (100%)  top-3: 7/7 (100%)  MRR: 1.000
/// └─────────────────────────────────────────────────────────
/// ```
///
/// If any row carries `relaxed: true`, prints both an "all" rollup and an
/// "asserted (gate floors)" rollup so the eval can floor on the asserted line.
pub fn print_eval_table(title: &str, rows: &[EvalRow]) {
    println!("\n┌── {} ──", title);
    for row in rows {
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
    }
    let s = summarize(rows);
    println!("├─────────────────────────────────────────────────────────");
    println!(
        "│ top-1: {}/{} ({:.0}%)  top-3: {}/{} ({:.0}%)  MRR: {:.3}",
        s.top1_count,
        s.total,
        if s.total == 0 { 0.0 } else { (s.top1_count as f32 / s.total as f32) * 100.0 },
        s.top3_count,
        s.total,
        if s.total == 0 { 0.0 } else { (s.top3_count as f32 / s.total as f32) * 100.0 },
        s.mrr,
    );
    if rows.iter().any(|r| r.relaxed) {
        println!(
            "│ asserted (gate floors): top-1: {}/{} ({:.0}%)  top-3: {}/{} ({:.0}%)  MRR: {:.3}",
            s.asserted_top1_count,
            s.asserted_total,
            if s.asserted_total == 0 { 0.0 } else { (s.asserted_top1_count as f32 / s.asserted_total as f32) * 100.0 },
            s.asserted_top3_count,
            s.asserted_total,
            if s.asserted_total == 0 { 0.0 } else { (s.asserted_top3_count as f32 / s.asserted_total as f32) * 100.0 },
            s.asserted_mrr,
        );
    }
    println!("└─────────────────────────────────────────────────────────\n");
}

/// Spin up an isolated temp config dir + initialised db for any eval that
/// touches SQLite-backed storage. **NOT thread-safe** — `BLADE_CONFIG_DIR`
/// is a process-global env var. Pin `cargo test --test-threads=1`.
///
/// Source: `embeddings.rs:570-572`.
pub fn temp_blade_env() -> TempDir {
    let temp = TempDir::new().expect("tempdir");
    std::env::set_var("BLADE_CONFIG_DIR", temp.path());
    let _ = crate::db::init_db();
    temp
}
```

**Implementation notes:**
- The `if s.total == 0 { 0.0 } else { ... }` guards against divide-by-zero. The original `embeddings.rs` printer assumes non-empty slices; centralising means defending against the empty case once.
- `EvalRow::top3_ids` uses `Vec<String>` (not `Vec<&str>`) so the row outlives any borrow of the search results. The eval modules build owned strings when they construct rows.
- The `relaxed` field defaults to `false` for every existing scenario in `hybrid_search_eval` and `real_embedding_eval` — only the 3 NEW adversarial fixtures (Plan 02 EVAL-03) set it to `true`.
  </action>

  <acceptance_criteria>
- `test -f src-tauri/src/evals/harness.rs` exits 0
- `wc -l src-tauri/src/evals/harness.rs` reports ≥120 lines (full content above is ~155 lines)
- `grep -q "pub fn reciprocal_rank" src-tauri/src/evals/harness.rs` exits 0
- `grep -q "pub fn top1_hit" src-tauri/src/evals/harness.rs` exits 0
- `grep -q "pub fn topk_hit" src-tauri/src/evals/harness.rs` exits 0
- `grep -q "pub fn print_eval_table" src-tauri/src/evals/harness.rs` exits 0
- `grep -q "pub fn temp_blade_env" src-tauri/src/evals/harness.rs` exits 0
- `grep -q "pub fn summarize" src-tauri/src/evals/harness.rs` exits 0
- `grep -q "pub trait HasSourceId" src-tauri/src/evals/harness.rs` exits 0
- `grep -q "impl HasSourceId for SearchResult" src-tauri/src/evals/harness.rs` exits 0
- `grep -q "pub struct EvalRow" src-tauri/src/evals/harness.rs` exits 0
- `grep -q "pub struct EvalSummary" src-tauri/src/evals/harness.rs` exits 0
- File contains the literal string `┌──` (U+250C U+2500 U+2500) — `grep -q '┌──' src-tauri/src/evals/harness.rs`
- File contains `safe_slice` rule documentation — `grep -q "safe_slice" src-tauri/src/evals/harness.rs`
  </acceptance_criteria>

  <verify>
    <automated>test -f src-tauri/src/evals/harness.rs && grep -q "pub fn print_eval_table" src-tauri/src/evals/harness.rs && grep -q "pub fn temp_blade_env" src-tauri/src/evals/harness.rs && grep -q "pub trait HasSourceId" src-tauri/src/evals/harness.rs && grep -q "┌──" src-tauri/src/evals/harness.rs</automated>
  </verify>

  <done>`harness.rs` exists with all 7 exported helpers (4 functions + 1 trait + 2 structs + 1 trait impl), `┌──` format string is the EVAL-06-conformant printer, `safe_slice` rule is documented in module-level doc comment.</done>
</task>

<task type="auto">
  <name>Task 3: Register evals module in lib.rs and verify the harness compiles</name>
  <files>src-tauri/src/lib.rs (MOD)</files>

  <read_first>
    - src-tauri/src/lib.rs (lines 1-110) — existing flat `mod foo;` block; find `mod embeddings;` (~line 82) for placement
    - .planning/phases/16-eval-scaffolding-expansion/16-PATTERNS.md (§ "src-tauri/src/lib.rs", lines 647-682) — registration analog + 3-step rule
    - CLAUDE.md "Module registration (EVERY TIME)" section — confirms only step 1 applies (no command, no config field)
  </read_first>

  <action>
1. Open `src-tauri/src/lib.rs`. Locate the line `mod embeddings;` (~line 82 per PATTERNS).
2. Immediately AFTER `mod embeddings;` insert these two lines:

```rust
#[cfg(test)]
mod evals;
```

The `#[cfg(test)]` attribute is mandatory — release builds must NOT carry eval code. CLAUDE.md "module registration 3-step rule" only step 1 applies here (no `#[tauri::command]`, no `BladeConfig` field).

3. Do NOT touch the `generate_handler!` invocation — there are zero `#[tauri::command]` functions in `evals/`.

4. After the edit, run **once** (CLAUDE.md "don't cargo check after every edit"):

```bash
cd src-tauri && cargo test --lib evals::harness --no-run --test-threads=1 2>&1 | tail -20
```

This compiles the harness without running any tests. Expected outcome: clean exit 0, "Compiling blade ...", "Finished test [unoptimized + debuginfo] target(s) in Xs", "Executable unittests src/lib.rs (target/debug/deps/blade_lib-...)". The 5 stub submodule files compile as no-ops because they're just doc comments.

If the build fails:
- "could not find `db` in `crate`" → `db::init_db` is not at the expected path; grep for `pub fn init_db` and update the `crate::db::init_db()` call in `harness.rs` to the real path.
- "no field `source_id` on type `SearchResult`" → `SearchResult` has been renamed; verify struct shape via `grep -n "pub struct SearchResult" src-tauri/src/embeddings.rs` and adjust the `impl HasSourceId for SearchResult`.
- "tempfile crate not found" → confirm `tempfile = "3"` exists in `src-tauri/Cargo.toml` `[dev-dependencies]` (it does, per RESEARCH §0).
  </action>

  <acceptance_criteria>
- `grep -q "^#\[cfg(test)\]$" src-tauri/src/lib.rs` exits 0 (the cfg-test attribute line exists)
- `grep -A1 "^#\[cfg(test)\]$" src-tauri/src/lib.rs | grep -q "^mod evals;$"` (the cfg(test) attribute is followed by mod evals)
- `grep -c "^mod evals;$" src-tauri/src/lib.rs` returns 1 (single registration, not duplicated)
- `cd src-tauri && cargo test --lib evals::harness --no-run --test-threads=1 2>&1 | grep -q "Finished"` exits 0
- `cd src-tauri && cargo test --lib evals::harness --no-run --test-threads=1` exit code is 0
  </acceptance_criteria>

  <verify>
    <automated>cd src-tauri && cargo test --lib evals::harness --no-run --test-threads=1 2>&1 | tail -5 | grep -q "Finished"</automated>
  </verify>

  <done>`lib.rs` contains `#[cfg(test)] mod evals;` after `mod embeddings;`. `cargo test --lib evals::harness --no-run` exits 0, proving the harness + 5 stub eval modules + lib.rs registration all compile together.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| (none in this plan) | No untrusted input crosses any boundary. Plan creates internal-only `#[cfg(test)]` code. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-16-01-01 | I (Information disclosure) | `harness::temp_blade_env` mutates `BLADE_CONFIG_DIR` env var | accept | Process-global env var, but harness is `#[cfg(test)]`-gated and never ships in release builds. Test parallelism mitigated by `--test-threads=1` (RESEARCH §10 R1). |
| T-16-01-02 | T (Tampering) | `evals/` submodule files referenced from `mod.rs` could be replaced by attacker | accept | Source files are part of the repo; tampering would require commit access, which is the existing trust boundary. Out of scope for code-level mitigation. |
| T-16-01-03 | D (Denial of service) | `harness::temp_blade_env` leaks ~10MB temp dirs if `TempDir::Drop` doesn't fire on panic | accept | `tempfile::TempDir` Drop is well-established; OS temp dirs are auto-cleaned on reboot. Low-severity per RESEARCH A6. |

**Severity rollup:** all threats LOW. No mitigations required for Phase 16 scope. T-1/T-2/T-3 from planning context (eval fixture content + verify-eval.sh shell-out + cargo parallelism) all map to LOW severity here — none introduce a new exposure beyond what already exists in `embeddings.rs:570-572`.
</threat_model>

<verification>
After all 3 tasks complete:

```bash
# Compilation gate (no asserts; harness is plumbing)
cd src-tauri && cargo test --lib evals::harness --no-run --test-threads=1
# Expected: exit 0; "Finished test [unoptimized + debuginfo] target(s)" on stdout
```

The harness has zero `#[test]` functions of its own — it's used by the 4 eval modules in Wave 2. EVAL-01's "≥2 modules use the helpers" floor is satisfied transitively after Plan 07 closes (all 5 eval modules import `super::harness::*`).
</verification>

<success_criteria>
1. `src-tauri/src/evals/mod.rs` exists with `pub mod harness` + 5 `#[cfg(test)] mod *;` declarations
2. `src-tauri/src/evals/harness.rs` exists with 7 exported symbols (`HasSourceId`, `EvalRow`, `EvalSummary`, `reciprocal_rank`, `top1_hit`, `topk_hit`, `summarize`, `print_eval_table`, `temp_blade_env`)
3. `src-tauri/src/lib.rs` carries `#[cfg(test)] mod evals;`
4. `cargo test --lib evals::harness --no-run --test-threads=1` exits 0
5. The 5 sibling stub files exist so `mod` declarations resolve
6. EVAL-01 frontmatter binding satisfied: this plan delivers the harness; downstream Wave 2 plans satisfy the "≥2 modules use it" floor.
</success_criteria>

<output>
After completion, create `.planning/phases/16-eval-scaffolding-expansion/16-01-SUMMARY.md` documenting:
- Files created (mod.rs, harness.rs, 5 stubs)
- File modified (lib.rs)
- Compilation verified (exit code + last "Finished" line of stdout)
- Helpers exported (full list with line numbers in harness.rs)
- Note: Wave 2 plans replace the stubs with full eval modules
</output>
