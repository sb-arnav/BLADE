/// BLADE Email Deep Tentacle — full email management, not just monitoring.
///
/// Fetches and triages the entire inbox, drafts context-aware replies in the
/// user's voice, auto-unsubscribes from marketing noise via CDP, extracts
/// invoices/receipts, and routes meeting invites to the calendar.
///
/// MCP bridge: uses the `gmail` MCP server when configured; gracefully degrades
/// to simulated data otherwise so all type contracts remain valid.

use serde::{Deserialize, Serialize};
use tauri::Manager;
use std::time::{SystemTime, UNIX_EPOCH};

// ── Helpers ───────────────────────────────────────────────────────────────────

fn now_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn mcp_registered(server: &str) -> bool {
    let cfg = crate::config::load_config();
    cfg.mcp_servers
        .iter()
        .any(|s| s.name.eq_ignore_ascii_case(server))
}

/// Generic Gmail MCP call.
async fn gmail_call(tool: &str, args: serde_json::Value) -> Result<String, String> {
    let handle = crate::integration_bridge::get_app_handle()
        .ok_or_else(|| "AppHandle not set".to_string())?;

    let manager_state = handle
        .try_state::<crate::commands::SharedMcpManager>()
        .ok_or("McpManager state not found")?;

    let mut manager: tokio::sync::MutexGuard<'_, crate::mcp::McpManager> = manager_state.lock().await;
    let qualified = format!("mcp__gmail_{}", tool);

    let result = manager.call_tool(&qualified, args).await?;

    let text = result
        .content
        .iter()
        .filter_map(|c| c.text.as_deref())
        .collect::<Vec<_>>()
        .join("\n");

    Ok(text)
}

/// Generic Calendar MCP call.
async fn calendar_call(tool: &str, args: serde_json::Value) -> Result<String, String> {
    let handle = crate::integration_bridge::get_app_handle()
        .ok_or_else(|| "AppHandle not set".to_string())?;

    let manager_state = handle
        .try_state::<crate::commands::SharedMcpManager>()
        .ok_or("McpManager state not found")?;

    let mut manager: tokio::sync::MutexGuard<'_, crate::mcp::McpManager> = manager_state.lock().await;
    let qualified = format!("mcp__calendar_{}", tool);

    let result = manager.call_tool(&qualified, args).await?;

    let text = result
        .content
        .iter()
        .filter_map(|c| c.text.as_deref())
        .collect::<Vec<_>>()
        .join("\n");

    Ok(text)
}

/// Single LLM completion helper.
async fn llm_complete(prompt: &str) -> Result<String, String> {
    use crate::providers::{complete_turn, ConversationMessage};
    let cfg = crate::config::load_config();
    let messages = vec![ConversationMessage::User(prompt.to_string())];
    let no_tools: Vec<crate::providers::ToolDefinition> = vec![];
    complete_turn(&cfg.provider, &cfg.api_key, &cfg.model, &messages, &no_tools, cfg.base_url.as_deref()).await
        .map(|t| t.content)
}

// ── Sender behaviour learning ─────────────────────────────────────────────────

/// Stored per-sender behaviour: response latency + ignore rate.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct SenderBehavior {
    /// Total interactions (replies) logged
    reply_count: u32,
    /// Sum of response latencies in minutes
    total_reply_minutes: u64,
    /// How many times user skipped replying entirely
    ignore_count: u32,
}

fn behavior_db_path() -> std::path::PathBuf {
    crate::config::blade_config_dir().join("email_sender_behavior.json")
}

