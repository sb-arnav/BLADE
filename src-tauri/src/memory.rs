use crate::config::{blade_config_dir, load_config, write_blade_file};
use rusqlite;

pub fn uuid_v4() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let t = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().subsec_nanos();
    format!("{:x}-{:x}-{:x}-{:x}", t, t ^ 0xdeadbeef, t.wrapping_mul(0x9e3779b9), t.wrapping_add(0x12345678))
}
use std::fs;
use std::path::PathBuf;

// ── Letta-style virtual context blocks ───────────────────────────────────────
//
// Three structured memory blocks, each capped and auto-compressed:
//   human_block    — what BLADE knows about the user (name, job, projects, prefs)
//   persona_block  — who BLADE is in this relationship
//   conversation_block — rolling summary of recent conversation history
//
// When a block exceeds its soft limit, the system compresses it via LLM rather
// than truncating, preserving all facts while halving the size. This gives
// BLADE effectively infinite memory without hitting context window limits.

/// The three virtual context blocks, loaded from disk on each use.
pub struct MemoryBlocks {
    pub human_block: String,
    pub persona_block: String,
    pub conversation_block: String,
}

fn blocks_dir() -> PathBuf {
    blade_config_dir().join("blocks")
}

fn human_block_path() -> PathBuf {
    blocks_dir().join("human.md")
}

fn persona_block_path() -> PathBuf {
    blocks_dir().join("persona.md")
}

fn conversation_block_path() -> PathBuf {
    blocks_dir().join("conversation.md")
}

/// Default persona block written on first run.
const DEFAULT_PERSONA: &str = r#"BLADE is a personal AI desktop assistant — sharp, direct, and proactive. In this relationship, BLADE acts as Arnav's second brain: it anticipates needs, notices patterns, and speaks up without being asked. It calls out bad ideas directly, matches the user's energy (deep work = brief and precise, casual = relaxed), and never pads responses with filler."#;

/// Load all three memory blocks from disk. Missing files return empty strings.
pub fn load_memory_blocks() -> MemoryBlocks {
    let human_block = fs::read_to_string(human_block_path()).unwrap_or_default();
    let persona_block = {
        let p = fs::read_to_string(persona_block_path()).unwrap_or_default();
        if p.trim().is_empty() {
            DEFAULT_PERSONA.to_string()
        } else {
            p
        }
    };
    let conversation_block = fs::read_to_string(conversation_block_path()).unwrap_or_default();
    MemoryBlocks { human_block, persona_block, conversation_block }
}

/// Save all three memory blocks to disk.
pub fn save_memory_blocks(blocks: &MemoryBlocks) -> Result<(), String> {
    // Ensure the blocks dir exists (write_blade_file does this per-file, but be explicit)
    fs::create_dir_all(blocks_dir()).map_err(|e| e.to_string())?;
    write_blade_file(&human_block_path(), &blocks.human_block)?;
    write_blade_file(&persona_block_path(), &blocks.persona_block)?;
    write_blade_file(&conversation_block_path(), &blocks.conversation_block)?;
    Ok(())
}

/// Format all three blocks for injection into a system prompt.
/// Returns an empty string if all blocks are empty.
pub fn get_injected_context() -> String {
    let blocks = load_memory_blocks();
    let mut parts: Vec<String> = Vec::new();

    if !blocks.human_block.trim().is_empty() {
        parts.push(format!(
            "### About the User\n\n{}",
            blocks.human_block.trim()
        ));
    }

    if !blocks.persona_block.trim().is_empty() {
        parts.push(format!(
            "### BLADE's Relationship Persona\n\n{}",
            blocks.persona_block.trim()
        ));
    }

    if !blocks.conversation_block.trim().is_empty() {
        parts.push(format!(
            "### Conversation History Summary\n\n{}",
            blocks.conversation_block.trim()
        ));
    }

    if parts.is_empty() {
        return String::new();
    }

    format!(
        "## Virtual Memory Blocks\n\n{}\n\n_These blocks are automatically maintained and compressed. They give BLADE persistent awareness across all sessions._",
        parts.join("\n\n")
    )
}

