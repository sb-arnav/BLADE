use crate::brain;
use crate::reports;
use crate::config::{load_config, save_config, BladeConfig, SavedMcpServerConfig};
use crate::history::{
    list_conversations, load_conversation, save_conversation, ConversationSummary, HistoryMessage,
    StoredConversation,
};
use crate::mcp::{McpManager, McpServerConfig, McpTool, McpToolResult};
use crate::permissions;
use crate::providers::{self, ChatMessage, ConversationMessage, ToolDefinition};
use crate::trace;
use std::collections::HashMap as StdHashMap;
use std::collections::HashMap;
use std::sync::Arc;
use tauri::Emitter;
use tokio::sync::oneshot;
use tokio::sync::Mutex;

pub type SharedMcpManager = Arc<Mutex<McpManager>>;
pub type ApprovalMap = Arc<Mutex<StdHashMap<String, oneshot::Sender<bool>>>>;
const MAX_TOOL_RESULT_CHARS: usize = 12_000;

#[tauri::command]
pub async fn send_message_stream(
    app: tauri::AppHandle,
    state: tauri::State<'_, SharedMcpManager>,
    approvals: tauri::State<'_, ApprovalMap>,
    vector_store: tauri::State<'_, crate::embeddings::SharedVectorStore>,
    messages: Vec<ChatMessage>,
) -> Result<(), String> {
    let _ = app.emit("blade_status", "processing");

    let mut config = load_config();
    if config.api_key.is_empty() && config.provider != "ollama" {
        let _ = app.emit("blade_status", "error");
        return Err("No API key configured. Go to settings.".to_string());
    }

    // Smart routing: auto-select best model for the task
    if let Some(last_user_msg) = messages.iter().rev().find(|m| m.role == "user") {
        let has_image = last_user_msg.image_base64.is_some();
        let task = crate::router::classify_task(&last_user_msg.content, has_image);
        if let Some(suggested) = crate::router::suggest_model(&config.provider, &task) {
            config.model = suggested;
        }
    }

    // Token-efficient mode: downgrade to faster/cheaper model
    if config.token_efficient {
        config.model = match (config.provider.as_str(), config.model.as_str()) {
            ("anthropic", m) if m.contains("sonnet") || m.contains("opus") => "claude-haiku-4-5-20251001".to_string(),
            ("openai", m) if m == "gpt-4o" || m.contains("gpt-4-") => "gpt-4o-mini".to_string(),
            ("gemini", m) if m.contains("pro") || m.contains("1.5") => "gemini-2.0-flash".to_string(),
            _ => config.model.clone(),
        };
    }

    // Capture last user message before build_conversation consumes messages
    let last_user_text = messages.iter().rev()
        .find(|m| m.role == "user")
        .map(|m| m.content.clone())
        .unwrap_or_default();

    let tool_snapshot = {
        let manager = state.lock().await;
        manager.get_tools().to_vec()
    };

    let system_prompt = brain::build_system_prompt_with_recall(
        &tool_snapshot,
        &last_user_text,
        Some(vector_store.inner()),
    );

    // MCP tools + native built-in tools (bash, file ops, web fetch)
    let mut tools: Vec<ToolDefinition> = tool_snapshot
        .iter()
        .map(|tool| ToolDefinition {
            name: tool.qualified_name.clone(),
            description: tool.description.clone(),
            input_schema: tool.input_schema.clone(),
        })
        .collect();
    tools.extend(crate::native_tools::tool_definitions());

    let conversation = providers::build_conversation(messages, Some(system_prompt));

    // Check if any message has an image (vision request)
    let has_image = conversation
        .iter()
        .any(|m| matches!(m, ConversationMessage::UserWithImage { .. }));

    // No tools configured and no images → stream directly (fast path, best UX)
    if tools.is_empty() && !has_image {
        let span = trace::TraceSpan::new(&config.provider, &config.model, "stream_text");
        let result = providers::stream_text(
            &app,
            &config.provider,
            &config.api_key,
            &config.model,
            &conversation,
            config.base_url.as_deref(),
        )
        .await;
        let entry = span.finish(result.is_ok(), result.as_ref().err().cloned());
        trace::log_trace(&entry);
        if result.is_ok() {
            let _ = app.emit("blade_status", "idle");
            // Background: entity extraction + auto-embed + thread update for persistent memory
            // Note: streaming path — assistant text assembled by frontend via brain_extract_from_exchange
            let app2 = app.clone();
            let user_text_clone = last_user_text.clone();
            let store_clone = vector_store.inner().clone();
            tokio::spawn(async move {
                let n = brain::extract_entities_from_exchange(&user_text_clone, "").await;
                if n > 0 {
                    let _ = app2.emit("brain_grew", serde_json::json!({ "new_entities": n }));
                }
                // Embed the exchange for future semantic recall (assistant text unavailable in stream path)
                crate::embeddings::auto_embed_exchange(&store_clone, &user_text_clone, "", "stream");
            });
        } else {
            let _ = app.emit("blade_status", "error");
        }
        return result;
    }

    // Tools configured → non-streaming tool loop
    let mut conversation = conversation;
    let mut last_tool_signature = String::new();
    let mut repeat_count = 0u8;
    for iteration in 0..12 {
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
            config.base_url.as_deref(),
        )
        .await;
        let entry = span.finish(turn_result.is_ok(), turn_result.as_ref().err().cloned());
        trace::log_trace(&entry);
        let turn = match turn_result {
            Ok(t) => t,
            Err(e) => {
                let _ = app.emit("blade_status", "error");
                return Err(e);
            }
        };

        conversation.push(ConversationMessage::Assistant {
            content: turn.content.clone(),
            tool_calls: turn.tool_calls.clone(),
        });

        if turn.tool_calls.is_empty() {
            // Final text response — emit word-by-word for streaming feel
            if !turn.content.is_empty() {
                let mut buf = String::new();
                for ch in turn.content.chars() {
                    buf.push(ch);
                    // Emit on natural boundaries: space, newline, or every 6 chars
                    if ch == ' ' || ch == '\n' || buf.len() >= 6 {
                        let _ = app.emit("chat_token", buf.clone());
                        buf.clear();
                    }
                }
                if !buf.is_empty() {
                    let _ = app.emit("chat_token", buf);
                }
            }
            let _ = app.emit("chat_done", ());
            let _ = app.emit("blade_status", "idle");
            // Background: entity extraction + auto-embed + THREAD update + SKILL ENGINE + gap detection
            let app2 = app.clone();
            let app3 = app.clone();
            let user_text = last_user_text.clone();
            let assistant_text = turn.content.clone();
            let store_clone = vector_store.inner().clone();
            // Collect tool names used in this loop for skill pattern recording
            let tools_used: Vec<String> = conversation.iter().filter_map(|m| {
                if let crate::providers::ConversationMessage::Tool { tool_name, is_error, .. } = m {
                    if !*is_error { Some(tool_name.clone()) } else { None }
                } else { None }
            }).collect();
            let user_text_skill = user_text.clone();
            let assistant_text_thread = assistant_text.clone();
            let user_text_thread = user_text.clone();
            tokio::spawn(async move {
                let n = brain::extract_entities_from_exchange(&user_text, &assistant_text).await;
                if n > 0 {
                    let _ = app2.emit("brain_grew", serde_json::json!({ "new_entities": n }));
                }
                // Embed the full exchange for persistent semantic memory
                crate::embeddings::auto_embed_exchange(&store_clone, &user_text, &assistant_text, "tool_loop");
                // SKILL ENGINE: record successful tool pattern
                if !tools_used.is_empty() {
                    let result_summary = &assistant_text[..assistant_text.len().min(200)];
                    crate::skill_engine::record_tool_pattern(&user_text_skill, &tools_used, result_summary);
                    // Check if any candidates are ready to graduate to skills
                    crate::skill_engine::maybe_synthesize_skills(app3).await;
                }
                // Capability gap detection — runs silently, fires webhook if gap found
                if reports::detect_and_log(&user_text, &assistant_text) {
                    let _ = app2.emit("capability_gap_detected", serde_json::json!({
                        "user_request": &user_text[..user_text.len().min(120)],
                    }));
                    // Deliver to webhook asynchronously
                    let db_path = crate::config::blade_config_dir().join("blade.db");
                    if let Ok(conn) = rusqlite::Connection::open(&db_path) {
                        if let Ok(reports_vec) = crate::db::get_capability_reports(&conn, 1) {
                            if let Some(report) = reports_vec.first() {
                                reports::deliver_report(report).await;
                            }
                        }
                    }
                }
            });
            // THREAD: auto-update working memory (spawns its own background task)
            crate::thread::auto_update_thread(app.clone(), user_text_thread, assistant_text_thread);
            return Ok(());
        }

        // Detect identical tool call loops — same name+args repeated 3× means stuck
        let sig = format!("{:?}", &turn.tool_calls);
        if sig == last_tool_signature {
            repeat_count += 1;
            if repeat_count >= 3 {
                break; // fall through to final summary call
            }
        } else {
            repeat_count = 0;
            last_tool_signature = sig;
        }

        for tool_call in turn.tool_calls {
            let is_native = crate::native_tools::is_native(&tool_call.name);

            // Determine risk level
            let risk = if is_native {
                crate::native_tools::risk(&tool_call.name)
            } else {
                let tool_desc = {
                    let manager = state.lock().await;
                    manager
                        .get_tools()
                        .iter()
                        .find(|t| t.qualified_name == tool_call.name)
                        .map(|t| t.description.clone())
                        .unwrap_or_default()
                };
                permissions::classify_tool(&tool_call.name, &tool_desc)
            };

            if risk == permissions::ToolRisk::Blocked {
                conversation.push(ConversationMessage::Tool {
                    tool_call_id: tool_call.id,
                    tool_name: tool_call.name,
                    content: "Tool blocked by safety policy.".to_string(),
                    is_error: true,
                });
                continue;
            }

            if risk == permissions::ToolRisk::Ask {
                let approval_id = format!("approval-{}", tool_call.id);
                let (tx, rx) = oneshot::channel::<bool>();
                {
                    let mut map = approvals.lock().await;
                    map.insert(approval_id.clone(), tx);
                }
                let _ = app.emit(
                    "tool_approval_needed",
                    serde_json::json!({
                        "approval_id": &approval_id,
                        "name": &tool_call.name,
                        "arguments": &tool_call.arguments,
                        "risk": "Ask",
                    }),
                );
                let approved = tokio::time::timeout(std::time::Duration::from_secs(60), rx)
                    .await
                    .unwrap_or(Ok(false))
                    .unwrap_or(false);
                if !approved {
                    conversation.push(ConversationMessage::Tool {
                        tool_call_id: tool_call.id,
                        tool_name: tool_call.name,
                        content: "Tool execution denied by user.".to_string(),
                        is_error: true,
                    });
                    continue;
                }
            }

            let _ = app.emit(
                "tool_executing",
                serde_json::json!({
                    "name": &tool_call.name,
                    "arguments": &tool_call.arguments,
                    "risk": format!("{:?}", risk),
                }),
            );

            // Execute: native tools handled inline, MCP tools via manager
            let (content, is_error) = if is_native {
                crate::native_tools::execute(&tool_call.name, &tool_call.arguments).await
            } else {
                let result = {
                    let mut manager = state.lock().await;
                    manager
                        .call_tool(&tool_call.name, tool_call.arguments.clone())
                        .await?
                };
                (format_tool_result(&result), result.is_error)
            };

            let _ = app.emit(
                "tool_completed",
                serde_json::json!({
                    "name": &tool_call.name,
                    "is_error": is_error,
                }),
            );

            conversation.push(ConversationMessage::Tool {
                tool_call_id: tool_call.id,
                tool_name: tool_call.name,
                content,
                is_error,
            });
        }
    }

    // Loop exhausted or stuck — do a final tool-free call so the model can
    // summarise what it accomplished rather than showing a raw error.
    conversation.push(ConversationMessage::User(
        "Summarise what you've done so far and whether the task is complete.".to_string(),
    ));
    let summary_result = providers::stream_text(
        &app,
        &config.provider,
        &config.api_key,
        &config.model,
        &conversation,
        config.base_url.as_deref(),
    )
    .await;
    let _ = app.emit("blade_status", if summary_result.is_ok() { "idle" } else { "error" });
    summary_result
}

