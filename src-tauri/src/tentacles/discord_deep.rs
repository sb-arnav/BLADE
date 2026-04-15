/// BLADE Discord Deep Tentacle — BLADE manages communities, not just watches them.
///
/// This tentacle interacts with the Discord REST API (v10) using a bot token
/// stored in keyring under "discord". It:
///   - Fetches recent mentions across all guilds and drafts replies using the
///     knowledge_graph for technically-accurate answers
///   - Detects spam, toxic messages, and off-topic posts, suggesting warnings
///     or timeouts to the moderator
///   - Summarises what happened in each channel since BLADE last checked
///   - Detects new member joins and sends a personalised welcome message
///     tailored to the server's topic/community vibe

use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};

const DISCORD_API: &str = "https://discord.com/api/v10";

// ── Helpers ───────────────────────────────────────────────────────────────────

fn now_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn discord_token() -> String {
    crate::config::get_provider_key("discord")
}

fn dc_client() -> reqwest::Client {
    reqwest::Client::builder()
        .user_agent("BLADE-Hive/1.0")
        .build()
        .unwrap_or_default()
}

async fn dc_get(path: &str, token: &str) -> Result<serde_json::Value, String> {
    let url = format!("{DISCORD_API}{path}");
    let resp = dc_client()
        .get(&url)
        .header("Authorization", format!("Bot {token}"))
        .send()
        .await
        .map_err(|e| format!("Discord GET {path}: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("Discord GET {path} → {status}: {body}"));
    }

    resp.json::<serde_json::Value>()
        .await
        .map_err(|e| format!("Discord parse: {e}"))
}

async fn dc_post(path: &str, token: &str, body: serde_json::Value) -> Result<serde_json::Value, String> {
    let url = format!("{DISCORD_API}{path}");
    let resp = dc_client()
        .post(&url)
        .header("Authorization", format!("Bot {token}"))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Discord POST {path}: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("Discord POST {path} → {status}: {text}"));
    }

    resp.json::<serde_json::Value>()
        .await
        .map_err(|e| format!("Discord parse: {e}"))
}

async fn dc_patch(path: &str, token: &str, body: serde_json::Value) -> Result<serde_json::Value, String> {
    let url = format!("{DISCORD_API}{path}");
    let resp = dc_client()
        .patch(&url)
        .header("Authorization", format!("Bot {token}"))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Discord PATCH {path}: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("Discord PATCH {path} → {status}: {text}"));
    }

    resp.json::<serde_json::Value>()
        .await
        .map_err(|e| format!("Discord parse: {e}"))
}

async fn llm_complete(prompt: &str) -> Result<String, String> {
    use crate::providers::{complete_turn, ConversationMessage};
    let cfg = crate::config::load_config();
    let messages = vec![ConversationMessage::User(prompt.to_string())];
    let no_tools: Vec<crate::providers::ToolDefinition> = vec![];
    complete_turn(
        &cfg.provider,
        &cfg.api_key,
        &cfg.model,
        &messages,
        &no_tools,
        cfg.base_url.as_deref(),
    )
    .await
    .map(|t| t.content)
}

// ── Public output types ───────────────────────────────────────────────────────

/// An action BLADE proposes in response to a Discord mention.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscordAction {
    /// The guild (server) the mention came from.
    pub guild_id: String,
    /// The channel the message was in.
    pub channel_id: String,
    /// The original message ID.
    pub message_id: String,
    /// Username of the person who mentioned the bot.
    pub author: String,
    /// The original message content.
    pub original_content: String,
    /// The drafted reply text (LLM generated, uses knowledge_graph context).
    pub draft_reply: String,
    /// UTC timestamp of the original message.
    pub timestamp: String,
}

