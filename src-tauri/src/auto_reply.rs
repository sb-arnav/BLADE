/// BLADE Auto-Reply — drafts responses in your style when someone messages you.
///
/// Looks up sender in people_graph → relationship + style.
/// Loads personality profile → formality, tone, length preference.
/// Returns a DraftReply the user can approve or edit. Learns from edits.

use serde::{Deserialize, Serialize};

// ── Types ─────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DraftReply {
    pub text: String,
    pub confidence: f64,
    pub style_notes: String,    // "Matched casual tone for teammate"
    pub person_context: String, // "Last talked about API migration 3 days ago"
}

// ── Core function ─────────────────────────────────────────────────────────────

pub async fn draft_reply(
    sender: &str,
    message: &str,
    platform: &str,
    thread_context: Option<&str>,
) -> Result<DraftReply, String> {
    crate::people_graph::ensure_tables();

    let config = crate::config::load_config();
    if config.api_key.is_empty() && config.provider != "ollama" {
        return Err("No API key configured".to_string());
    }

    // ── 1. Look up sender in people graph ──────────────────────────────────
    let person = crate::people_graph::get_person(sender);
    let (relationship, style, platform_inferred) = match &person {
        Some(p) => (
            p.relationship.clone(),
            p.communication_style.clone(),
            if p.platform != "unknown" { p.platform.clone() } else { platform.to_string() },
        ),
        None => (
            "unknown".to_string(),
            "casual".to_string(),
            platform.to_string(),
        ),
    };

    // Build person context string for the DraftReply output
    let person_context = match &person {
        Some(p) => {
            let mut parts = Vec::new();
            if p.interaction_count > 0 {
                parts.push(format!("{} previous interactions", p.interaction_count));
            }
            if !p.topics.is_empty() {
                parts.push(format!("past topics: {}", p.topics.join(", ")));
            }
            if !p.notes.is_empty() {
                parts.push(p.notes.clone());
            }
            if p.last_interaction > 0 {
                let days_ago = (chrono::Utc::now().timestamp() - p.last_interaction) / 86400;
                if days_ago == 0 {
                    parts.push("last contact: today".to_string());
                } else if days_ago == 1 {
                    parts.push("last contact: yesterday".to_string());
                } else {
                    parts.push(format!("last contact: {} days ago", days_ago));
                }
            }
            parts.join("; ")
        }
        None => String::new(),
    };

    // ── 2. Load personality profile ─────────────────────────────────────────
    let personality = crate::personality_mirror::load_profile();
    let personality_injection = crate::personality_mirror::get_personality_injection()
        .unwrap_or_default();

    // ── 3. Build reply style hints ──────────────────────────────────────────
    let style_hint = crate::people_graph::suggest_reply_style(sender);

    let formality_note = match style.as_str() {
        "formal" => "formal and professional",
        "technical" => "technical and precise",
        "brief" => "very brief — 1-2 sentences max",
        _ => "casual and direct",
    };

    let length_guidance = match personality.as_ref().map(|p| p.avg_message_length.as_str()).unwrap_or("short") {
        "very_short" => "1-2 sentences",
        "short" => "2-4 sentences",
        "medium" => "a short paragraph",
        _ => "a paragraph or two",
    };

    let platform_note = match platform_inferred.as_str() {
        "email" => "This is an email reply. Write a proper email body (no subject line needed). Sign off naturally.",
        "slack" => "This is a Slack message. Keep it short and direct. Use line breaks for clarity if needed.",
        "whatsapp" => "This is a WhatsApp message. Conversational, mobile-friendly.",
        _ => "Keep the reply appropriate for the platform.",
    };

    // ── 4. Build prompt ──────────────────────────────────────────────────────
    let thread_section = thread_context
        .filter(|t| !t.trim().is_empty())
        .map(|t| format!("\nThread context:\n{}", crate::safe_slice(t, 600)))
        .unwrap_or_default();

    let person_section = if !style_hint.is_empty() {
        format!("\nAbout the sender ({}): {}", sender, style_hint)
    } else {
        format!("\nSender: {} (relationship: {})", sender, relationship)
    };

    let personality_section = if !personality_injection.is_empty() {
        format!("\nYour communication style:\n{}", crate::safe_slice(&personality_injection, 400))
    } else {
        String::new()
    };

    let prompt = format!(
        r#"You are a writing assistant. Draft a reply to this message on behalf of the user.

Message from {sender}:
{message}{thread}{person}{personality}

Instructions:
- Tone: {formality}
- Length: {length}
- Platform guidance: {platform}
- Do NOT start with "Hi" or "Hello" unless it flows naturally
- Match the energy of the incoming message
- Be authentic — this is the user's voice, not a template
- Draft the reply only. No explanation, no meta-commentary.

Draft reply:"#,
        sender = sender,
        message = crate::safe_slice(message, 800),
        thread = thread_section,
        person = person_section,
        personality = personality_section,
        formality = formality_note,
        length = length_guidance,
        platform = platform_note,
    );

    // ── 5. Generate reply ────────────────────────────────────────────────────
    let model = crate::config::cheap_model_for_provider(&config.provider, &config.model);
    let messages_vec = vec![crate::providers::ConversationMessage::User(prompt)];

    let turn = crate::providers::complete_turn(
        &config.provider,
        &config.api_key,
        &model,
        &messages_vec,
        &[],
        config.base_url.as_deref(),
    )
    .await
    .map_err(|e| { crate::config::check_and_disable_on_402(&e); e })?;

    let reply_text = turn.content.trim().to_string();
    if reply_text.is_empty() {
        return Err("Empty reply generated".to_string());
    }

    // ── 6. Compute confidence based on how much we know ─────────────────────
    let confidence = {
        let mut score = 0.5f64;
        if person.is_some() { score += 0.2; }
        if personality.is_some() { score += 0.2; }
        if thread_context.is_some() { score += 0.1; }
        score.min(1.0)
    };

    let style_notes = format!(
        "Matched {} tone for {} ({})",
        formality_note, sender, relationship
    );

    Ok(DraftReply {
        text: reply_text,
        confidence,
        style_notes,
        person_context,
    })
}

