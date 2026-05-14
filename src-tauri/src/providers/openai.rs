use super::{AssistantTurn, ConversationMessage, ToolCall, ToolDefinition};

/// Resolve a base_url (e.g. "https://openrouter.ai/api/v1") to a full
/// chat completions endpoint, or fall back to the OpenAI default.
fn chat_url(base_url: Option<&str>) -> String {
    match base_url {
        Some(base) => {
            let base = base.trim_end_matches('/');
            if base.ends_with("/chat/completions") {
                base.to_string()
            } else {
                format!("{}/chat/completions", base)
            }
        }
        None => "https://api.openai.com/v1/chat/completions".to_string(),
    }
}

fn build_body(
    model: &str,
    messages: &[ConversationMessage],
    tools: &[ToolDefinition],
    max_tokens_override: Option<u32>,
) -> serde_json::Value {
    let msgs: Vec<serde_json::Value> = messages.iter().filter_map(serialize_message).collect();
    let tool_payload: Vec<serde_json::Value> = tools
        .iter()
        .map(|tool| {
            serde_json::json!({
                "type": "function",
                "function": {
                    "name": &tool.name,
                    "description": &tool.description,
                    "parameters": &tool.input_schema,
                }
            })
        })
        .collect();

    // Phase 33 / LOOP-04 — caller may force a higher max_tokens (truncation
    // retry path). Default of 4096 is unchanged for every existing call site.
    let max_tokens = max_tokens_override.unwrap_or(4096);

    let mut body = serde_json::json!({
        "model": model,
        "messages": msgs,
        "stream": false,
        "max_tokens": max_tokens
    });

    if !tool_payload.is_empty() {
        body["tools"] = serde_json::Value::Array(tool_payload);
        body["tool_choice"] = serde_json::Value::String("auto".to_string());
    }

    body
}

fn serialize_message(message: &ConversationMessage) -> Option<serde_json::Value> {
    match message {
        ConversationMessage::System(content) => {
            if content.trim().is_empty() { return None; }
            Some(serde_json::json!({"role": "system", "content": content}))
        }
        ConversationMessage::User(content) => {
            if content.is_empty() { return None; }
            Some(serde_json::json!({"role": "user", "content": content}))
        }
        ConversationMessage::UserWithImage { text, image_base64 } => {
            let mut parts: Vec<serde_json::Value> = Vec::new();
            if !text.is_empty() {
                parts.push(serde_json::json!({"type": "text", "text": text}));
            }
            parts.push(serde_json::json!({"type": "image_url", "image_url": {"url": format!("data:image/png;base64,{}", image_base64)}}));
            Some(serde_json::json!({"role": "user", "content": parts}))
        }
        ConversationMessage::Assistant { content, tool_calls } => {
            // Skip degenerate turns: empty content + no tool calls.
            // This happens when a prior tool-calling turn gets stored without its
            // tool_calls (they aren't persisted in ChatMessage). Sending empty
            // content — even as null — causes Anthropic to reject with
            // "text content blocks must be non-empty" when routed via gateway.
            if content.is_empty() && tool_calls.is_empty() {
                return None;
            }

            let tool_calls_json: Vec<serde_json::Value> = tool_calls
                .iter()
                .map(|call| serde_json::json!({
                    "id": &call.id,
                    "type": "function",
                    "function": {
                        "name": &call.name,
                        "arguments": serde_json::to_string(&call.arguments).unwrap_or_else(|_| "{}".to_string()),
                    }
                }))
                .collect();

            let content_value = if content.is_empty() {
                serde_json::Value::Null
            } else {
                serde_json::Value::String(content.clone())
            };

            if tool_calls_json.is_empty() {
                Some(serde_json::json!({"role": "assistant", "content": content_value}))
            } else {
                Some(serde_json::json!({"role": "assistant", "content": content_value, "tool_calls": tool_calls_json}))
            }
        }
        ConversationMessage::Tool { tool_call_id, content, .. } => {
            Some(serde_json::json!({"role": "tool", "tool_call_id": tool_call_id, "content": content}))
        }
    }
}

