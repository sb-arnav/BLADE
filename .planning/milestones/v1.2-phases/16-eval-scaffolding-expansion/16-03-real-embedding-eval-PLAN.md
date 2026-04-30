---
phase: 16-eval-scaffolding-expansion
plan: 03
type: execute
wave: 2
depends_on: [16-01]
files_modified:
  - src-tauri/src/evals/real_embedding_eval.rs
autonomous: true
requirements: [EVAL-03]
must_haves:
  truths:
    - "`cargo test --lib evals::real_embedding_eval -- --nocapture --test-threads=1` exits 0"
    - "stdout contains the `┌──` delimiter (EVAL-06 contract)"
    - "7-query fastembed corpus floor preserved: top-3 ≥ 80%, MRR ≥ 0.6"
    - "Smoke test `embedder_produces_sane_vectors` runs with vector dim ∈ [128, 4096], magnitude > 0.1"
  artifacts:
    - path: "src-tauri/src/evals/real_embedding_eval.rs"
      provides: "End-to-end fastembed AllMiniLML6V2 recall eval (7 queries / 8 facts) + sanity smoke"
      min_lines: 200
      contains: "fn evaluates_real_embedding_recall"
  key_links:
    - from: "src-tauri/src/evals/real_embedding_eval.rs"
      to: "src-tauri/src/evals/harness.rs"
      via: "use super::harness::*"
      pattern: "use super::harness"
    - from: "src-tauri/src/evals/real_embedding_eval.rs"
      to: "src-tauri/src/embeddings.rs::embed_texts"
      via: "use crate::embeddings::embed_texts"
      pattern: "embed_texts"
---

<objective>
Replace the Wave 1 stub at `src-tauri/src/evals/real_embedding_eval.rs` with the full real-embedding eval. Source: `embeddings.rs:730-946` (`mod memory_recall_real_embedding` + the smoke sub-fn) — moved verbatim with helpers swapped to `harness::*`.

Purpose: Preserve the end-to-end eval that exercises the actual fastembed `AllMiniLML6V2` model with 8 BLADE-shaped facts (mom_name, exercise_routine, food_pref, oncall, etc.) and 7 natural-language queries. This is the eval that proves the embedding pipeline produces useful semantics for BLADE's real domain — not just RRF math correctness. Floor: top-3 ≥ 80%, MRR ≥ 0.6 across 7 queries (matches the 2026-04-28 baseline at 7/7 top-1, MRR 1.000).