/// Record that the user edited a draft. This helps surface patterns over time.
/// Simple: store the diff length as a signal — large edits = low quality draft.
fn record_draft_edit(
    sender: &str,
    original_len: usize,
    edited_len: usize,
    edit_distance_approx: usize,
) {
    let db_path = crate::config::blade_config_dir().join("blade.db");
    if let Ok(conn) = rusqlite::Connection::open(db_path) {
        // We store edit feedback in the activity timeline for pattern analysis
        let metadata = serde_json::json!({
            "sender": sender,
            "original_len": original_len,
            "edited_len": edited_len,
            "edit_distance": edit_distance_approx,
            "quality_signal": if edit_distance_approx < original_len / 4 { "good" } else { "needs_work" }
        });
        let _ = crate::db::timeline_record(
            &conn,
            "draft_reply_edit",
            &format!("Draft edited for {}", sender),
            &metadata.to_string(),
            "auto_reply",
            "{}",
        );
    }
}

// ── Tauri Commands ────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn auto_reply_draft(
    sender: String,
    message: String,
    platform: String,
    thread_context: Option<String>,
) -> Result<DraftReply, String> {
    draft_reply(
        &sender,
        &message,
        &platform,
        thread_context.as_deref(),
    )
    .await
}

/// Called when the user submits an edited version of the draft.
/// Stores the edit pattern so BLADE can learn over time.
#[tauri::command]
pub fn auto_reply_learn_from_edit(
    sender: String,
    original: String,
    edited: String,
) {
    let orig_len = original.len();
    let edit_len = edited.len();

    // Approximate edit distance by word diff count
    let orig_words: std::collections::HashSet<&str> = original.split_whitespace().collect();
    let edit_words: std::collections::HashSet<&str> = edited.split_whitespace().collect();
    let changed = orig_words.symmetric_difference(&edit_words).count();

    record_draft_edit(&sender, orig_len, edit_len, changed);

    // If user added the person's name to reply → learn that they prefer name-addressing
    let edited_lower = edited.to_lowercase();
    let sender_lower = sender.to_lowercase();
    if edited_lower.contains(&sender_lower) {
        if let Some(mut person) = crate::people_graph::get_person(&sender) {
            if !person.notes.contains("prefers name greeting") {
                if !person.notes.is_empty() {
                    person.notes.push_str("; prefers name greeting");
                } else {
                    person.notes = "prefers name greeting".to_string();
                }
                let _ = crate::people_graph::upsert_person(&person);
            }
        }
    }
}

/// Quick batch drafts: draft replies for a list of pending messages.
#[tauri::command]
pub async fn auto_reply_draft_batch(
    messages: Vec<serde_json::Value>,
) -> Vec<serde_json::Value> {
    let mut results = Vec::new();

    for msg in messages.iter().take(5) {
        let sender = msg["sender"].as_str().unwrap_or("Unknown").to_string();
        let content = msg["content"].as_str().unwrap_or("").to_string();
        let platform = msg["platform"].as_str().unwrap_or("unknown").to_string();

        match draft_reply(&sender, &content, &platform, None).await {
            Ok(draft) => results.push(serde_json::json!({
                "sender": sender,
                "original": content,
                "draft": draft.text,
                "confidence": draft.confidence,
                "style_notes": draft.style_notes,
                "person_context": draft.person_context,
            })),
            Err(e) => results.push(serde_json::json!({
                "sender": sender,
                "original": content,
                "error": e,
            })),
        }
    }

    results
}