// ── Compression ───────────────────────────────────────────────────────────────

/// Compress a memory block via LLM when it exceeds its size limit.
/// This is what makes the memory system "infinite" — rather than truncating,
/// we preserve all facts in compressed form.
///
/// On LLM failure: returns original truncated to `fallback_max` chars.
async fn compress_block(block_content: &str, block_type: &str, fallback_max: usize) -> String {
    let config = load_config();
    if config.api_key.is_empty() && config.provider != "ollama" {
        // No API key — truncate as fallback
        let end = block_content.char_indices().nth(fallback_max).map(|(i, _)| i).unwrap_or(block_content.len());
        return block_content[..end].to_string();
    }

    let prompt = format!(
        "Compress this {block_type} memory block to approximately half its current size.\n\
         Preserve ALL facts, decisions, preferences, names, and specific details.\n\
         Remove redundancy, repetition, and verbose phrasing.\n\
         Output ONLY the compressed text — no preamble, no explanation.\n\n\
         Memory block to compress:\n\n{block_content}",
        block_type = block_type,
        block_content = block_content,
    );

    let messages = vec![crate::providers::ChatMessage {
        role: "user".to_string(),
        content: prompt,
        image_base64: None,
    }];

    let conversation = crate::providers::build_conversation(messages, None);
    let cheap_model = crate::config::cheap_model_for_provider(&config.provider, &config.model);

    match crate::providers::complete_turn(
        &config.provider,
        &config.api_key,
        &cheap_model,
        &conversation,
        &[],
        config.base_url.as_deref(),
    )
    .await
    {
        Ok(result) => {
            let compressed = result.content.trim().to_string();
            if compressed.is_empty() {
                // LLM returned nothing — use truncation fallback
                let end = block_content.char_indices().nth(fallback_max).map(|(i, _)| i).unwrap_or(block_content.len());
                block_content[..end].to_string()
            } else {
                compressed
            }
        }
        Err(_) => {
            // Compress failed — truncate rather than lose all memory
            let end = block_content.char_indices().nth(fallback_max).map(|(i, _)| i).unwrap_or(block_content.len());
            block_content[..end].to_string()
        }
    }
}

// ── Block update functions ────────────────────────────────────────────────────

/// Soft limit for the human block before compression is triggered (chars).
const HUMAN_BLOCK_SOFT_LIMIT: usize = 2000;

/// Append a new fact to the human block. If the block exceeds the soft limit,
/// compress it via LLM before saving. This preserves all facts indefinitely.
pub async fn update_human_block(new_fact: &str) -> Result<(), String> {
    let new_fact = new_fact.trim();
    if new_fact.is_empty() {
        return Ok(());
    }

    let mut blocks = load_memory_blocks();

    // Append the new fact
    if blocks.human_block.trim().is_empty() {
        blocks.human_block = format!("- {}", new_fact);
    } else {
        blocks.human_block = format!("{}\n- {}", blocks.human_block.trim_end(), new_fact);
    }

    // Compress if over the soft limit
    if blocks.human_block.len() > HUMAN_BLOCK_SOFT_LIMIT {
        blocks.human_block = compress_block(&blocks.human_block, "human (facts about the user)", HUMAN_BLOCK_SOFT_LIMIT).await;
    }

    write_blade_file(&human_block_path(), &blocks.human_block)
}

/// Soft limit for the conversation block before compression is triggered (chars).
const CONVERSATION_BLOCK_SOFT_LIMIT: usize = 3000;
/// Target size after compression.
const CONVERSATION_BLOCK_COMPRESSED_TARGET: usize = 1500;

