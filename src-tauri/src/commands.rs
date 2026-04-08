use crate::brain;
use crate::config::{load_config, save_config, BladeConfig};
use crate::mcp::{McpManager, McpServerConfig, McpTool, McpToolResult};
use crate::providers::{self, ChatMessage};
use std::sync::Arc;
use tokio::sync::Mutex;

pub type SharedMcpManager = Arc<Mutex<McpManager>>;

#[tauri::command]
pub async fn send_message_stream(
    app: tauri::AppHandle,
    state: tauri::State<'_, SharedMcpManager>,
    messages: Vec<ChatMessage>,
) -> Result<(), String> {
    let config = load_config();
    if config.api_key.is_empty() && config.provider != "ollama" {
        return Err("No API key configured. Go to settings.".to_string());
    }

    // Build system prompt with Blade personality + available MCP tools
    let manager = state.lock().await;
    let tools = manager.get_tools();
    let system_prompt = brain::build_system_prompt(tools);
    drop(manager);

    providers::stream_chat(
        &app,
        &config.provider,
        &config.api_key,
        &config.model,
        messages,
        Some(system_prompt),
    )
    .await
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

// --- MCP Commands ---

#[tauri::command]
pub async fn mcp_add_server(
    state: tauri::State<'_, SharedMcpManager>,
    name: String,
    command: String,
    args: Vec<String>,
) -> Result<(), String> {
    let config = McpServerConfig {
        command,
        args,
        env: std::collections::HashMap::new(),
    };
    let mut manager = state.lock().await;
    manager.register_server(name, config);
    Ok(())
}

#[tauri::command]
pub async fn mcp_discover_tools(
    state: tauri::State<'_, SharedMcpManager>,
) -> Result<Vec<McpTool>, String> {
    let mut manager = state.lock().await;
    manager.discover_all_tools().await
}

#[tauri::command]
pub async fn mcp_call_tool(
    state: tauri::State<'_, SharedMcpManager>,
    tool_name: String,
    arguments: serde_json::Value,
) -> Result<McpToolResult, String> {
    let mut manager = state.lock().await;
    manager.call_tool(&tool_name, arguments).await
}

#[tauri::command]
pub async fn mcp_get_tools(
    state: tauri::State<'_, SharedMcpManager>,
) -> Result<Vec<McpTool>, String> {
    let manager = state.lock().await;
    Ok(manager.get_tools().to_vec())
}