Output: A single `.rs` file with `#[test] fn evaluates_real_embedding_recall` + `#[test] fn embedder_produces_sane_vectors`. The relocation is verbatim from `embeddings.rs:748-946` with helpers swapped. The 7-query corpus is NOT expanded (RESEARCH §"Deferred Ideas" explicitly forbids 50+ queries in this phase).
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
pub fn print_eval_table(title: &str, rows: &[EvalRow]);
pub fn reciprocal_rank<T: HasSourceId>(results: &[T], expected: &str) -> f32;
pub fn top1_hit<T: HasSourceId>(results: &[T], expected: &str) -> bool;
pub fn topk_hit<T: HasSourceId>(results: &[T], expected: &str, k: usize) -> bool;
pub fn temp_blade_env() -> tempfile::TempDir;
pub fn summarize(rows: &[EvalRow]) -> EvalSummary;
pub struct EvalRow { /* ... */ }
```

<!-- From `embeddings.rs` (production, public): -->
```rust
pub fn embed_texts(texts: Vec<String>) -> Result<Vec<Vec<f32>>, String>;
pub fn cosine_similarity(a: &[f32], b: &[f32]) -> f32;
pub struct VectorStore { /* ... */ }
impl VectorStore {
    pub fn new() -> Self;
    pub fn add(&mut self, content: String, embedding: Vec<f32>, source: String, source_id: String);
    pub fn hybrid_search(&self, query: &str, query_embedding: &[f32], k: usize) -> Vec<SearchResult>;
}
pub struct SearchResult { pub source_id: String, /* ... */ }
```

<!-- The block being relocated — `embeddings.rs:730-946` — structure:
- Lines 730-746: doc-comment header (cost note about 80MB cold-start)
- Lines 748-758: mod opening + use statements
- Lines 760-795: 8 BLADE-shaped fact corpus (real prose)
- Lines 798-818: real-embedding fixture builder (calls `embed_texts` at line 805)
- Lines 820-835: helpers (now in harness — drop)
- Lines 840-854: 7-query scenarios (natural language)
- Lines 861-915: `#[test] fn evaluates_real_embedding_recall` body + asserts (lines 906-915)
- Lines 870-899: scored-table printer (now in harness — drop, call print_eval_table)
- Lines 921-945: `#[test] fn embedder_produces_sane_vectors` smoke
-->
```
</interfaces>

<gotchas>
1. **Cold fastembed download** — first invocation downloads ~80MB of model weights and takes 20-30s (RESEARCH §10 R2). Do NOT add `#[ignore]`. The `verify-eval.sh` in Plan 07 inherits this latency budget.
2. **`embed_texts` static initialization** — fastembed uses a global `OnceLock<EMBEDDER>`. Multiple tests in the same process reuse it (warm path is sub-second). With `--test-threads=1` the static init serializes correctly.
3. **`--test-threads=1` mandatory** — `temp_blade_env` mutates `BLADE_CONFIG_DIR` (RESEARCH §10 R1).
4. **Floor must hold at 7/7 top-1 / MRR 1.000** — that's the 2026-04-28 baseline (commit `9c5674a`). Any drop indicates either (a) the embedding model was swapped (verify Cargo.toml `fastembed = "5"` unchanged) or (b) the fixture content drifted. The eval should NOT be modified to "fit" a lower floor.
5. **DO NOT expand the 7-query corpus** — RESEARCH §"Deferred Ideas" explicitly defers 50+ query expansion to v1.3. Move verbatim.
6. **DO NOT delete `embeddings.rs:730-946` in this plan** — Plan 07 owns the deletion.
7. **Smoke test stays in this file** — `embedder_produces_sane_vectors` (lines 921-945) is a sanity check on the same `embed_texts` path; PATTERNS §"real_embedding_eval.rs" line 243 says keep it co-located.
</gotchas>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Extract real-embedding eval to evals/real_embedding_eval.rs (verbatim move + helper swap)</name>
  <files>src-tauri/src/evals/real_embedding_eval.rs (REPLACE Wave 1 stub)</files>

  <read_first>
    - src-tauri/src/embeddings.rs (lines 730-946) — full block being moved (header doc, 8-fact corpus, fixture builder with embed_texts call, helpers (drop), 7 scenarios, test body, asserts, smoke test)
    - src-tauri/src/evals/harness.rs (Plan 01 output) — imports the new file uses
    - .planning/phases/16-eval-scaffolding-expansion/16-PATTERNS.md (§ "src-tauri/src/evals/real_embedding_eval.rs", lines 211-247) — full pattern assignment
    - .planning/phases/16-eval-scaffolding-expansion/16-RESEARCH.md (§1 lines 114-124 — verbatim baseline anatomy; §10 R2 — cold-start risk)
  </read_first>

  <action>
**Step 1: Read `embeddings.rs:730-946` end-to-end** to capture the full block being relocated. Note these line ranges precisely (executor must copy verbatim from each):

| Source range | What it is | Disposition |
|---|---|---|
| `embeddings.rs:730-746` | Doc-comment header (cost note) | Copy verbatim, retitle for new location |
| `embeddings.rs:748-758` | mod opening + use statements | Replace with `use super::harness::*;` etc. |
| `embeddings.rs:760-795` | 8-fact corpus | Copy verbatim |
| `embeddings.rs:798-818` | Fixture builder (calls `embed_texts` at 805) | Copy verbatim, swap env-setup to `temp_blade_env()` |
| `embeddings.rs:820-835` | Inlined helpers | DROP — use `super::harness::*` |
| `embeddings.rs:840-854` | 7 scenarios | Copy verbatim |
| `embeddings.rs:861-868` | Test fn opening + setup | Copy verbatim |
| `embeddings.rs:870-899` | Inlined scored-table printer | DROP — use `harness::print_eval_table` |
| `embeddings.rs:900-915` | Floor asserts | Copy verbatim, route through `harness::summarize` |
| `embeddings.rs:921-945` | `embedder_produces_sane_vectors` smoke | Copy verbatim |