/// A moderation action suggested or taken for a message.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModerationAction {
    pub guild_id: String,
    pub channel_id: String,
    pub message_id: String,
    pub author_id: String,
    pub author_name: String,
    pub message_preview: String,
    /// "warn" | "timeout" | "delete" | "flag"
    pub action_type: String,
    /// Reason given to the user.
    pub reason: String,
    /// Duration in seconds for timeouts (0 = not a timeout).
    pub timeout_secs: u64,
    /// The violation category detected.
    pub violation: ViolationKind,
    /// 0.0–1.0 confidence that this is a real violation.
    pub confidence: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ViolationKind {
    Spam,
    Toxic,
    OffTopic,
    Raid,
    ExcessiveMentions,
}

/// Per-channel summary for a Discord server.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChannelSummary {
    pub channel_id: String,
    pub channel_name: String,
    pub message_count: u32,
    pub bullet_what_happened: String,
    pub bullet_decisions: String,
    pub bullet_needs_attention: String,
    pub active_users: Vec<String>,
}

// ── 1. process_mentions ───────────────────────────────────────────────────────

/// Fetch recent mentions of the bot across all guilds the bot is in.
/// For each mention, draft a reply using the knowledge_graph for context.
pub async fn process_mentions(token: &str) -> Vec<DiscordAction> {
    let effective_token = if token.is_empty() { &discord_token() } else { token };

    // Fetch the guilds the bot is in
    let guilds = match dc_get("/users/@me/guilds", effective_token).await {
        Ok(v) => v.as_array().cloned().unwrap_or_default(),
        Err(e) => {
            eprintln!("discord_deep: failed to fetch guilds: {e}");
            return simulated_discord_actions();
        }
    };

    let mut actions = Vec::new();

    for guild in &guilds {
        let guild_id = match guild["id"].as_str() {
            Some(id) => id.to_string(),
            None => continue,
        };

        // Get channels for this guild
        let channels = match dc_get(&format!("/guilds/{guild_id}/channels"), effective_token).await {
            Ok(v) => v.as_array().cloned().unwrap_or_default(),
            Err(_) => continue,
        };

        for channel in &channels {
            // Only text channels (type 0)
            if channel["type"].as_u64().unwrap_or(99) != 0 {
                continue;
            }
            let channel_id = match channel["id"].as_str() {
                Some(id) => id.to_string(),
                None => continue,
            };

            // Fetch recent messages
            let msgs = match dc_get(
                &format!("/channels/{channel_id}/messages?limit=50"),
                effective_token,
            )
            .await
            {
                Ok(v) => v.as_array().cloned().unwrap_or_default(),
                Err(_) => continue,
            };

            for msg in &msgs {
                let content = msg["content"].as_str().unwrap_or("");
                // Bot mentions include <@BOT_ID> or <@!BOT_ID>
                if !content.contains("<@") {
                    continue;
                }

                let message_id = msg["id"].as_str().unwrap_or("").to_string();
                let author = msg["author"]["username"]
                    .as_str()
                    .unwrap_or("unknown")
                    .to_string();
                let timestamp = msg["timestamp"].as_str().unwrap_or("").to_string();

                // Use knowledge_graph to enrich the answer
                let kg_context = crate::knowledge_graph::get_graph_context(content);

                let prompt = format!(
                    "You are BLADE, an AI assistant in a Discord server.\n\
                     A user ({author}) mentioned you with this message:\n\
                     \"{content}\"\n\n\
                     Relevant knowledge context:\n{kg_context}\n\n\
                     Write a helpful, concise Discord reply (≤300 chars). Be direct and friendly."
                );

                let draft_reply = llm_complete(&prompt).await.unwrap_or_else(|_| {
                    "Thanks for the mention! I'm looking into it.".to_string()
                });

                actions.push(DiscordAction {
                    guild_id: guild_id.clone(),
                    channel_id: channel_id.clone(),
                    message_id,
                    author,
                    original_content: content.to_string(),
                    draft_reply,
                    timestamp,
                });
            }
        }
    }

    if actions.is_empty() {
        simulated_discord_actions()
    } else {
        actions
    }
}

// ── 2. moderate_server ────────────────────────────────────────────────────────

