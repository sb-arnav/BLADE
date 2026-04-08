use super::ChatMessage;
use futures::StreamExt;
use reqwest::Client;
use tauri::{AppHandle, Emitter};

fn build_body(model: &str, messages: &[ChatMessage], system_prompt: Option<&str>) -> serde_json::Value {
    let msgs: Vec<serde_json::Value> = messages
        .iter()
        .map(|m| {
            serde_json::json!({
                "role": &m.role,
                "content": &m.content
            })
        })
        .collect();

    let mut body = serde_json::json!({
        "model": model,
        "max_tokens": 4096,
        "messages": msgs,
        "stream": true
    });

    if let Some(sys) = system_prompt {
        body["system"] = serde_json::json!(sys);
    }

    body
}

pub async fn stream(
    app: &AppHandle,
    api_key: &str,
    model: &str,
    messages: Vec<ChatMessage>,
    system_prompt: Option<&str>,
) -> Result<(), String> {
    let client = Client::new();
    let body = build_body(model, &messages, system_prompt);

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
                    // Anthropic streams content_block_delta events
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