fn load_sender_behaviors() -> std::collections::HashMap<String, SenderBehavior> {
    let path = behavior_db_path();
    std::fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save_sender_behaviors(map: &std::collections::HashMap<String, SenderBehavior>) {
    if let Ok(json) = serde_json::to_string_pretty(map) {
        let _ = std::fs::write(behavior_db_path(), json);
    }
}

/// Record a reply to a sender (call when user actually sends a reply).
pub fn record_reply_to_sender(sender: &str, reply_latency_minutes: u64) {
    let mut behaviors = load_sender_behaviors();
    let entry = behaviors.entry(sender.to_string()).or_default();
    entry.reply_count += 1;
    entry.total_reply_minutes += reply_latency_minutes;
    save_sender_behaviors(&behaviors);
}

/// Record that the user ignored an email from this sender.
pub fn record_ignore_sender(sender: &str) {
    let mut behaviors = load_sender_behaviors();
    let entry = behaviors.entry(sender.to_string()).or_default();
    entry.ignore_count += 1;
    save_sender_behaviors(&behaviors);
}

/// Get learned priority boost for a sender based on historical behaviour.
/// Returns a value in -0.3..+0.3 (positive = always replies fast, negative = always ignores).
fn sender_learned_boost(sender: &str) -> f32 {
    let behaviors = load_sender_behaviors();
    let b = match behaviors.get(sender) {
        Some(b) => b.clone(),
        None => return 0.0,
    };
    let total = (b.reply_count + b.ignore_count) as f32;
    if total < 3.0 {
        return 0.0; // not enough data
    }
    let reply_rate = b.reply_count as f32 / total;
    let avg_latency = if b.reply_count > 0 {
        b.total_reply_minutes as f32 / b.reply_count as f32
    } else {
        f32::MAX
    };
    // Fast replies (< 60 min) AND high reply rate → big boost
    // Always ignored → penalty
    let latency_factor = if avg_latency < 60.0 { 1.0 } else if avg_latency < 240.0 { 0.5 } else { 0.0 };
    (reply_rate - 0.5) * 0.4 + latency_factor * 0.2
}

// ── Circular thread detection ─────────────────────────────────────────────────

/// A thread that is going in circles with no decision.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CircularThread {
    pub thread_id: String,
    pub subject: String,
    pub reply_count: u32,
    pub age_days: u32,
    pub suggestion: String,
}

/// Sentiment classification for triage priority boost.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum EmailSentiment {
    Calm,
    Urgent,
    Panicked,
    Frustrated,
}

// ── Public types ──────────────────────────────────────────────────────────────

/// Compact representation of a single email used across all functions.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmailSummary {
    pub message_id: String,
    pub thread_id: String,
    pub from: String,
    pub subject: String,
    pub snippet: String,
    pub date: String,     // ISO-8601
    pub has_attachment: bool,
    pub labels: Vec<String>,
}

/// Categorised inbox — the core output of `triage_inbox`.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct InboxTriage {
    /// Must respond today — from important people, time-sensitive.
    pub critical: Vec<EmailSummary>,
    /// Should respond this week.
    pub needs_response: Vec<EmailSummary>,
    /// Informational only — no action required.
    pub fyi: Vec<EmailSummary>,
    /// Marketing, newsletters, spam — candidates for unsubscription.
    pub spam: Vec<EmailSummary>,
    /// Invoices, receipts, payment confirmations.
    pub invoices: Vec<EmailSummary>,
    /// Calendar invitations — routed to the calendar brain.
    pub meeting_invites: Vec<EmailSummary>,
}

/// A drafted reply ready to present to the user (or auto-send).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DraftReply {
    pub email: EmailSummary,
    pub draft_body: String,
    pub auto_sent: bool,
    pub tone: String, // "formal" | "casual" | "brief"
}

/// Structured invoice/receipt extracted from an email.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Invoice {
    pub email: EmailSummary,
    pub vendor: String,
    pub amount: f64,
    pub currency: String,
    pub date: String,
    pub due_date: Option<String>,
    pub description: String,
}

// ── 1. triage_inbox ───────────────────────────────────────────────────────────