#[tauri::command]
pub fn get_config() -> BladeConfig {
    load_config()
}

#[tauri::command]
pub fn debug_config() -> serde_json::Value {
    let config_dir = crate::config::blade_config_dir();
    let config_path = config_dir.join("config.json");
    let file_exists = config_path.exists();
    let file_content =
        std::fs::read_to_string(&config_path).unwrap_or_else(|_| "NOT FOUND".to_string());
    let loaded = load_config();

    serde_json::json!({
        "config_dir": config_dir.to_string_lossy(),
        "config_path": config_path.to_string_lossy(),
        "file_exists": file_exists,
        "file_content": file_content,
        "loaded_onboarded": loaded.onboarded,
        "loaded_provider": loaded.provider,
        "loaded_has_key": !loaded.api_key.is_empty(),
    })
}

#[tauri::command]
pub fn reset_onboarding() -> Result<(), String> {
    let mut config = load_config();
    config.onboarded = false;
    config.api_key = String::new();
    config.provider = "gemini".to_string();
    config.model = "gemini-2.0-flash".to_string();
    save_config(&config)
}

#[tauri::command]
pub fn set_config(
    provider: String,
    api_key: String,
    model: String,
    token_efficient: Option<bool>,
    user_name: Option<String>,
    work_mode: Option<String>,
    response_style: Option<String>,
    blade_email: Option<String>,
    base_url: Option<String>,
    god_mode: Option<bool>,
    god_mode_tier: Option<String>,
    voice_mode: Option<String>,
    obsidian_vault_path: Option<String>,
) -> Result<(), String> {
    let mut config = load_config();
    config.provider = provider;
    config.api_key = api_key;
    config.model = model;
    config.onboarded = true;
    if let Some(v) = token_efficient { config.token_efficient = v; }
    if let Some(v) = user_name { config.user_name = v; }
    if let Some(v) = work_mode { config.work_mode = v; }
    if let Some(v) = response_style { config.response_style = v; }
    if let Some(v) = blade_email { config.blade_email = v; }
    config.base_url = base_url.filter(|s| !s.is_empty());
    if let Some(v) = god_mode { config.god_mode = v; }
    if let Some(v) = god_mode_tier { config.god_mode_tier = v; }
    if let Some(v) = voice_mode { config.voice_mode = v; }
    if let Some(v) = obsidian_vault_path { config.obsidian_vault_path = v; }
    save_config(&config)
}

