//! Phase 58 / MEMORY-SIMPLIFY (v2.2 — 2026-05-14) —
//! Vector retrieval was removed in favor of BM25 + knowledge graph traversal.
//! Research substrate: PAI v5 ships zero embeddings at personal scale with
//! BM25 + KG and outperforms vector hybrid on recall fidelity; Zep's own
//! paper shows marginal vector gain at < 1M facts; BLADE's 7 typed memory
//! categories structure the retrieval space further; Claude Sonnet 4.6's
//! 1M context window further reduces retrieval-precision dependence.
//!
//! Public surface is preserved (`VectorStore`, `SharedVectorStore`,
//! `SearchResult`, `embed_texts`, `auto_embed_exchange`, `recall_relevant`,
//! `smart_context_recall`, `embed_and_store`, `semantic_search`,
//! `vector_store_size`) so the ~18 call sites across the codebase do not
//! need surgery. Behavior changes:
//!   - `embed_texts` returns an empty `Vec<f32>` per input (deprecation
//!     stub; was a fastembed `AllMiniLML6V2` call).
//!   - `VectorStore::add` ignores the `embedding: Vec<f32>` parameter
//!     (kept for caller compatibility; blob persisted as empty bytes).
//!   - `VectorStore::hybrid_search` is BM25-only; the `query_embedding`
//!     parameter is ignored.
//!   - `smart_context_recall` no longer cosine-scores summaries; it BM25-
//!     scores them against the query.
//!
//! v2.3 TODO: once dogfood signal confirms BM25 + KG matches recall fidelity,
//! drop `embed_texts` + the `embedding` parameter from `add` + the
//! `embedding BLOB` column from `vector_entries`.

use rusqlite::params;
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResult {
    pub text: String,
    pub score: f32,
    pub source_type: String,
    pub source_id: String,
}

struct VectorEntry {
    content: String,
    source_type: String,
    source_id: String,
}

/// SQLite-backed text store. Despite the name, the vector path was removed
/// in Phase 58; this is now a BM25-only inverted-search-friendly content
/// cache. The `VectorStore` / `SharedVectorStore` names are preserved so
/// callers across the codebase compile unchanged.
pub struct VectorStore {
    entries: Vec<VectorEntry>,
    db_path: std::path::PathBuf,
}

impl VectorStore {
    /// Create a new store, loading existing content rows from SQLite.
    /// Embedding blobs in `vector_entries.embedding` are ignored on read.
    pub fn new() -> Self {
        let db_path = crate::config::blade_config_dir().join("blade.db");
        let mut store = Self {
            entries: Vec::new(),
            db_path: db_path.clone(),
        };
        if let Ok(conn) = rusqlite::Connection::open(&db_path) {
            let _ = store.load_from_db(&conn);
        }
        store
    }

    fn load_from_db(&mut self, conn: &rusqlite::Connection) -> Result<(), rusqlite::Error> {
        // Note: embedding column is still selected from the legacy schema
        // so cursors stay stable on older DBs, but the value is dropped.
        let mut stmt = conn.prepare(
            "SELECT content, source_type, source_id FROM vector_entries ORDER BY id ASC",
        )?;
        let entries = stmt.query_map([], |row| {
            let content: String = row.get(0)?;
            let source_type: String = row.get(1)?;
            let source_id: String = row.get(2)?;
            Ok((content, source_type, source_id))
        })?;

        for entry in entries.flatten() {
            let (content, source_type, source_id) = entry;
            self.entries.push(VectorEntry {
                content,
                source_type,
                source_id,
            });
        }
        Ok(())
    }

    /// Add a new entry. The `_embedding` parameter is ignored in v2.2; the
    /// signature is preserved so the ~7 call sites across the codebase
    /// continue to type-check. Write-through to SQLite stores an empty
    /// blob in the legacy `embedding` column.
    pub fn add(
        &mut self,
        content: String,
        _embedding: Vec<f32>,
        source_type: String,
        source_id: String,
    ) {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;
        if let Ok(conn) = rusqlite::Connection::open(&self.db_path) {
            let empty_blob: Vec<u8> = Vec::new();
            let _ = conn.execute(
                "INSERT INTO vector_entries (content, embedding, source_type, source_id, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
                params![content, empty_blob, source_type, source_id, now],
            );
        }
        self.entries.push(VectorEntry {
            content,
            source_type,
            source_id,
        });
    }