/// Fetch unread emails and classify them into priority buckets.
/// Meeting invites are checked against the calendar for conflicts.
/// Uses learned sender behaviour to boost/penalise priority.
/// Applies sentiment analysis to bump panicked emails to critical.
pub async fn triage_inbox() -> Result<InboxTriage, String> {
    let emails = fetch_unread_emails().await?;
    let mut triage = InboxTriage::default();

    for email in emails {
        // Extract sender key (strip display name formatting)
        let sender_key = email.from
            .split('<')
            .last()
            .unwrap_or(&email.from)
            .trim_end_matches('>')
            .trim()
            .to_lowercase();

        let category = classify_email(&email).await;

        // Sentiment check — panicked/urgent emails get bumped to critical
        let sentiment = detect_email_sentiment(&email).await;
        let sentiment_bump = matches!(sentiment, EmailSentiment::Panicked | EmailSentiment::Urgent);

        // Learned behaviour adjustment
        let learned_boost = sender_learned_boost(&sender_key);
        // If sender is always ignored AND no urgency → auto-archive candidate
        let behaviors = load_sender_behaviors();
        let should_auto_archive = if let Some(b) = behaviors.get(&sender_key) {
            let total = (b.reply_count + b.ignore_count) as f32;
            total >= 5.0 && b.reply_count == 0
        } else {
            false
        };

        if should_auto_archive && !sentiment_bump && category == "fyi" {
            // User always ignores this sender — move to spam bucket
            triage.spam.push(email);
            continue;
        }

        let effective_category = if sentiment_bump && (category == "needs_response" || category == "fyi") {
            "critical".to_string()
        } else if learned_boost > 0.2 && category == "needs_response" {
            // Fast responder to this sender → escalate to critical
            "critical".to_string()
        } else {
            category.clone()
        };

        match effective_category.as_str() {
            "critical" => triage.critical.push(email),
            "needs_response" => triage.needs_response.push(email),
            "fyi" => triage.fyi.push(email),
            "spam" | "marketing" => triage.spam.push(email),
            "invoice" | "receipt" => triage.invoices.push(email),
            "meeting_invite" => {
                let has_conflict = check_calendar_conflict(&email).await;
                if !has_conflict {
                    let _ = accept_meeting_invite(&email).await;
                }
                triage.meeting_invites.push(email);
            }
            _ => triage.fyi.push(email),
        }
    }

    Ok(triage)
}

/// Detect the emotional tone of an email from subject + snippet.
async fn detect_email_sentiment(email: &EmailSummary) -> EmailSentiment {
    let text = format!("{} {}", email.subject, email.snippet).to_lowercase();

    // Fast heuristics
    let panic_signals = ["urgent!!", "critical!!", "emergency", "disaster", "everything is broken", "on fire", "going down", "!!!", "asap asap", "please help", "help us"];
    if panic_signals.iter().any(|kw| text.contains(kw)) {
        return EmailSentiment::Panicked;
    }

    let urgent_signals = ["urgent", "asap", "immediately", "time sensitive", "deadline today", "end of day", "eod today", "right now"];
    if urgent_signals.iter().any(|kw| text.contains(kw)) {
        return EmailSentiment::Urgent;
    }

    let frustrated_signals = ["still waiting", "following up again", "as i mentioned", "i already said", "this is unacceptable", "disappointed"];
    if frustrated_signals.iter().any(|kw| text.contains(kw)) {
        return EmailSentiment::Frustrated;
    }

    EmailSentiment::Calm
}

async fn fetch_unread_emails() -> Result<Vec<EmailSummary>, String> {
    if !mcp_registered("gmail") {
        return Ok(simulated_emails());
    }

    let args = serde_json::json!({ "query": "is:unread", "maxResults": 50 });
    let raw = gmail_call("gmail_search_messages", args).await?;

    let v: serde_json::Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;

    // Gmail MCP returns either an array or {"messages": [...]}
    let messages = v
        .as_array()
        .cloned()
        .or_else(|| v["messages"].as_array().cloned())
        .unwrap_or_default();

    let emails = messages
        .iter()
        .filter_map(|m| {
            let message_id = m["id"].as_str().unwrap_or("").to_string();
            if message_id.is_empty() {
                return None;
            }
            Some(EmailSummary {
                message_id,
                thread_id: m["threadId"].as_str().unwrap_or("").to_string(),
                from: extract_header(m, "From"),
                subject: extract_header(m, "Subject"),
                snippet: m["snippet"].as_str().unwrap_or("").to_string(),
                date: extract_header(m, "Date"),
                has_attachment: m["payload"]["parts"]
                    .as_array()
                    .map(|p| p.iter().any(|part| {
                        part["filename"].as_str().map(|f| !f.is_empty()).unwrap_or(false)
                    }))
                    .unwrap_or(false),
                labels: m["labelIds"]
                    .as_array()
                    .cloned()
                    .unwrap_or_default()
                    .iter()
                    .filter_map(|l| l.as_str().map(|s| s.to_string()))
                    .collect(),
            })
        })
        .collect();

    Ok(emails)
}

