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
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::Emitter;
use tokio::sync::oneshot;
use tokio::sync::Mutex;

pub type SharedMcpManager = Arc<Mutex<McpManager>>;
pub type ApprovalMap = Arc<Mutex<StdHashMap<String, oneshot::Sender<bool>>>>;

/// Global cancel flag — set to true to abort the current chat inference.
static CHAT_CANCEL: AtomicBool = AtomicBool::new(false);

#[tauri::command]
pub fn cancel_chat(app: tauri::AppHandle) {
    CHAT_CANCEL.store(true, Ordering::SeqCst);
    let _ = app.emit("chat_cancelled", ());
    let _ = app.emit("blade_status", "idle");
}

/// Rough token estimate: 1 token ≈ 4 chars.
fn estimate_tokens(conversation: &[ConversationMessage]) -> usize {
    conversation.iter().map(|m| {
        let chars = match m {
            ConversationMessage::System(s) => s.len(),
            ConversationMessage::User(s) => s.len(),
            ConversationMessage::UserWithImage { text, .. } => text.len() + 1000,
            ConversationMessage::Assistant { content, .. } => content.len(),
            ConversationMessage::Tool { content, .. } => content.len(),
        };
        chars / 4
    }).sum()
}

/// Truncate conversation to fit within token budget.
/// Keeps: System prompt (always), last user message (always), drops oldest middle messages.
/// Inserts a marker so the model knows history was removed (prevents hallucinated continuity).
fn truncate_to_budget(conversation: &mut Vec<ConversationMessage>, max_tokens: usize) {
    let mut removed_any = false;
    while estimate_tokens(conversation) > max_tokens && conversation.len() > 3 {
        // Remove just after the system prompt block (index 1)
        let first_non_system = conversation.iter().position(|m| !matches!(m, ConversationMessage::System(_))).unwrap_or(1);
        if first_non_system >= conversation.len().saturating_sub(2) { break; }
        conversation.remove(first_non_system);
        removed_any = true;
    }
    // Insert a marker after the system block so the model knows context was cut
    if removed_any {
        let insert_at = conversation.iter().position(|m| !matches!(m, ConversationMessage::System(_))).unwrap_or(1);
        conversation.insert(insert_at, ConversationMessage::User(
            "[Earlier conversation history was truncated to fit the context window. Continue from the most recent messages below.]".to_string()
        ));
    }
}

/// Smart context compression — inspired by MemPalace's AAAK pattern.
/// Instead of dropping old turns, summarizes them into a compact block.
/// Keeps: system prompt + compressed summary + last 8 turns verbatim.
async fn compress_conversation_smart(
    conversation: &mut Vec<ConversationMessage>,
    max_tokens: usize,
    provider: &str,
    api_key: &str,
    model: &str,
    base_url: Option<&str>,
) {
    if estimate_tokens(conversation) <= max_tokens {
        return;
    }

    let keep_recent = 8usize;
    let system_count = conversation.iter()
        .filter(|m| matches!(m, ConversationMessage::System(_)))
        .count();

    if conversation.len() <= system_count + keep_recent {
        // Nothing to compress — just truncate as fallback
        truncate_to_budget(conversation, max_tokens);
        return;
    }

    let compress_end = conversation.len().saturating_sub(keep_recent);
    let compress_start = system_count;

    if compress_end <= compress_start {
        truncate_to_budget(conversation, max_tokens);
        return;
    }

    // Build text of the turns to compress
    let to_compress: Vec<String> = conversation[compress_start..compress_end]
        .iter()
        .filter_map(|m| match m {
            ConversationMessage::User(s) => Some(format!("User: {}", &s[..s.len().min(500)])),
            ConversationMessage::Assistant { content, .. } => {
                if content.is_empty() { None }
                else { Some(format!("Assistant: {}", &content[..content.len().min(500)])) }
            }
            ConversationMessage::Tool { tool_name, content, .. } => {
                Some(format!("Tool[{}] result: {}", tool_name, &content[..content.len().min(200)]))
            }
            _ => None,
        })
        .collect();

    if to_compress.is_empty() {
        truncate_to_budget(conversation, max_tokens);
        return;
    }

    let summary_prompt = format!(
        "Summarize this earlier conversation in 3-6 sentences. Preserve: key decisions made, \
         code written or changed, errors encountered and resolved, facts established. \
         Be dense and specific — this replaces the full history.\n\n{}",
        to_compress.join("\n")
    );

    // Use cheapest model for compression
    let cheap = match provider {
        "anthropic" => "claude-haiku-4-5-20251001",
        "openai" => "gpt-4o-mini",
        "gemini" => "gemini-2.0-flash",
        "groq" => "llama-3.1-8b-instant",
        "openrouter" => "anthropic/claude-haiku-4.5",
        _ => model,
    };

    let summary_msgs = vec![ConversationMessage::User(summary_prompt)];
    let summary = match crate::providers::complete_turn(
        provider, api_key, cheap, &summary_msgs, &[], base_url
    ).await {
        Ok(t) => t.content,
        Err(_) => {
            // Compression failed — fall back to hard truncation
            truncate_to_budget(conversation, max_tokens);
            return;
        }
    };

    // Replace compressed range with a single summary message
    let summary_msg = ConversationMessage::User(
        format!("[Earlier conversation summary]\n{}", summary)
    );
    conversation.drain(compress_start..compress_end);
    conversation.insert(compress_start, summary_msg);
}

