use super::{AssistantTurn, ConversationMessage, ToolCall, ToolDefinition};
use reqwest::Client;

fn build_body(messages: &[ConversationMessage], tools: &[ToolDefinition]) -> serde_json::Value {
    let system_instruction = messages.iter().find_map(|message| match message {
        ConversationMessage::System(content) => Some(serde_json::json!({
            "parts": [{"text": content}]
        })),
        _ => None,
    });

    let contents: Vec<serde_json::Value> = messages.iter().filter_map(serialize_message).collect();
    let declarations: Vec<serde_json::Value> = tools
        .iter()
        .map(|tool| {
            serde_json::json!({
                "name": &tool.name,
                "description": &tool.description,
                "parameters": &tool.input_schema,
            })
        })
        .collect();

    let mut body = serde_json::json!({ "contents": contents });

    if let Some(system_instruction) = system_instruction {
        body["systemInstruction"] = system_instruction;
    }

    if !declarations.is_empty() {
        body["tools"] = serde_json::json!([{ "functionDeclarations": declarations }]);
    }

    body
}

fn serialize_message(message: &ConversationMessage) -> Option<serde_json::Value> {
    match message {
        ConversationMessage::System(_) => None,
        ConversationMessage::User(content) => Some(serde_json::json!({
            "role": "user",
            "parts": [{"text": content}],
        })),
        ConversationMessage::UserWithImage { text, image_base64 } => Some(serde_json::json!({
            "role": "user",
            "parts": [
                {"text": text},
                {"inlineData": {"mimeType": "image/png", "data": image_base64}},
            ],
        })),
        ConversationMessage::Assistant {
            content,
            tool_calls,
        } => {
            let mut parts = Vec::new();
            if !content.is_empty() {
                parts.push(serde_json::json!({ "text": content }));
            }
            parts.extend(tool_calls.iter().map(|call| {
                serde_json::json!({
                    "functionCall": {
                        "name": &call.name,
                        "args": &call.arguments,
                    }
                })
            }));

            Some(serde_json::json!({
                "role": "model",
                "parts": parts,
            }))
        }
        ConversationMessage::Tool {
            tool_name,
            content,
            is_error,
            ..
        } => Some(serde_json::json!({
            "role": "user",
            "parts": [{
                "functionResponse": {
                    "name": tool_name,
                    "response": {
                        "content": content,
                        "is_error": is_error,
                    }
                }
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
    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent?key={}",
        model, api_key
    );
    let body = build_body(messages, tools);

    let response = client
        .post(&url)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("Gemini API error {}: {}", status, body));
    }

    let json: serde_json::Value = response.json().await.map_err(|e| e.to_string())?;
    let mut content = String::new();
    let mut tool_calls = Vec::new();

    if let Some(parts) = json["candidates"][0]["content"]["parts"].as_array() {
        for (index, part) in parts.iter().enumerate() {
            if let Some(text) = part["text"].as_str() {
                content.push_str(text);
            }
            if let Some(function_call) = part.get("functionCall") {
                tool_calls.push(ToolCall {
                    id: format!(
                        "gemini_call_{}_{}",
                        function_call["name"].as_str().unwrap_or("tool"),
                        index
                    ),
                    name: function_call["name"]
                        .as_str()
                        .unwrap_or("unknown_tool")
                        .to_string(),
                    arguments: function_call["args"].clone(),
                });
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
    messages: &[super::ConversationMessage],
) -> Result<(), String> {
    use futures::StreamExt;
    use tauri::Emitter;

    let client = Client::new();
    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/models/{}:streamGenerateContent?alt=sse&key={}",
        model, api_key
    );

    let body = build_body(messages, &[]);

    let response = client
        .post(&url)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("Gemini API error {}: {}", status, body));
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
                    if let Some(text) =
                        json["candidates"][0]["content"]["parts"][0]["text"].as_str()
                    {
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
    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent?key={}",
        model, api_key
    );

    let body = serde_json::json!({
        "contents": [{"role": "user", "parts": [{"text": "Say hi in one word."}]}]
    });

    let response = client
        .post(&url)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("Gemini API error {}: {}", status, body));
    }

    let json: serde_json::Value = response.json().await.map_err(|e| e.to_string())?;
    let text = json["candidates"][0]["content"]["parts"][0]["text"]
        .as_str()
        .unwrap_or("Connected!")
        .to_string();

    Ok(text)
}
