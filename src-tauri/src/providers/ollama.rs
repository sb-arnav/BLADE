use super::ChatMessage;
use futures::StreamExt;
use reqwest::Client;
use tauri::{AppHandle, Emitter};

pub async fn stream(
    app: &AppHandle,
    model: &str,
    messages: Vec<ChatMessage>,
    system_prompt: Option<&str>,
) -> Result<(), String> {
    let client = Client::new();

    let mut msgs: Vec<serde_json::Value> = Vec::new();

    if let Some(sys) = system_prompt {
        msgs.push(serde_json::json!({"role": "system", "content": sys}));
    }

    for m in &messages {
        msgs.push(serde_json::json!({"role": &m.role, "content": &m.content}));
    }

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

        // Ollama sends newline-delimited JSON (not SSE)
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
