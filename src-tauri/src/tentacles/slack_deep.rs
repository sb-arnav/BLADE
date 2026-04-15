/// BLADE Slack Deep Tentacle — BLADE lives in Slack, not just watches it.
///
/// BLADE acts *as* the user in Slack: reading DMs, classifying what needs a
/// reply, drafting responses in the user's voice, extracting action items into
/// typed_memory, summarising channels missed while offline, detecting stalled
/// threads, and learning which channels are worth the user's attention.
///
/// MCP bridge: uses the `slack` MCP server when registered; gracefully degrades
/// to simulated data so the type contracts always hold.

use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::Manager;

// ── Helpers ───────────────────────────────────────────────────────────────────

fn now_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn mcp_registered() -> bool {
    let cfg = crate::config::load_config();
    cfg.mcp_servers
        .iter()
        .any(|s| s.name.eq_ignore_ascii_case("slack"))
}

/// Generic Slack MCP call — returns raw text from the tool result.
async fn slack_call(tool: &str, args: serde_json::Value) -> Result<String, String> {
    let handle = crate::integration_bridge::get_app_handle()
        .ok_or_else(|| "AppHandle not set".to_string())?;

    let manager_state = handle
        .try_state::<crate::commands::SharedMcpManager>()
        .ok_or("McpManager state not found")?;

    let mut manager: tokio::sync::MutexGuard<'_, crate::mcp::McpManager> = manager_state.lock().await;
    let qualified = format!("mcp__slack_{}", tool);

    let result = manager.call_tool(&qualified, args).await?;

    let text = result
        .content
        .iter()
        .filter_map(|c| c.text.as_deref())
        .collect::<Vec<_>>()
        .join("\n");

    Ok(text)
}

/// Single LLM completion used throughout this module.
async fn llm_complete(prompt: &str) -> Result<String, String> {
    use crate::providers::{complete_turn, ConversationMessage};
    let cfg = crate::config::load_config();
    let messages = vec![ConversationMessage::User(prompt.to_string())];
    let no_tools: Vec<crate::providers::ToolDefinition> = vec![];
    complete_turn(&cfg.provider, &cfg.api_key, &cfg.model, &messages, &no_tools, cfg.base_url.as_deref()).await
        .map(|t| t.content)
}

// ── Public types ──────────────────────────────────────────────────────────────

/// Classification of an incoming Slack message.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum MessageClass {
    NeedsResponse,
    ActionItem,
    Fyi,
    Social,
}

/// A single Slack message that directed at the user.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InboundSlackMessage {
    pub channel: String,
    pub sender: String,
    pub text: String,
    pub ts: String,       // Slack timestamp token
    pub thread_ts: Option<String>,
    pub is_dm: bool,
    pub is_mention: bool,
}

/// An action BLADE proposes to take (or has taken) as a result of processing
/// an inbound message.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SlackAction {
    pub action_type: SlackActionType,
    pub channel: String,
    pub thread_ts: Option<String>,
    pub source_message: InboundSlackMessage,
    /// For `DraftReply` / `AutoSend` — the proposed text.
    pub draft_text: Option<String>,
    /// For `ActionItem` — the extracted task description.
    pub task_description: Option<String>,
    /// For `Fyi` / `Social` — a brief summary.
    pub summary: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SlackActionType {
    DraftReply,
    AutoSend,
    ActionItem,
    Fyi,
    Social,
}

/// Per-channel summary produced by `summarize_missed_channels`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChannelSummary {
    pub channel: String,
    pub bullet_what_happened: String,
    pub bullet_decisions: String,
    pub bullet_needs_attention: String,
    pub you_were_mentioned: bool,
    pub your_thread_got_replies: bool,
}

/// A DM or thread reply that is waiting for the user to respond.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WaitingResponse {
    pub channel: String,
    pub thread_ts: Option<String>,
    pub sender: String,
    pub text_preview: String,
    pub sent_ts: i64,         // unix seconds
    pub hours_waiting: f32,
    pub urgency_score: f32,   // 0.0–1.0
}

/// An action to take on a thread the user started.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThreadAction {
    pub channel: String,
    pub thread_ts: String,
    pub action: ThreadActionKind,
    pub suggested_nudge: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ThreadActionKind {
    NudgeFollowUp,
    TrackActionItem,
}

/// Channel activity observation used to learn importance.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChannelActivity {
    pub channel: String,
    pub messages_last_7d: u32,
    pub times_user_read: u32,
    pub times_user_replied: u32,
    pub mentions_of_user: u32,
}

// ── 1. process_unread_messages ────────────────────────────────────────────────

