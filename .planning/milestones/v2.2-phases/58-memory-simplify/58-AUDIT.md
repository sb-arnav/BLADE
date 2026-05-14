# Phase 58 — MEMORY-SIMPLIFY — EMBED-AUDIT

**Date:** 2026-05-14
**Scope:** Catalog every caller of `embeddings.rs` and decide BM25 vs KG replacement
before pulling the vector layer.

---

## TL;DR

The vector layer touches **18 source files**. None of them genuinely need vector
retrieval at BLADE's personal scale (~100k facts × 7 typed categories × 1M-context
models). Every caller falls into one of three buckets:

| Bucket | Replacement | Caller count |
|---|---|---|
| A. **Stores embeddings into VectorStore** | Drop the embed call, store text only | 7 |
| B. **Queries VectorStore via `hybrid_search`** | Strip embedding generation, BM25 on `query_text` only | 6 |
| C. **Top-level recall (`smart_context_recall`, `recall_relevant`)** | BM25 over `vector_entries.content` + KG match on `query` | 3 |
| D. **Eval modules** | Adapt fixtures: drop hand-picked 4-dim embeddings + drop real-fastembed model invocation | 2 |
| Misc | Internal cosine helper duplicates (skills/lifecycle.rs) — unchanged | 1 |

No caller needs a true vector-similarity semantic match that BM25 cannot serve at
personal scale. Three callers (godmode auto-embed, brain auto-embed, loop_engine
auto-embed) feed conversation snippets in for later recall — keep the *storage*
path (text in `vector_entries.content`) but stop generating embeddings.

---

## Bucket A — Storage callers (embed text → push to VectorStore)

These call `embed_texts` then `store.add(content, embedding, source_type, source_id)`.
Replacement: drop the `embed_texts` call, push `content + zero-len embedding`
(or wider refactor: drop the `embedding` parameter). For minimal call-site churn
we keep the `VectorStore::add(content, embedding, ...)` signature but ignore the
`embedding` argument. `embed_texts` becomes a no-op returning empty vectors.

| File | Use | Replacement |
|---|---|---|
| `src/embeddings.rs::auto_embed_exchange` | Embed user/assistant turn into store | Drop embed; push text directly |
| `src/screen_timeline.rs::embed_timeline_entry` | Embed screenshot description | Drop embed; push text directly |
| `src/audio_timeline.rs::embed_audio_entry` | Embed audio transcript | Drop embed; push text directly |
| `src/godmode.rs` (line 248) | Embed Godmode brief into VectorStore | Drop embed; push text directly |
| `src/memory_palace.rs` (line 748) | Embed conversation summary | Drop embed; push text directly (use `INSERT … VALUES (text, '')`) |
| `src/loop_engine.rs::run_loop_inner` (line 2190) | Auto-embed each tool-loop turn | Drop embed; push text directly |
| `src/rag.rs::rag_ingest_file/directory` + `rag_query` | Document RAG path | Drop embed; rely on BM25 over chunks |

## Bucket B — Search callers (embed query → `store.hybrid_search`)

These call `embed_texts(&[query])` then `store.hybrid_search(embedding, text, k)`.
Replacement: skip embed step, `hybrid_search` ignores the embedding param and
runs BM25 against `query_text` only. Caller code unchanged besides the dead
`embed_texts` call.

| File | Use |
|---|---|
| `src/embeddings.rs::recall_relevant` | Query embed + hybrid_search (now BM25-only) |
| `src/embeddings.rs::semantic_search` (Tauri cmd) | Same |
| `src/screen_timeline.rs::timeline_search` | Same; filters by `source_type == "screen_timeline"` |
| `src/audio_timeline.rs::search_everything` + `audio_timeline_search` | Same |
| `src/rag.rs::rag_query` | Same |

## Bucket C — Top-level recall

| File | Use | Replacement |
|---|---|---|
| `src/embeddings.rs::smart_context_recall` | Cross-source recall: vector_entries summaries + KG nodes + brain_preferences | Direct SQL keyword/LIKE against `vector_entries.content WHERE source_type='conversation_summary'`; KG path is already BM25-style (token match × importance) so unchanged; brain_preferences path unchanged. |
| `src/brain.rs::build_system_prompt_inner` | Calls `recall_relevant` + `smart_context_recall` | No change at call site — both upstream functions still return formatted strings, just BM25-backed now. |
| `src/intelligence/anchor_parser.rs` | Calls `smart_context_recall(topic)` | No change |
| `src/tentacles/email_deep.rs` | Calls `smart_context_recall(query)` | No change |

