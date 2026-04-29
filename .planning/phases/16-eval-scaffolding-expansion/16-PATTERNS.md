# Phase 16: Eval Scaffolding Expansion — Pattern Map

**Mapped:** 2026-04-29
**Files analyzed:** 12 (7 NEW Rust, 1 NEW bash, 1 NEW markdown, 3 MODIFIED)
**Analogs found:** 12 / 12 (every file has at least a partial analog in the live BLADE codebase)
**Source of truth for the file list:** `16-RESEARCH.md` § 9 + § 11 Wave 0 (no CONTEXT.md — `/gsd-discuss-phase` was skipped)

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src-tauri/src/evals/mod.rs` | module-tree root | declarative | `src-tauri/src/agents/mod.rs` (head) and `src-tauri/src/providers/mod.rs:1-5` | role-match (mod-tree only; not test-gated in either analog) |
| `src-tauri/src/evals/harness.rs` | test utility / shared helpers | request-response (in-process) | `src-tauri/src/embeddings.rs:586-601, 870-899` (helpers + table-printer inlined inside `mod memory_recall_real_embedding`) | exact (these are the helpers being extracted) |
| `src-tauri/src/evals/hybrid_search_eval.rs` | unit test | batch / scored-table | `src-tauri/src/embeddings.rs:510-728` (`mod memory_recall_eval`) | exact (this is the source being moved + 3 fixtures added) |
| `src-tauri/src/evals/real_embedding_eval.rs` | unit test | batch / scored-table | `src-tauri/src/embeddings.rs:748-946` (`mod memory_recall_real_embedding`) | exact (this is the source being moved verbatim) |
| `src-tauri/src/evals/kg_integrity_eval.rs` | unit test | CRUD + integrity assert | NO inline tests in `knowledge_graph.rs`; closest is `src-tauri/src/capability_probe.rs:305-336` (parameterized factory + assertions) | role-match (graph schema known; test pattern borrowed from capability_probe) |
| `src-tauri/src/evals/typed_memory_eval.rs` | unit test | CRUD per category | `src-tauri/src/typed_memory.rs:450-475` (the existing categories-loop in `generate_user_knowledge_summary`) | role-match (categories array + `recall_by_category` loop) |
| `src-tauri/src/evals/capability_gap_eval.rs` | unit test | classifier (input → Option<struct>) | `src-tauri/src/capability_probe.rs:325-340` (table-driven match-style test) and `src-tauri/src/action_tags.rs:215-242` (input → parsed struct) | role-match (no existing tests for `detect_missing_tool`; pattern borrowed from action_tags + capability_probe) |
| `scripts/verify-eval.sh` | CI bash wrapper | smoke test runner | `scripts/verify-chat-rgba.sh` (small / single-grep) and `scripts/verify-phase5-rust-surface.sh` (multi-check + missing-array exit-code convention) | exact (chat-rgba is the ≈25-line model; phase5-rust contributes the exit-code 2 convention) |
| `tests/evals/DEFERRED.md` | structured deferral doc | documentation | `.planning/STATE.md` § Deferred Items (lines 57-69) — table-style; and `.planning/phases/03-dashboard-chat-settings/deferred-items.md` (prose-style) | role-match (doc structure exists; rationale-paragraph shape adapted from STATE.md table) |
| `src-tauri/src/lib.rs` (add `#[cfg(test)] mod evals;`) | module registration | declarative | `src-tauri/src/lib.rs:1-110` (existing `mod foo;` lines — flat block at top) | role-match (no existing `#[cfg(test)] mod` in lib.rs — Phase 16 introduces the first; pattern still mirrors the existing top-of-file `mod` block convention) |
| `src-tauri/src/embeddings.rs` (DELETE 496-946) | deletion | n/a | n/a — pure deletion of code now living elsewhere | n/a (no analog needed) |
| `package.json` (add `verify:eval` + chain) | npm script registration | declarative | `package.json:16` (`"verify:chat-rgba": "bash scripts/verify-chat-rgba.sh"`) and `package.json:40` (the `verify:all` chain tail) | exact (existing 30 `verify:*` scripts; same JSON shape, same `&&` chain convention) |

---

## Pattern Assignments

### `src-tauri/src/evals/mod.rs` (module-tree root, declarative)

**Analog:** `src-tauri/src/agents/mod.rs` (head, lines 1-7) for the leading attribute + `pub mod` block; `src-tauri/src/providers/mod.rs:1-5` for the simpler "just declarations" shape this phase actually wants.

**Module declaration block** (`agents/mod.rs:1-7`):
```rust
#![allow(dead_code)]

pub mod executor;
pub mod planner;
pub mod queue;
pub mod thought_tree;
```

**Even simpler "all-pub-mod" pattern** (`providers/mod.rs:1-5`):
```rust
pub mod anthropic;
pub mod gemini;
pub mod groq;
pub mod ollama;
pub mod openai;
```

**What evals/mod.rs should look like (per RESEARCH.md § 3, lines 170-183):**
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

**Reason this is closest:** `agents/mod.rs` and `providers/mod.rs` are the two simplest sibling-module-tree roots in the lib; both pre-declare submodules at the top of the file in flat `pub mod` blocks before any code. Phase 16's mod.rs is even simpler — declarations only, no types, no fns — so the pattern is borrowed wholesale.

**Gotcha (CLAUDE.md):** `harness` MUST be `pub` (or `pub(crate)`) so the four eval submodules can `use super::harness::*;`. The other five submodules can stay private — they're test-only and never imported elsewhere.

---

### `src-tauri/src/evals/harness.rs` (test utility, shared helpers)

**Analog:** `src-tauri/src/embeddings.rs:586-601` (the three search-helper fns, currently duplicated in *both* existing eval mods) and `embeddings.rs:870-899` (the scored-table printer inlined in `evaluates_real_embedding_recall`).