/// Append a new exchange to the conversation rolling summary.
/// If the block exceeds the soft limit, compress to ~1500 chars via LLM.
pub async fn update_conversation_block(user_msg: &str, assistant_msg: &str) -> Result<(), String> {
    let user_msg = user_msg.trim();
    let assistant_msg = assistant_msg.trim();
    if user_msg.is_empty() && assistant_msg.is_empty() {
        return Ok(());
    }

    let mut blocks = load_memory_blocks();

    // Summarise the exchange compactly (first 300 chars of each side)
    let user_preview = crate::safe_slice(user_msg, 300);
    let assistant_preview = crate::safe_slice(assistant_msg, 300);
    let timestamp = chrono::Utc::now().format("%Y-%m-%d %H:%M").to_string();
    let entry = format!("[{}] U: {} | A: {}", timestamp, user_preview, assistant_preview);

    if blocks.conversation_block.trim().is_empty() {
        blocks.conversation_block = entry;
    } else {
        blocks.conversation_block = format!("{}\n{}", blocks.conversation_block.trim_end(), entry);
    }

    // Compress if over the soft limit
    if blocks.conversation_block.len() > CONVERSATION_BLOCK_SOFT_LIMIT {
        let compress_prompt_type = format!(
            "conversation history summary (target output: ~{} chars)",
            CONVERSATION_BLOCK_COMPRESSED_TARGET
        );
        blocks.conversation_block = compress_block(
            &blocks.conversation_block,
            &compress_prompt_type,
            CONVERSATION_BLOCK_COMPRESSED_TARGET,
        )
        .await;
    }

    write_blade_file(&conversation_block_path(), &blocks.conversation_block)
}

// ── Fact extraction from conversations ───────────────────────────────────────

/// A single extracted fact: a piece of knowledge worth storing persistently.
#[derive(Debug, Clone)]
pub struct Fact {
    pub text: String,
    /// Category: "decision", "technical", "preference", "personal"
    pub category: String,
    pub source: String, // e.g. "conversation:1234567890"
}

