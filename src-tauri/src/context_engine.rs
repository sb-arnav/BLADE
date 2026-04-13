/// CONTEXT ENGINE — Smart RAG backbone for BLADE.
///
/// Instead of blindly stuffing everything into the system prompt, the context
/// engine decides *what is relevant right now* and dynamically assembles the
/// optimal context window. Every prompt injection is scored and ranked — only
/// the highest-signal chunks make it in.
///
/// Architecture:
///   1. Source pullers: pull raw candidates from memory, screen, goals, files, conversations
///   2. Relevance scoring: cheap LLM call scores each chunk 0–10, mapped to 0.0–1.0
///   3. Recency weighting: recent chunks get a multiplier boost
///   4. Greedy packing: fill the token budget with the best chunks first
///   5. Caching: avoid re-scoring the same query within 60 seconds
///
/// Primary entry point used by brain.rs:
///   `assemble_smart_context(query, max_tokens).await`

use rusqlite::params;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;

// ── Structs ───────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContextChunk {
    /// Which source produced this chunk: "memory", "screen", "file",
    /// "conversation", "goal", "world"
    pub source: String,
    pub content: String,
    /// Scored relevance to the current query, 0.0–1.0
    pub relevance_score: f32,
    /// Rough token count (words * 1.3)
    pub token_estimate: usize,
    /// Unix timestamp of the underlying record (for recency weighting)
    pub timestamp: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AssembledContext {
    pub chunks: Vec<ContextChunk>,
    pub total_tokens: usize,
    /// Deduplicated list of source names that contributed chunks
    pub sources_used: Vec<String>,
    /// True when chunks were dropped to stay under the token budget
    pub was_truncated: bool,
}

// ── Token estimation ──────────────────────────────────────────────────────────

/// Simple token estimator: word_count * 1.3, rounded up.
/// No tokeniser dependency — intentionally cheap.
pub fn estimate_tokens(text: &str) -> usize {
    let words = text.split_whitespace().count();
    ((words as f64) * 1.3).ceil() as usize
}

// ── Cache (std::sync::Mutex — no tokio) ───────────────────────────────────────

struct CacheEntry {
    ctx: AssembledContext,
    cached_at: i64,
}

static CONTEXT_CACHE: Mutex<Option<HashMap<String, CacheEntry>>> =
    Mutex::new(None);

const CACHE_TTL_SECS: i64 = 60;

fn with_cache<F, R>(f: F) -> R
where
    F: FnOnce(&mut HashMap<String, CacheEntry>) -> R,
{
    let mut guard = CONTEXT_CACHE.lock().unwrap_or_else(|e| e.into_inner());
    let map = guard.get_or_insert_with(HashMap::new);
    f(map)
}

pub fn get_cached_context(query_hash: &str) -> Option<AssembledContext> {
    let now = chrono::Utc::now().timestamp();
    with_cache(|map| {
        map.get(query_hash).and_then(|e| {
            if now - e.cached_at <= CACHE_TTL_SECS {
                Some(e.ctx.clone())
            } else {
                None
            }
        })
    })
}

pub fn cache_context(query_hash: &str, ctx: AssembledContext) {
    let now = chrono::Utc::now().timestamp();
    with_cache(|map| {
        map.insert(
            query_hash.to_string(),
            CacheEntry { ctx, cached_at: now },
        );
        // Evict expired entries while we have the lock (lazy GC)
        map.retain(|_, v| now - v.cached_at <= CACHE_TTL_SECS);
    });
}

// ── LLM helpers (mirrors memory_palace.rs pattern) ────────────────────────────

fn cheap_model_for(provider: &str) -> String {
    match provider {
        "anthropic" => "claude-haiku-4-5".to_string(),
        "openai" => "gpt-4o-mini".to_string(),
        "gemini" => "gemini-2.0-flash".to_string(),
        "groq" => "llama-3.1-8b-instant".to_string(),
        "openrouter" => "google/gemini-2.0-flash".to_string(),
        _ => "llama3".to_string(),
    }
}

