/// BLADE People Graph — knows the people in your life and how to talk to each of them differently.
///
/// Auto-learns from conversations. Fuzzy-matches names. Injects relationship context into prompts.
/// Stored in blade.db `people` table. Each day BLADE uses this more accurately than the last.

use rusqlite::params;
use serde::{Deserialize, Serialize};

// ── Types ─────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Person {
    pub id: String,
    pub name: String,
    pub relationship: String,     // "manager", "friend", "client", "teammate"
    pub communication_style: String, // "formal", "casual", "technical", "brief"
    pub platform: String,         // "slack", "email", "whatsapp", "in-person"
    pub topics: Vec<String>,      // what you talk about with them
    pub last_interaction: i64,
    pub interaction_count: u32,
    pub notes: String,            // "always asks about the demo deadline"
}

impl Default for Person {
    fn default() -> Self {
        Self {
            id: String::new(),
            name: String::new(),
            relationship: "unknown".to_string(),
            communication_style: "casual".to_string(),
            platform: "unknown".to_string(),
            topics: Vec::new(),
            last_interaction: 0,
            interaction_count: 0,
            notes: String::new(),
        }
    }
}

// ── DB helpers ────────────────────────────────────────────────────────────────

fn db_path() -> std::path::PathBuf {
    crate::config::blade_config_dir().join("blade.db")
}

fn open_db() -> Option<rusqlite::Connection> {
    rusqlite::Connection::open(db_path()).ok()
}

pub fn ensure_tables() {
    if let Some(conn) = open_db() {
        let _ = conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS people (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                relationship TEXT NOT NULL DEFAULT 'unknown',
                communication_style TEXT NOT NULL DEFAULT 'casual',
                platform TEXT NOT NULL DEFAULT 'unknown',
                topics TEXT NOT NULL DEFAULT '[]',
                last_interaction INTEGER NOT NULL DEFAULT 0,
                interaction_count INTEGER NOT NULL DEFAULT 0,
                notes TEXT NOT NULL DEFAULT ''
            );
            CREATE INDEX IF NOT EXISTS idx_people_name ON people(name COLLATE NOCASE);",
        );
    }
}

// ── Core functions ────────────────────────────────────────────────────────────

/// Fuzzy name match — returns the person whose name most closely matches the query.
pub fn get_person(name: &str) -> Option<Person> {
    let conn = open_db()?;
    let name_lower = name.to_lowercase();

    // Exact match first
    let row = conn.query_row(
        "SELECT id,name,relationship,communication_style,platform,topics,last_interaction,interaction_count,notes
         FROM people WHERE lower(name) = ?1 LIMIT 1",
        params![name_lower],
        |row| parse_person_row(row),
    ).ok();

    if row.is_some() {
        return row;
    }

    // Prefix/contains match
    let pattern = format!("%{}%", name_lower);
    let row = conn.query_row(
        "SELECT id,name,relationship,communication_style,platform,topics,last_interaction,interaction_count,notes
         FROM people WHERE lower(name) LIKE ?1 ORDER BY interaction_count DESC LIMIT 1",
        params![pattern],
        |row| parse_person_row(row),
    ).ok();

    row
}

fn parse_person_row(row: &rusqlite::Row) -> rusqlite::Result<Person> {
    let topics_json: String = row.get(5)?;
    let topics: Vec<String> = serde_json::from_str(&topics_json).unwrap_or_default();
    Ok(Person {
        id: row.get(0)?,
        name: row.get(1)?,
        relationship: row.get(2)?,
        communication_style: row.get(3)?,
        platform: row.get(4)?,
        topics,
        last_interaction: row.get(6)?,
        interaction_count: row.get(7)?,
        notes: row.get(8)?,
    })
}