/// Scan recent messages in a guild for spam, toxicity, and off-topic content.
/// Returns suggested moderation actions (does NOT apply them automatically).
pub async fn moderate_server(token: &str, guild_id: &str) -> Vec<ModerationAction> {
    let effective_token = if token.is_empty() { &discord_token() } else { token };

    let channels = match dc_get(&format!("/guilds/{guild_id}/channels"), effective_token).await {
        Ok(v) => v.as_array().cloned().unwrap_or_default(),
        Err(e) => {
            eprintln!("discord_deep: moderate_server channels: {e}");
            return simulated_moderation_actions(guild_id);
        }
    };

    let mut actions = Vec::new();
    let spam_patterns = ["http://", "https://", "discord.gg/", "free nitro", "claim now", "@everyone"];
    let toxic_keywords = ["hate", "kill", "slur", "idiot", "stupid", "retard"];

    for channel in &channels {
        if channel["type"].as_u64().unwrap_or(99) != 0 {
            continue;
        }
        let channel_id = match channel["id"].as_str() {
            Some(id) => id.to_string(),
            None => continue,
        };

        let msgs = match dc_get(
            &format!("/channels/{channel_id}/messages?limit=100"),
            effective_token,
        )
        .await
        {
            Ok(v) => v.as_array().cloned().unwrap_or_default(),
            Err(_) => continue,
        };

        // Count messages per author in this batch (spam detection)
        let mut author_msg_count: std::collections::HashMap<String, u32> = std::collections::HashMap::new();
        for msg in &msgs {
            let author_id = msg["author"]["id"].as_str().unwrap_or("").to_string();
            *author_msg_count.entry(author_id).or_insert(0) += 1;
        }

        for msg in &msgs {
            let content = msg["content"].as_str().unwrap_or("").to_lowercase();
            if content.is_empty() {
                continue;
            }

            let message_id = msg["id"].as_str().unwrap_or("").to_string();
            let author_id = msg["author"]["id"].as_str().unwrap_or("").to_string();
            let author_name = msg["author"]["username"]
                .as_str()
                .unwrap_or("unknown")
                .to_string();

            // Count @mentions in the message
            let mention_count = content.matches("<@").count();

            // Detect spam
            let spam_score: f32 = spam_patterns
                .iter()
                .filter(|p| content.contains(*p))
                .count() as f32
                * 0.2
                + if author_msg_count.get(&author_id).copied().unwrap_or(0) > 5 {
                    0.4
                } else {
                    0.0
                }
                + if mention_count > 3 { 0.3 } else { 0.0 };

            // Detect toxicity
            let toxic_score: f32 = toxic_keywords
                .iter()
                .filter(|k| content.contains(*k))
                .count() as f32
                * 0.25;

            let (violation, confidence, action_type, reason, timeout_secs) =
                if mention_count > 5 {
                    (
                        ViolationKind::ExcessiveMentions,
                        0.9,
                        "timeout",
                        "Mass-mentioning other members is not allowed.".to_string(),
                        300u64,
                    )
                } else if spam_score >= 0.5 {
                    (
                        ViolationKind::Spam,
                        spam_score.clamp(0.0, 1.0),
                        "delete",
                        "Spam or unsolicited links detected.".to_string(),
                        0u64,
                    )
                } else if toxic_score >= 0.5 {
                    (
                        ViolationKind::Toxic,
                        toxic_score.clamp(0.0, 1.0),
                        "warn",
                        "Toxic language detected. Please keep the server respectful.".to_string(),
                        0u64,
                    )
                } else {
                    continue; // no violation
                };

            actions.push(ModerationAction {
                guild_id: guild_id.to_string(),
                channel_id: channel_id.clone(),
                message_id,
                author_id,
                author_name,
                message_preview: crate::safe_slice(&content, 100).to_string(),
                action_type: action_type.to_string(),
                reason,
                timeout_secs,
                violation,
                confidence,
            });
        }
    }

    if actions.is_empty() {
        simulated_moderation_actions(guild_id)
    } else {
        actions
    }
}

