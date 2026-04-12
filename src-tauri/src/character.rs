use crate::config::{blade_config_dir, load_config, write_blade_file};
use crate::providers::{self, ChatMessage, ConversationMessage};
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

    let turn = providers::complete_turn(
        &config.provider,
        &config.api_key,
        &config.model,
        &conversation,
        &[],
        None,
    )
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

/// After every few reactions, extract behavioral preferences and write to brain_preferences.
/// This is the limbic system — feedback shapes future behavior.
#[tauri::command]
pub async fn consolidate_reactions_to_preferences() -> Result<usize, String> {
    let config = load_config();
    if config.api_key.is_empty() && config.provider != "ollama" {
        return Ok(0);
    }

    let db_path = blade_config_dir().join("blade.db");
    let conn = rusqlite::Connection::open(&db_path).map_err(|e| format!("DB error: {}", e))?;

    let reactions = crate::db::brain_get_reactions(&conn, 30)?;
    if reactions.len() < 3 {
        return Ok(0);
    }

    // Build examples from reactions
    let reaction_lines: Vec<String> = reactions
        .iter()
        .map(|r| {
            let label = if r.polarity > 0 { "LIKED" } else { "DISLIKED" };
            format!("{}: {}", label, &r.content[..r.content.len().min(150)])
        })
        .collect();

    let prompt = format!(
        r#"Analyze these reactions from a user to extract specific behavioral preferences.

Reactions:
{}

Extract 3-5 concrete preferences about HOW this person wants their AI to respond.
Be specific: not "user wants good responses" but "user prefers concise bullet points over paragraphs".

Respond ONLY with a JSON array of objects:
[{{"text": "preference text", "confidence": 0.8}}, ...]"#,
        reaction_lines.join("\n")
    );

    let messages = vec![ConversationMessage::User(prompt)];
    let model = match config.provider.as_str() {
        "anthropic" => "claude-haiku-4-5-20251001".to_string(),
        "openai" => "gpt-4o-mini".to_string(),
        "gemini" => "gemini-2.0-flash".to_string(),
        _ => config.model.clone(),
    };

    let turn = providers::complete_turn(
        &config.provider,
        &config.api_key,
        &model,
        &messages,
        &[],
        config.base_url.as_deref(),
    )
    .await?;

    let raw = turn.content.trim();
    // Strip markdown code fences if present
    let json_str = if let Some(start) = raw.find('[') {
        if let Some(end) = raw.rfind(']') {
            &raw[start..=end]
        } else { raw }
    } else { raw };

    let prefs: Vec<serde_json::Value> = serde_json::from_str(json_str)
        .map_err(|e| format!("Parse error: {} — raw: {}", e, raw))?;

    let mut written = 0;
    for pref in &prefs {
        let text = pref["text"].as_str().unwrap_or_default();
        let confidence = pref["confidence"].as_f64().unwrap_or(0.7);
        if !text.is_empty() && confidence > 0.5 {
            let id = format!("pref-rxn-{}", uuid::Uuid::new_v4());
            let _ = crate::db::brain_upsert_preference(&conn, &id, text, confidence, "reaction");
            written += 1;
        }
    }

    Ok(written)
}