/// Upsert a person. If a person with the same name (case-insensitive) already exists, update.
pub fn upsert_person(person: &Person) -> Result<(), String> {
    let conn = open_db().ok_or("DB unavailable")?;
    let topics_json = serde_json::to_string(&person.topics).unwrap_or_else(|_| "[]".to_string());

    conn.execute(
        "INSERT INTO people (id,name,relationship,communication_style,platform,topics,last_interaction,interaction_count,notes)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)
         ON CONFLICT(id) DO UPDATE SET
           relationship = excluded.relationship,
           communication_style = excluded.communication_style,
           platform = CASE WHEN excluded.platform != 'unknown' THEN excluded.platform ELSE people.platform END,
           topics = excluded.topics,
           last_interaction = MAX(people.last_interaction, excluded.last_interaction),
           interaction_count = people.interaction_count + 1,
           notes = CASE WHEN excluded.notes != '' THEN excluded.notes ELSE people.notes END",
        params![
            person.id,
            person.name,
            person.relationship,
            person.communication_style,
            person.platform,
            topics_json,
            person.last_interaction,
            person.interaction_count,
            person.notes,
        ],
    ).map_err(|e| format!("DB error: {}", e))?;

    Ok(())
}

/// Return a prompt snippet guiding BLADE on how to interact with a specific person.
pub fn suggest_reply_style(person_name: &str) -> String {
    match get_person(person_name) {
        None => String::new(),
        Some(p) => {
            let relationship_hint = match p.relationship.as_str() {
                "manager" => "They are your manager. Be professional, concise, and always include a clear status update or action item.",
                "client" => "They are a client. Be polished, confident, and outcome-focused. Avoid internal jargon.",
                "teammate" | "coworker" => "They are a teammate. Friendly but focused. Get to the point — they know the context.",
                "friend" => "They are a friend. Be yourself. Casual, direct, maybe a little playful.",
                "mentor" => "They are a mentor. Be thoughtful and show you've thought it through. Ask focused questions.",
                "report" | "direct_report" => "They report to you. Be clear, supportive, and action-oriented. Set expectations explicitly.",
                _ => "Keep your tone natural and context-appropriate.",
            };

            let style_hint = match p.communication_style.as_str() {
                "formal" => "Use formal language — complete sentences, no slang, professional sign-off.",
                "technical" => "Technical depth is fine. Use precise terminology, code snippets if helpful.",
                "brief" => "Keep it short. They prefer 1-2 sentences max. No preamble.",
                "casual" | _ => "Casual and direct. No need for formalities.",
            };

            let platform_hint = match p.platform.as_str() {
                "email" => "This is email. Subject line matters. Keep body scannable.",
                "slack" => "This is Slack. Short messages. Threads for detail. Use @mentions sparingly.",
                "whatsapp" => "This is WhatsApp. Conversational. Voice notes also fine.",
                _ => "",
            };

            let topics_hint = if !p.topics.is_empty() {
                format!("Recurring topics with them: {}.", p.topics.join(", "))
            } else {
                String::new()
            };

            let notes_hint = if !p.notes.is_empty() {
                format!("Context note: {}", p.notes)
            } else {
                String::new()
            };

            let parts: Vec<&str> = [
                relationship_hint,
                style_hint,
                platform_hint,
                topics_hint.as_str(),
                notes_hint.as_str(),
            ]
            .iter()
            .filter(|s| !s.is_empty())
            .copied()
            .collect();

            parts.join(" ")
        }
    }
}

/// Build a people-context block for injection into the system prompt.
/// Called by brain.rs when mentioned names are detected.
pub fn get_people_context_for_prompt(mentioned_names: &[String]) -> String {
    if mentioned_names.is_empty() {
        return String::new();
    }

    let mut blocks: Vec<String> = Vec::new();

    for name in mentioned_names {
        if let Some(person) = get_person(name) {
            let mut parts = vec![
                format!("- **{}** ({})", person.name, person.relationship),
            ];
            if !person.communication_style.is_empty() {
                parts.push(format!("  Style: {}", person.communication_style));
            }
            if !person.platform.is_empty() && person.platform != "unknown" {
                parts.push(format!("  Platform: {}", person.platform));
            }
            if !person.topics.is_empty() {
                parts.push(format!("  Topics: {}", person.topics.join(", ")));
            }
            if !person.notes.is_empty() {
                parts.push(format!("  Note: {}", person.notes));
            }
            blocks.push(parts.join("\n"));
        }
    }

    if blocks.is_empty() {
        return String::new();
    }

    format!("## People Context\n{}", blocks.join("\n"))
}

