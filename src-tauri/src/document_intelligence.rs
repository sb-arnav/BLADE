/// BLADE Document Intelligence
///
/// Deep document reading: ingest PDFs, text, and markdown — extract insights,
/// answer questions, build a searchable library, synthesize across everything.

use rusqlite::params;
use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------------
// Structs
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Document {
    pub id: String,
    pub title: String,
    pub file_path: String,
    pub doc_type: String,       // "pdf", "txt", "md", "docx"
    pub content: String,        // full extracted text (up to 100k chars)
    pub summary: String,        // LLM-generated 3-paragraph summary
    pub key_points: Vec<String>,
    pub topics: Vec<String>,
    pub word_count: i32,
    pub added_at: i64,
    pub last_accessed: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DocumentChunk {
    pub doc_id: String,
    pub chunk_index: i32,
    pub content: String,
    pub page_hint: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DocQA {
    pub question: String,
    pub answer: String,
    pub doc_ids_used: Vec<String>,
    pub confidence: f32,
    pub relevant_quotes: Vec<String>,
}

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

fn open_db() -> Option<rusqlite::Connection> {
    let db_path = crate::config::blade_config_dir().join("blade.db");
    rusqlite::Connection::open(&db_path).ok()
}

pub fn ensure_tables() {
    let db_path = crate::config::blade_config_dir().join("blade.db");
    let conn = match rusqlite::Connection::open(&db_path) {
        Ok(c) => c,
        Err(_) => return,
    };
    let _ = conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS doc_library (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            file_path TEXT NOT NULL,
            doc_type TEXT NOT NULL,
            content TEXT NOT NULL,
            summary TEXT NOT NULL DEFAULT '',
            key_points TEXT NOT NULL DEFAULT '[]',
            topics TEXT NOT NULL DEFAULT '[]',
            word_count INTEGER NOT NULL DEFAULT 0,
            added_at INTEGER NOT NULL,
            last_accessed INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS doc_chunks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            doc_id TEXT NOT NULL,
            chunk_index INTEGER NOT NULL,
            content TEXT NOT NULL,
            page_hint INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_doc_chunks_doc_id ON doc_chunks(doc_id);
        CREATE INDEX IF NOT EXISTS idx_doc_library_added ON doc_library(added_at DESC);",
    );
}

// ---------------------------------------------------------------------------
// File reading
// ---------------------------------------------------------------------------

pub fn read_text_file(path: &str) -> Result<String, String> {
    std::fs::read_to_string(path).map_err(|e| format!("Read error: {}", e))
}

/// Extract text from a PDF by reading raw bytes and filtering to printable content.
/// Works well on text-layer PDFs; returns a best-effort result for scanned PDFs.
pub fn extract_pdf_text(path: &str) -> Result<String, String> {
    let bytes = std::fs::read(path).map_err(|e| format!("Read error: {}", e))?;

    // Walk the byte stream collecting runs of printable ASCII and common whitespace.
    // PDF text streams are often readable as-is when embedded as UTF-8/Latin-1.
    let mut result = String::with_capacity(bytes.len() / 2);
    let mut run = String::new();

    for &b in &bytes {
        if b == b'\n' || b == b'\r' || b == b'\t' || (b >= 0x20 && b < 0x7F) {
            run.push(b as char);
        } else {
            if run.len() >= 4 {
                result.push_str(&run);
                result.push('\n');
            }
            run.clear();
        }
    }
    if run.len() >= 4 {
        result.push_str(&run);
    }

    // Clean up: collapse multiple blank lines, trim obvious PDF noise
    let cleaned: Vec<&str> = result
        .lines()
        .filter(|l| {
            let t = l.trim();
            // Skip very short lines that are PDF structural tokens
            if t.len() < 3 {
                return false;
            }
            // Skip lines that are pure numbers (page numbers, object IDs)
            if t.chars().all(|c| c.is_numeric() || c == ' ') {
                return false;
            }
            true
        })
        .collect();

    let text = cleaned.join("\n");

    if text.trim().len() < 50 {
        return Ok("binary - use pdf viewer".to_string());
    }

    Ok(text)
}

// ---------------------------------------------------------------------------
// Chunking
// ---------------------------------------------------------------------------

fn chunk_document(content: &str, chunk_size: usize) -> Vec<String> {
    if content.is_empty() {
        return vec![];
    }

    let mut chunks = Vec::new();
    let paragraphs: Vec<&str> = content.split("\n\n").collect();

    let mut current = String::new();

    for para in &paragraphs {
        let para_trimmed = para.trim();
        if para_trimmed.is_empty() {
            continue;
        }

        if current.len() + para_trimmed.len() + 2 > chunk_size && !current.is_empty() {
            chunks.push(current.trim().to_string());
            current = String::new();
        }

        if !current.is_empty() {
            current.push_str("\n\n");
        }
        current.push_str(para_trimmed);

        // If a single paragraph exceeds chunk_size, split it at char boundaries
        while current.len() > chunk_size {
            let split_at = current
                .char_indices()
                .nth(chunk_size)
                .map(|(i, _)| i)
                .unwrap_or(current.len());
            chunks.push(current[..split_at].to_string());
            current = current[split_at..].to_string();
        }
    }

    if !current.trim().is_empty() {
        chunks.push(current.trim().to_string());
    }

    chunks
}

// ---------------------------------------------------------------------------
// LLM helpers
// ---------------------------------------------------------------------------

async fn llm_call(prompt: &str) -> Result<String, String> {
    let config = crate::config::load_config();
    if config.api_key.is_empty() && config.provider != "ollama" {
        return Err("No API key configured".to_string());
    }

    let model = crate::config::cheap_model_for_provider(&config.provider, &config.model);

    use crate::providers::ConversationMessage;
    let messages = vec![ConversationMessage::User(prompt.to_string())];

    let turn = crate::providers::complete_turn(
        &config.provider,
        &config.api_key,
        &model,
        &messages,
        &[],
        config.base_url.as_deref(),
    )
    .await?;

    Ok(turn.content.trim().to_string())
}

async fn generate_summary_and_keypoints(
    title: &str,
    content: &str,
) -> (String, Vec<String>, Vec<String>) {
    let excerpt = crate::safe_slice(content, 8_000);
    let prompt = format!(
        "You are analyzing a document titled \"{title}\".\n\n\
         Here is an excerpt (up to 8000 chars):\n\n{excerpt}\n\n\
         Respond with EXACTLY this format (no other text):\n\
         SUMMARY:\n<3 concise paragraphs summarizing the document>\n\n\
         KEYPOINTS:\n- <key point 1>\n- <key point 2>\n- <key point 3>\n- <key point 4>\n- <key point 5>\n\n\
         TOPICS:\n<comma-separated list of 3-6 topic tags>",
        title = title,
        excerpt = excerpt,
    );

    let response = match llm_call(&prompt).await {
        Ok(r) => r,
        Err(_) => return (String::new(), vec![], vec![]),
    };

    let summary = extract_section(&response, "SUMMARY:");
    let keypoints_raw = extract_section(&response, "KEYPOINTS:");
    let topics_raw = extract_section(&response, "TOPICS:");

    let key_points: Vec<String> = keypoints_raw
        .lines()
        .filter_map(|l| {
            let t = l.trim().trim_start_matches('-').trim().to_string();
            if t.is_empty() { None } else { Some(t) }
        })
        .collect();

    let topics: Vec<String> = topics_raw
        .split(',')
        .map(|t| t.trim().to_string())
        .filter(|t| !t.is_empty())
        .collect();

    (summary, key_points, topics)
}

fn extract_section(text: &str, header: &str) -> String {
    // Find header, collect text until next known header or end
    let headers = ["SUMMARY:", "KEYPOINTS:", "TOPICS:"];
    let start = match text.find(header) {
        Some(i) => i + header.len(),
        None => return String::new(),
    };
    let slice = &text[start..];

    // Find where next header begins
    let end = headers
        .iter()
        .filter(|&&h| h != header)
        .filter_map(|h| slice.find(h))
        .min()
        .unwrap_or(slice.len());

    slice[..end].trim().to_string()
}

// ---------------------------------------------------------------------------
// DB save / load helpers
// ---------------------------------------------------------------------------

fn save_document(doc: &Document) -> Result<(), String> {
    let conn = open_db().ok_or("Cannot open DB")?;
    let key_points_json =
        serde_json::to_string(&doc.key_points).unwrap_or_else(|_| "[]".to_string());
    let topics_json = serde_json::to_string(&doc.topics).unwrap_or_else(|_| "[]".to_string());

    conn.execute(
        "INSERT OR REPLACE INTO doc_library \
         (id, title, file_path, doc_type, content, summary, key_points, topics, word_count, added_at, last_accessed) \
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
        params![
            doc.id,
            doc.title,
            doc.file_path,
            doc.doc_type,
            doc.content,
            doc.summary,
            key_points_json,
            topics_json,
            doc.word_count,
            doc.added_at,
            doc.last_accessed,
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn save_chunks(doc_id: &str, chunks: &[String]) -> Result<(), String> {
    let conn = open_db().ok_or("Cannot open DB")?;
    conn.execute("DELETE FROM doc_chunks WHERE doc_id = ?1", params![doc_id])
        .map_err(|e| e.to_string())?;
    for (i, chunk) in chunks.iter().enumerate() {
        conn.execute(
            "INSERT INTO doc_chunks (doc_id, chunk_index, content, page_hint) VALUES (?1,?2,?3,NULL)",
            params![doc_id, i as i32, chunk],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn row_to_document(row: &rusqlite::Row) -> rusqlite::Result<Document> {
    let key_points_json: String = row.get(6)?;
    let topics_json: String = row.get(7)?;
    let key_points: Vec<String> =
        serde_json::from_str(&key_points_json).unwrap_or_default();
    let topics: Vec<String> = serde_json::from_str(&topics_json).unwrap_or_default();
    Ok(Document {
        id: row.get(0)?,
        title: row.get(1)?,
        file_path: row.get(2)?,
        doc_type: row.get(3)?,
        content: row.get(4)?,
        summary: row.get(5)?,
        key_points,
        topics,
        word_count: row.get(8)?,
        added_at: row.get(9)?,
        last_accessed: row.get(10)?,
    })
}

// ---------------------------------------------------------------------------
// Core CRUD
// ---------------------------------------------------------------------------

pub fn get_document(id: &str) -> Option<Document> {
    let conn = open_db()?;
    conn.query_row(
        "SELECT id,title,file_path,doc_type,content,summary,key_points,topics,word_count,added_at,last_accessed \
         FROM doc_library WHERE id=?1",
        params![id],
        row_to_document,
    )
    .ok()
}

pub fn list_documents(limit: usize) -> Vec<Document> {
    let conn = match open_db() {
        Some(c) => c,
        None => return vec![],
    };
    let mut stmt = match conn.prepare(
        "SELECT id,title,file_path,doc_type,content,summary,key_points,topics,word_count,added_at,last_accessed \
         FROM doc_library ORDER BY added_at DESC LIMIT ?1",
    ) {
        Ok(s) => s,
        Err(_) => return vec![],
    };
    stmt.query_map(params![limit as i64], row_to_document)
        .ok()
        .map(|rows| rows.flatten().collect())
        .unwrap_or_default()
}

pub fn search_documents(query: &str) -> Vec<Document> {
    let conn = match open_db() {
        Some(c) => c,
        None => return vec![],
    };
    let pattern = format!("%{}%", query);
    let mut stmt = match conn.prepare(
        "SELECT id,title,file_path,doc_type,content,summary,key_points,topics,word_count,added_at,last_accessed \
         FROM doc_library \
         WHERE title LIKE ?1 OR summary LIKE ?1 OR key_points LIKE ?1 OR topics LIKE ?1 \
         ORDER BY added_at DESC LIMIT 20",
    ) {
        Ok(s) => s,
        Err(_) => return vec![],
    };
    stmt.query_map(params![pattern], row_to_document)
        .ok()
        .map(|rows| rows.flatten().collect())
        .unwrap_or_default()
}

pub fn delete_document(id: &str) -> Result<(), String> {
    let conn = open_db().ok_or("Cannot open DB")?;
    conn.execute("DELETE FROM doc_chunks WHERE doc_id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM doc_library WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Ingestion
// ---------------------------------------------------------------------------

pub async fn ingest_document(file_path: &str) -> Result<Document, String> {
    ensure_tables();

    let path = std::path::Path::new(file_path);
    if !path.exists() {
        return Err(format!("File not found: {}", file_path));
    }

    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    let doc_type = match ext.as_str() {
        "pdf" => "pdf",
        "md" | "markdown" => "md",
        "txt" => "txt",
        "docx" => "docx",
        _ => "txt",
    }
    .to_string();

    // Read content
    let raw_content = match doc_type.as_str() {
        "pdf" => match extract_pdf_text(file_path) {
            Ok(t) => t,
            Err(_) => format!("binary - use pdf viewer ({})", file_path),
        },
        _ => read_text_file(file_path).unwrap_or_else(|e| format!("Error reading: {}", e)),
    };

    // Cap at 100k chars
    let content = if raw_content.len() > 100_000 {
        let end = raw_content
            .char_indices()
            .nth(100_000)
            .map(|(i, _)| i)
            .unwrap_or(raw_content.len());
        raw_content[..end].to_string()
    } else {
        raw_content
    };

    let word_count = content.split_whitespace().count() as i32;

    // Derive title from filename
    let title = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("Untitled")
        .replace('_', " ")
        .replace('-', " ");

    let now = chrono::Utc::now().timestamp();
    let id = format!("{:x}", md5_simple(&format!("{}{}", file_path, now)));

    // Generate summary, key_points, topics via LLM (skip for binary/empty)
    let (summary, key_points, topics) = if content.starts_with("binary")
        || content.trim().is_empty()
    {
        (String::new(), vec![], vec![])
    } else {
        generate_summary_and_keypoints(&title, &content).await
    };

    let doc = Document {
        id: id.clone(),
        title,
        file_path: file_path.to_string(),
        doc_type,
        content: content.clone(),
        summary,
        key_points,
        topics,
        word_count,
        added_at: now,
        last_accessed: now,
    };

    save_document(&doc)?;

    // Chunk and store
    let chunks = chunk_document(&content, 1000);
    save_chunks(&id, &chunks)?;

    Ok(doc)
}

/// Simple MD5-like hash for generating document IDs (not cryptographic).
/// We just need a stable short ID from a string.
fn md5_simple(s: &str) -> u64 {
    let mut h: u64 = 14695981039346656037u64;
    for b in s.bytes() {
        h ^= b as u64;
        h = h.wrapping_mul(1099511628211u64);
    }
    h
}

// ---------------------------------------------------------------------------
// Q&A
// ---------------------------------------------------------------------------

fn search_chunks(query: &str, doc_ids: Option<&[String]>, limit: usize) -> Vec<DocumentChunk> {
    let conn = match open_db() {
        Some(c) => c,
        None => return vec![],
    };

    let pattern = format!("%{}%", query);

    let sql = if doc_ids.is_some() {
        "SELECT doc_id, chunk_index, content, page_hint FROM doc_chunks \
         WHERE content LIKE ?1 AND doc_id IN (SELECT value FROM json_each(?2)) \
         LIMIT ?3"
    } else {
        "SELECT doc_id, chunk_index, content, page_hint FROM doc_chunks \
         WHERE content LIKE ?1 \
         LIMIT ?3"
    };

    // For simplicity, fall back to two separate queries
    if let Some(ids) = doc_ids {
        let ids_json = serde_json::to_string(ids).unwrap_or_else(|_| "[]".to_string());
        let mut stmt = match conn.prepare(sql) {
            Ok(s) => s,
            Err(_) => return vec![],
        };
        stmt.query_map(params![pattern, ids_json, limit as i64], |row| {
            Ok(DocumentChunk {
                doc_id: row.get(0)?,
                chunk_index: row.get(1)?,
                content: row.get(2)?,
                page_hint: row.get(3)?,
            })
        })
        .ok()
        .map(|rows| rows.flatten().collect())
        .unwrap_or_default()
    } else {
        let mut stmt = match conn.prepare(
            "SELECT doc_id, chunk_index, content, page_hint FROM doc_chunks \
             WHERE content LIKE ?1 LIMIT ?2",
        ) {
            Ok(s) => s,
            Err(_) => return vec![],
        };
        stmt.query_map(params![pattern, limit as i64], |row| {
            Ok(DocumentChunk {
                doc_id: row.get(0)?,
                chunk_index: row.get(1)?,
                content: row.get(2)?,
                page_hint: row.get(3)?,
            })
        })
        .ok()
        .map(|rows| rows.flatten().collect())
        .unwrap_or_default()
    }
}

pub async fn answer_question(
    question: &str,
    doc_ids: Option<Vec<String>>,
) -> Result<DocQA, String> {
    ensure_tables();

    let chunks = search_chunks(question, doc_ids.as_deref(), 5);

    if chunks.is_empty() {
        return Ok(DocQA {
            question: question.to_string(),
            answer: "No relevant content found in your document library for that question."
                .to_string(),
            doc_ids_used: vec![],
            confidence: 0.0,
            relevant_quotes: vec![],
        });
    }

    let used_doc_ids: Vec<String> = {
        let mut ids: Vec<String> = chunks.iter().map(|c| c.doc_id.clone()).collect();
        ids.dedup();
        ids
    };

    let context: String = chunks
        .iter()
        .enumerate()
        .map(|(i, c)| format!("[Chunk {}]\n{}", i + 1, c.content))
        .collect::<Vec<_>>()
        .join("\n\n---\n\n");

    let prompt = format!(
        "You are answering a question using document excerpts.\n\n\
         QUESTION: {question}\n\n\
         DOCUMENT EXCERPTS:\n{context}\n\n\
         Respond with EXACTLY this format:\n\
         ANSWER:\n<your detailed answer based only on the provided excerpts>\n\n\
         CONFIDENCE: <0.0-1.0 score>\n\n\
         QUOTES:\n- \"<exact quote from text>\"\n- \"<exact quote from text>\"",
        question = question,
        context = context,
    );

    let response = llm_call(&prompt).await?;

    let answer = extract_section(&response, "ANSWER:");

    let confidence_str = extract_section(&response, "CONFIDENCE:");
    let confidence: f32 = confidence_str
        .split_whitespace()
        .next()
        .and_then(|s| s.parse().ok())
        .unwrap_or(0.5);

    let quotes_raw = extract_section(&response, "QUOTES:");
    let relevant_quotes: Vec<String> = quotes_raw
        .lines()
        .filter_map(|l| {
            let t = l
                .trim()
                .trim_start_matches('-')
                .trim()
                .trim_matches('"')
                .to_string();
            if t.is_empty() { None } else { Some(t) }
        })
        .collect();

    // Touch last_accessed on used docs
    if let Some(conn) = open_db() {
        let now = chrono::Utc::now().timestamp();
        for id in &used_doc_ids {
            let _ = conn.execute(
                "UPDATE doc_library SET last_accessed=?1 WHERE id=?2",
                params![now, id],
            );
        }
    }

    Ok(DocQA {
        question: question.to_string(),
        answer,
        doc_ids_used: used_doc_ids,
        confidence,
        relevant_quotes,
    })
}

// ---------------------------------------------------------------------------
// Cross-doc synthesis
// ---------------------------------------------------------------------------

pub async fn cross_doc_synthesis(question: &str) -> String {
    ensure_tables();

    let docs = list_documents(20);
    if docs.is_empty() {
        return "Your document library is empty. Ingest some documents first.".to_string();
    }

    // Pull top 3 chunks per document
    let mut all_context = String::new();
    for doc in docs.iter().take(10) {
        let chunks = search_chunks(question, Some(&[doc.id.clone()]), 2);
        if !chunks.is_empty() {
            all_context.push_str(&format!("\n\n### From: {}\n", doc.title));
            for c in &chunks {
                all_context.push_str(&c.content);
                all_context.push('\n');
            }
        } else if !doc.summary.is_empty() {
            // Fall back to summary
            all_context.push_str(&format!(
                "\n\n### From: {}\nSummary: {}",
                doc.title,
                crate::safe_slice(&doc.summary, 500)
            ));
        }
    }

    if all_context.trim().is_empty() {
        return "No relevant content found across your library for that question.".to_string();
    }

    let doc_count = docs.len();
    let prompt = format!(
        "The user has a library of {doc_count} documents. They want a synthesis across all of them.\n\n\
         QUESTION: {question}\n\n\
         EXCERPTS FROM MULTIPLE DOCUMENTS:\n{context}\n\n\
         Write a comprehensive synthesis that:\n\
         1. Identifies common themes and patterns across documents\n\
         2. Notes where documents agree or contradict each other\n\
         3. Highlights the most important insights across the whole library\n\
         4. Directly answers the question from a multi-document perspective\n\n\
         Be concrete. Reference specific documents by title when relevant.",
        doc_count = doc_count,
        question = question,
        context = crate::safe_slice(&all_context, 12_000),
    );

    llm_call(&prompt).await.unwrap_or_else(|e| format!("Synthesis failed: {}", e))
}

// ---------------------------------------------------------------------------
// Study notes
// ---------------------------------------------------------------------------

pub async fn generate_study_notes(doc_id: &str) -> String {
    ensure_tables();

    let doc = match get_document(doc_id) {
        Some(d) => d,
        None => return "Document not found.".to_string(),
    };

    let excerpt = crate::safe_slice(&doc.content, 8_000);
    let prompt = format!(
        "Generate Anki-style study notes from this document titled \"{title}\".\n\n\
         DOCUMENT EXCERPT:\n{excerpt}\n\n\
         Create 8-12 Q&A pairs in this format:\n\
         Q: <question>\n\
         A: <concise answer>\n\n\
         Q: <question>\n\
         A: <concise answer>\n\n\
         Focus on the most important concepts, definitions, and insights.\n\
         Questions should test understanding, not just recall.",
        title = doc.title,
        excerpt = excerpt,
    );

    llm_call(&prompt)
        .await
        .unwrap_or_else(|e| format!("Study notes generation failed: {}", e))
}

// ---------------------------------------------------------------------------
// Context for brain.rs injection
// ---------------------------------------------------------------------------

pub fn get_library_context() -> String {
    let conn = match open_db() {
        Some(c) => c,
        None => return String::new(),
    };

    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM doc_library", [], |row| row.get(0))
        .unwrap_or(0);

    if count == 0 {
        return String::new();
    }

    let recent = list_documents(5);
    let recent_titles: Vec<String> = recent.iter().map(|d| format!("'{}'", d.title)).collect();

    format!(
        "Document library: {} document{}. Recent: {}",
        count,
        if count == 1 { "" } else { "s" },
        recent_titles.join(", ")
    )
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn doc_ingest(file_path: String) -> Result<Document, String> {
    ingest_document(&file_path).await
}

#[tauri::command]
pub fn doc_search(query: String) -> Vec<Document> {
    ensure_tables();
    search_documents(&query)
}

#[tauri::command]
pub fn doc_get(id: String) -> Option<Document> {
    ensure_tables();
    // Update last_accessed
    if let Some(conn) = open_db() {
        let now = chrono::Utc::now().timestamp();
        let _ = conn.execute(
            "UPDATE doc_library SET last_accessed=?1 WHERE id=?2",
            params![now, id],
        );
    }
    get_document(&id)
}

#[tauri::command]
pub fn doc_list(limit: Option<usize>) -> Vec<Document> {
    ensure_tables();
    list_documents(limit.unwrap_or(50))
}

#[tauri::command]
pub fn doc_delete(id: String) -> Result<(), String> {
    ensure_tables();
    delete_document(&id)
}

#[tauri::command]
pub async fn doc_answer_question(
    question: String,
    doc_ids: Option<Vec<String>>,
) -> Result<DocQA, String> {
    answer_question(&question, doc_ids).await
}

#[tauri::command]
pub async fn doc_cross_synthesis(question: String) -> String {
    cross_doc_synthesis(&question).await
}

#[tauri::command]
pub async fn doc_generate_study_notes(doc_id: String) -> String {
    ensure_tables();
    generate_study_notes(&doc_id).await
}
