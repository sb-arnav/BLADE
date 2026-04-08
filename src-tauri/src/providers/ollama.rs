use super::{AssistantTurn, ConversationMessage};
use reqwest::Client;

pub async fn complete(
    model: &str,
    messages: &[ConversationMessage],
) -> Result<AssistantTurn, String> {
    let client = Client::new();

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

    Ok(AssistantTurn {
        content,
        tool_calls: Vec::new(),
    })
}

pub async fn stream_text(
    app: &tauri::AppHandle,
    model: &str,
    messages: &[super::ConversationMessage],
) -> Result<(), String> {
    use futures::StreamExt;
    use tauri::Emitter;

    let client = Client::new();
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

    while let Some(chunk) = stream.next().await {
        let bytes = chunk.map_err(|e| format!("Stream error: {}", e))?;
        buffer.push_str(&String::from_utf8_lossy(&bytes));

        while let Some(pos) = buffer.find('\n') {
            let line = buffer[..pos].to_string();
            buffer = buffer[pos + 1..].to_string();

            if !line.trim().is_empty() {
                if let Ok(json) = serde_json::from_str::<serde_json::Value>(&line) {
                    if let Some(text) = json["message"]["content"].as_str() {
                        let _ = app.emit("chat_token", text);
                    }
                }
            }
        }
    }

    let _ = app.emit("chat_done", ());
    Ok(())
}

pub async fn test(model: &str) -> Result<String, String> {
    let client = Client::new();
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
