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
use tauri::Manager;
use tokio::sync::oneshot;
use tokio::sync::Mutex;

pub type SharedMcpManager = Arc<Mutex<McpManager>>;
pub type ApprovalMap = Arc<Mutex<StdHashMap<String, oneshot::Sender<bool>>>>;

/// Global cancel flag — set to true to abort the current chat inference.
static CHAT_CANCEL: AtomicBool = AtomicBool::new(false);
static CHAT_INFLIGHT: AtomicBool = AtomicBool::new(false);

// ---------------------------------------------------------------------------
// Phase 4: Self-healing circuit breaker + exponential backoff
// ---------------------------------------------------------------------------

/// Ring-buffer of (error_kind, instant) for circuit-breaker tracking.
static ERROR_HISTORY: std::sync::OnceLock<std::sync::Mutex<Vec<(String, std::time::Instant)>>> =
    std::sync::OnceLock::new();

fn error_history() -> &'static std::sync::Mutex<Vec<(String, std::time::Instant)>> {
    ERROR_HISTORY.get_or_init(|| std::sync::Mutex::new(Vec::new()))
}

/// Record an error occurrence.
fn record_error(kind: &str) {
    if let Ok(mut h) = error_history().lock() {
        h.push((kind.to_string(), std::time::Instant::now()));
        // Keep at most 50 entries
        if h.len() > 50 {
            h.drain(0..10);
        }
    }
}

/// Returns true if the same error kind occurred ≥3 times in the last 5 minutes.
fn is_circuit_broken(kind: &str) -> bool {
    let Ok(h) = error_history().lock() else { return false };
    let window = std::time::Duration::from_secs(300);
    let now = std::time::Instant::now();
    let count = h.iter().filter(|(k, t)| k == kind && now.duration_since(*t) < window).count();
    count >= 3
}

/// Exponential backoff for retries: base * 2^min(attempt, 3), capped at 120s.
/// `attempt` is the number of recent occurrences of this error kind in the last 5 min.
fn backoff_secs(base: u64, kind: &str) -> u64 {
    let Ok(h) = error_history().lock() else { return base };
    let window = std::time::Duration::from_secs(300);
    let now = std::time::Instant::now();
    let attempt = h.iter().filter(|(k, t)| k == kind && now.duration_since(*t) < window).count();
    let exp = attempt.min(3) as u32;
    (base * 2u64.pow(exp)).min(120)
}

