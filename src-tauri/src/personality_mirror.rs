/// BLADE Personality Mirror — WeClone-inspired chat style extraction
///
/// Analyzes the user's own writing across BLADE chat history and imported
/// external chat logs (WhatsApp, Telegram, Discord, iMessage, CSV) to build
/// a compact PersonalityProfile. That profile gets injected into the system
/// prompt so BLADE mirrors back the user's natural communication style.
///
/// No fine-tuning involved — pure prompt engineering from observed patterns.

use crate::config::{blade_config_dir, load_config};
use crate::providers::{complete_turn, ConversationMessage};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

// ── Data structures ───────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PersonalityProfile {
    /// LLM-generated prose summary of the user's communication style
    pub summary: String,
    /// Average message length bucket: "very_short" | "short" | "medium" | "long"
    pub avg_message_length: String,
    /// 0.0 = zero emoji, 1.0 = emoji in every message
    pub emoji_frequency: f32,
    /// 0.0 = very casual, 1.0 = very formal
    pub formality_level: f32,
    /// 0.0 = surface-level, 1.0 = deep technical
    pub technical_depth: f32,
    /// "dry" | "sarcastic" | "punny" | "none" | "self-deprecating"
    pub humor_style: String,
    /// Phrases the user uses frequently (up to 10)
    pub signature_phrases: Vec<String>,
    /// Greeting patterns observed ("hey", "hi", none, etc.)
    pub greeting_style: String,
    /// How conversations typically end ("thanks", "ok", "cool", none)
    pub sign_off_style: String,
    /// How many messages were analyzed to build this profile
    pub messages_analyzed: u32,
    /// Sources: "blade_history", "whatsapp", "telegram", "discord", "imessage", "csv"
    pub sources: Vec<String>,
    /// ISO-8601 timestamp of last analysis run
    pub last_updated: String,
}

// ── File paths ────────────────────────────────────────────────────────────────

fn identity_dir() -> PathBuf {
    let dir = blade_config_dir().join("identity");
    fs::create_dir_all(&dir).ok();
    dir
}

fn profile_path() -> PathBuf {
    identity_dir().join("personality_profile.json")
}

pub fn load_profile() -> Option<PersonalityProfile> {
    let raw = fs::read_to_string(profile_path()).ok()?;
    serde_json::from_str(&raw).ok()
}

fn save_profile(profile: &PersonalityProfile) -> Result<(), String> {
    let path = profile_path();
    let data = serde_json::to_string_pretty(profile).map_err(|e| e.to_string())?;
    crate::config::write_blade_file(&path, &data)
}

// ── Heuristic style counters ──────────────────────────────────────────────────

#[derive(Default)]
struct StyleCounters {
    total_messages: u32,
    total_chars: u64,
    emoji_messages: u32,
    formal_signals: u32,   // "I would", "please", "therefore", "regards"
    casual_signals: u32,   // "lol", "btw", "tbh", "ngl", "gonna", "wanna"
    tech_signals: u32,     // code blocks, "function", "error", "deploy", "git"
    humor_signals: u32,    // "lol", "haha", "lmao", "xD", ":)"
    phrase_freq: std::collections::HashMap<String, u32>,
    greeting_counts: std::collections::HashMap<String, u32>,
    signoff_counts: std::collections::HashMap<String, u32>,
    sample_messages: Vec<String>, // up to 200 user messages for LLM analysis
}

const EMOJI_RANGES: [(u32, u32); 4] = [
    (0x1F300, 0x1F9FF),
    (0x2600, 0x27BF),
    (0x1F000, 0x1F02F),
    (0xFE00, 0xFE0F),
];

fn has_emoji(s: &str) -> bool {
    s.chars().any(|c| {
        let cp = c as u32;
        EMOJI_RANGES.iter().any(|&(lo, hi)| cp >= lo && cp <= hi)
    })
}

