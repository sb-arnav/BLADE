pub mod anthropic;
pub mod gemini;
pub mod groq;
pub mod ollama;
pub mod openai;

use serde::{Deserialize, Serialize};

// ── Unified model-string routing (litellm-style) ─────────────────────────────
//
// Accepts model strings in "provider/model" format, e.g.:
//   "openai/gpt-4o"
//   "anthropic/claude-sonnet-4-20250514"
//   "groq/llama-3.3-70b-versatile"
//   "ollama/hermes3"
//   "openrouter/meta-llama/llama-3.3-70b-instruct:free"
//
// When no prefix is present the caller-supplied `fallback_provider` is used,
// which keeps backwards compatibility with all existing call sites.

/// The canonical set of provider prefix strings BLADE understands.
const KNOWN_PROVIDERS: &[&str] = &[
    "anthropic",
    "openai",
    "gemini",
    "groq",
    "ollama",
    "openrouter",
];

/// Parse a model string that may or may not carry a "provider/" prefix.
///
/// Returns `(provider, model_for_api)` where `model_for_api` is the bare
/// model name that should be sent to the provider's API.
///
/// Examples:
///   "openai/gpt-4o"                                    → ("openai", "gpt-4o")
///   "openrouter/meta-llama/llama-3.3-70b-instruct:free" → ("openrouter", "meta-llama/llama-3.3-70b-instruct:free")
///   "gpt-4o"                                            → (fallback_provider, "gpt-4o")
pub fn parse_model_string<'a>(
    model: &'a str,
    fallback_provider: &'a str,
) -> (&'a str, &'a str) {
    // Only split on the first slash — openrouter models contain additional slashes
    // (e.g. "openrouter/meta-llama/llama-3.3-70b-instruct:free").
    if let Some(slash_pos) = model.find('/') {
        let prefix = &model[..slash_pos];
        if KNOWN_PROVIDERS.contains(&prefix) {
            let rest = &model[slash_pos + 1..];
            return (prefix, rest);
        }
    }
    // No recognised prefix — use the caller-supplied fallback provider.
    (fallback_provider, model)
}

/// Convenience wrapper: given a raw model string (possibly with provider prefix)
/// and the config's active provider, return `(provider, model_name, api_key)`.
///
/// The API key is looked up from the keyring for the resolved provider.
/// For the active provider the caller's key is used directly to avoid an
/// extra keyring round-trip.
pub fn resolve_provider_model(
    model: &str,
    config_provider: &str,
    config_api_key: &str,
) -> (String, String, String) {
    let (provider, bare_model) = parse_model_string(model, config_provider);
    let api_key = if provider == config_provider {
        config_api_key.to_string()
    } else {
        crate::config::get_provider_key(provider)
    };
    (provider.to_string(), bare_model.to_string(), api_key)
}

/// Detect whether an error string represents a transient provider failure
/// (rate limit, service unavailable, server error) that warrants trying a
/// fallback provider.
fn is_fallback_eligible_error(err: &str) -> bool {
    let lower = err.to_ascii_lowercase();
    lower.contains("429")
        || lower.contains("rate limit")
        || lower.contains("too many requests")
        || lower.contains("503")
        || lower.contains("502")
        || lower.contains("500")
        || lower.contains("529")
        || lower.contains("overloaded")
        || lower.contains("service unavailable")
        || lower.contains("bad gateway")
        || lower.contains("internal server error")
}

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

/// Helper: returns an empty `&[ToolDefinition]` slice. Use this instead of `&[]`
/// when calling `complete_turn` — avoids the `&[T; 0]` → `&[T]` coercion issue.
pub fn no_tools() -> Vec<ToolDefinition> { Vec::new() }

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

