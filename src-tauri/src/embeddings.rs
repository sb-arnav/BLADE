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

    pub fn search(&self, query_embedding: &[f32], top_k: usize) -> Vec<SearchResult> {
        let mut scored: Vec<(f32, usize)> = self
            .entries
            .iter()
            .enumerate()
            .map(|(i, e)| (cosine_similarity(query_embedding, &e.embedding), i))
            .collect();

        scored.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));

        scored
            .into_iter()
            .take(top_k)
            .filter(|(score, _)| *score > 0.3) // skip low-relevance results
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
pub fn auto_embed_exchange(store: &SharedVectorStore, user_msg: &str, assistant_msg: &str, conversation_id: &str) {
    // Combine both sides into a single searchable chunk
    let content = format!("User: {}\nAssistant: {}", user_msg, assistant_msg);
    // Truncate to avoid embedding very long conversations
    let content = if content.len() > 2000 {
        content[..2000].to_string()
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
        Ok(s) => s.search(&query_embedding, top_k),
        Err(_) => return String::new(),
    };

    if results.is_empty() {
        return String::new();
    }

    let formatted: Vec<String> = results
        .into_iter()
        .map(|r| format!("(relevance {:.0}%) {}", r.score * 100.0, r.text))
        .collect();

    formatted.join("\n\n")
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