**Search helpers — the 3-fn block to extract** (`embeddings.rs:586-601`, identical copy at `embeddings.rs:820-835`):
```rust
/// Reciprocal Rank: 1 / (1-indexed rank of expected source_id) or 0 if absent.
fn reciprocal_rank(results: &[SearchResult], expected: &str) -> f32 {
    for (i, r) in results.iter().enumerate() {
        if r.source_id == expected {
            return 1.0 / ((i + 1) as f32);
        }
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

**Generalize over `SearchResult`** by introducing a `HasSourceId` trait (per RESEARCH.md § 3 spec table) so the same helpers work for KG result rows + typed_memory rows. `SearchResult` lives in `embeddings.rs` and gets a one-line `impl HasSourceId for SearchResult { fn source_id(&self) -> &str { &self.source_id } }` placed in `harness.rs` next to the trait def.

**Scored-table printer — extract from** `embeddings.rs:870-899`:
```rust
println!("\n┌── Memory recall eval (real fastembed AllMiniLML6V2) ──");
for (query, expected, label) in &scenarios {
    // ... compute hit1, hit3, rr ...
    let top_ids: Vec<&str> = results.iter().take(3).map(|r| r.source_id.as_str()).collect();
    println!(
        "│ {:32} top1={} top3={} rr={:.2} → top3={:?} (want={})",
        label, if hit1 { "✓" } else { "✗" }, if hit3 { "✓" } else { "✗" }, rr, top_ids, expected,
    );
}
let mrr = rr_sum / total;
println!("├─────────────────────────────────────────────────────────");
println!(
    "│ top-1: {}/{} ({:.0}%)  top-3: {}/{} ({:.0}%)  MRR: {:.3}",
    top1, total as i32, (top1 as f32 / total) * 100.0,
    top3, total as i32, (top3 as f32 / total) * 100.0,
    mrr
);
println!("└─────────────────────────────────────────────────────────\n");
```

**Refactor target:** `harness::print_eval_table(title: &str, rows: &[EvalRow])` + `harness::summarize(rows: &[EvalRow]) -> EvalSummary`. The `EvalRow` struct (RESEARCH.md § 3 spec) carries `{label, top1, top3, rr, top3_ids, expected, relaxed}` so the print_eval_table fn handles BOTH the synthetic eval's "all + asserted" two-line summary (when any row has `relaxed: true`) AND the real eval's single-line summary (when no row is relaxed).

**Temp-env helper — extract from** `embeddings.rs:570-572`:
```rust
let temp = TempDir::new().expect("tempdir");
std::env::set_var("BLADE_CONFIG_DIR", temp.path());
let _ = crate::db::init_db();
```

This becomes `harness::temp_blade_env() -> TempDir`.

**Reason this is closest:** every helper this phase needs already lives inside the two `mod memory_recall_*` blocks in `embeddings.rs`. The phase IS the de-duplication work.

**Gotchas (CLAUDE.md + RESEARCH.md § 10):**
1. `BLADE_CONFIG_DIR` is a process-global env var — `cargo test` parallelism MUST be pinned to `--test-threads=1` (already in VALIDATION.md). The harness should NOT spawn multiple temp dirs concurrently.
2. **`safe_slice` rule applies** to `print_eval_table` only IF it ever truncates `row.label` or `row.expected`. Current widths (`{:32}`) pad-not-truncate, so the rule does not actually fire — but if anyone changes `{:32}` to `{:.32}` (the "max 32 chars" form), it WILL panic on the unicode adversarial fixture's CJK + emoji label. Use `crate::safe_slice(&row.label, 32)` instead. Document this in the harness file's header comment.
3. Helpers must be `pub` (or `pub(crate)`) so submodules can import them via `use super::harness::*;`.

---

### `src-tauri/src/evals/hybrid_search_eval.rs` (unit test, batch / scored-table)

**Analog:** `src-tauri/src/embeddings.rs:510-728` (`#[cfg(test)] mod memory_recall_eval` — the synthetic 4-dim eval being moved verbatim).

**Module-level header to copy** (`embeddings.rs:496-509`):
```rust
// ─── Eval harness ─────────────────────────────────────────────────────────
//
// First quality measurement scaffolding for the memory cluster. Per the v1.2
// maturity audit (2026-04-27), the memory pipeline shipped with zero recall
// quality measurement. This module establishes the pattern: fixture-driven
// scenarios, hand-crafted embeddings (skips the embedder model so it runs
// without GPU/model-init), and explicit top-1 / top-3 / MRR metrics.
//
// Run with: `cargo test --lib memory_recall_eval -- --nocapture`
```

(Update the run-with line to `cargo test --lib evals::hybrid_search_eval -- --nocapture`.)

**Fixture struct + corpus pattern** (`embeddings.rs:517-566`) — the 4-dim `Fixture` and 8-row `corpus()` move WHOLESALE, no edits.

**Build-store fixture-builder pattern** (`embeddings.rs:568-583`):
```rust
fn build_test_store() -> (TempDir, VectorStore) {
    let temp = TempDir::new().expect("tempdir");
    std::env::set_var("BLADE_CONFIG_DIR", temp.path());
    let _ = crate::db::init_db();
    let mut store = VectorStore::new();
    for f in corpus() {
        store.add(
            f.content.to_string(),
            f.embedding.to_vec(),
            "test_fixture".to_string(),
            f.source_id.to_string(),
        );
    }
    (temp, store)
}
```

After Phase 16: replace the hand-rolled body with `let temp = harness::temp_blade_env();` and inline the store loop (or push the loop into `harness::build_store_from_fixtures` if it gets reused).

**Floor assertion pattern** (`embeddings.rs:698-707`) — moves verbatim:
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

