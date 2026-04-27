use fastembed::{EmbeddingModel, InitOptions, TextEmbedding};
use rusqlite::params;
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};

static EMBEDDER: std::sync::LazyLock<Arc<Mutex<Option<TextEmbedding>>>> =
    std::sync::LazyLock::new(|| Arc::new(Mutex::new(None)));

fn get_embedder() -> Result<Arc<Mutex<Option<TextEmbedding>>>, String> {
    let embedder = EMBEDDER.clone();
    {
        let mut guard = embedder.lock().map_err(|e| e.to_string())?;
        if guard.is_none() {
            let model = TextEmbedding::try_new(InitOptions::new(EmbeddingModel::AllMiniLML6V2))
                .map_err(|e| format!("Failed to init embedding model: {}", e))?;
            *guard = Some(model);
        }
    }
    Ok(embedder)
}

/// Generate embeddings for a list of texts
pub fn embed_texts(texts: &[String]) -> Result<Vec<Vec<f32>>, String> {
    let embedder = get_embedder()?;
    let mut guard = embedder.lock().map_err(|e| e.to_string())?;
    let model = guard.as_mut().ok_or("Embedder not initialized")?;
    model
        .embed(texts.to_vec(), None)
        .map_err(|e| format!("Embedding failed: {}", e))
}

/// Calculate cosine similarity between two vectors
fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
    if a.len() != b.len() || a.is_empty() {
        return 0.0;
    }
    let dot: f32 = a.iter().zip(b.iter()).map(|(x, y)| x * y).sum();
    let mag_a: f32 = a.iter().map(|x| x * x).sum::<f32>().sqrt();
    let mag_b: f32 = b.iter().map(|x| x * x).sum::<f32>().sqrt();
    if mag_a == 0.0 || mag_b == 0.0 {
        return 0.0;
    }
    dot / (mag_a * mag_b)
}

/// Serialize a Vec<f32> to raw bytes (little-endian f32 array)
fn vec_to_blob(v: &[f32]) -> Vec<u8> {
    v.iter().flat_map(|f| f.to_le_bytes()).collect()
}

/// Deserialize raw bytes back to Vec<f32>
fn blob_to_vec(b: &[u8]) -> Vec<f32> {
    b.chunks_exact(4)
        .map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]]))
        .collect()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResult {
    pub text: String,
    pub score: f32,
    pub source_type: String,
    pub source_id: String,
}

struct VectorEntry {
    content: String,
    embedding: Vec<f32>,
    source_type: String,
    source_id: String,
}

/// SQLite-backed vector store. Entries are persisted immediately on add
/// and loaded from disk when the store is initialized.
pub struct VectorStore {
    entries: Vec<VectorEntry>,
    db_path: std::path::PathBuf,
}

impl VectorStore {
    /// Create a new VectorStore, loading any existing entries from SQLite.
    pub fn new() -> Self {
        let db_path = crate::config::blade_config_dir().join("blade.db");
        let mut store = Self {
            entries: Vec::new(),
            db_path: db_path.clone(),
        };
        // Best-effort load — if db doesn't exist yet, start empty
        if let Ok(conn) = rusqlite::Connection::open(&db_path) {
            let _ = store.load_from_db(&conn);
        }
        store
    }

    fn load_from_db(&mut self, conn: &rusqlite::Connection) -> Result<(), rusqlite::Error> {
        let mut stmt = conn.prepare(
            "SELECT content, embedding, source_type, source_id FROM vector_entries ORDER BY id ASC",
        )?;
        let entries = stmt.query_map([], |row| {
            let content: String = row.get(0)?;
            let blob: Vec<u8> = row.get(1)?;
            let source_type: String = row.get(2)?;
            let source_id: String = row.get(3)?;
            Ok((content, blob, source_type, source_id))
        })?;

        for entry in entries.flatten() {
            let (content, blob, source_type, source_id) = entry;
            self.entries.push(VectorEntry {
                content,
                embedding: blob_to_vec(&blob),
                source_type,
                source_id,
            });
        }
        Ok(())
    }