/// Resolve (provider, api_key, cheap_model) for latency-sensitive scoring calls.
fn resolve_cheap_triple() -> (String, String, String) {
    let config = crate::config::load_config();
    // Prefer the "fast" routing slot if configured
    if let Some(fast_provider) = config.task_routing.fast.clone() {
        let key = crate::config::get_provider_key(&fast_provider);
        if !key.is_empty() {
            let model = cheap_model_for(&fast_provider);
            return (fast_provider, key, model);
        }
    }
    let provider = config.provider.clone();
    let key = config.api_key.clone();
    let model = cheap_model_for(&provider);
    (provider, key, model)
}

// ── Relevance scoring ─────────────────────────────────────────────────────────

/// Score how relevant `chunk` is to `query` using a cheap LLM call.
/// Prompt asks for a single integer 0–10; mapped to 0.0–1.0.
/// Falls back to 0.5 on any error so we never hard-fail.
pub async fn score_relevance(query: &str, chunk: &str) -> f32 {
    // Truncate inputs to keep the scoring call cheap
    let q = crate::safe_slice(query, 300);
    let c = crate::safe_slice(chunk, 600);

    let prompt = format!(
        "Score the relevance of the following CONTEXT to the QUERY on a scale from 0 to 10.\n\
         Reply with ONLY a single integer (0-10), no explanation.\n\n\
         QUERY: {}\n\n\
         CONTEXT: {}",
        q, c
    );

    let (provider, api_key, model) = resolve_cheap_triple();
    if api_key.is_empty() && provider != "ollama" {
        return 0.5;
    }

    let messages = vec![crate::providers::ConversationMessage::User(prompt)];
    let turn =
        match crate::providers::complete_turn(&provider, &api_key, &model, &messages, &[], None)
            .await
        {
            Ok(t) => t,
            Err(_) => return 0.5,
        };

    // Parse the first integer we find in the response
    let score: f32 = turn
        .content
        .split_whitespace()
        .find_map(|tok| tok.trim_matches(|c: char| !c.is_ascii_digit()).parse::<u8>().ok())
        .map(|n| n.min(10) as f32 / 10.0)
        .unwrap_or(0.5);

    score
}

// ── Recency weighting ─────────────────────────────────────────────────────────

/// Returns a multiplier in [0.5, 1.0] based on how recent `timestamp` is.
/// Items from the last hour get 1.0; items >24 h old asymptote toward 0.5.
fn recency_weight(timestamp: i64) -> f32 {
    let now = chrono::Utc::now().timestamp();
    let age_secs = (now - timestamp).max(0) as f32;
    let hours = age_secs / 3600.0;
    // Decay: 1.0 at t=0, ~0.75 at 12 h, ~0.5 at 48 h
    (0.5_f32 + 0.5 / (1.0 + hours / 12.0)).clamp(0.5, 1.0)
}

// ── Source pullers ────────────────────────────────────────────────────────────

/// Pull episodic memories relevant to `query` from the Memory Palace.
async fn pull_memory_chunks(query: &str, limit: usize) -> Vec<ContextChunk> {
    let episodes = crate::memory_palace::search_episodes(query, limit);
    episodes
        .into_iter()
        .map(|ep| {
            let content = format!("[{}] {}: {}", ep.episode_type, ep.title, ep.summary);
            let token_estimate = estimate_tokens(&content);
            ContextChunk {
                source: "memory".to_string(),
                content,
                relevance_score: 0.0, // scored later
                token_estimate,
                timestamp: ep.occurred_at,
            }
        })
        .collect()
}

/// Pull recent screen-timeline frames (OCR + window title) from SQLite.
/// Does NOT hold the connection across any await.
async fn pull_screen_chunks(limit: usize) -> Vec<ContextChunk> {
    let db_path = crate::config::blade_config_dir().join("blade.db");
    let rows: Vec<(String, String, i64)> = {
        let Ok(conn) = rusqlite::Connection::open(&db_path) else {
            return vec![];
        };
        let mut stmt = match conn.prepare(
            "SELECT window_title, description, timestamp
             FROM screen_timeline
             WHERE description != ''
             ORDER BY timestamp DESC
             LIMIT ?1",
        ) {
            Ok(s) => s,
            Err(_) => return vec![],
        };
        stmt.query_map(params![limit as i64], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
            ))
        })
        .map(|iter| iter.flatten().collect())
        .unwrap_or_default()
    };

    rows.into_iter()
        .map(|(title, desc, ts)| {
            let content = if title.is_empty() {
                desc.clone()
            } else {
                format!("[{}] {}", title, desc)
            };
            let content = crate::safe_slice(&content, 400).to_string();
            let token_estimate = estimate_tokens(&content);
            ContextChunk {
                source: "screen".to_string(),
                content,
                relevance_score: 0.0,
                token_estimate,
                timestamp: ts,
            }
        })
        .collect()
}

