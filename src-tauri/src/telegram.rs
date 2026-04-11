// src-tauri/src/telegram.rs
// BLADE Telegram bridge — lets users chat with BLADE through a Telegram bot.
// Uses long-polling (no webhook server needed). Each Telegram user gets their
// own conversation history kept in memory for the session.

use crate::config;
use crate::providers::{self, ConversationMessage};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tauri::Emitter;
use tokio::sync::{Mutex, RwLock};
use tokio::task::JoinHandle;

// ── Telegram API types ────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
struct TgResponse<T> {
    ok: bool,
    result: Option<T>,
    description: Option<String>,
}

#[derive(Debug, Deserialize, Clone)]
struct TgUpdate {
    update_id: i64,
    message: Option<TgMessage>,
}

#[derive(Debug, Deserialize, Clone)]
struct TgMessage {
    message_id: i64,
    from: Option<TgUser>,
    chat: TgChat,
    text: Option<String>,
}

#[derive(Debug, Deserialize, Clone)]
struct TgUser {
    id: i64,
    first_name: String,
    username: Option<String>,
}

#[derive(Debug, Deserialize, Clone)]
struct TgChat {
    id: i64,
}

#[derive(Debug, Serialize)]
struct SendMessageRequest {
    chat_id: i64,
    text: String,
    parse_mode: Option<String>,
}

// ── Bot state ─────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct TelegramStatus {
    pub running: bool,
    pub token_set: bool,
    pub messages_handled: u64,
    pub error: Option<String>,
}

// Per-user conversation history (last N turns)
type UserHistory = Vec<ConversationMessage>;

struct BotState {
    token: String,
    offset: i64,
    histories: HashMap<i64, UserHistory>, // keyed by Telegram user_id
    messages_handled: u64,
    error: Option<String>,
}

// Global singleton handle
static BOT_HANDLE: std::sync::OnceLock<Arc<Mutex<Option<JoinHandle<()>>>>> =
    std::sync::OnceLock::new();
static BOT_STATUS: std::sync::OnceLock<Arc<RwLock<TelegramStatus>>> =
    std::sync::OnceLock::new();

fn handle() -> Arc<Mutex<Option<JoinHandle<()>>>> {
    BOT_HANDLE.get_or_init(|| Arc::new(Mutex::new(None))).clone()
}

fn status() -> Arc<RwLock<TelegramStatus>> {
    BOT_STATUS
        .get_or_init(|| {
            let token_set = !get_saved_token().is_empty();
            Arc::new(RwLock::new(TelegramStatus {
                running: false,
                token_set,
                messages_handled: 0,
                error: None,
            }))
        })
        .clone()
}

// ── Token storage (keyring) ───────────────────────────────────────────────────

const KEYRING_SERVICE: &str = "blade-ai";
const TELEGRAM_KEY: &str = "telegram_bot_token";

pub fn get_saved_token() -> String {
    keyring::Entry::new(KEYRING_SERVICE, TELEGRAM_KEY)
        .ok()
        .and_then(|e| e.get_password().ok())
        .unwrap_or_default()
}

fn save_token(token: &str) -> Result<(), String> {
    keyring::Entry::new(KEYRING_SERVICE, TELEGRAM_KEY)
        .map_err(|e| e.to_string())?
        .set_password(token)
        .map_err(|e| e.to_string())
}

fn delete_token() -> Result<(), String> {
    keyring::Entry::new(KEYRING_SERVICE, TELEGRAM_KEY)
        .map_err(|e| e.to_string())?
        .delete_credential()
        .map_err(|e| e.to_string())
}

// ── Core polling loop ─────────────────────────────────────────────────────────

const MAX_HISTORY_TURNS: usize = 20; // per-user message cap
const TELEGRAM_API: &str = "https://api.telegram.org/bot";