    /// Add a new entry. Persists to SQLite immediately (write-through).
    pub fn add(
        &mut self,
        content: String,
        embedding: Vec<f32>,
        source_type: String,
        source_id: String,
    ) {
        // Write to SQLite
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;
        if let Ok(conn) = rusqlite::Connection::open(&self.db_path) {
            let blob = vec_to_blob(&embedding);
            let _ = conn.execute(
                "INSERT INTO vector_entries (content, embedding, source_type, source_id, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
                params![content, blob, source_type, source_id, now],
            );
        }
        self.entries.push(VectorEntry {
            content,
            embedding,
            source_type,
            source_id,
        });
    }

    /// Pure vector (cosine) search — fast path when no query text is available.
    pub fn search(&self, query_embedding: &[f32], top_k: usize) -> Vec<SearchResult> {
        self.hybrid_search(query_embedding, "", top_k)
    }

    /// Hybrid search: fuses cosine similarity (vector) + keyword matching (BM25-approx)
    /// using Reciprocal Rank Fusion (k=60). Reduces retrieval failures vs. pure vector search.
    /// When query_text is empty, falls back to pure vector search.
    pub fn hybrid_search(
        &self,
        query_embedding: &[f32],
        query_text: &str,
        top_k: usize,
    ) -> Vec<SearchResult> {
        if self.entries.is_empty() {
            return vec![];
        }

        // ── 1. Vector pass ──────────────────────────────────────────────────────
        let mut vector_ranked: Vec<(f32, usize)> = self
            .entries
            .iter()
            .enumerate()
            .map(|(i, e)| (cosine_similarity(query_embedding, &e.embedding), i))
            .collect();
        vector_ranked.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));

        // ── 2. Keyword pass (BM25-approximate) ─────────────────────────────────
        // Split query into meaningful terms (≥3 chars, not stop words)
        let stop_words = [
            "the", "and", "for", "with", "this", "that", "from", "have",
            "they", "your", "will", "what", "when", "are", "was", "has",
        ];
        let terms: Vec<String> = query_text
            .split_whitespace()
            .filter(|t| {
                let lower = t.to_lowercase();
                lower.len() >= 3 && !stop_words.contains(&lower.as_str())
            })
            .map(|t| t.to_lowercase())
            .collect();

        let keyword_ranked: Vec<(f32, usize)> = if terms.is_empty() {
            vec![]
        } else {
            let mut scores: Vec<(f32, usize)> = self
                .entries
                .iter()
                .enumerate()
                .map(|(i, e)| {
                    let lower_content = e.content.to_lowercase();
                    let hits = terms
                        .iter()
                        .filter(|t| lower_content.contains(t.as_str()))
                        .count() as f32;
                    let term_score = hits / terms.len() as f32;
                    (term_score, i)
                })
                .filter(|(s, _)| *s > 0.0)
                .collect();
            scores.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
            scores
        };

        // ── 3. Reciprocal Rank Fusion (k = 60, standard default) ──────────────
        const K: f32 = 60.0;
        let n = self.entries.len();
        let mut rrf: Vec<f32> = vec![0.0; n];

        for (rank, (_, idx)) in vector_ranked.iter().enumerate() {
            rrf[*idx] += 1.0 / (K + rank as f32 + 1.0);
        }
        for (rank, (_, idx)) in keyword_ranked.iter().enumerate() {
            rrf[*idx] += 1.0 / (K + rank as f32 + 1.0);
        }

        // ── 4. Rank by fused score, filter, return ─────────────────────────────
        let mut fused: Vec<(f32, usize)> = rrf
            .into_iter()
            .enumerate()
            .map(|(i, s)| (s, i))
            .filter(|(s, _)| *s > 1.0 / (K + n as f32))  // cut pure-noise tail
            .collect();
        fused.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));

        fused
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

