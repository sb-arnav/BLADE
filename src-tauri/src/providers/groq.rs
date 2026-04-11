use super::{AssistantTurn, ConversationMessage, ToolCall, ToolDefinition};
use reqwest::Client;

fn build_body(
    model: &str,
    messages: &[ConversationMessage],
    tools: &[ToolDefinition],
) -> serde_json::Value {
    let mut msgs: Vec<serde_json::Value> = messages.iter().map(serialize_message).collect();

    // Non-vision models reject array content — flatten image messages to text only
    let is_vision =
        model.contains("vision") || model.contains("scout") || model.contains("llama-4");
    if !is_vision {
        for msg in &mut msgs {
            if msg["content"].is_array() {
                let text = msg["content"]
                    .as_array()
                    .unwrap_or(&vec![])
                    .iter()
                    .filter_map(|p| p["text"].as_str())
                    .collect::<Vec<_>>()
                    .join("\n");
                msg["content"] = serde_json::Value::String(text);
            }
        }
    }

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

    let mut body = serde_json::json!({
        "model": model,
        "messages": msgs,
        "stream": false
    });

    if !tool_payload.is_empty() {
        body["tools"] = serde_json::Value::Array(tool_payload);
        body["tool_choice"] = serde_json::Value::String("auto".to_string());
    }

    body
}

fn serialize_message(message: &ConversationMessage) -> serde_json::Value {
    match message {
        ConversationMessage::System(content) => serde_json::json!({
            "role": "system",
            "content": content,
        }),
        ConversationMessage::User(content) => serde_json::json!({
            "role": "user",
            "content": content,
        }),
        ConversationMessage::UserWithImage { text, image_base64 } => serde_json::json!({
            "role": "user",
            "content": [
                {"type": "text", "text": text},
                {"type": "image_url", "image_url": {"url": format!("data:image/png;base64,{}", image_base64)}}
            ],
        }),
        ConversationMessage::Assistant {
            content,
            tool_calls,
        } => {
            let tool_calls_json: Vec<serde_json::Value> = tool_calls
                .iter()
                .map(|call| {
                    serde_json::json!({
                        "id": &call.id,
                        "type": "function",
                        "function": {
                            "name": &call.name,
                            "arguments": serde_json::to_string(&call.arguments).unwrap_or_else(|_| "{}".to_string()),
                        }
                    })
                })
                .collect();

            let content_value = if content.is_empty() && !tool_calls.is_empty() {
                serde_json::Value::Null
            } else {
                serde_json::Value::String(content.clone())
            };

            serde_json::json!({
                "role": "assistant",
                "content": content_value,
                "tool_calls": tool_calls_json,
            })
        }
        ConversationMessage::Tool {
            tool_call_id,
            content,
            ..
        } => serde_json::json!({
            "role": "tool",
            "tool_call_id": tool_call_id,
            "content": content,
        }),
    }
}

