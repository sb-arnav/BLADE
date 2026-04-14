use crate::embeddings::{self, SharedVectorStore};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

const CHUNK_SIZE: usize = 500; // chars per chunk
const CHUNK_OVERLAP: usize = 50;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IngestResult {
    pub file_path: String,
    pub chunks: usize,
    pub total_chars: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RagResult {
    pub answer_context: String,
    pub sources: Vec<RagSource>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RagSource {
    pub text: String,
    pub file: String,
    pub score: f32,
}

/// Ingest a file: read, chunk, embed, store
#[tauri::command]
pub async fn rag_ingest_file(
    store: tauri::State<'_, SharedVectorStore>,
    file_path: String,
) -> Result<IngestResult, String> {
    let path = Path::new(&file_path);
    if !path.exists() {
        return Err(format!("File not found: {}", file_path));
    }

    let content = fs::read_to_string(path).map_err(|e| format!("Read error: {}", e))?;

    let total_chars = content.len();
    let chunks = chunk_text(&content);
    let chunk_count = chunks.len();

    if chunks.is_empty() {
        return Ok(IngestResult {
            file_path,
            chunks: 0,
            total_chars,
        });
    }

    // Embed all chunks
    let chunk_strings: Vec<String> = chunks.iter().map(|c| c.text.clone()).collect();
    let embeddings_result = embeddings::embed_texts(&chunk_strings)?;

    // Store each chunk with metadata
    let mut s = store.lock().map_err(|e| e.to_string())?;
    for (chunk, embedding) in chunks.iter().zip(embeddings_result.into_iter()) {
        s.add(
            chunk.text.clone(),
            embedding,
            "document".to_string(),
            file_path.clone(),
        );
    }

    Ok(IngestResult {
        file_path,
        chunks: chunk_count,
        total_chars,
    })
}

/// Ingest a directory of files
#[tauri::command]
pub async fn rag_ingest_directory(
    store: tauri::State<'_, SharedVectorStore>,
    dir_path: String,
    extensions: Option<Vec<String>>,
) -> Result<Vec<IngestResult>, String> {
    let allowed_ext: Vec<String> = extensions.unwrap_or_else(|| {
        vec![
            "txt", "md", "rs", "py", "js", "ts", "tsx", "jsx", "go", "java", "c", "cpp", "h",
            "css", "html", "json", "yaml", "yml", "toml",
        ]
        .into_iter()
        .map(String::from)
        .collect()
    });

    let mut results = Vec::new();

    fn walk(dir: &Path, ext: &[String], files: &mut Vec<String>) {
        if let Ok(entries) = fs::read_dir(dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                let name = entry.file_name().to_string_lossy().to_string();

                // Skip hidden, node_modules, target, etc.
                if name.starts_with('.')
                    || name == "node_modules"
                    || name == "target"
                    || name == "__pycache__"
                    || name == "dist"
                    || name == "build"
                    || name == ".git"
                {
                    continue;
                }

                if path.is_dir() {
                    walk(&path, ext, files);
                } else if let Some(file_ext) = path.extension() {
                    if ext.contains(&file_ext.to_string_lossy().to_string()) {
                        files.push(path.to_string_lossy().to_string());
                    }
                }
            }
        }
    }

    let mut files = Vec::new();
    walk(Path::new(&dir_path), &allowed_ext, &mut files);

    // Cap at 100 files
    files.truncate(100);

    for file_path in files {
        match rag_ingest_single(&store, &file_path).await {
            Ok(result) => results.push(result),
            Err(_) => continue, // Skip files that fail
        }
    }

    Ok(results)
}

async fn rag_ingest_single(
    store: &SharedVectorStore,
    file_path: &str,
) -> Result<IngestResult, String> {
    let content = fs::read_to_string(file_path).map_err(|e| format!("Read error: {}", e))?;

    let total_chars = content.len();
    if total_chars > 500_000 {
        return Err("File too large for ingestion".to_string());
    }

    let chunks = chunk_text(&content);
    let chunk_count = chunks.len();

    if chunks.is_empty() {
        return Ok(IngestResult {
            file_path: file_path.to_string(),
            chunks: 0,
            total_chars,
        });
    }

    let chunk_strings: Vec<String> = chunks.iter().map(|c| c.text.clone()).collect();
    let embeddings_result = embeddings::embed_texts(&chunk_strings)?;

    let mut s = store.lock().map_err(|e| e.to_string())?;
    for (chunk, embedding) in chunks.iter().zip(embeddings_result.into_iter()) {
        s.add(
            chunk.text.clone(),
            embedding,
            "document".to_string(),
            file_path.to_string(),
        );
    }

    Ok(IngestResult {
        file_path: file_path.to_string(),
        chunks: chunk_count,
        total_chars,
    })
}

/// Query the RAG store: find relevant chunks for a question
#[tauri::command]
pub async fn rag_query(
    store: tauri::State<'_, SharedVectorStore>,
    query: String,
    top_k: Option<usize>,
) -> Result<RagResult, String> {
    let results = embeddings::embed_texts(&[query])?;
    let query_embedding = results.into_iter().next().ok_or("No embedding")?;

    let s = store.lock().map_err(|e| e.to_string())?;
    let hits = s.search(&query_embedding, top_k.unwrap_or(5));

    let sources: Vec<RagSource> = hits
        .iter()
        .map(|h| RagSource {
            text: h.text.clone(),
            file: h.source_id.clone(),
            score: h.score,
        })
        .collect();

    let context = sources
        .iter()
        .map(|s| format!("[{}]\n{}", s.file, s.text))
        .collect::<Vec<_>>()
        .join("\n\n---\n\n");

    Ok(RagResult {
        answer_context: context,
        sources,
    })
}

// --- Chunking ---

#[allow(dead_code)]
struct Chunk {
    text: String,
    index: usize,
}

fn chunk_text(text: &str) -> Vec<Chunk> {
    let chars: Vec<char> = text.chars().collect();
    if chars.len() < 100 {
        return vec![Chunk {
            text: text.to_string(),
            index: 0,
        }];
    }

    let mut chunks = Vec::new();
    let mut start = 0;
    let mut idx = 0;

    while start < chars.len() {
        let end = (start + CHUNK_SIZE).min(chars.len());
        let chunk_text: String = chars[start..end].iter().collect();

        if !chunk_text.trim().is_empty() {
            chunks.push(Chunk {
                text: chunk_text,
                index: idx,
            });
            idx += 1;
        }

        if end >= chars.len() {
            break;
        }

        start = end - CHUNK_OVERLAP;
    }

    chunks
}