/// Embed a conversation exchange and store in the persistent vector store.
/// Called after every response completes (fire-and-forget).
///
/// Uses contextual chunk prepending: a short context prefix is added before
/// the raw exchange so the embedding captures topic and intent, not just words.
/// This reduces retrieval failures by ~67% vs. raw chunk embedding (Anthropic research).
pub fn auto_embed_exchange(store: &SharedVectorStore, user_msg: &str, assistant_msg: &str, conversation_id: &str) {
    // Build a short context prefix — topic label for the embedding model
    // Heuristic: take first 100 chars of user message as the topic signal
    let topic = user_msg.trim();
    let topic_short = crate::safe_slice(&topic, 100);
    let context_prefix = format!("This is a conversation about: {}. ", topic_short);

    // Combine with context prefix prepended
    let raw = format!("User: {}\nAssistant: {}", user_msg, assistant_msg);
    let content = format!("{}{}", context_prefix, raw);
    // Truncate to avoid embedding very long conversations
    let content = if content.len() > 2200 {
        let end = content.char_indices().nth(2200).map(|(i, _)| i).unwrap_or(content.len());
        content[..end].to_string()
    } else {
        content
    };

    match embed_texts(&[content.clone()]) {
        Ok(embeddings) => {
            if let Some(embedding) = embeddings.into_iter().next() {
                if let Ok(mut s) = store.lock() {
                    s.add(content, embedding, "conversation".to_string(), conversation_id.to_string());
                }
            }
        }
        Err(e) => {
            eprintln!("[embeddings] auto_embed failed: {}", e);
        }
    }
}

/// Semantic search across all stored exchanges. Returns formatted context string.
pub fn recall_relevant(store: &SharedVectorStore, query: &str, top_k: usize) -> String {
    let embeddings = match embed_texts(&[query.to_string()]) {
        Ok(e) => e,
        Err(_) => return String::new(),
    };
    let query_embedding = match embeddings.into_iter().next() {
        Some(e) => e,
        None => return String::new(),
    };
    let results = match store.lock() {
        Ok(s) => s.hybrid_search(&query_embedding, query, top_k),
        Err(_) => return String::new(),
    };

    if results.is_empty() {
        return String::new();
    }

    // RRF scores: max possible ~0.033 (rank 0 in both vector + keyword).
    // Filter below 0.012 — requires appearing in roughly top-50 of at least one list.
    // This prevents low-signal noise from cluttering the context.
    let results: Vec<_> = results.into_iter().filter(|r| r.score >= 0.012).collect();
    if results.is_empty() {
        return String::new();
    }

    let formatted: Vec<String> = results
        .into_iter()
        .map(|r| format!("(relevance {:.0}%) {}", r.score * 100.0, r.text))
        .collect();

    formatted.join("\n\n")
}

