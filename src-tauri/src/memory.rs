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