/// Auto-extract people mentions from a conversation and update the people graph.
/// Called after significant conversations to keep the graph alive.
pub async fn learn_person_from_conversation(
    messages: &[crate::history::HistoryMessage],
    platform: &str,
) {
    ensure_tables();

    // Build a compact conversation text for the LLM to analyze
    let conversation_text: String = messages
        .iter()
        .take(30)
        .map(|m| format!("[{}] {}", m.role, crate::safe_slice(&m.content, 200)))
        .collect::<Vec<_>>()
        .join("\n");

    if conversation_text.len() < 50 {
        return;
    }

    let config = crate::config::load_config();
    if config.api_key.is_empty() && config.provider != "ollama" {
        return;
    }

    let prompt = format!(
        r#"Analyze this conversation and extract any people mentioned (other than the user themselves).

Conversation:
{conversation}

For each person found, return a JSON array. Each element must have:
- name: their name or identifier
- relationship: one of manager/friend/client/teammate/mentor/report/unknown
- communication_style: one of formal/casual/technical/brief
- platform: {platform} (or unknown if unclear)
- topics: array of topics discussed with them (max 3)
- notes: one short sentence about anything notable (or empty string)

Return ONLY the JSON array, no markdown, no explanation. Example:
[{{"name":"Sarah","relationship":"manager","communication_style":"formal","platform":"slack","topics":["API docs","sprint review"],"notes":"Expects weekly status updates"}}]

If no people are clearly mentioned, return []."#,
        conversation = conversation_text,
        platform = platform,
    );

    let model = crate::config::cheap_model_for_provider(&config.provider, &config.model);
    let messages_vec = vec![crate::providers::ConversationMessage::User(prompt)];

    let Ok(turn) = crate::providers::complete_turn(
        &config.provider,
        &config.api_key,
        &model,
        &messages_vec,
        &[],
        config.base_url.as_deref(),
    ).await else {
        return;
    };

    let json_text = turn.content.trim();

    // Try to find JSON array within response
    let json_start = json_text.find('[').unwrap_or(0);
    let json_end = json_text.rfind(']').map(|i| i + 1).unwrap_or(json_text.len());
    let json_slice = &json_text[json_start..json_end];

    let Ok(extracted): Result<Vec<serde_json::Value>, _> = serde_json::from_str(json_slice) else {
        return;
    };

    let now = chrono::Utc::now().timestamp();

    for entry in extracted {
        let name = match entry["name"].as_str() {
            Some(n) if !n.trim().is_empty() => n.trim().to_string(),
            _ => continue,
        };

        let topics: Vec<String> = entry["topics"]
            .as_array()
            .map(|arr| arr.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect())
            .unwrap_or_default();

        // Check if already exists to preserve interaction count
        let existing = get_person(&name);
        let id = existing
            .as_ref()
            .map(|p| p.id.clone())
            .unwrap_or_else(|| format!("person_{}", uuid_like(&name)));

        let merged_topics = if let Some(ref ex) = existing {
            let mut t = ex.topics.clone();
            for topic in &topics {
                if !t.contains(topic) {
                    t.push(topic.clone());
                }
            }
            t.truncate(10);
            t
        } else {
            topics
        };

        let person = Person {
            id,
            name,
            relationship: entry["relationship"].as_str().unwrap_or("unknown").to_string(),
            communication_style: entry["communication_style"].as_str().unwrap_or("casual").to_string(),
            platform: entry["platform"].as_str().unwrap_or(platform).to_string(),
            topics: merged_topics,
            last_interaction: now,
            interaction_count: existing.map(|p| p.interaction_count).unwrap_or(0),
            notes: entry["notes"].as_str().unwrap_or("").to_string(),
        };

        let _ = upsert_person(&person);
    }
}