    /// BM25-only search. Backward-compat shim — `_query_embedding` is
    /// ignored. The query *text* drives ranking via `bm25_rank` below.
    pub fn search(&self, _query_embedding: &[f32], top_k: usize) -> Vec<SearchResult> {
        self.hybrid_search(&[], "", top_k)
    }

    /// BM25-only search. The `_query_embedding` parameter is preserved so
    /// callers compile unchanged but it is ignored. Ranking is now pure
    /// term-frequency-with-IDF-style scoring across the entry content.
    ///
    /// TODO(v2.3): verify recall fidelity vs. the prior RRF-fused path
    /// once dogfood signal accumulates.
    pub fn hybrid_search(
        &self,
        _query_embedding: &[f32],
        query_text: &str,
        top_k: usize,
    ) -> Vec<SearchResult> {
        if self.entries.is_empty() {
            return vec![];
        }

        let terms = tokenize_query(query_text);
        if terms.is_empty() {
            return vec![];
        }

        let mut scored: Vec<(f32, usize)> = self
            .entries
            .iter()
            .enumerate()
            .map(|(i, e)| (bm25_score(&terms, &e.content, self.entries.len(), &self.entries), i))
            .filter(|(s, _)| *s > 0.0)
            .collect();

        scored.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));

        scored
            .into_iter()
            .take(top_k)
            .map(|(score, idx)| {
                let entry = &self.entries[idx];
                SearchResult {
                    text: entry.content.clone(),
                    score,
                    source_type: entry.source_type.clone(),
                    source_id: entry.source_id.clone(),
                }
            })
            .collect()
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }
}

pub type SharedVectorStore = Arc<Mutex<VectorStore>>;

// ─── BM25 helpers ────────────────────────────────────────────────────────────
//
// Lightweight BM25-style scoring. Sufficient for ranking at personal scale;
// not a full BM25 implementation (no length normalization k1/b tuning). The
// term IDF is approximated by `ln((N - df + 0.5) / (df + 0.5))` over the
// pre-loaded entries snapshot.

fn tokenize_query(query: &str) -> Vec<String> {
    const STOP_WORDS: &[&str] = &[
        "the", "and", "for", "with", "this", "that", "from", "have",
        "they", "your", "will", "what", "when", "are", "was", "has",
        "you", "but", "not", "all", "can", "any", "had", "her", "his",
        "ist", "its", "may", "our", "out", "she", "use", "who", "how",
    ];
    query
        .split(|c: char| !c.is_alphanumeric())
        .filter(|t| !t.is_empty())
        .map(|t| t.to_lowercase())
        .filter(|t| t.len() >= 3 && !STOP_WORDS.contains(&t.as_str()))
        .collect()
}

fn bm25_score(terms: &[String], content: &str, total_docs: usize, all: &[VectorEntry]) -> f32 {
    if terms.is_empty() {
        return 0.0;
    }
    let content_lower = content.to_lowercase();
    let mut score = 0.0_f32;
    for term in terms {
        // term frequency in this doc
        let tf = content_lower.matches(term.as_str()).count() as f32;
        if tf == 0.0 {
            continue;
        }
        // doc frequency across all entries (snapshot; ok at personal scale)
        let df = all
            .iter()
            .filter(|e| e.content.to_lowercase().contains(term.as_str()))
            .count() as f32;
        let n = total_docs as f32;
        // BM25 IDF, clamped >= 0 so very-common terms don't hurt
        let idf = ((n - df + 0.5) / (df + 0.5) + 1.0).ln().max(0.0);
        // saturate tf to avoid overweighting long docs that mention term often
        let tf_sat = (tf * 2.0) / (tf + 1.5);
        score += idf * tf_sat;
    }
    score
}