fn parse_tool_calls(tool_calls: &[serde_json::Value]) -> Vec<ToolCall> {
    tool_calls
        .iter()
        .map(|call| {
            let arguments = call["function"]["arguments"]
                .as_str()
                .and_then(|raw| serde_json::from_str(raw).ok())
                .unwrap_or_else(|| serde_json::json!({}));

            ToolCall {
                id: call["id"].as_str().unwrap_or("call").to_string(),
                name: call["function"]["name"]
                    .as_str()
                    .unwrap_or("unknown_tool")
                    .to_string(),
                arguments,
            }
        })
        .collect()
}

pub async fn complete(
    api_key: &str,
    model: &str,
    messages: &[ConversationMessage],
    tools: &[ToolDefinition],
    base_url: Option<&str>,
) -> Result<AssistantTurn, String> {
    complete_ext(api_key, model, messages, tools, base_url, None).await
}

/// Phase 33 / LOOP-04 — extended `complete` accepting an explicit
/// `max_tokens_override` from the smart-loop truncation retry path. When
/// `None`, the legacy 4096 default applies.
pub async fn complete_ext(
    api_key: &str,
    model: &str,
    messages: &[ConversationMessage],
    tools: &[ToolDefinition],
    base_url: Option<&str>,
    max_tokens_override: Option<u32>,
) -> Result<AssistantTurn, String> {
    let client = super::http_client();
    let body = build_body(model, messages, tools, max_tokens_override);
    let url = chat_url(base_url);

    let response = client
        .post(url)
        .header("Authorization", format!("Bearer {}", api_key))
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        if status == 429 { return Err("Rate limited (429) — free tier maxed out. Wait or get a paid key at platform.openai.com/settings/billing.".to_string()); }
        if status.as_u16() == 402 {
            let msg = serde_json::from_str::<serde_json::Value>(&body)
                .ok()
                .and_then(|j| j["error"]["message"].as_str().map(|s| s.to_string()))
                .unwrap_or_else(|| "Insufficient credits. Top up at openrouter.ai/settings/credits".to_string());
            return Err(format!("Out of credits: {}", msg));
        }
        if status == 403 && body.contains("RestrictedModelsError") {
            return Err("Vercel AI Gateway: free credits are restricted due to abuse. Top up at vercel.com/ai to use this model.".to_string());
        }
        return Err(format!("API error {}: {}", status, body));
    }

    let json: serde_json::Value = response.json().await.map_err(|e| e.to_string())?;
    let choice = &json["choices"][0];
    let message = &choice["message"];
    let content = message["content"].as_str().unwrap_or_default().to_string();
    let tool_calls = message["tool_calls"]
        .as_array()
        .map(|v| parse_tool_calls(v))
        .unwrap_or_default();
    // Phase 33 / LOOP-04 — surface finish_reason for truncation detection.
    // OpenAI / OpenRouter / Groq all use this name with values:
    // "stop" | "length" | "tool_calls" | "content_filter" | "function_call".
    // We store it under the unified `stop_reason` field on AssistantTurn.
    let stop_reason = choice["finish_reason"].as_str().map(|s| s.to_string());

    // Phase 33 / LOOP-06 — surface usage counts for cost-guard accumulation.
    // OpenAI / OpenRouter / Groq all return `usage.prompt_tokens` /
    // `usage.completion_tokens` at the top level. Some custom OpenAI-
    // compatible gateways strip `usage`; default to 0 in that case (no cost
    // accumulated, no false halt).
    let tokens_in = json["usage"]["prompt_tokens"].as_u64().unwrap_or(0).min(u32::MAX as u64) as u32;
    let tokens_out = json["usage"]["completion_tokens"].as_u64().unwrap_or(0).min(u32::MAX as u64) as u32;

    Ok(AssistantTurn {
        content,
        tool_calls,
        stop_reason,
        tokens_in,
        tokens_out,
    })
}