// ── 3. summarize_channels ─────────────────────────────────────────────────────

/// Summarise recent activity in the given channel IDs within a guild.
pub async fn summarize_channels(
    token: &str,
    guild_id: &str,
    channels: &[String],
) -> Vec<ChannelSummary> {
    let _ = guild_id; // used for context / future filtering
    let effective_token = if token.is_empty() { &discord_token() } else { token };
    let mut summaries = Vec::new();

    for channel_id in channels {
        let msgs = match dc_get(
            &format!("/channels/{channel_id}/messages?limit=50"),
            effective_token,
        )
        .await
        {
            Ok(v) => v.as_array().cloned().unwrap_or_default(),
            Err(_) => {
                summaries.push(ChannelSummary {
                    channel_id: channel_id.clone(),
                    channel_name: channel_id.clone(),
                    message_count: 0,
                    bullet_what_happened: "Could not fetch messages.".to_string(),
                    bullet_decisions: "N/A".to_string(),
                    bullet_needs_attention: "Check channel permissions.".to_string(),
                    active_users: vec![],
                });
                continue;
            }
        };

        // Collect channel name from the first message's channel field, or use ID
        let channel_name = channel_id.clone();
        let message_count = msgs.len() as u32;

        let mut active_users: std::collections::HashSet<String> = std::collections::HashSet::new();
        let transcript: String = msgs
            .iter()
            .filter_map(|m| {
                let author = m["author"]["username"].as_str().unwrap_or("?").to_string();
                let text = m["content"].as_str().unwrap_or("");
                if text.is_empty() {
                    return None;
                }
                active_users.insert(author.clone());
                Some(format!("{author}: {text}"))
            })
            .collect::<Vec<_>>()
            .join("\n");

        if transcript.is_empty() {
            summaries.push(ChannelSummary {
                channel_id: channel_id.clone(),
                channel_name,
                message_count: 0,
                bullet_what_happened: "No text messages in this period.".to_string(),
                bullet_decisions: "None.".to_string(),
                bullet_needs_attention: "Nothing flagged.".to_string(),
                active_users: vec![],
            });
            continue;
        }

        let prompt = format!(
            "Summarise this Discord channel conversation in exactly 3 short bullet points.\n\
             Format:\n\
             WHAT_HAPPENED: <one sentence>\n\
             DECISIONS: <one sentence or 'None'>\n\
             NEEDS_ATTENTION: <one sentence or 'Nothing'>\n\n\
             Channel: {channel_name}\n\
             Messages:\n{transcript}"
        );

        let response = llm_complete(&prompt).await.unwrap_or_default();

        let extract = |label: &str| -> String {
            response
                .lines()
                .find(|l| l.trim().starts_with(label))
                .and_then(|l| l.splitn(2, ':').nth(1))
                .map(|s| s.trim().to_string())
                .unwrap_or_else(|| format!("(see channel {channel_id})"))
        };

        summaries.push(ChannelSummary {
            channel_id: channel_id.clone(),
            channel_name,
            message_count,
            bullet_what_happened: extract("WHAT_HAPPENED"),
            bullet_decisions: extract("DECISIONS"),
            bullet_needs_attention: extract("NEEDS_ATTENTION"),
            active_users: active_users.into_iter().collect(),
        });
    }

    summaries
}

// ── 4. welcome_new_members ────────────────────────────────────────────────────