**Step 2: REPLACE the Wave 1 stub at `src-tauri/src/evals/real_embedding_eval.rs`** with the full eval. The new file structure (per PATTERNS §"real_embedding_eval.rs"):

```rust
//! Phase 16 / EVAL-03 (real fastembed).
//!
//! End-to-end recall eval using the real `AllMiniLML6V2` model. The
//! synthetic-4-dim eval (`evals::hybrid_search_eval`) verifies the RRF
//! ranking math; this eval verifies the embedding model produces useful
//! semantics for BLADE's real domain (mom_name, exercise routine, food
//! preferences, oncall arrangement, birthday, etc.).
//!
//! ## Cost
//! First invocation downloads ~80MB of model weights and compiles the
//! model graph (~20-30s). Subsequent runs in the same process reuse the
//! global EMBEDDER static (sub-second).
//!
//! ## Run
//! `cargo test --lib evals::real_embedding_eval -- --nocapture --test-threads=1`
//!
//! Source: this file is the relocated `mod memory_recall_real_embedding`
//! from `embeddings.rs:730-946` (commit 9c5674a 2026-04-28 baseline:
//! 7/7 top-1, MRR 1.000). Helpers are now centralised in `super::harness`.

use super::harness::{print_eval_table, reciprocal_rank, summarize, temp_blade_env, top1_hit, topk_hit, EvalRow};
use crate::embeddings::{cosine_similarity, embed_texts, SearchResult, VectorStore};

// ────────────────────────────────────────────────────────────
// Fact corpus — 8 BLADE-shaped facts (REAL prose, not 4-dim hand-picks).
// VERBATIM from embeddings.rs:760-795
// ────────────────────────────────────────────────────────────

struct Fact {
    source_id: &'static str,
    content: &'static str,
}

fn fact_corpus() -> Vec<Fact> {
    // [VERBATIM from embeddings.rs:760-795]
    // 8 facts: owner_name, family, lang_pref, exercise, meeting, food, oncall, birthday.
    // Executor: copy the exact 8 entries from the source.
    todo!("copy 8 facts from embeddings.rs:760-795")
}

// ────────────────────────────────────────────────────────────
// Fixture builder — real `embed_texts` call.
// VERBATIM from embeddings.rs:798-818
// ────────────────────────────────────────────────────────────

fn build_real_store() -> (tempfile::TempDir, VectorStore) {
    let temp = temp_blade_env();
    let mut store = VectorStore::new();
    let facts = fact_corpus();
    let texts: Vec<String> = facts.iter().map(|f| f.content.to_string()).collect();
    let embeddings = embed_texts(texts.clone()).expect("embed_texts");
    for (fact, embedding) in facts.iter().zip(embeddings.iter()) {
        store.add(
            fact.content.to_string(),
            embedding.clone(),
            "test_real_fixture".to_string(),
            fact.source_id.to_string(),
        );
    }
    (temp, store)
}

// ────────────────────────────────────────────────────────────
// 7 natural-language queries — VERBATIM from embeddings.rs:840-854
// ────────────────────────────────────────────────────────────

struct RealScenario {
    query: &'static str,
    expected: &'static str,
    label: &'static str,
}

fn real_scenarios() -> Vec<RealScenario> {
    // [VERBATIM from embeddings.rs:840-854]
    // 7 entries: mom_query, exercise_query, food_query, oncall_query, birthday_query,
    // lang_query, meeting_query.
    todo!("copy 7 scenarios from embeddings.rs:840-854")
}

// ────────────────────────────────────────────────────────────
// Real-embedding recall eval
// ────────────────────────────────────────────────────────────

#[test]
fn evaluates_real_embedding_recall() {
    let (_temp, store) = build_real_store();
    let mut rows: Vec<EvalRow> = Vec::new();

    for sc in real_scenarios() {
        let q_emb = embed_texts(vec![sc.query.to_string()]).expect("query embed");
        let q_vec = q_emb.first().expect("non-empty");
        let results: Vec<SearchResult> = store.hybrid_search(sc.query, q_vec, 3);
        let top3_ids: Vec<String> = results.iter().take(3).map(|r| r.source_id.clone()).collect();
        rows.push(EvalRow {
            label: sc.label.to_string(),
            top1: top1_hit(&results, sc.expected),
            top3: topk_hit(&results, sc.expected, 3),
            rr: reciprocal_rank(&results, sc.expected),
            top3_ids,
            expected: sc.expected.to_string(),
            relaxed: false,
        });
    }

    print_eval_table("Memory recall eval (real fastembed AllMiniLML6V2)", &rows);

    // Floor enforcement — preserved verbatim from embeddings.rs:900-915,
    // generalised to use harness::summarize.
    let s = summarize(&rows);
    let total = s.total as f32;
    assert!(
        (s.top3_count as f32 / total) >= 0.80,
        "real-embedding top-3 recall {}/{} below 80% floor",
        s.top3_count,
        s.total,
    );
    assert!(
        s.mrr >= 0.6,
        "real-embedding MRR {:.3} below 0.6 floor",
        s.mrr,
    );
}

// ────────────────────────────────────────────────────────────
// Smoke test — VERBATIM from embeddings.rs:921-945
// ────────────────────────────────────────────────────────────

#[test]
fn embedder_produces_sane_vectors() {
    // [VERBATIM from embeddings.rs:921-945]
    // Asserts:
    //   - dim ∈ [128, 4096] (AllMiniLML6V2 is 384)
    //   - magnitude > 0.1 (non-zero embedding)
    //   - cosine_similarity between two distinct inputs < 0.999 (not collapsed)
    todo!("copy from embeddings.rs:921-945 — calls embed_texts on 2 distinct texts")
}
```