/// Pull active goals from the goal_engine table.
async fn pull_goal_chunks() -> Vec<ContextChunk> {
    let db_path = crate::config::blade_config_dir().join("blade.db");
    let rows: Vec<(String, String, i64)> = {
        let Ok(conn) = rusqlite::Connection::open(&db_path) else {
            return vec![];
        };
        let mut stmt = match conn.prepare(
            "SELECT title, description, created_at
             FROM goals
             WHERE status = 'active'
             ORDER BY priority DESC, created_at DESC
             LIMIT 10",
        ) {
            Ok(s) => s,
            Err(_) => return vec![],
        };
        stmt.query_map(params![], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
            ))
        })
        .map(|iter| iter.flatten().collect())
        .unwrap_or_default()
    };

    rows.into_iter()
        .map(|(title, desc, ts)| {
            let content = format!("Goal: {} — {}", title, crate::safe_slice(&desc, 200));
            let token_estimate = estimate_tokens(&content);
            ContextChunk {
                source: "goal".to_string(),
                content,
                relevance_score: 0.0,
                token_estimate,
                timestamp: ts,
            }
        })
        .collect()
}

/// Pull recent conversation messages that match `query` from the `messages` table.
/// Also checks execution_memory for relevant past shell commands.
async fn pull_conversation_chunks(query: &str, limit: usize) -> Vec<ContextChunk> {
    let db_path = crate::config::blade_config_dir().join("blade.db");
    let pattern = format!("%{}%", crate::safe_slice(query, 100));

    let rows: Vec<(String, String, i64)> = {
        let Ok(conn) = rusqlite::Connection::open(&db_path) else {
            return vec![];
        };
        let mut stmt = match conn.prepare(
            "SELECT role, content, timestamp
             FROM messages
             WHERE content LIKE ?1
             ORDER BY timestamp DESC
             LIMIT ?2",
        ) {
            Ok(s) => s,
            Err(_) => return vec![],
        };
        stmt.query_map(params![pattern, limit as i64], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
            ))
        })
        .map(|iter| iter.flatten().collect())
        .unwrap_or_default()
    };

    // Also pull from execution memory (past shell commands)
    let exec_records = crate::execution_memory::search(query, limit / 2);
    let exec_chunks: Vec<ContextChunk> = exec_records
        .into_iter()
        .map(|r| {
            let snippet = if r.exit_code == 0 {
                format!("$ {} → {}", crate::safe_slice(&r.command, 80), crate::safe_slice(&r.stdout, 120))
            } else {
                format!(
                    "$ {} [exit {}] stderr: {}",
                    crate::safe_slice(&r.command, 80),
                    r.exit_code,
                    crate::safe_slice(&r.stderr, 120)
                )
            };
            let token_estimate = estimate_tokens(&snippet);
            ContextChunk {
                source: "conversation".to_string(),
                content: snippet,
                relevance_score: 0.0,
                token_estimate,
                timestamp: r.timestamp,
            }
        })
        .collect();

    let mut chunks: Vec<ContextChunk> = rows
        .into_iter()
        .map(|(role, content, ts)| {
            let snippet = format!("[{}] {}", role, crate::safe_slice(&content, 300));
            let token_estimate = estimate_tokens(&snippet);
            ContextChunk {
                source: "conversation".to_string(),
                content: snippet,
                relevance_score: 0.0,
                token_estimate,
                timestamp: ts,
            }
        })
        .collect();

    chunks.extend(exec_chunks);
    chunks
}