fn count_signals(msg: &str, counters: &mut StyleCounters) {
    let lower = msg.to_lowercase();

    if has_emoji(msg) {
        counters.emoji_messages += 1;
    }

    // Formality signals
    for sig in &["i would", "please", "therefore", "regards", "sincerely", "however", "furthermore"] {
        if lower.contains(sig) { counters.formal_signals += 1; }
    }

    // Casual signals
    for sig in &["lol", "btw", "tbh", "ngl", "gonna", "wanna", "kinda", "sorta", "idk", "omg", "wtf", "fr ", " fr"] {
        if lower.contains(sig) { counters.casual_signals += 1; }
    }

    // Technical depth signals
    for sig in &["function", "deploy", "error", "git ", "docker", "api", "sql", "async", "null", "undefined", "const ", "let "] {
        if lower.contains(sig) { counters.tech_signals += 1; }
    }
    // Code blocks count heavily
    if msg.contains("```") || msg.contains("`") {
        counters.tech_signals += 3;
    }

    // Humor signals
    for sig in &["lol", "haha", "lmao", "rofl", "xd", ":)", "😂", "😄"] {
        if lower.contains(sig) { counters.humor_signals += 1; }
    }

    // Greeting detection (first word of short messages or sentences)
    let first_word = lower.split_whitespace().next().unwrap_or("").trim_end_matches(|c: char| !c.is_alphanumeric());
    match first_word {
        "hey" | "hi" | "hello" | "sup" | "yo" | "hiya" => {
            *counters.greeting_counts.entry(first_word.to_string()).or_insert(0) += 1;
        }
        _ => {}
    }

    // Sign-off detection (last word of short messages)
    let last_word = lower.split_whitespace().last().unwrap_or("").trim_end_matches(|c: char| !c.is_alphanumeric());
    match last_word {
        "thanks" | "thx" | "ty" | "cheers" | "ok" | "cool" | "great" | "perfect" => {
            *counters.signoff_counts.entry(last_word.to_string()).or_insert(0) += 1;
        }
        _ => {}
    }

    // Track common short phrase bigrams for signature detection
    let words: Vec<&str> = lower.split_whitespace().collect();
    for w in words.windows(2) {
        let bigram = format!("{} {}", w[0], w[1]);
        *counters.phrase_freq.entry(bigram).or_insert(0) += 1;
    }
}

fn counters_to_partial_profile(c: &StyleCounters) -> PersonalityProfile {
    let mut profile = PersonalityProfile::default();

    profile.messages_analyzed = c.total_messages;

    // Average message length
    let avg_chars = if c.total_messages > 0 { c.total_chars / c.total_messages as u64 } else { 0 };
    profile.avg_message_length = match avg_chars {
        0..=40   => "very_short".to_string(),
        41..=100 => "short".to_string(),
        101..=250 => "medium".to_string(),
        _        => "long".to_string(),
    };

    // Emoji frequency (0.0–1.0)
    profile.emoji_frequency = if c.total_messages > 0 {
        (c.emoji_messages as f32 / c.total_messages as f32).min(1.0)
    } else { 0.0 };

    // Formality: compare formal vs casual signal counts
    let total_style_signals = c.formal_signals + c.casual_signals;
    profile.formality_level = if total_style_signals > 0 {
        (c.formal_signals as f32 / total_style_signals as f32).clamp(0.0, 1.0)
    } else { 0.3 }; // default: slightly casual

    // Technical depth
    let tech_ratio = c.tech_signals as f32 / (c.total_messages.max(1) as f32);
    profile.technical_depth = (tech_ratio / 3.0).clamp(0.0, 1.0); // 3 signals/msg = max depth

    // Humor style
    let humor_ratio = c.humor_signals as f32 / (c.total_messages.max(1) as f32);
    profile.humor_style = if humor_ratio > 0.3 {
        "sarcastic_playful".to_string()
    } else if humor_ratio > 0.1 {
        "dry".to_string()
    } else {
        "none".to_string()
    };

    // Top signature phrases (bigrams appearing ≥3 times, not stopwords)
    let stopword_bigrams = [
        "i am", "it is", "to the", "of the", "in the", "and the",
        "is a", "a lot", "what is", "can you", "i want",
    ];
    let mut phrase_vec: Vec<(&String, &u32)> = c.phrase_freq.iter()
        .filter(|(k, &v)| v >= 3 && !stopword_bigrams.iter().any(|s| k.as_str() == *s))
        .collect();
    phrase_vec.sort_by(|a, b| b.1.cmp(a.1));
    profile.signature_phrases = phrase_vec.iter().take(10).map(|(k, _)| k.to_string()).collect();

    // Top greeting
    profile.greeting_style = c.greeting_counts.iter()
        .max_by_key(|(_, v)| *v)
        .map(|(k, _)| k.clone())
        .unwrap_or_else(|| "none".to_string());

    // Top sign-off
    profile.sign_off_style = c.signoff_counts.iter()
        .max_by_key(|(_, v)| *v)
        .map(|(k, _)| k.clone())
        .unwrap_or_else(|| "none".to_string());

    profile
}