// ─── Deprecation stub ────────────────────────────────────────────────────────

/// DEPRECATED in v2.2 (Phase 58). Returns an empty Vec<f32> per input.
/// Callers that still invoke this function continue to compile but their
/// returned embeddings carry no signal — downstream `VectorStore::add` /
/// `hybrid_search` already ignore the embedding parameter, so the
/// pipeline degrades gracefully to BM25-only.
///
/// Logged once on the first call so operators see the deprecation path.
///
/// TODO(v2.3): delete this function once all call sites are migrated.
pub fn embed_texts(texts: &[String]) -> Result<Vec<Vec<f32>>, String> {
    use std::sync::atomic::{AtomicBool, Ordering};
    static LOGGED: AtomicBool = AtomicBool::new(false);
    if !LOGGED.swap(true, Ordering::SeqCst) {
        log::info!(
            "[embeddings] vector retrieval deprecated in v2.2 (Phase 58) — BM25 + KG only"
        );
    }
    Ok(texts.iter().map(|_| Vec::new()).collect())
}

// ─── Storage path (used by auto-embed callers across the codebase) ───────────

/// Store a conversation exchange as text. Embedding generation removed;
/// content is stored in `vector_entries.content` for later BM25 recall.
pub fn auto_embed_exchange(store: &SharedVectorStore, user_msg: &str, assistant_msg: &str, conversation_id: &str) {
    let raw = format!("User: {}\nAssistant: {}", user_msg, assistant_msg);
    let content = if raw.len() > 2200 {
        let end = raw.char_indices().nth(2200).map(|(i, _)| i).unwrap_or(raw.len());
        raw[..end].to_string()
    } else {
        raw
    };

    if let Ok(mut s) = store.lock() {
        s.add(content, Vec::new(), "conversation".to_string(), conversation_id.to_string());
    }
}

// ─── Recall paths ────────────────────────────────────────────────────────────

/// BM25 recall across the VectorStore entries. Returns a formatted context
/// string for prompt injection.
///
/// TODO(v2.3): verify recall fidelity vs. the prior vector + BM25 RRF path.
pub fn recall_relevant(store: &SharedVectorStore, query: &str, top_k: usize) -> String {
    let results = match store.lock() {
        Ok(s) => s.hybrid_search(&[], query, top_k),
        Err(_) => return String::new(),
    };

    if results.is_empty() {
        return String::new();
    }

    // BM25 scores are unbounded above; normalise display via percent of top.
    let top_score = results.first().map(|r| r.score).unwrap_or(1.0).max(1e-6);
    let formatted: Vec<String> = results
        .into_iter()
        .map(|r| {
            let pct = ((r.score / top_score) * 100.0).round();
            format!("(relevance {:.0}%) {}", pct, r.text)
        })
        .collect();

    formatted.join("\n\n")
}