**The three `todo!()` markers** are EXPLICIT executor-handoff points where the verbatim content from `embeddings.rs` must be copied:
- `fact_corpus()` — copy 8 facts from `embeddings.rs:760-795`
- `real_scenarios()` — copy 7 query scenarios from `embeddings.rs:840-854`
- `embedder_produces_sane_vectors` body — copy from `embeddings.rs:921-945`

**Replace each `todo!()` with the verbatim source — no edits to fact content, query strings, or expected source_ids.**

**Step 3: Verify compilation** (CLAUDE.md "batch edits"):
```bash
cd src-tauri && cargo test --lib evals::real_embedding_eval --no-run --test-threads=1 2>&1 | tail -10
```

**Step 4: Run the eval (cold path may take ~30s):**
```bash
cd src-tauri && cargo test --lib evals::real_embedding_eval -- --nocapture --test-threads=1 2>&1 | tail -40
```
Expected: `┌── Memory recall eval (real fastembed AllMiniLML6V2) ──` header, 7 rows, summary line `top-1: 7/7 (100%)  top-3: 7/7 (100%)  MRR: 1.000` (matches 2026-04-28 baseline), exit 0.

**Important: do NOT delete `embeddings.rs:730-946`** — Plan 07 owns the deletion.
  </action>

  <acceptance_criteria>