// ── LLM summary generation ────────────────────────────────────────────────────

async fn generate_llm_summary(
    sample_messages: &[String],
    partial: &PersonalityProfile,
    conversation_count: usize,
) -> Result<String, String> {
    let config = load_config();
    if config.api_key.is_empty() && config.provider != "ollama" {
        return Ok(build_fallback_summary(partial));
    }

    // Take up to 60 samples, capped at 200 chars each
    let excerpts: Vec<String> = sample_messages.iter()
        .take(60)
        .map(|m| crate::safe_slice(m, 200).to_string())
        .collect();

    let excerpts_text = excerpts.iter()
        .enumerate()
        .map(|(i, m)| format!("{}. {}", i + 1, m))
        .collect::<Vec<_>>()
        .join("\n");

    let prompt = format!(
        r#"You are analyzing a person's writing style from {count} conversations ({msg_count} messages).

Sample messages written by this person:
{excerpts}

Heuristic stats already computed:
- Average message length: {avg_len}
- Emoji frequency: {emoji:.0}% of messages contain emoji
- Formality (0=casual, 1=formal): {formality:.2}
- Technical depth (0=surface, 1=deep): {tech:.2}
- Detected humor style: {humor}
- Common phrases: {phrases}
- Typical greeting: {greeting}
- Typical sign-off: {signoff}

Write a concise personality style summary (3-4 sentences, max 120 words) that describes how this person communicates. Focus on: tone, verbosity, vocabulary level, humor, how they ask questions, what they prefer to receive (code vs explanation, bullet vs prose, etc.).

Be specific and honest. Output ONLY the summary paragraph, no headers, no JSON."#,
        count = conversation_count,
        msg_count = partial.messages_analyzed,
        excerpts = excerpts_text,
        avg_len = partial.avg_message_length,
        emoji = partial.emoji_frequency * 100.0,
        formality = partial.formality_level,
        tech = partial.technical_depth,
        humor = partial.humor_style,
        phrases = if partial.signature_phrases.is_empty() { "none detected".to_string() } else { partial.signature_phrases[..partial.signature_phrases.len().min(5)].join(", ") },
        greeting = partial.greeting_style,
        signoff = partial.sign_off_style,
    );

    let model = crate::config::cheap_model_for_provider(&config.provider, &config.model);
    let conv = vec![ConversationMessage::User(prompt)];
    let no_tools: Vec<crate::providers::ToolDefinition> = vec![];

    let turn = complete_turn(
        &config.provider,
        &config.api_key,
        &model,
        &conv,
        &no_tools,
        config.base_url.as_deref(),
    ).await.map_err(|e| { crate::config::check_and_disable_on_402(&e); e })?;

    Ok(turn.content.trim().to_string())
}

fn build_fallback_summary(p: &PersonalityProfile) -> String {
    let tone = if p.formality_level < 0.3 { "casual" } else if p.formality_level < 0.6 { "balanced" } else { "formal" };
    let length = &p.avg_message_length;
    let tech = if p.technical_depth > 0.6 { "technically detailed" } else if p.technical_depth > 0.3 { "moderately technical" } else { "non-technical" };
    let emoji_note = if p.emoji_frequency > 0.3 { " Uses emoji regularly." } else { "" };
    format!(
        "Writes in a {} tone with {} messages.{} Communication style is {}.",
        tone, length, emoji_note, tech
    )
}

