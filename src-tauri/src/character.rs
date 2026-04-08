use crate::config::{blade_config_dir, load_config, write_blade_file};
use crate::providers::{self, ChatMessage};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CharacterBible {
    pub identity: String,
    pub preferences: String,
    pub projects: String,
    pub skills: String,
    pub contacts: String,
    pub notes: String,
    pub last_updated: String,
}

fn bible_path() -> PathBuf {
    blade_config_dir().join("character_bible.json")
}

fn context_path() -> PathBuf {
    blade_config_dir().join("context.md")
}

pub fn load_bible() -> CharacterBible {
    let path = bible_path();
    match fs::read_to_string(&path) {
        Ok(data) => serde_json::from_str(&data).unwrap_or_default(),
        Err(_) => CharacterBible::default(),
    }
}

fn save_bible(bible: &CharacterBible) -> Result<(), String> {
    let path = bible_path();
    let data = serde_json::to_string_pretty(bible).map_err(|e| e.to_string())?;
    write_blade_file(&path, &data)
}

/// Periodically consolidate raw context.md into structured Character Bible
#[tauri::command]
pub async fn consolidate_character() -> Result<String, String> {
    let config = load_config();
    if config.api_key.is_empty() && config.provider != "ollama" {
        return Err("No API key for consolidation".to_string());
    }

    let raw_context = fs::read_to_string(context_path()).unwrap_or_default();
    if raw_context.trim().is_empty() {
        return Ok("No context to consolidate.".to_string());
    }

    let existing_bible = load_bible();
    let existing_json =
        serde_json::to_string_pretty(&existing_bible).unwrap_or_else(|_| "{}".to_string());

    let prompt = format!(
        r#"You maintain a structured Character Bible about a user based on raw notes.

Current Character Bible:
{}

New raw context to incorporate:
{}

Update the Character Bible by merging new information into the correct sections. Remove duplicates. Keep facts concise. If information conflicts, prefer the newer version.

Respond with ONLY a JSON object with these exact fields:
- "identity": who they are (name, age, role, location)
- "preferences": how they like to work (tools, style, schedule)
- "projects": what they're building (active projects, status)
- "skills": technical skills and expertise
- "contacts": people they work with
- "notes": anything else worth remembering

Each field is a string with bullet points. Keep each section under 10 bullet points."#,
        existing_json, raw_context
    );

    let messages = vec![ChatMessage {
        role: "user".to_string(),
        content: prompt,
        image_base64: None,
    }];
    let conversation = providers::build_conversation(messages, None);

    let turn =
        providers::complete_turn(&config.provider, &config.api_key, &config.model, &conversation, &[])
            .await?;

    // Parse response
    let content = turn.content.trim();
    let json_str = if let Some(start) = content.find('{') {
        if let Some(end) = content.rfind('}') {
            &content[start..=end]
        } else {
            content
        }
    } else {
        content
    };

    let mut bible: CharacterBible =
        serde_json::from_str(json_str).map_err(|e| format!("Failed to parse bible: {}", e))?;

    bible.last_updated = chrono::Utc::now().to_rfc3339();
    save_bible(&bible)?;

    // Clear raw context since it's been consolidated
    write_blade_file(&context_path(), "")?;

    Ok(format!(
        "Character Bible updated. {} sections refreshed.",
        6
    ))
}

#[tauri::command]
pub fn get_character_bible() -> CharacterBible {
    load_bible()
}

#[tauri::command]
pub fn update_character_section(section: String, content: String) -> Result<(), String> {
    let mut bible = load_bible();
    match section.as_str() {
        "identity" => bible.identity = content,
        "preferences" => bible.preferences = content,
        "projects" => bible.projects = content,
        "skills" => bible.skills = content,
        "contacts" => bible.contacts = content,
        "notes" => bible.notes = content,
        _ => return Err(format!("Unknown section: {}", section)),
    }
    bible.last_updated = chrono::Utc::now().to_rfc3339();
    save_bible(&bible)
}

/// Generate a summary string from the Character Bible for the system prompt
pub fn bible_summary() -> Option<String> {
    let bible = load_bible();
    let mut sections = Vec::new();

    if !bible.identity.is_empty() {
        sections.push(format!("Identity:\n{}", bible.identity));
    }
    if !bible.preferences.is_empty() {
        sections.push(format!("Preferences:\n{}", bible.preferences));
    }
    if !bible.projects.is_empty() {
        sections.push(format!("Projects:\n{}", bible.projects));
    }
    if !bible.skills.is_empty() {
        sections.push(format!("Skills:\n{}", bible.skills));
    }

    if sections.is_empty() {
        None
    } else {
        Some(sections.join("\n\n"))
    }
}