#[tauri::command]
pub async fn toggle_god_mode(app: tauri::AppHandle, enabled: bool, tier: Option<String>) -> Result<(), String> {
    let mut config = load_config();
    config.god_mode = enabled;
    if let Some(t) = tier { config.god_mode_tier = t; }
    save_config(&config)?;
    if enabled {
        crate::godmode::start_god_mode(app, &config.god_mode_tier);
    } else {
        crate::godmode::stop_god_mode();
    }
    Ok(())
}

#[tauri::command]
pub fn update_init_prefs(
    token_efficient: Option<bool>,
    user_name: Option<String>,
    work_mode: Option<String>,
    response_style: Option<String>,
    blade_email: Option<String>,
) -> Result<(), String> {
    let mut config = load_config();
    if let Some(v) = token_efficient { config.token_efficient = v; }
    if let Some(v) = user_name { config.user_name = v; }
    if let Some(v) = work_mode { config.work_mode = v; }
    if let Some(v) = response_style { config.response_style = v; }
    if let Some(v) = blade_email { config.blade_email = v; }
    save_config(&config)
}

#[tauri::command]
pub async fn test_provider(
    provider: String,
    api_key: String,
    model: String,
    base_url: Option<String>,
) -> Result<String, String> {
    providers::test_connection(&provider, &api_key, &model, base_url.as_deref()).await
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

// --- Tool Approval ---

#[tauri::command]
pub async fn respond_tool_approval(
    approvals: tauri::State<'_, ApprovalMap>,
    approval_id: String,
    approved: bool,
) -> Result<(), String> {
    let mut map = approvals.lock().await;
    if let Some(tx) = map.remove(&approval_id) {
        let _ = tx.send(approved);
        Ok(())
    } else {
        Err(format!("No pending approval: {}", approval_id))
    }
}

// --- History ---

#[tauri::command]
pub fn history_delete_conversation(conversation_id: String) -> Result<(), String> {
    crate::history::delete_conversation(&conversation_id)
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
