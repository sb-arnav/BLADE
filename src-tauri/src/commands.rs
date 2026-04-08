use crate::brain;
use crate::config::{load_config, save_config, BladeConfig, SavedMcpServerConfig};
use crate::history::{
    list_conversations, load_conversation, save_conversation, ConversationSummary, HistoryMessage,
    StoredConversation,
};
use crate::mcp::{McpManager, McpServerConfig, McpTool, McpToolResult};
use crate::providers::{self, ChatMessage, ConversationMessage, ToolDefinition};
use std::collections::HashMap;
use std::sync::Arc;
use tauri::Emitter;
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

    let tool_snapshot = {
        let manager = state.lock().await;
        manager.get_tools().to_vec()
    };

    let system_prompt = brain::build_system_prompt(&tool_snapshot);
    let tools = tool_snapshot
        .iter()
        .map(|tool| ToolDefinition {
            name: tool.qualified_name.clone(),
            description: tool.description.clone(),
            input_schema: tool.input_schema.clone(),
        })
        .collect::<Vec<_>>();
    let mut conversation = providers::build_conversation(messages, Some(system_prompt));

    for _ in 0..8 {
        let turn = providers::complete_turn(
            &config.provider,
            &config.api_key,
            &config.model,
            &conversation,
            &tools,
        )
        .await?;

        conversation.push(ConversationMessage::Assistant {
            content: turn.content.clone(),
            tool_calls: turn.tool_calls.clone(),
        });

        if turn.tool_calls.is_empty() {
            if !turn.content.is_empty() {
                let _ = app.emit("chat_token", turn.content);
            }
            let _ = app.emit("chat_done", ());
            return Ok(());
        }

        for tool_call in turn.tool_calls {
            let tool_result = {
                let mut manager = state.lock().await;
                manager
                    .call_tool(&tool_call.name, tool_call.arguments.clone())
                    .await?
            };

            conversation.push(ConversationMessage::Tool {
                tool_call_id: tool_call.id,
                tool_name: tool_call.name,
                content: format_tool_result(&tool_result),
                is_error: tool_result.is_error,
            });
        }
    }

    let _ = app.emit("chat_done", ());
    Err("Tool loop exceeded safe limit.".to_string())
}

#[tauri::command]
pub fn get_config() -> BladeConfig {
    load_config()
}

#[tauri::command]
pub fn set_config(provider: String, api_key: String, model: String) -> Result<(), String> {
    let mut config = load_config();
    config.provider = provider;
    config.api_key = api_key;
    config.model = model;
    config.onboarded = true;
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

#[tauri::command]
pub async fn mcp_add_server(
    state: tauri::State<'_, SharedMcpManager>,
    name: String,
    command: String,
    args: Vec<String>,
) -> Result<(), String> {
    let config = McpServerConfig {
        command: command.clone(),
        args: args.clone(),
        env: HashMap::new(),
    };

    let mut saved = load_config();
    saved.mcp_servers.retain(|server| server.name != name);
    saved.mcp_servers.push(SavedMcpServerConfig {
        name: name.clone(),
        command,
        args,
        env: HashMap::new(),
    });
    save_config(&saved)?;

    let mut manager = state.lock().await;
    manager.register_server(name, config);
    let _ = manager.discover_all_tools().await?;
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

#[tauri::command]
pub fn mcp_get_servers() -> Vec<SavedMcpServerConfig> {
    load_config().mcp_servers
}

#[tauri::command]
pub async fn mcp_remove_server(
    state: tauri::State<'_, SharedMcpManager>,
    name: String,
) -> Result<(), String> {
    let mut config = load_config();
    config.mcp_servers.retain(|server| server.name != name);
    save_config(&config)?;

    let mut manager = state.lock().await;
    manager.remove_server(&name).await;
    Ok(())
}

#[tauri::command]
pub fn history_list_conversations() -> Result<Vec<ConversationSummary>, String> {
    list_conversations()
}

#[tauri::command]
pub fn history_load_conversation(conversation_id: String) -> Result<StoredConversation, String> {
    load_conversation(&conversation_id)
}

#[tauri::command]
pub fn history_save_conversation(
    conversation_id: String,
    messages: Vec<HistoryMessage>,
) -> Result<ConversationSummary, String> {
    save_conversation(&conversation_id, messages)
}

fn format_tool_result(result: &McpToolResult) -> String {
    let mut parts = result
        .content
        .iter()
        .filter_map(|content| content.text.clone())
        .collect::<Vec<_>>();

    if parts.is_empty() {
        parts.push(
            serde_json::to_string(&result.content)
                .unwrap_or_else(|_| "Tool returned no text.".to_string()),
        );
    }

    if result.is_error {
        format!("Tool error:\n{}", parts.join("\n"))
    } else {
        parts.join("\n")
    }
}