/// Pull a named header value from a Gmail API message object.
fn extract_header(m: &serde_json::Value, name: &str) -> String {
    m["payload"]["headers"]
        .as_array()
        .and_then(|headers| {
            headers.iter().find(|h| {
                h["name"].as_str().map(|n| n.eq_ignore_ascii_case(name)).unwrap_or(false)
            })
        })
        .and_then(|h| h["value"].as_str())
        .unwrap_or("")
        .to_string()
}

async fn classify_email(email: &EmailSummary) -> String {
    // Fast heuristics before hitting the LLM
    let subject_lower = email.subject.to_lowercase();
    let from_lower = email.from.to_lowercase();
    let snippet_lower = email.snippet.to_lowercase();

    // Meeting invite heuristics
    if subject_lower.contains("invitation")
        || subject_lower.contains("meeting invite")
        || email.labels.iter().any(|l| l == "CATEGORY_UPDATES")
            && subject_lower.contains("calendar")
    {
        return "meeting_invite".to_string();
    }

    // Invoice/receipt heuristics
    if email.has_attachment
        || subject_lower.contains("invoice")
        || subject_lower.contains("receipt")
        || subject_lower.contains("payment confirmation")
        || subject_lower.contains("order confirmation")
    {
        return "invoice".to_string();
    }

    // Spam/marketing heuristics
    let spam_signals = ["unsubscribe", "newsletter", "promo", "deal", "offer", "sale", "off!", "% off"];
    if spam_signals.iter().any(|kw| snippet_lower.contains(kw) || subject_lower.contains(kw)) {
        return "spam".to_string();
    }

    // LLM classification for everything else
    let prompt = format!(
        "Classify this email into exactly one category: critical, needs_response, fyi, spam, invoice, meeting_invite.\n\
         - critical: needs a reply TODAY (from manager/client, time-sensitive content)\n\
         - needs_response: needs a reply this week\n\
         - fyi: informational, no action needed\n\
         - spam: marketing or newsletters\n\
         - invoice: payment / receipt / order confirmation\n\
         - meeting_invite: calendar invite\n\n\
         From: {}\nSubject: {}\nPreview: {}\n\
         Reply with only the category word.",
        email.from, email.subject, email.snippet
    );

    llm_complete(&prompt).await
        .map(|s| s.trim().to_lowercase())
        .unwrap_or_else(|_| "fyi".to_string())
}

async fn check_calendar_conflict(email: &EmailSummary) -> bool {
    if !mcp_registered("calendar") {
        return false; // assume no conflict when no calendar is connected
    }

    // Extract event start time from the email subject/snippet via LLM
    let prompt = format!(
        "Extract the meeting start datetime (ISO 8601) from this email invite. \
         If you cannot determine it, output 'unknown'.\n\
         Subject: {}\nPreview: {}",
        email.subject, email.snippet
    );

    let dt_str = match llm_complete(&prompt).await {
        Ok(s) if !s.trim().eq_ignore_ascii_case("unknown") => s.trim().to_string(),
        _ => return false,
    };

    // Query calendar for that time slot
    let args = serde_json::json!({
        "timeMin": dt_str,
        "timeMax": dt_str, // narrow window — API returns events that overlap
        "maxResults": 5,
    });

    match calendar_call("gcal_list_events", args).await {
        Ok(raw) => {
            let v: serde_json::Value = serde_json::from_str(&raw).unwrap_or_default();
            v["items"].as_array().map(|a| !a.is_empty()).unwrap_or(false)
        }
        Err(_) => false,
    }
}

async fn accept_meeting_invite(email: &EmailSummary) -> Result<(), String> {
    if !mcp_registered("calendar") {
        return Ok(());
    }
    // Best-effort: respond_to_event requires a calendar event ID which we may not
    // have at this stage. Log the intent and return gracefully.
    log::info!(
        "[email_deep] would auto-accept invite: {} from {}",
        email.subject,
        email.from
    );
    Ok(())
}

// ── 2. draft_replies ──────────────────────────────────────────────────────────