fn parse_tool_calls(tool_calls: &[serde_json::Value]) -> Vec<ToolCall> {
    tool_calls
        .iter()
        .map(|call| {
            let raw_name = call["function"]["name"]
                .as_str()
                .unwrap_or("unknown_tool");

            // Some Groq/Llama models corrupt the tool name by appending extra
            // characters or the arguments JSON directly to it, e.g.:
            //   blade_glob{"pattern":"**/*.ts"}
            //   blade_bash[]{"command":"..."}
            // Extract: (a) the clean name = only [a-zA-Z0-9_] chars from the
            // start, (b) the first {...} block as embedded args if present.
            let clean_name: String = raw_name
                .chars()
                .take_while(|c| c.is_alphanumeric() || *c == '_')
                .collect();
            let name = if clean_name.is_empty() { raw_name.to_string() } else { clean_name };

            let embedded_args = raw_name
                .find('{')
                .and_then(|pos| serde_json::from_str::<serde_json::Value>(&raw_name[pos..]).ok());

            // Prefer the explicit arguments field; fall back to embedded args.
            let arguments = call["function"]["arguments"]
                .as_str()
                .and_then(|raw| serde_json::from_str(raw).ok())
                .or(embedded_args)
                .unwrap_or_else(|| serde_json::json!({}));

            ToolCall {
                id: call["id"].as_str().unwrap_or("call").to_string(),
                name,
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
) -> Result<AssistantTurn, String> {
    let client = Client::new();

    // First attempt: with tools.
    let result = groq_request(&client, api_key, build_body(model, messages, tools)).await;

    match result {
        Ok(turn) => return Ok(turn),
        Err(ref e) if is_function_generation_error(e) && !tools.is_empty() => {
            // Groq/Llama failed to generate a valid tool call — retry without
            // tools so the user gets a text response instead of a hard error.
            groq_request(&client, api_key, build_body(model, messages, &[])).await
        }
        Err(e) => Err(e),
    }
}

/// Returns true when Groq reports the model failed to generate a valid function call.
/// In that case we can retry without tools to still return useful text.
fn is_function_generation_error(err: &str) -> bool {
    err.contains("Failed to call a function") || err.contains("failed_generation")
}

async fn groq_request(
    client: &Client,
    api_key: &str,
    body: serde_json::Value,
) -> Result<AssistantTurn, String> {
    let response = client
        .post("https://api.groq.com/openai/v1/chat/completions")
        .header("Authorization", format!("Bearer {}", api_key))
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("Groq API error {}: {}", status, body));
    }

    let json: serde_json::Value = response.json().await.map_err(|e| e.to_string())?;
    let message = &json["choices"][0]["message"];
    let content = message["content"].as_str().unwrap_or_default().to_string();
    let tool_calls = message["tool_calls"]
        .as_array()
        .map(|v| parse_tool_calls(v))
        .unwrap_or_default();

    Ok(AssistantTurn {
        content,
        tool_calls,
    })
}

fn serialize_simple(message: &super::ConversationMessage) -> Option<serde_json::Value> {
    match message {
        super::ConversationMessage::System(c) => {
            Some(serde_json::json!({"role": "system", "content": c}))
        }
        super::ConversationMessage::User(c) => {
            Some(serde_json::json!({"role": "user", "content": c}))
        }
        super::ConversationMessage::UserWithImage { text, image_base64 } => {
            Some(serde_json::json!({
                "role": "user",
                "content": [
                    {"type": "text", "text": text},
                    {"type": "image_url", "image_url": {"url": format!("data:image/png;base64,{}", image_base64)}}
                ],
            }))
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
) -> Result<(), String> {
    use futures::StreamExt;
    use tauri::Emitter;

    let client = Client::new();
    let mut msgs: Vec<serde_json::Value> = messages.iter().filter_map(serialize_simple).collect();

    // Non-vision models reject array content — flatten image messages to text only
    let is_vision =
        model.contains("vision") || model.contains("scout") || model.contains("llama-4");
    if !is_vision {
        for msg in &mut msgs {
            if msg["content"].is_array() {
                let text = msg["content"]
                    .as_array()
                    .unwrap_or(&vec![])
                    .iter()
                    .filter_map(|p| p["text"].as_str())
                    .collect::<Vec<_>>()
                    .join("\n");
                msg["content"] = serde_json::Value::String(text);
            }
        }
    }

    let body = serde_json::json!({
        "model": model,
        "messages": msgs,
        "stream": true
    });

    let response = client
        .post("https://api.groq.com/openai/v1/chat/completions")
        .header("Authorization", format!("Bearer {}", api_key))
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("Groq API error {}: {}", status, body));
    }

    let mut stream = response.bytes_stream();
    let mut buffer = String::new();

    while let Some(chunk) = stream.next().await {
        let bytes = chunk.map_err(|e| format!("Stream error: {}", e))?;
        buffer.push_str(&String::from_utf8_lossy(&bytes));

        while let Some(pos) = buffer.find('\n') {
            let line = buffer[..pos].to_string();
            buffer = buffer[pos + 1..].to_string();

            if let Some(data) = line.strip_prefix("data: ") {
                if data.trim() == "[DONE]" {
                    break;
                }
                if let Ok(json) = serde_json::from_str::<serde_json::Value>(data) {
                    if let Some(text) = json["choices"][0]["delta"]["content"].as_str() {
                        let _ = app.emit("chat_token", text);
                    }
                }
            }
        }
    }

    let _ = app.emit("chat_done", ());
    Ok(())
}

pub async fn test(api_key: &str, model: &str) -> Result<String, String> {
    let client = Client::new();
    let body = serde_json::json!({
        "model": model,
        "messages": [{"role": "user", "content": "Say hi in one word."}],
        "stream": false
    });

    let response = client
        .post("https://api.groq.com/openai/v1/chat/completions")
        .header("Authorization", format!("Bearer {}", api_key))
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("Groq API error {}: {}", status, body));
    }

    let json: serde_json::Value = response.json().await.map_err(|e| e.to_string())?;
    let text = json["choices"][0]["message"]["content"]
        .as_str()
        .unwrap_or("Connected!")
        .to_string();

    Ok(text)
}