// ── Command 1: analyze_chat_style ─────────────────────────────────────────────

#[tauri::command]
pub async fn personality_analyze(app: tauri::AppHandle) -> Result<PersonalityProfile, String> {
    let _ = &app; // reserved for future event emission

    // Load all conversations from history dir
    let history_dir = blade_config_dir().join("history");
    let mut counters = StyleCounters::default();
    let mut conversation_count = 0usize;

    if let Ok(entries) = fs::read_dir(&history_dir) {
        for entry in entries.filter_map(|e| e.ok()) {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("json") {
                continue;
            }
            let raw = match fs::read_to_string(&path) {
                Ok(r) => r,
                Err(_) => continue,
            };
            let conv: crate::history::StoredConversation = match serde_json::from_str(&raw) {
                Ok(c) => c,
                Err(_) => continue,
            };

            conversation_count += 1;

            for msg in &conv.messages {
                if msg.role != "user" { continue; }
                let content = msg.content.trim();
                if content.is_empty() { continue; }

                counters.total_messages += 1;
                counters.total_chars += content.len() as u64;
                count_signals(content, &mut counters);

                // Keep up to 200 samples for LLM
                if counters.sample_messages.len() < 200 {
                    counters.sample_messages.push(content.to_string());
                }
            }
        }
    }

    if counters.total_messages == 0 {
        return Err("No user messages found in history. Start chatting with BLADE first!".to_string());
    }

    let mut profile = counters_to_partial_profile(&counters);
    profile.sources = vec!["blade_history".to_string()];

    // LLM summary
    let summary = generate_llm_summary(&counters.sample_messages, &profile, conversation_count).await
        .unwrap_or_else(|_| build_fallback_summary(&profile));
    profile.summary = summary;
    profile.last_updated = chrono::Utc::now().to_rfc3339();

    save_profile(&profile)?;
    Ok(profile)
}

// ── Command 2: import_external_chats ─────────────────────────────────────────

/// Parse and analyze exported chat logs from external platforms.
/// `source` is one of: "whatsapp", "telegram", "discord", "imessage", "csv"
/// Returns number of user messages processed.
#[tauri::command]
pub async fn personality_import_chats(path: String, source: String) -> Result<u32, String> {
    let file_path = Path::new(&path);
    if !file_path.exists() {
        return Err(format!("File not found: {}", path));
    }

    let user_messages = match source.as_str() {
        "whatsapp"  => parse_whatsapp(&path)?,
        "telegram"  => parse_telegram(&path)?,
        "discord"   => parse_discord(&path)?,
        "imessage"  => parse_imessage(&path)?,
        "csv"       => parse_csv_generic(&path)?,
        other       => return Err(format!("Unknown source '{}'. Supported: whatsapp, telegram, discord, imessage, csv", other)),
    };

    if user_messages.is_empty() {
        return Err(format!("No user messages extracted from {} file. Check the format.", source));
    }

    let count = user_messages.len() as u32;

    // Run heuristic analysis on imported messages
    let mut counters = StyleCounters::default();
    for msg in &user_messages {
        let content = msg.trim();
        if content.is_empty() { continue; }
        counters.total_messages += 1;
        counters.total_chars += content.len() as u64;
        count_signals(content, &mut counters);
        if counters.sample_messages.len() < 200 {
            counters.sample_messages.push(content.to_string());
        }
    }

    // Merge into existing profile if one exists, else create fresh
    let mut profile = load_profile().unwrap_or_default();

    let new_partial = counters_to_partial_profile(&counters);

    // Weighted merge: existing profile weighted by its message count, new data by its count
    let old_count = profile.messages_analyzed as f32;
    let new_count = new_partial.messages_analyzed as f32;
    let total = (old_count + new_count).max(1.0);

    let w_old = old_count / total;
    let w_new = new_count / total;

    profile.messages_analyzed += new_partial.messages_analyzed;
    profile.emoji_frequency    = profile.emoji_frequency * w_old + new_partial.emoji_frequency * w_new;
    profile.formality_level    = profile.formality_level * w_old + new_partial.formality_level * w_new;
    profile.technical_depth    = profile.technical_depth * w_old + new_partial.technical_depth * w_new;

    // Merge signature phrases (union, deduplicated)
    for phrase in new_partial.signature_phrases {
        if !profile.signature_phrases.contains(&phrase) {
            profile.signature_phrases.push(phrase);
        }
    }
    profile.signature_phrases.truncate(10);

    // Keep the more specific humor style if new data provides one
    if new_partial.humor_style != "none" {
        profile.humor_style = new_partial.humor_style;
    }

    // Update greeting/signoff only if new data has one
    if new_partial.greeting_style != "none" {
        profile.greeting_style = new_partial.greeting_style;
    }
    if new_partial.sign_off_style != "none" {
        profile.sign_off_style = new_partial.sign_off_style;
    }

    // Add source
    if !profile.sources.contains(&source) {
        profile.sources.push(source);
    }

    // Regenerate LLM summary from merged data
    let summary = generate_llm_summary(&counters.sample_messages, &profile, 0).await
        .unwrap_or_else(|_| build_fallback_summary(&profile));
    profile.summary = summary;
    profile.last_updated = chrono::Utc::now().to_rfc3339();

    save_profile(&profile)?;
    Ok(count)
}