/// Classify API errors and return a recovery action.
enum ErrorRecovery {
    TruncateAndRetry,
    /// Switch to a safe fallback model for this provider and retry
    SwitchModelAndRetry,
    /// Rate limited — wait `secs` seconds then retry
    RateLimitRetry { secs: u64 },
    /// Server overloaded — brief pause then retry once
    OverloadedRetry,
    Fatal(String),
}

fn classify_api_error(err: &str) -> ErrorRecovery {
    let lower = err.to_lowercase();

    // Context window exceeded
    if lower.contains("too long") || lower.contains("maximum") || lower.contains("context length")
        || (lower.contains("token") && lower.contains("exceed")) {
        return ErrorRecovery::TruncateAndRetry;
    }

    // Rate limited — extract retry-after if present, default 15s
    if lower.contains("429") || lower.contains("rate limit") || lower.contains("too many requests")
        || lower.contains("rate_limit") {
        // Try to parse "please wait X seconds" from the error
        let secs = err.split_whitespace()
            .zip(err.split_whitespace().skip(1))
            .find_map(|(_, next)| next.trim_end_matches('s').parse::<u64>().ok())
            .unwrap_or(15)
            .min(60); // cap at 60s
        return ErrorRecovery::RateLimitRetry { secs };
    }

    // Server overloaded (Anthropic 529, generic 503)
    if lower.contains("529") || lower.contains("overloaded") || lower.contains("503")
        || lower.contains("service unavailable") || lower.contains("server error")
        || lower.contains("temporarily") {
        return ErrorRecovery::OverloadedRetry;
    }

    // Auth errors — clear message, no retry
    if lower.contains("401") || lower.contains("403") || lower.contains("invalid api key")
        || lower.contains("invalid_api_key") || lower.contains("authentication failed")
        || lower.contains("unauthorized") || lower.contains("incorrect api key") {
        return ErrorRecovery::Fatal(
            "API key rejected — go to Settings to update it.".to_string()
        );
    }

    // Model not found / invalid — switch to a safe model for this provider
    if lower.contains("model") && (lower.contains("not found") || lower.contains("invalid")
        || lower.contains("does not exist") || lower.contains("not supported")) {
        return ErrorRecovery::SwitchModelAndRetry;
    }

    ErrorRecovery::Fatal(err.to_string())
}

/// Safe fallback model for a given provider when the configured model is invalid.
fn safe_fallback_model(provider: &str) -> &'static str {
    match provider {
        "anthropic"   => "claude-haiku-4-5-20251001",
        "openai"      => "gpt-4o-mini",
        "gemini"      => "gemini-2.0-flash",
        "groq"        => "llama-3.3-70b-versatile",
        "openrouter"  => "anthropic/claude-haiku-4.5",
        _             => "gpt-4o-mini", // OpenAI-compat default
    }
}
const MAX_TOOL_RESULT_CHARS: usize = 12_000;