/// Pull file-index snippets relevant to `query` using the indexer's symbol search.
async fn pull_file_chunks(query: &str, limit: usize) -> Vec<ContextChunk> {
    let db_path = crate::config::blade_config_dir().join("blade.db");
    let pattern = format!("%{}%", crate::safe_slice(query, 100));
    let now = chrono::Utc::now().timestamp();

    let rows: Vec<(String, String)> = {
        let Ok(conn) = rusqlite::Connection::open(&db_path) else {
            return vec![];
        };
        // symbols table from indexer.rs
        let mut stmt = match conn.prepare(
            "SELECT name, file_path
             FROM symbols
             WHERE name LIKE ?1 OR file_path LIKE ?1
             ORDER BY name
             LIMIT ?2",
        ) {
            Ok(s) => s,
            Err(_) => return vec![],
        };
        stmt.query_map(params![pattern, limit as i64], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map(|iter| iter.flatten().collect())
        .unwrap_or_default()
    };

    rows.into_iter()
        .map(|(name, path)| {
            let content = format!("Symbol `{}` in {}", name, crate::safe_slice(&path, 200));
            let token_estimate = estimate_tokens(&content);
            ContextChunk {
                source: "file".to_string(),
                content,
                relevance_score: 0.0,
                token_estimate,
                timestamp: now, // file chunks don't carry a timestamp; use now
            }
        })
        .collect()
}

// ── Core retrieval pipeline ───────────────────────────────────────────────────

/// Pull, score, rank, and pack chunks from the requested sources.
///
/// `sources` is a slice of source names to include, e.g.
/// `&["memory", "screen", "goals", "files", "conversation"]`.
/// Pass an empty slice to pull from all sources.
pub async fn retrieve_relevant_chunks(
    query: &str,
    max_tokens: usize,
    sources: &[&str],
) -> AssembledContext {
    // Cache key = hash of (query, max_tokens, sorted sources)
    let mut sorted_sources: Vec<&str> = sources.to_vec();
    sorted_sources.sort_unstable();
    let cache_key = format!("{}|{}|{}", query, max_tokens, sorted_sources.join(","));
    if let Some(cached) = get_cached_context(&cache_key) {
        return cached;
    }

    let all_sources = sources.is_empty();
    let want = |name: &str| all_sources || sources.contains(&name);

    // --- Pull candidates from each requested source (no await held across DB) ---
    let mut candidates: Vec<ContextChunk> = Vec::new();

    if want("memory") {
        candidates.extend(pull_memory_chunks(query, 8).await);
    }
    if want("screen") {
        candidates.extend(pull_screen_chunks(6).await);
    }
    if want("goals") || want("goal") {
        candidates.extend(pull_goal_chunks().await);
    }
    if want("conversation") {
        candidates.extend(pull_conversation_chunks(query, 6).await);
    }
    if want("files") || want("file") {
        candidates.extend(pull_file_chunks(query, 6).await);
    }

    if candidates.is_empty() {
        let ctx = AssembledContext {
            chunks: vec![],
            total_tokens: 0,
            sources_used: vec![],
            was_truncated: false,
        };
        cache_context(&cache_key, ctx.clone());
        return ctx;
    }

    // --- Score each candidate's relevance to the query ---
    // We fire all scoring calls concurrently for speed
    let score_futures: Vec<_> = candidates
        .iter()
        .map(|chunk| score_relevance(query, &chunk.content))
        .collect();

    let scores = futures::future::join_all(score_futures).await;

    for (chunk, score) in candidates.iter_mut().zip(scores.iter()) {
        chunk.relevance_score = *score;
    }

    // --- Sort by (relevance_score * recency_weight) descending ---
    candidates.sort_by(|a, b| {
        let sa = a.relevance_score * recency_weight(a.timestamp);
        let sb = b.relevance_score * recency_weight(b.timestamp);
        sb.partial_cmp(&sa).unwrap_or(std::cmp::Ordering::Equal)
    });

    // --- Greedily fill the token budget ---
    let mut packed: Vec<ContextChunk> = Vec::new();
    let mut total_tokens = 0usize;
    let mut was_truncated = false;

    for chunk in candidates {
        if chunk.relevance_score < 0.2 {
            // Skip very low relevance even if budget allows
            was_truncated = true;
            continue;
        }
        if total_tokens + chunk.token_estimate > max_tokens {
            was_truncated = true;
            break;
        }
        total_tokens += chunk.token_estimate;
        packed.push(chunk);
    }

    // Collect unique sources used
    let mut sources_used: Vec<String> = packed
        .iter()
        .map(|c| c.source.clone())
        .collect::<std::collections::HashSet<_>>()
        .into_iter()
        .collect();
    sources_used.sort();

    let ctx = AssembledContext {
        chunks: packed,
        total_tokens,
        sources_used,
        was_truncated,
    };

    cache_context(&cache_key, ctx.clone());
    ctx
}

// ── Formatter ─────────────────────────────────────────────────────────────────

/// Format an `AssembledContext` as a prompt-injectable string, grouped by source.
pub fn format_context_for_prompt(ctx: &AssembledContext) -> String {
    if ctx.chunks.is_empty() {
        return String::new();
    }

    // Group chunks by source type
    let mut grouped: HashMap<&str, Vec<&ContextChunk>> = HashMap::new();
    for chunk in &ctx.chunks {
        grouped.entry(chunk.source.as_str()).or_default().push(chunk);
    }

    let source_order = ["memory", "goal", "screen", "conversation", "file", "world"];
    let mut sections: Vec<String> = Vec::new();

    // Emit sources in canonical order, then any extras
    for &src in &source_order {
        if let Some(chunks) = grouped.remove(src) {
            let label = match src {
                "memory" => "Episodic Memory",
                "goal" => "Active Goals",
                "screen" => "Recent Screen Activity",
                "conversation" => "Past Conversations & Commands",
                "file" => "Codebase Symbols",
                "world" => "World State",
                other => other,
            };
            let items: Vec<String> = chunks.iter().map(|c| format!("- {}", c.content)).collect();
            sections.push(format!("**{}**\n{}", label, items.join("\n")));
        }
    }
    // Any remaining sources not in the order list
    let mut extras: Vec<(&str, Vec<&ContextChunk>)> = grouped.into_iter().collect();
    extras.sort_by_key(|(k, _)| *k);
    for (src, chunks) in extras {
        let items: Vec<String> = chunks.iter().map(|c| format!("- {}", c.content)).collect();
        sections.push(format!("**{}**\n{}", src, items.join("\n")));
    }

    let mut out = format!("### Relevant Context\n\n{}", sections.join("\n\n"));

    if ctx.was_truncated {
        out.push_str("\n\n*(context truncated to fit token budget)*");
    }

    out
}

// ── Main entry point ──────────────────────────────────────────────────────────

/// Assemble smart context for `query` within `max_tokens`.
/// Returns a formatted string ready for injection into the system prompt.
///
/// Used by brain.rs after the existing world/causal/memory injections:
/// ```rust
/// let smart_ctx = crate::context_engine::assemble_smart_context(user_query, 2000).await;
/// if !smart_ctx.is_empty() { parts.push(smart_ctx); }
/// ```
pub async fn assemble_smart_context(query: &str, max_tokens: usize) -> String {
    if query.trim().is_empty() {
        return String::new();
    }

    let ctx = retrieve_relevant_chunks(query, max_tokens, &[]).await;
    if ctx.chunks.is_empty() {
        return String::new();
    }

    format_context_for_prompt(&ctx)
}

// ── Tauri commands ────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
pub struct AssembledContextResponse {
    pub chunks: Vec<ContextChunk>,
    pub total_tokens: usize,
    pub sources_used: Vec<String>,
    pub was_truncated: bool,
    pub formatted: String,
}

/// Get assembled context for a query, ready for display or injection.
#[tauri::command]
pub async fn context_assemble(
    query: String,
    max_tokens: Option<usize>,
    sources: Option<Vec<String>>,
) -> Result<AssembledContextResponse, String> {
    let budget = max_tokens.unwrap_or(2000);
    let src_refs: Vec<&str> = sources
        .as_deref()
        .unwrap_or(&[])
        .iter()
        .map(|s| s.as_str())
        .collect();

    let ctx = retrieve_relevant_chunks(&query, budget, &src_refs).await;
    let formatted = format_context_for_prompt(&ctx);

    Ok(AssembledContextResponse {
        chunks: ctx.chunks,
        total_tokens: ctx.total_tokens,
        sources_used: ctx.sources_used,
        was_truncated: ctx.was_truncated,
        formatted,
    })
}

/// Score a single chunk's relevance to a query (0.0–1.0).
#[tauri::command]
pub async fn context_score_chunk(query: String, chunk: String) -> Result<f32, String> {
    Ok(score_relevance(&query, &chunk).await)
}

/// Clear the in-process context cache.
#[tauri::command]
pub fn context_clear_cache() -> Result<(), String> {
    with_cache(|map| map.clear());
    Ok(())
}