**3 NEW adversarial fixtures to add (RESEARCH.md § 7):**
1. **Long-content** — a multi-line capability-gap log shape (~3000 chars) where the discriminating token is buried mid-string. Tests BM25's term-frequency normalization.
2. **Unicode** — CJK + emoji content, e.g. `"会议提醒 standup 9:30 AM 📅"`. Tests that the tokenizer doesn't choke on multi-byte UTF-8.
3. **Near-duplicate** — two fixtures differing in exactly ONE token (e.g. `"User runs 5K every Tuesday morning"` vs `"User runs 5K every Thursday morning"`); query asks for the Thursday one. Tests that BM25 actually weights the discriminating token.

**Gotcha (CLAUDE.md):** the unicode fixture content is allowed to contain raw emoji + CJK — these are **load-bearing test data**, not decoration. CLAUDE.md "no emojis in files unless asked" carves out this case (RESEARCH.md § "Project Constraints", line 67 spells it out). If `harness::print_eval_table` ever calls `safe_slice` on the label, the unicode fixture is the test that catches naïve byte-slicing.

**Reason this is closest:** the file IS the existing `mod memory_recall_eval` block, renamed and relocated, with helpers replaced by `harness::*` calls and 3 fixtures appended.

---

### `src-tauri/src/evals/real_embedding_eval.rs` (unit test, batch / scored-table)

**Analog:** `src-tauri/src/embeddings.rs:748-946` (`#[cfg(test)] mod memory_recall_real_embedding` — moved verbatim).

**Header to copy** (`embeddings.rs:730-746`):
```rust
/// End-to-end recall eval using the real fastembed `AllMiniLML6V2` model.
///
/// `memory_recall_eval` above tests the RRF ranking math with hand-picked
/// 4-dim vectors — it verifies the fusion logic but says nothing about
/// whether the actual embedding model produces useful semantics for
/// BLADE's domain. This mod closes that gap: the corpus is real prose
/// (the kind of facts BLADE actually stores), queries are natural
/// language, and the embedding pipeline runs end-to-end.
///
/// Cost: first run downloads ~80MB of model weights and compiles the
/// model graph (~20-30s). Subsequent runs in the same process reuse
/// the global EMBEDDER static.
```

**Fact corpus** (`embeddings.rs:760-795`) — 8 BLADE-shaped facts. Move verbatim.

**Real-embedding fixture builder** (`embeddings.rs:798-818`) — note `embed_texts` call at line 805. Move verbatim. After Phase 16: optionally route the env-setup through `harness::temp_blade_env()`.

**Test fn signature to preserve** (`embeddings.rs:861-862`):
```rust
#[test]
fn evaluates_real_embedding_recall() {
```

**7-query scenarios** (`embeddings.rs:840-854`) — move verbatim. RESEARCH.md § "Deferred Ideas" explicitly says do NOT expand to 50+ queries in this phase.