/// For each email that needs a response, draft a context-aware reply using the
/// people_graph for tone, memory for context, and personality_mirror for style.
pub async fn draft_replies(emails: &[EmailSummary]) -> Result<Vec<DraftReply>, String> {
    let mut drafts = Vec::new();

    for email in emails {
        let draft = draft_one_reply(email).await?;
        drafts.push(draft);
    }

    Ok(drafts)
}

async fn draft_one_reply(email: &EmailSummary) -> Result<DraftReply, String> {
    // Sender name — strip the email address portion e.g. "Alice <alice@example.com>" → "Alice"
    let sender_name = email
        .from
        .split('<')
        .next()
        .map(|s| s.trim().to_string())
        .unwrap_or_else(|| email.from.clone());

    let person = crate::people_graph::get_person(&sender_name);

    // Build style hints
    let style_hint = crate::personality_mirror::load_profile()
        .map(|p| {
            format!(
                "formality={:.2}, avg_length={}, sign_off={}",
                p.formality_level, p.avg_message_length, p.sign_off_style
            )
        })
        .unwrap_or_else(|| "professional, moderate length".to_string());

    let relationship = person.as_ref()
        .map(|p| format!("{}, {} communication style", p.relationship, p.communication_style))
        .unwrap_or_else(|| "unknown — default to professional".to_string());

    let tone = person.as_ref()
        .map(|p| p.communication_style.clone())
        .unwrap_or_else(|| "formal".to_string());

    // Pull relevant memory — including pricing, past decisions, last conversation date
    let memory_context = {
        let tags = vec![sender_name.clone(), email.subject.clone()];
        let mems = crate::typed_memory::get_relevant_memories_for_context(&tags, 5);
        mems.iter()
            .map(|m| format!("[{}] {}", m.source, m.content))
            .collect::<Vec<_>>()
            .join("\n")
    };

    // Search conversation history for relevant prior threads
    let conversation_snippets = {
        use crate::embeddings::smart_context_recall;
        let query = format!("{} {}", sender_name, email.subject);
        smart_context_recall(&query, 3)
            .unwrap_or_default()
            .iter()
            .map(|s| s.as_str().to_string())
            .collect::<Vec<_>>()
            .join("\n---\n")
    };

    // Build a rich context block to include in draft
    let context_block = {
        let mut parts: Vec<String> = Vec::new();
        if !memory_context.is_empty() {
            parts.push(format!("Relevant memories about this person/topic:\n{memory_context}"));
        }
        if !conversation_snippets.is_empty() {
            parts.push(format!("Prior conversation context:\n{}", crate::safe_slice(&conversation_snippets, 1000)));
        }
        parts.join("\n\n")
    };

    // Detect routine confirmations that can be auto-handled
    let is_routine = is_routine_confirmation(&email.subject, &email.snippet);

    let prompt = if is_routine {
        format!(
            "Write a brief acknowledgement reply for this email.\n\
             From: {} ({})\nSubject: {}\nPreview: {}\n\
             Keep it to 1-2 sentences maximum.",
            email.from, relationship, email.subject, email.snippet
        )
    } else {
        format!(
            "Draft a reply to this email on behalf of the user.\n\
             Sender: {} | Relationship: {}\n\
             User's style: {}\n\
             {}\n\
             Subject: {}\nEmail preview: {}\n\n\
             IMPORTANT: If the context block mentions previous pricing, commitments, or dates, \
             naturally weave them into the reply so the user doesn't have to look them up. \
             For example: 'As I mentioned in our March 12 conversation, our pricing is $X/month.'\n\
             Match tone and length to the relationship. Do not add a subject line.",
            email.from, relationship, style_hint,
            if context_block.is_empty() { "No prior context found.".to_string() } else { context_block },
            email.subject, email.snippet
        )
    };

    let draft_body = llm_complete(&prompt).await?;

    // Auto-send routine replies if autonomy level is high enough
    let cfg = crate::config::load_config();
    let auto_sent = if is_routine && cfg.hive_autonomy >= 0.7 {
        send_email_draft(email, &draft_body).await.is_ok()
    } else {
        false
    };

    Ok(DraftReply {
        email: email.clone(),
        draft_body,
        auto_sent,
        tone,
    })
}