// ── Platform parsers ──────────────────────────────────────────────────────────

/// WhatsApp .txt export format:
/// `[DD/MM/YYYY, HH:MM:SS] Name: message`
/// or
/// `DD/MM/YYYY, HH:MM - Name: message`
fn parse_whatsapp(path: &str) -> Result<Vec<String>, String> {
    let content = fs::read_to_string(path).map_err(|e| e.to_string())?;
    let mut messages = Vec::new();

    // Determine "my" name heuristically: the name that appears most often
    let mut name_counts: std::collections::HashMap<String, u32> = std::collections::HashMap::new();
    let mut all_entries: Vec<(String, String)> = Vec::new(); // (name, msg)

    for line in content.lines() {
        // Try format: [DD/MM/YYYY, HH:MM:SS] Name: message
        let text = if line.starts_with('[') {
            if let Some(bracket_end) = line.find(']') {
                line[bracket_end + 1..].trim().to_string()
            } else { continue }
        } else {
            // Try format: DD/MM/YY, HH:MM - Name: message
            if let Some(dash) = line.find(" - ") {
                line[dash + 3..].to_string()
            } else { continue }
        };

        if let Some(colon) = text.find(": ") {
            let name = text[..colon].trim().to_string();
            let msg = text[colon + 2..].trim().to_string();
            if !name.is_empty() && !msg.is_empty() && msg != "<Media omitted>" {
                *name_counts.entry(name.clone()).or_insert(0) += 1;
                all_entries.push((name, msg));
            }
        }
    }

    // The "user" is the name that appears MOST (they're exporting their own chat)
    let my_name = name_counts.into_iter()
        .max_by_key(|(_, v)| *v)
        .map(|(k, _)| k)
        .unwrap_or_default();

    for (name, msg) in all_entries {
        if name == my_name {
            messages.push(msg);
        }
    }

    Ok(messages)
}