**Smoke test sub-fn** (`embeddings.rs:921-945`) — `embedder_produces_sane_vectors`. Keep it in the same file (it's a smoke test for the same `embed_texts` call path).

**Reason this is closest:** verbatim relocation of a 199-line existing test module. Helpers swap to `harness::*`, everything else is unchanged.

**Gotcha (RESEARCH.md § 10 cold-runner risk):** first invocation downloads ~80MB and takes 20-30s. CI cold runs WILL hit this. The plan must NOT add `#[ignore]`. The verify-eval.sh wrapper inherits this latency budget — VALIDATION.md "Estimated runtime" already accounts for it.

---

### `src-tauri/src/evals/kg_integrity_eval.rs` (unit test, CRUD + integrity assert)

**Analog (primary):** `knowledge_graph.rs` has NO inline `#[cfg(test)] mod tests`. Closest test pattern in the lib is `src-tauri/src/capability_probe.rs:305-336` — small inline `mod tests` with a fresh-record factory + targeted assertions.

**Capability_probe test pattern to mirror** (`capability_probe.rs:305-336`):
```rust
#[cfg(test)]
mod tests {
    use super::*;

    fn fresh_record(provider: &str, model: &str, vision: bool, audio: bool, tools: bool, long: bool) -> ProviderCapabilityRecord {
        ProviderCapabilityRecord {
            provider: provider.to_string(),
            model: model.to_string(),
            context_window: if long { 200_000 } else { 8_192 },
            vision,
            audio,
            tool_calling: tools,
            long_context: long,
            last_probed: chrono::Utc::now(),
            probe_status: ProbeStatus::Active,
        }
    }

    #[test]
    fn matrix_anthropic_default() {
        let (v, a, t, lc, ctx) = infer_capabilities("anthropic", "claude-sonnet-4-20250514", None);
        assert_eq!((v, a, t, lc, ctx), (true, false, true, true, 200_000));
    }
}
```

**KnowledgeNode struct shape** (`knowledge_graph.rs:22-31`) — what the eval's fixture builder must produce:
```rust
pub struct KnowledgeNode {
    pub id: String,
    pub concept: String,      // normalized concept name
    pub node_type: String,    // "concept", "person", "project", "technology", "place", "event"
    pub description: String,
    pub sources: Vec<String>,
    pub importance: f32,      // 0.0–1.0
    pub created_at: i64,
    pub last_updated: i64,
}
```

**KnowledgeEdge struct shape** (`knowledge_graph.rs:33-40`):
```rust
pub struct KnowledgeEdge {
    pub from_id: String,
    pub to_id: String,
    pub relation: String,  // "is_a", "part_of", "related_to", "depends_on", ...
    pub strength: f32,     // 0.0–1.0
    pub created_at: i64,
}
```

**`add_node` signature + return** (`knowledge_graph.rs:200`):
```rust
pub fn add_node(n: KnowledgeNode) -> Result<String, String> {
    // Returns the node ID (newly assigned UUID, OR existing ID if concept already present — merge semantics).
}
```

**`add_edge` signature** (`knowledge_graph.rs:337`):
```rust
pub fn add_edge(from_id: &str, to_id: &str, relation: &str, strength: f32) -> Result<(), String> {
    // ON CONFLICT (from_id, to_id, relation) DO UPDATE SET strength = ?4
    // → idempotent in the strength-update sense
}
```

**`get_edges` signature** (`knowledge_graph.rs:355`) — used to detect orphans:
```rust
pub fn get_edges(node_id: &str) -> Vec<KnowledgeEdge> {
    // returns edges where from_id == node_id OR to_id == node_id, ordered by strength DESC
}
```

**Eval shape (per RESEARCH.md § 7):**
1. Build ≥3 nodes with `KnowledgeNode { id: "".into(), concept: ..., ... }` (empty id → `add_node` assigns UUID).
2. Add ≥3 edges with `add_edge(&from_id, &to_id, "related_to", 0.8)`.
3. **Orphan detection:** for each node, `get_edges(&node_id).is_empty()` → if true, that node is an orphan. Assert zero orphans.
4. **Idempotent-merge assertion:** call `add_node(same_concept)` twice; assert second call returns the same ID (merge semantics).
5. Print scored table via `harness::print_eval_table` with custom `EvalRow` rows (label = concept name, top1 = "has edges", top3 = N/A or "merged ID matches").

**Reason this is closest:** capability_probe is the cleanest single-file test pattern in the lib that doesn't depend on `embeddings.rs` machinery. KG has no existing tests, so this phase establishes the pattern.

**Gotchas:**
1. `add_node`'s merge semantics (lines 200-249) — sending the same concept twice returns the **same ID**, not two distinct IDs. Test for this explicitly.
2. KG uses SQLite (`ensure_tables` at line 201) — must use `harness::temp_blade_env()` to isolate state per test run. This applies the same `BLADE_CONFIG_DIR` + `db::init_db()` setup as the embeddings evals.
3. Concept is **normalized to lowercase** (`knowledge_graph.rs:205`) — `"Rust"` and `"rust"` collide. Fixture concept strings should use lowercase to avoid surprises.

---

### `src-tauri/src/evals/typed_memory_eval.rs` (unit test, CRUD per category)

**Analog:** `src-tauri/src/typed_memory.rs:450-475` — the existing categories-loop in `generate_user_knowledge_summary`, which already iterates all 7 `MemoryCategory` variants and calls `recall_by_category` for each.

**Categories iteration pattern** (`typed_memory.rs:450-463`):
```rust
let categories = [
    MemoryCategory::Fact,
    MemoryCategory::Preference,
    MemoryCategory::Decision,
    MemoryCategory::Relationship,
    MemoryCategory::Skill,
    MemoryCategory::Goal,
    MemoryCategory::Routine,
];

let mut sections: Vec<String> = Vec::new();

for cat in &categories {
    let entries = recall_by_category(cat.clone(), 5);
    if entries.is_empty() {
        continue;
    }
    // ...
}
```

**`recall_by_category` signature** (`typed_memory.rs:267`):
```rust
pub fn recall_by_category(category: MemoryCategory, limit: usize) -> Vec<TypedMemory>
```

**`store_typed_memory` signature** (`typed_memory.rs:133-138`) — what the fixture-builder calls per category:
```rust
pub fn store_typed_memory(
    category: MemoryCategory,
    content: &str,
    source: &str,
    confidence: Option<f64>,
) -> Result<String, String>
```

**`MemoryCategory` enum** (`typed_memory.rs:35-44`) — 7 variants, exact list:
```rust
pub enum MemoryCategory {
    Fact,
    Preference,
    Decision,
    Relationship,
    Skill,
    Goal,
    Routine,
}
```

**Eval shape (per RESEARCH.md § 7):**
1. `harness::temp_blade_env()` for SQLite isolation.
2. Insert ≥1 fixture memory per category via `store_typed_memory(cat, content, "test_fixture", Some(0.9))`.
3. Loop over the 7 categories, call `recall_by_category(cat, 10)`, assert exactly the inserted set comes back (set equality on `content` strings).
4. Emit one `EvalRow` per category (label = `cat.as_str()`, top1 = "expected count returned", top3 = "all expected contents present").
5. Print via `harness::print_eval_table`.

**Reason this is closest:** the production code at `typed_memory.rs:450-475` already implements the exact iteration pattern the eval needs. Copy the categories array verbatim; replace the `if entries.is_empty()` continue with an `assert!`-backed check.

**Gotcha (`typed_memory.rs:166-177`):** exact-content duplicate inserts **merge** (boost confidence, return existing ID). The eval must use unique content per fixture or accept that duplicate-insertion is a no-op. **Recommended:** unique content per category to keep assertions clean.

---

### `src-tauri/src/evals/capability_gap_eval.rs` (unit test, classifier)

**Analog (primary):** `src-tauri/src/action_tags.rs:215-242` — input-string → parsed-struct table-driven test pattern. **Secondary analog:** `capability_probe.rs:325-340` for the multi-`#[test]` parameterized style.

**`detect_missing_tool` signature** (`self_upgrade.rs:260`):
```rust
pub fn detect_missing_tool(stderr: &str, command: &str) -> Option<CapabilityGap>
```

**`CapabilityGap` struct** (`self_upgrade.rs:26-32`):
```rust
pub struct CapabilityGap {
    pub description: String,
    pub category: String,    // "missing_tool", "missing_runtime", "missing_permission"
    pub suggestion: String,  // what to install
    pub install_cmd: String, // platform-specific install line; empty = skip
}
```

**Detector behaviour to test** (`self_upgrade.rs:260-286`):
- Returns `Some(gap)` only if stderr contains `"command not found"` / `"is not recognized..."` / `": not found"` / `"No such file or directory"` AND the first whitespace-separated word of `command` is a catalog key.
- Returns `None` for all other stderr.
- Catalog keys (lines 110-242): `"node"`, `"python3"`, `"rust"`, `"docker"`, `"git"`, `"ffmpeg"`, `"claude"`, `"aider"`, `"jq"`, `"ripgrep"`, `"fd"`, `"bat"`, `"go"`, `"htop"`, `"tmux"`.

**Action_tags table-driven test pattern to mirror** (`action_tags.rs:215-242`):
```rust
#[test]
fn test_extract_single_remember() {
    let input = "Here is your answer. [ACTION:REMEMBER:Arnav prefers dark mode]";
    let (clean, actions) = extract_actions(input);
    assert_eq!(clean, "Here is your answer.");
    assert_eq!(actions.len(), 1);
    assert_eq!(actions[0].tag, "REMEMBER");
    assert_eq!(actions[0].args, vec!["Arnav prefers dark mode"]);
}

#[test]
fn test_no_actions() {
    let input = "Nothing special here.";
    let (clean, actions) = extract_actions(input);
    assert_eq!(clean, "Nothing special here.");
}
```

**Eval shape (per RESEARCH.md § 7 + EVAL-05 floor of 7 scenarios):**
1. 6 positive cases — varying stderr phrasings + commands matching different catalog keys (e.g. `("ffmpeg: command not found", "ffmpeg -i in.mp4 out.wav")` → expects `Some(gap)` with `gap.suggestion.contains("ffmpeg")`).
2. 1 false-positive case — stderr says "fd" but `command` is `"cargo build"` (the fix at line 272-285 prevents the old loose-grep behaviour). Expect `None`.
3. Print `EvalRow` per scenario via `harness::print_eval_table` (label = scenario name, top1 = "expected outcome matched", top3 = N/A).

**File-header doc comment** (verbatim from RESEARCH.md § 5, lines 290-298):
```rust
//! Phase 16 / EVAL-05.
//!
//! REQUIREMENTS.md names `evolution::detect_missing_tool` but the live
//! function is `self_upgrade::detect_missing_tool` (verified at
//! `self_upgrade.rs:260`). `evolution.rs` only exposes the related
//! `evolution_log_capability_gap` (line 1115). The eval imports the
//! real path; no re-export added — see Phase 16 RESEARCH §5.
```

**Import line** (verbatim from RESEARCH.md § 5):
```rust
use crate::self_upgrade::{detect_missing_tool, CapabilityGap, capability_catalog};
```

**Reason this is closest:** `action_tags.rs` is the cleanest classifier-test analog in the lib (string in → struct out, table-driven). `capability_probe.rs` shows the named-`#[test]` parameterized style. The detector itself has zero existing tests, so Phase 16 establishes the pattern.

**Gotchas:**
1. **REQ-vs-real path mismatch** — REQUIREMENTS.md says `evolution::detect_missing_tool`; the real path is `self_upgrade::detect_missing_tool`. RESEARCH.md § 5 RESOLVED this — do NOT add a re-export. The doc comment above is mandatory documentation.
2. The detector has an **install cooldown** (`self_upgrade.rs:86-107`) but the cooldown is checked by `auto_install`, NOT `detect_missing_tool`. The eval calls only `detect_missing_tool`, so cooldown state is irrelevant — fixtures can run in any order.

---

### `scripts/verify-eval.sh` (CI bash wrapper, smoke test runner)

**Analog (primary):** `scripts/verify-chat-rgba.sh` — the canonical small bash verify script, ≈42 lines, single-grep, set-euo-pipefail, named-exit-code messages. **Secondary analog:** `scripts/verify-phase5-rust-surface.sh` for the exit-code-2 convention (FILE-MISSING vs. CHECK-FAIL).

**Shebang + comment header pattern** (`verify-chat-rgba.sh:1-21`):
```bash
#!/usr/bin/env bash
# scripts/verify-chat-rgba.sh — D-70 / SC-5 invariant (Plan 03-07 Task 2).
#
# Chat bubbles MUST use solid rgba() fills. ...
# Exits 0 when no backdrop-filter property is found inside src/features/chat/
# (excluding comments that contain the word as documentation). Exits 1 otherwise.
#
# @see .planning/phases/03-dashboard-chat-settings/03-CONTEXT.md §D-07, §D-70

set -euo pipefail
```

**Single-grep + report-failure pattern** (`verify-chat-rgba.sh:28-42`):
```bash
HITS=$(grep -rnE "backdrop-filter\s*:" "$CHAT_CSS_GLOB" --include='*.css' 2>/dev/null || true)

if [ -n "$HITS" ]; then
  echo "[verify-chat-rgba] FAIL: backdrop-filter property detected in $CHAT_CSS_GLOB CSS"
  echo "$HITS"
  echo ""
  echo "  D-70 invariant: chat bubbles MUST use rgba() backgrounds — never backdrop-filter."
  exit 1
fi

echo "[verify-chat-rgba] OK — no backdrop-filter property in $CHAT_CSS_GLOB (D-70 preserved)"
exit 0
```

**Phase5-rust exit-code-2 convention for "wrong cwd / file missing"** (`verify-phase5-rust-surface.sh:18-22`):
```bash
if [ ! -f "$LIB_RS" ]; then
  echo "[verify-phase5-rust-surface] ERROR: $LIB_RS not found; wrong cwd?" >&2
  exit 2
fi
```

**Eval-script shape (per RESEARCH.md § 6 — exit-code contract is locked):**
- **Exit 0:** cargo green AND every eval module printed `┌──`.
- **Exit 1:** cargo failed (test assertion regression).
- **Exit 2:** `┌──` delimiter not found in stdout (table-presence regression).
- **Exit 3:** `cargo` not on PATH.

**Sketch:**
```bash
#!/usr/bin/env bash
# scripts/verify-eval.sh — Phase 16 EVAL-06 + EVAL-07.
#
# Runs cargo test --lib evals -- --nocapture --test-threads=1, captures stdout,
# asserts every module printed a ┌── delimited scored table. Wraps the runtime
# evidence into a single CI-greppable gate.
#
# Exit 0 = cargo pass + tables present
# Exit 1 = cargo failure (assertion regression)
# Exit 2 = ┌── delimiter not found in stdout (table-presence regression)
# Exit 3 = cargo not on PATH
#
# @see .planning/phases/16-eval-scaffolding-expansion/16-RESEARCH.md §6

set -euo pipefail

if ! command -v cargo >/dev/null 2>&1; then
  echo "[verify-eval] ERROR: cargo not on PATH" >&2
  exit 3
fi

OUTPUT=$(cd src-tauri && cargo test --lib evals -- --nocapture --test-threads=1 2>&1) || {
  echo "[verify-eval] FAIL — cargo test --lib evals returned non-zero"
  echo "$OUTPUT" | tail -50
  exit 1
}

# EVAL-06 grep target: U+250C U+2500 U+2500 (the "┌──" prefix every module emits).
TABLE_HITS=$(echo "$OUTPUT" | grep -c "┌──" || true)
EXPECTED=5  # hybrid_search + real_embedding + kg_integrity + typed_memory + capability_gap

if [ "$TABLE_HITS" -lt "$EXPECTED" ]; then
  echo "[verify-eval] FAIL — only $TABLE_HITS scored tables emitted, expected $EXPECTED"
  echo "  EVAL-06 contract: every eval module MUST print a ┌── delimited table."
  exit 2
fi

echo "[verify-eval] OK — $TABLE_HITS/$EXPECTED scored tables emitted, all asserts green"
```

**Reason this is closest:** verify-chat-rgba.sh and verify-eval.sh are functionally identical in shape — both wrap a single check, set -euo pipefail, named-prefix log lines. The exit-code 2 + 3 conventions come from verify-phase5-rust-surface.sh.

**Gotchas:**
1. The grep pattern is the literal box-drawing char `┌──` (U+250C U+2500 U+2500). bash + grep handle UTF-8 fine on macOS / Linux when locale is UTF-8 — which is always true on BLADE's three CI platforms. No `LC_ALL` gymnastics needed. Test locally before committing.
2. `cd src-tauri` is required — `cargo test --lib` resolves the lib via Cargo.toml in the cwd. The `( cd src-tauri && ... )` subshell pattern keeps the script callable from repo root.
3. **`--test-threads=1` is mandatory** (VALIDATION.md). Without it, the `BLADE_CONFIG_DIR` env var races across tests and produces flaky failures.

---

### `tests/evals/DEFERRED.md` (structured deferral doc)

**Analog (primary, table-style):** `.planning/STATE.md` § Deferred Items (lines 57-69). **Secondary (prose-style):** `.planning/phases/03-dashboard-chat-settings/deferred-items.md`.

**STATE.md deferred-items table pattern** (lines 57-69):
```markdown
## Deferred Items

Items acknowledged and deferred at v1.1 milestone close on 2026-04-27 (per `milestones/v1.1-MILESTONE-AUDIT.md` status=tech_debt). All follow the v1.0 Mac-smoke convention (operator-owned, tracked separately):

| Category | Phase | Item | Status | Notes |
|----------|-------|------|--------|-------|
| uat_gaps | 14 | 14-HUMAN-UAT.md | partial | 6 pending — activity-strip cross-route persistence, drawer focus-restore, ... |
```

**Phase-03 deferred-items prose pattern** (lines 1-10):
```markdown
## Discovered during Plan 03-02 execution

### Pre-existing verify:emit-policy violations (introduced by Plan 03-01, NOT this plan)

1. **homeostasis.rs:444 emits `hormone_update` as broadcast** — Plan 03-01 added the parallel emit (WIRE-02). The new event name is intentionally cross-window per D-64 ...
```

**Eval-DEFERRED.md shape (per RESEARCH.md § 8 — 3-entry minimum, EVAL-08 contract):**
- One `## ` heading per deferred eval.
- Each section MUST have `**Rationale:**`, `**Budget:**`, `**Promotion trigger:**` paragraphs (≥3 sentences total — that's the manual-only check at VALIDATION.md "Manual-Only Verifications").

**Sketch (3 entries per RESEARCH.md § 8 + EVAL-08):**
```markdown
# Deferred Evals — v1.3 candidates

These evals were scoped during Phase 16 (v1.2) but deferred because they
require live LLM API calls. v1.2 evals are deterministic, network-free, and
finish under 60s — these three break that contract and need a different
budget envelope.

## extract_conversation_facts precision

**Rationale:** The function calls a live LLM to extract structured facts ...

**Budget:** ~$0.10 per eval run (50 turns × ~600 input tokens × Claude Haiku) ...

**Promotion trigger:** Promote to v1.3 when `tests/evals/RUNTIME.md` budget envelope is
defined OR when a deterministic alternative ships ...

## weekly_memory_consolidation correctness

[same shape]

## evolution.rs::run_evolution_cycle suggestion quality

[same shape]
```

**Reason this is closest:** STATE.md is the live deferred-items doc the milestone uses today; the table-style headings give the right structural skeleton, the Phase-03 doc gives the prose-paragraph rhythm.

**Gotcha (VALIDATION.md "Manual-Only Verifications"):** the rationale-paragraph quality is a **manual** check, not automated. The automated check is just "≥3 `## ` headings present" via `grep -c '^## ' tests/evals/DEFERRED.md`. The executor MUST write meaningful rationale paragraphs — boilerplate "TBD" filler will fail the human gate.

---

### `src-tauri/src/lib.rs` (add `#[cfg(test)] mod evals;`)

**Analog:** `src-tauri/src/lib.rs:1-110` — the existing flat `mod foo;` block at the top of the file. Phase 16 adds the FIRST `#[cfg(test)]` mod in lib.rs (no existing analog inside lib.rs — verified by `grep -n "cfg(test)" src-tauri/src/lib.rs` returning zero `mod`-style hits).

**Existing top-of-file convention** (`lib.rs:1-15`):
```rust
mod accountability;
mod agent_commands;
mod cmd_util;
mod autoskills;
mod git_style;
mod multimodal;
mod roles;
mod ambient;
mod autonomous_research;
mod dream_mode;
mod evolution;
mod research;
mod background_agent;
mod cron;
mod execution_memory;
```

**Phase 16 addition** — single line, alphabetical-or-end-of-block, gated:
```rust
#[cfg(test)]
mod evals;
```

**Insertion location:** put it adjacent to `mod embeddings;` (line 82) since `evals/hybrid_search_eval.rs` and `evals/real_embedding_eval.rs` exercise embeddings code, OR at the very end of the mod-declaration block (after `mod ai_delegate;` ~line 106). Either works; alphabetical placement near `embeddings` is the more discoverable choice.

**Reason this is closest:** lib.rs is the registration surface; the existing 100+ `mod foo;` lines are the only relevant pattern. `#[cfg(test)]` is a 1-line attribute Rust convention — no closer analog exists inside lib.rs.

**Gotchas (CLAUDE.md):**
1. Three-step module registration rule (`Module registration (EVERY TIME)` block in CLAUDE.md): step 1 (`mod evals;` in `lib.rs`) is the only step that applies. Step 2 (`generate_handler!`) does NOT apply — no `#[tauri::command]` in evals. Step 3 (6-place config) does NOT apply — no new `BladeConfig` field.
2. Do NOT batch this with a `cargo check` — CLAUDE.md says batch edits, run check once. The full Phase 16 plan should run `cd src-tauri && cargo test --lib evals --no-run` exactly once at the end of each plan wave.

---

### `src-tauri/src/embeddings.rs` (DELETE 496-946)

**No analog needed — this is pure deletion.**

**Boundary:** lines **1-489** stay untouched (production code: `VectorStore`, `embed_texts`, `hybrid_search`, RRF math, `cosine_similarity`, etc). Lines **496-946** are the two existing inline test modules being relocated to `evals/hybrid_search_eval.rs` + `evals/real_embedding_eval.rs`.

**The two blocks being deleted:**
- `// ─── Eval harness ─────────────...` comment block at lines 496-509 (header).
- `#[cfg(test)] mod memory_recall_eval { ... }` at lines 510-728.
- Blank line 729 + RealEmbedding header doc-comment at 730-746.
- `mod memory_recall_real_embedding { ... }` at lines 748-946.

**Verification before deletion:** the executor MUST grep `embeddings.rs` for any `pub use` of `memory_recall_eval` or `memory_recall_real_embedding` symbols (none expected — both are `#[cfg(test)]`-gated and self-contained). Deletion is safe IFF that grep returns zero.

**File ends at line 489** post-deletion — no trailing structures to clean up other than removing the orphan comment header at 496-509.

**Gotcha:** the delete order matters — execute the move (extract content into `evals/*.rs`) FIRST, run `cargo test --lib evals --no-run` to confirm the new files compile, THEN delete the source. Order-flipping causes a compile-broken intermediate state.

---

### `package.json` (add `verify:eval` + chain into `verify:all`)

**Analog (primary):** `package.json:16` — `"verify:chat-rgba": "bash scripts/verify-chat-rgba.sh"` — the exact JSON shape the new entry should mirror. **Secondary analog:** `package.json:40` — the `verify:all` chain tail.

**Existing `verify:chat-rgba` entry** (`package.json:16`):
```json
    "verify:chat-rgba": "bash scripts/verify-chat-rgba.sh",
```

**Existing `verify:all` tail** (`package.json:40`, last segment shown):
```json
    "verify:all": "npm run verify:entries && npm run verify:no-raw-tauri && ... && npm run verify:empty-states-copy",
```

**Phase 16 additions:**

1. **New script entry** (insert near other bash-wrapped scripts, e.g. between `verify:empty-state-coverage` line 29 and `verify:wiring-audit-shape` line 30):
```json
    "verify:eval": "bash scripts/verify-eval.sh",
```

2. **Chain extension** — append `&& npm run verify:eval` at the end of the `verify:all` chain (before the closing quote):
```json
    "verify:all": "... && npm run verify:empty-states-copy && npm run verify:eval",
```

**JSON formatting convention (verified by `package.json:7-39`):**
- Trailing comma on every entry except the last in a block — script entries all carry `,`.
- 4-space indentation.
- Scripts are NOT alphabetical — they're loosely grouped by domain (verify-* by phase / cluster). Place `verify:eval` near other Rust-/test-touching gates rather than alphabetically.
- The chain in `verify:all` is one giant single-line string — preserve that shape; do NOT reformat to multi-line.

**Count check (per RESEARCH.md § 6 + VALIDATION.md note):** `verify:all` count moves from **30 → 31**. (REQUIREMENTS.md says "27 → 28+" but the live count is 30 — both numbers documented in VALIDATION.md to avoid confusion.)

**Reason this is closest:** the 30 existing `verify:*` scripts ARE the pattern, and `verify:chat-rgba` is the exact same `bash scripts/<name>.sh` shape Phase 16 ships. No closer analog possible.

**Gotcha:** the `verify:all` chain is a single quoted string — adding `&& npm run verify:eval` on the WRONG side of the closing quote (e.g. inside the next entry) will silently fail. The executor MUST verify the JSON parses (`node -e "require('./package.json').scripts['verify:all']"`) before committing.

---

## Shared Patterns

### S1. Temp-env + db init for SQLite-touching evals
**Source:** `src-tauri/src/embeddings.rs:570-572`
**Apply to:** `evals/harness.rs::temp_blade_env`, called by `hybrid_search_eval`, `real_embedding_eval`, `kg_integrity_eval`, `typed_memory_eval` (all 4 search/CRUD evals — `capability_gap_eval` does NOT need it).
```rust
let temp = TempDir::new().expect("tempdir");
std::env::set_var("BLADE_CONFIG_DIR", temp.path());
let _ = crate::db::init_db();
```

### S2. Box-drawing scored-table format (EVAL-06 contract)
**Source:** `src-tauri/src/embeddings.rs:870-899`
**Apply to:** `evals/harness.rs::print_eval_table`, used by ALL 5 eval modules.
- Open: `┌── {title} ──`  (must contain literal `┌──` for `verify-eval.sh` grep)
- Per-row: `│ {label:32} top1={tick} top3={tick} rr={:.2} → top3={top3_ids:?} (want={expected})`
- Mid-rule: `├─────────────────────────────────────────────────────────`
- Summary: `│ top-1: {n}/{N} ({pct:.0}%)  top-3: {n}/{N} ({pct:.0}%)  MRR: {mrr:.3}`
- Close: `└─────────────────────────────────────────────────────────`

### S3. RR / top-1 / top-k helpers (DRY-ed by EVAL-01)
**Source:** `src-tauri/src/embeddings.rs:586-601` (and duplicate at :820-835)
**Apply to:** `evals/harness.rs::{reciprocal_rank, top1_hit, topk_hit}`, used by `hybrid_search_eval`, `real_embedding_eval`, `kg_integrity_eval`. Generalize over a `HasSourceId` trait so the same helpers handle `SearchResult`, KG nodes, and typed_memory rows uniformly.

### S4. Floor-assertion message format
**Source:** `src-tauri/src/embeddings.rs:698-707`
**Apply to:** every eval's final assertion:
```rust
assert!(
    (top3 as f32 / total) >= 0.80,
    "<eval-name> top-3 recall {}/{} below 80% floor",
    top3, total as i32
);
assert!(mrr >= 0.6, "<eval-name> MRR {:.3} below 0.6 floor", mrr);
```

### S5. Bash verify-script skeleton
**Source:** `scripts/verify-chat-rgba.sh:1-42`
**Apply to:** `scripts/verify-eval.sh`
- Shebang `#!/usr/bin/env bash`
- `set -euo pipefail`
- Header comment with `# @see .planning/phases/...`
- `[verify-name] FAIL`/`OK` log-line prefix convention.
- Numeric exit codes 0 (pass) / 1 (check fail) / 2 (table missing) / 3 (cargo missing).

### S6. Single-line `verify:all` chain extension
**Source:** `package.json:40`
**Apply to:** the new `&& npm run verify:eval` suffix. Do NOT split into multi-line — preserve the existing one-liner shape.

---

## No Analog Found

| File | Role | Reason | Fallback |
|------|------|--------|----------|
| (none) | — | All 12 files have at least a partial analog in the live BLADE codebase | n/a |

The closest thing to a "no analog" case is `kg_integrity_eval.rs` — `knowledge_graph.rs` itself has no inline `mod tests`, so the test pattern is borrowed from `capability_probe.rs`. The graph-API surface (struct shapes, fn signatures) IS available verbatim from `knowledge_graph.rs:22-40, 200, 337, 355`.

---

## Project-Wide Gotchas (CLAUDE.md / RESEARCH.md applied to this phase)

1. **Module registration 3-step rule** — only step 1 (`mod evals;` in `lib.rs`) applies. Steps 2 (`generate_handler!`) and 3 (6-place config) DO NOT apply (no `#[tauri::command]`, no new `BladeConfig` fields).
2. **No `cargo check` after every edit** — batch everything, run `cd src-tauri && cargo test --lib evals --no-run` once at the end of each plan wave (~1-2 min).
3. **`safe_slice` rule** — applies if `harness::print_eval_table` ever truncates label / expected fields. Current `{:32}` width pads-not-truncates, so it doesn't fire today, but the unicode adversarial fixture is the test that will catch any future regression to `{:.32}` byte-truncation.
4. **`--test-threads=1` is mandatory** — `BLADE_CONFIG_DIR` env-var races on parallelism (RESEARCH.md § 10 R1, VALIDATION.md). Both the per-module commands and `verify-eval.sh` MUST pin to 1 thread.
5. **fastembed cold-load latency** — first run downloads ~80MB and takes 20-30s (RESEARCH.md § 10). Verify-eval.sh inherits this budget; do NOT add `#[ignore]` on the real-embedding eval.
6. **REQ-vs-real path mismatch on `detect_missing_tool`** — REQUIREMENTS.md says `evolution::`, the live path is `self_upgrade::`. RESOLVED in RESEARCH.md § 5; the eval imports the real path and carries a doc-comment explaining the choice. Do NOT add a re-export.
7. **`blade-uat` carve-out applies** — Phase 16 has no runtime/UI surface. Per CLAUDE.md "Verification protocol applies to runtime/UI changes" + RESEARCH.md "Project Constraints" line 63, the build evidence is `cargo test --lib evals` green, NOT a screenshot. The Stop hook's keyword trigger on "done" is a false positive in this phase.
8. **Lib name is `blade_lib`** (RESEARCH.md "Project Constraints" line 68) — `cargo test --lib` targets it unambiguously.
9. **No new `#[tauri::command]` collision risk** — Phase 16 adds zero command handlers. The flat-namespace gotcha (CLAUDE.md "Common mistakes") doesn't fire.

---

## Metadata

**Analog search scope:** `src-tauri/src/`, `src-tauri/src/agents/`, `src-tauri/src/providers/`, `scripts/`, `.planning/STATE.md`, `.planning/phases/03-dashboard-chat-settings/`, `package.json`
**Files scanned:** 14 source files (lib.rs, embeddings.rs, agents/mod.rs, providers/mod.rs, knowledge_graph.rs, typed_memory.rs, self_upgrade.rs, capability_probe.rs, action_tags.rs, verify-chat-rgba.sh, verify-empty-state-coverage.sh, verify-phase5-rust-surface.sh, package.json, STATE.md) + 16-RESEARCH.md + 16-VALIDATION.md
**Pattern extraction date:** 2026-04-29