/// Smart context recall — the compounding mechanism.
/// Before each chat message, does a BM25 search against:
///   1. Past conversation summaries (vector_entries with source_type='conversation_summary')
///   2. Knowledge graph facts (kg_nodes with high importance)
///   3. Extracted preferences (brain_preferences)
///
/// Returns the top 3 most relevant hits formatted for system prompt injection.
///
/// TODO(v2.3): verify recall fidelity after BM25-only switch.
pub fn smart_context_recall(query: &str) -> String {
    if query.trim().is_empty() {
        return String::new();
    }

    let db_path = crate::config::blade_config_dir().join("blade.db");
    let conn = match rusqlite::Connection::open(&db_path) {
        Ok(c) => c,
        Err(_) => return String::new(),
    };

    let query_terms: Vec<String> = tokenize_query(query);

    let mut hits: Vec<(f32, String, &'static str)> = Vec::new();

    // 1. Conversation summaries — BM25 against stored text
    let summaries: Vec<String> = conn.prepare(
        "SELECT content FROM vector_entries WHERE source_type = 'conversation_summary' ORDER BY created_at DESC LIMIT 100"
    ).and_then(|mut stmt| {
        stmt.query_map([], |row| row.get::<_, String>(0))
            .map(|rows| rows.filter_map(|r| r.ok()).collect())
    }).unwrap_or_default();

    if !query_terms.is_empty() && !summaries.is_empty() {
        // Build temp entries for bm25_score reuse
        let temp_entries: Vec<VectorEntry> = summaries
            .iter()
            .map(|s| VectorEntry {
                content: s.clone(),
                source_type: "conversation_summary".to_string(),
                source_id: String::new(),
            })
            .collect();
        let n = temp_entries.len();
        for entry in &temp_entries {
            let s = bm25_score(&query_terms, &entry.content, n, &temp_entries);
            if s > 0.5 {
                hits.push((s, entry.content.clone(), "past_summary"));
            }
        }
    }

    // 2. KG facts — text match against high-importance nodes
    let kg_nodes: Vec<(String, f32)> = conn.prepare(
        "SELECT description, importance FROM kg_nodes WHERE importance >= 0.7 AND description != '' ORDER BY importance DESC LIMIT 30"
    ).and_then(|mut stmt| {
        stmt.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, f32>(1)?))
        }).map(|rows| rows.filter_map(|r| r.ok()).collect())
    }).unwrap_or_default();

    for (desc, importance) in &kg_nodes {
        if query_terms.is_empty() { break; }
        let desc_lower = desc.to_lowercase();
        let matches = query_terms.iter().filter(|t| desc_lower.contains(t.as_str())).count();
        if matches > 0 {
            let score = (matches as f32 / query_terms.len() as f32) * importance;
            if score > 0.2 {
                hits.push((score, format!("[fact] {}", desc), "kg_fact"));
            }
        }
    }

    // 3. Preferences — always relevant, light weight
    let prefs: Vec<(String, f64)> = conn.prepare(
        "SELECT text, confidence FROM brain_preferences WHERE confidence >= 0.75 ORDER BY confidence DESC LIMIT 10"
    ).and_then(|mut stmt| {
        stmt.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, f64>(1)?))
        }).map(|rows| rows.filter_map(|r| r.ok()).collect())
    }).unwrap_or_default();

    for (text, confidence) in &prefs {
        hits.push(((*confidence as f32) * 0.5, format!("[preference] {}", text), "preference"));
    }

    if hits.is_empty() {
        return String::new();
    }

    hits.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
    let top: Vec<String> = hits
        .into_iter()
        .take(3)
        .map(|(_, text, _)| text)
        .collect();

    if top.is_empty() {
        return String::new();
    }

    format!(
        "## Compounding Memory (relevant to this query)\n\n{}",
        top.join("\n\n")
    )
}

// ─── Tauri commands ──────────────────────────────────────────────────────────

#[tauri::command]
pub async fn embed_and_store(
    store: tauri::State<'_, SharedVectorStore>,
    text: String,
    metadata: serde_json::Value,
) -> Result<(), String> {
    let source_type = metadata
        .get("source_type")
        .and_then(|v| v.as_str())
        .unwrap_or("manual")
        .to_string();
    let source_id = metadata
        .get("source_id")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    let mut s = store.lock().map_err(|e| e.to_string())?;
    s.add(text, Vec::new(), source_type, source_id);
    Ok(())
}

#[tauri::command]
pub async fn semantic_search(
    store: tauri::State<'_, SharedVectorStore>,
    query: String,
    top_k: Option<usize>,
) -> Result<Vec<SearchResult>, String> {
    let s = store.lock().map_err(|e| e.to_string())?;
    Ok(s.hybrid_search(&[], &query, top_k.unwrap_or(5)))
}

#[tauri::command]
pub async fn vector_store_size(
    store: tauri::State<'_, SharedVectorStore>,
) -> Result<usize, String> {
    let s = store.lock().map_err(|e| e.to_string())?;
    Ok(s.len())
}