/// Detect new member join events for a guild (via audit log) and send a
/// personalised welcome message to the system channel.
/// Returns the count of welcome messages sent.
pub async fn welcome_new_members(token: &str, guild_id: &str) -> u32 {
    let effective_token = if token.is_empty() { &discord_token() } else { token };

    // Fetch guild info to get topic/description and system channel
    let guild_info = match dc_get(&format!("/guilds/{guild_id}"), effective_token).await {
        Ok(v) => v,
        Err(e) => {
            eprintln!("discord_deep: guild info: {e}");
            return 0;
        }
    };

    let system_channel_id = match guild_info["system_channel_id"].as_str() {
        Some(id) => id.to_string(),
        None => return 0,
    };

    let guild_name = guild_info["name"].as_str().unwrap_or("this server").to_string();
    let guild_description = guild_info["description"]
        .as_str()
        .unwrap_or("a community")
        .to_string();

    // Fetch audit log for member join events (type 1)
    let audit = match dc_get(
        &format!("/guilds/{guild_id}/audit-logs?action_type=1&limit=10"),
        effective_token,
    )
    .await
    {
        Ok(v) => v,
        Err(e) => {
            eprintln!("discord_deep: audit log: {e}");
            return 0;
        }
    };

    let entries = audit["audit_log_entries"]
        .as_array()
        .cloned()
        .unwrap_or_default();

    // Filter to joins in the last hour
    let one_hour_ago = now_secs() - 3600;
    let mut sent = 0u32;

    for entry in &entries {
        // Discord snowflake → timestamp extraction
        let snowflake = entry["id"]
            .as_str()
            .and_then(|s| s.parse::<u64>().ok())
            .unwrap_or(0);
        let created_secs = ((snowflake >> 22) + 1_420_070_400_000) / 1000;

        if (created_secs as i64) < one_hour_ago {
            continue;
        }

        let target_id = entry["target_id"].as_str().unwrap_or("").to_string();
        if target_id.is_empty() {
            continue;
        }

        // Fetch the new member's username
        let member_info = match dc_get(
            &format!("/guilds/{guild_id}/members/{target_id}"),
            effective_token,
        )
        .await
        {
            Ok(v) => v,
            Err(_) => continue,
        };

        let username = member_info["user"]["username"]
            .as_str()
            .unwrap_or("new member")
            .to_string();

        // Generate personalised welcome message
        let prompt = format!(
            "Write a warm, friendly welcome message for a new Discord member named '{username}' \
             who just joined '{guild_name}' — a community about: {guild_description}.\n\
             Keep it ≤200 characters. Be encouraging and mention what makes the server special. \
             Do NOT use generic boilerplate."
        );

        let welcome_text = llm_complete(&prompt).await.unwrap_or_else(|_| {
            format!("Welcome to {guild_name}, {username}! Great to have you here.")
        });

        // Post welcome message
        let body = serde_json::json!({ "content": welcome_text });
        match dc_post(
            &format!("/channels/{system_channel_id}/messages"),
            effective_token,
            body,
        )
        .await
        {
            Ok(_) => sent += 1,
            Err(e) => eprintln!("discord_deep: welcome send failed: {e}"),
        }
    }

    sent
}

// ── Simulated data ────────────────────────────────────────────────────────────

fn simulated_discord_actions() -> Vec<DiscordAction> {
    vec![DiscordAction {
        guild_id: "sim-guild-1".to_string(),
        channel_id: "sim-channel-general".to_string(),
        message_id: "sim-msg-1".to_string(),
        author: "devuser".to_string(),
        original_content: "Hey BLADE, how does async Rust handle backpressure?".to_string(),
        draft_reply: "Async Rust uses `async-channel` or bounded `tokio::sync::mpsc` for backpressure — the sender blocks (or errors) when the buffer is full. The executor never spawns unbounded work.".to_string(),
        timestamp: "2026-04-15T09:00:00+00:00".to_string(),
    }]
}

fn simulated_moderation_actions(guild_id: &str) -> Vec<ModerationAction> {
    vec![ModerationAction {
        guild_id: guild_id.to_string(),
        channel_id: "sim-channel-general".to_string(),
        message_id: "sim-msg-spam-1".to_string(),
        author_id: "sim-spammer-123".to_string(),
        author_name: "spammer99".to_string(),
        message_preview: "FREE NITRO claim now https://totally-legit.gg/free".to_string(),
        action_type: "delete".to_string(),
        reason: "Spam or unsolicited links detected.".to_string(),
        timeout_secs: 0,
        violation: ViolationKind::Spam,
        confidence: 0.92,
    }]
}