#[tauri::command]
pub async fn send_message_stream(
    app: tauri::AppHandle,
    state: tauri::State<'_, SharedMcpManager>,
    approvals: tauri::State<'_, ApprovalMap>,
    vector_store: tauri::State<'_, crate::embeddings::SharedVectorStore>,
    messages: Vec<ChatMessage>,
) -> Result<(), String> {
    // Reset cancel flag at the start of every new request
    CHAT_CANCEL.store(false, Ordering::SeqCst);

    let _ = app.emit("blade_status", "processing");

    let mut config = load_config();
    if config.api_key.is_empty() && config.provider != "ollama" {
        let _ = app.emit("blade_status", "error");
        return Err("No API key configured. Go to settings.".to_string());
    }

    // Smart routing: resolve best provider + model for this task type.
    // If the user configured e.g. "code tasks → Anthropic", this picks that provider + its key.
    // Falls back to active provider if the routed provider has no stored key.
    let mut use_extended_thinking = false;
    if let Some(last_user_msg) = messages.iter().rev().find(|m| m.role == "user") {
        let has_image = last_user_msg.image_base64.is_some();
        let task = crate::router::classify_task(&last_user_msg.content, has_image);
        // Flag complex tasks on Anthropic for extended thinking
        if task == crate::router::TaskType::Complex && config.provider == "anthropic" {
            use_extended_thinking = true;
        }
        let (provider, api_key, model) = crate::config::resolve_provider_for_task(&config, &task);
        config.provider = provider;
        config.api_key = api_key;
        config.model = model;
    }

    // Context-length aware routing: if conversation is already very long,
    // switch to a long-context model rather than hitting a context-overflow error later.
    // Gemini Flash (1M tokens) is the safest bet for huge contexts at low cost.
    {
        let rough_tokens = messages.iter().map(|m| {
            m.content.len() / 4 + m.image_base64.as_ref().map(|_| 2000).unwrap_or(0)
        }).sum::<usize>();
        if rough_tokens > 80_000 {
            // Long conversation — route to long-context model if available
            let gemini_key = crate::config::get_provider_key("gemini");
            if !gemini_key.is_empty() && config.provider != "gemini" {
                config.provider = "gemini".to_string();
                config.api_key = gemini_key;
                config.model = "gemini-2.0-flash".to_string();
            } else if config.provider == "anthropic" {
                // Stay on Anthropic but use the higher-context Sonnet, not Haiku
                if config.model.contains("haiku") {
                    config.model = "claude-sonnet-4-20250514".to_string();
                }
            }
        }
    }

    // Emit routing decision so the UI can show which model/provider is active for this request
    let _ = app.emit("chat_routing", serde_json::json!({
        "provider": &config.provider,
        "model": &config.model,
    }));

    // Token-efficient mode: downgrade to faster/cheaper model
    if config.token_efficient {
        config.model = match (config.provider.as_str(), config.model.as_str()) {
            ("anthropic", m) if m.contains("sonnet") || m.contains("opus") => "claude-haiku-4-5-20251001".to_string(),
            ("openai", m) if m == "gpt-4o" || m.contains("gpt-4-") => "gpt-4o-mini".to_string(),
            ("gemini", m) if m.contains("pro") || m.contains("1.5") => "gemini-2.0-flash".to_string(),
            ("openrouter", m) if m.contains("sonnet") || m.contains("opus") || m.contains("gpt-4o") && !m.contains("mini") => "anthropic/claude-haiku-4.5".to_string(),
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

    let system_prompt = brain::build_system_prompt_for_model(
        &tool_snapshot,
        &last_user_text,
        Some(vector_store.inner()),
        &config.provider,
        &config.model,
    );

    // MCP tools + native built-in tools (bash, file ops, web fetch)
    // Prune to ≤60 tools total — beyond that, accuracy degrades as the model
    // gets confused by irrelevant tool noise. Score MCP tools by relevance to
    // the current task; native tools are always included (they're always needed).
    let native_tools = crate::native_tools::tool_definitions();
    let max_mcp_tools = 60usize.saturating_sub(native_tools.len());

    let mcp_tools: Vec<ToolDefinition> = if tool_snapshot.len() > max_mcp_tools {
        // Score each tool by keyword overlap with the user message
        let query_lower = last_user_text.to_lowercase();
        let mut scored: Vec<(usize, ToolDefinition)> = tool_snapshot
            .iter()
            .map(|tool| {
                let haystack = format!("{} {}", tool.qualified_name, tool.description).to_lowercase();
                let score = query_lower
                    .split_whitespace()
                    .filter(|w| w.len() > 3 && haystack.contains(*w))
                    .count();
                (score, ToolDefinition {
                    name: tool.qualified_name.clone(),
                    description: tool.description.clone(),
                    input_schema: tool.input_schema.clone(),
                })
            })
            .collect();
        scored.sort_by(|a, b| b.0.cmp(&a.0));
        scored.into_iter().take(max_mcp_tools).map(|(_, t)| t).collect()
    } else {
        tool_snapshot
            .iter()
            .map(|tool| ToolDefinition {
                name: tool.qualified_name.clone(),
                description: tool.description.clone(),
                input_schema: tool.input_schema.clone(),
            })
            .collect()
    };

    let mut tools = mcp_tools;
    tools.extend(native_tools);

    let conversation = providers::build_conversation(messages, Some(system_prompt));

    // Check if any message has an image (vision request)
    let has_image = conversation
        .iter()
        .any(|m| matches!(m, ConversationMessage::UserWithImage { .. }));

    // No tools configured and no images → stream directly (fast path, best UX)
    if tools.is_empty() && !has_image {
        let span = trace::TraceSpan::new(&config.provider, &config.model, "stream_text");
        let result = if use_extended_thinking && config.provider == "anthropic" {
            providers::stream_text_thinking(
                &app,
                &config.provider,
                &config.api_key,
                &config.model,
                &conversation,
                8000, // 8K thinking budget — good balance of depth vs cost
            )
            .await
        } else {
            providers::stream_text(
                &app,
                &config.provider,
                &config.api_key,
                &config.model,
                &conversation,
                config.base_url.as_deref(),
            )
            .await
        };
        let entry = span.finish(result.is_ok(), result.as_ref().err().cloned());
        trace::log_trace(&entry);
        if result.is_ok() {
            let _ = app.emit("blade_status", "idle");
            // Background: partial entity extraction from user message alone.
            // Full exchange (user+assistant) is embedded by brain_extract_from_exchange
            // once the frontend assembles the complete streamed response.
            let app2 = app.clone();
            let user_text_clone = last_user_text.clone();
            tokio::spawn(async move {
                let n = brain::extract_entities_from_exchange(&user_text_clone, "").await;
                if n > 0 {
                    let _ = app2.emit("brain_grew", serde_json::json!({ "new_entities": n }));
                }
            });
        } else {
            let _ = app.emit("blade_status", "error");
        }
        return result;
    }

    // Tools configured → non-streaming tool loop
    let mut conversation = conversation;
    // Proactive compression before entering the loop — keep under 140k tokens
    compress_conversation_smart(
        &mut conversation,
        140_000,
        &config.provider,
        &config.api_key,
        &config.model,
        config.base_url.as_deref(),
    ).await;

    let mut last_tool_signature = String::new();
    let mut repeat_count = 0u8;
    for iteration in 0..12 {
        // Check cancellation before each iteration
        if CHAT_CANCEL.load(Ordering::SeqCst) {
            let _ = app.emit("chat_cancelled", ());
            let _ = app.emit("chat_done", ());
            let _ = app.emit("blade_status", "idle");
            return Ok(());
        }

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
                match classify_api_error(&e) {
                    ErrorRecovery::TruncateAndRetry => {
                        // Smart compress then retry
                        let _ = app.emit("blade_status", "processing");
                        let _ = app.emit("blade_notification", serde_json::json!({
                            "type": "info", "message": "Context too long — compressing conversation and retrying"
                        }));
                        compress_conversation_smart(
                            &mut conversation, 120_000,
                            &config.provider, &config.api_key, &config.model,
                            config.base_url.as_deref(),
                        ).await;
                        let retry = providers::complete_turn(
                            &config.provider,
                            &config.api_key,
                            &config.model,
                            &conversation,
                            &tools,
                            config.base_url.as_deref(),
                        ).await;
                        match retry {
                            Ok(t) => t,
                            Err(e2) => {
                                let _ = app.emit("blade_status", "error");
                                return Err(format!("Context trimmed but still failed: {}", e2));
                            }
                        }
                    }
                    ErrorRecovery::SwitchModelAndRetry => {
                        let fallback = safe_fallback_model(&config.provider).to_string();
                        let _ = app.emit("blade_status", "processing");
                        let _ = app.emit("blade_notification", serde_json::json!({
                            "type": "info",
                            "message": format!("Model '{}' not available — retrying with {}", config.model, fallback)
                        }));
                        let retry = providers::complete_turn(
                            &config.provider,
                            &config.api_key,
                            &fallback,
                            &conversation,
                            &tools,
                            config.base_url.as_deref(),
                        ).await;
                        match retry {
                            Ok(t) => {
                                config.model = fallback; // keep using fallback for rest of session
                                t
                            }
                            Err(e2) => {
                                let _ = app.emit("blade_status", "error");
                                return Err(format!("Model fallback ({}) also failed: {}", fallback, e2));
                            }
                        }
                    }
                    ErrorRecovery::RateLimitRetry { secs } => {
                        let _ = app.emit("blade_notification", serde_json::json!({
                            "type": "info",
                            "message": format!("Rate limited — retrying in {}s", secs)
                        }));
                        tokio::time::sleep(std::time::Duration::from_secs(secs)).await;
                        let _ = app.emit("blade_status", "processing");
                        let retry = providers::complete_turn(
                            &config.provider, &config.api_key, &config.model,
                            &conversation, &tools, config.base_url.as_deref(),
                        ).await;
                        match retry {
                            Ok(t) => t,
                            Err(e2) => {
                                let _ = app.emit("blade_status", "error");
                                return Err(format!("Still rate limited after {}s wait: {}", secs, e2));
                            }
                        }
                    }
                    ErrorRecovery::OverloadedRetry => {
                        let _ = app.emit("blade_notification", serde_json::json!({
                            "type": "info", "message": "Server overloaded — retrying in 5s"
                        }));
                        tokio::time::sleep(std::time::Duration::from_secs(5)).await;
                        let _ = app.emit("blade_status", "processing");
                        let retry = providers::complete_turn(
                            &config.provider, &config.api_key, &config.model,
                            &conversation, &tools, config.base_url.as_deref(),
                        ).await;
                        match retry {
                            Ok(t) => t,
                            Err(e2) => {
                                let _ = app.emit("blade_status", "error");
                                return Err(format!("Server still overloaded: {}", e2));
                            }
                        }
                    }
                    ErrorRecovery::Fatal(msg) => {
                        // Before giving up: try the configured fallback provider
                        let fallback_provider = load_config().task_routing.fallback.clone();
                        if let Some(fb_prov) = fallback_provider {
                            if fb_prov != config.provider {
                                let fb_key = crate::config::get_provider_key(&fb_prov);
                                if !fb_key.is_empty() || fb_prov == "ollama" {
                                    let fb_model = crate::router::suggest_model(&fb_prov, &crate::router::TaskType::Complex)
                                        .unwrap_or_else(|| config.model.clone());
                                    let _ = app.emit("blade_status", "processing");
                                    let _ = app.emit("blade_notification", serde_json::json!({
                                        "type": "info",
                                        "message": format!("Switching to {} (fallback)", fb_prov)
                                    }));
                                    let retry = providers::complete_turn(
                                        &fb_prov, &fb_key, &fb_model,
                                        &conversation, &tools, None,
                                    ).await;
                                    match retry {
                                        Ok(t) => t,
                                        Err(e2) => {
                                            let _ = app.emit("blade_status", "error");
                                            return Err(format!("Primary ({}) and fallback ({}) both failed: {} / {}", config.provider, fb_prov, msg, e2));
                                        }
                                    }
                                } else {
                                    let _ = app.emit("blade_status", "error");
                                    return Err(msg);
                                }
                            } else {
                                let _ = app.emit("blade_status", "error");
                                return Err(msg);
                            }
                        } else {
                            let _ = app.emit("blade_status", "error");
                            return Err(msg);
                        }
                    }
                }
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
            let assistant_text_timeline = assistant_text.clone();
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
            crate::thread::auto_update_thread(app.clone(), user_text_thread.clone(), assistant_text_thread);

            // ACTIVITY TIMELINE: record this conversation turn
            {
                let db_path = crate::config::blade_config_dir().join("blade.db");
                if let Ok(conn) = rusqlite::Connection::open(&db_path) {
                    let title = &user_text_thread[..user_text_thread.len().min(80)];
                    let content = &assistant_text_timeline[..assistant_text_timeline.len().min(500)];
                    let _ = crate::db::timeline_record(&conn, "conversation", title, content, "BLADE", "{}");
                }
            }

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
                // Check if an AI delegate should handle this approval
                let delegate = config.trusted_ai_delegate.clone();
                let approved = if !delegate.is_empty() && delegate != "none" {
                    let context = format!(
                        "BLADE is completing: {}\nWorking on behalf of the user's active session.",
                        last_user_text
                    );
                    let decision = crate::ai_delegate::request_approval(
                        &delegate,
                        &tool_call.name,
                        &tool_call.arguments,
                        &context,
                    ).await;
                    match decision {
                        crate::ai_delegate::DelegateDecision::Approved { reasoning } => {
                            let _ = app.emit("ai_delegate_approved", serde_json::json!({
                                "tool": &tool_call.name,
                                "delegate": &delegate,
                                "reasoning": reasoning,
                            }));
                            true
                        }
                        crate::ai_delegate::DelegateDecision::Denied { reasoning } => {
                            let _ = app.emit("ai_delegate_denied", serde_json::json!({
                                "tool": &tool_call.name,
                                "delegate": &delegate,
                                "reasoning": reasoning,
                            }));
                            false
                        }
                        crate::ai_delegate::DelegateDecision::Unavailable => {
                            // Delegate unavailable — fall back to UI approval
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
                            tokio::time::timeout(std::time::Duration::from_secs(60), rx)
                                .await
                                .unwrap_or(Ok(false))
                                .unwrap_or(false)
                        }
                    }
                } else {
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
                    tokio::time::timeout(std::time::Duration::from_secs(60), rx)
                        .await
                        .unwrap_or(Ok(false))
                        .unwrap_or(false)
                };
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
                crate::native_tools::execute(&tool_call.name, &tool_call.arguments, Some(&app)).await
            } else {
                let result = {
                    let mut manager = state.lock().await;
                    manager
                        .call_tool(&tool_call.name, tool_call.arguments.clone())
                        .await
                };
                match result {
                    Ok(r) => (format_tool_result(&r), r.is_error),
                    Err(e) => {
                        // Tool call failed — try autoskills to acquire missing capability
                        let gap = crate::autoskills::GapContext {
                            user_request: &last_user_text,
                            missing_capability: &tool_call.name,
                            error: &e,
                        };
                        match crate::autoskills::try_acquire(&app, gap, &state).await {
                            crate::autoskills::AutoskillResult::InstalledSilently { name, .. } => {
                                // Retry the tool call with the newly installed server
                                let retry = {
                                    let mut manager = state.lock().await;
                                    manager.call_tool(&tool_call.name, tool_call.arguments.clone()).await
                                };
                                match retry {
                                    Ok(r) => (format_tool_result(&r), r.is_error),
                                    Err(e2) => (format!("Tool failed even after installing {}: {}", name, e2), true),
                                }
                            }
                            _ => (format!("Tool error: {}", e), true),
                        }
                    }
                }
            };

            // Emit a short preview of the result (first 300 chars) so the UI can show it
            let result_preview: String = content.chars().take(300).collect();
            let result_preview = if content.chars().count() > 300 {
                format!("{}…", result_preview)
            } else {
                result_preview
            };
            let _ = app.emit(
                "tool_completed",
                serde_json::json!({
                    "name": &tool_call.name,
                    "is_error": is_error,
                    "result": result_preview,
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
    tts_voice: Option<String>,
    quick_ask_shortcut: Option<String>,
    voice_shortcut: Option<String>,
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
    if let Some(v) = tts_voice { config.tts_voice = v; }
    if let Some(v) = quick_ask_shortcut { config.quick_ask_shortcut = v; }
    if let Some(v) = voice_shortcut { config.voice_shortcut = v; }
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

/// Install and register an MCP server from the catalog.
/// Handles: npm install (if needed), env config, registration, tool discovery.
#[tauri::command]
pub async fn mcp_install_catalog_server(
    state: tauri::State<'_, SharedMcpManager>,
    name: String,
    command: String,
    args: Vec<String>,
    env: HashMap<String, String>,
) -> Result<usize, String> {
    if name.trim().is_empty() || command.trim().is_empty() {
        return Err("Name and command are required.".to_string());
    }

    let config = McpServerConfig {
        command: command.clone(),
        args: args.clone(),
        env: env.clone(),
    };

    // Persist to config
    let mut saved = load_config();
    saved.mcp_servers.retain(|s| s.name != name);
    saved.mcp_servers.push(SavedMcpServerConfig {
        name: name.clone(),
        command,
        args,
        env,
    });
    save_config(&saved)?;

    let mut manager = state.lock().await;
    manager.register_server(name, config);
    let tools = manager.discover_all_tools().await?;
    Ok(tools.len())
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

#[tauri::command]
pub fn history_rename_conversation(
    app: tauri::AppHandle,
    conversation_id: String,
    title: String,
) -> Result<(), String> {
    crate::history::update_conversation_title(&conversation_id, &title)?;
    let _ = app.emit(
        "conversation_titled",
        serde_json::json!({ "conversation_id": conversation_id, "title": title }),
    );
    Ok(())
}

/// Auto-title a conversation using the cheapest available model.
/// Called after the first assistant response — fires in the background.
/// Emits `conversation_titled` event with `{ conversation_id, title }` on success.
#[tauri::command]
pub async fn auto_title_conversation(
    app: tauri::AppHandle,
    conversation_id: String,
    user_text: String,
    assistant_text: String,
) -> Result<(), String> {
    let config = crate::config::load_config();
    if config.api_key.is_empty() {
        return Ok(());
    }

    // Use the cheapest fast model for this provider
    let model = match config.provider.as_str() {
        "anthropic"  => "claude-haiku-4-5-20251001",
        "openai"     => "gpt-4o-mini",
        "groq"       => "llama-3.1-8b-instant",
        "gemini"     => "gemini-2.0-flash-lite",
        "openrouter" => "anthropic/claude-haiku-4.5",
        _            => return Ok(()), // skip for local/unknown providers (ollama etc.)
    };

    let u = &user_text[..user_text.len().min(300)];
    let a = &assistant_text[..assistant_text.len().min(300)];
    let prompt = format!(
        "Give this conversation a concise 4-6 word title. Output ONLY the title, no punctuation.\n\nUser: {u}\n\nAssistant: {a}"
    );

    let messages = vec![crate::providers::ConversationMessage::User(prompt)];
    let turn = crate::providers::complete_turn(
        &config.provider,
        &config.api_key,
        model,
        &messages,
        &[],
        config.base_url.as_deref(),
    )
    .await
    .unwrap_or_else(|_| crate::providers::AssistantTurn { content: String::new(), tool_calls: vec![] });

    let title = turn.content.trim().trim_matches('"').trim().to_string();
    if title.is_empty() || title.len() > 80 {
        return Ok(());
    }

    crate::history::update_conversation_title(&conversation_id, &title)?;

    let _ = app.emit(
        "conversation_titled",
        serde_json::json!({ "conversation_id": conversation_id, "title": title }),
    );
    Ok(())
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