/// Route a single `complete_turn` call to the correct provider adapter.
///
/// `provider` may be a bare provider name ("openai") **or** a "provider/model"
/// string ("openai/gpt-4o").  When `model` already contains a provider prefix
/// the `provider` argument is used as the fallback only.  The resolved bare
/// model name is forwarded to the adapter unchanged.
pub async fn complete_turn(
    provider: &str,
    api_key: &str,
    model: &str,
    messages: &[ConversationMessage],
    tools: &[ToolDefinition],
    base_url: Option<&str>,
) -> Result<AssistantTurn, String> {
    // Resolve provider/model from the model string (supports "provider/model" prefix).
    let (resolved_provider, bare_model, resolved_key) =
        resolve_provider_model(model, provider, api_key);
    let provider   = resolved_provider.as_str();
    let model      = bare_model.as_str();
    // Prefer the resolved key; fall back to the passed-in key for custom/base_url providers.
    let api_key    = if resolved_key.is_empty() { api_key } else { resolved_key.as_str() };

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
    let result = match provider {
        "gemini"     => gemini::complete(api_key, model, messages, tools).await,
        "groq"       => groq::complete(api_key, model, messages, tools).await,
        "openai"     => openai::complete(api_key, model, messages, tools, base_url).await,
        "anthropic"  => anthropic::complete(api_key, model, messages, tools).await,
        "ollama"     => ollama::complete(model, messages).await,
        "openrouter" => openai::complete(api_key, model, messages, tools, Some(OPENROUTER_BASE_URL)).await,
        _            => Err(format!("Unknown provider: {}", provider)),
    };

    // Cardiovascular: track every API call for blood pressure monitoring
    crate::cardiovascular::on_provider_call_complete(provider, model, result.is_ok());

    result
}

/// Stream a text-only response (no tool calling). Used when no tools are
/// configured or for the final turn after all tool calls are done.
///
/// `model` may carry a "provider/" prefix — routing is resolved automatically.
pub async fn stream_text(
    app: &tauri::AppHandle,
    provider: &str,
    api_key: &str,
    model: &str,
    messages: &[ConversationMessage],
    base_url: Option<&str>,
) -> Result<(), String> {
    // Resolve provider/model from the model string (supports "provider/model" prefix).
    let (resolved_provider, bare_model, resolved_key) =
        resolve_provider_model(model, provider, api_key);
    let provider = resolved_provider.as_str();
    let model    = bare_model.as_str();
    let api_key  = if resolved_key.is_empty() { api_key } else { resolved_key.as_str() };

    // If a custom base_url is set, use OpenAI-compatible streaming.
    if base_url.is_some() && provider != "ollama" {
        return openai::stream_text(app, api_key, model, messages, base_url).await;
    }
    match provider {
        "gemini"     => gemini::stream_text(app, api_key, model, messages).await,
        "groq"       => groq::stream_text(app, api_key, model, messages).await,
        "openai"     => openai::stream_text(app, api_key, model, messages, base_url).await,
        "anthropic"  => anthropic::stream_text(app, api_key, model, messages).await,
        "ollama"     => ollama::stream_text(app, model, messages).await,
        "openrouter" => openai::stream_text(app, api_key, model, messages, Some(OPENROUTER_BASE_URL)).await,
        _            => Err(format!("Unknown provider: {}", provider)),
    }
}

