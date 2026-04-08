pub mod gemini;
pub mod groq;
pub mod openai;
pub mod anthropic;
pub mod ollama;

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

/// Stream a chat response, emitting "chat_token" events for each chunk
/// and "chat_done" when complete.
pub async fn stream_chat(
    app: &AppHandle,
    provider: &str,
    api_key: &str,
    model: &str,
    messages: Vec<ChatMessage>,
) -> Result<(), String> {
    match provider {
        "gemini" => gemini::stream(app, api_key, model, messages).await,
        "groq" => groq::stream(app, api_key, model, messages).await,
        "openai" => openai::stream(app, api_key, model, messages).await,
        "anthropic" => anthropic::stream(app, api_key, model, messages).await,
        "ollama" => ollama::stream(app, model, messages).await,
        _ => Err(format!("Unknown provider: {}", provider)),
    }
}

/// Test if the connection works (non-streaming, short prompt)
pub async fn test_connection(
    provider: &str,
    api_key: &str,
    model: &str,
) -> Result<String, String> {
    match provider {
        "gemini" => gemini::test(api_key, model).await,
        "groq" => groq::test(api_key, model).await,
        "openai" => openai::test(api_key, model).await,
        "anthropic" => anthropic::test(api_key, model).await,
        "ollama" => ollama::test(model).await,
        _ => Err(format!("Unknown provider: {}", provider)),
    }
}
