use super::{AssistantTurn, ConversationMessage};
use reqwest::Client;

pub async fn complete(model: &str, messages: &[ConversationMessage]) -> Result<AssistantTurn, String> {
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