fn serialize_simple(message: &super::ConversationMessage) -> Option<serde_json::Value> {
    match message {
        super::ConversationMessage::System(c) => {
            Some(serde_json::json!({"role": "system", "content": c}))
        }
        super::ConversationMessage::User(c) => {
            if c.is_empty() { return None; }
            Some(serde_json::json!({"role": "user", "content": c}))
        }
        super::ConversationMessage::UserWithImage { text, image_base64 } => {
            let mut parts: Vec<serde_json::Value> = Vec::new();
            if !text.is_empty() {
                parts.push(serde_json::json!({"type": "text", "text": text}));
            }
            parts.push(serde_json::json!({"type": "image_url", "image_url": {"url": format!("data:image/png;base64,{}", image_base64)}}));
            Some(serde_json::json!({"role": "user", "content": parts}))
        }
        super::ConversationMessage::Assistant { content, .. } => {
            if content.is_empty() {
                return None;
            }
            Some(serde_json::json!({"role": "assistant", "content": content}))
        }
        super::ConversationMessage::Tool { .. } => None,
    }
}

pub async fn stream_text(
    app: &tauri::AppHandle,
    api_key: &str,
    model: &str,
    messages: &[super::ConversationMessage],
    base_url: Option<&str>,
) -> Result<(), String> {
    use futures::StreamExt;
    use tauri::Emitter;

    let client = super::http_client();
    let msgs: Vec<serde_json::Value> = messages.iter().filter_map(serialize_simple).collect();
    let url = chat_url(base_url);

    let body = serde_json::json!({
        "model": model,
        "messages": msgs,
        "stream": true,
        "max_tokens": 4096
    });

    let response = client
        .post(url)
        .header("Authorization", format!("Bearer {}", api_key))
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        if status == 429 { return Err("Rate limited (429) — free tier maxed out. Wait or get a paid key at platform.openai.com/settings/billing.".to_string()); }
        if status.as_u16() == 402 {
            let msg = serde_json::from_str::<serde_json::Value>(&body)
                .ok()
                .and_then(|j| j["error"]["message"].as_str().map(|s| s.to_string()))
                .unwrap_or_else(|| "Insufficient credits. Top up at openrouter.ai/settings/credits".to_string());
            return Err(format!("Out of credits: {}", msg));
        }
        if status == 403 && body.contains("RestrictedModelsError") {
            return Err("Vercel AI Gateway: free credits are restricted due to abuse. Top up at vercel.com/ai to use this model.".to_string());
        }
        return Err(format!("API error {}: {}", status, body));
    }

    let mut stream = response.bytes_stream();
    let mut buffer = String::new();

    let result: Result<(), String> = async {
        while let Some(chunk) = stream.next().await {
            let bytes = chunk.map_err(|e| format!("Stream error: {}", e))?;
            buffer.push_str(&String::from_utf8_lossy(&bytes));

            while let Some(pos) = buffer.find('\n') {
                let line = buffer[..pos].to_string();
                buffer = buffer[pos + 1..].to_string();

                if let Some(data) = line.strip_prefix("data: ") {
                    if data.trim() == "[DONE]" {
                        return Ok(());
                    }
                    if let Ok(json) = serde_json::from_str::<serde_json::Value>(data) {
                        // Check for error objects embedded in the stream
                        if let Some(err) = json.get("error") {
                            let msg = err["message"].as_str().unwrap_or("Unknown stream error");
                            return Err(format!("API error during stream: {}", msg));
                        }
                        if let Some(text) = json["choices"][0]["delta"]["content"].as_str() {
                            let _ = app.emit_to("main", "chat_token", text);
                        }
                    }
                }
            }
        }
        Ok(())
    }.await;

    // Always emit chat_done so the frontend never gets stuck in loading state
    let _ = app.emit_to("main", "chat_done", ());

    result
}