fn is_routine_confirmation(subject: &str, snippet: &str) -> bool {
    let combined = format!("{} {}", subject, snippet).to_lowercase();
    let routine_signals = [
        "got it",
        "confirming receipt",
        "thanks for sending",
        "noted",
        "will do",
        "sounds good",
        "confirmed",
        "acknowledged",
    ];
    routine_signals.iter().any(|kw| combined.contains(kw))
}

async fn send_email_draft(email: &EmailSummary, body: &str) -> Result<(), String> {
    if !mcp_registered("gmail") {
        log::info!("[email_deep] would auto-send reply to: {}", email.from);
        return Ok(());
    }

    let args = serde_json::json!({
        "to": email.from,
        "subject": format!("Re: {}", email.subject),
        "body": body,
        "threadId": email.thread_id,
    });

    gmail_call("gmail_create_draft", args).await.map(|_| ())
}

// ── 3. auto_unsubscribe ───────────────────────────────────────────────────────

/// For emails classified as spam/marketing, find the unsubscribe link and
/// use the browser CDP to visit it. Returns count of successful unsubscribes.
pub async fn auto_unsubscribe(emails: &[EmailSummary]) -> Result<u32, String> {
    let mut count = 0u32;

    for email in emails {
        if let Ok(link) = find_unsubscribe_link(email).await {
            if !link.is_empty() {
                match visit_unsubscribe_link(&link).await {
                    Ok(_) => {
                        count += 1;
                        log::info!(
                            "[email_deep] unsubscribed from: {} ({})",
                            email.from,
                            email.subject
                        );
                    }
                    Err(e) => {
                        log::warn!("[email_deep] unsubscribe failed for {}: {}", email.from, e);
                    }
                }
            }
        }
    }

    Ok(count)
}

/// Fetch the email body and extract the unsubscribe URL.
async fn find_unsubscribe_link(email: &EmailSummary) -> Result<String, String> {
    if !mcp_registered("gmail") {
        return Ok(String::new()); // no-op without live email access
    }

    let args = serde_json::json!({ "messageId": email.message_id });
    let raw = gmail_call("gmail_read_message", args).await?;

    // Try List-Unsubscribe header first (RFC 2369)
    if let Some(start) = raw.find("List-Unsubscribe:") {
        let header_section = &raw[start..];
        if let (Some(lt), Some(gt)) = (header_section.find('<'), header_section.find('>')) {
            let url = &header_section[lt + 1..gt];
            if url.starts_with("http") {
                return Ok(url.to_string());
            }
        }
    }

    // Fall back to LLM extraction from body
    let prompt = format!(
        "Find the unsubscribe URL in this email. If found, output only the URL. \
         If not found, output 'none'.\n\n{}",
        crate::safe_slice(&raw, 4000)
    );

    let result = llm_complete(&prompt).await.unwrap_or_default();
    let trimmed = result.trim().to_string();

    if trimmed.to_lowercase() == "none" || !trimmed.starts_with("http") {
        Ok(String::new())
    } else {
        Ok(trimmed)
    }
}

/// Use browser CDP to navigate to and click the unsubscribe link.
async fn visit_unsubscribe_link(url: &str) -> Result<(), String> {
    use crate::browser_native;

    // Open a session in the user's browser and navigate to the unsubscribe URL
    let session_id = browser_native::connect_to_user_browser()
        .await
        .unwrap_or_else(|_| "blade_unsub".to_string());

    browser_native::web_action(
        session_id.clone(),
        "navigate".to_string(),
        url.to_string(),
        String::new(),
    )
    .await?;

    // Brief pause for page load
    tokio::time::sleep(tokio::time::Duration::from_millis(1500)).await;

    // Click the first unsubscribe-like button on the page
    let click_script = r#"(function() {
        const kws = ['unsubscribe', 'opt out', 'opt-out', 'remove me', 'manage preferences'];
        const els = [...document.querySelectorAll('button, input[type=submit], a, [role=button]')];
        for (const kw of kws) {
            const el = els.find(e => e.innerText && e.innerText.toLowerCase().includes(kw));
            if (el) { el.click(); return 'clicked:' + kw; }
        }
        return 'no_button_found';
    })()"#;

    let result = browser_native::web_action(
        session_id,
        "eval".to_string(),
        click_script.to_string(),
        String::new(),
    )
    .await
    .unwrap_or_default();

    if result.contains("no_button_found") {
        log::warn!("[email_deep] no unsubscribe button found at {}", url);
    }

    Ok(())
}

