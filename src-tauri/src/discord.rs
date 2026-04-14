// src-tauri/src/discord.rs
// BLADE Discord notifications — post pulse thoughts, briefings, and
// user-triggered messages to a Discord channel via webhooks.
//
// No bot token required. User just pastes a webhook URL from any
// Discord channel's "Edit Channel → Integrations → Webhooks" menu.
// Webhook URLs are stored in keyring under "discord_webhook_url".
//
// Supports optional Hermes-style channel routing:
//   - #blade-pulse       → pulse thoughts
//   - #blade-briefings   → morning briefings
//   - custom webhook     → anything the user wants to send

use serde::Serialize;

const KEYRING_SERVICE: &str = "blade-ai";
const DISCORD_WEBHOOK_KEY: &str = "discord_webhook_url";

// ── Keyring helpers ───────────────────────────────────────────────────────────

pub fn get_saved_webhook() -> String {
    keyring::Entry::new(KEYRING_SERVICE, DISCORD_WEBHOOK_KEY)
        .ok()
        .and_then(|e| e.get_password().ok())
        .unwrap_or_default()
}

fn save_webhook(url: &str) -> Result<(), String> {
    keyring::Entry::new(KEYRING_SERVICE, DISCORD_WEBHOOK_KEY)
        .map_err(|e| e.to_string())?
        .set_password(url)
        .map_err(|e| e.to_string())
}

fn delete_webhook() -> Result<(), String> {
    keyring::Entry::new(KEYRING_SERVICE, DISCORD_WEBHOOK_KEY)
        .map_err(|e| e.to_string())?
        .delete_credential()
        .map_err(|e| e.to_string())
}

// ── Discord webhook payload ───────────────────────────────────────────────────

#[derive(Serialize)]
struct WebhookPayload<'a> {
    username: &'a str,
    content: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    embeds: Option<Vec<WebhookEmbed<'a>>>,
}

#[derive(Serialize)]
struct WebhookEmbed<'a> {
    description: &'a str,
    color: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    footer: Option<EmbedFooter<'a>>,
}

#[derive(Serialize)]
struct EmbedFooter<'a> {
    text: &'a str,
}

// ── Core post function ────────────────────────────────────────────────────────

/// Post `content` to any webhook URL directly. Used by watcher.rs for per-alert routing.
#[allow(dead_code)]
pub async fn post_to_webhook_url(url: &str, content: &str) -> Result<(), String> {
    post_to_webhook(url, content, false, 0).await
}

/// Post a message to the stored Discord webhook. Fire-and-forget.
pub async fn post_to_discord(content: &str, use_embed: bool, embed_color: u32) {
    let webhook_url = get_saved_webhook();
    if webhook_url.trim().is_empty() {
        return;
    }
    let _ = post_to_webhook(&webhook_url, content, use_embed, embed_color).await;
}

async fn post_to_webhook(
    url: &str,
    content: &str,
    use_embed: bool,
    embed_color: u32,
) -> Result<(), String> {
    let client = reqwest::Client::new();

    let payload = if use_embed {
        let embeds = vec![WebhookEmbed {
            description: content,
            color: embed_color,
            footer: Some(EmbedFooter { text: "BLADE" }),
        }];
        serde_json::to_value(WebhookPayload {
            username: "BLADE",
            content: "",
            embeds: Some(embeds),
        })
        .map_err(|e| e.to_string())?
    } else {
        serde_json::to_value(WebhookPayload {
            username: "BLADE",
            content,
            embeds: None,
        })
        .map_err(|e| e.to_string())?
    };

    let resp = client
        .post(url)
        .json(&payload)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if resp.status().is_success() {
        Ok(())
    } else {
        Err(format!("Discord webhook error: HTTP {}", resp.status()))
    }
}

// ── Public helpers called from pulse.rs ──────────────────────────────────────

/// Post a pulse thought to Discord (indigo embed).
pub async fn post_pulse(thought: &str) {
    if get_saved_webhook().is_empty() {
        return;
    }
    let content = format!("**Pulse:** {}", thought);
    post_to_discord(&content, true, 0x5865F2).await; // Discord blurple
}

/// Post a morning briefing to Discord (amber embed).
pub async fn post_briefing(briefing: &str) {
    if get_saved_webhook().is_empty() {
        return;
    }
    let content = format!("**Morning Briefing**\n\n{}", briefing);
    post_to_discord(&content, true, 0xF0B429).await; // amber
}

// ── Tauri commands ────────────────────────────────────────────────────────────

#[derive(Debug, Clone, serde::Serialize)]
pub struct DiscordStatus {
    pub connected: bool,
    pub webhook_set: bool,
    pub error: Option<String>,
}

/// Save a Discord webhook URL and verify it with a test message.
#[tauri::command]
pub async fn discord_connect(webhook_url: String) -> Result<(), String> {
    let url = webhook_url.trim();
    if url.is_empty() {
        return Err("Webhook URL cannot be empty".to_string());
    }
    if !url.starts_with("https://discord.com/api/webhooks/")
        && !url.starts_with("https://discordapp.com/api/webhooks/")
    {
        return Err("That doesn't look like a Discord webhook URL".to_string());
    }

    // Test it
    post_to_webhook(
        url,
        "BLADE connected. I'll post pulse thoughts and morning briefings here.",
        false,
        0,
    )
    .await
    .map_err(|e| format!("Could not reach webhook: {}", e))?;

    save_webhook(url)?;
    Ok(())
}

/// Remove the stored webhook URL.
#[tauri::command]
pub async fn discord_disconnect() -> Result<(), String> {
    delete_webhook().ok();
    Ok(())
}

/// Get current Discord connection status.
#[tauri::command]
pub fn discord_status() -> DiscordStatus {
    let webhook = get_saved_webhook();
    DiscordStatus {
        connected: !webhook.is_empty(),
        webhook_set: !webhook.is_empty(),
        error: None,
    }
}

/// Post a message to Discord from the frontend (e.g. "share this response").
#[tauri::command]
pub async fn discord_post(content: String) -> Result<(), String> {
    let webhook_url = get_saved_webhook();
    if webhook_url.is_empty() {
        return Err("No Discord webhook configured".to_string());
    }
    post_to_webhook(&webhook_url, &content, false, 0)
        .await
        .map_err(|e| e.to_string())
}
