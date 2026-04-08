use fastembed::{EmbeddingModel, InitOptions, TextEmbedding};
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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResult {
    pub text: String,
    pub score: f32,
    pub metadata: serde_json::Value,
}

/// Simple in-memory vector store (persisted to SQLite via db.rs)
pub struct VectorStore {
    entries: Vec<VectorEntry>,
}

struct VectorEntry {
    text: String,
    embedding: Vec<f32>,
    metadata: serde_json::Value,
}

impl VectorStore {
    pub fn new() -> Self {
        Self {
            entries: Vec::new(),
        }
    }

    pub fn add(&mut self, text: String, embedding: Vec<f32>, metadata: serde_json::Value) {
        self.entries.push(VectorEntry {
            text,
            embedding,
            metadata,
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
            .map(|(score, idx)| {
                let entry = &self.entries[idx];
                SearchResult {
                    text: entry.text.clone(),
                    score,
                    metadata: entry.metadata.clone(),
                }
            })
            .collect()
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }
}

pub type SharedVectorStore = Arc<Mutex<VectorStore>>;

// --- Tauri Commands ---

#[tauri::command]
pub async fn embed_and_store(
    store: tauri::State<'_, SharedVectorStore>,
    text: String,
    metadata: serde_json::Value,
) -> Result<(), String> {
    let embeddings = embed_texts(&[text.clone()])?;
    let embedding = embeddings.into_iter().next().ok_or("No embedding generated")?;

    let mut s = store.lock().map_err(|e| e.to_string())?;
    s.add(text, embedding, metadata);
    Ok(())
}

#[tauri::command]
pub async fn semantic_search(
    store: tauri::State<'_, SharedVectorStore>,
    query: String,
    top_k: Option<usize>,
) -> Result<Vec<SearchResult>, String> {
    let embeddings = embed_texts(&[query])?;
    let query_embedding = embeddings.into_iter().next().ok_or("No embedding generated")?;

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
