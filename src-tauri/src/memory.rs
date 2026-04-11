use crate::config::{blade_config_dir, load_config, write_blade_file};
use rusqlite;

pub fn uuid_v4() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let t = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().subsec_nanos();
    format!("{:x}-{:x}-{:x}-{:x}", t, t ^ 0xdeadbeef, t.wrapping_mul(0x9e3779b9), t.wrapping_add(0x12345678))
}
use std::fs;
use std::path::PathBuf;

fn context_path() -> PathBuf {
    blade_config_dir().join("context.md")
}

fn memory_log_path() -> PathBuf {
    blade_config_dir().join("memory_log.jsonl")
}

/// Extract key facts from a conversation and append to context.md
/// Called by frontend when a conversation ends or on demand
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
            &conversation_text[..4000]
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

    let result = crate::providers::complete_turn(
        &config.provider,
        &config.api_key,
        &config.model,
        &conversation,
        &[],
        None,
    )
    .await?;

    let facts = result.content.trim().to_string();

    if facts.is_empty() || facts == "NOTHING" {
        return Ok("Nothing new to remember.".to_string());
    }

    // Append to context.md
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

    // Also write each fact as a structured brain memory entry
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