/// Stream with extended thinking (Claude only). Falls back to regular stream for other providers.
///
/// `model` may carry a "provider/" prefix — routing is resolved automatically.
pub async fn stream_text_thinking(
    app: &tauri::AppHandle,
    provider: &str,
    api_key: &str,
    model: &str,
    messages: &[ConversationMessage],
    budget_tokens: u32,
) -> Result<(), String> {
    let (resolved_provider, bare_model, resolved_key) =
        resolve_provider_model(model, provider, api_key);
    let provider = resolved_provider.as_str();
    let model    = bare_model.as_str();
    let api_key  = if resolved_key.is_empty() { api_key } else { resolved_key.as_str() };

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

/// Validate an LLM response (raw string) against an optional JSON schema.
///
/// Inspired by the guidance/outlines constrained-generation pattern:
/// 1. Runs `extract_and_repair_json` to tolerate markdown fences, trailing commas, etc.
/// 2. If `expected_schema` is `Some`, checks that all `required` fields exist and
///    that the declared `properties` types roughly match the schema.
/// 3. On failure, returns a **prompt-injectable** error string: callers can inject
///    it as a User message and retry the LLM call once (max 1 retry).
pub fn validate_tool_response(
    raw: &str,
    expected_schema: Option<&serde_json::Value>,
) -> Result<serde_json::Value, String> {
    // Step 1: parse with repair (handles markdown fences, trailing commas, etc.)
    let parsed = extract_and_repair_json(raw).map_err(|e| {
        format!(
            "Tool response could not be parsed as JSON.\n\
             Parse error: {}\n\
             Raw response (first 500 chars): {}\n\
             Please respond with valid JSON only.",
            e,
            &raw.chars().take(500).collect::<String>()
        )
    })?;

    // Step 2: optional schema validation
    if let Some(schema) = expected_schema {
        let mut errors: Vec<String> = Vec::new();

        // Check that all required fields are present
        if let Some(required) = schema.get("required").and_then(|r| r.as_array()) {
            for field in required {
                let field_name = field.as_str().unwrap_or("");
                if parsed.get(field_name).is_none() {
                    errors.push(format!("Missing required field: \"{}\"", field_name));
                }
            }
        }

        // Check that present properties have the right type
        if let Some(props) = schema.get("properties").and_then(|p| p.as_object()) {
            for (prop_name, prop_schema) in props {
                if let Some(value) = parsed.get(prop_name) {
                    if let Some(expected_type) = prop_schema.get("type").and_then(|t| t.as_str()) {
                        let type_ok = match expected_type {
                            "string"  => value.is_string(),
                            "integer" => value.is_i64() || value.is_u64(),
                            "number"  => value.is_number(),
                            "boolean" => value.is_boolean(),
                            "array"   => value.is_array(),
                            "object"  => value.is_object(),
                            "null"    => value.is_null(),
                            _         => true, // unknown type — pass through
                        };
                        if !type_ok {
                            errors.push(format!(
                                "Field \"{}\" has wrong type. Expected: {}, Got: {}",
                                prop_name,
                                expected_type,
                                json_type_name(value)
                            ));
                        }
                    }
                }
            }
        }

        if !errors.is_empty() {
            let schema_str = serde_json::to_string_pretty(schema).unwrap_or_default();
            return Err(format!(
                "Tool response JSON does not match the expected schema.\n\
                 Errors:\n{}\n\n\
                 Expected schema:\n{}\n\n\
                 Received:\n{}\n\n\
                 Please fix the response to match the schema exactly.",
                errors.join("\n"),
                schema_str,
                serde_json::to_string_pretty(&parsed).unwrap_or_default()
            ));
        }
    }

    Ok(parsed)
}

/// Return a human-readable type name for a JSON value (used in validation errors).
fn json_type_name(v: &serde_json::Value) -> &'static str {
    match v {
        serde_json::Value::Null      => "null",
        serde_json::Value::Bool(_)   => "boolean",
        serde_json::Value::Number(n) if n.is_i64() || n.is_u64() => "integer",
        serde_json::Value::Number(_) => "number",
        serde_json::Value::String(_) => "string",
        serde_json::Value::Array(_)  => "array",
        serde_json::Value::Object(_) => "object",
    }
}

/// Test connectivity to a provider.
///
/// `model` may carry a "provider/" prefix — routing is resolved automatically.
pub async fn test_connection(provider: &str, api_key: &str, model: &str, base_url: Option<&str>) -> Result<String, String> {
    let (resolved_provider, bare_model, resolved_key) =
        resolve_provider_model(model, provider, api_key);
    let provider = resolved_provider.as_str();
    let model    = bare_model.as_str();
    let api_key  = if resolved_key.is_empty() { api_key } else { resolved_key.as_str() };

    if base_url.is_some() && provider != "ollama" {
        return openai::test(api_key, model, base_url).await;
    }
    match provider {
        "gemini"     => gemini::test(api_key, model).await,
        "groq"       => groq::test(api_key, model).await,
        "openai"     => openai::test(api_key, model, base_url).await,
        "anthropic"  => anthropic::test(api_key, model).await,
        "ollama"     => ollama::test(model).await,
        "openrouter" => openai::test(api_key, model, Some(OPENROUTER_BASE_URL)).await,
        _            => Err(format!("Unknown provider: {}", provider)),
    }
}

