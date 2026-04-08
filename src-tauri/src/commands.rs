use crate::config::{load_config, save_config, BladeConfig};
use crate::providers::{self, ChatMessage};

#[tauri::command]
pub async fn send_message_stream(
    app: tauri::AppHandle,
    messages: Vec<ChatMessage>,
) -> Result<(), String> {
    let config = load_config();
    if config.api_key.is_empty() && config.provider != "ollama" {
        return Err("No API key configured. Go to settings.".to_string());
    }

    providers::stream_chat(&app, &config.provider, &config.api_key, &config.model, messages).await
}

#[tauri::command]
pub fn get_config() -> BladeConfig {
    load_config()
}

#[tauri::command]
pub fn set_config(provider: String, api_key: String, model: String) -> Result<(), String> {
    let config = BladeConfig {
        provider,
        api_key,
        model,
        onboarded: true,
    };
    save_config(&config)
}

#[tauri::command]
pub async fn test_provider(
    provider: String,
    api_key: String,
    model: String,
) -> Result<String, String> {
    providers::test_connection(&provider, &api_key, &model).await
}