async fn poll_loop(app: tauri::AppHandle, mut state: BotState) {
    let client = reqwest::Client::new();
    let base = format!("{}{}", TELEGRAM_API, state.token);

    loop {
        // Check if we should keep running (token still valid in our state)
        {
            let s = status().read().await;
            if !s.running {
                break;
            }
        }

        // Long-poll for updates
        let url = format!(
            "{}/getUpdates?offset={}&timeout=25&allowed_updates=[\"message\"]",
            base, state.offset
        );

        let resp = match client.get(&url).send().await {
            Ok(r) => r,
            Err(e) => {
                let msg = format!("Telegram poll error: {}", e);
                log::warn!("{}", msg);
                {
                    let mut s = status().write().await;
                    s.error = Some(msg);
                }
                tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;
                continue;
            }
        };

        let body: TgResponse<Vec<TgUpdate>> = match resp.json().await {
            Ok(b) => b,
            Err(e) => {
                log::warn!("Telegram JSON parse error: {}", e);
                tokio::time::sleep(tokio::time::Duration::from_secs(3)).await;
                continue;
            }
        };

        if !body.ok {
            let msg = body.description.unwrap_or_else(|| "Unknown error".to_string());
            log::error!("Telegram API not ok: {}", msg);
            {
                let mut s = status().write().await;
                s.error = Some(format!("Telegram error: {}", msg));
                s.running = false;
            }
            break;
        }

        let updates = body.result.unwrap_or_default();

        for update in updates {
            // Advance offset to acknowledge this update
            if update.update_id >= state.offset {
                state.offset = update.update_id + 1;
            }

            let Some(msg) = update.message else { continue };
            let Some(text) = msg.text.clone() else { continue };

            // Ignore bot commands like /start for now — just respond to them
            let user_id = msg.from.as_ref().map(|u| u.id).unwrap_or(msg.chat.id);
            let user_name = msg
                .from
                .as_ref()
                .and_then(|u| u.username.clone())
                .or_else(|| msg.from.as_ref().map(|u| u.first_name.clone()))
                .unwrap_or_else(|| "User".to_string());
            let chat_id = msg.chat.id;

            // Handle /start
            if text.trim() == "/start" {
                let welcome = format!(
                    "Hey {}! I'm BLADE — your AI assistant. Ask me anything.",
                    user_name
                );
                let _ = send_message(&client, &base, chat_id, &welcome).await;
                continue;
            }

            // Handle /clear — reset conversation history
            if text.trim() == "/clear" {
                state.histories.remove(&user_id);
                let _ = send_message(&client, &base, chat_id, "Conversation cleared.").await;
                continue;
            }

            // Load or init user history
            let history = state.histories.entry(user_id).or_default();

            // Append user message
            history.push(ConversationMessage::User(text.clone()));

            // Build system prompt
            let config = config::load_config();
            let system = build_telegram_system_prompt(&config, &user_name);
            let mut full_conv: Vec<ConversationMessage> =
                vec![ConversationMessage::System(system)];
            // Include last MAX_HISTORY_TURNS messages
            let start = if history.len() > MAX_HISTORY_TURNS {
                history.len() - MAX_HISTORY_TURNS
            } else {
                0
            };
            full_conv.extend(history[start..].iter().cloned());

            // Call the AI (no tool use in Telegram — keep it conversational)
            let reply = match providers::complete_turn(
                &config.provider,
                &config.api_key,
                &config.model,
                &full_conv,
                &[], // no tools in Telegram mode
                config.base_url.as_deref(),
            )
            .await
            {
                Ok(turn) => turn.content,
                Err(e) => {
                    log::error!("Telegram AI error: {}", e);
                    format!("Sorry, I ran into an error: {}", e)
                }
            };

            // Store assistant reply in history
            history.push(ConversationMessage::Assistant {
                content: reply.clone(),
                tool_calls: vec![],
            });

            // Trim history to prevent unbounded growth
            if history.len() > MAX_HISTORY_TURNS * 2 {
                let drain_to = history.len() - MAX_HISTORY_TURNS;
                history.drain(0..drain_to);
            }

            // Send reply to Telegram
            let _ = send_message(&client, &base, chat_id, &reply).await;

            state.messages_handled += 1;
            {
                let mut s = status().write().await;
                s.messages_handled = state.messages_handled;
                s.error = None;
            }

            // Emit event to frontend so the status indicator updates
            let _ = app.emit("telegram_message_handled", state.messages_handled);
        }
    }

    {
        let mut s = status().write().await;
        s.running = false;
    }
}