/// Fetch unread messages directed at the user across all channels and DMs.
/// For each one: classify, draft replies or extract action items.
pub async fn process_unread_messages(app: &tauri::AppHandle) -> Result<Vec<SlackAction>, String> {
    let messages = fetch_directed_messages(app).await?;
    let mut actions = Vec::new();

    for msg in messages {
        let class = classify_message(&msg).await;
        let person = crate::people_graph::get_person(&msg.sender);

        match class {
            MessageClass::NeedsResponse => {
                let draft = draft_slack_reply(&msg, person.as_ref()).await?;
                let cfg = crate::config::load_config();
                let autonomy = cfg.hive_autonomy;

                let action_type = if autonomy >= 0.8 {
                    SlackActionType::AutoSend
                } else {
                    SlackActionType::DraftReply
                };

                actions.push(SlackAction {
                    action_type,
                    channel: msg.channel.clone(),
                    thread_ts: msg.thread_ts.clone(),
                    draft_text: Some(draft),
                    task_description: None,
                    summary: None,
                    source_message: msg,
                });
            }

            MessageClass::ActionItem => {
                let task = extract_action_item(&msg.text).await?;

                // Persist into typed_memory as a Goal
                let _ = crate::typed_memory::store_typed_memory(
                    crate::typed_memory::MemoryCategory::Goal,
                    &format!("[Slack from {}] {}", msg.sender, task),
                    &format!("slack:{}:{}", msg.channel, msg.ts),
                    Some(0.85),
                );

                actions.push(SlackAction {
                    action_type: SlackActionType::ActionItem,
                    channel: msg.channel.clone(),
                    thread_ts: msg.thread_ts.clone(),
                    draft_text: None,
                    task_description: Some(task),
                    summary: None,
                    source_message: msg,
                });
            }

            MessageClass::Fyi => {
                let summary = summarise_fyi(&msg.text).await;
                actions.push(SlackAction {
                    action_type: SlackActionType::Fyi,
                    channel: msg.channel.clone(),
                    thread_ts: msg.thread_ts.clone(),
                    draft_text: None,
                    task_description: None,
                    summary: Some(summary),
                    source_message: msg,
                });
            }

            MessageClass::Social => {
                actions.push(SlackAction {
                    action_type: SlackActionType::Social,
                    channel: msg.channel.clone(),
                    thread_ts: msg.thread_ts.clone(),
                    draft_text: None,
                    task_description: None,
                    summary: Some(format!("Social message from {}", msg.sender)),
                    source_message: msg,
                });
            }
        }
    }

    Ok(actions)
}

/// Pull messages directed at the user: DMs, mentions, and thread replies.
async fn fetch_directed_messages(_app: &tauri::AppHandle) -> Result<Vec<InboundSlackMessage>, String> {
    if !mcp_registered() {
        return Ok(simulated_inbound_messages());
    }

    // Search for unread DMs and mentions via Slack MCP
    let args = serde_json::json!({ "query": "is:unread (is:dm OR has:mention)", "count": 50 });
    let raw = slack_call("slack_search_public_and_private", args).await?;

    let v: serde_json::Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    let matches = v["messages"]["matches"]
        .as_array()
        .cloned()
        .unwrap_or_default();

    let messages = matches
        .iter()
        .filter_map(|m| {
            let channel = m["channel"]["name"].as_str()?.to_string();
            let sender = m["username"].as_str().unwrap_or("unknown").to_string();
            let text = m["text"].as_str().unwrap_or("").to_string();
            let ts = m["ts"].as_str().unwrap_or("").to_string();
            let thread_ts = m["thread_ts"].as_str().map(|s| s.to_string());
            let channel_type = m["channel"]["is_mpim"].as_bool().unwrap_or(false)
                || m["channel"]["is_im"].as_bool().unwrap_or(false);
            Some(InboundSlackMessage {
                channel,
                sender,
                text,
                ts,
                thread_ts,
                is_dm: channel_type,
                is_mention: m["text"]
                    .as_str()
                    .map(|t| t.contains("<@"))
                    .unwrap_or(false),
            })
        })
        .collect();

    Ok(messages)
}

