use crate::config::blade_config_dir;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HistoryMessage {
    pub id: String,
    pub role: String,
    pub content: String,
    pub timestamp: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConversationSummary {
    pub id: String,
    pub title: String,
    pub created_at: u64,
    pub updated_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredConversation {
    pub id: String,
    pub title: String,
    pub created_at: u64,
    pub updated_at: u64,
    pub messages: Vec<HistoryMessage>,
}

fn history_dir() -> PathBuf {
    let dir = blade_config_dir().join("history");
    fs::create_dir_all(&dir).ok();
    dir
}

fn conversation_path(conversation_id: &str) -> PathBuf {
    history_dir().join(format!("{}.json", conversation_id))
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

fn title_from_messages(messages: &[HistoryMessage]) -> String {
    let title = messages
        .iter()
        .find(|message| message.role == "user" && !message.content.trim().is_empty())
        .map(|message| message.content.trim().replace('\n', " "))
        .unwrap_or_else(|| "New chat".to_string());

    title.chars().take(48).collect()
}

pub fn list_conversations() -> Result<Vec<ConversationSummary>, String> {
    let mut conversations = Vec::new();

    for entry in fs::read_dir(history_dir()).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if path.extension().and_then(|ext| ext.to_str()) != Some("json") {
            continue;
        }

        let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        let conversation =
            serde_json::from_str::<StoredConversation>(&raw).map_err(|e| e.to_string())?;

        conversations.push(ConversationSummary {
            id: conversation.id,
            title: conversation.title,
            created_at: conversation.created_at,
            updated_at: conversation.updated_at,
        });
    }

    conversations.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    Ok(conversations)
}

pub fn load_conversation(conversation_id: &str) -> Result<StoredConversation, String> {
    let path = conversation_path(conversation_id);
    let raw = fs::read_to_string(path).map_err(|e| e.to_string())?;
    serde_json::from_str(&raw).map_err(|e| e.to_string())
}

pub fn save_conversation(
    conversation_id: &str,
    messages: Vec<HistoryMessage>,
) -> Result<ConversationSummary, String> {
    let path = conversation_path(conversation_id);
    let existing = if path.exists() {
        load_conversation(conversation_id).ok()
    } else {
        None
    };

    let created_at = existing
        .as_ref()
        .map(|conversation| conversation.created_at)
        .unwrap_or_else(now_ms);
    let updated_at = now_ms();
    let title = title_from_messages(&messages);

    let conversation = StoredConversation {
        id: conversation_id.to_string(),
        title: title.clone(),
        created_at,
        updated_at,
        messages,
    };

    let raw = serde_json::to_string_pretty(&conversation).map_err(|e| e.to_string())?;
    fs::write(path, raw).map_err(|e| e.to_string())?;

    Ok(ConversationSummary {
        id: conversation.id,
        title,
        created_at,
        updated_at,
    })
}