fn build_telegram_system_prompt(config: &config::BladeConfig, user_name: &str) -> String {
    let mut parts = vec![
        format!(
            "You are BLADE, a personal AI assistant talking to {} via Telegram.",
            user_name
        ),
        "Keep responses concise and conversational — this is a chat interface, not a terminal.".to_string(),
        "Use plain text. Avoid markdown heavy formatting (no code blocks unless asked).".to_string(),
        "You can answer questions, help with tasks, research topics, and more.".to_string(),
    ];

    if !config.user_name.is_empty() {
        parts.push(format!(
            "The user's name is {}. You know them from your desktop sessions.",
            config.user_name
        ));
    }

    // Inject active thread if available
    if let Some(thread) = crate::thread::get_active_thread() {
        parts.push(format!("Current context from your desktop session:\n{}", thread));
    }

    parts.join("\n")
}

async fn send_message(
    client: &reqwest::Client,
    base: &str,
    chat_id: i64,
    text: &str,
) -> Result<(), String> {
    // Telegram has a 4096 char limit per message
    let chunks = split_message(text, 4000);
    for chunk in chunks {
        let req = SendMessageRequest {
            chat_id,
            text: chunk,
            parse_mode: None, // plain text — avoid markdown parse errors
        };
        client
            .post(format!("{}/sendMessage", base))
            .json(&req)
            .send()
            .await
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn split_message(text: &str, max_len: usize) -> Vec<String> {
    if text.len() <= max_len {
        return vec![text.to_string()];
    }
    let mut chunks = Vec::new();
    let mut start = 0;
    while start < text.len() {
        let end = (start + max_len).min(text.len());
        // Try to break at a newline
        let end = text[start..end]
            .rfind('\n')
            .map(|i| start + i + 1)
            .unwrap_or(end);
        chunks.push(text[start..end].to_string());
        start = end;
    }
    chunks
}

// ── Public commands ───────────────────────────────────────────────────────────

#[tauri::command]
pub async fn telegram_start(app: tauri::AppHandle, token: String) -> Result<(), String> {
    if token.trim().is_empty() {
        return Err("Bot token cannot be empty".to_string());
    }

    // Stop any existing bot
    telegram_stop().await?;

    // Save token to keyring
    save_token(token.trim())?;

    // Verify the token is valid before starting
    let client = reqwest::Client::new();
    let check_url = format!("{}{}/getMe", TELEGRAM_API, token.trim());
    let resp = client
        .get(&check_url)
        .send()
        .await
        .map_err(|e| format!("Network error: {}", e))?
        .json::<TgResponse<serde_json::Value>>()
        .await
        .map_err(|e| format!("Parse error: {}", e))?;

    if !resp.ok {
        let msg = resp
            .description
            .unwrap_or_else(|| "Invalid token".to_string());
        return Err(format!("Telegram rejected token: {}", msg));
    }

    let bot_state = BotState {
        token: token.trim().to_string(),
        offset: 0,
        histories: HashMap::new(),
        messages_handled: 0,
        error: None,
    };

    {
        let mut s = status().write().await;
        s.running = true;
        s.token_set = true;
        s.error = None;
        s.messages_handled = 0;
    }

    let task = tokio::spawn(poll_loop(app, bot_state));
    *handle().lock().await = Some(task);

    Ok(())
}

#[tauri::command]
pub async fn telegram_stop() -> Result<(), String> {
    {
        let mut s = status().write().await;
        s.running = false;
    }

    let mut h = handle().lock().await;
    if let Some(task) = h.take() {
        task.abort();
    }

    Ok(())
}

#[tauri::command]
pub async fn telegram_status() -> TelegramStatus {
    status().read().await.clone()
}

#[tauri::command]
pub async fn telegram_disconnect() -> Result<(), String> {
    telegram_stop().await?;
    delete_token().ok(); // best-effort
    {
        let mut s = status().write().await;
        s.token_set = false;
        s.messages_handled = 0;
    }
    Ok(())
}

#[tauri::command]
pub async fn telegram_start_saved(app: tauri::AppHandle) -> Result<(), String> {
    let token = get_saved_token();
    if token.is_empty() {
        return Err("No saved token found. Please enter your bot token.".to_string());
    }
    telegram_start(app, token).await
}

/// Called on app startup — auto-restarts bot if a token was saved
pub async fn auto_start_if_configured(app: tauri::AppHandle) {
    let token = get_saved_token();
    if !token.is_empty() {
        log::info!("Telegram: auto-starting bot with saved token");
        if let Err(e) = telegram_start(app, token).await {
            log::warn!("Telegram: auto-start failed: {}", e);
            let mut s = status().write().await;
            s.error = Some(e);
            s.token_set = true; // token is still there, just failed to connect
        }
    }
}