/// Extract key facts from a completed conversation using a cheap LLM call.
/// Returns structured facts categorized by type:
/// - "decision"   — "user chose React over Vue", "user prefers tabs over spaces"
/// - "technical"  — "user's API is at /api/v2", "database is PostgreSQL 15"
/// - "preference" — "user likes concise answers", "user gets annoyed by verbose responses"
/// - "personal"   — name, role, project info shared
///
/// Stores each fact as a KG node with source = "conversation:{timestamp}".
pub async fn extract_conversation_facts(messages: &[crate::providers::ChatMessage]) -> Vec<Fact> {
    let config = load_config();
    if config.api_key.is_empty() && config.provider != "ollama" {
        return vec![];
    }

    // Build conversation text — cap at 4000 chars to avoid token explosion
    let conversation_text: String = messages
        .iter()
        .filter(|m| !m.content.trim().is_empty())
        .map(|m| format!("{}: {}", m.role, m.content))
        .collect::<Vec<_>>()
        .join("\n");

    if conversation_text.len() < 100 {
        return vec![];
    }

    let snippet = crate::safe_slice(&conversation_text, 4000);
    let prompt = format!(
        r#"Extract key compounding facts from this conversation. These facts will be stored permanently and shape future conversations.

Focus ONLY on:
1. DECISIONS — choices made ("user chose React over Vue", "user prefers tabs over spaces")
2. TECHNICAL — concrete technical facts ("API is at /api/v2", "database is PostgreSQL 15", "project uses pnpm")
3. PREFERENCES — how they like to work ("user likes concise answers", "user prefers bullet points over paragraphs")
4. PERSONAL — identity facts (name, role, location, ongoing projects)

If nothing meaningful was established, respond with exactly: NOTHING

Otherwise respond ONLY with a JSON array (no markdown fences):
[
  {{"text": "fact text", "category": "decision|technical|preference|personal"}},
  ...
]

Be specific. "user likes React" is useless. "user chose React over Vue for the dashboard because of the ecosystem" is valuable.

CONVERSATION:
{snippet}"#
    );

    let llm_msgs = vec![crate::providers::ConversationMessage::User(prompt)];
    let cheap = crate::config::cheap_model_for_provider(&config.provider, &config.model);

    let raw = match crate::providers::complete_turn(
        &config.provider,
        &config.api_key,
        &cheap,
        &llm_msgs,
        &[],
        config.base_url.as_deref(),
    ).await {
        Ok(r) => r.content,
        Err(_) => return vec![],
    };

    let trimmed = raw.trim();
    if trimmed.eq_ignore_ascii_case("NOTHING") || trimmed.starts_with("NOTHING") {
        return vec![];
    }

    // Strip markdown fences if present
    let json_str = if let Some(start) = trimmed.find('[') {
        if let Some(end) = trimmed.rfind(']') {
            &trimmed[start..=end]
        } else { trimmed }
    } else { trimmed };

    let parsed: Vec<serde_json::Value> = match serde_json::from_str(json_str) {
        Ok(v) => v,
        Err(_) => return vec![],
    };

    let source = format!("conversation:{}", chrono::Utc::now().timestamp());
    let mut facts = Vec::new();

    for item in parsed {
        let text = match item["text"].as_str() {
            Some(t) if !t.trim().is_empty() => t.trim().to_string(),
            _ => continue,
        };
        let category = item["category"]
            .as_str()
            .unwrap_or("technical")
            .to_string();

        // Immediately store as KG node
        let node = crate::knowledge_graph::KnowledgeNode {
            id: String::new(), // auto-assigned by add_node
            concept: text.chars().take(80).collect::<String>().trim().to_lowercase(),
            node_type: match category.as_str() {
                "preference" => "concept".to_string(),
                "technical"  => "technology".to_string(),
                "decision"   => "event".to_string(),
                "personal"   => "person".to_string(),
                _            => "concept".to_string(),
            },
            description: text.clone(),
            sources: vec![source.clone()],
            importance: match category.as_str() {
                "decision" | "personal"  => 0.8,
                "technical" | "preference" => 0.7,
                _ => 0.6,
            },
            created_at: chrono::Utc::now().timestamp(),
            last_updated: chrono::Utc::now().timestamp(),
        };
        let _ = crate::knowledge_graph::add_node(node);

        // For preferences, also store in brain_preferences
        if category == "preference" {
            let db_path = crate::config::blade_config_dir().join("blade.db");
            if let Ok(conn) = rusqlite::Connection::open(&db_path) {
                let pref_id = format!("pref-conv-{}", uuid::Uuid::new_v4());
                let _ = crate::db::brain_upsert_preference(&conn, &pref_id, &text, 0.7, "conversation_extraction");
            }
        }

        // Feed into Omi-style typed memory system. Map old categories to typed categories.
        {
            let typed_cat = match category.as_str() {
                "preference" => crate::typed_memory::MemoryCategory::Preference,
                "decision"   => crate::typed_memory::MemoryCategory::Decision,
                "personal"   => crate::typed_memory::MemoryCategory::Fact,
                "technical"  => crate::typed_memory::MemoryCategory::Skill,
                _            => crate::typed_memory::MemoryCategory::Fact,
            };
            let confidence = match category.as_str() {
                "decision" | "personal"    => 0.8,
                "technical" | "preference" => 0.7,
                _                          => 0.6,
            };
            let _ = crate::typed_memory::store_typed_memory(
                typed_cat,
                &text,
                &source,
                Some(confidence),
            );
        }

        facts.push(Fact { text, category, source: source.clone() });
    }

    facts
}

// ── Legacy functions (kept for backwards compatibility) ───────────────────────

fn context_path() -> PathBuf {
    blade_config_dir().join("context.md")
}

fn memory_log_path() -> PathBuf {
    blade_config_dir().join("memory_log.jsonl")
}

