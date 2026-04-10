pub mod anthropic;
pub mod gemini;
pub mod groq;
pub mod ollama;
pub mod openai;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
    #[serde(default)]
    pub image_base64: Option<String>,
}

#[derive(Debug, Clone)]
pub struct ToolDefinition {
    pub name: String,
    pub description: String,
    pub input_schema: serde_json::Value,
}

#[derive(Debug, Clone)]
pub struct ToolCall {
    pub id: String,
    pub name: String,
    pub arguments: serde_json::Value,
}

#[derive(Debug, Clone)]
pub enum ConversationMessage {
    System(String),
    User(String),
    UserWithImage {
        text: String,
        image_base64: String,
    },
    Assistant {
        content: String,
        tool_calls: Vec<ToolCall>,
    },
    Tool {
        tool_call_id: String,
        tool_name: String,
        content: String,
        is_error: bool,
    },
}

#[derive(Debug, Clone)]
pub struct AssistantTurn {
    pub content: String,
    pub tool_calls: Vec<ToolCall>,
}

pub fn build_conversation(
    messages: Vec<ChatMessage>,
    system_prompt: Option<String>,
) -> Vec<ConversationMessage> {
    let mut conversation = Vec::new();

    if let Some(system_prompt) = system_prompt {
        if !system_prompt.trim().is_empty() {
            conversation.push(ConversationMessage::System(system_prompt));
        }
    }

    conversation.extend(messages.into_iter().map(|message| {
        if message.role == "assistant" {
            ConversationMessage::Assistant {
                content: message.content,
                tool_calls: Vec::new(),
            }
        } else if let Some(img) = message.image_base64 {
            ConversationMessage::UserWithImage {
                text: message.content,
                image_base64: img,
            }
        } else {
            ConversationMessage::User(message.content)
        }
    }));

    conversation
}

pub async fn complete_turn(
    provider: &str,
    api_key: &str,
    model: &str,
    messages: &[ConversationMessage],
    tools: &[ToolDefinition],
) -> Result<AssistantTurn, String> {
    match provider {
        "gemini" => gemini::complete(api_key, model, messages, tools).await,
        "groq" => groq::complete(api_key, model, messages, tools).await,
        "openai" => openai::complete(api_key, model, messages, tools).await,
        "anthropic" => anthropic::complete(api_key, model, messages, tools).await,
        "ollama" => ollama::complete(model, messages).await,
        _ => Err(format!("Unknown provider: {}", provider)),
    }
}

/// Stream a text-only response (no tool calling). Used when no tools are
/// configured or for the final turn after all tool calls are done.
pub async fn stream_text(
    app: &tauri::AppHandle,
    provider: &str,
    api_key: &str,
    model: &str,
    messages: &[ConversationMessage],
) -> Result<(), String> {
    match provider {
        "gemini" => gemini::stream_text(app, api_key, model, messages).await,
        "groq" => groq::stream_text(app, api_key, model, messages).await,
        "openai" => openai::stream_text(app, api_key, model, messages).await,
        "anthropic" => anthropic::stream_text(app, api_key, model, messages).await,
        "ollama" => ollama::stream_text(app, model, messages).await,
        _ => Err(format!("Unknown provider: {}", provider)),
    }
}

pub async fn test_connection(provider: &str, api_key: &str, model: &str) -> Result<String, String> {
    match provider {
        "gemini" => gemini::test(api_key, model).await,
        "groq" => groq::test(api_key, model).await,
        "openai" => openai::test(api_key, model).await,
        "anthropic" => anthropic::test(api_key, model).await,
        "ollama" => ollama::test(model).await,
        _ => Err(format!("Unknown provider: {}", provider)),
    }
}