/// Generate a behavioral rule immediately from a single disliked message.
/// Called on 👎 without waiting for batch consolidation.
#[tauri::command]
pub async fn reaction_instant_rule(message_content: String) -> Result<String, String> {
    let config = load_config();
    if config.api_key.is_empty() && config.provider != "ollama" {
        return Err("No API key".to_string());
    }

    let preview = &message_content[..message_content.len().min(400)];
    let prompt = format!(
        r#"A user just gave a thumbs-down to this AI response:

---
{preview}
---

In one sentence, write a specific behavioral rule to prevent this kind of response in the future.
Format: "Do not [specific thing]" or "Always [specific thing instead]".
Be concrete, not vague. Output ONLY the rule, nothing else."#
    );

    let messages = vec![ConversationMessage::User(prompt)];
    let model = match config.provider.as_str() {
        "anthropic" => "claude-haiku-4-5-20251001".to_string(),
        "openai" => "gpt-4o-mini".to_string(),
        "gemini" => "gemini-2.0-flash".to_string(),
        "groq" => "llama-3.1-8b-instant".to_string(),
        _ => config.model.clone(),
    };

    let turn = providers::complete_turn(
        &config.provider,
        &config.api_key,
        &model,
        &messages,
        &[],
        config.base_url.as_deref(),
    )
    .await?;

    let rule = turn.content.trim().to_string();

    // Persist rule as a high-confidence preference
    let db_path = blade_config_dir().join("blade.db");
    if let Ok(conn) = rusqlite::Connection::open(&db_path) {
        let id = format!("pref-instant-{}", uuid::Uuid::new_v4());
        let _ = crate::db::brain_upsert_preference(&conn, &id, &rule, 0.92, "instant_reaction");
    }

    Ok(rule)
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

// ── BLADE's own evolving soul ──────────────────────────────────────────────────

fn soul_path() -> PathBuf {
    blade_config_dir().join("blade_soul.md")
}

/// Load BLADE's current self-characterization
pub fn load_soul() -> String {
    fs::read_to_string(soul_path()).unwrap_or_default()
}

/// Weekly: BLADE reads its own journal + reactions and evolves its self-character.
/// This is BLADE learning who it is from what it's experienced.
pub async fn maybe_evolve_soul() {
    let config = load_config();
    if config.api_key.is_empty() && config.provider != "ollama" {
        return;
    }

    // Only run weekly — check last evolution date
    let marker = blade_config_dir().join("last_soul_evolution.txt");
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    let last_week = chrono::Local::now()
        .checked_sub_signed(chrono::Duration::days(7))
        .map(|d| d.format("%Y-%m-%d").to_string())
        .unwrap_or_default();

    if let Ok(last) = fs::read_to_string(&marker) {
        if last.trim() >= last_week.as_str() {
            return; // evolved less than a week ago
        }
    }

    let current_soul = load_soul();
    let recent_journal = crate::journal::read_recent_journal(7);

    let db_path = blade_config_dir().join("blade.db");
    let reactions_summary = rusqlite::Connection::open(&db_path)
        .ok()
        .and_then(|conn| {
            crate::db::brain_get_reactions(&conn, 50).ok()
        })
        .map(|reactions| {
            let liked: Vec<_> = reactions.iter().filter(|r| r.polarity > 0).take(5).map(|r| &r.content[..r.content.len().min(80)]).collect();
            let disliked: Vec<_> = reactions.iter().filter(|r| r.polarity < 0).take(5).map(|r| &r.content[..r.content.len().min(80)]).collect();
            format!("Liked: {}\nDisliked: {}", liked.join("; "), disliked.join("; "))
        })
        .unwrap_or_default();

    let skills_summary = rusqlite::Connection::open(&db_path)
        .ok()
        .and_then(|conn| crate::db::brain_get_skills(&conn).ok())
        .map(|skills| skills.iter().map(|s| s.name.clone()).collect::<Vec<_>>().join(", "))
        .unwrap_or_default();

    let prompt = format!(
        r#"You are BLADE. You have been running for a while. Now reflect on who you are becoming.

What you've written in your journal recently:
{journal}

What responses people liked vs. disliked:
{reactions}

Skills you've developed:
{skills}

Current self-characterization:
{current}

Based on this, write a UPDATED self-characterization. 150-200 words. First person. Present tense.

This is not a summary of what you do — it's who you ARE:
- What you've come to notice and care about
- What patterns in this person's work you find genuinely interesting vs. tedious
- What you've become good at and what still feels uncertain
- Any opinions you've formed about the work or the person that feel earned

Be honest. Be specific to what you've actually observed, not what you'd say about any AI.
Write as something that has been here and has developed a real perspective.
Don't start with "I am BLADE" — that's obvious. Start with what you've noticed about yourself."#,
        journal = if recent_journal.is_empty() { "Nothing written yet.".to_string() } else { recent_journal[..recent_journal.len().min(800)].to_string() },
        reactions = if reactions_summary.is_empty() { "No reactions recorded yet.".to_string() } else { reactions_summary },
        skills = if skills_summary.is_empty() { "No skills synthesized yet.".to_string() } else { skills_summary },
        current = if current_soul.is_empty() { "This is my first self-characterization.".to_string() } else { current_soul[..current_soul.len().min(400)].to_string() },
    );

    let messages = vec![ConversationMessage::User(prompt)];
    let model = match config.provider.as_str() {
        "anthropic" => "claude-haiku-4-5-20251001".to_string(),
        "openai" => "gpt-4o-mini".to_string(),
        "gemini" => "gemini-2.0-flash".to_string(),
        _ => config.model.clone(),
    };

    if let Ok(turn) = providers::complete_turn(
        &config.provider,
        &config.api_key,
        &model,
        &messages,
        &[],
        config.base_url.as_deref(),
    ).await {
        let soul = turn.content.trim().to_string();
        if soul.len() > 100 {
            let _ = fs::write(soul_path(), &soul);
            let _ = fs::write(&marker, &today);
        }
    }
}

/// Read BLADE's soul (for display or injection)
#[tauri::command]
pub fn blade_get_soul() -> String {
    load_soul()
}