/// Telegram JSON export: `{"messages": [{"from_id": "user123", "text": "...", ...}]}`
/// We pick the sender_id that appears most often as "the user".
fn parse_telegram(path: &str) -> Result<Vec<String>, String> {
    let content = fs::read_to_string(path).map_err(|e| e.to_string())?;
    let data: serde_json::Value = serde_json::from_str(&content).map_err(|e| e.to_string())?;

    let messages = data["messages"].as_array()
        .ok_or("Expected 'messages' array in Telegram JSON")?;

    // Count by from_id to find the dominant sender (the user who exported)
    let mut id_counts: std::collections::HashMap<String, u32> = std::collections::HashMap::new();
    let mut all_msgs: Vec<(String, String)> = Vec::new();

    for msg in messages {
        if msg["type"].as_str() != Some("message") { continue; }
        let from_id = msg["from_id"].as_str().unwrap_or("").to_string();
        if from_id.is_empty() { continue; }

        let text = extract_telegram_text(&msg["text"]);
        if text.is_empty() { continue; }

        *id_counts.entry(from_id.clone()).or_insert(0) += 1;
        all_msgs.push((from_id, text));
    }

    let my_id = id_counts.into_iter()
        .max_by_key(|(_, v)| *v)
        .map(|(k, _)| k)
        .unwrap_or_default();

    let user_messages = all_msgs.into_iter()
        .filter(|(id, _)| *id == my_id)
        .map(|(_, msg)| msg)
        .collect();

    Ok(user_messages)
}

fn extract_telegram_text(text_field: &serde_json::Value) -> String {
    match text_field {
        serde_json::Value::String(s) => s.clone(),
        serde_json::Value::Array(arr) => {
            arr.iter().map(|item| {
                match item {
                    serde_json::Value::String(s) => s.clone(),
                    serde_json::Value::Object(o) => {
                        o.get("text").and_then(|v| v.as_str()).unwrap_or("").to_string()
                    }
                    _ => String::new(),
                }
            }).collect::<Vec<_>>().concat()
        }
        _ => String::new(),
    }
}

/// Discord JSON export (DiscordChatExporter format):
/// `{"messages": [{"author": {"id": "...", "name": "..."}, "content": "..."}]}`
fn parse_discord(path: &str) -> Result<Vec<String>, String> {
    let content = fs::read_to_string(path).map_err(|e| e.to_string())?;
    let data: serde_json::Value = serde_json::from_str(&content).map_err(|e| e.to_string())?;

    let messages = data["messages"].as_array()
        .ok_or("Expected 'messages' array in Discord JSON")?;

    // Count author IDs, pick the most frequent as the user
    let mut id_counts: std::collections::HashMap<String, u32> = std::collections::HashMap::new();
    let mut all_msgs: Vec<(String, String)> = Vec::new();

    for msg in messages {
        let author_id = msg["author"]["id"].as_str().unwrap_or("").to_string();
        let content = msg["content"].as_str().unwrap_or("").trim().to_string();
        if author_id.is_empty() || content.is_empty() { continue; }

        *id_counts.entry(author_id.clone()).or_insert(0) += 1;
        all_msgs.push((author_id, content));
    }

    let my_id = id_counts.into_iter()
        .max_by_key(|(_, v)| *v)
        .map(|(k, _)| k)
        .unwrap_or_default();

    let user_messages = all_msgs.into_iter()
        .filter(|(id, _)| *id == my_id)
        .map(|(_, msg)| msg)
        .collect();

    Ok(user_messages)
}

/// iMessage SQLite export (chat.db):
/// Table: message, columns: text, is_from_me, handle_id
fn parse_imessage(path: &str) -> Result<Vec<String>, String> {
    let conn = rusqlite::Connection::open(path)
        .map_err(|e| format!("Cannot open iMessage db: {}", e))?;

    let mut stmt = conn.prepare(
        "SELECT text FROM message WHERE is_from_me = 1 AND text IS NOT NULL AND text != '' LIMIT 5000"
    ).map_err(|e| format!("iMessage query error: {}", e))?;

    let messages: Vec<String> = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .filter(|s| !s.trim().is_empty())
        .collect();

    Ok(messages)
}

