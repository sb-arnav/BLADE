use crate::brain;
use crate::config::{load_config, save_config, BladeConfig, SavedMcpServerConfig};
use crate::permissions;
use crate::trace;
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
const MAX_TOOL_RESULT_CHARS: usize = 12_000;

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
    let tools: Vec<ToolDefinition> = tool_snapshot
        .iter()
        .map(|tool| ToolDefinition {
            name: tool.qualified_name.clone(),
            description: tool.description.clone(),
            input_schema: tool.input_schema.clone(),
        })
        .collect();
    let conversation = providers::build_conversation(messages, Some(system_prompt));

    // No tools configured → stream directly (fast path, best UX)
    if tools.is_empty() {
        let span = trace::TraceSpan::new(&config.provider, &config.model, "stream_text");
        let result = providers::stream_text(
            &app,
            &config.provider,
            &config.api_key,
            &config.model,
            &conversation,
        )
        .await;
        let entry = span.finish(result.is_ok(), result.as_ref().err().cloned());
        trace::log_trace(&entry);
        return result;
    }

    // Tools configured → non-streaming tool loop
    let mut conversation = conversation;
    for iteration in 0..8 {
        let span = trace::TraceSpan::new(
            &config.provider,
            &config.model,
            &format!("complete_turn_{}", iteration),
        );
        let turn_result = providers::complete_turn(
            &config.provider,
            &config.api_key,
            &config.model,
            &conversation,
            &tools,
        )
        .await;
        let entry = span.finish(turn_result.is_ok(), turn_result.as_ref().err().cloned());
        trace::log_trace(&entry);
        let turn = turn_result?;

        conversation.push(ConversationMessage::Assistant {
            content: turn.content.clone(),
            tool_calls: turn.tool_calls.clone(),
        });

        if turn.tool_calls.is_empty() {
            // Final text response — emit at once (already complete)
            if !turn.content.is_empty() {
                let _ = app.emit("chat_token", turn.content);
            }
            let _ = app.emit("chat_done", ());
            return Ok(());
        }

        for tool_call in turn.tool_calls {
            // Check tool risk level
            let tool_desc = {
                let manager = state.lock().await;
                manager
                    .get_tools()
                    .iter()
                    .find(|t| t.qualified_name == tool_call.name)
                    .map(|t| t.description.clone())
                    .unwrap_or_default()
            };

            let risk = permissions::classify_tool(&tool_call.name, &tool_desc);

            if risk == permissions::ToolRisk::Blocked {
                conversation.push(ConversationMessage::Tool {
                    tool_call_id: tool_call.id,
                    tool_name: tool_call.name,
                    content: "Tool blocked by safety policy.".to_string(),
                    is_error: true,
                });
                continue;
            }

            // Emit tool execution event (for UI audit trail)
            let _ = app.emit("tool_executing", serde_json::json!({
                "name": &tool_call.name,
                "arguments": &tool_call.arguments,
                "risk": format!("{:?}", risk),
            }));

            let tool_result = {
                let mut manager = state.lock().await;
                manager
                    .call_tool(&tool_call.name, tool_call.arguments.clone())
                    .await?
            };

            let _ = app.emit("tool_completed", serde_json::json!({
                "name": &tool_call.name,
                "is_error": tool_result.is_error,
            }));

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
    if name.trim().is_empty() {
        return Err("MCP server name cannot be empty.".to_string());
    }
    if command.trim().is_empty() {
        return Err("MCP server command cannot be empty.".to_string());
    }

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
pub async fn mcp_server_status(
    state: tauri::State<'_, SharedMcpManager>,
) -> Result<Vec<(String, bool)>, String> {
    let manager = state.lock().await;
    Ok(manager.server_status())
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
    let parts = result
        .content
        .iter()
        .filter_map(|content| content.text.clone())
        .collect::<Vec<_>>();

    let text = if parts.is_empty() {
        serde_json::to_string(&result.content)
            .unwrap_or_else(|_| "Tool returned no text.".to_string())
    } else {
        parts.join("\n")
    };

    let truncated = if text.chars().count() > MAX_TOOL_RESULT_CHARS {
        let shortened = text.chars().take(MAX_TOOL_RESULT_CHARS).collect::<String>();
        format!(
            "{}\n\n[tool output truncated after {} characters]",
            shortened, MAX_TOOL_RESULT_CHARS
        )
    } else {
        text
    };

    if result.is_error {
        format!("Tool error:\n{}", truncated)
    } else {
        truncated
    }
}