#[tauri::command]
pub fn cancel_chat(app: tauri::AppHandle) {
    // Only set CHAT_CANCEL — the InflightGuard in send_message_stream will
    // clear CHAT_INFLIGHT on drop when the stream loop exits. Clearing it
    // here creates a race where a second message could slip through before
    // the first stream actually stops.
    CHAT_CANCEL.store(true, Ordering::SeqCst);
    let _ = app.emit_to("main", "chat_cancelled", ());
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
            ConversationMessage::User(s) => Some(format!("User: {}", crate::safe_slice(s, 500))),
            ConversationMessage::Assistant { content, .. } => {
                if content.is_empty() { None }
                else { Some(format!("Assistant: {}", crate::safe_slice(content, 500))) }
            }
            ConversationMessage::Tool { tool_name, content, .. } => {
                Some(format!("Tool[{}] result: {}", tool_name, crate::safe_slice(content, 200)))
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
    let cheap = crate::config::cheap_model_for_provider(provider, model);

    let summary_msgs = vec![ConversationMessage::User(summary_prompt)];
    let no_tools: Vec<ToolDefinition> = vec![];
    let summary = match crate::providers::complete_turn(
        provider, api_key, &cheap, &summary_msgs, &no_tools, base_url
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

    // 404 — model not found on this provider. Switch to a known-good model.
    if lower.contains("404") || lower.contains("no endpoints found") {
        return ErrorRecovery::SwitchModelAndRetry;
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
        "openrouter"  => "meta-llama/llama-3.3-70b-instruct:free",
        _             => "gpt-4o-mini", // OpenAI-compat default
    }
}
const MAX_TOOL_RESULT_CHARS: usize = 12_000;

/// Try to complete a turn using a free/fallback model when the primary is rate-limited.
/// Attempts OpenRouter free tier first, then Groq, then Ollama.
/// Returns Some(turn) on success, None if no free model is available.
async fn try_free_model_fallback(
    config: &crate::config::BladeConfig,
    conversation: &[crate::providers::ConversationMessage],
    tools: &[crate::providers::ToolDefinition],
    app: &tauri::AppHandle,
) -> Option<crate::providers::AssistantTurn> {
    // Candidates in order of preference (provider, model, needs_key)
    let candidates: &[(&str, &str)] = &[
        ("openrouter", "meta-llama/llama-3.3-70b-instruct:free"),
        ("groq", "llama-3.3-70b-versatile"),
        ("ollama", "llama3"),
    ];

    for (provider, model) in candidates {
        // Skip if same as current (we already know it's rate-limited)
        if *provider == config.provider.as_str() { continue; }

        let key = if *provider == "ollama" {
            String::new()
        } else {
            crate::config::get_provider_key(provider)
        };

        if key.is_empty() && *provider != "ollama" { continue; }

        let _ = app.emit_to("main", "blade_notification", serde_json::json!({
            "type": "info",
            "message": format!("Rate limited on {} — switching to {} ({}) for this request.",
                config.provider, provider, model)
        }));
        let _ = app.emit("blade_status", "processing");

        match providers::complete_turn(provider, &key, model, conversation, tools, None).await {
            Ok(t) => {
                let _ = app.emit_to("main", "blade_routing_switched", serde_json::json!({
                    "from_provider": &config.provider,
                    "from_model": &config.model,
                    "to_provider": provider,
                    "to_model": model,
                    "reason": "rate_limit",
                }));
                return Some(t);
            }
            Err(_) => continue,
        }
    }
    None
}

/// Count implied task steps in a user query.
/// Detect if a query needs deep multi-step REASONING (not action).
/// "Why is our conversion rate dropping?" = reasoning
/// "Deploy my app" = action (NOT reasoning)
fn is_reasoning_query(query: &str) -> bool {
    let q = query.to_lowercase();

    // Reasoning indicators: questions that need analysis, not execution
    let reasoning_signals = [
        "why ", "why?", "how does", "how would", "what causes",
        "explain", "analyze", "compare", "evaluate", "what if",
        "trade-off", "tradeoff", "pros and cons", "should i",
        "what's the best", "which is better", "difference between",
        "implications", "consequences of", "root cause",
        "strategy for", "approach to", "reasoning behind",
        "think through", "break down", "deep dive",
    ];

    // Action indicators: things that need tools, not thinking
    let action_signals = [
        "run ", "execute", "install", "deploy", "build", "create",
        "delete", "open", "send", "post", "write file", "read file",
        "git ", "npm ", "cargo ", "fix this", "do this",
    ];

    let reasoning_score: usize = reasoning_signals.iter()
        .filter(|s| q.contains(*s))
        .count();

    let action_score: usize = action_signals.iter()
        .filter(|s| q.contains(*s))
        .count();

    // Need at least 1 reasoning signal and more reasoning than action signals
    reasoning_score >= 1 && reasoning_score > action_score
}

/// NOSE: sanitize user input before it reaches the brain.
/// Strips null bytes, excessive whitespace, caps length, removes control chars.
fn sanitize_input(input: &str) -> String {
    const MAX_INPUT_CHARS: usize = 100_000;

    let mut clean = input
        // Remove null bytes and control characters (except newline/tab)
        .chars()
        .filter(|c| !c.is_control() || *c == '\n' || *c == '\t')
        .collect::<String>();

    // Collapse runs of 3+ newlines into 2
    while clean.contains("\n\n\n") {
        clean = clean.replace("\n\n\n", "\n\n");
    }

    // Collapse runs of 3+ spaces into 1
    while clean.contains("   ") {
        clean = clean.replace("   ", " ");
    }

    // Cap total length
    if clean.len() > MAX_INPUT_CHARS {
        clean = crate::safe_slice(&clean, MAX_INPUT_CHARS).to_string();
    }

    clean
}

/// Used to detect multi-step requests that need upfront planning.
/// Returns an estimate of how many distinct actions are implied.
fn count_task_steps(query: &str) -> usize {
    let q = query.to_lowercase();

    // Step boundary connectors
    let step_connectors = [
        " and then ", " then ", " after that ", " afterwards ",
        " next ", " also ", " as well", " plus ", " followed by ",
        " once ", " before ", " finally ", " lastly ",
    ];

    // Count explicit connectors
    let connector_count = step_connectors.iter()
        .filter(|&&c| q.contains(c))
        .count();

    // Count "and" between action verbs (rough heuristic)
    let action_verbs = [
        "compare", "fetch", "get", "read", "check", "show", "display",
        "calculate", "find", "search", "run", "open", "send", "create",
        "write", "analyze", "summarize", "visualize", "graph", "chart",
        "list", "download", "upload", "format", "convert", "export",
    ];
    let verb_count = action_verbs.iter()
        .filter(|&&v| q.contains(v))
        .count();

    // Compound queries with "vs", "versus", "compared to" imply at least 2 data fetches
    let has_comparison = q.contains(" vs ") || q.contains(" versus ")
        || q.contains("compared to") || q.contains("compare")
        || q.contains("this month") && q.contains("last month")
        || q.contains("this week") && q.contains("last week");

    let mut score = connector_count;
    if verb_count >= 2 { score += verb_count.saturating_sub(1); }
    if has_comparison { score += 1; }

    score
}

/// Build a human-readable explanation for a tool failure, including suggestions
/// for alternative approaches and similar files/tools.
fn explain_tool_failure(
    tool_name: &str,
    args: &serde_json::Value,
    error: &str,
    _app: Option<&tauri::AppHandle>,
) -> String {
    let lower_err = error.to_lowercase();

    // File not found — search for similar files
    if tool_name == "blade_read_file" || tool_name == "blade_write_file" || tool_name == "blade_edit_file" {
        if let Some(path) = args["path"].as_str() {
            if lower_err.contains("not found") || lower_err.contains("no such file") || lower_err.contains("os error 2") {
                // Try to find similar files
                let filename = std::path::Path::new(path)
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or(path);
                let parent = std::path::Path::new(path)
                    .parent()
                    .and_then(|p| p.to_str())
                    .unwrap_or(".");

                // Quick glob for similar files
                let similar = find_similar_files(filename, parent);
                let suggestion = if similar.is_empty() {
                    format!(
                        "`{}` failed: path `{}` does not exist. \
                         Verify the path with `blade_list_dir` or `blade_glob` first.",
                        tool_name, path
                    )
                } else {
                    format!(
                        "`{}` failed: `{}` not found. Similar files nearby:\n{}",
                        tool_name, path,
                        similar.iter().map(|f| format!("  - {}", f)).collect::<Vec<_>>().join("\n")
                    )
                };
                return suggestion;
            }

            // Permission denied
            if lower_err.contains("permission") || lower_err.contains("access denied") {
                return format!(
                    "`{}` failed on `{}`: permission denied. \
                     Try running with elevated privileges via `blade_bash: sudo` (Linux/macOS) \
                     or check file ownership.",
                    tool_name, path
                );
            }
        }
    }

    // Bash failure — extract exit code and give actionable advice
    if tool_name == "blade_bash" {
        if let Some(cmd) = args["command"].as_str() {
            if lower_err.contains("command not found") || lower_err.contains("not recognized") {
                let prog = cmd.split_whitespace().next().unwrap_or(cmd);
                return format!(
                    "`blade_bash` failed: `{}` is not installed. \
                     Use `blade_self_upgrade` to install it, or check the correct command name.",
                    prog
                );
            }
            if lower_err.contains("timeout") {
                return format!(
                    "`blade_bash` timed out running: `{}`. \
                     Increase `timeout_ms` or break the task into smaller steps.",
                    crate::safe_slice(cmd, 80)
                );
            }
        }
    }

    // Generic fallback with the raw error, just formatted more helpfully
    format!(
        "`{}` returned an error: {}\n\nConsider: try a different approach, check the arguments, or use a fallback tool.",
        tool_name,
        crate::safe_slice(error, 300)
    )
}

/// Find files with similar names to `filename` inside `search_dir`.
/// Returns up to 5 matches. Runs a quick directory scan — no subprocess.
fn find_similar_files(filename: &str, search_dir: &str) -> Vec<String> {
    let dir = std::path::Path::new(search_dir);
    if !dir.is_dir() {
        // Try parent
        let parent = std::path::Path::new(filename).parent().unwrap_or(std::path::Path::new("."));
        if !parent.is_dir() { return vec![]; }
    }

    let stem = std::path::Path::new(filename)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or(filename)
        .to_lowercase();

    let mut matches = Vec::new();
    let search_path = if dir.is_dir() { dir } else { std::path::Path::new(".") };

    if let Ok(entries) = std::fs::read_dir(search_path) {
        for entry in entries.flatten() {
            let name = entry.file_name();
            let name_str = name.to_string_lossy().to_lowercase();
            // Simple fuzzy: name contains the stem, or stem contains the name's stem
            let name_stem = std::path::Path::new(&*name.to_string_lossy())
                .file_stem()
                .map(|s| s.to_string_lossy().to_lowercase())
                .unwrap_or_default();
            if stem.len() >= 3 && (name_str.contains(stem.as_str()) || name_stem.contains(stem.as_str())) {
                matches.push(entry.path().to_string_lossy().to_string());
                if matches.len() >= 5 { break; }
            }
        }
    }
    matches
}

#[tauri::command]
pub async fn send_message_stream(
    app: tauri::AppHandle,
    state: tauri::State<'_, SharedMcpManager>,
    approvals: tauri::State<'_, ApprovalMap>,
    vector_store: tauri::State<'_, crate::embeddings::SharedVectorStore>,
    messages: Vec<ChatMessage>,
) -> Result<(), String> {
    // Concurrency guard — prevent interleaved responses from rapid-fire messages
    if CHAT_INFLIGHT.swap(true, Ordering::SeqCst) {
        return Err("Already processing a message. Wait for the current response to finish, or cancel it first.".to_string());
    }
    // Drop guard: clear inflight flag when this function exits (any path)
    struct InflightGuard;
    impl Drop for InflightGuard {
        fn drop(&mut self) {
            CHAT_INFLIGHT.store(false, Ordering::SeqCst);
        }
    }
    let _inflight = InflightGuard;

    // Reset cancel flag at the start of every new request
    CHAT_CANCEL.store(false, Ordering::SeqCst);

    // Phase 3 WIRE-03 (Plan 03-01, D-64): tracks the current assistant turn's
    // message_id so the same id can be set in BLADE_CURRENT_MSG_ID env var below
    // for `blade_thinking_chunk` tagging in providers/anthropic.rs (WIRE-04).
    // Reset on each new turn (first emit before token loop).
    #[allow(unused_assignments)]
    let mut current_message_id: Option<String> = None;

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

    // Re-check API key after routing — the router may have switched to a
    // provider whose key isn't stored, leaving api_key empty.
    if config.api_key.is_empty() && config.provider != "ollama" {
        let _ = app.emit("blade_status", "error");
        return Err(format!("No API key stored for provider '{}'. Go to Settings to add one.", config.provider));
    }

    // Context-length aware routing: if conversation is already very long,
    // switch to a long-context model rather than hitting a context-overflow error later.
    // Gemini Flash (1M tokens) is the safest bet for huge contexts at low cost.
    //
    // Phase 3 WIRE-06 (Plan 03-01, D-64): rough_tokens is hoisted OUT of this scope
    // so it can also feed the `blade_token_ratio` emit immediately below the routing
    // logic. The routing logic is unchanged.
    let rough_tokens: usize = messages.iter().map(|m| {
        m.content.len() / 4 + m.image_base64.as_ref().map(|_| 2000).unwrap_or(0)
    }).sum::<usize>();
    if rough_tokens > 80_000 && config.base_url.is_none() && config.provider != "openrouter" && config.provider != "ollama" {
        // Long conversation — route to long-context model if available.
        // Skip when base_url is set or on OpenRouter/Ollama: we don't know what
        // models that endpoint supports and the user chose their model deliberately.
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

    // Phase 3 WIRE-06 (Plan 03-01): emit `blade_token_ratio` so the chat compacting
    // indicator (D-73) can render at ratio > 0.65. Single emit per send_message_stream
    // call (NOT per token) — see threat T-03-01-04 (DoS analysis).
    //
    // Context window per provider/model — kept inline for the 5 known providers;
    // expand later when provider/model registry is centralized (deferred per D-66).
    let context_window: usize = match (config.provider.as_str(), config.model.as_str()) {
        ("anthropic", _) => 200_000,
        ("openai", _)    => 128_000,
        ("gemini", _)    => 1_000_000,
        ("groq", _)      => 131_072,
        ("ollama", _)    => 8_192,
        _                => 32_768,
    };
    let token_ratio = (rough_tokens as f64 / context_window as f64).min(1.0);
    let _ = app.emit_to("main", "blade_token_ratio", serde_json::json!({
        "ratio": token_ratio,
        "tokens_used": rough_tokens,
        "context_window": context_window,
    }));

    // Emit routing decision so the UI can show which model/provider is active for this request
    let hive_active = !crate::hive::get_hive_digest().is_empty();
    let _ = app.emit_to("main", "chat_routing", serde_json::json!({
        "provider": &config.provider,
        "model": &config.model,
        "hive_active": hive_active,
    }));

    // Token-efficient mode: downgrade to faster/cheaper model
    if config.token_efficient {
        config.model = match (config.provider.as_str(), config.model.as_str()) {
            ("anthropic", m) if m.contains("sonnet") || m.contains("opus") => "claude-haiku-4-5-20251001".to_string(),
            ("openai", m) if m == "gpt-4o" || m.contains("gpt-4-") => "gpt-4o-mini".to_string(),
            ("gemini", m) if m.contains("pro") || m.contains("1.5") => "gemini-2.0-flash".to_string(),
            ("openrouter", _m) => config.model.clone(), // don't override — user picked it
            _ => config.model.clone(),
        };
    }

    // Capture last user message before build_conversation consumes messages
    let last_user_text = messages.iter().rev()
        .find(|m| m.role == "user")
        .map(|m| m.content.clone())
        .unwrap_or_default();

    // ── NOSE: input sanitization ────────────────────────────────────────────
    // Filter the incoming air before it reaches the lungs.
    // Strip prompt injection attempts, excessive whitespace, null bytes,
    // and cap input length to prevent context window abuse.
    let last_user_text = sanitize_input(&last_user_text);

    // ── Fast acknowledgment (two-tier routing) ──────────────────────────────
    // Immediately fire a cheap/fast model to give the user a <500 ms response
    // while the real full model is being prepared. Emitted as "chat_ack" so the
    // frontend can display it before the main stream starts.
    // Only makes sense for non-trivial messages (>10 chars) and when we have a key.
    if last_user_text.len() > 10 {
        let ack_msg = last_user_text.clone();
        let ack_config = config.clone();
        let ack_app = app.clone();
        tokio::spawn(async move {
            match providers::stream_fast_acknowledgment(&ack_msg, &ack_config).await {
                Ok(ack) if !ack.is_empty() => {
                    let _ = ack_app.emit_to("main", "chat_ack", ack);
                }
                _ => {}
            }
        });
    }
    // ── End fast acknowledgment ──────────────────────────────────────────────

    // Use quality-ranked tool list: tools with 5+ consecutive failures are pushed to the end.
    // This ensures the LLM naturally gravitates to reliable tools first.
    let tool_snapshot: Vec<crate::mcp::McpTool> = {
        let manager = state.lock().await;
        manager.get_tools_ranked().into_iter().cloned().collect()
    };

    let mut system_prompt = brain::build_system_prompt_for_model(
        &tool_snapshot,
        &last_user_text,
        Some(vector_store.inner()),
        &config.provider,
        &config.model,
        messages.len(),
    );

    // Vision is always in the prompt via brain.rs priority 7 (always-on vision).
    // No reflex needed — BLADE always sees the screen.

    // Context Engine — smart RAG injection.
    // Appended after the main prompt so it always fits without displacing identity.
    if !last_user_text.is_empty() {
        let smart_ctx = crate::context_engine::assemble_smart_context(&last_user_text, 2000).await;
        if !smart_ctx.is_empty() {
            system_prompt.push_str("\n\n---\n\n");
            system_prompt.push_str(&smart_ctx);
        }
    }

    // ── REASONING ENGINE: deep thinking for analytical queries ─────────────
    // If the query needs multi-step REASONING (not action), route through
    // reasoning_engine instead of the tool loop. The reasoning engine does:
    // decompose → analyze → self-critique → revise → synthesize.
    {
        let needs_reasoning = is_reasoning_query(&last_user_text);
        if needs_reasoning && last_user_text.split_whitespace().count() > 5 {
            let _ = app.emit("blade_status", "thinking");
            let _ = app.emit_to("main", "blade_planning", serde_json::json!({
                "query": crate::safe_slice(&last_user_text, 120),
                "mode": "deep_reasoning",
            }));

            let dna_context = crate::dna::query_for_brain(&last_user_text);
            match crate::reasoning_engine::reason_through(
                &last_user_text,
                &dna_context,
                5, // max 5 reasoning steps
                app.clone(),
            ).await {
                Ok(trace) => {
                    // Phase 3 WIRE-03 (Plan 03-01): emit blade_message_start once
                    // before the reasoning-engine streaming loop. Tags chat_thinking +
                    // chat_token chunks for the lifetime of this assistant turn.
                    let msg_id = uuid::Uuid::new_v4().to_string();
                    let _ = app.emit_to("main", "blade_message_start", serde_json::json!({
                        "message_id": &msg_id,
                        "role": "assistant",
                    }));
                    // Phase 3 WIRE-04 sidecar: expose msg_id via env var so
                    // providers/anthropic.rs can tag blade_thinking_chunk with it
                    // (best-effort fallback per D-64; Phase 4 wires a real channel).
                    std::env::set_var("BLADE_CURRENT_MSG_ID", &msg_id);
                    current_message_id = Some(msg_id);

                    // Stream the final answer as chat tokens
                    let answer = &trace.final_answer;
                    for word in answer.split_whitespace() {
                        let _ = app.emit_to("main", "chat_token", format!("{} ", word));
                        tokio::task::yield_now().await;
                    }
                    let _ = app.emit_to("main", "chat_done", ());
                    let _ = app.emit("blade_status", "idle");

                    // Record the reasoning for solution memory
                    crate::metacognition::remember_solution(
                        &last_user_text,
                        crate::safe_slice(&trace.final_answer, 300),
                        &["reasoning_engine".to_string()],
                    );

                    return Ok(());
                }
                Err(e) => {
                    // Reasoning failed — fall through to normal chat
                    log::warn!("[reasoning] Deep reasoning failed: {} — falling back to normal chat", e);
                }
            }
        }
    }

    // Track whether brain planner was used (for pons relay → learning_engine)
    let mut brain_plan_used = false;

    // ── Brain planner for complex tasks ─────────────────────────────────────────
    // For complex multi-step requests (3+ implied actions), the Brain planner
    // makes a separate cheap LLM call to produce a structured execution plan.
    // This replaces the old static "state your plan" instruction with a real
    // pre-computed plan that references specific organs and tools.
    //
    // Falls back to the old static instruction if the Brain call fails.
    {
        let plan_score = count_task_steps(&last_user_text);
        if plan_score >= 3 {
            let _ = app.emit_to("main", "blade_planning", serde_json::json!({
                "query": crate::safe_slice(&last_user_text, 120),
                "step_count": plan_score,
            }));

            let hive_digest = crate::hive::get_hive_digest();
            let dna_context = crate::dna::query_for_brain(&last_user_text);
            let brain_plan = crate::brain_planner::plan_task(
                &last_user_text,
                &hive_digest,
                &dna_context,
            )
            .await;

            if !brain_plan.is_empty() {
                brain_plan_used = true;
                system_prompt.push_str("\n\n---\n\n");
                system_prompt.push_str(&brain_plan);
            } else {
                // Fallback: static planning instruction if Brain planner fails
                system_prompt.push_str(
                    "\n\n---\n\n## PLANNING MODE\n\n\
                     The user's request requires multiple steps. Before calling any tools:\n\
                     1. **State your plan** in 1-3 sentences.\n\
                     2. **Execute step-by-step**, calling tools in the planned order.\n\
                     3. **Check results** between steps — adapt if a step fails.\n\
                     4. **Summarize** what you accomplished when done."
                );
            }
        }
    }
    // ── End brain planner ────────────────────────────────────────────────────

    // MCP tools + native built-in tools (bash, file ops, web fetch)
    // Prune to ≤60 tools total — beyond that, accuracy degrades as the model
    // gets confused by irrelevant tool noise. Score MCP tools by relevance to
    // the current task; native tools are smartly filtered to top suggestions.
    let all_native_tools = crate::native_tools::tool_definitions();

    // Smart native tool selection: if we have a non-empty query, use suggest_tools_for_query
    // to keep only the most relevant native tools. Fall back to all tools if no suggestions.
    let native_tools: Vec<ToolDefinition> = if !last_user_text.is_empty() {
        let suggested = crate::native_tools::suggest_tools_for_query(&last_user_text);
        if suggested.is_empty() {
            // No strong signal → include everything (safe fallback)
            all_native_tools
        } else {
            // Always include the suggested tools, plus a small core set that's
            // useful for nearly any task (time, clipboard, notify).
            let always_include = &[
                "blade_time_now", "blade_get_clipboard", "blade_set_clipboard",
                "blade_notify", "blade_update_thread", "blade_read_thread",
            ];
            all_native_tools
                .into_iter()
                .filter(|t| suggested.contains(&t.name)
                    || always_include.contains(&t.name.as_str()))
                .collect()
        }
    } else {
        all_native_tools
    };

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

    // Capture message count before build_conversation moves the Vec.
    let input_message_count = messages.len();
    let conversation = providers::build_conversation(messages, Some(system_prompt));

    // Check if any message has an image (vision request).
    // Used by the fast-path heuristic: image-only queries are conversational
    // (no code/shell keywords) and stream_text handles them natively.
    // Kept as metadata for potential future routing decisions.
    let _has_image = conversation
        .iter()
        .any(|m| matches!(m, ConversationMessage::UserWithImage { .. }));

    // Fast path: stream directly when we can confidently skip the tool loop.
    //
    // Conditions for the fast path:
    //   A) No tools at all — always stream.
    //   B) Only native tools (no MCP tools) AND the message looks conversational
    //      (short, no action verbs, no technical triggers).
    //
    // Images are fine on the fast path — stream_text passes them to the provider API
    // (Anthropic/OpenAI serialize_simple handles UserWithImage).
    //
    // We do NOT bypass the tool loop if:
    //   - MCP tools are present (user explicitly configured agent capabilities)
    //   - The message contains code fences, shell keywords, or file operation words
    //   - The conversation is long (>6 turns) — ongoing sessions often need tool continuity
    //
    // When in doubt we fall through to the tool loop which is always safe.
    let only_native_tools = !tools.is_empty()
        && tools.iter().all(|t| crate::native_tools::is_native(&t.name));
    let is_conversational = {
        let txt = last_user_text.trim();
        let txt_lower = txt.to_lowercase();
        // Use word-boundary matching: "find motivation" is conversational,
        // "find the file" is not. Check that action words appear as standalone
        // imperative commands (start of sentence or after space, followed by
        // a space or end-of-string), not embedded in normal prose.
        let has_action_word = txt.contains("```")
            || txt_lower.starts_with("run ")
            || txt_lower.starts_with("execute ")
            || txt_lower.starts_with("install ")
            || txt_lower.starts_with("build ")
            || txt_lower.starts_with("open ")
            || txt_lower.starts_with("search ")
            || txt_lower.starts_with("find ")
            || txt_lower.starts_with("fetch ")
            || txt_lower.starts_with("write ")
            || txt_lower.starts_with("delete ")
            || txt_lower.starts_with("create ")
            || txt_lower.starts_with("read ")
            || txt_lower.contains("read file")
            || txt_lower.contains("git ")
            || txt_lower.contains(" npm ")
            || txt_lower.starts_with("npm ")
            || txt_lower.contains(" cargo ")
            || txt_lower.starts_with("cargo ")
            || txt_lower.contains("python ")
            || txt_lower.contains("bash ")
            || txt_lower.contains("terminal")
            || txt_lower.contains("can you open ")
            || txt_lower.contains("can you run ")
            || txt_lower.contains("can you find ")
            || txt_lower.contains("can you search ")
            || txt_lower.contains("can you create ")
            || txt_lower.contains("can you write ")
            || txt_lower.contains("please open ")
            || txt_lower.contains("please run ")
            || txt_lower.contains("please find ")
            || txt_lower.contains("please search ")
            || txt_lower.contains("please create ");
        txt.len() < 200 && !has_action_word
    };
    // Short conversations (≤6 messages) are safe to fast-path; longer sessions
    // may have tool-call context the model needs to continue properly.
    let is_short_conversation = input_message_count <= 6;

    if tools.is_empty() || (only_native_tools && is_conversational && is_short_conversation) {
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
                    let _ = app2.emit_to("main", "brain_grew", serde_json::json!({ "new_entities": n }));
                }
            });
            // PREDICTION ENGINE: fire-and-forget contextual prediction (streaming path)
            let pred_msg = last_user_text.clone();
            tokio::spawn(async move {
                let _ = crate::prediction_engine::contextual_prediction(&pred_msg).await;
            });
            // EMOTIONAL INTELLIGENCE: detect emotion from user message (streaming path)
            {
                let emotion_msg = last_user_text.clone();
                let emotion_app = app.clone();
                tokio::spawn(async move {
                    crate::emotional_intelligence::process_message_emotion(&emotion_msg, emotion_app).await;
                });
            }
            // CONVERSATION SUMMARIZATION (streaming path) — 5+ turns only
            if input_message_count >= 5 {
                let conv_msgs: Vec<crate::providers::ChatMessage> = conversation
                    .iter()
                    .filter_map(|m| match m {
                        crate::providers::ConversationMessage::User(s) => Some(crate::providers::ChatMessage {
                            role: "user".to_string(),
                            content: s.clone(),
                            image_base64: None,
                        }),
                        crate::providers::ConversationMessage::Assistant { content, .. } => Some(crate::providers::ChatMessage {
                            role: "assistant".to_string(),
                            content: content.clone(),
                            image_base64: None,
                        }),
                        _ => None,
                    })
                    .collect();
                if !conv_msgs.is_empty() {
                    let conv_id = format!("stream_{}", chrono::Utc::now().timestamp());
                    tokio::spawn(async move {
                        crate::memory_palace::summarize_conversation(&conv_msgs, &conv_id).await;
                    });
                }
            }
            // People graph + personality mirror (streaming path, same as tool-loop path)
            {
                let pg_user = last_user_text.clone();
                tokio::spawn(async move {
                    crate::people_graph::learn_from_conversation_text(&pg_user, "").await;
                    crate::personality_mirror::learn_from_exchange(&pg_user, "").await;
                });
            }
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
            let _ = app.emit_to("main", "chat_cancelled", ());
            let _ = app.emit_to("main", "chat_done", ());
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
                        let _ = app.emit_to("main", "blade_notification", serde_json::json!({
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
                                if brain_plan_used { crate::brain_planner::reject_plan(&last_user_text); }
                                return Err(format!("Context trimmed but still failed: {}", e2));
                            }
                        }
                    }
                    ErrorRecovery::SwitchModelAndRetry => {
                        let fallback = safe_fallback_model(&config.provider).to_string();
                        let _ = app.emit("blade_status", "processing");
                        let _ = app.emit_to("main", "blade_notification", serde_json::json!({
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
                        record_error("rate_limit");
                        if is_circuit_broken("rate_limit") {
                            let _ = app.emit("blade_status", "error");
                            return Err("Rate limit circuit breaker tripped — too many rate limit errors in 5 minutes. Check your API quota or switch providers.".to_string());
                        }

                        // Strategy: instead of just waiting, try switching to a free/fallback
                        // model first. This keeps the conversation flowing without delay.
                        // Priority: OpenRouter free tier → Groq (generous free tier) → wait + retry.
                        let free_model_result = try_free_model_fallback(
                            &config,
                            &conversation,
                            &tools,
                            &app,
                        ).await;
                        if let Some(t) = free_model_result {
                            t
                        } else {
                            // No free model available — fall back to waiting
                            let wait = backoff_secs(secs, "rate_limit");
                            let _ = app.emit_to("main", "blade_notification", serde_json::json!({
                                "type": "info",
                                "message": format!("Rate limited on {}. Retrying in {}s.", config.provider, wait)
                            }));
                            tokio::time::sleep(std::time::Duration::from_secs(wait)).await;
                            let _ = app.emit("blade_status", "processing");
                            let retry = providers::complete_turn(
                                &config.provider, &config.api_key, &config.model,
                                &conversation, &tools, config.base_url.as_deref(),
                            ).await;
                            match retry {
                                Ok(t) => t,
                                Err(e2) => {
                                    let _ = app.emit("blade_status", "error");
                                    return Err(format!("Still rate limited after {}s wait: {}", wait, e2));
                                }
                            }
                        }
                    }
                    ErrorRecovery::OverloadedRetry => {
                        record_error("overloaded");
                        if is_circuit_broken("overloaded") {
                            let _ = app.emit("blade_status", "error");
                            return Err("Server overload circuit breaker tripped — provider is consistently unavailable. Try again later or switch providers.".to_string());
                        }
                        let wait = backoff_secs(5, "overloaded");
                        let _ = app.emit_to("main", "blade_notification", serde_json::json!({
                            "type": "info", "message": format!("Server overloaded — retrying in {}s", wait)
                        }));
                        tokio::time::sleep(std::time::Duration::from_secs(wait)).await;
                        let _ = app.emit("blade_status", "processing");
                        let retry = providers::complete_turn(
                            &config.provider, &config.api_key, &config.model,
                            &conversation, &tools, config.base_url.as_deref(),
                        ).await;
                        match retry {
                            Ok(t) => t,
                            Err(e2) => {
                                let _ = app.emit("blade_status", "error");
                                return Err(format!("Server still overloaded after {}s: {}", wait, e2));
                            }
                        }
                    }
                    ErrorRecovery::Fatal(msg) => {
                        // Before giving up: try the configured fallback provider
                        // Use the already-loaded config — never re-read from disk mid-loop
                        // (user could have changed it, causing provider switch mid-run)
                        let fallback_provider = config.task_routing.fallback.clone();
                        if let Some(fb_prov) = fallback_provider {
                            if fb_prov != config.provider {
                                let fb_key = crate::config::get_provider_key(&fb_prov);
                                if !fb_key.is_empty() || fb_prov == "ollama" {
                                    let fb_model = crate::router::suggest_model(&fb_prov, &crate::router::TaskType::Complex)
                                        .unwrap_or_else(|| config.model.clone());
                                    let _ = app.emit("blade_status", "processing");
                                    let _ = app.emit_to("main", "blade_notification", serde_json::json!({
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
            // Phase 3 WIRE-03 (Plan 03-01): emit blade_message_start once before
            // the assistant turn streams. Reset thinking-chunk tagging via env var
            // (D-64 — providers/anthropic.rs reads BLADE_CURRENT_MSG_ID for WIRE-04).
            let msg_id = uuid::Uuid::new_v4().to_string();
            let _ = app.emit_to("main", "blade_message_start", serde_json::json!({
                "message_id": &msg_id,
                "role": "assistant",
            }));
            std::env::set_var("BLADE_CURRENT_MSG_ID", &msg_id);
            current_message_id = Some(msg_id);

            // Extract and execute semantic action tags before emitting to frontend.
            // clean_content has [ACTION:...] tags stripped; actions are dispatched async.
            let (clean_content, parsed_actions) = crate::action_tags::extract_actions(&turn.content);

            // Execute actions in the background (fire-and-forget)
            if !parsed_actions.is_empty() {
                let actions_app = app.clone();
                let actions_clone = parsed_actions.clone();
                tokio::spawn(async move {
                    crate::action_tags::execute_actions(actions_clone, &actions_app).await;
                });
            }

            // Final text response — emit word-by-word for streaming feel (action-tags stripped).
            // We yield between chunks so the Tauri IPC channel can flush each batch to the
            // frontend individually, giving real progressive rendering rather than one big burst.
            if !clean_content.is_empty() {
                let mut buf = String::new();
                for ch in clean_content.chars() {
                    buf.push(ch);
                    // Emit on natural boundaries: space, newline, or every 6 chars
                    if ch == ' ' || ch == '\n' || buf.len() >= 6 {
                        let _ = app.emit_to("main", "chat_token", buf.clone());
                        buf.clear();
                        // Yield to the async runtime so the IPC channel flushes this chunk
                        // before the next one — this produces a real streaming feel.
                        tokio::task::yield_now().await;
                    }
                }
                if !buf.is_empty() {
                    let _ = app.emit_to("main", "chat_token", buf);
                }
            } else {
                // AI returned an empty response after tool calls — emit a brief fallback
                // so the user doesn't see a blank assistant bubble.
                let _ = app.emit_to("main", "chat_token", "Done.".to_string());
            }
            let _ = app.emit_to("main", "chat_done", ());
            let _ = app.emit("blade_status", "idle");

            // Complete prefrontal working memory so follow-up messages
            // know what was just accomplished
            crate::prefrontal::complete_task(crate::safe_slice(&clean_content, 200));

            // Plan memory: confirm successful brain-planned tasks so they're cached
            if brain_plan_used {
                crate::brain_planner::confirm_plan(&last_user_text);
            }

            // Background: entity extraction + auto-embed + THREAD update + SKILL ENGINE + gap detection
            let app2 = app.clone();
            let app3 = app.clone();
            let user_text = last_user_text.clone();
            // Use clean_content for downstream processing so tags don't pollute memory
            let assistant_text = clean_content.clone();
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
                    let _ = app2.emit_to("main", "brain_grew", serde_json::json!({ "new_entities": n }));
                }
                // Embed the full exchange for persistent semantic memory
                crate::embeddings::auto_embed_exchange(&store_clone, &user_text, &assistant_text, "tool_loop");
                // SKILL ENGINE (cerebellum): record successful tool pattern
                if !tools_used.is_empty() {
                    let result_summary = crate::safe_slice(&assistant_text, 200);
                    crate::skill_engine::record_tool_pattern(&user_text_skill, &tools_used, result_summary);
                    // Check if any candidates are ready to graduate to skills
                    crate::skill_engine::maybe_synthesize_skills(app3).await;
                }
                // PONS RELAY: record brain-planned tasks as behavior patterns
                // When brain_planner produces a plan and it executes successfully,
                // learning_engine should detect this as a repeatable workflow.
                if brain_plan_used && !tools_used.is_empty() {
                    let workflow_desc = format!(
                        "Brain-planned task: {} → tools: {}",
                        crate::safe_slice(&user_text_skill, 80),
                        tools_used.join(" → ")
                    );
                    let db_path = crate::config::blade_config_dir().join("blade.db");
                    if let Ok(conn) = rusqlite::Connection::open(&db_path) {
                        let _ = crate::db::timeline_record(
                            &conn,
                            "brain_plan_executed",
                            &workflow_desc,
                            "",
                            "brain_planner",
                            "{}",
                        );
                    }
                }
                // SOLUTION MEMORY: if this was a problem-solving exchange, remember the solution
                {
                    let q = user_text_skill.to_lowercase();
                    let was_problem = q.contains("error") || q.contains("fix") || q.contains("bug")
                        || q.contains("broken") || q.contains("failing") || q.contains("not working");
                    if was_problem && !tools_used.is_empty() {
                        crate::metacognition::remember_solution(
                            &user_text_skill,
                            crate::safe_slice(&assistant_text, 300),
                            &tools_used,
                        );
                    }
                }

                // Capability gap detection — runs silently, fires webhook if gap found
                if reports::detect_and_log(&user_text, &assistant_text) {
                    let _ = app2.emit_to("main", "capability_gap_detected", serde_json::json!({
                        "user_request": crate::safe_slice(&user_text, 120),
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
                // SELF-CRITIQUE: background quality check — rebuild if score < 7
                if let Some(improved) = crate::self_critique::maybe_critique(&user_text, &assistant_text).await {
                    let _ = app2.emit_to("main", "response_improved", serde_json::json!({
                        "improved": improved,
                    }));
                }
                // Extract compounding facts from this exchange into KG + typed memory
                // Only run when there's enough content worth learning from (>50 chars each side)
                if user_text.len() > 50 || assistant_text.len() > 50 {
                    let fact_msgs = vec![
                        crate::providers::ChatMessage {
                            role: "user".to_string(),
                            content: user_text.clone(),
                            image_base64: None,
                        },
                        crate::providers::ChatMessage {
                            role: "assistant".to_string(),
                            content: assistant_text.clone(),
                            image_base64: None,
                        },
                    ];
                    crate::memory::extract_conversation_facts(&fact_msgs).await;
                }
                // Record activity for dream mode
                crate::dream_mode::record_user_activity();
                // Detect knowledge gaps from this conversation
                crate::autonomous_research::detect_gaps_from_conversation(&user_text, &assistant_text).await;
                // Record conversation event for causal graph
                crate::causal_graph::record_event(
                    "conversation",
                    crate::safe_slice(&user_text, 200),
                    serde_json::json!({"response_len": assistant_text.len()}),
                );
                // Memory palace auto-consolidation — crystallise substantive exchanges
                crate::memory_palace::auto_consolidate_from_conversation(&user_text, &assistant_text).await;
                // Knowledge graph — extract concepts and grow the semantic network
                let full_exchange = format!("User: {}\n\nAssistant: {}", user_text, assistant_text);
                crate::knowledge_graph::grow_graph_from_conversation(&full_exchange).await;
                // People graph — extract names mentioned and learn communication context
                crate::people_graph::learn_from_conversation_text(&user_text, &assistant_text).await;
                // Personality mirror — extract BLADE's chat style from this exchange
                crate::personality_mirror::learn_from_exchange(&user_text, &assistant_text).await;
            });
            // CONVERSATION SUMMARIZATION — for 5+ turn conversations, generate a 2-sentence
            // summary episode so "what did we discuss about X last week?" actually works.
            // We build the full messages list from the conversation buffer for this.
            if input_message_count >= 5 {
                let conv_msgs: Vec<crate::providers::ChatMessage> = conversation
                    .iter()
                    .filter_map(|m| match m {
                        crate::providers::ConversationMessage::User(s) => Some(crate::providers::ChatMessage {
                            role: "user".to_string(),
                            content: s.clone(),
                            image_base64: None,
                        }),
                        crate::providers::ConversationMessage::Assistant { content, .. } => Some(crate::providers::ChatMessage {
                            role: "assistant".to_string(),
                            content: content.clone(),
                            image_base64: None,
                        }),
                        _ => None,
                    })
                    .collect();
                if !conv_msgs.is_empty() {
                    let conv_id = format!("tool_loop_{}", chrono::Utc::now().timestamp());
                    tokio::spawn(async move {
                        crate::memory_palace::summarize_conversation(&conv_msgs, &conv_id).await;
                    });
                }
            }
            // VIRTUAL CONTEXT BLOCKS: update rolling conversation summary (fire-and-forget)
            {
                let vcb_user = user_text_thread.clone();
                let vcb_assistant = assistant_text_thread.clone();
                tokio::spawn(async move {
                    let _ = crate::memory::update_conversation_block(&vcb_user, &vcb_assistant).await;
                });
            }
            // THREAD: auto-update working memory (spawns its own background task)
            crate::thread::auto_update_thread(app.clone(), user_text_thread.clone(), assistant_text_thread);

            // ACTIVITY TIMELINE: record this conversation turn
            {
                let db_path = crate::config::blade_config_dir().join("blade.db");
                if let Ok(conn) = rusqlite::Connection::open(&db_path) {
                    let title = crate::safe_slice(&user_text_thread, 80);
                    let content = crate::safe_slice(&assistant_text_timeline, 500);
                    let _ = crate::db::timeline_record(&conn, "conversation", title, content, "BLADE", "{}");
                }
            }

            // PREDICTION ENGINE: fire-and-forget contextual prediction after each message
            {
                let pred_ctx = user_text_thread.clone();
                tokio::spawn(async move {
                    let _ = crate::prediction_engine::contextual_prediction(&pred_ctx).await;
                });
            }
            // EMOTIONAL INTELLIGENCE: detect emotion from user message (tool loop path)
            {
                let emotion_msg = user_text_thread.clone();
                let emotion_app = app.clone();
                tokio::spawn(async move {
                    crate::emotional_intelligence::process_message_emotion(&emotion_msg, emotion_app).await;
                });
            }

            return Ok(());
        }

        // Detect identical tool call loops — same tool name+args repeated 3× means stuck.
        // We deliberately exclude the tool call ID from the signature because providers
        // generate a fresh UUID per call, so the same logical call always has a new ID.
        // Comparing only name+args catches true stuck loops.
        let sig = turn.tool_calls.iter()
            .map(|tc| format!("{}:{}", tc.name, tc.arguments))
            .collect::<Vec<_>>()
            .join("|");
        if sig == last_tool_signature {
            repeat_count += 1;
            if repeat_count >= 3 {
                break; // fall through to final summary call
            }
        } else {
            repeat_count = 0;
            last_tool_signature = sig;
        }

        // Track whether a schema-validation error was injected this iteration.
        // We allow at most 1 such retry per iteration to avoid infinite loops.
        let mut schema_retry_done = false;

        for tool_call in turn.tool_calls {
            let is_native = crate::native_tools::is_native(&tool_call.name);

            // ── Structured-output validation ────────────────────────────────────
            // Validate the LLM's tool arguments against the tool's declared schema.
            // If validation fails (and we haven't already retried this iteration),
            // inject the error as a Tool result so the LLM can self-correct.
            // This implements the guidance/outlines retry pattern:
            // bad structured output → inject error → LLM sees it → fixes args → retry.
            if !schema_retry_done {
                // Look up the tool's input_schema
                let maybe_schema: Option<serde_json::Value> = if is_native {
                    // Find the schema from native tool definitions
                    crate::native_tools::tool_definitions()
                        .into_iter()
                        .find(|t| t.name == tool_call.name)
                        .map(|t| t.input_schema)
                } else {
                    // Look up MCP tool schema
                    let manager = state.lock().await;
                    manager
                        .get_tools()
                        .iter()
                        .find(|t| t.qualified_name == tool_call.name)
                        .map(|t| t.input_schema.clone())
                };

                if let Some(ref schema) = maybe_schema {
                    // Serialize current arguments back to a string for the validator
                    let args_str = serde_json::to_string(&tool_call.arguments).unwrap_or_default();
                    if let Err(validation_err) =
                        providers::validate_tool_response(&args_str, Some(schema))
                    {
                        // Inject the validation error as a Tool result so the LLM retries
                        conversation.push(ConversationMessage::Tool {
                            tool_call_id: tool_call.id.clone(),
                            tool_name: tool_call.name.clone(),
                            content: format!(
                                "Schema validation failed for tool '{}'. {}\n\
                                 Re-call the tool with corrected arguments.",
                                tool_call.name, validation_err
                            ),
                            is_error: true,
                        });
                        schema_retry_done = true;
                        continue;
                    }
                }
            }

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
                            let _ = app.emit_to("main", "ai_delegate_approved", serde_json::json!({
                                "tool": &tool_call.name,
                                "delegate": &delegate,
                                "reasoning": reasoning,
                            }));
                            true
                        }
                        crate::ai_delegate::DelegateDecision::Denied { reasoning } => {
                            let _ = app.emit_to("main", "ai_delegate_denied", serde_json::json!({
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
                            let _ = app.emit_to(
                                "main",
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
                    let _ = app.emit_to(
                        "main",
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

            // SYMBOLIC LAYER: check policies before executing
            // Deterministic rules that LLMs can't be trusted with (no deploy on Friday, etc.)
            {
                let action_desc = format!("{} {}", tool_call.name,
                    serde_json::to_string(&tool_call.arguments).unwrap_or_default());
                let ctx = crate::symbolic::ActionContext::current();
                let policy_result = crate::symbolic::check_policies(&action_desc, &ctx);
                if policy_result.action == "block" {
                    conversation.push(ConversationMessage::Tool {
                        tool_call_id: tool_call.id.clone(),
                        tool_name: tool_call.name.clone(),
                        content: format!("BLOCKED by policy: {}", policy_result.reason),
                        is_error: true,
                    });
                    continue;
                }
                if policy_result.action == "warn" && !policy_result.triggered_policies.is_empty() {
                    log::warn!("[symbolic] Policy warning for {}: {}", tool_call.name, policy_result.reason);
                }
            }

            let _ = app.emit_to(
                "main",
                "tool_executing",
                serde_json::json!({
                    "name": &tool_call.name,
                    "arguments": &tool_call.arguments,
                    "risk": format!("{:?}", risk),
                }),
            );

            // Execute: native tools handled inline, MCP tools via manager
            let (mut content, is_error) = if is_native {
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
                                    Err(e2) => {
                                        let msg = explain_tool_failure(
                                            &tool_call.name,
                                            &tool_call.arguments,
                                            &format!("Tool failed even after installing {}: {}", name, e2),
                                            Some(&app),
                                        );
                                        (msg, true)
                                    }
                                }
                            }
                            _ => {
                                // Autoskills couldn't help — try the immune system
                                // (deeper: CLI tools, browser automation, tool forging)
                                let immune_msg = crate::immune_system::resolve_capability_gap(
                                    &app,
                                    &tool_call.name,
                                    &last_user_text,
                                ).await;

                                if immune_msg.contains("Found") || immune_msg.contains("Created") {
                                    // Immune system found something — report to the model
                                    (immune_msg, true)
                                } else {
                                    let msg = explain_tool_failure(
                                        &tool_call.name,
                                        &tool_call.arguments,
                                        &e,
                                        Some(&app),
                                    );
                                    (msg, true)
                                }
                            }
                        }
                    }
                }
            };

            // For native tool errors, enrich the failure explanation too.
            if is_error && crate::native_tools::is_native(&tool_call.name) {
                let raw_error = content.clone();
                let enriched = explain_tool_failure(
                    &tool_call.name,
                    &tool_call.arguments,
                    &raw_error,
                    Some(&app),
                );
                // Only replace if the enriched version adds new information
                if enriched.len() > raw_error.len() || enriched.contains("Similar files") || enriched.contains("not installed") {
                    content = enriched;
                }
            }

            // Prefrontal working memory: record this tool step
            if !is_error {
                crate::prefrontal::record_step(&tool_call.name, crate::safe_slice(&content, 150));
            }

            // Emit a short preview of the result (first 300 chars) so the UI can show it
            let result_preview: String = content.chars().take(300).collect();
            let result_preview = if content.chars().count() > 300 {
                format!("{}…", result_preview)
            } else {
                result_preview
            };
            let _ = app.emit_to(
                "main",
                "tool_completed",
                serde_json::json!({
                    "name": &tool_call.name,
                    "is_error": is_error,
                    "result": result_preview,
                }),
            );

            // Feed non-error tool results into knowledge graph (fire-and-forget).
            // Tool outputs contain real-world data (file contents, API responses, search
            // results) that the knowledge graph should learn from.
            if !is_error && content.len() > 50 && content.len() < 5000 {
                let tool_content = content.clone();
                let tool_name = tool_call.name.clone();
                tokio::spawn(async move {
                    let snippet = format!("[Tool: {}] {}", tool_name, crate::safe_slice(&tool_content, 1000));
                    crate::knowledge_graph::grow_graph_from_conversation(&snippet).await;
                });
            }

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
    //
    // IMPORTANT: If the last assistant message has outstanding tool_calls that
    // have no corresponding Tool result messages, providers like Anthropic and
    // OpenAI will reject the request with a validation error.  We must inject
    // synthetic tool-result stubs for every unresolved call before adding the
    // summary user prompt.
    {
        // Collect tool call IDs from the last assistant message that have no result
        let pending_ids: Vec<(String, String)> = conversation
            .iter()
            .rev()
            .find_map(|m| match m {
                ConversationMessage::Assistant { tool_calls, .. } if !tool_calls.is_empty() => {
                    Some(tool_calls.iter().map(|tc| (tc.id.clone(), tc.name.clone())).collect())
                }
                _ => None,
            })
            .unwrap_or_default();

        // Which of those already have a Tool result in the conversation?
        let resolved_ids: std::collections::HashSet<String> = conversation
            .iter()
            .filter_map(|m| match m {
                ConversationMessage::Tool { tool_call_id, .. } => Some(tool_call_id.clone()),
                _ => None,
            })
            .collect();

        // Inject stubs for any unresolved tool calls
        for (id, name) in pending_ids {
            if !resolved_ids.contains(&id) {
                conversation.push(ConversationMessage::Tool {
                    tool_call_id: id,
                    tool_name: name,
                    content: "[Tool execution did not complete — loop limit reached]".to_string(),
                    is_error: true,
                });
            }
        }
    }
    // Check cancel flag before firing the final summary call —
    // the user may have hit stop during the last tool iteration.
    if CHAT_CANCEL.load(Ordering::SeqCst) {
        let _ = app.emit_to("main", "chat_cancelled", ());
        let _ = app.emit_to("main", "chat_done", ());
        let _ = app.emit("blade_status", "idle");
        return Ok(());
    }

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
    let mut cfg = load_config();
    // Never expose API keys to the frontend — redact them
    if !cfg.api_key.is_empty() {
        cfg.api_key = "••••••••".to_string();
    }
    cfg
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
    // Guard against masked key values like "sk-an...1234" from the frontend —
    // these would overwrite the real keyring key with garbage. Only update
    // the key if it looks like a real, complete key (no "..." mask).
    if !api_key.contains("...") && !api_key.is_empty() {
        config.api_key = api_key;
    }
    // If apiKey was empty or masked, keep the existing key from keyring.
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
        crate::godmode::start_god_mode(app.clone(), &config.god_mode_tier);
        // Start audio timeline capture when God Mode turns on (if configured)
        if config.audio_capture_enabled {
            crate::audio_timeline::start_audio_timeline_capture(app.clone());
        }
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
pub async fn mcp_server_health(
    state: tauri::State<'_, SharedMcpManager>,
) -> Result<Vec<crate::mcp::ServerHealth>, String> {
    let manager = state.lock().await;
    Ok(manager.get_server_health())
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
    let _ = app.emit_to(
        "main",
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
        "openrouter" => "meta-llama/llama-3.3-70b-instruct:free",
        _            => return Ok(()), // skip for local/unknown providers (ollama etc.)
    };

    let u = crate::safe_slice(&user_text, 300);
    let a = crate::safe_slice(&assistant_text, 300);
    let prompt = format!(
        "Give this conversation a concise 4-6 word title. Output ONLY the title, no punctuation.\n\nUser: {u}\n\nAssistant: {a}"
    );

    let messages = vec![crate::providers::ConversationMessage::User(prompt)];
    let no_tools: Vec<ToolDefinition> = vec![];
    let turn = crate::providers::complete_turn(
        &config.provider,
        &config.api_key,
        model,
        &messages,
        &no_tools,
        config.base_url.as_deref(),
    )
    .await
    .unwrap_or_else(|_| crate::providers::AssistantTurn { content: String::new(), tool_calls: vec![] });

    let title = turn.content.trim().trim_matches('"').trim().to_string();
    if title.is_empty() || title.len() > 80 {
        return Ok(());
    }

    crate::history::update_conversation_title(&conversation_id, &title)?;

    let _ = app.emit_to(
        "main",
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

// ── Persona onboarding ─────────────────────────────────────────────────────────

/// Returns whether the user has completed the persona onboarding questionnaire.
#[tauri::command]
pub fn get_onboarding_status() -> bool {
    crate::config::load_config().persona_onboarding_complete
}

/// Receives the 5 onboarding answers, writes them to persona.md, extracts
/// traits and knowledge graph nodes, and marks onboarding as complete in config.
///
/// answers[0] = name + role
/// answers[1] = current project / what they are building
/// answers[2] = tools / languages / stack
/// answers[3] = biggest goal
/// answers[4] = communication preference
#[tauri::command]
pub async fn complete_onboarding(answers: Vec<String>) -> Result<(), String> {
    if answers.len() < 5 {
        return Err("Expected 5 answers".to_string());
    }

    // ── 1. Write persona.md ────────────────────────────────────────────────────
    let persona_md = format!(
        "# User Profile\n\n\
         **Name & Role:** {}\n\n\
         **Current Project:** {}\n\n\
         **Stack & Tools:** {}\n\n\
         **Biggest Goal:** {}\n\n\
         **Communication Style:** {}\n",
        answers[0].trim(),
        answers[1].trim(),
        answers[2].trim(),
        answers[3].trim(),
        answers[4].trim(),
    );

    let persona_path = crate::config::blade_config_dir().join("persona.md");
    crate::config::write_blade_file(&persona_path, &persona_md)?;

    // ── 2. Extract persona traits ──────────────────────────────────────────────
    crate::persona_engine::ensure_tables();

    // Communication preference maps to preferred_depth trait score
    let comm_pref = answers[4].trim().to_lowercase();
    let depth_score: f32 = if comm_pref.contains("brief") || comm_pref.contains("blunt") || comm_pref.contains("short") {
        0.2
    } else if comm_pref.contains("detail") || comm_pref.contains("thorough") || comm_pref.contains("in-depth") {
        0.8
    } else {
        0.5
    };
    crate::persona_engine::update_trait("preferred_depth", depth_score, &answers[4]);

    // Work identity from role answer
    if !answers[0].trim().is_empty() {
        crate::persona_engine::update_trait("work_identity", 0.9, answers[0].trim());
    }

    // Current goal
    if !answers[3].trim().is_empty() {
        crate::persona_engine::update_trait("current_goal", 0.9, answers[3].trim());
    }

    // Bump relationship — user trusted BLADE with personal info
    crate::persona_engine::update_relationship(5.0, 5.0, Some("Completed persona onboarding".to_string()));

    // ── 3. Knowledge graph nodes ───────────────────────────────────────────────
    let db_path = crate::config::blade_config_dir().join("blade.db");
    if let Ok(conn) = rusqlite::Connection::open(&db_path) {
        // Project node from answer[1]
        let project_answer = answers[1].trim().to_string();
        if !project_answer.is_empty() {
            let label = if project_answer.len() > 80 { project_answer[..80].to_string() } else { project_answer.clone() };
            let slug: String = label.to_lowercase().replace(' ', "-").chars().take(60).collect();
            let node_id = format!("project:{}", slug);
            let _ = crate::db::brain_upsert_node(&conn, &node_id, &label, "project", "User current project from onboarding");
        }

        // Tool nodes from answer[2] — split on common separators
        let stack_answer = answers[2].trim().to_string();
        if !stack_answer.is_empty() {
            let separators: Vec<char> = vec![',', '/', '|', '+', '\n', ';'];
            let tools: Vec<&str> = stack_answer
                .split(|c| separators.contains(&c))
                .map(|s| s.trim())
                .filter(|s| !s.is_empty() && s.len() <= 40)
                .take(12)
                .collect();

            for tool in tools {
                let node_id = format!("tool:{}", tool.to_lowercase().replace(' ', "-"));
                let _ = crate::db::brain_upsert_node(&conn, &node_id, tool, "tool", "Tool from user onboarding");
            }
        }
    }

    // ── 4. Seed virtual memory blocks with onboarding facts ───────────────────
    // This immediately populates the human_block so every subsequent conversation
    // starts with BLADE already knowing who the user is.
    {
        let mut blocks = crate::memory::load_memory_blocks();
        let role_line = format!("User: {}", answers[0].trim());
        let project_line = format!("Current project: {}", answers[1].trim());
        let stack_line = format!("Stack/Tools: {}", answers[2].trim());
        let goal_line = format!("Goal: {}", answers[3].trim());
        let style_line = format!("Communication style: {}", answers[4].trim());
        let facts = [role_line, project_line, stack_line, goal_line, style_line]
            .iter()
            .filter(|f| f.len() > 10)
            .map(|f| format!("- {}", f))
            .collect::<Vec<_>>()
            .join("\n");
        if !blocks.human_block.trim().is_empty() {
            blocks.human_block = format!("{}\n{}", blocks.human_block.trim_end(), facts);
        } else {
            blocks.human_block = facts;
        }
        let _ = crate::memory::save_memory_blocks(&blocks);
    }

    // ── 5. Mark onboarding complete in config ──────────────────────────────────
    let mut config = crate::config::load_config();
    config.persona_onboarding_complete = true;

    // Populate user_name from the first answer best-effort
    if config.user_name.is_empty() && !answers[0].trim().is_empty() {
        let first_word = answers[0].trim().split_whitespace().next().unwrap_or("").to_string();
        // Looks like a name if it starts uppercase and is a reasonable length
        if first_word.len() >= 2
            && first_word.len() <= 20
            && first_word.chars().next().map(|c| c.is_uppercase()).unwrap_or(false)
        {
            config.user_name = first_word;
        }
    }

    crate::config::save_config(&config)?;

    Ok(())
}

#[tauri::command]
pub async fn get_wallpaper_path() -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        use winreg::enums::*;
        use winreg::RegKey;
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let desktop = hkcu
            .open_subkey(r"Control Panel\Desktop")
            .map_err(|e| format!("Registry error: {e}"))?;
        let path: String = desktop
            .get_value("WallPaper")
            .map_err(|e| format!("WallPaper value error: {e}"))?;
        return Ok(path);
    }
    #[cfg(target_os = "macos")]
    {
        let output = std::process::Command::new("osascript")
            .args(["-e", "tell app \"Finder\" to get POSIX path of (desktop picture as alias)"])
            .output()
            .map_err(|e| format!("osascript error: {e}"))?;
        return Ok(String::from_utf8_lossy(&output.stdout).trim().to_string());
    }
    #[cfg(target_os = "linux")]
    {
        let output = std::process::Command::new("gsettings")
            .args(["get", "org.gnome.desktop.background", "picture-uri"])
            .output()
            .map_err(|e| format!("gsettings error: {e}"))?;
        let raw = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let path = raw.trim_matches('\'').replace("file://", "");
        return Ok(path);
    }
    #[allow(unreachable_code)]
    Err("Unsupported platform".to_string())
}

// ── QuickAsk Bridge (Phase 3 WIRE-01 stub) ─────────────────────────────────────

/// WIRE-01 — Phase 3 stub.
/// QuickAsk window calls this with a typed/transcribed query; we emit
/// `blade_quickask_bridged` to the main window so it can open the chat
/// panel with the bridged conversation. Phase 4 will fill in the actual
/// provider call + history persistence; Phase 3 ships the stub so the
/// frontend bridge plumbing can be wired and tested end-to-end.
///
/// @see .planning/RECOVERY_LOG.md §1.1 (bridge contract)
/// @see .planning/phases/03-dashboard-chat-settings/03-CONTEXT.md §D-64
#[tauri::command]
pub async fn quickask_submit(
    app: tauri::AppHandle,
    query: String,
    mode: String,            // "text" | "voice"
    source_window: String,   // typically "quickask"
) -> Result<(), String> {
    let conversation_id = uuid::Uuid::new_v4().to_string();
    let timestamp = chrono::Utc::now().timestamp_millis();
    log::info!(
        "[quickask] submit from window={} mode={} query_len={} conv_id={}",
        source_window, mode, query.len(), conversation_id,
    );

    // Phase 3 stub emit — bridge contract per RECOVERY_LOG.md §1.1.
    // `response` is empty in Phase 3; Phase 4 fills it once provider call lands.
    let _ = app.emit_to("main", "blade_quickask_bridged", serde_json::json!({
        "query": query,
        "response": "",
        "conversation_id": conversation_id,
        "mode": mode,
        "timestamp": timestamp,
    }));
    Ok(())
}