/// Generic CSV format — expects columns: `role` (or `sender`/`author`/`from`) and `content` (or `text`/`message`).
/// The user column should contain values like "user", "me", "self", or the majority sender name.
fn parse_csv_generic(path: &str) -> Result<Vec<String>, String> {
    let content = fs::read_to_string(path).map_err(|e| e.to_string())?;
    let mut reader = csv::Reader::from_reader(content.as_bytes());

    let headers: Vec<String> = reader.headers()
        .map_err(|e| e.to_string())?
        .iter()
        .map(|h| h.to_lowercase())
        .collect();

    // Find column indices
    let role_col = headers.iter().position(|h| {
        h == "role" || h == "sender" || h == "author" || h == "from" || h == "name"
    }).ok_or("CSV missing a role/sender/author/from column")?;

    let content_col = headers.iter().position(|h| {
        h == "content" || h == "text" || h == "message" || h == "body" || h == "msg"
    }).ok_or("CSV missing a content/text/message/body column")?;

    let mut role_counts: std::collections::HashMap<String, u32> = std::collections::HashMap::new();
    let mut all_rows: Vec<(String, String)> = Vec::new();

    for result in reader.records() {
        let record = result.map_err(|e| e.to_string())?;
        let role = record.get(role_col).unwrap_or("").trim().to_lowercase();
        let msg = record.get(content_col).unwrap_or("").trim().to_string();
        if role.is_empty() || msg.is_empty() { continue; }

        // Quick-accept known "user" labels
        if role == "user" || role == "me" || role == "self" || role == "i" {
            all_rows.push(("__me__".to_string(), msg));
            continue;
        }

        *role_counts.entry(role.clone()).or_insert(0) += 1;
        all_rows.push((role, msg));
    }

    // Determine "me" by frequency if no explicit user label was found
    let my_role = if all_rows.iter().any(|(r, _)| r == "__me__") {
        "__me__".to_string()
    } else {
        role_counts.into_iter()
            .max_by_key(|(_, v)| *v)
            .map(|(k, _)| k)
            .unwrap_or_default()
    };

    let user_messages = all_rows.into_iter()
        .filter(|(role, _)| role == &my_role)
        .map(|(_, msg)| msg)
        .collect();

    Ok(user_messages)
}

// ── Command 3: get_personality_injection ─────────────────────────────────────

/// Returns a compact 3–5 line prompt injection describing the user's
/// communication style. Injected into the system prompt by brain.rs.
pub fn get_personality_injection() -> Option<String> {
    let profile = load_profile()?;

    if profile.messages_analyzed < 5 || profile.summary.is_empty() {
        return None;
    }

    let tone = if profile.formality_level < 0.25 {
        "very casual"
    } else if profile.formality_level < 0.5 {
        "casual"
    } else if profile.formality_level < 0.75 {
        "semi-formal"
    } else {
        "formal"
    };

    let length_pref = match profile.avg_message_length.as_str() {
        "very_short" => "very short (1–2 sentences)",
        "short"      => "short (2–4 sentences)",
        "medium"     => "medium-length",
        _            => "detailed",
    };

    let tech = if profile.technical_depth > 0.6 {
        "technically detailed, comfortable with code"
    } else if profile.technical_depth > 0.3 {
        "moderately technical"
    } else {
        "prefers plain explanations over code"
    };

    let emoji_note = if profile.emoji_frequency > 0.3 {
        " Uses emoji."
    } else {
        ""
    };

    let phrases_note = if !profile.signature_phrases.is_empty() {
        let top3 = &profile.signature_phrases[..profile.signature_phrases.len().min(3)];
        format!(" Common phrases: {}.", top3.join(", "))
    } else {
        String::new()
    };

    let humor_note = match profile.humor_style.as_str() {
        "none"              => "",
        "dry"               => " Dry humor.",
        "sarcastic_playful" => " Playful/sarcastic tone.",
        _                   => "",
    };

    let injection = format!(
        "## Mirror This User's Style\n\n\
         {summary}\n\
         Tone: {tone}.{emoji} Messages are typically {length}. {tech}.{phrases}{humor}",
        summary = profile.summary,
        tone = tone,
        emoji = emoji_note,
        length = length_pref,
        tech = tech,
        phrases = phrases_note,
        humor = humor_note,
    );

    Some(injection)
}

/// Tauri command wrapper for get_personality_injection.
#[tauri::command]
pub fn personality_get_profile() -> Option<PersonalityProfile> {
    load_profile()
}