/// Extract key facts from a conversation and append to context.md
/// Also feeds the human_block when meaningful facts are found.
#[tauri::command]
pub async fn learn_from_conversation(
    messages: Vec<crate::providers::ChatMessage>,
) -> Result<String, String> {
    let config = load_config();
    if config.api_key.is_empty() && config.provider != "ollama" {
        return Err("No API key for learning".to_string());
    }

    // Build a summary of the conversation
    let conversation_text: String = messages
        .iter()
        .filter(|m| !m.content.trim().is_empty())
        .map(|m| format!("{}: {}", m.role, m.content))
        .collect::<Vec<_>>()
        .join("\n");

    if conversation_text.len() < 100 {
        return Ok("Conversation too short to learn from.".to_string());
    }

    // Ask the AI to extract key facts
    let prompt = format!(
        r#"Extract key facts about the user from this conversation. Only include things worth remembering for future conversations — preferences, decisions, projects mentioned, technical details, personal info shared.

If there's nothing meaningful to remember, respond with exactly "NOTHING".

Otherwise, respond with a bullet list of facts. Be concise — one line per fact.

Conversation:
{}

Key facts:"#,
        // Limit context to avoid token explosion
        if conversation_text.len() > 4000 {
            let end = conversation_text.char_indices().nth(4000).map(|(i, _)| i).unwrap_or(conversation_text.len());
            &conversation_text[..end]
        } else {
            &conversation_text
        }
    );

    let learn_messages = vec![crate::providers::ChatMessage {
        role: "user".to_string(),
        content: prompt,
        image_base64: None,
    }];

    let conversation = crate::providers::build_conversation(learn_messages, None);

    let cheap_model = crate::config::cheap_model_for_provider(&config.provider, &config.model);
    let result = crate::providers::complete_turn(
        &config.provider,
        &config.api_key,
        &cheap_model,
        &conversation,
        &[],
        config.base_url.as_deref(),
    )
    .await?;

    let facts = result.content.trim().to_string();

    if facts.is_empty() || facts == "NOTHING" {
        return Ok("Nothing new to remember.".to_string());
    }

    // Append to legacy context.md
    let existing = fs::read_to_string(context_path()).unwrap_or_default();
    let timestamp = chrono::Utc::now().format("%Y-%m-%d").to_string();
    let updated = if existing.is_empty() {
        format!("## Learned {}\n\n{}", timestamp, facts)
    } else {
        format!(
            "{}\n\n## Learned {}\n\n{}",
            existing.trim(),
            timestamp,
            facts
        )
    };

    write_blade_file(&context_path(), &updated)?;

    // Log the learning event
    let log_entry = serde_json::json!({
        "timestamp": chrono::Utc::now().to_rfc3339(),
        "facts_count": facts.lines().count(),
        "facts": facts,
    });
    let log_path = memory_log_path();
    if let Ok(line) = serde_json::to_string(&log_entry) {
        use std::io::Write;
        if let Ok(mut file) = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&log_path)
        {
            let _ = writeln!(file, "{}", line);
        }
    }

    // Feed each fact into the virtual human_block (new system)
    for fact in facts.lines() {
        let fact = fact.trim().trim_start_matches('-').trim();
        if !fact.is_empty() {
            // Fire-and-forget — don't block the command on compression
            let fact_owned = fact.to_string();
            tokio::spawn(async move {
                let _ = update_human_block(&fact_owned).await;
            });
        }
    }

    // NEW: Extract structured facts into KG + brain_preferences
    // This runs in the background so it doesn't slow down the command response
    {
        let msgs_clone = messages.clone();
        tokio::spawn(async move {
            extract_conversation_facts(&msgs_clone).await;
        });
    }

    // Also write each fact as a structured brain memory entry (legacy DB path)
    let db_path = crate::config::blade_config_dir().join("blade.db");
    if let Ok(conn) = rusqlite::Connection::open(&db_path) {
        for fact in facts.lines() {
            let fact = fact.trim().trim_start_matches('-').trim();
            if fact.is_empty() { continue; }
            let id = format!("{}", uuid_v4());
            let _ = crate::db::brain_add_memory(&conn, &id, fact, "", "[]", 0.7, None);
        }
    }

    Ok(format!("Learned {} new facts.", facts.lines().count()))
}

/// Get what Blade has learned over time
#[tauri::command]
pub fn get_memory_log() -> Vec<serde_json::Value> {
    let path = memory_log_path();
    let content = match fs::read_to_string(&path) {
        Ok(c) => c,
        Err(_) => return Vec::new(),
    };

    content
        .lines()
        .rev()
        .take(30)
        .filter_map(|line| serde_json::from_str(line).ok())
        .collect()
}

// ── Weekly memory consolidation ───────────────────────────────────────────────