pub async fn test(api_key: &str, model: &str, base_url: Option<&str>) -> Result<String, String> {
    let client = super::http_client();
    let url = chat_url(base_url);
    let body = serde_json::json!({
        "model": model,
        "messages": [{"role": "user", "content": "Say hi in one word."}],
        "stream": false,
        "max_tokens": 10
    });

    let response = client
        .post(url)
        .header("Authorization", format!("Bearer {}", api_key))
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        if status == 429 { return Err("Rate limited (429) — free tier maxed out. Wait or get a paid key at platform.openai.com/settings/billing.".to_string()); }
        if status.as_u16() == 402 {
            let msg = serde_json::from_str::<serde_json::Value>(&body)
                .ok()
                .and_then(|j| j["error"]["message"].as_str().map(|s| s.to_string()))
                .unwrap_or_else(|| "Insufficient credits. Top up at openrouter.ai/settings/credits".to_string());
            return Err(format!("Out of credits: {}", msg));
        }
        if status == 403 && body.contains("RestrictedModelsError") {
            return Err("Vercel AI Gateway: free credits are restricted due to abuse. Top up at vercel.com/ai to use this model.".to_string());
        }
        return Err(format!("API error {}: {}", status, body));
    }

    let json: serde_json::Value = response.json().await.map_err(|e| e.to_string())?;
    let text = json["choices"][0]["message"]["content"]
        .as_str()
        .unwrap_or("Connected!")
        .to_string();

    Ok(text)
}

// ── Phase 54 / PROVIDER-MIGRATION (openai) ───────────────────────────────────
//
// Adapter struct + ProviderDef impl. Delegates to `complete_ext` so the
// existing OpenAI-compatible HTTP path is preserved verbatim (also used by
// OpenRouter, Vercel AI Gateway, NVIDIA NIM, etc. when `base_url` is set).
// Adapted from block/goose (Apache 2.0).

use super::goose_traits::{
    BladeModelConfig, ConfigKey, Provider, ProviderDef, ProviderMetadata,
};

pub struct OpenAIProvider {
    api_key: String,
    config: BladeModelConfig,
}

impl OpenAIProvider {
    #[allow(dead_code)] // Phase 54 — wired in PROVIDER-ROUTER-WIRE / future call sites.
    pub fn new(api_key: impl Into<String>, config: BladeModelConfig) -> Self {
        Self {
            api_key: api_key.into(),
            config,
        }
    }
}

impl Provider for OpenAIProvider {
    fn get_name(&self) -> &str {
        "openai"
    }

    fn get_model_config(&self) -> &BladeModelConfig {
        &self.config
    }

    async fn complete(
        &self,
        api_key: &str,
        messages: &[ConversationMessage],
        tools: &[ToolDefinition],
    ) -> Result<AssistantTurn, String> {
        let key = if api_key.is_empty() { &self.api_key } else { api_key };
        complete_ext(
            key,
            &self.config.model_name,
            messages,
            tools,
            self.config.base_url.as_deref(),
            self.config.max_tokens_override,
        )
        .await
    }
}

pub struct OpenAIDef;

impl ProviderDef for OpenAIDef {
    fn metadata() -> ProviderMetadata {
        ProviderMetadata::new(
            "openai",
            "OpenAI",
            "GPT family — frontier general models + vision + tool use",
            "gpt-4o",
            "https://platform.openai.com/docs/models",
            vec![ConfigKey::new("OPENAI_API_KEY", true, true, None)],
        )
    }
}

#[cfg(test)]
mod phase54_migration_tests {
    use super::*;

    #[test]
    fn openai_provider_def_metadata() {
        let m = OpenAIDef::metadata();
        assert_eq!(m.name, "openai");
        assert_eq!(m.default_model, "gpt-4o");
        assert!(m.config_keys.iter().any(|k| k.name == "OPENAI_API_KEY"));
    }

    #[test]
    fn openai_provider_get_name() {
        let p = OpenAIProvider::new("sk-test", BladeModelConfig::new("gpt-4o"));
        assert_eq!(p.get_name(), "openai");
        assert_eq!(p.get_model_config().model_name, "gpt-4o");
        assert!(!p.supports_cache_control()); // default false; OpenAI cache is implicit
    }
}
