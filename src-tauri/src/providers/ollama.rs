use super::{AssistantTurn, ConversationMessage};

pub async fn complete(
    model: &str,
    messages: &[ConversationMessage],
) -> Result<AssistantTurn, String> {
    let client = super::http_client();

    let msgs: Vec<serde_json::Value> = messages
        .iter()
        .filter_map(|message| match message {
            ConversationMessage::System(content) => Some(serde_json::json!({
                "role": "system",
                "content": content,
            })),
            ConversationMessage::User(content) => Some(serde_json::json!({
                "role": "user",
                "content": content,
            })),
            ConversationMessage::UserWithImage { text, image_base64 } => Some(serde_json::json!({
                "role": "user",
                "content": text,
                "images": [image_base64],
            })),
            ConversationMessage::Assistant { content, .. } => Some(serde_json::json!({
                "role": "assistant",
                "content": content,
            })),
            ConversationMessage::Tool { .. } => None,
        })
        .collect();

    let body = serde_json::json!({
        "model": model,
        "messages": msgs,
        "stream": false
    });

    let response = client
        .post("http://localhost:11434/api/chat")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Ollama not running? Error: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("Ollama error {}: {}", status, body));
    }

    let json: serde_json::Value = response.json().await.map_err(|e| e.to_string())?;
    let content = json["message"]["content"]
        .as_str()
        .unwrap_or_default()
        .to_string();
    // Phase 33 / LOOP-04 — Ollama's chat API may emit a `done_reason` field
    // ("stop" | "length" | …) but coverage varies across local models.
    // Best-effort: surface it when present; otherwise the truncation
    // detection in loop_engine falls back to the punctuation heuristic.
    let stop_reason = json["done_reason"].as_str().map(|s| s.to_string());

    // Phase 33 / LOOP-06 — Ollama may surface eval_count (output tokens) +
    // prompt_eval_count (input tokens) at the top level. Coverage varies;
    // when missing, default to 0 (cost is 0.0/$M for ollama anyway, so this
    // contributes nothing to cumulative_cost_usd regardless).
    let tokens_in = json["prompt_eval_count"].as_u64().unwrap_or(0).min(u32::MAX as u64) as u32;
    let tokens_out = json["eval_count"].as_u64().unwrap_or(0).min(u32::MAX as u64) as u32;

    Ok(AssistantTurn {
        content,
        tool_calls: Vec::new(),
        stop_reason,
        tokens_in,
        tokens_out,
    })
}

pub async fn stream_text(
    app: &tauri::AppHandle,
    model: &str,
    messages: &[super::ConversationMessage],
) -> Result<(), String> {
    use futures::StreamExt;
    use tauri::Emitter;

    let client = super::http_client();
    let msgs: Vec<serde_json::Value> = messages
        .iter()
        .filter_map(|m| match m {
            super::ConversationMessage::System(c) => {
                Some(serde_json::json!({"role": "system", "content": c}))
            }
            super::ConversationMessage::User(c) => {
                Some(serde_json::json!({"role": "user", "content": c}))
            }
            super::ConversationMessage::UserWithImage { text, image_base64 } => {
                Some(serde_json::json!({"role": "user", "content": text, "images": [image_base64]}))
            }
            super::ConversationMessage::Assistant { content, .. } => {
                Some(serde_json::json!({"role": "assistant", "content": content}))
            }
            super::ConversationMessage::Tool { .. } => None,
        })
        .collect();

    let body = serde_json::json!({
        "model": model,
        "messages": msgs,
        "stream": true
    });

    let response = client
        .post("http://localhost:11434/api/chat")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Ollama not running? Error: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("Ollama error {}: {}", status, body));
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

                if !line.trim().is_empty() {
                    if let Ok(json) = serde_json::from_str::<serde_json::Value>(&line) {
                        if let Some(err) = json.get("error") {
                            return Err(format!("Ollama error: {}", err));
                        }
                        if let Some(text) = json["message"]["content"].as_str() {
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

pub async fn test(model: &str) -> Result<String, String> {
    let client = super::http_client();
    let body = serde_json::json!({
        "model": model,
        "messages": [{"role": "user", "content": "Say hi in one word."}],
        "stream": false
    });

    let response = client
        .post("http://localhost:11434/api/chat")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Ollama not running? Error: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("Ollama error {}: {}", status, body));
    }

    let json: serde_json::Value = response.json().await.map_err(|e| e.to_string())?;
    let text = json["message"]["content"]
        .as_str()
        .unwrap_or("Connected!")
        .to_string();

    Ok(text)
}

// ── Phase 54 / PROVIDER-MIGRATION (ollama) ───────────────────────────────────
//
// Adapter struct + ProviderDef impl. Delegates to local `complete` so the
// existing local-socket HTTP path is preserved verbatim. Ollama doesn't
// take an API key and currently ignores tool definitions — the trait impl
// accepts both for signature compatibility but only `messages` reach the
// underlying call.
// Adapted from block/goose (Apache 2.0).

use super::goose_traits::{BladeModelConfig, Provider, ProviderDef, ProviderMetadata};
use super::ToolDefinition;

pub struct OllamaProvider {
    config: BladeModelConfig,
}

impl OllamaProvider {
    #[allow(dead_code)] // Phase 54 — wired in PROVIDER-ROUTER-WIRE / future call sites.
    pub fn new(config: BladeModelConfig) -> Self {
        Self { config }
    }
}

impl Provider for OllamaProvider {
    fn get_name(&self) -> &str {
        "ollama"
    }

    fn get_model_config(&self) -> &BladeModelConfig {
        &self.config
    }

    async fn complete(
        &self,
        _api_key: &str,
        messages: &[ConversationMessage],
        _tools: &[ToolDefinition],
    ) -> Result<AssistantTurn, String> {
        // Ollama authenticates via local Unix socket / 127.0.0.1; no API
        // key. Tool calling lives behind the model's native function-calling
        // training (e.g. Hermes 3) and is invoked by the `complete` fn
        // itself, not via the trait param — pass-through preserves shape.
        complete(&self.config.model_name, messages).await
    }
}

pub struct OllamaDef;

impl ProviderDef for OllamaDef {
    fn metadata() -> ProviderMetadata {
        ProviderMetadata::new(
            "ollama",
            "Ollama (local)",
            "Local model server — Hermes 3 / Llama 3 / others; zero-cost inference on user hardware",
            "llama3",
            "https://ollama.com/library",
            // No config keys: local socket, no API key.
            vec![],
        )
    }
}

#[cfg(test)]
mod phase54_migration_tests {
    use super::*;

    #[test]
    fn ollama_provider_def_metadata() {
        let m = OllamaDef::metadata();
        assert_eq!(m.name, "ollama");
        assert_eq!(m.default_model, "llama3");
        assert!(m.config_keys.is_empty(), "ollama has no API key");
    }

    #[test]
    fn ollama_provider_get_name() {
        let p = OllamaProvider::new(BladeModelConfig::new("llama3"));
        assert_eq!(p.get_name(), "ollama");
        assert_eq!(p.get_model_config().model_name, "llama3");
    }
}