// ── Fallback chain ────────────────────────────────────────────────────────────
//
// These functions implement the litellm-style fallback pattern: try the primary
// provider first; on a 429 / 503 / 5xx class error, iterate through
// `config.fallback_providers` and attempt the same request on each one that
// has a stored API key.  The first success wins.  Fatal errors (4xx auth /
// bad request) are never retried through the chain.

/// Attempt `complete_turn` with automatic fallback.
///
/// On a transient error (429/503/5xx) the function probes each provider listed
/// in `config.fallback_providers` in order and returns the first successful
/// response.  `model` may include a "provider/" prefix.
pub async fn fallback_chain_complete(
    model: &str,
    messages: &[ConversationMessage],
    tools: &[ToolDefinition],
    config: &crate::config::BladeConfig,
) -> Result<AssistantTurn, String> {
    // Primary attempt
    let primary_result = complete_turn(
        &config.provider,
        &config.api_key,
        model,
        messages,
        tools,
        config.base_url.as_deref(),
    )
    .await;

    match primary_result {
        Ok(turn) => return Ok(turn),
        Err(ref e) if !is_fallback_eligible_error(e) => return primary_result,
        Err(primary_err) => {
            // Walk the fallback chain
            for fb_provider in &config.fallback_providers {
                if fb_provider == &config.provider {
                    continue; // already tried
                }
                let fb_key = crate::config::get_provider_key(fb_provider);
                if fb_key.is_empty() && fb_provider != "ollama" {
                    continue; // no key stored — skip
                }
                // Use the provider's default cheap model as the fallback model.
                // The user's original model name almost certainly won't exist on
                // the fallback provider.
                let fb_model = crate::config::cheap_model_for_provider(fb_provider, model);
                match complete_turn(
                    fb_provider,
                    &fb_key,
                    &fb_model,
                    messages,
                    tools,
                    None, // no custom base_url for fallback providers
                )
                .await
                {
                    Ok(turn) => return Ok(turn),
                    Err(_) => continue, // try next fallback
                }
            }
            // All fallbacks exhausted — return the original primary error
            Err(primary_err)
        }
    }
}

/// Attempt `stream_text` with automatic fallback.
///
/// On a transient error (429/503/5xx) the function probes each provider listed
/// in `config.fallback_providers` in order and returns the first successful
/// stream.  `model` may include a "provider/" prefix.
pub async fn fallback_chain_stream(
    app: &tauri::AppHandle,
    model: &str,
    messages: &[ConversationMessage],
    config: &crate::config::BladeConfig,
) -> Result<(), String> {
    // Primary attempt
    let primary_result = stream_text(
        app,
        &config.provider,
        &config.api_key,
        model,
        messages,
        config.base_url.as_deref(),
    )
    .await;

    match primary_result {
        Ok(()) => return Ok(()),
        Err(ref e) if !is_fallback_eligible_error(e) => return primary_result,
        Err(primary_err) => {
            for fb_provider in &config.fallback_providers {
                if fb_provider == &config.provider {
                    continue;
                }
                let fb_key = crate::config::get_provider_key(fb_provider);
                if fb_key.is_empty() && fb_provider != "ollama" {
                    continue;
                }
                let fb_model = crate::config::cheap_model_for_provider(fb_provider, model);
                match stream_text(
                    app,
                    fb_provider,
                    &fb_key,
                    &fb_model,
                    messages,
                    None,
                )
                .await
                {
                    Ok(()) => return Ok(()),
                    Err(_) => continue,
                }
            }
            Err(primary_err)
        }
    }
}