- `test -f src-tauri/src/evals/real_embedding_eval.rs` exits 0
- File is no longer the Wave 1 stub: `wc -l src-tauri/src/evals/real_embedding_eval.rs` ≥ 200
- `grep -q "use super::harness" src-tauri/src/evals/real_embedding_eval.rs` exits 0
- `grep -q "use crate::embeddings::" src-tauri/src/evals/real_embedding_eval.rs` exits 0
- `grep -q "fn evaluates_real_embedding_recall" src-tauri/src/evals/real_embedding_eval.rs` exits 0
- `grep -q "fn embedder_produces_sane_vectors" src-tauri/src/evals/real_embedding_eval.rs` exits 0
- `grep -q "AllMiniLML6V2" src-tauri/src/evals/real_embedding_eval.rs` exits 0 (model name in title)
- File contains zero `todo!()` markers — `! grep -q "todo!" src-tauri/src/evals/real_embedding_eval.rs`
- `cd src-tauri && cargo test --lib evals::real_embedding_eval --no-run --test-threads=1` exits 0
- `cd src-tauri && cargo test --lib evals::real_embedding_eval -- --nocapture --test-threads=1` exits 0 (may take 30s on cold path)
- Stdout contains `┌──` — the EVAL-06 contract
- Stdout shows MRR ≥ 0.6 — `... | grep -E 'MRR: 0\.([6-9]|[0-9][0-9])|MRR: 1\.0'`
- The original `embeddings.rs:730-946` block remains in place — `grep -q "memory_recall_real_embedding" src-tauri/src/embeddings.rs` (Plan 07 deletes it later)
  </acceptance_criteria>

  <verify>
    <automated>cd src-tauri && cargo test --lib evals::real_embedding_eval -- --nocapture --test-threads=1 2>&1 | tee /tmp/16-03-out.log | tail -25 && grep -q '┌──' /tmp/16-03-out.log && ! grep -q "todo!" src-tauri/src/evals/real_embedding_eval.rs</automated>
  </verify>

  <done>`evals/real_embedding_eval.rs` is fully populated (no `todo!()` markers); both `#[test]` functions run; cargo exits 0; stdout carries the `┌──` table; floor (top-3 ≥ 80%, MRR ≥ 0.6) holds; the original `embeddings.rs:730-946` is left in place for Plan 07 to delete.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Network → fastembed model download | Cold-start fetches ~80MB from a model registry on first run only. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-16-03-01 | I (Information disclosure) | 8 BLADE-shaped fact fixtures (mom_name, exercise routine, food preference, etc.) | mitigate | Fixtures are SYNTHETIC — names like "Mary" / "Tonkotsu" / "Tuesday morning" are fictional templates that resemble user content, not actual user data. Plan-checker MUST verify no real-personal-data appears in this corpus. |
| T-16-03-02 | T (Tampering) | fastembed model download could be MITM'd in a hostile network | accept | Model is downloaded by `fastembed` crate which uses HTTPS + checksum verification (per fastembed docs). CI runs with cached models after first cold start. WSL/local-dev exposure equals the existing `cargo build` exposure for any crate. |
| T-16-03-03 | D (DoS) | Cold-start adds 20-30s to first CI run | accept | Documented in module header. CI cache hits make this rare. RESEARCH §10 R2 says "if WSL/CI flakiness emerges, gate behind cargo feature" — out of scope for Phase 16 default config. |

**Severity rollup:** all LOW. Synthetic fixtures + standard fastembed integration + verbatim relocation = no new exposures vs. the 2026-04-28 baseline already in CI.
</threat_model>

<verification>
After the 1 task completes:

```bash
cd src-tauri && cargo test --lib evals::real_embedding_eval -- --nocapture --test-threads=1 2>&1 | tail -25
# Expected (warm path, ~5s; cold path ~30s):
# ┌── Memory recall eval (real fastembed AllMiniLML6V2) ──
# │ mom_query                        top1=✓ top3=✓ rr=1.00 → top3=["mom_name", ...] (want=mom_name)
# │ ...
# ├─────────────────────────────────────────────────────────
# │ top-1: 7/7 (100%)  top-3: 7/7 (100%)  MRR: 1.000
# └─────────────────────────────────────────────────────────
# test result: ok. 2 passed; 0 failed
```
</verification>

<success_criteria>
1. `evals/real_embedding_eval.rs` is no longer a stub — full eval body present, all 3 `todo!()` markers replaced with verbatim content from `embeddings.rs`
2. `cargo test --lib evals::real_embedding_eval -- --nocapture --test-threads=1` exits 0
3. Stdout carries `┌──` opening (EVAL-06 contract)
4. The 7-query baseline floor holds: top-3 ≥ 80%, MRR ≥ 0.6 (matches 2026-04-28 7/7 top-1, MRR 1.000 baseline)
5. Smoke test `embedder_produces_sane_vectors` runs and asserts dim ∈ [128, 4096], magnitude > 0.1
6. The original `embeddings.rs:730-946` block remains in place (Plan 07 deletes it)
7. EVAL-03 (real) requirement satisfied
</success_criteria>

<output>
After completion, create `.planning/phases/16-eval-scaffolding-expansion/16-03-SUMMARY.md` documenting:
- File replaced (Wave 1 stub → full eval module)
- Source line ranges relocated from `embeddings.rs` (730-946)
- Cold-start runtime observed (e.g. "first run: 28s; warm run: 4s")
- Floor result (e.g. "top-1: 7/7 (100%), top-3: 7/7 (100%), MRR: 1.000")
- Cargo command + exit code
</output>