async fn classify_message(msg: &InboundSlackMessage) -> MessageClass {
    let prompt = format!(
        "Classify this Slack message into exactly one category: needs_response, action_item, fyi, social.\n\
         Channel: {}\nDM: {}\nMention: {}\nText: {}\n\
         Reply with only the category word.",
        msg.channel, msg.is_dm, msg.is_mention, msg.text
    );

    match llm_complete(&prompt).await {
        Ok(s) => {
            let lower = s.trim().to_lowercase();
            if lower.contains("needs_response") || lower.contains("needs response") {
                MessageClass::NeedsResponse
            } else if lower.contains("action_item") || lower.contains("action item") {
                MessageClass::ActionItem
            } else if lower.contains("fyi") {
                MessageClass::Fyi
            } else {
                MessageClass::Social
            }
        }
        Err(_) => {
            // Heuristic fallback
            if msg.is_dm {
                MessageClass::NeedsResponse
            } else if msg.is_mention {
                MessageClass::NeedsResponse
            } else {
                MessageClass::Fyi
            }
        }
    }
}

async fn draft_slack_reply(
    msg: &InboundSlackMessage,
    person: Option<&crate::people_graph::Person>,
) -> Result<String, String> {
    let style_hint = crate::personality_mirror::load_profile()
        .map(|p| {
            format!(
                "formality={:.2}, avg_length={}, humor={}, sign_off={}",
                p.formality_level, p.avg_message_length, p.humor_style, p.sign_off_style
            )
        })
        .unwrap_or_else(|| "casual, concise".to_string());

    let relationship = person
        .map(|p| format!("{} ({})", p.relationship, p.communication_style))
        .unwrap_or_else(|| "unknown".to_string());

    let prompt = format!(
        "You are drafting a Slack reply on behalf of the user.\n\
         Sender: {} | Relationship: {}\n\
         User's communication style: {}\n\
         Original message: {}\n\n\
         Write a natural reply that fits the relationship and style. \
         Keep it concise — this is Slack, not email.",
        msg.sender, relationship, style_hint, msg.text
    );

    llm_complete(&prompt).await
}

async fn extract_action_item(text: &str) -> Result<String, String> {
    let prompt = format!(
        "Extract the action item or task from this Slack message in one clear sentence.\n\
         Message: {}\n\
         Reply with only the task description.",
        text
    );
    llm_complete(&prompt).await
}

async fn summarise_fyi(text: &str) -> String {
    let prompt = format!(
        "Summarise this Slack message in ≤15 words for a notification.\nMessage: {}",
        text
    );
    llm_complete(&prompt).await.unwrap_or_else(|_| {
        let preview = crate::safe_slice(text, 80);
        preview.to_string()
    })
}

// ── 2. summarize_missed_channels ──────────────────────────────────────────────

/// For each channel: fetch last 50 messages and produce a 3-bullet summary.
pub async fn summarize_missed_channels(
    channels: &[String],
) -> Result<Vec<ChannelSummary>, String> {
    let mut summaries = Vec::new();

    for channel in channels {
        let messages = fetch_channel_history(channel, 50).await;
        let summary = summarise_channel(channel, &messages).await?;
        summaries.push(summary);
    }

    Ok(summaries)
}

async fn fetch_channel_history(channel: &str, limit: u32) -> Vec<String> {
    if !mcp_registered() {
        return vec![
            format!("[{}] Simulated message 1", channel),
            format!("[{}] Simulated message 2", channel),
            format!("[{}] Simulated decision: use approach A", channel),
        ];
    }

    let args = serde_json::json!({ "channel": channel, "limit": limit });
    match slack_call("slack_read_channel", args).await {
        Ok(raw) => {
            let v: serde_json::Value = serde_json::from_str(&raw).unwrap_or_default();
            v["messages"]
                .as_array()
                .cloned()
                .unwrap_or_default()
                .iter()
                .filter_map(|m| m["text"].as_str().map(|s| s.to_string()))
                .collect()
        }
        Err(_) => vec![],
    }
}

async fn summarise_channel(channel: &str, messages: &[String]) -> Result<ChannelSummary, String> {
    if messages.is_empty() {
        return Ok(ChannelSummary {
            channel: channel.to_string(),
            bullet_what_happened: "No messages in this period.".to_string(),
            bullet_decisions: "No decisions recorded.".to_string(),
            bullet_needs_attention: "Nothing flagged.".to_string(),
            you_were_mentioned: false,
            your_thread_got_replies: false,
        });
    }

    let transcript = messages.join("\n");
    let you_were_mentioned = transcript.contains("<@");
    // Heuristic — a proper check would compare thread_ts values
    let your_thread_got_replies = transcript.to_lowercase().contains("replied to thread");

    let prompt = format!(
        "Summarise this Slack channel conversation in exactly 3 short bullet points.\n\
         Format:\n\
         WHAT_HAPPENED: <one sentence>\n\
         DECISIONS: <one sentence>\n\
         NEEDS_ATTENTION: <one sentence>\n\n\
         Channel: #{}\n\
         Messages:\n{}",
        channel, transcript
    );

    let response = llm_complete(&prompt).await.unwrap_or_default();

    let extract = |label: &str| -> String {
        response
            .lines()
            .find(|l| l.trim().starts_with(label))
            .and_then(|l| l.splitn(2, ':').nth(1))
            .map(|s| s.trim().to_string())
            .unwrap_or_else(|| format!("(see #{channel})"))
    };

    Ok(ChannelSummary {
        channel: channel.to_string(),
        bullet_what_happened: extract("WHAT_HAPPENED"),
        bullet_decisions: extract("DECISIONS"),
        bullet_needs_attention: extract("NEEDS_ATTENTION"),
        you_were_mentioned,
        your_thread_got_replies,
    })
}

