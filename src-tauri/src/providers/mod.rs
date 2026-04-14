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

const OPENROUTER_BASE_URL: &str = "https://openrouter.ai/api/v1";

pub async fn complete_turn(
    provider: &str,
    api_key: &str,
    model: &str,
    messages: &[ConversationMessage],
    tools: &[ToolDefinition],
    base_url: Option<&str>,
) -> Result<AssistantTurn, String> {
    // If a custom base_url is set, always use the OpenAI-compatible client —
    // Vercel AI Gateway, Cloudflare AI Gateway, Azure, etc. all speak OpenAI format.
    if base_url.is_some() && provider != "ollama" {
        let result = openai::complete(api_key, model, messages, tools, base_url).await;
        // Some custom endpoints (NVIDIA NIM, etc.) return 404 when tools are sent to a
        // model that doesn't support function calling. Retry without tools in that case.
        if !tools.is_empty() {
            if let Err(ref e) = result {
                if e.contains("404") {
                    let no_tools: &[ToolDefinition] = Default::default();
                    return openai::complete(api_key, model, messages, no_tools, base_url).await;
                }
            }
        }
        return result;
    }
    match provider {
        "gemini" => gemini::complete(api_key, model, messages, tools).await,
        "groq" => groq::complete(api_key, model, messages, tools).await,
        "openai" => openai::complete(api_key, model, messages, tools, base_url).await,
        "anthropic" => anthropic::complete(api_key, model, messages, tools).await,
        "ollama" => ollama::complete(model, messages).await,
        "openrouter" => openai::complete(api_key, model, messages, tools, Some(OPENROUTER_BASE_URL)).await,
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
    base_url: Option<&str>,
) -> Result<(), String> {
    // If a custom base_url is set, use OpenAI-compatible streaming.
    if base_url.is_some() && provider != "ollama" {
        return openai::stream_text(app, api_key, model, messages, base_url).await;
    }
    match provider {
        "gemini" => gemini::stream_text(app, api_key, model, messages).await,
        "groq" => groq::stream_text(app, api_key, model, messages).await,
        "openai" => openai::stream_text(app, api_key, model, messages, base_url).await,
        "anthropic" => anthropic::stream_text(app, api_key, model, messages).await,
        "ollama" => ollama::stream_text(app, model, messages).await,
        "openrouter" => openai::stream_text(app, api_key, model, messages, Some(OPENROUTER_BASE_URL)).await,
        _ => Err(format!("Unknown provider: {}", provider)),
    }
}

/// Stream with extended thinking (Claude only). Falls back to regular stream for other providers.
pub async fn stream_text_thinking(
    app: &tauri::AppHandle,
    provider: &str,
    api_key: &str,
    model: &str,
    messages: &[ConversationMessage],
    budget_tokens: u32,
) -> Result<(), String> {
    if provider == "anthropic" {
        anthropic::stream_text_with_thinking(app, api_key, model, messages, budget_tokens).await
    } else {
        // Other providers: regular stream (no thinking support yet)
        stream_text(app, provider, api_key, model, messages, None).await
    }
}

/// Fast acknowledgment: complete a single short turn using a cheap/fast model
/// (claude-haiku or gemini-flash), bypassing the user's configured model.
/// Used to give immediate feedback (<500 ms) while the real request is still running.
pub async fn stream_fast_acknowledgment(message: &str, config: &crate::config::BladeConfig) -> Result<String, String> {
    // Custom base_url providers (NVIDIA NIM, DeepSeek, etc.) — skip fast-ack entirely.
    // The ack logic tries to route to a cheap known model, which breaks custom endpoints.
    if config.base_url.is_some() {
        return Ok(String::new());
    }

    // Pick the cheapest available fast model. Prefer Anthropic Haiku if the key is set.
    // Fall back through providers in order of speed.
    // All fields are owned Strings to avoid lifetime tangles.
    let anthropic_key = crate::config::get_provider_key("anthropic");
    let gemini_key    = crate::config::get_provider_key("gemini");
    let openai_key    = crate::config::get_provider_key("openai");

    let (provider, api_key, model): (String, String, String) =
        if !anthropic_key.is_empty() {
            ("anthropic".into(), anthropic_key, "claude-haiku-4-5-20251001".into())
        } else if !gemini_key.is_empty() {
            ("gemini".into(), gemini_key, "gemini-2.0-flash".into())
        } else if !openai_key.is_empty() {
            ("openai".into(), openai_key, "gpt-4o-mini".into())
        } else if config.provider == "openrouter" && !config.api_key.is_empty() {
            ("openrouter".into(), config.api_key.clone(), "meta-llama/llama-3.3-70b-instruct:free".into())
        } else if config.provider == "ollama" {
            ("ollama".into(), String::new(), config.model.clone())
        } else {
            // Last resort: use the user's configured provider + model
            (config.provider.clone(), config.api_key.clone(), config.model.clone())
        };

    let system = "You are BLADE, a personal AI assistant. \
        Give a 1-2 sentence acknowledgment that you understood what was asked and are working on it. \
        Be natural. No filler like 'Certainly!' or 'Great question!' — \
        just a brief human-sounding response that shows you got it.";

    let messages = vec![
        ConversationMessage::System(system.to_string()),
        ConversationMessage::User(message.to_string()),
    ];

    let no_tools: &[ToolDefinition] = Default::default();
    let turn = match provider.as_str() {
        "anthropic"  => anthropic::complete(&api_key, &model, &messages, no_tools).await?,
        "gemini"     => gemini::complete(&api_key, &model, &messages, no_tools).await?,
        "groq"       => groq::complete(&api_key, &model, &messages, no_tools).await?,
        "openai"     => openai::complete(&api_key, &model, &messages, no_tools, None).await?,
        "ollama"     => ollama::complete(&model, &messages).await?,
        "openrouter" => openai::complete(&api_key, &model, &messages, no_tools, Some(OPENROUTER_BASE_URL)).await?,
        _            => {
            // Custom base_url providers speak OpenAI-compat
            let bu = config.base_url.as_deref();
            openai::complete(&api_key, &model, &messages, no_tools, bu).await?
        }
    };

    Ok(turn.content)
}

// ── Structured output / JSON guardrails ──────────────────────────────────────
// Stolen from the guidance/constrained-generation pattern:
// LLMs routinely produce JSON wrapped in markdown fences, with trailing commas,
// or with preamble text. This utility extracts and repairs JSON so callers
// never fail on parse errors from well-intentioned but slightly malformed output.

/// Extract valid JSON from an LLM response that may contain markdown fences,
/// prose preamble, trailing commas, or other common LLM JSON mistakes.
///
/// Returns the parsed Value on success, or the raw parse error if repair fails.
pub fn extract_and_repair_json(raw: &str) -> serde_json::Result<serde_json::Value> {
    let text = raw.trim();

    // 1. Try direct parse (fast path for already-clean responses)
    if let Ok(v) = serde_json::from_str(text) {
        return Ok(v);
    }

    // 2. Strip markdown code fences (```json ... ``` or ``` ... ```)
    let stripped = strip_code_fences(text);

    // 3. Try after stripping fences
    if let Ok(v) = serde_json::from_str(stripped) {
        return Ok(v);
    }

    // 4. Extract the first JSON object {...} or array [...] from the text
    let extracted = extract_json_substring(stripped);
    if extracted != stripped {
        if let Ok(v) = serde_json::from_str(extracted) {
            return Ok(v);
        }
    }

    // 5. Repair common issues: trailing commas before } or ]
    let repaired = repair_trailing_commas(extracted);
    serde_json::from_str(&repaired)
}

fn strip_code_fences(s: &str) -> &str {
    if s.starts_with("```") {
        let after_fence = s.find('\n').map(|i| &s[i + 1..]).unwrap_or(s);
        after_fence
            .rfind("```")
            .map(|i| after_fence[..i].trim())
            .unwrap_or(after_fence)
    } else {
        s
    }
}

fn extract_json_substring(s: &str) -> &str {
    // Try object first
    if let (Some(start), Some(end)) = (s.find('{'), s.rfind('}')) {
        if start < end {
            return &s[start..=end];
        }
    }
    // Try array
    if let (Some(start), Some(end)) = (s.find('['), s.rfind(']')) {
        if start < end {
            return &s[start..=end];
        }
    }
    s
}

fn repair_trailing_commas(s: &str) -> String {
    // Remove trailing commas before closing braces/brackets: ,} and ,]
    // Simple regex-free approach: scan for ,\s*[}\]]
    let mut result = String::with_capacity(s.len());
    let chars: Vec<char> = s.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        if chars[i] == ',' {
            // Look ahead past whitespace for } or ]
            let mut j = i + 1;
            while j < chars.len() && chars[j].is_whitespace() {
                j += 1;
            }
            if j < chars.len() && (chars[j] == '}' || chars[j] == ']') {
                // Skip the trailing comma
                i += 1;
                continue;
            }
        }
        result.push(chars[i]);
        i += 1;
    }
    result
}

pub async fn test_connection(provider: &str, api_key: &str, model: &str, base_url: Option<&str>) -> Result<String, String> {
    if base_url.is_some() && provider != "ollama" {
        return openai::test(api_key, model, base_url).await;
    }
    match provider {
        "gemini" => gemini::test(api_key, model).await,
        "groq" => groq::test(api_key, model).await,
        "openai" => openai::test(api_key, model, base_url).await,
        "anthropic" => anthropic::test(api_key, model).await,
        "ollama" => ollama::test(model).await,
        "openrouter" => openai::test(api_key, model, Some(OPENROUTER_BASE_URL)).await,
        _ => Err(format!("Unknown provider: {}", provider)),
    }
}
