use super::{AssistantTurn, ConversationMessage, ToolCall, ToolDefinition};
use reqwest::Client;

fn build_body(
    model: &str,
    messages: &[ConversationMessage],
    tools: &[ToolDefinition],
) -> serde_json::Value {
    let system = messages.iter().find_map(|message| match message {
        ConversationMessage::System(content) => Some(content.clone()),
        _ => None,
    });
    let msgs: Vec<serde_json::Value> = messages.iter().filter_map(serialize_message).collect();
    let tool_defs: Vec<serde_json::Value> = tools
        .iter()
        .map(|tool| {
            serde_json::json!({
                "name": &tool.name,
                "description": &tool.description,
                "input_schema": &tool.input_schema,
            })
        })
        .collect();

    let mut body = serde_json::json!({
        "model": model,
        "max_tokens": 4096,
        "messages": msgs,
        "stream": false
    });

    if let Some(system) = system {
        body["system"] = serde_json::Value::String(system);
    }

    if !tool_defs.is_empty() {
        body["tools"] = serde_json::Value::Array(tool_defs);
    }

    body
}

fn serialize_message(message: &ConversationMessage) -> Option<serde_json::Value> {
    match message {
        ConversationMessage::System(_) => None,
        ConversationMessage::User(content) => Some(serde_json::json!({
            "role": "user",
            "content": [{"type": "text", "text": content}],
        })),
        ConversationMessage::UserWithImage { text, image_base64 } => Some(serde_json::json!({
            "role": "user",
            "content": [
                {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": image_base64}},
                {"type": "text", "text": text},
            ],
        })),
        ConversationMessage::Assistant {
            content,
            tool_calls,
        } => {
            let mut blocks = Vec::new();
            if !content.is_empty() {
                blocks.push(serde_json::json!({
                    "type": "text",
                    "text": content,
                }));
            }
            blocks.extend(tool_calls.iter().map(|call| {
                serde_json::json!({
                    "type": "tool_use",
                    "id": &call.id,
                    "name": &call.name,
                    "input": &call.arguments,
                })
            }));

            Some(serde_json::json!({
                "role": "assistant",
                "content": blocks,
            }))
        }
        ConversationMessage::Tool {
            tool_call_id,
            content,
            is_error,
            ..
        } => Some(serde_json::json!({
            "role": "user",
            "content": [{
                "type": "tool_result",
                "tool_use_id": tool_call_id,
                "content": content,
                "is_error": is_error,
            }],
        })),
    }
}

pub async fn complete(
    api_key: &str,
    model: &str,
    messages: &[ConversationMessage],
    tools: &[ToolDefinition],
) -> Result<AssistantTurn, String> {
    let client = Client::new();
    let body = build_body(model, messages, tools);

    let response = client
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("Anthropic API error {}: {}", status, body));
    }

    let json: serde_json::Value = response.json().await.map_err(|e| e.to_string())?;
    let mut content = String::new();
    let mut tool_calls = Vec::new();

    if let Some(blocks) = json["content"].as_array() {
        for block in blocks {
            match block["type"].as_str().unwrap_or_default() {
                "text" => {
                    if let Some(text) = block["text"].as_str() {
                        content.push_str(text);
                    }
                }
                "tool_use" => {
                    tool_calls.push(ToolCall {
                        id: block["id"].as_str().unwrap_or("tool_use").to_string(),
                        name: block["name"].as_str().unwrap_or("unknown_tool").to_string(),
                        arguments: block["input"].clone(),
                    });
                }
                _ => {}
            }
        }
    }

    Ok(AssistantTurn {
        content,
        tool_calls,
    })
}

pub async fn stream_text(
    app: &tauri::AppHandle,
    api_key: &str,
    model: &str,
    messages: &[ConversationMessage],
) -> Result<(), String> {
    use futures::StreamExt;
    use tauri::Emitter;

    let client = Client::new();
    let system = messages.iter().find_map(|m| match m {
        ConversationMessage::System(c) => Some(c.clone()),
        _ => None,
    });
    let msgs: Vec<serde_json::Value> = messages.iter().filter_map(serialize_message).collect();

    let mut body = serde_json::json!({
        "model": model,
        "max_tokens": 4096,
        "messages": msgs,
        "stream": true
    });
    if let Some(sys) = system {
        body["system"] = serde_json::Value::String(sys);
    }

    let response = client
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("Anthropic API error {}: {}", status, body));
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
                if let Ok(json) = serde_json::from_str::<serde_json::Value>(data) {
                    if json["type"] == "content_block_delta" {
                        if let Some(text) = json["delta"]["text"].as_str() {
                            let _ = app.emit("chat_token", text);
                        }
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
        "max_tokens": 32,
        "messages": [{"role": "user", "content": "Say hi in one word."}]
    });

    let response = client
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("Anthropic API error {}: {}", status, body));
    }

    let json: serde_json::Value = response.json().await.map_err(|e| e.to_string())?;
    let text = json["content"][0]["text"]
        .as_str()
        .unwrap_or("Connected!")
        .to_string();

    Ok(text)
}