// ── 4. detect_invoices ────────────────────────────────────────────────────────

/// Extract structured invoice/receipt data from emails and route to the
/// financial_brain for tracking.
pub async fn detect_invoices(emails: &[EmailSummary]) -> Result<Vec<Invoice>, String> {
    let mut invoices = Vec::new();

    for email in emails {
        if !looks_like_invoice(email) {
            continue;
        }

        let body = fetch_email_body(email).await.unwrap_or_else(|_| {
            format!("{} {}", email.subject, email.snippet)
        });

        if let Ok(invoice) = extract_invoice_data(email, &body).await {
            // Route to financial_brain
            route_to_financial_brain(&invoice);
            invoices.push(invoice);
        }
    }

    Ok(invoices)
}

fn looks_like_invoice(email: &EmailSummary) -> bool {
    let combined = format!("{} {} {}", email.subject, email.snippet,
        email.labels.join(" ")).to_lowercase();

    let signals = ["invoice", "receipt", "payment", "order confirmation",
                   "subscription renewal", "billing statement", "amount due", "due date"];
    email.has_attachment || signals.iter().any(|kw| combined.contains(kw))
}

async fn fetch_email_body(email: &EmailSummary) -> Result<String, String> {
    if !mcp_registered("gmail") {
        return Ok(email.snippet.clone());
    }

    let args = serde_json::json!({ "messageId": email.message_id });
    gmail_call("gmail_read_message", args).await
}

async fn extract_invoice_data(email: &EmailSummary, body: &str) -> Result<Invoice, String> {
    let prompt = format!(
        "Extract invoice/receipt data from this email. Respond in JSON with these fields:\n\
         vendor (string), amount (number), currency (3-letter code, default USD), \
         date (YYYY-MM-DD), due_date (YYYY-MM-DD or null), description (string).\n\n\
         From: {}\nSubject: {}\nBody: {}",
        email.from,
        email.subject,
        crate::safe_slice(body, 3000)
    );

    let response = llm_complete(&prompt).await?;

    // Strip markdown code fences if present
    let json_str = response
        .trim()
        .trim_start_matches("```json")
        .trim_start_matches("```")
        .trim_end_matches("```")
        .trim();

    let v: serde_json::Value = serde_json::from_str(json_str).map_err(|e| e.to_string())?;

    Ok(Invoice {
        email: email.clone(),
        vendor: v["vendor"].as_str().unwrap_or(&email.from).to_string(),
        amount: v["amount"].as_f64().unwrap_or(0.0),
        currency: v["currency"].as_str().unwrap_or("USD").to_string(),
        date: v["date"]
            .as_str()
            .unwrap_or(&email.date)
            .to_string(),
        due_date: v["due_date"].as_str().map(|s| s.to_string()),
        description: v["description"]
            .as_str()
            .unwrap_or(&email.subject)
            .to_string(),
    })
}

/// Push an invoice into financial_brain as a transaction for tracking.
fn route_to_financial_brain(invoice: &Invoice) {
    let content = format!(
        "Invoice from {} for {} {} on {} — {}",
        invoice.vendor, invoice.currency, invoice.amount, invoice.date, invoice.description
    );

    // Store as a typed memory so the financial brain can pick it up
    let _ = crate::typed_memory::store_typed_memory(
        crate::typed_memory::MemoryCategory::Fact,
        &content,
        &format!("email:invoice:{}", invoice.email.message_id),
        Some(0.9),
    );

    log::info!(
        "[email_deep] routed invoice to financial_brain: {} {} from {}",
        invoice.currency, invoice.amount, invoice.vendor
    );
}

// ── 5. Detect circular email threads ─────────────────────────────────────────