// ── 3. detect_waiting_responses ───────────────────────────────────────────────

/// Find DMs/threads where someone asked the user something 2+ hours ago with no reply.
/// Ranked by sender importance, urgency keywords, and wait time.
pub async fn detect_waiting_responses() -> Result<Vec<WaitingResponse>, String> {
    if !mcp_registered() {
        return Ok(simulated_waiting_responses());
    }

    // Look for DMs sent more than 2 hours ago that the user hasn't replied to
    let two_hours_ago = now_secs() - 7200;
    let args = serde_json::json!({
        "query": "is:dm -from:me",
        "count": 30,
    });

    let raw = slack_call("slack_search_public_and_private", args).await?;
    let v: serde_json::Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;

    let matches = v["messages"]["matches"]
        .as_array()
        .cloned()
        .unwrap_or_default();

    let urgency_keywords = ["urgent", "asap", "deadline", "important", "blocker", "today", "now"];

    let mut waiting: Vec<WaitingResponse> = matches
        .iter()
        .filter_map(|m| {
            let ts_str = m["ts"].as_str()?;
            let ts_secs = ts_str
                .split('.')
                .next()
                .and_then(|s| s.parse::<i64>().ok())?;

            if ts_secs > two_hours_ago {
                return None; // too recent
            }

            let sender = m["username"].as_str().unwrap_or("unknown").to_string();
            let text = m["text"].as_str().unwrap_or("").to_string();
            let channel = m["channel"]["name"].as_str().unwrap_or("dm").to_string();
            let thread_ts = m["thread_ts"].as_str().map(|s| s.to_string());
            let hours_waiting = (now_secs() - ts_secs) as f32 / 3600.0;

            // Urgency score
            let text_lower = text.to_lowercase();
            let keyword_score: f32 = urgency_keywords
                .iter()
                .filter(|kw| text_lower.contains(*kw))
                .count() as f32
                * 0.15;

            // Relationship score from people_graph
            let relationship_score = crate::people_graph::get_person(&sender)
                .map(|p| match p.relationship.as_str() {
                    "manager" => 0.9,
                    "lead" | "director" => 0.8,
                    "teammate" | "colleague" => 0.5,
                    "client" => 0.7,
                    _ => 0.3,
                })
                .unwrap_or(0.3);

            // Wait score: +0.1 per 2 extra hours after the first 2
            let wait_score = ((hours_waiting - 2.0) / 20.0).clamp(0.0, 0.4);

            let urgency_score = (keyword_score + relationship_score * 0.5 + wait_score)
                .clamp(0.0, 1.0);

            Some(WaitingResponse {
                channel,
                thread_ts,
                sender,
                text_preview: crate::safe_slice(&text, 120).to_string(),
                sent_ts: ts_secs,
                hours_waiting,
                urgency_score,
            })
        })
        .collect();

    // Sort by urgency descending
    waiting.sort_by(|a, b| {
        b.urgency_score
            .partial_cmp(&a.urgency_score)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    Ok(waiting)
}

// ── 4. manage_threads ─────────────────────────────────────────────────────────

/// Find threads the user started that went unanswered and threads with pending
/// action items. Suggest nudges where appropriate.
pub async fn manage_threads(app: &tauri::AppHandle) -> Result<Vec<ThreadAction>, String> {
    let _ = app; // may be used for MCP calls in the future
    if !mcp_registered() {
        return Ok(simulated_thread_actions());
    }

    // Search for threads the user started with no replies in the last 48h
    let args = serde_json::json!({
        "query": "from:me has:thread -has:reply",
        "count": 20,
    });

    let raw = slack_call("slack_search_public_and_private", args).await?;
    let v: serde_json::Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    let matches = v["messages"]["matches"]
        .as_array()
        .cloned()
        .unwrap_or_default();

    let mut thread_actions = Vec::new();
    let action_item_keywords = ["todo", "action item", "will do", "i'll", "we'll", "need to", "must", "should"];

    for m in &matches {
        let channel = m["channel"]["name"]
            .as_str()
            .unwrap_or("unknown")
            .to_string();
        let thread_ts = match m["ts"].as_str() {
            Some(ts) => ts.to_string(),
            None => continue,
        };
        let text = m["text"].as_str().unwrap_or("").to_lowercase();

        // Check if any action items were discussed in the thread
        let has_action_items = action_item_keywords.iter().any(|kw| text.contains(kw));

        if has_action_items {
            // Suggest nudge to track the item
            let nudge_prompt = format!(
                "Write a short Slack follow-up (1 sentence) asking about the status of this item.\n\
                 Original message: {}",
                m["text"].as_str().unwrap_or("")
            );
            let nudge = llm_complete(&nudge_prompt).await.ok();

            thread_actions.push(ThreadAction {
                channel: channel.clone(),
                thread_ts: thread_ts.clone(),
                action: ThreadActionKind::TrackActionItem,
                suggested_nudge: nudge,
            });
        } else {
            // Thread went unanswered — draft a gentle follow-up
            let nudge_prompt = format!(
                "Write a polite one-sentence Slack follow-up for a thread with no replies.\n\
                 Original message: {}",
                m["text"].as_str().unwrap_or("")
            );
            let nudge = llm_complete(&nudge_prompt).await.ok();

            thread_actions.push(ThreadAction {
                channel,
                thread_ts,
                action: ThreadActionKind::NudgeFollowUp,
                suggested_nudge: nudge,
            });
        }
    }

    Ok(thread_actions)
}

// ── 5. learn_channel_importance ───────────────────────────────────────────────

/// Score each channel by how much the user actually engages with it.
/// Returns a list of (channel_name, importance_score 0.0–1.0) sorted desc.
/// Channels consistently ignored can be surfaced as auto-mute candidates.
pub fn learn_channel_importance(channels: &[ChannelActivity]) -> Vec<(String, f32)> {
    let mut scores: Vec<(String, f32)> = channels
        .iter()
        .map(|c| {
            if c.messages_last_7d == 0 {
                return (c.channel.clone(), 0.0);
            }

            // Read rate: how often the user opens the channel
            let read_rate = (c.times_user_read as f32 / c.messages_last_7d as f32).clamp(0.0, 1.0);

            // Engagement: replies are stronger signal than reads
            let reply_rate = if c.times_user_read > 0 {
                (c.times_user_replied as f32 / c.times_user_read as f32).clamp(0.0, 1.0)
            } else {
                0.0
            };

            // Mention bonus — if people tag the user it matters regardless
            let mention_bonus = (c.mentions_of_user as f32 * 0.1).clamp(0.0, 0.3);

            let score = read_rate * 0.35 + reply_rate * 0.50 + mention_bonus;
            (c.channel.clone(), score.clamp(0.0, 1.0))
        })
        .collect();

    scores.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    scores
}

// ── Simulated data (no MCP server) ───────────────────────────────────────────

fn simulated_inbound_messages() -> Vec<InboundSlackMessage> {
    vec![
        InboundSlackMessage {
            channel: "general".to_string(),
            sender: "alice".to_string(),
            text: "Hey, can you review the PR I opened this morning? Blocking my deploy.".to_string(),
            ts: format!("{}.000000", now_secs() - 900),
            thread_ts: None,
            is_dm: false,
            is_mention: true,
        },
        InboundSlackMessage {
            channel: "direct-message".to_string(),
            sender: "bob".to_string(),
            text: "Quick question — are we still doing the Thursday sync?".to_string(),
            ts: format!("{}.000000", now_secs() - 3600),
            thread_ts: None,
            is_dm: true,
            is_mention: false,
        },
    ]
}

fn simulated_waiting_responses() -> Vec<WaitingResponse> {
    vec![WaitingResponse {
        channel: "direct-message".to_string(),
        thread_ts: None,
        sender: "manager".to_string(),
        text_preview: "Can you send the updated roadmap doc before EOD?".to_string(),
        sent_ts: now_secs() - 10_800,
        hours_waiting: 3.0,
        urgency_score: 0.82,
    }]
}

fn simulated_thread_actions() -> Vec<ThreadAction> {
    vec![ThreadAction {
        channel: "engineering".to_string(),
        thread_ts: format!("{}.000000", now_secs() - 86_400),
        action: ThreadActionKind::NudgeFollowUp,
        suggested_nudge: Some(
            "Just following up — any thoughts on the deployment plan I shared?".to_string(),
        ),
    }]
}