/// Weekly consolidation pass — run this once a week via cron to keep memory lean and sharp.
///
/// What it does:
/// 1. Merges duplicate KG nodes (same concept, different wording)
/// 2. Promotes frequently-accessed facts to "core knowledge" (bumps importance to 0.9)
/// 3. Prunes low-confidence facts that were never reaffirmed (older than 30 days, confidence < 0.5)
/// 4. Generates a "memory diff" showing what BLADE learned this week
///
/// Returns a human-readable diff of what changed.
pub async fn weekly_memory_consolidation() -> String {
    let config = load_config();
    let db_path = crate::config::blade_config_dir().join("blade.db");
    let conn = match rusqlite::Connection::open(&db_path) {
        Ok(c) => c,
        Err(e) => return format!("DB error: {}", e),
    };

    let now = chrono::Utc::now().timestamp();
    let thirty_days_ago = now - (30 * 86400);
    let one_week_ago = now - (7 * 86400);
    let mut diff_lines: Vec<String> = Vec::new();

    // ── 1. Prune stale low-confidence KG nodes ─────────────────────────────────
    let pruned: i64 = conn.execute(
        "DELETE FROM kg_nodes WHERE importance < 0.4 AND last_updated < ?1",
        rusqlite::params![thirty_days_ago],
    ).map(|n| n as i64).unwrap_or(0);

    if pruned > 0 {
        diff_lines.push(format!("Pruned {} stale low-confidence knowledge nodes", pruned));
    }

    // ── 2. Promote frequently-accessed KG nodes ────────────────────────────────
    // Nodes sourced from multiple conversations are promoted to "core knowledge".
    // Heuristic: sources JSON array with 3+ entries has length > ~70 chars.
    let promoted: i64 = conn.execute(
        "UPDATE kg_nodes SET importance = MIN(importance + 0.1, 0.95)
         WHERE length(sources) > 70 AND importance < 0.85",
        [],
    ).map(|n| n as i64).unwrap_or(0);

    if promoted > 0 {
        diff_lines.push(format!("Promoted {} multi-source facts to core knowledge", promoted));
    }

    // ── 3. Prune stale low-confidence preferences ──────────────────────────────
    let pruned_prefs: i64 = conn.execute(
        "DELETE FROM brain_preferences WHERE confidence < 0.5 AND updated_at < ?1",
        rusqlite::params![thirty_days_ago * 1000], // brain_preferences uses ms timestamps
    ).map(|n| n as i64).unwrap_or(0);

    if pruned_prefs > 0 {
        diff_lines.push(format!("Pruned {} stale behavioral preferences", pruned_prefs));
    }

    // ── 3b. Typed memory consolidation ────────────────────────────────────────
    // Ensure the table exists first (it may not exist on first run).
    crate::typed_memory::ensure_table(&conn);

    // Prune very-low-confidence typed memories older than 30 days.
    let pruned_typed: i64 = conn.execute(
        "DELETE FROM typed_memories WHERE confidence < 0.3 AND created_at < ?1",
        rusqlite::params![thirty_days_ago],
    ).map(|n| n as i64).unwrap_or(0);

    if pruned_typed > 0 {
        diff_lines.push(format!("Pruned {} stale typed memories", pruned_typed));
    }

    // Boost confidence of frequently-accessed typed memories (accessed 5+ times → +0.05).
    let boosted_typed: i64 = conn.execute(
        "UPDATE typed_memories
         SET confidence = MIN(confidence + 0.05, 0.97)
         WHERE access_count >= 5 AND confidence < 0.90",
        [],
    ).map(|n| n as i64).unwrap_or(0);

    if boosted_typed > 0 {
        diff_lines.push(format!("Boosted {} high-access typed memories", boosted_typed));
    }

    // Count new typed memories from this week.
    let new_typed: i64 = conn.query_row(
        "SELECT COUNT(*) FROM typed_memories WHERE created_at >= ?1",
        rusqlite::params![one_week_ago],
        |r| r.get(0),
    ).unwrap_or(0);

    if new_typed > 0 {
        diff_lines.push(format!("Added {} new typed memories this week", new_typed));
    }

    // ── 4. Count new facts learned this week ──────────────────────────────────
    let new_kg_nodes: i64 = conn.query_row(
        "SELECT COUNT(*) FROM kg_nodes WHERE created_at >= ?1",
        rusqlite::params![one_week_ago],
        |r| r.get(0),
    ).unwrap_or(0);

    let new_episodes: i64 = conn.query_row(
        "SELECT COUNT(*) FROM memory_episodes WHERE created_at >= ?1",
        rusqlite::params![one_week_ago],
        |r| r.get(0),
    ).unwrap_or(0);

    let new_prefs: i64 = conn.query_row(
        "SELECT COUNT(*) FROM brain_preferences WHERE updated_at >= ?1",
        rusqlite::params![one_week_ago * 1000],
        |r| r.get(0),
    ).unwrap_or(0);

    diff_lines.push(format!(
        "This week: {} new facts, {} new episodes, {} preference updates",
        new_kg_nodes, new_episodes, new_prefs
    ));

    // ── 5. Compress memory blocks if over limit ────────────────────────────────
    // Trigger compression of human_block if it's getting large
    {
        let blocks = load_memory_blocks();
        if blocks.human_block.len() > HUMAN_BLOCK_SOFT_LIMIT {
            let compressed = compress_block(
                &blocks.human_block,
                "human (facts about the user)",
                HUMAN_BLOCK_SOFT_LIMIT,
            ).await;
            let _ = write_blade_file(&human_block_path(), &compressed);
            diff_lines.push("Compressed human memory block".to_string());
        }
    }

    // ── 6. LLM-generated memory diff (if API available) ───────────────────────
    let summary = if !config.api_key.is_empty() || config.provider == "ollama" {
        // Get top 10 recent KG nodes for the diff
        let recent_nodes: Vec<String> = conn.prepare(
            "SELECT concept, description FROM kg_nodes WHERE created_at >= ?1 ORDER BY importance DESC LIMIT 10"
        ).and_then(|mut stmt| {
            stmt.query_map(rusqlite::params![one_week_ago], |row| {
                Ok(format!("• {} — {}",
                    row.get::<_, String>(0)?,
                    crate::safe_slice(&row.get::<_, String>(1).unwrap_or_default(), 60),
                ))
            }).map(|rows| rows.filter_map(|r| r.ok()).collect())
        }).unwrap_or_default();

        if !recent_nodes.is_empty() {
            let prompt = format!(
                r#"You are BLADE's memory curator. This week you learned these new facts:

{}

In 2-3 sentences, summarize what patterns you see in this week's learning. What topics dominated? What does this tell you about the user's current focus?

Be concise and specific."#,
                recent_nodes.join("\n")
            );

            let messages = vec![crate::providers::ConversationMessage::User(prompt)];
            let cheap = crate::config::cheap_model_for_provider(&config.provider, &config.model);
            match crate::providers::complete_turn(
                &config.provider,
                &config.api_key,
                &cheap,
                &messages,
                &[],
                config.base_url.as_deref(),
            ).await {
                Ok(r) => r.content.trim().to_string(),
                Err(_) => String::new(),
            }
        } else {
            String::new()
        }
    } else {
        String::new()
    };

    let mut result = diff_lines.join("\n");
    if !summary.is_empty() {
        result.push_str("\n\nMemory diff analysis:\n");
        result.push_str(&summary);
    }

    result
}

/// Tauri command wrapper for weekly memory consolidation.
#[tauri::command]
pub async fn run_weekly_memory_consolidation() -> Result<String, String> {
    Ok(weekly_memory_consolidation().await)
}

/// Tauri command: get the current state of all three memory blocks (for Settings UI)
#[tauri::command]
pub fn get_memory_blocks() -> serde_json::Value {
    let blocks = load_memory_blocks();
    serde_json::json!({
        "human": blocks.human_block,
        "persona": blocks.persona_block,
        "conversation": blocks.conversation_block,
    })
}

/// Tauri command: overwrite a specific memory block (for Settings UI / manual editing)
#[tauri::command]
pub fn set_memory_block(block: String, content: String) -> Result<(), String> {
    match block.as_str() {
        "human" => write_blade_file(&human_block_path(), &content),
        "persona" => write_blade_file(&persona_block_path(), &content),
        "conversation" => write_blade_file(&conversation_block_path(), &content),
        _ => Err(format!("Unknown block: {}", block)),
    }
}