/// Find email threads that are going in circles: many replies, no clear decision.
/// Returns threads with a suggestion (schedule a meeting, make a direct decision, etc.)
pub async fn detect_circular_threads(emails: &[EmailSummary]) -> Result<Vec<CircularThread>, String> {
    // Group by thread_id
    let mut thread_map: std::collections::HashMap<String, Vec<&EmailSummary>> =
        std::collections::HashMap::new();
    for email in emails {
        if !email.thread_id.is_empty() {
            thread_map
                .entry(email.thread_id.clone())
                .or_default()
                .push(email);
        }
    }

    let mut circular = Vec::new();
    let decision_keywords = ["decided", "decision", "agreed", "confirmed", "let's go with", "done", "resolved"];

    for (thread_id, thread_emails) in &thread_map {
        if thread_emails.len() < 4 {
            continue;
        }

        // Fetch full thread to count actual replies
        let all_text: String = thread_emails
            .iter()
            .map(|e| format!("{} {}", e.subject, e.snippet))
            .collect::<Vec<_>>()
            .join(" ")
            .to_lowercase();

        let has_decision = decision_keywords.iter().any(|kw| all_text.contains(kw));
        if has_decision {
            continue;
        }

        let first = thread_emails.first().unwrap();
        let reply_count = thread_emails.len() as u32;

        // Parse age from date field (rough)
        let age_days = {
            let oldest_date = thread_emails
                .iter()
                .map(|e| e.date.clone())
                .min()
                .unwrap_or_default();
            // Simple heuristic: assume date is a unix timestamp string
            oldest_date.parse::<i64>()
                .map(|ts| {
                    let now = now_secs();
                    ((now - ts) / 86400).max(0) as u32
                })
                .unwrap_or(1)
        };

        if age_days < 1 && reply_count < 6 {
            continue; // too short / too recent
        }

        let suggestion_prompt = format!(
            "An email thread titled '{}' has {reply_count} replies over {age_days} days with no clear decision.\n\
             Suggest in one sentence the best next step (schedule a meeting, ask for a direct decision, etc.).",
            first.subject
        );

        let suggestion = llm_complete(&suggestion_prompt)
            .await
            .unwrap_or_else(|_| {
                "This thread has multiple replies with no resolution — consider scheduling a 15-minute call to decide.".to_string()
            });

        circular.push(CircularThread {
            thread_id: thread_id.clone(),
            subject: first.subject.clone(),
            reply_count,
            age_days,
            suggestion,
        });
    }

    Ok(circular)
}

// ── Simulated data (no MCP server) ───────────────────────────────────────────

fn simulated_emails() -> Vec<EmailSummary> {
    let now = now_secs();
    vec![
        EmailSummary {
            message_id: "sim_001".to_string(),
            thread_id: "thread_001".to_string(),
            from: "manager@company.com".to_string(),
            subject: "Q2 Roadmap Review — need your input by Friday".to_string(),
            snippet: "Please review the attached roadmap and add your team's deliverables.".to_string(),
            date: format!("{}", now - 3600),
            has_attachment: true,
            labels: vec!["INBOX".to_string(), "UNREAD".to_string()],
        },
        EmailSummary {
            message_id: "sim_002".to_string(),
            thread_id: "thread_002".to_string(),
            from: "noreply@saas.com".to_string(),
            subject: "Your monthly invoice from SaaS Co. — $49.00".to_string(),
            snippet: "Invoice #INV-2026-04 for your Pro subscription. Due April 30.".to_string(),
            date: format!("{}", now - 7200),
            has_attachment: true,
            labels: vec!["INBOX".to_string(), "UNREAD".to_string()],
        },
        EmailSummary {
            message_id: "sim_003".to_string(),
            thread_id: "thread_003".to_string(),
            from: "newsletter@techblog.com".to_string(),
            subject: "This week in tech — 50% off our course!".to_string(),
            snippet: "Unsubscribe | Limited time offer — use code SPRING50.".to_string(),
            date: format!("{}", now - 10800),
            has_attachment: false,
            labels: vec!["INBOX".to_string(), "UNREAD".to_string(), "CATEGORY_PROMOTIONS".to_string()],
        },
        EmailSummary {
            message_id: "sim_004".to_string(),
            thread_id: "thread_004".to_string(),
            from: "calendar-invite@meet.com".to_string(),
            subject: "Invitation: Design Sync @ Thu Apr 17, 2pm".to_string(),
            snippet: "You have been invited to Design Sync on Thursday April 17 at 2:00 PM.".to_string(),
            date: format!("{}", now - 1800),
            has_attachment: false,
            labels: vec!["INBOX".to_string(), "UNREAD".to_string()],
        },
    ]
}