## Bucket D — Eval modules

| File | Use | Replacement |
|---|---|---|
| `src/evals/hybrid_search_eval.rs` | Hand-picked 4-dim embeddings + scripted scenarios | Adapt to BM25-only assertions; keyword path still produces signal; vector axes become unused metadata for fixture readability |
| `src/evals/real_embedding_eval.rs` | Real fastembed model + cosine | Becomes obsolete with vector removal. Mark `#[ignore]` (preserves source for v2.3 if needed) and document the deprecation in the SUMMARY. |
| `src/evals/harness.rs` | Uses `crate::embeddings::SearchResult` | No change — `SearchResult` survives |
| `src/evals/intelligence_eval.rs` | Mentions `SharedVectorStore` in doc comments only | No code change |

## Misc

- `src/skills/lifecycle.rs::cosine_sim` — module-local helper, comment references
  `embeddings::cosine_similarity` which is private. Unchanged.

---

## Replacement design

### `embeddings.rs` public surface after refactor

```rust
pub struct SearchResult { text, score, source_type, source_id }
pub struct VectorStore { entries: Vec<Entry>, db_path }
pub type SharedVectorStore = Arc<Mutex<VectorStore>>;

impl VectorStore {
    pub fn new() -> Self { ... }                       // loads content (ignores embedding blob)
    pub fn add(&mut self, content, _embedding, st, sid); // ignores embedding param
    pub fn search(&self, _q_embed: &[f32], top_k) -> ...;  // delegates to bm25
    pub fn hybrid_search(&self, _q_embed, q_text, top_k);  // BM25 only
    pub fn len(&self) -> usize;
}

pub fn embed_texts(texts: &[String]) -> Result<Vec<Vec<f32>>, String>;
    // returns Vec of empty Vec<f32> with same length as input — deprecated;
    // existing callers continue to type-check but contribute no signal.

pub fn auto_embed_exchange(...);   // stores raw text, no embed
pub fn recall_relevant(...);        // BM25 over store.entries
pub fn smart_context_recall(...);   // BM25 over vector_entries + KG match + prefs
pub fn embed_and_store(...);        // Tauri cmd — stores raw text
pub fn semantic_search(...);        // Tauri cmd — BM25 only
pub fn vector_store_size(...);      // Tauri cmd — unchanged
```

This keeps every caller working without surgery and lets future v2.3 work
fully delete `embed_texts` + the embedding parameter from `add()` once we are
confident no out-of-tree caller is wired in.

### SQL migration

`vector_entries` table on disk has an `embedding BLOB NOT NULL` column. We
leave the table in place (existing users keep their data; the `content`
column is what BM25 reads). For new installs the column is still created
(empty blobs are fine). Migration file `src-tauri/migrations/202605_drop_vector_indexes.sql`
ships an *optional* deprecation comment + safe-multi-run no-op SQL — the
real table cleanup is deferred to v2.3 once we are sure nothing reads the
column.

### Dependency cleanup

`fastembed = "5"` in `src-tauri/Cargo.toml:51` is the only dep that exists
solely for the embedding pipeline. Removed in EMBED-DEPS commit.

---

## Carry-forward / "v2.3 verify these" items

- `recall_relevant` and `smart_context_recall` lose their semantic-paraphrase
  matching capability. At personal scale with typed memory + KG this is
  not expected to matter; if real users hit specific recall failures we add
  a TODO marker. Add `// TODO(v2.3): verify recall fidelity after BM25-only`
  comment at both call sites.
- `rag.rs::rag_query` was the closest to a "genuinely needs vectors" caller
  — it operates on user-imported documents (could be arbitrary size, no typed
  category structure). At personal-doc scale BM25 still serves; left as a
  TODO if operator dogfood surfaces gaps.
- `evals/real_embedding_eval.rs` regression — its 7/7 top-1 + MRR 1.000 was
  the only quality signal on the real-embed path. After removal there is no
  quality measurement on memory recall. v2.3 should re-instate a BM25 + KG
  quality eval.

---

## Out of scope for this phase

- Deleting the `embedding BLOB` column from `vector_entries`. Existing user
  installs would need a destructive `ALTER TABLE` (SQLite doesn't drop
  columns < 3.35 without table rebuild). Deferred to v2.3.
- Deleting `evals/real_embedding_eval.rs` outright. Kept as `#[ignore]`'d
  source so v2.3 can re-enable if BM25 quality regresses on dogfood signal.
- Migrating `rag.rs` chunking to a different storage layout. The current
  chunk-stored-in-vector_entries path keeps working with BM25.