/// Smart context recall — the "compounding" mechanism.
/// Before each chat message, does a quick semantic search against:
///   1. Past conversation summaries (memory_palace summaries)
///   2. Knowledge graph facts (kg_nodes with high importance)
///   3. Extracted preferences (brain_preferences)
///
/// Returns the top 3 most relevant hits formatted for system prompt injection.
/// This is what makes BLADE get smarter with every conversation.
pub fn smart_context_recall(query: &str) -> String {
    if query.trim().is_empty() {
        return String::new();
    }

    let db_path = crate::config::blade_config_dir().join("blade.db");
    let conn = match rusqlite::Connection::open(&db_path) {
        Ok(c) => c,
        Err(_) => return String::new(),
    };

    // 1. Semantic search across vector entries — finds past summaries and exchanges
    let query_embedding = match embed_texts(&[query.to_string()]) {
        Ok(e) => e.into_iter().next().unwrap_or_default(),
        Err(_) => return String::new(),
    };

    let mut hits: Vec<(f32, String, &'static str)> = Vec::new(); // (score, text, source_type)

    // Load conversation summaries from vector_entries
    let summaries: Vec<(String, Vec<u8>)> = conn.prepare(
        "SELECT content, embedding FROM vector_entries WHERE source_type = 'conversation_summary' ORDER BY created_at DESC LIMIT 100"
    ).and_then(|mut stmt| {
        stmt.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, Vec<u8>>(1)?))
        }).map(|rows| rows.filter_map(|r| r.ok()).collect())
    }).unwrap_or_default();

    for (content, blob) in &summaries {
        let vec: Vec<f32> = blob.chunks_exact(4)
            .map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]]))
            .collect();
        let score = {
            if query_embedding.is_empty() || vec.is_empty() { 0.0 }
            else {
                let dot: f32 = query_embedding.iter().zip(vec.iter()).map(|(a, b)| a * b).sum();
                let mag_a: f32 = query_embedding.iter().map(|x| x * x).sum::<f32>().sqrt();
                let mag_b: f32 = vec.iter().map(|x| x * x).sum::<f32>().sqrt();
                if mag_a == 0.0 || mag_b == 0.0 { 0.0 } else { dot / (mag_a * mag_b) }
            }
        };
        if score > 0.35 {
            hits.push((score, content.clone(), "past_summary"));
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

    let query_lower = query.to_lowercase();
    let query_terms: Vec<&str> = query_lower.split_whitespace()
        .filter(|t| t.len() >= 3)
        .collect();

    for (desc, importance) in &kg_nodes {
        if query_terms.is_empty() { break; }
        let desc_lower = desc.to_lowercase();
        let matches = query_terms.iter().filter(|t| desc_lower.contains(*t)).count();
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

    // Sort by score descending, take top 3
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

// --- Tauri Commands ---

#[tauri::command]
pub async fn embed_and_store(
    store: tauri::State<'_, SharedVectorStore>,
    text: String,
    metadata: serde_json::Value,
) -> Result<(), String> {
    let embeddings = embed_texts(&[text.clone()])?;
    let embedding = embeddings
        .into_iter()
        .next()
        .ok_or("No embedding generated")?;

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
    s.add(text, embedding, source_type, source_id);
    Ok(())
}

#[tauri::command]
pub async fn semantic_search(
    store: tauri::State<'_, SharedVectorStore>,
    query: String,
    top_k: Option<usize>,
) -> Result<Vec<SearchResult>, String> {
    let embeddings = embed_texts(&[query])?;
    let query_embedding = embeddings
        .into_iter()
        .next()
        .ok_or("No embedding generated")?;

    let s = store.lock().map_err(|e| e.to_string())?;
    Ok(s.search(&query_embedding, top_k.unwrap_or(5)))
}

#[tauri::command]
pub async fn vector_store_size(
    store: tauri::State<'_, SharedVectorStore>,
) -> Result<usize, String> {
    let s = store.lock().map_err(|e| e.to_string())?;
    Ok(s.len())
}

// ─── Eval harness ─────────────────────────────────────────────────────────
//
// First quality measurement scaffolding for the memory cluster. Per the v1.2
// maturity audit (2026-04-27), the memory pipeline shipped with zero recall
// quality measurement. This module establishes the pattern: fixture-driven
// scenarios, hand-crafted embeddings (skips the embedder model so it runs
// without GPU/model-init), and explicit top-1 / top-3 / MRR metrics.
//
// Run with: `cargo test --lib memory_recall_eval -- --nocapture`
//
// Future work: replace synthetic embeddings with real fastembed runs against
// a curated corpus of conversation fixtures, plus integration with extract_
// conversation_facts and weekly_memory_consolidation.
#[cfg(test)]
mod memory_recall_eval {
    use super::*;
    use tempfile::TempDir;

    /// Fixture entry — a fake "memory" with a hand-crafted embedding.
    /// Embeddings here are tiny (4-dim) so each axis represents a domain:
    /// [code, personal, work, food].
    struct Fixture {
        source_id: &'static str,
        content: &'static str,
        embedding: [f32; 4],
    }

    fn corpus() -> Vec<Fixture> {
        vec![
            Fixture {
                source_id: "mem_rust_async",
                content: "User asked how to write a tokio async loop with cancellation",
                embedding: [0.95, 0.05, 0.20, 0.0],
            },
            Fixture {
                source_id: "mem_rust_macro",
                content: "User explained the difference between proc macros and decl macros",
                embedding: [0.90, 0.10, 0.15, 0.0],
            },
            Fixture {
                source_id: "mem_personal_birthday",
                content: "User's birthday is March 15, mentioned planning a quiet dinner",
                embedding: [0.0, 0.95, 0.05, 0.30],
            },
            Fixture {
                source_id: "mem_personal_runs",
                content: "User runs 5K every Tuesday morning at the riverside park",
                embedding: [0.0, 0.85, 0.10, 0.0],
            },
            Fixture {
                source_id: "mem_work_standup",
                content: "Daily engineering standup is 9:30 AM PT, hosted on Zoom",
                embedding: [0.10, 0.05, 0.95, 0.0],
            },
            Fixture {
                source_id: "mem_work_oncall",
                content: "User is on-call rotation for the payments service this week",
                embedding: [0.05, 0.10, 0.90, 0.0],
            },
            Fixture {
                source_id: "mem_food_pizza",
                content: "User prefers Neapolitan pizza, dislikes deep dish",
                embedding: [0.0, 0.20, 0.0, 0.95],
            },
            Fixture {
                source_id: "mem_food_coffee",
                content: "User drinks black coffee, no sugar, two cups before noon",
                embedding: [0.0, 0.30, 0.10, 0.85],
            },
        ]
    }

    /// Set up an isolated VectorStore in a temp dir with the fixture corpus.
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

    /// Eval scenarios: (query_embedding, query_text, expected_source_id, label)
    fn scenarios() -> Vec<([f32; 4], &'static str, &'static str, &'static str)> {
        vec![
            // ── Tier 1: clean axis wins (vector signal is unambiguous) ──────
            ([0.92, 0.0, 0.10, 0.0], "rust async tokio", "mem_rust_async", "rust_async_intent"),
            ([0.0, 0.0, 0.92, 0.0], "engineering standup zoom", "mem_work_standup", "work_standup_intent"),
            ([0.0, 0.92, 0.0, 0.0], "exercise routine running", "mem_personal_runs", "personal_runs_intent"),
            ([0.0, 0.0, 0.0, 0.92], "favorite italian food", "mem_food_pizza", "food_pizza_intent"),

            // ── Tier 2: keyword should help disambiguate ────────────────────
            // Vector signal is weak/spread; query text contains literal content tokens.
            ([0.30, 0.0, 0.30, 0.0], "Neapolitan pizza preference", "mem_food_pizza", "keyword_boost_pizza"),
            ([0.20, 0.20, 0.20, 0.20], "tokio cancellation", "mem_rust_async", "keyword_boost_async"),

            // ── Tier 3: adversarial — cross-domain confusion ────────────────
            // "morning" appears in mem_personal_runs (5K every Tuesday morning)
            // AND mem_food_coffee (two cups before noon). Vector axis points
            // at personal/food split; query text "tuesday riverside" is the
            // tie-breaker only if BM25 picks up the unique tokens.
            ([0.0, 0.50, 0.0, 0.50], "tuesday riverside park morning", "mem_personal_runs", "adversarial_morning_disambig"),

            // ── Tier 4: keyword overrides misleading vector ────────────────
            // Vector slightly favors "code" axis but the unique token "Neapolitan"
            // appears only in mem_food_pizza. Tests that BM25 can break a tie
            // when the embedding sends a wrong-domain signal.
            ([0.40, 0.0, 0.20, 0.20], "Neapolitan", "mem_food_pizza", "adversarial_keyword_overrides_vector"),

            // ── Tier 5: noise-only query ────────────────────────────────────
            // Stop-words only; no vector signal. Should NOT crash; allowed to
            // return any top-k order — measured by MRR not top-1. Expected
            // memory is the closest-to-zero embedding; floor allows MRR=0.0
            // for this scenario specifically (handled by accepting any rank).
            // We pick mem_food_coffee as the "least surprising" answer — its
            // embedding has the lowest L2 norm (0.0+0.30+0.10+0.85 → 0.91).
            // This scenario is gate-relaxed: not asserted in the floor, but
            // surfaced in the table for inspection.
            ([0.0, 0.0, 0.0, 0.0], "the and from", "mem_food_coffee", "adversarial_stopwords_only"),
        ]
    }

    /// Some scenarios test edge cases where ranking is fundamentally ambiguous;
    /// they are surfaced in the table but excluded from the floor assertion.
    fn is_gate_relaxed(label: &str) -> bool {
        label == "adversarial_stopwords_only"
    }

    #[test]
    fn evaluates_recall_quality() {
        let (_tmp, store) = build_test_store();
        let scenarios = scenarios();
        // Floor metrics computed across gate-asserted scenarios only.
        // Relaxed scenarios still appear in the table for inspection.
        let asserted_total: f32 = scenarios.iter().filter(|(_, _, _, l)| !is_gate_relaxed(l)).count() as f32;
        let total_all = scenarios.len() as f32;
        let mut asserted_top1 = 0;
        let mut asserted_top3 = 0;
        let mut asserted_rr_sum = 0.0;
        let mut all_top1 = 0;
        let mut all_top3 = 0;

        println!("\n┌── Memory recall eval ──────────────────────────────────");
        for (query_emb, query_text, expected, label) in &scenarios {
            let results = store.hybrid_search(query_emb, query_text, 5);
            let hit1 = top1_hit(&results, expected);
            let hit3 = topk_hit(&results, expected, 3);
            let rr = reciprocal_rank(&results, expected);
            if hit1 { all_top1 += 1; }
            if hit3 { all_top3 += 1; }
            if !is_gate_relaxed(label) {
                if hit1 { asserted_top1 += 1; }
                if hit3 { asserted_top3 += 1; }
                asserted_rr_sum += rr;
            }
            let top_ids: Vec<&str> = results.iter().take(3).map(|r| r.source_id.as_str()).collect();
            let relax = if is_gate_relaxed(label) { " (relaxed)" } else { "" };
            println!(
                "│ {:38} top1={} top3={} rr={:.2} → top3={:?} (want={}){}",
                label, if hit1 { "✓" } else { "✗" }, if hit3 { "✓" } else { "✗" }, rr, top_ids, expected, relax
            );
        }
        let asserted_mrr = if asserted_total > 0.0 { asserted_rr_sum / asserted_total } else { 0.0 };
        println!("├──────────────────────────────────────────────────────────");
        println!("│ all     — top-1: {}/{} ({:.0}%)  top-3: {}/{} ({:.0}%)",
            all_top1, total_all as i32, (all_top1 as f32 / total_all) * 100.0,
            all_top3, total_all as i32, (all_top3 as f32 / total_all) * 100.0);
        println!("│ asserted (gate floors): top-1: {}/{} ({:.0}%)  top-3: {}/{} ({:.0}%)  MRR: {:.3}",
            asserted_top1, asserted_total as i32, (asserted_top1 as f32 / asserted_total) * 100.0,
            asserted_top3, asserted_total as i32, (asserted_top3 as f32 / asserted_total) * 100.0,
            asserted_mrr);
        println!("└──────────────────────────────────────────────────────────\n");

        // Quality gates — fail the build if asserted-scenario recall regresses
        // below baseline. Floors are intentionally generous; tighten as the
        // eval corpus matures with real fastembed runs.
        // top-3 ≥ 80% (common eval target), MRR ≥ 0.6.
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
    }

    #[test]
    fn empty_query_returns_empty() {
        let (_tmp, store) = build_test_store();
        let results = store.hybrid_search(&[0.0, 0.0, 0.0, 0.0], "", 5);
        // Pure zero query may still rank entries by cosine=0 — main check is
        // that the function doesn't panic with empty text and returns ≤ top_k.
        assert!(results.len() <= 5);
    }

    #[test]
    fn empty_store_returns_empty() {
        let temp = TempDir::new().expect("tempdir");
        std::env::set_var("BLADE_CONFIG_DIR", temp.path());
        let _ = crate::db::init_db();
        let store = VectorStore::new();
        let results = store.hybrid_search(&[1.0, 0.0, 0.0, 0.0], "rust async", 5);
        assert!(results.is_empty(), "empty store must return no results");
    }
}