/// Simple deterministic ID from name (no uuid dependency needed — just make it stable)
fn uuid_like(name: &str) -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut hasher = DefaultHasher::new();
    name.to_lowercase().hash(&mut hasher);
    format!("{:x}", hasher.finish())
}

/// Public (non-command) list of people — for use by other modules (e.g. persona_engine).
pub fn people_list_pub() -> Vec<Person> {
    ensure_tables();
    let conn = match open_db() {
        Some(c) => c,
        None => return Vec::new(),
    };
    let mut stmt = match conn.prepare(
        "SELECT id,name,relationship,communication_style,platform,topics,last_interaction,interaction_count,notes
         FROM people ORDER BY interaction_count DESC, last_interaction DESC LIMIT 100"
    ) {
        Ok(s) => s,
        Err(_) => return Vec::new(),
    };
    stmt.query_map([], |row| parse_person_row(row))
        .ok()
        .map(|rows| rows.filter_map(|r| r.ok()).collect())
        .unwrap_or_default()
}

// ── Tauri Commands ────────────────────────────────────────────────────────────

#[tauri::command]
pub fn people_list() -> Vec<Person> {
    ensure_tables();
    let conn = match open_db() {
        Some(c) => c,
        None => return Vec::new(),
    };
    let mut stmt = match conn.prepare(
        "SELECT id,name,relationship,communication_style,platform,topics,last_interaction,interaction_count,notes
         FROM people ORDER BY interaction_count DESC, last_interaction DESC LIMIT 100"
    ) {
        Ok(s) => s,
        Err(_) => return Vec::new(),
    };
    stmt.query_map([], |row| parse_person_row(row))
        .ok()
        .map(|rows| rows.filter_map(|r| r.ok()).collect())
        .unwrap_or_default()
}

#[tauri::command]
pub fn people_get(name: String) -> Option<Person> {
    ensure_tables();
    get_person(&name)
}

#[tauri::command]
pub fn people_upsert(person: Person) -> Result<(), String> {
    ensure_tables();
    upsert_person(&person)
}

#[tauri::command]
pub fn people_delete(id: String) -> Result<(), String> {
    let conn = open_db().ok_or("DB unavailable")?;
    conn.execute("DELETE FROM people WHERE id = ?1", params![id])
        .map_err(|e| format!("DB error: {}", e))?;
    Ok(())
}

#[tauri::command]
pub fn people_suggest_reply_style(name: String) -> String {
    ensure_tables();
    suggest_reply_style(&name)
}

#[tauri::command]
pub async fn people_learn_from_conversation(
    messages: Vec<crate::history::HistoryMessage>,
    platform: String,
) {
    ensure_tables();
    learn_person_from_conversation(&messages, &platform).await;
}

/// Called from the post-chat pipeline in commands.rs with raw text strings
/// (not HistoryMessage objects) so the caller doesn't need to build a struct.
pub async fn learn_from_conversation_text(user_text: &str, assistant_text: &str) {
    if user_text.len() < 30 {
        return;
    }
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let msgs = vec![
        crate::history::HistoryMessage {
            id: "tmp-user".to_string(),
            role: "user".to_string(),
            content: user_text.to_string(),
            timestamp: now,
        },
        crate::history::HistoryMessage {
            id: "tmp-assistant".to_string(),
            role: "assistant".to_string(),
            content: assistant_text.to_string(),
            timestamp: now,
        },
    ];
    learn_person_from_conversation(&msgs, "chat").await;
}

#[tauri::command]
pub fn people_get_context_for_prompt(names: Vec<String>) -> String {
    ensure_tables();
    get_people_context_for_prompt(&names)
}
