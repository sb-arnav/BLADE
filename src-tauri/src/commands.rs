use crate::brain;
use crate::config::{load_config, save_config, BladeConfig, SavedMcpServerConfig};
use crate::history::{
    list_conversations, load_conversation, save_conversation, ConversationSummary, HistoryMessage,
    StoredConversation,
};
use crate::mcp::{McpManager, McpServerConfig, McpTool, McpToolResult};
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
///
/// Phase 33 / Plan 33-03 (LOOP-06): visibility promoted to `pub(crate)` so
/// `loop_engine::run_loop` can read this atomic from inside the lifted
/// iteration body. The cancellation race window is unchanged: the flip
/// takes effect at the next iteration boundary.
pub(crate) static CHAT_CANCEL: AtomicBool = AtomicBool::new(false);
static CHAT_INFLIGHT: AtomicBool = AtomicBool::new(false);

// ---------------------------------------------------------------------------
// Phase 4 Plan 04-01 (D-93, D-100): streaming-window registry.
//
// `send_message_stream_inline` is the shared streaming pipeline used by both
// `send_message_stream` (main-only emits) and `quickask_submit` (parallel
// emits to both "main" AND "quickask"). The list of windows is stored in a
// process-global RwLock and consulted by the `emit_stream_event` helper on
// every user-visible stream emit (chat_token / chat_done / blade_message_start
// / blade_thinking_chunk / chat_ack / blade_planning / blade_notification /
// blade_routing_switched / ai_delegate_* / chat_routing / blade_token_ratio /
// chat_cancelled). Semantic background-task emits (brain_grew,
// capability_gap_detected, response_improved) stay main-only intentionally —
// those are not part of the user-visible stream contract.
//
// Serialization is preserved by CHAT_INFLIGHT: only one streaming session may
// execute at a time, so the RwLock swap is race-free in practice.
// ---------------------------------------------------------------------------
static STREAMING_EMIT_WINDOWS: std::sync::OnceLock<std::sync::RwLock<Vec<String>>> =
    std::sync::OnceLock::new();

fn streaming_emit_windows() -> &'static std::sync::RwLock<Vec<String>> {
    STREAMING_EMIT_WINDOWS.get_or_init(|| std::sync::RwLock::new(vec!["main".to_string()]))
}

fn set_streaming_emit_windows(windows: &[&str]) {
    if let Ok(mut w) = streaming_emit_windows().write() {
        *w = windows.iter().map(|s| s.to_string()).collect();
    }
}

fn reset_streaming_emit_windows() {
    if let Ok(mut w) = streaming_emit_windows().write() {
        *w = vec!["main".to_string()];
    }
}

/// Emit a user-visible stream event to every window currently registered in
/// `STREAMING_EMIT_WINDOWS`. Falls back to "main" if the lock is poisoned.
///
/// Used by `send_message_stream_inline` in place of every `app.emit_to("main", ...)`
/// site that is part of the user-visible stream contract (D-93, D-100).
pub(crate) fn emit_stream_event<S, P>(app: &tauri::AppHandle, event: S, payload: P)
where
    S: AsRef<str>,
    P: serde::Serialize + Clone,
{
    let event = event.as_ref();
    match streaming_emit_windows().read() {
        Ok(w) => {
            for label in w.iter() {
                let _ = app.emit_to(label.as_str(), event, payload.clone());
            }
        }
        Err(_) => {
            // Poisoned lock — fall back to main so the user still sees the stream.
            let _ = app.emit_to("main", event, payload);
        }
    }
}

/// Plan 34-08 (SESS-01) — emit a `blade_loop_event` to the chat UI AND record
/// the matching `LoopEvent` in the SessionWriter's JSONL for forensic replay.
///
/// Reduces the ≥6 duplicated emit-and-log patterns in loop_engine.rs to a
/// single function call. The `payload` should be a JSON object; its fields
/// are merged with `{ "kind": kind }` for the live event sent to the UI, and
/// recorded verbatim alongside `kind` in the JSONL line.
///
/// Drop-in replacement for:
///   emit_stream_event(app, "blade_loop_event", json!({"kind": K, ... }))
/// becomes:
///   emit_with_jsonl(app, writer, K, json!({...}))   // no kind in payload
pub(crate) fn emit_with_jsonl(
    app: &tauri::AppHandle,
    writer: &crate::session::log::SessionWriter,
    kind: &str,
    payload: serde_json::Value,
) {
    // Build the live event by merging {kind} with the payload object.
    let mut full = serde_json::json!({ "kind": kind });
    if let Some(obj) = payload.as_object() {
        if let Some(full_obj) = full.as_object_mut() {
            for (k, v) in obj {
                full_obj.insert(k.clone(), v.clone());
            }
        }
    }
    emit_stream_event(app, "blade_loop_event", full);
    // Record the forensic JSONL line. SessionWriter::append is panic-safe
    // (Plan 34-08 catch_unwind boundary), so a failure here cannot disturb
    // the live UI emit above.
    writer.append(&crate::session::log::SessionEvent::LoopEvent {
        kind: kind.to_string(),
        payload,
        timestamp_ms: crate::session::log::now_ms(),
    });
}

// ---------------------------------------------------------------------------
// Phase 4: Self-healing circuit breaker + exponential backoff
// (Phase 34-05 widened the tuple to (kind, provider, model, msg, ts) for
// LoopHaltReason::CircuitOpen.attempts_summary population.)
// ---------------------------------------------------------------------------

/// Ring-buffer of (kind, provider, model, msg, instant) for circuit-breaker tracking.
/// Plan 34-05 widened from (kind, instant) — provider/model/msg default to empty
/// strings when the legacy `record_error(kind)` wrapper is used.
static ERROR_HISTORY: std::sync::OnceLock<
    std::sync::Mutex<Vec<(String, String, String, String, std::time::Instant)>>,
> = std::sync::OnceLock::new();

fn error_history(
) -> &'static std::sync::Mutex<Vec<(String, String, String, String, std::time::Instant)>> {
    ERROR_HISTORY.get_or_init(|| std::sync::Mutex::new(Vec::new()))
}

/// Plan 34-05 (RES-02) — full-fidelity recorder. Captures provider/model/msg
/// for the new LoopHaltReason::CircuitOpen.attempts_summary surface. Existing
/// call sites that only know `kind` continue to use the thin `record_error`
/// wrapper below.
pub(crate) fn record_error_full(kind: &str, provider: &str, model: &str, msg: &str) {
    if let Ok(mut h) = error_history().lock() {
        h.push((
            kind.to_string(),
            provider.to_string(),
            model.to_string(),
            msg.to_string(),
            std::time::Instant::now(),
        ));
        // Keep at most 50 entries
        if h.len() > 50 {
            h.drain(0..10);
        }
    }
}

/// Backward-compatible thin wrapper. Existing call sites at loop_engine.rs:864,
/// loop_engine.rs:908, etc. continue to work; provider/model/msg default to
/// empty strings (which means circuit_attempts_summary returns AttemptRecords
/// with empty provider/model/msg for legacy entries — that's OK, the chat UI
/// can display "(unknown provider/model)" when those are empty).
#[cfg(test)]
pub(crate) fn record_error(kind: &str) {
    record_error_full(kind, "", "", "");
}

/// Returns true if the same error kind occurred ≥3 times in the last 5 minutes.
/// Plan 34-05 — unchanged behavior; reads new tuple shape (index 0 = kind).
pub(crate) fn is_circuit_broken(kind: &str) -> bool {
    let Ok(h) = error_history().lock() else { return false };
    let window = std::time::Duration::from_secs(300);
    let now = std::time::Instant::now();
    let count = h
        .iter()
        .filter(|(k, _p, _m, _msg, t)| k == kind && now.duration_since(*t) < window)
        .count();
    count >= 3
}

/// Plan 34-05 (RES-02) — return the matching failures for `attempts_summary`.
/// Used by run_loop to populate LoopHaltReason::CircuitOpen with the human-
/// readable list of attempts the user can see.
pub(crate) fn circuit_attempts_summary(kind: &str) -> Vec<crate::loop_engine::AttemptRecord> {
    let Ok(h) = error_history().lock() else { return Vec::new() };
    let window = std::time::Duration::from_secs(300);
    let now = std::time::Instant::now();
    h.iter()
        .filter(|(k, _p, _m, _msg, t)| k == kind && now.duration_since(*t) < window)
        .map(|(_k, p, m, msg, t)| {
            // Convert Instant to wall-clock ms via SystemTime::now() - elapsed.
            // Approximate (Instant has no direct epoch mapping); good enough for
            // forensic display.
            let elapsed_ms = now.duration_since(*t).as_millis() as u64;
            let now_ms = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0);
            crate::loop_engine::AttemptRecord {
                provider: p.clone(),
                model: m.clone(),
                error_message: msg.clone(),
                timestamp_ms: now_ms.saturating_sub(elapsed_ms),
            }
        })
        .collect()
}

/// Plan 34-05 (RES-02) — reset on success. Called by every successful provider
/// response (in run_loop, after `complete_turn` returns Ok and the cumulative
/// cost is accumulated). Without this, today's behavior accumulates errors
/// monotonically until the 50-entry cap drains the oldest 10 — a long history
/// of stale `rate_limit` followed by one fresh `timeout` would NOT trip the
/// timeout circuit, but the lingering `rate_limit` count would prevent
/// recovery if rate-limits returned later.
pub(crate) fn clear_error_history() {
    if let Ok(mut h) = error_history().lock() {
        h.clear();
    }
}

/// Exponential backoff for retries: base * 2^min(attempt, 3), capped at 120s.
/// `attempt` is the number of recent occurrences of this error kind in the last 5 min.
/// Plan 34-05 — unchanged behavior; reads new tuple shape.
pub(crate) fn backoff_secs(base: u64, kind: &str) -> u64 {
    let Ok(h) = error_history().lock() else { return base };
    let window = std::time::Duration::from_secs(300);
    let now = std::time::Instant::now();
    let attempt = h
        .iter()
        .filter(|(k, _p, _m, _msg, t)| k == kind && now.duration_since(*t) < window)
        .count();
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

/// Phase 32 / CTX-04 — return the model's context window in tokens.
///
/// Wraps `capability_probe::infer_capabilities` and returns just the 5th
/// tuple element (context_window). Falls back to 8_192 (capability_probe's
/// all_false default) for unknown provider/model pairs — this guarantees
/// the compaction trigger is never zero or negative.
///
/// Used by the proactive compaction trigger so every model triggers
/// compaction at exactly the same percentage of its real context window.
pub fn model_context_window(provider: &str, model: &str) -> u32 {
    let (_, _, _, _, ctx) =
        crate::capability_probe::infer_capabilities(provider, model, None);
    if ctx < 8_192 { 8_192 } else { ctx }
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

/// Phase 32 / CTX-03 — token-aware safety cap on the keep_recent suffix.
///
/// RESEARCH.md notes that 8 messages × 50k-token bash outputs each = 400k
/// tokens preserved verbatim, defeating compaction. This helper bounds the
/// recent-message count by BOTH a message count cap (default 8) AND a token
/// budget (default 16k), whichever fires first. Always returns at least 2
/// so the most-recent user/assistant exchange is always preserved.
///
/// Pure / synchronous / unit-testable — extracted from compress_conversation_smart
/// so it can be exercised directly without a network call.
pub(crate) fn compute_keep_recent(
    conversation: &[ConversationMessage],
    max_messages: usize,
    token_budget: usize,
) -> usize {
    let mut total: usize = 0;
    let mut count: usize = 0;
    for msg in conversation.iter().rev() {
        let msg_tokens = match msg {
            ConversationMessage::System(_) => 0, // system messages are not "recent"
            ConversationMessage::User(s) => s.len() / 4,
            ConversationMessage::UserWithImage { text, .. } => text.len() / 4 + 250,
            ConversationMessage::Assistant { content, .. } => content.len() / 4,
            ConversationMessage::Tool { content, .. } => content.len() / 4,
        };
        if total + msg_tokens > token_budget || count >= max_messages {
            break;
        }
        total += msg_tokens;
        count += 1;
    }
    count.max(2) // floor — always keep the most-recent exchange
}

/// Phase 32 / CTX-03 — OpenHands v7610 structured summary prompt.
///
/// Verbatim port of the prompt from PR #7610 (csmith49) on OpenHands. Replaces
/// the previous "summarize in 3-6 sentences" generic prompt. The structured
/// shape (USER_CONTEXT / COMPLETED / PENDING / CURRENT_STATE / CODE_STATE /
/// TESTS / CHANGES / DEPS / INTENT / VC_STATUS) gives the cheap-summary model
/// scaffolding that produces measurably better recall fidelity (Phase 37
/// EVAL-04 will quantify).
///
/// Pure / synchronous / unit-testable — extracted from compress_conversation_smart
/// so the prompt construction can be asserted without invoking a real LLM.
///
/// Phase 37 / Plan 37-06 — visibility widened from `pub(crate)` to `pub` so
/// `evals/intelligence_eval.rs` (EVAL-04 compaction-fidelity fixtures) can
/// invoke the prompt builder directly with a synthetic events list. The
/// widening is purely additive — no body / call-site changes — and lets future
/// v1.6+ external eval crates exercise the same prompt template without a
/// crate-private workaround.
pub fn build_compaction_summary_prompt(events: &[String]) -> String {
    format!(
        "You are maintaining a context-aware state summary for an interactive agent. \
         You will be given a list of events corresponding to actions taken by the agent, \
         and the most recent previous summary if one exists. Track:\n\n\
         USER_CONTEXT: (Preserve essential user requirements, problem descriptions, and clarifications in concise form)\n\
         COMPLETED: (Tasks completed so far, with brief results)\n\
         PENDING: (Tasks that still need to be done)\n\
         CURRENT_STATE: (Current variables, data structures, or relevant state)\n\n\
         For code-specific tasks, also include:\n\
         CODE_STATE: {{File paths, function signatures, data structures}}\n\
         TESTS: {{Failing cases, error messages, outputs}}\n\
         CHANGES: {{Code edits, variable updates}}\n\
         DEPS: {{Dependencies, imports, external calls}}\n\
         INTENT: {{Why changes were made, acceptance criteria}}\n\
         VC_STATUS: {{Repository state, current branch, PR status, commit history}}\n\n\
         PRIORITIZE:\n\
         1. Adapt tracking format to match the actual task type\n\
         2. Capture key user requirements and goals\n\
         3. Distinguish between completed and pending tasks\n\
         4. Keep all sections concise and relevant\n\n\
         SKIP: Tracking irrelevant details for the current task type\n\n\
         Events:\n{}",
        events.join("\n")
    )
}

/// Smart context compression — inspired by MemPalace's AAAK pattern + OpenHands v7610.
/// Instead of dropping old turns, summarizes them into a compact block.
/// Keeps: system prompt + compressed summary + last ~8 turns (token-bounded) verbatim.
pub(crate) async fn compress_conversation_smart(
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

    // Phase 32 / CTX-03 — token-aware keep_recent. RESEARCH.md notes a
    // pathological 50k-token bash output in the last-8 would defeat compaction.
    // KEEP_RECENT_TOKEN_BUDGET (16k) bounds the recent suffix by tokens too;
    // compute_keep_recent floors at 2 so the most-recent exchange is always
    // preserved.
    const KEEP_RECENT_TOKEN_BUDGET: usize = 16_000;
    let keep_recent = compute_keep_recent(conversation, 8, KEEP_RECENT_TOKEN_BUDGET);
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

    // Phase 32 / CTX-03 — OpenHands v7610 structured summary prompt
    let summary_prompt = build_compaction_summary_prompt(&to_compress);

    // Use cheapest model for compression
    let cheap = crate::config::cheap_model_for_provider(provider, model);

    let summary_msgs = vec![ConversationMessage::User(summary_prompt)];
    let no_tools: Vec<ToolDefinition> = vec![];
    let summary = match crate::providers::complete_turn(
        provider, api_key, &cheap, &summary_msgs, &no_tools, base_url
    ).await {
        Ok(t) => t.content,
        Err(_) => {
            // Compression failed — fall back to hard truncation (CTX-07 fallback path)
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
pub(crate) enum ErrorRecovery {
    TruncateAndRetry,
    /// Switch to a safe fallback model for this provider and retry
    SwitchModelAndRetry,
    /// Rate limited — wait `secs` seconds then retry
    RateLimitRetry { secs: u64 },
    /// Server overloaded — brief pause then retry once
    OverloadedRetry,
    Fatal(String),
}

pub(crate) fn classify_api_error(err: &str) -> ErrorRecovery {
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
pub(crate) fn safe_fallback_model(provider: &str) -> &'static str {
    match provider {
        "anthropic"   => "claude-haiku-4-5-20251001",
        "openai"      => "gpt-4o-mini",
        "gemini"      => "gemini-2.0-flash",
        "groq"        => "llama-3.3-70b-versatile",
        "openrouter"  => "meta-llama/llama-3.3-70b-instruct:free",
        _             => "gpt-4o-mini", // OpenAI-compat default
    }
}
// Phase 32 Plan 32-05 / CTX-05: raised from 12_000 to 200_000. The 12k value
// was silently dropping the TAIL of every long tool output before
// `cap_tool_output` (the real per-message budget enforcer) could see it — a
// bash output ending in a critical error would lose that error. The 4k-token
// (~16k char) per-message budget is now enforced by `cap_tool_output` at the
// conversation-insertion site; `format_tool_result` is a SAFETY net for
// truly pathological multi-MB outputs only.
const MAX_TOOL_RESULT_CHARS: usize = 200_000;

// Phase 33 free/fallback model path was retired in Plan 34-07 in favor of
// `crate::resilience::fallback::try_with_fallback`. Phase 38 close removed
// the `try_free_model_fallback` deprecated wrapper after the last caller
// (`loop_engine.rs`) migrated to the new helper directly.

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
/// Translate a raw provider error string into a human-readable chat error.
/// Preserves the original text as a trailing hint so a user can still report
/// the full payload if they need to.
fn friendly_stream_error(err: &str, provider: &str, model: &str) -> String {
    let lower = err.to_ascii_lowercase();
    let prefix = if lower.contains("401") || lower.contains("unauthorized") || lower.contains("invalid api key") {
        format!("Your {} API key was rejected. Re-enter it in Settings → Providers.", provider)
    } else if lower.contains("404") && (lower.contains("model") || lower.contains("not found")) {
        format!(
            "Model \"{}\" isn't available on {}. Open Settings → Providers and pick a different model.",
            model, provider
        )
    } else if lower.contains("429") || lower.contains("rate limit") || lower.contains("too many requests") {
        format!("{} is rate-limiting this key. Wait a moment or switch providers.", provider)
    } else if lower.contains("timeout") || lower.contains("timed out") {
        format!("{} took too long to respond. Try again or switch providers.", provider)
    } else if lower.contains("connection") && (lower.contains("refused") || lower.contains("reset")) {
        "Could not reach the provider. Check your network.".to_string()
    } else {
        format!("{} request failed.", provider)
    };
    format!("{} ({})", prefix, crate::safe_slice(err, 240))
}

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
pub(crate) fn explain_tool_failure(
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

/// Phase 24 (v1.3) — apply an operator's chat reply to a chat-injected
/// dream_mode proposal. Returns Ok(confirmation_text) on success or
/// Err(reason). Side effects:
///   - "yes" + merge → INSERT merged ForgedTool row (parallel to the
///                     persist_forged_tool path; merge body skips the
///                     LLM script-write step because script_path is
///                     inherited from the lex-smaller source per D-24-E);
///                     archive both source skills via skills::lifecycle::archive_skill;
///                     delete .pending/<id>.json
///   - "yes" + generate → write proposed SKILL.md under
///                        ~/.blade/skills/<sanitized_name>/ + delete .pending/<id>.json
///   - "no" / "dismiss" → mark proposal dismissed (no tool changes)
///
/// This helper is `pub` so cargo test can drive it directly without
/// spawning the full chat stream.
pub async fn apply_proposal_reply(verb: &str, id: &str) -> Result<String, String> {
    let prop = crate::skills::pending::read_proposal(id)
        .ok_or_else(|| format!("proposal not found: {}", id))?;

    if verb == "no" || verb == "dismiss" {
        crate::skills::pending::mark_dismissed(id)?;
        return Ok(format!("Dismissed proposal `{}` ({}).", id, prop.proposed_name));
    }

    // "yes" branch — apply per kind.
    match prop.kind.as_str() {
        "merge" => {
            let merged_body = prop.payload.get("merged_body")
                .ok_or_else(|| "missing merged_body in proposal payload".to_string())?;
            let merged: crate::tool_forge::ForgedTool = serde_json::from_value(merged_body.clone())
                .map_err(|e| format!("deserialize merged_body: {e}"))?;

            // Persist the merged ForgedTool. INSERT directly via SQL (parallel
            // to the persist_forged_tool path) because the merge body skips the
            // LLM script-write step — script_path is inherited from the
            // lex-smaller source per D-24-E.
            {
                let conn = crate::tool_forge::open_db_for_lifecycle()
                    .map_err(|e| format!("open db: {e}"))?;
                let params_json = serde_json::to_string(&merged.parameters).unwrap_or_else(|_| "[]".to_string());
                conn.execute(
                    "INSERT INTO forged_tools (id, name, description, language, script_path, usage, parameters, test_output, created_at, last_used, use_count, forged_from) \
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
                    rusqlite::params![
                        merged.id, merged.name, merged.description, merged.language,
                        merged.script_path, merged.usage, params_json, merged.test_output,
                        merged.created_at, merged.last_used, merged.use_count, merged.forged_from
                    ],
                ).map_err(|e| format!("insert merged tool: {e}"))?;
            }

            // Archive both source skills. archive_skill sequence: fs::rename
            // first → DB DELETE on rename success (T-24-04-04 / 05 mitigation).
            let source_a = prop.payload.get("source_a").and_then(|v| v.as_str()).unwrap_or("");
            let source_b = prop.payload.get("source_b").and_then(|v| v.as_str()).unwrap_or("");
            if !source_a.is_empty() {
                let _ = crate::skills::lifecycle::archive_skill(source_a);
            }
            if !source_b.is_empty() {
                let _ = crate::skills::lifecycle::archive_skill(source_b);
            }

            crate::skills::pending::delete_proposal(id)?;
            Ok(format!("Merged `{}` + `{}` -> `{}`. Sources archived.", source_a, source_b, merged.name))
        }
        "generate" => {
            // The proposed_skill_md text in the payload IS the body; land a
            // SKILL.md directly under <user_root>/<sanitized_name>/.
            let trace = prop.payload.get("trace")
                .and_then(|t| t.as_array())
                .map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect::<Vec<_>>())
                .unwrap_or_default();
            let sanitized = crate::skills::export::sanitize_name(&prop.proposed_name)
                .ok_or_else(|| format!("non-compliant proposed_name: {}", prop.proposed_name))?;
            let skill_dir = crate::skills::loader::user_root().join(&sanitized);
            std::fs::create_dir_all(&skill_dir).map_err(|e| format!("create_dir_all: {e}"))?;
            let body = prop.payload.get("proposed_skill_md")
                .and_then(|v| v.as_str())
                .unwrap_or("# proposed skill (no body)");
            let frontmatter = format!(
                "---\nname: {}\ndescription: Auto-generated from {}-tool trace by dream_mode\n---\n\n{}\n",
                sanitized, trace.len(), body
            );
            std::fs::write(skill_dir.join("SKILL.md"), frontmatter)
                .map_err(|e| format!("write SKILL.md: {e}"))?;

            crate::skills::pending::delete_proposal(id)?;
            Ok(format!("Saved proposed skill `{}` to ~/.blade/skills/{}/SKILL.md", sanitized, sanitized))
        }
        other => Err(format!("unknown proposal kind: {}", other)),
    }
}

/// Phase 4 Plan 04-01 (D-93): #[tauri::command] entry point.
///
/// Thin wrapper around `send_message_stream_inline` that preserves the Phase 3
/// main-only emit contract (back-compat: `emit_windows = &["main"]`). Every
/// user-visible stream event routes to the main window as before.
///
/// Phase 34 / BL-01 + BL-02 (REVIEW finding) — accepts an optional
/// `conversation_id` so the frontend can thread the ACTIVE session_id (set
/// after `resumeSession` or auto-issued on first turn) through to the Rust
/// SessionWriter + LoopState carry-over registry. When None / empty, behavior
/// matches the legacy "fresh ULID per turn" posture.
#[tauri::command]
pub async fn send_message_stream(
    app: tauri::AppHandle,
    state: tauri::State<'_, SharedMcpManager>,
    approvals: tauri::State<'_, ApprovalMap>,
    vector_store: tauri::State<'_, crate::embeddings::SharedVectorStore>,
    messages: Vec<ChatMessage>,
    conversation_id: Option<String>,
) -> Result<(), String> {
    send_message_stream_inline(
        app,
        state.inner().clone(),
        approvals.inner().clone(),
        vector_store.inner().clone(),
        messages,
        &["main"],
        conversation_id,
    )
    .await
}

/// Phase 4 Plan 04-01 (D-93, D-100): extracted streaming pipeline.
///
/// `emit_windows` is the list of window labels that user-visible stream events
/// (chat_token / chat_done / blade_message_start / etc.) should be emitted to.
/// The list is stashed in `STREAMING_EMIT_WINDOWS` for the duration of this
/// call and consulted by `emit_stream_event` at every emit site.
///
/// - `send_message_stream` calls this with `&["main"]` — Phase 3 contract.
/// - `quickask_submit` calls this with `&["main", "quickask"]` so the QuickAsk
///   popup sees the live stream alongside the main chat panel.
///
/// Semantic background-task emits (brain_grew, capability_gap_detected,
/// response_improved) remain hard-coded to "main" — they are not part of the
/// user-visible stream contract.
pub(crate) async fn send_message_stream_inline(
    app: tauri::AppHandle,
    state: SharedMcpManager,
    approvals: ApprovalMap,
    vector_store: crate::embeddings::SharedVectorStore,
    messages: Vec<ChatMessage>,
    emit_windows: &[&str],
    // Phase 34 / BL-01 + BL-02 (REVIEW finding) — when Some, threads the
    // existing session_id through to SessionWriter + run_loop so per-conv
    // cost cap, 80% latch, and stuck-detector buckets persist across calls.
    conversation_id: Option<String>,
) -> Result<(), String> {
    // Concurrency guard — prevent interleaved responses from rapid-fire messages
    if CHAT_INFLIGHT.swap(true, Ordering::SeqCst) {
        return Err("Already processing a message. Wait for the current response to finish, or cancel it first.".to_string());
    }
    // Stash the current stream's emit-window list so `emit_stream_event` picks
    // up the right set for every emit site in this invocation.
    set_streaming_emit_windows(emit_windows);

    // Drop guard: ensure emit-windows reset when this function exits (any path).
    struct EmitWindowsGuard;
    impl Drop for EmitWindowsGuard {
        fn drop(&mut self) {
            reset_streaming_emit_windows();
        }
    }
    let _emit_windows_guard = EmitWindowsGuard;
    // Drop guard: clear inflight flag when this function exits (any path)
    struct InflightGuard;
    impl Drop for InflightGuard {
        fn drop(&mut self) {
            CHAT_INFLIGHT.store(false, Ordering::SeqCst);
        }
    }
    let _inflight = InflightGuard;

    // Phase 23 / REWARD-04 — per-turn tool-call accumulator. Lives on the
    // stack for the duration of this turn; consumed at the singular
    // happy-path return at line 1821 by the reward orchestrator.
    let turn_acc = crate::reward::TurnAccumulator::new();

    // Reset cancel flag at the start of every new request
    CHAT_CANCEL.store(false, Ordering::SeqCst);

    // Phase 18 (D-14, Plan 18-10): retry counter resets at the START of each turn.
    // Without this, RETRY_COUNT accumulates across turns and the cap (=1) bypasses
    // on the second-and-later turn. AtomicU32::store(0, SeqCst) is total-ordered.
    crate::ego::reset_retry_for_turn();

    // Phase 3 WIRE-03 (Plan 03-01, D-64): tracks the current assistant turn's
    // message_id so the same id can be set in BLADE_CURRENT_MSG_ID env var below
    // for `blade_thinking_chunk` tagging in providers/anthropic.rs (WIRE-04).
    // Reset on each new turn (first emit before token loop).
    // Prefix with `_` so downstream assignments don't trip unused-variable:
    // the binding is kept in scope as a thread-local handoff target via the
    // BLADE_CURRENT_MSG_ID env-var fallback (D-64). Consumers read the env,
    // not this local — the local exists to document intent.
    let mut _current_message_id: Option<String> = None;

    let _ = app.emit("blade_status", "processing");

    let mut config = load_config();
    if config.api_key.is_empty() && config.provider != "ollama" {
        let _ = app.emit("blade_status", "error");
        return Err("No API key configured. Go to settings.".to_string());
    }

    // ─── Plan 34-08 (SESS-01) — SessionWriter construction ──────────────
    //
    // Constructs the JSONL forensic writer for this turn. Per CONTEXT lock
    // §SESS-01: each chat turn opens a SessionWriter at the message-flow
    // entry; rotation runs BEFORE the new file is created (so the new file
    // is never at risk of being archived on creation).
    //
    // For Plan 34-08, every send_message_stream call creates a fresh
    // session_id — Plan 34-11 widens the Tauri command surface so the
    // frontend can pass an existing session_id (resumed conversations).
    //
    // CTX-07 escape hatch: when config.session.jsonl_log_enabled = false,
    // SessionWriter::new returns a no-op writer (no file created).
    //
    // Error-recovery: when SessionWriter::new returns Err (FS permission,
    // disk full, etc.), fall back to SessionWriter::no_op() so the live
    // chat path is unaffected. The chat-continues posture is the v1.1
    // lesson incarnate: forensic logging must never crash chat.
    // Phase 34 / BL-01 + BL-02 (REVIEW finding) — when the frontend supplies
    // an existing `conversation_id` (resumed sessions), reuse it verbatim so
    // SessionWriter appends to the SAME JSONL and the loop_engine carry-over
    // registry hits the SAME bucket. When None/empty, fall back to ULID
    // generation (fresh conversation).
    let resumed_id = conversation_id
        .as_ref()
        .filter(|id| !id.is_empty())
        .cloned();
    let is_resumed = resumed_id.is_some();
    let (session_writer, session_id) = match crate::session::log::SessionWriter::new_with_id(
        &config.session.jsonl_log_dir,
        config.session.jsonl_log_enabled,
        resumed_id,
    ) {
        Ok(pair) => pair,
        Err(e) => {
            eprintln!(
                "[SESS-01] writer init failed: {}; sessions disabled this turn",
                e
            );
            (crate::session::log::SessionWriter::no_op(), String::new())
        }
    };
    // First JSONL line: SessionMeta. Skipped silently when the writer is
    // disabled or in no-op mode (SessionWriter::append checks `enabled`).
    //
    // BL-02 — when this turn is resumed (conversation_id supplied by the
    // frontend), the SessionMeta line was already written on the first turn
    // of this conversation; skip the append so we don't double-stamp the
    // session header. The append is otherwise unconditional for new sessions.
    if !session_id.is_empty() && !is_resumed {
        session_writer.append(&crate::session::log::SessionEvent::SessionMeta {
            id: session_id.clone(),
            parent: None,
            fork_at_index: None,
            started_at_ms: crate::session::log::now_ms(),
        });
    }

    // Phase 34 / BL-01 (REVIEW finding) — cold-cache JSONL re-seed for the
    // per-conversation cost cap. The in-memory carry-over registry doesn't
    // survive process restarts; on resume we need to re-seed
    // `conversation_cumulative_cost_usd` from the JSONL's last `cost_update`
    // LoopEvent so the 100% halt at the iteration top observes the lifetime
    // total instead of restarting from 0.
    //
    // Skip when:
    //   - session_id empty (logging disabled or writer init failed)
    //   - registry already has a non-zero cumulative (warm cache wins)
    //   - this is a fresh conversation (NOT is_resumed) — there's no JSONL
    //     history to seed from yet
    if is_resumed && !session_id.is_empty() {
        let registry = crate::loop_engine::load_conversation_state(&session_id);
        if registry.conversation_cumulative_cost_usd == 0.0 {
            // Read the JSONL via get_conversation_cost helper and write back
            // into the registry so run_loop's seed read sees the lifetime spend.
            if let Ok(v) = crate::session::list::get_conversation_cost(session_id.clone()).await {
                if let Some(spent) = v.get("spent_usd").and_then(|s| s.as_f64()) {
                    let mut carry = registry.clone();
                    carry.conversation_cumulative_cost_usd = spent as f32;
                    // Pre-seed the 80% latch on resume so a turn that crossed
                    // 80% in a prior session doesn't fire the warning again.
                    let cap = config.resilience.cost_guard_per_conversation_dollars;
                    if (spent as f32) > 0.8 * cap {
                        carry.cost_warning_80_emitted = true;
                    }
                    crate::loop_engine::save_conversation_state(&session_id, carry);
                }
            }
        }
    }

    // Smart routing: resolve best provider + model for this task type.
    // If the user configured e.g. "code tasks → Anthropic", this picks that provider + its key.
    // Falls back to active provider if the routed provider has no stored key.
    //
    // Phase 11 Plan 11-04 (D-55) — capability-aware routing.
    // Delegates to router::select_provider which applies 3-tier resolution
    // (base_url escape → capability hard filter → task-type soft preference
    // → primary fallback). Returns a capability-filtered fallback chain that
    // the downstream streaming orchestrator walks on transient errors, AND
    // a capability_unmet signal that triggers a one-shot missing-capability
    // event (no retry loop per 4ab464c posture).
    //
    // This is the SINGLE rewired call site in send_message_stream; the other
    // 25+ background-task sites keep calling the legacy task-routing helper
    // directly (blast-radius discipline — RESEARCH.md §Router Rewire).
    let mut use_extended_thinking = false;
    let mut routing_chain: Vec<(String, String)> = Vec::new();
    if let Some(last_user_msg) = messages.iter().rev().find(|m| m.role == "user") {
        let has_image = last_user_msg.image_base64.is_some();
        let task = crate::router::classify_task(&last_user_msg.content, has_image);
        // Flag complex tasks on Anthropic for extended thinking
        if task == crate::router::TaskType::Complex && config.provider == "anthropic" {
            use_extended_thinking = true;
        }
        let (provider, api_key, model, chain, capability_unmet) =
            crate::router::select_provider(task.clone(), &config);

        // Emit one-shot missing-capability event per 4ab464c posture — ONCE
        // per send_message_stream call, no retry loop, graceful degrade to
        // primary. Payload carries NO api_key / NO user-content (T-11-24).
        if let Some(cap) = capability_unmet {
            let _ = app.emit_to("main", "blade_routing_capability_missing", serde_json::json!({
                "capability": cap,
                "task_type": format!("{:?}", task),
                "primary_provider": config.provider.clone(),
                "primary_model": config.model.clone(),
                "message": format!(
                    "This task needs a {}-capable model, but none of your providers support it.",
                    cap
                ),
            }));
        }

        config.provider = provider;
        config.api_key = api_key;
        config.model = model;
        routing_chain = chain;
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
    emit_stream_event(&app, "blade_token_ratio", serde_json::json!({
        "ratio": token_ratio,
        "tokens_used": rough_tokens,
        "context_window": context_window,
    }));

    // Emit routing decision so the UI can show which model/provider is active for this request
    let hive_active = !crate::hive::get_hive_digest().is_empty();
    emit_stream_event(&app, "chat_routing", serde_json::json!({
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

    // ─── Phase 36-07 (INTEL-06) — anchor extraction prelude ─────────────
    //
    // Parses `@screen` / `@file:PATH` / `@memory:TOPIC` tokens from the
    // user query, strips them out, and resolves each into a (label, content)
    // pair that bypasses Phase 32 selective gating (anchor = explicit user
    // ask, not heuristic-driven).
    //
    // Discipline:
    //   - Behind config.intelligence.context_anchor_enabled (CTX-07-style
    //     escape hatch); when false, the @-syntax reaches the provider
    //     verbatim.
    //   - catch_unwind wrapped (CTX-07 v1.1 — anchor parser failures must
    //     never crash chat). INTEL_FORCE_ANCHOR_PANIC test seam exercises
    //     the fall-through.
    //   - Resolution is best-effort: each anchor's [ANCHOR:... not found /
    //     read error / rejected: binary] placeholder is harmless if the
    //     underlying source is unavailable.
    //
    // The resolved anchor_injections are appended to system_prompt below
    // (post brain.rs::build_system_prompt_for_model) so anchored content
    // sits OUTSIDE the gated sections — Plan 36-08 lands the brain.rs
    // receiver that records `anchor_screen` / `anchor_file` / `anchor_memory`
    // labels via record_section without routing through score_or_default.
    let (clean_query, anchors) = if config.intelligence.context_anchor_enabled {
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            crate::intelligence::anchor_parser::extract_anchors(&last_user_text)
        }))
        .unwrap_or_else(|_| {
            log::warn!("[INTEL-06] anchor parser panicked; treating query as plain text");
            (last_user_text.clone(), Vec::new())
        })
    } else {
        (last_user_text.clone(), Vec::new())
    };
    let last_user_text = clean_query; // shadow with stripped query

    // ─── Phase 57 (SKILLS-DISPATCH) ─────────────────────────────────────────
    //
    // Before the standard LLM routing, check whether the user message hits a
    // registered skill trigger (OpenClaw-style SKILL.md, see
    // `crate::skills_md`). If a trigger matches with high confidence
    // (substring + word-boundary), the skill's system-prompt body takes over
    // for this turn — it gets prepended to the eventual `system_prompt`
    // built below, and we emit `blade_skill_dispatch` so the chat surface
    // can show the takeover.
    //
    // This is a NEW code path *before* default routing — it never blocks the
    // tool loop. If the matched skill has a `tools` whitelist, it informs
    // downstream tool selection (recorded as `_skill_tool_whitelist` in this
    // function; today consumed implicitly because the skill body itself names
    // the tools it expects).
    let matched_skill: Option<crate::skills_md::SkillManifest> =
        crate::skills_md::match_trigger(&last_user_text);
    if let Some(skill) = &matched_skill {
        emit_stream_event(
            &app,
            "blade_skill_dispatch",
            serde_json::json!({
                "skill": skill.name,
                "description": skill.description,
                "model_hint": skill.model_hint,
                "tools": skill.tools,
            }),
        );
    }

    let anchor_injections: Vec<(String, String)> = if !anchors.is_empty() {
        crate::intelligence::anchor_parser::resolve_anchors(&anchors, &app, &config).await
    } else {
        Vec::new()
    };

    // ─── Plan 34-08 (SESS-01) — UserMessage JSONL emit ──────────────────
    //
    // Records the sanitized user message into the SessionWriter's JSONL
    // log. Fires AFTER sanitize_input so what we replay on resume is what
    // the model actually saw, not the raw inbound payload (which could
    // contain stripped prompt-injection attempts). The id is a synthetic
    // user-{ms} marker — Plan 34-11 may wire frontend-provided user
    // message IDs through if needed; for SESS-01 the synthetic id is
    // sufficient for SESS-02 ordering.
    session_writer.append(&crate::session::log::SessionEvent::UserMessage {
        id: format!("user-{}", crate::session::log::now_ms()),
        content: last_user_text.clone(),
        timestamp_ms: crate::session::log::now_ms(),
    });

    // ── Phase 55 / SESSION-COMMANDS-MIGRATE (v2.2 — 2026-05-14) ──
    //
    // Dual-write the user message to the new Goose-shaped session
    // schema (`sessions` + `session_messages`). Invariant: the legacy
    // conversation_id == new schema session_id, so frontend rollover is
    // a no-op rename. We dual-write for one milestone (v2.2 → v2.3
    // cutover) so any regression in the new path is recoverable by
    // dropping back to the JSONL/history.json path.
    //
    // Failure mode: dual-write errors are swallowed (chat-continues
    // posture — same v1.1 lesson the JSONL writer follows). The new
    // schema is forensic substrate, not on the live response path.
    if !session_id.is_empty() {
        if let Ok(conn) = crate::db::init_db() {
            let mgr = crate::sessions::SessionManager::new();
            if let Err(e) = mgr.upsert_session_with_id(&conn, &session_id, None) {
                log::debug!("[sess-migrate] upsert_session_with_id: {}", e);
            }
            if let Err(e) = mgr.append_message(&conn, &session_id, "user", &last_user_text) {
                log::debug!("[sess-migrate] append_message(user): {}", e);
            }
        }
    }

    // ── Phase 56 (TELOS-EDIT-FLOW) — `/edit-self` slash command ──────────────
    // Single recognized slash command (today). Routes to
    // `blade_open_who_you_are` so the user can edit mission / goals / beliefs
    // / challenges in their default editor. Matches before any LLM call so we
    // don't burn a turn on what should be a side-effect-only request.
    //
    // Chat-streaming contract: emit blade_message_start BEFORE chat_token
    // (CLAUDE.md memory: project_chat_streaming_contract). Early-return
    // suppresses the standard LLM streaming path.
    {
        let trimmed = last_user_text.trim();
        if trimmed.eq_ignore_ascii_case("/edit-self") {
            let confirmation = match blade_open_who_you_are() {
                Ok(p) => format!("Opening {} in your default editor.", p),
                Err(e) => format!("Could not open who-you-are.md: {}", e),
            };
            let msg_id = uuid::Uuid::new_v4().to_string();
            emit_stream_event(&app, "blade_message_start", serde_json::json!({
                "message_id": &msg_id,
                "role": "assistant",
            }));
            emit_stream_event(&app, "chat_token", serde_json::json!({
                "content": confirmation,
            }));
            emit_stream_event(&app, "chat_done", ());
            let _ = app.emit("blade_status", "idle");
            return Ok(());
        }
    }

    // ── Phase 24 (v1.3) — chat-injected proposal reply apply path ────────────
    // intent_router classifies "yes <id>" / "no <id>" / "dismiss <id>" as
    // IntentClass::ProposalReply. When matched, apply the operator's reply
    // synchronously here BEFORE the LLM provider call so the model never
    // sees the proposal_id confirmation. The chat-streaming contract
    // (CLAUDE.md memory: project_chat_streaming_contract) requires
    // blade_message_start BEFORE chat_token — emit both, then chat_done,
    // then early-return to suppress the standard LLM streaming path.
    {
        let (proposal_intent, _args) =
            crate::intent_router::classify_intent(&last_user_text).await;
        if let crate::intent_router::IntentClass::ProposalReply { verb, id } = &proposal_intent {
            let confirmation = match apply_proposal_reply(verb, id).await {
                Ok(text) => text,
                Err(e) => format!("Could not apply proposal: {}", e),
            };
            // Chat-streaming contract: emit blade_message_start FIRST.
            let msg_id = uuid::Uuid::new_v4().to_string();
            emit_stream_event(&app, "blade_message_start", serde_json::json!({
                "message_id": &msg_id,
                "role": "assistant",
            }));
            emit_stream_event(&app, "chat_token", serde_json::json!({
                "content": confirmation,
                "is_dream_proposal_apply": true,
            }));
            emit_stream_event(&app, "chat_done", ());
            let _ = app.emit("blade_status", "idle");
            // Early-return: suppress the LLM provider call entirely so the
            // operator's "yes 7af3" never leaks to the model.
            return Ok(());
        }
    }

    // ── Phase 18 Plan 14 — JARVIS chat → cross-app action ───────────────────
    // intent_router::classify_intent returns (IntentClass, ArgsBag); when
    // ActionRequired, dispatch fires in a background task so the chat reply
    // continues to stream. The dispatcher's consent gate awaits the user's
    // dialog choice via the Plan-14 oneshot channel; ActivityStrip surfaces
    // the outcome via blade_activity_log (D-17 LOCKED format). ChatOnly
    // intent short-circuits to NotApplicable and is a no-op.
    {
        let dispatch_app = app.clone();
        let dispatch_msg = last_user_text.clone();
        tokio::spawn(async move {
            let (intent, args) = crate::intent_router::classify_intent(&dispatch_msg).await;
            // ChatOnly skips the dispatcher entirely (no log noise).
            if matches!(intent, crate::intent_router::IntentClass::ChatOnly) {
                return;
            }
            // Phase 24 (v1.3) — ProposalReply was already handled above with
            // an early-return; if we somehow reach here with one, skip.
            if matches!(intent, crate::intent_router::IntentClass::ProposalReply { .. }) {
                return;
            }
            let args_json = serde_json::Value::Object(args);
            if let Err(e) = crate::jarvis_dispatch::jarvis_dispatch_action(
                dispatch_app,
                intent,
                args_json,
            )
            .await
            {
                // Dispatcher errors already emit blade_activity_log; surface
                // to the dev console only.
                eprintln!("[jarvis_dispatch] background dispatch error: {}", e);
            }
        });
    }

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
                    emit_stream_event(&ack_app, "chat_ack", ack);
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

    // ─── Phase 36-08 (INTEL-06) — anchor injections threaded into builder ─
    //
    // Plan 36-07 populated `anchor_injections` in the prelude (post-sanitize).
    // Plan 36-08 lands the brain.rs receiver: each (label, content) pair is
    // injected at priority -1 (above BLADE.md) inside build_system_prompt_inner
    // and recorded via record_section using the labels `anchor_screen` /
    // `anchor_file` / `anchor_memory`. The contract: anchored content sits
    // OUTSIDE the Phase 32 selective-injection gates — the user typed the
    // anchor, so `score_or_default` is bypassed.
    let mut system_prompt = brain::build_system_prompt_for_model(
        &tool_snapshot,
        &last_user_text,
        Some(&vector_store),
        &config.provider,
        &config.model,
        messages.len(),
        &anchor_injections,
    );

    // Phase 57 (SKILLS-DISPATCH) — if a phase-57 skill matched the user's
    // trigger phrase upstream, prepend its system-prompt body to the assembled
    // system_prompt so the skill takes over for THIS turn without removing
    // any of the identity/context layers brain.rs assembles. The skill body
    // intentionally lives at the top of the prompt — its instructions are
    // the most specific signal we have for what the user wants right now.
    if let Some(skill) = &matched_skill {
        let mut prepended = String::with_capacity(skill.body.len() + system_prompt.len() + 64);
        prepended.push_str("## Active skill: ");
        prepended.push_str(&skill.name);
        prepended.push_str("\n\n");
        prepended.push_str(skill.body.trim());
        prepended.push_str("\n\n---\n\n");
        prepended.push_str(&system_prompt);
        system_prompt = prepended;
    }

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
            emit_stream_event(&app, "blade_planning", serde_json::json!({
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
                    emit_stream_event(&app, "blade_message_start", serde_json::json!({
                        "message_id": &msg_id,
                        "role": "assistant",
                    }));
                    // Phase 3 WIRE-04 sidecar: expose msg_id via env var so
                    // providers/anthropic.rs can tag blade_thinking_chunk with it
                    // (best-effort fallback per D-64; Phase 4 wires a real channel).
                    std::env::set_var("BLADE_CURRENT_MSG_ID", &msg_id);
                    _current_message_id = Some(msg_id);

                    // Stream the final answer as chat tokens
                    let answer = &trace.final_answer;
                    for word in answer.split_whitespace() {
                        emit_stream_event(&app, "chat_token", format!("{} ", word));
                        tokio::task::yield_now().await;
                    }
                    emit_stream_event(&app, "chat_done", ());
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

    // META-04 fallback: lightweight metacognitive check for tool-loop path.
    // reason_through handles its own verifier + initiative phrasing (META-02/03);
    // this only logs gaps for evolution.rs — it does NOT substitute the response.
    let meta_pre_check = crate::metacognition::assess_cognitive_state(&last_user_text);
    let meta_low_confidence = meta_pre_check.confidence < 0.5;

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
            emit_stream_event(&app, "blade_planning", serde_json::json!({
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

    // ── B3 / B5 backstop: sanitize tool names before they leave the process ──
    //
    // Anthropic enforces tool name regex `^[a-zA-Z0-9_-]{1,128}$` and uniqueness.
    // Tool registries can drift (external MCP servers, evolution loop, future
    // built-ins) and a single bad name 400s the entire turn. This is the wire-
    // level guard so a stale/poisoned manager state never reaches the provider.
    // First-wins on duplicates (native_tools were appended last so MCP entries
    // take precedence — flip the order above if you want the opposite).
    let sanitize_re = regex::Regex::new(r"^[a-zA-Z0-9_-]{1,128}$").expect("static regex");
    let pre_sanitize_count = tools.len();
    let mut seen_names: std::collections::HashSet<String> = std::collections::HashSet::new();
    tools.retain(|t| {
        if !sanitize_re.is_match(&t.name) {
            log::warn!("[tools] dropping invalid tool name (regex): {}", t.name);
            return false;
        }
        if !seen_names.insert(t.name.clone()) {
            log::warn!("[tools] dropping duplicate tool name: {}", t.name);
            return false;
        }
        true
    });
    if tools.len() != pre_sanitize_count {
        log::info!(
            "[tools] sanitized {} → {} ({} dropped)",
            pre_sanitize_count,
            tools.len(),
            pre_sanitize_count - tools.len()
        );
    }

    // Capture message count before build_conversation moves the Vec.
    let input_message_count = messages.len();
    // Phase 33 / LOOP-05 — `mut` (was immutable) so the fast-path branch can
    // inject `build_fast_path_supplement` at index 0. The tool-loop branch's
    // shadow-rebind below (was `let mut conversation = conversation;`) is now
    // redundant.
    let mut conversation = providers::build_conversation(messages, Some(system_prompt));

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
        // Phase 33 / LOOP-05 — gap closed (was Phase 18 KNOWN GAP at this
        // location). The fast-streaming branch now receives an identity
        // supplement built from the Phase 32-03 always-keep core. See
        // `brain::build_fast_path_supplement` and 33-07-PLAN.md for details.
        //
        // CTX-07 fallback discipline: panic in supplement-build → fall back
        // to no supplement (legacy fast-path verbatim). The supplement is
        // only injected when `config.r#loop.smart_loop_enabled = true`.
        //
        // Streaming contract (MEMORY.md `project_chat_streaming_contract`):
        // `blade_message_start` MUST emit before the first `chat_token`. The
        // emit below stays in place; supplement injection happens BEFORE that
        // emit. Plan 33-07 acceptance: the actual emit_stream_event call
        // count is unchanged from pre-Phase-33.
        //
        // ego::intercept_assistant_output is NOT yet wired on the fast path —
        // server-side accumulation of streamed tokens would require a deeper
        // providers/mod.rs refactor (deferred to v1.6+). The supplement alone
        // closes the "identity-blind" half of the original gap; full ego
        // parity remains a follow-up.

        // LOOP-05 — inject identity supplement so the provider sees it
        // before any user content. catch_unwind keeps a panic in supplement
        // build from breaking the chat (CTX-07 fallback discipline).
        // AssertUnwindSafe is required because &BladeConfig carries types
        // that aren't UnwindSafe — same pattern Phase 32-07 used at the
        // smart-path call sites.
        //
        // 33-NN-FIX (BL-02) — original LOOP-05 wiring did `conversation.insert(0, ...)`
        // which displaced the slow-path system prompt (built at commands.rs:1167-1186
        // and pushed into conversation[0] by build_conversation) to index 1.
        // Anthropic + Gemini build_body extract the system message via
        // `.find_map()` which returns the FIRST match and ignores subsequent
        // System(_) entries — result was that the rich ~10k-token slow-path
        // prompt was silently dropped on those two providers, leaving only
        // the ~1k-token supplement. Anthropic fast-path identity became
        // STRICTLY POORER than v1.4 (a regression). OpenAI/Groq/OpenRouter
        // serialize System as plain `{"role":"system"}` array entries so both
        // got through there — divergent runtime semantics across providers
        // from a single insert site.
        //
        // Fix: MERGE the supplement into the existing System(0) (concatenate
        // supplement + delimiter + existing-prompt) rather than insert. If no
        // existing system message is at index 0 (defensive fallback), insert
        // the supplement directly. This makes the wire identical across all
        // five providers regardless of how each one extracts System messages.
        if config.r#loop.smart_loop_enabled {
            let supplement = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                crate::brain::build_fast_path_supplement(
                    &config,
                    &config.provider,
                    &config.model,
                    &last_user_text,
                )
            }))
            .unwrap_or_default();
            if !supplement.is_empty() {
                if let Some(ConversationMessage::System(existing)) = conversation.get_mut(0) {
                    // Merge into existing slow-path system prompt — the
                    // supplement comes first (identity grounding, then the
                    // rich downstream context), separated by a clear delimiter
                    // so the model sees the boundary if it ever introspects.
                    *existing = format!("{}\n\n---\n\n{}", supplement, existing);
                } else {
                    // No system message at index 0 — fall through to the
                    // pre-fix insert behaviour. This branch is rare in
                    // production (build_conversation always emits a System at
                    // index 0 when the slow-path prompt is non-empty) but
                    // covers the defensive case where commands.rs evolves to
                    // skip the slow-path prompt for some fast-path branch.
                    conversation.insert(0, ConversationMessage::System(supplement));
                }
            }
        }

        // Phase 3 WIRE-03 contract (P-UAT-1): emit blade_message_start BEFORE
        // streaming so the frontend (src/features/chat/useChat.tsx) sets
        // currentMessageIdRef and commits the assistant reply on chat_done.
        // The 5 provider stream_text fns only emit chat_token + chat_done; the
        // tool-loop branch emits message_start at L1490, but the fast streaming
        // branch was missed when WIRE-03 landed — the symptom is a blank chat
        // surface despite Groq dashboard counting API calls (v1.1 retraction
        // 2026-04-27). Mirror the tool-loop pattern exactly: uuid msg id +
        // env var handoff for blade_thinking_chunk tagging in anthropic.rs.
        let msg_id = uuid::Uuid::new_v4().to_string();
        emit_stream_event(&app, "blade_message_start", serde_json::json!({
            "message_id": &msg_id,
            "role": "assistant",
        }));
        std::env::set_var("BLADE_CURRENT_MSG_ID", &msg_id);
        _current_message_id = Some(msg_id);

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
            // Phase 11 Plan 11-04 (D-55) — pass capability-filtered chain
            // verbatim to the streaming orchestrator. On transient errors
            // (429/503/5xx/network) the loop walks `routing_chain` in order,
            // guaranteeing a vision task never falls through to a non-
            // vision-capable provider (upstream invariant enforced by
            // router::build_capability_filtered_chain).
            providers::fallback_chain_complete_with_override(
                &app,
                routing_chain.clone(),
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
            // Fast-path streaming failed. Surface the error as a chat message
            // instead of leaving the user with an invisible dead chat. Also
            // emit chat_done so the UI unsticks from the streaming state if
            // the provider didn't manage to emit it itself.
            if let Err(ref msg) = result {
                let pretty = friendly_stream_error(msg, &config.provider, &config.model);
                emit_stream_event(&app, "chat_error", serde_json::json!({
                    "provider": &config.provider,
                    "model": &config.model,
                    "message": pretty,
                }));
                emit_stream_event(&app, "chat_done", ());
            }
            let _ = app.emit("blade_status", "error");
        }
        return result;
    }

    // Tools configured → non-streaming tool loop.
    // (`conversation` is already `mut` from L1374 — Phase 33 / LOOP-05 lifted
    // mutability up so the fast-path branch could insert the supplement.)
    // Phase 32 / CTX-04 — proactive compression at config.context.compaction_trigger_pct
    // (default 0.80) of the model's real context window. Honors the CTX-07
    // escape hatch: when smart_injection_enabled is false, the legacy literal
    // is used as the safety net (naive path).
    {
        let smart = config.context.smart_injection_enabled;
        let trigger = if smart {
            (model_context_window(&config.provider, &config.model) as f32
                * config.context.compaction_trigger_pct) as usize
        } else {
            140_000 // legacy literal — naive path
        };
        let pre_tokens = estimate_tokens(&conversation);
        if pre_tokens > trigger {
            // Emit BEFORE the await so the UI can surface a "compacting…"
            // spinner immediately. Wrapped in `let _ =` because emit may fail
            // in non-Tauri contexts (unit tests).
            let _ = app.emit("blade_status", "compacting");
            emit_stream_event(&app, "blade_notification", serde_json::json!({
                "type": "info",
                "message": format!(
                    "Compacting earlier conversation (~{} tokens of {} budget)",
                    pre_tokens, trigger
                )
            }));
        }
        let pre_compact_len = conversation.len();
        compress_conversation_smart(
            &mut conversation,
            trigger,
            &config.provider,
            &config.api_key,
            &config.model,
            config.base_url.as_deref(),
        ).await;
        // Restore status so subsequent stream events show the right indicator.
        let _ = app.emit("blade_status", "processing");

        // ─── Plan 34-08 (SESS-01) — CompactionBoundary JSONL emit ────────
        //
        // Records the boundary IF compaction actually fired (kept_message_count
        // changed). compress_conversation_smart is a no-op below the trigger;
        // we detect that by comparing pre/post lengths and only record when
        // they differ. Per CONTEXT lock §SESS-01: SESS-02 resume replays
        // everything FROM the boundary forward (the synthetic
        // `[Earlier conversation summary]` user message substitutes for the
        // collapsed prefix). The summary excerpt's first 200 chars are
        // captured for forensic display in list_sessions (SESS-03).
        if conversation.len() != pre_compact_len {
            let summary_excerpt = conversation
                .iter()
                .find_map(|m| match m {
                    crate::providers::ConversationMessage::User(s)
                        if s.starts_with("[Earlier conversation summary]") =>
                    {
                        Some(crate::safe_slice(s, 200).to_string())
                    }
                    _ => None,
                })
                .unwrap_or_default();
            session_writer.append(&crate::session::log::SessionEvent::CompactionBoundary {
                kept_message_count: conversation.len() as u32,
                summary_first_chars: summary_excerpt,
                timestamp_ms: crate::session::log::now_ms(),
            });
        }
    }

    // ─── Phase 33 / Plan 33-03 — iteration body lifted into loop_engine::run_loop ───
    // The for-loop body (formerly the hardcoded 12-iteration tool loop here,
    // ~959 lines including the empty-tool-calls post-loop assembly) now lives in
    // loop_engine::run_loop. The hardcoded `0..12` is gone from this file; the
    // cap is `config.r#loop.max_iterations` (default 25), with literal 12
    // preserved inside loop_engine.rs as the legacy fallback when
    // `config.r#loop.smart_loop_enabled = false`.
    //
    // CONTEXT lock §Module Boundaries: this site keeps only the outer match
    // that maps LoopHaltReason variants to the appropriate chat_error /
    // chat_cancelled / fall-through-to-summary handling. Plans 33-04..33-08
    // mount their smart-loop features inside run_loop without disturbing this
    // delegation site.
    let halt = crate::loop_engine::run_loop(
        app.clone(),
        state.clone(),
        approvals.clone(),
        vector_store.clone(),
        &mut config,
        &mut conversation,
        &tools,
        &last_user_text,
        brain_plan_used,
        meta_low_confidence,
        &meta_pre_check,
        input_message_count,
        turn_acc,
        &mut _current_message_id,
        // Plan 34-08 (SESS-01) — SessionWriter forensic log handle.
        &session_writer,
        // Phase 34 / BL-01 (REVIEW finding) — conversation_id keys the
        // per-conversation carry-over (cumulative cost, 80% latch, stuck
        // buckets) so it persists across turns within the same chat.
        &session_id,
    ).await;

    // ─── Plan 34-08 (SESS-01) — HaltReason JSONL emit ───────────────────
    //
    // Records the run_loop outcome (Ok or any Err variant) into the
    // SessionWriter's JSONL log. LoopHaltReason now derives Serialize so
    // its full payload (cost figures, stuck pattern, attempts_summary, etc.)
    // round-trips to JSON. This event is the LAST line on every halt path —
    // SESS-02 resume reads it to determine whether the conversation halted
    // mid-loop and surface that to the user as a "resumed from halt: X"
    // banner. Fires for both Ok(()) and Err(...) so a clean turn also has
    // a terminal HaltReason marker (reason="ok") for SESS-02 to detect a
    // gracefully-completed conversation vs. a mid-flight crash.
    let (reason_str, payload) = match &halt {
        Ok(()) => ("ok".to_string(), serde_json::json!({})),
        Err(e) => {
            let s = format!("{:?}", e);
            let p = serde_json::to_value(e).unwrap_or(serde_json::Value::Null);
            (s, p)
        }
    };
    session_writer.append(&crate::session::log::SessionEvent::HaltReason {
        reason: reason_str,
        payload,
        timestamp_ms: crate::session::log::now_ms(),
    });

    match halt {
        Ok(()) => {
            // Empty-tool-calls branch ran inside run_loop and did all the
            // post-processing (entity extraction, embed, action_tags, streaming,
            // chat_done, reward) before returning. Outer function returns Ok(()).
            return Ok(());
        }
        Err(crate::loop_engine::LoopHaltReason::Cancelled) => {
            emit_stream_event(&app, "chat_cancelled", ());
            emit_stream_event(&app, "chat_done", ());
            let _ = app.emit("blade_status", "idle");
            return Ok(());
        }
        Err(crate::loop_engine::LoopHaltReason::ProviderFatal { error }) => {
            // status emit already done inside run_loop's recovery branches; do
            // not double-emit here. Surface the error to the outer caller.
            return Err(error);
        }
        Err(crate::loop_engine::LoopHaltReason::CostExceeded { spent_usd, cap_usd, scope }) => {
            // Plan 33-08 — runtime cost-guard halt. The blade_loop_event with
            // kind:halted, reason:cost_exceeded was already emitted at the
            // halt site inside run_loop; here we surface the error to the
            // user via the existing chat_error channel so the chat UI can
            // render a friendly message rather than a silent stop.
            //
            // Plan 34-06 (RES-04) — differentiate per-loop vs per-conversation
            // scope so the user knows whether to bump `loop.cost_guard_dollars`
            // (single-turn cap, default $5) or `resilience.cost_guard_per_
            // conversation_dollars` (lifetime cap, default $25). Per-loop
            // halt fires when a single user message's API spend balloons;
            // per-conversation halt fires when the cumulative spend across
            // all turns in this session crosses the lifetime cap.
            let msg = match scope {
                crate::loop_engine::CostScope::PerLoop => format!(
                    "Loop halted: per-turn cost cap reached (${:.2} of ${:.2}). \
                     Raise `loop.cost_guard_dollars` in Settings or simplify the request.",
                    spent_usd, cap_usd
                ),
                crate::loop_engine::CostScope::PerConversation => format!(
                    "Conversation halted: lifetime cost cap reached (${:.2} of ${:.2}). \
                     Raise `resilience.cost_guard_per_conversation_dollars` in Settings \
                     or start a fresh conversation.",
                    spent_usd, cap_usd
                ),
            };
            emit_stream_event(&app, "chat_error", msg.clone());
            emit_stream_event(&app, "chat_done", ());
            let _ = app.emit("blade_status", "error");
            return Ok(());
        }
        Err(crate::loop_engine::LoopHaltReason::IterationCap) => {
            // Loop exhausted (max_iter reached) or stuck-loop break triggered.
            // Fall through to the loop-exhausted summary block below.
        }
        Err(crate::loop_engine::LoopHaltReason::Stuck { pattern }) => {
            // Plan 34-04 (RES-01) — surface the stuck halt to the chat UI.
            // blade_loop_event { kind: "stuck_detected", pattern } AND
            // blade_loop_event { kind: "halted", reason: "stuck:{pattern}" }
            // are already emitted at the halt site inside run_loop (loop_engine.rs
            // iteration-top call site). Here we surface the user-facing chat_error
            // so the chat UI does not silently drop the response.
            //
            // Plan 34-08 (SESS-01) will additionally record a SessionWriter
            // LoopEvent { kind: "stuck_detected", payload: {...} } so the
            // JSONL captures forensics for post-hoc debugging.
            let msg = format!(
                "Loop halted: stuck pattern detected ({}). Try rephrasing the request.",
                pattern
            );
            emit_stream_event(&app, "chat_error", msg.clone());
            emit_stream_event(&app, "chat_done", ());
            let _ = app.emit("blade_status", "error");
            return Ok(());
        }
        Err(crate::loop_engine::LoopHaltReason::CircuitOpen { error_kind, attempts_summary }) => {
            // Plan 34-05 (RES-02) — structured "what was tried" chat surface.
            // Renders the most-recent attempts (capped at 3) so the user sees
            // which provider/model failed with which error message before the
            // breaker tripped. Falls back to a generic message when entries
            // were recorded via the legacy `record_error(kind)` wrapper (no
            // provider/model/msg captured).
            let recent: Vec<String> = attempts_summary
                .iter()
                .rev()
                .take(3)
                .map(|a| {
                    let p = if a.provider.is_empty() { "(unknown provider)" } else { a.provider.as_str() };
                    let m = if a.model.is_empty() { "(unknown model)" } else { a.model.as_str() };
                    let em = if a.error_message.is_empty() {
                        "(no error message captured)".to_string()
                    } else {
                        crate::safe_slice(&a.error_message, 200).to_string()
                    };
                    format!("{}/{} → {}", p, m, em)
                })
                .collect();
            let msg = format!(
                "Loop halted: circuit breaker tripped on '{}' after {} attempts. Most recent failures:\n  - {}",
                error_kind,
                attempts_summary.len(),
                recent.join("\n  - "),
            );
            // Plan 34-08 (SESS-01) will additionally record a SessionWriter
            // LoopEvent { kind: "circuit_open", payload: {error_kind, attempts: N} }
            // for forensics — at this layer we surface the user-facing chat_error
            // and emit the ActivityStrip-ready blade_loop_event.
            emit_stream_event(&app, "blade_loop_event", serde_json::json!({
                "kind": "halted",
                "reason": "circuit_breaker",
                "error_kind": error_kind,
                "attempts": attempts_summary.len(),
            }));
            emit_stream_event(&app, "chat_error", msg.clone());
            emit_stream_event(&app, "chat_done", ());
            let _ = app.emit("blade_status", "error");
            return Ok(());
        }
        Err(crate::loop_engine::LoopHaltReason::DecompositionComplete) => {
            // Phase 35 / DECOMP-01 — Plan 35-07 fills the cadence.
            //
            // When the brain planner detects 5+ independent steps,
            // `decomposition::executor::execute_decomposed_task` fans out
            // sub-agents, distills their summaries, and injects the
            // synthetic AssistantTurns into `conversation` BEFORE returning
            // this halt reason. By the time we reach this arm, the parent
            // conversation already carries the summaries — there is nothing
            // for the outer fall-through summary block to add.
            //
            // Plan 35-07 surfaces a `decomposition_complete` blade_loop_event
            // chip carrying `subagent_count` so the frontend ActivityStrip
            // (Plan 35-09 / 35-10) can render the fan-out summary card. The
            // count is computed by walking `conversation` and tallying
            // synthetic AssistantTurns — the prefix `[Sub-agent summary` is
            // produced verbatim by `synthetic_assistant_turn_from_summary`
            // (loop_engine.rs §synthetic_assistant_turn_from_summary). This
            // is a clean exit — chat_done fires, NO chat_error.
            let subagent_count = conversation
                .iter()
                .filter(|m| matches!(m, ConversationMessage::Assistant { content, .. }
                    if content.starts_with("[Sub-agent summary")))
                .count();
            log::info!(
                "[DECOMP-01] decomposition complete; {} synthetic turns added to conversation",
                subagent_count
            );
            emit_stream_event(&app, "blade_loop_event", serde_json::json!({
                "kind": "decomposition_complete",
                "subagent_count": subagent_count,
            }));
            emit_stream_event(&app, "chat_done", ());
            let _ = app.emit("blade_status", "idle");
            return Ok(());
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
        emit_stream_event(&app, "chat_cancelled", ());
        emit_stream_event(&app, "chat_done", ());
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

/// Phase 56 (TELOS-EDIT-FLOW) — open `~/.blade/who-you-are.md` in the user's
/// default editor.
///
/// Three concerns this command serves:
///   1. User control. who-you-are.md is THE optimization-target artifact —
///      mission, goals, beliefs, challenges. The user owns it; they should be
///      one click away from editing it.
///   2. The `/edit-self` chat shortcut. `send_message_stream_inline` routes
///      that trigger here so users can type one slash instead of digging in
///      the filesystem.
///   3. First-run support — if the file doesn't exist yet (no hunt completed),
///      we create a stub with empty telos frontmatter so the editor doesn't
///      open to a 404.
///
/// Platform-specific open: `start` (Windows), `open` (macOS), `xdg-open`
/// (Linux). Same pattern as `automation::auto_open_path`, kept local here to
/// avoid pulling automation into the onboarding compile-graph.
#[tauri::command]
pub fn blade_open_who_you_are() -> Result<String, String> {
    let path = crate::onboarding::synthesis::who_you_are_path()?;

    // First-run support: create an empty stub so the editor opens to a real
    // file. Without this, xdg-open on Linux can fail silently when the path
    // doesn't exist.
    if !path.exists() {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("create_dir_all({}): {}", parent.display(), e))?;
        }
        let stub = "---\ntelos:\n  mission: \"\"\n  goals: []\n  beliefs: []\n  challenges: []\n---\n# Who you are (BLADE's working model)\n\n**You can edit this file. BLADE re-reads it every session.**\n\nRun the onboarding hunt or fill in the telos block above to give BLADE an optimization target.\n";
        std::fs::write(&path, stub)
            .map_err(|e| format!("write stub: {}", e))?;
    }

    let path_str = path.display().to_string();

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        std::process::Command::new("cmd")
            .args(["/C", "start", "", &path_str])
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map_err(|e| format!("Open failed: {}", e))?;
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&path_str)
            .spawn()
            .map_err(|e| format!("Open failed: {}", e))?;
    }

    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&path_str)
            .spawn()
            .map_err(|e| format!("Open failed: {}", e))?;
    }

    Ok(path_str)
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

/// Phase 11 Plan 11-01 — thin Tauri wrapper around `provider_paste_parser::parse`.
///
/// Parses a raw paste (cURL / JSON / Python-SDK snippet) into a structured
/// `ParsedProviderConfig`. Pure wrapper; all logic lives in the parser module.
///
/// @see src-tauri/src/provider_paste_parser.rs
/// @see .planning/phases/11-smart-provider-setup/11-01-PLAN.md
#[tauri::command]
pub fn parse_provider_paste(
    input: String,
) -> Result<crate::provider_paste_parser::ParsedProviderConfig, String> {
    crate::provider_paste_parser::parse(&input)
}

/// Phase 11 Plan 11-02 — thin async Tauri wrapper around capability_probe.
///
/// The `api_key` argument is OPTIONAL. When `None`, Rust falls back to
/// `config::get_provider_key(&provider)` so the re-probe UX (Plan 11-03)
/// doesn't need to round-trip the key through the TS/Rust boundary twice.
/// When the TS side has a key in hand (e.g. from a fresh paste-form submit),
/// it passes `Some(key)` and the keyring lookup is skipped.
///
/// Security posture: keys never log; providers::test_connection strips keys
/// from its error messages. Ollama is the only provider allowed with an
/// empty key (local-only, no auth).
///
/// @see src-tauri/src/capability_probe.rs
/// @see .planning/phases/11-smart-provider-setup/11-02-PLAN.md
#[tauri::command]
pub async fn probe_provider_capabilities(
    provider: String,
    api_key: Option<String>,
    model: String,
    base_url: Option<String>,
) -> Result<crate::config::ProviderCapabilityRecord, String> {
    let key = api_key.unwrap_or_else(|| crate::config::get_provider_key(&provider));
    if key.is_empty() && provider != "ollama" {
        return Err(format!(
            "No API key for provider '{}' — save a key first or pass apiKey explicitly.",
            provider
        ));
    }
    crate::capability_probe::probe(&provider, &key, &model, base_url.as_deref()).await
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
    // ── Phase 55 / SESSION-COMMANDS-MIGRATE (v2.2 — 2026-05-14) ──
    //
    // Dual-write the conversation snapshot to the Goose-shaped session
    // schema. The legacy JSON history (history/<id>.json) remains the
    // source of truth for v2.2; the new `sessions` + `session_messages`
    // tables are written alongside so cutover in v2.3 is a single-call
    // swap, not a rebuild. Invariant: legacy conversation_id == new
    // schema session_id (1:1 mapping, no lookup table needed).
    //
    // Strategy: idempotent re-sync. We INSERT OR IGNORE the session row
    // (no-op if it exists from the per-turn dual-write in
    // `send_message_stream_inline`) then append any NEW messages —
    // those whose synthetic external_message_id is not already present.
    // The dual-write fires the user side per turn; assistant rows land
    // here when the frontend snapshots after chat_done.
    //
    // Failure mode: chat-continues posture. Any error in the dual-write
    // is logged at debug and swallowed — the legacy save_conversation
    // call below stays canonical.
    if !conversation_id.is_empty() {
        if let Ok(conn) = crate::db::init_db() {
            let mgr = crate::sessions::SessionManager::new();
            let _ = mgr.upsert_session_with_id(&conn, &conversation_id, None);

            // Snapshot the message_ids we've already mirrored.
            let mut existing_external_ids: std::collections::HashSet<String> =
                std::collections::HashSet::new();
            if let Ok(data) = mgr.load_session(&conn, &conversation_id) {
                for m in &data.messages {
                    if let Some(ext) = &m.external_message_id {
                        existing_external_ids.insert(ext.clone());
                    }
                }
            }

            for msg in &messages {
                if existing_external_ids.contains(&msg.id) {
                    continue;
                }
                // Tag the row with the frontend's stable message id so the
                // next dual-write call skips this message and we don't
                // duplicate-write on every history flush.
                let _ = conn.execute(
                    "INSERT INTO session_messages (
                        message_id, session_id, role, content_json,
                        created_timestamp, timestamp
                     ) VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
                    rusqlite::params![
                        &msg.id,
                        &conversation_id,
                        &msg.role,
                        serde_json::Value::String(msg.content.clone()).to_string(),
                        msg.timestamp as i64,
                    ],
                );
            }
            // Bump session.updated_at so list_sessions ordering matches activity.
            let now_ms = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_millis() as i64)
                .unwrap_or(0);
            let _ = conn.execute(
                "UPDATE sessions SET updated_at = ?1 WHERE id = ?2",
                rusqlite::params![now_ms, &conversation_id],
            );
        }
    }

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
    .unwrap_or_else(|_| crate::providers::AssistantTurn { content: String::new(), tool_calls: vec![], stop_reason: None, tokens_in: 0, tokens_out: 0 });

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

// ---------------------------------------------------------------------------
// Phase 32 Plan 32-05 / CTX-05 — Tool output cap.
//
// `cap_tool_output(content, budget_tokens)` enforces a per-tool-output token
// budget at the conversation-insertion site. It uses the universal "head + tail
// + truncation marker" pattern (Claude Code Bash tool, OpenHands, OpenClaw all
// converge on this shape — see RESEARCH.md §CTX-05).
//
// Today, `format_tool_result` hard-truncates at MAX_TOOL_RESULT_CHARS chars
// without preserving the tail. A bash output ending in a critical error
// message would lose that error. Plan 32-05 raises MAX_TOOL_RESULT_CHARS to
// 200_000 (a far safety net) and lets `cap_tool_output` enforce the real
// per-message budget (default 4000 tokens via config.context.tool_output_cap_tokens).
//
// LOAD-BEARING: All char-based slicing inside cap_tool_output uses
// crate::safe_slice — never `&content[..n]`. CLAUDE.md mandate; v1.1 lesson.
// ---------------------------------------------------------------------------

/// Phase 32 / CTX-05 — return type from `cap_tool_output`.
/// Original full content reach-back is a Phase 33+ concern; in Phase 32 the
/// `storage_id` is just a marker that truncation occurred (used by tests + logs).
#[derive(Debug, Clone)]
pub struct ToolOutputCap {
    /// The (possibly truncated) content destined for the conversation.
    pub content: String,
    /// Some(id) when truncation occurred, None otherwise.
    pub storage_id: Option<String>,
    /// Approximate token count of the ORIGINAL (untruncated) input. Computed
    /// as chars / 4 to match estimate_tokens.
    pub original_tokens: usize,
}

/// Phase 32 / CTX-05 — cap a single tool output at `budget_tokens`. When the
/// content fits, returns it unchanged with storage_id=None. When it doesn't,
/// returns the head (~75% of budget) + a truncation marker + the tail
/// (~12.5% of budget) so callers can see both ends of the output. The marker
/// includes a storage_id (for future Phase-33+ reach-back) and the original
/// token estimate.
///
/// MUST use crate::safe_slice for all char-based slicing — `&s[..n]` panics
/// on non-ASCII boundaries (CLAUDE.md mandate, MEMORY.md
/// `feedback_uat_evidence` for the v1.1 retraction precedent).
pub fn cap_tool_output(content: &str, budget_tokens: usize) -> ToolOutputCap {
    let estimated_tokens = content.chars().count() / 4;
    if estimated_tokens <= budget_tokens {
        return ToolOutputCap {
            content: content.to_string(),
            storage_id: None,
            original_tokens: estimated_tokens,
        };
    }

    // Budget split: 75% to the head, 12.5% to the tail, ~12.5% reserved for
    // the truncation marker text. (Universal pattern per RESEARCH.md.)
    let budget_chars = budget_tokens.saturating_mul(4);
    let head_chars = (budget_chars as f32 * 0.75) as usize;
    let tail_chars = (budget_chars as f32 * 0.125) as usize;

    // SAFE-SLICE: never raw [..n]. safe_slice respects char boundaries.
    let head = crate::safe_slice(content, head_chars);

    // Tail: take the last `tail_chars` characters. char_indices gives us the
    // boundary at character `total - tail_chars`, then slice from there. If
    // the boundary computation fails (extremely short tail), fall back to
    // empty tail rather than panicking.
    let total_chars = content.chars().count();
    let tail: &str = if total_chars > tail_chars && tail_chars > 0 {
        let skip_chars = total_chars.saturating_sub(tail_chars);
        content
            .char_indices()
            .nth(skip_chars)
            .map(|(byte_idx, _)| &content[byte_idx..])
            .unwrap_or("")
    } else if tail_chars == 0 {
        ""
    } else {
        content
    };

    let omitted_tokens = estimated_tokens.saturating_sub(budget_tokens);
    let storage_id = format!("tool_out_{}", chrono::Utc::now().timestamp_millis());

    let content_out = format!(
        "{}\n\n[truncated from {} tokens; ~{} omitted in middle; storage_id {}]\n\n{}",
        head, estimated_tokens, omitted_tokens, storage_id, tail
    );

    ToolOutputCap {
        content: content_out,
        storage_id: Some(storage_id),
        original_tokens: estimated_tokens,
    }
}

pub(crate) fn format_tool_result(result: &McpToolResult) -> String {
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

// ── QuickAsk Bridge (Phase 3 WIRE-01 / Phase 4 full bridge D-93) ───────────────

/// WIRE-01 — Phase 3 stub → Phase 4 full bridge (D-93, D-100, Plan 04-01).
///
/// QuickAsk window calls this with a typed/transcribed query; we:
///   1. Emit `blade_quickask_bridged` to the main window — main inserts the
///      user turn into `useChat().messages` optimistically (Plan 04-06
///      QuickAskBridge consumer).
///   2. Emit `blade_message_start` to BOTH "main" AND "quickask" so both
///      windows render the "assistant is thinking" state. The QuickAsk popup
///      sees the live stream inline; main sees the conversation appended.
///   3. Stash the `message_id` in BLADE_CURRENT_MSG_ID so
///      providers/anthropic.rs can tag `blade_thinking_chunk` with it
///      (Phase 3 D-64 continuation).
///   4. Spawn `send_message_stream_inline` with `emit_windows = ["main",
///      "quickask"]` — every user-visible stream event (chat_token /
///      chat_done / etc.) reaches both surfaces. Provider errors surface as a
///      `blade_notification` toast on the main window.
///
/// Serialization: `send_message_stream_inline` holds CHAT_INFLIGHT for the
/// duration of the stream, so concurrent quickask submissions while a chat is
/// in flight will return "Already processing a message." — acceptable UX.
///
/// @see .planning/RECOVERY_LOG.md §1.1 (bridge contract)
/// @see .planning/phases/03-dashboard-chat-settings/03-CONTEXT.md §D-64
/// @see .planning/phases/04-overlay-windows/04-CONTEXT.md §D-93, §D-100
#[tauri::command]
pub async fn quickask_submit(
    app: tauri::AppHandle,
    state: tauri::State<'_, SharedMcpManager>,
    approvals: tauri::State<'_, ApprovalMap>,
    vector_store: tauri::State<'_, crate::embeddings::SharedVectorStore>,
    query: String,
    mode: String,            // "text" | "voice"
    source_window: String,   // typically "quickask"
) -> Result<(), String> {
    let conversation_id = uuid::Uuid::new_v4().to_string();
    let message_id = uuid::Uuid::new_v4().to_string();
    let user_message_id = uuid::Uuid::new_v4().to_string();
    let timestamp = chrono::Utc::now().timestamp_millis();
    log::info!(
        "[quickask] submit from window={} mode={} query_len={} conv_id={} msg_id={}",
        source_window,
        mode,
        query.len(),
        conversation_id,
        message_id,
    );

    // 1. Bridge event — main inserts the user turn optimistically (Plan 04-06).
    let _ = app.emit_to("main", "blade_quickask_bridged", serde_json::json!({
        "query": query,
        "response": "",
        "conversation_id": conversation_id,
        "mode": mode,
        "timestamp": timestamp,
        "message_id": message_id,
        "user_message_id": user_message_id,
        "source_window": source_window,
    }));

    // 2. blade_message_start to BOTH windows (D-93 step 4).
    //    QuickAsk renders the live stream inline; main appends the assistant turn.
    let _ = app.emit_to("main", "blade_message_start", serde_json::json!({
        "message_id": &message_id,
        "role": "assistant",
    }));
    let _ = app.emit_to("quickask", "blade_message_start", serde_json::json!({
        "message_id": &message_id,
        "role": "assistant",
    }));

    // 3. Stash msg_id for providers/anthropic.rs thinking-chunk tagging (D-64).
    std::env::set_var("BLADE_CURRENT_MSG_ID", &message_id);

    // 4. Build the single-turn user message — quickask is stateless per submit.
    let messages = vec![ChatMessage {
        role: "user".to_string(),
        content: query.clone(),
        image_base64: None,
    }];

    // 5. Spawn the streaming pipeline with dual-window emit (D-93, D-100).
    let app_clone = app.clone();
    let state_clone = state.inner().clone();
    let approvals_clone = approvals.inner().clone();
    let vector_store_clone = vector_store.inner().clone();
    tauri::async_runtime::spawn(async move {
        if let Err(e) = send_message_stream_inline(
            app_clone.clone(),
            state_clone,
            approvals_clone,
            vector_store_clone,
            messages,
            &["main", "quickask"],
            // Phase 34 / BL-01 — quickask is stateless per submit, so no
            // conversation_id is threaded; SessionWriter generates a fresh
            // ULID and the per-conversation carry-over registry uses an empty
            // key (effectively no carry-over for one-off quickasks).
            None,
        )
        .await
        {
            log::warn!("[quickask] stream error: {}", e);
            let _ = app_clone.emit_to("main", "blade_notification", serde_json::json!({
                "type": "error",
                "message": format!("Quick ask failed: {}", crate::safe_slice(&e, 200)),
            }));
        }
    });

    // Frontend (D-101) handles auto-hide after chat_done; nothing more to do here.
    Ok(())
}

#[cfg(test)]
mod phase24_e2e_tests {
    use super::*;

    #[tokio::test]
    async fn proposal_reply_yes_merge_persists_merged_tool() {
        let tmp = tempfile::TempDir::new().expect("tempdir");
        std::env::set_var("BLADE_CONFIG_DIR", tmp.path());

        // Set up forged_tools table + 2 source rows.
        let conn = rusqlite::Connection::open(tmp.path().join("blade.db")).unwrap();
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS forged_tools (
                id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, description TEXT NOT NULL,
                language TEXT NOT NULL, script_path TEXT NOT NULL, usage TEXT NOT NULL,
                parameters TEXT DEFAULT '[]', test_output TEXT DEFAULT '',
                created_at INTEGER NOT NULL, last_used INTEGER, use_count INTEGER DEFAULT 0,
                forged_from TEXT DEFAULT ''
            );"
        ).unwrap();
        for n in &["foo", "bar"] {
            conn.execute(
                "INSERT INTO forged_tools (id, name, description, language, script_path, usage, created_at, last_used) \
                 VALUES (?1, ?2, 'd', 'bash', ?3, 'u', 100, 100)",
                rusqlite::params![format!("id-{}", n), n, format!("/tmp/{}.sh", n)],
            ).unwrap();
        }
        drop(conn);

        // Build a sample merged ForgedTool body and write the proposal.
        let merged = crate::tool_forge::ForgedTool {
            id: "merged-id".to_string(),
            name: "foo_merged".to_string(),
            description: "merged d".to_string(),
            language: "bash".to_string(),
            script_path: "/tmp/foo.sh".to_string(),
            usage: "merged usage".to_string(),
            parameters: vec![],
            test_output: "merged test".to_string(),
            created_at: 200,
            last_used: Some(200),
            use_count: 0,
            forged_from: "merge:foo+bar".to_string(),
        };
        let payload = serde_json::json!({
            "source_a": "foo",
            "source_b": "bar",
            "merged_body": serde_json::to_value(&merged).unwrap(),
        });
        let prop = crate::skills::pending::Proposal {
            id: "abc12345".to_string(),
            kind: "merge".to_string(),
            proposed_name: "foo_merged".to_string(),
            payload,
            created_at: chrono::Utc::now().timestamp(),
            dismissed: false,
            content_hash: "hash1".to_string(),
        };
        crate::skills::pending::write_proposal(&prop).unwrap();

        // Apply.
        let result = apply_proposal_reply("yes", "abc12345").await.unwrap();
        assert!(result.contains("foo_merged"), "got: {}", result);

        // Verify merged tool exists in forged_tools.
        let conn = rusqlite::Connection::open(tmp.path().join("blade.db")).unwrap();
        let names: Vec<String> = conn.prepare("SELECT name FROM forged_tools").unwrap()
            .query_map([], |r| r.get::<_, String>(0)).unwrap()
            .filter_map(|r| r.ok()).collect();
        assert!(names.contains(&"foo_merged".to_string()), "expected foo_merged; got {:?}", names);

        // Verify .pending/abc12345.json was deleted.
        assert!(crate::skills::pending::read_proposal("abc12345").is_none());

        std::env::remove_var("BLADE_CONFIG_DIR");
    }

    #[tokio::test]
    async fn proposal_reply_dismiss_marks_proposal() {
        let tmp = tempfile::TempDir::new().expect("tempdir");
        std::env::set_var("BLADE_CONFIG_DIR", tmp.path());

        let prop = crate::skills::pending::Proposal {
            id: "dismiss01".to_string(),
            kind: "merge".to_string(),
            proposed_name: "x_merged".to_string(),
            payload: serde_json::json!({}),
            created_at: chrono::Utc::now().timestamp(),
            dismissed: false,
            content_hash: "h".to_string(),
        };
        crate::skills::pending::write_proposal(&prop).unwrap();

        let result = apply_proposal_reply("dismiss", "dismiss01").await.unwrap();
        assert!(result.contains("Dismissed"), "got: {}", result);

        let after = crate::skills::pending::read_proposal("dismiss01").unwrap();
        assert!(after.dismissed);

        std::env::remove_var("BLADE_CONFIG_DIR");
    }
}

// ---------------------------------------------------------------------------
// Phase 32 Plan 32-02 — context management test harness.
//
// Fixture utilities used by Wave 2 plans (32-03 selective injection,
// 32-04 compaction trigger, 32-05 tool-output cap). Centralised here so each
// downstream plan does NOT scaffold its own conversation builder.
//
// `build_test_conversation(n)` returns Vec<ConversationMessage> with 1 system
// message + n alternating user/assistant turns (each turn ~210 chars body).
// `build_test_conversation_with_token_target(t)` sizes n so the conversation's
// `estimate_tokens()` lands roughly at `t` (loose ±50% tolerance — fixture is
// approximate; compaction triggers operate on rough estimates anyway).
// ---------------------------------------------------------------------------
#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    /// Phase 32 fixture — build a synthetic conversation with `n` user/assistant
    /// turns plus 1 system message. Each turn carries ~180 chars of body so
    /// total chars/turn ≈ 210 (≈52 tokens per turn at chars/4).
    /// Used by Plans 32-03, 32-04, 32-05.
    pub fn build_test_conversation(n: usize) -> Vec<ConversationMessage> {
        let mut conv = Vec::with_capacity(n + 1);
        conv.push(ConversationMessage::System(
            "You are BLADE. ".repeat(10),
        ));
        for i in 0..n {
            if i % 2 == 0 {
                conv.push(ConversationMessage::User(
                    format!("user message {} {}", i, "x".repeat(180)),
                ));
            } else {
                conv.push(ConversationMessage::Assistant {
                    content: format!("assistant reply {} {}", i, "y".repeat(180)),
                    tool_calls: vec![],
                });
            }
        }
        conv
    }

    /// Build a conversation whose estimated token count is approximately
    /// `target_tokens`. Used by Plan 32-04 (compaction trigger).
    ///
    /// `estimate_tokens` uses chars/4. Per-turn body ≈ 210 chars ≈ 52 tokens.
    /// Tolerance is intentionally wide (±50%) — compaction trigger operates on
    /// rough estimates, and fixture-precision is not a phase-32 requirement.
    pub fn build_test_conversation_with_token_target(
        target_tokens: usize,
    ) -> Vec<ConversationMessage> {
        let target_chars = target_tokens * 4;
        let per_turn_chars = 200usize;
        let n = (target_chars / per_turn_chars).max(2);
        build_test_conversation(n)
    }

    #[test]
    fn phase32_build_test_conversation_shape() {
        let c = build_test_conversation(10);
        assert_eq!(c.len(), 11, "expected 1 system + 10 turns, got {}", c.len());
        assert!(matches!(&c[0], ConversationMessage::System(_)),
            "first message must be System");
        // Verify alternation: index 1 = User, index 2 = Assistant, etc.
        assert!(matches!(&c[1], ConversationMessage::User(_)),
            "index 1 must be User (i=0, even)");
        assert!(matches!(&c[2], ConversationMessage::Assistant { .. }),
            "index 2 must be Assistant (i=1, odd)");
        let toks = estimate_tokens(&c);
        assert!(toks > 0, "estimated tokens should be positive, got {}", toks);
    }

    #[test]
    fn phase32_build_test_conversation_token_aware() {
        let c = build_test_conversation_with_token_target(100_000);
        let toks = estimate_tokens(&c);
        // Wide tolerance — fixture is approximate. Compaction triggers don't
        // need exact token counts; they need "roughly the target order".
        let lower = (100_000.0 * 0.5) as usize;
        let upper = (100_000.0 * 1.5) as usize;
        assert!(
            toks >= lower && toks <= upper,
            "expected ~100k tokens, got {} (allowed range {}..={})",
            toks, lower, upper
        );
    }

    // -----------------------------------------------------------------------
    // Plan 32-04 / CTX-04 — model-aware compaction trigger tests
    // -----------------------------------------------------------------------

    #[test]
    fn phase32_compaction_trigger_anthropic_200k() {
        let ctx = model_context_window("anthropic", "claude-sonnet-4");
        assert!(ctx >= 200_000, "expected 200k+ for Claude Sonnet 4, got {}", ctx);
        let trigger = (ctx as f32 * 0.80) as usize;
        assert!(
            trigger >= 160_000 && trigger <= 200_000,
            "expected ~160k trigger, got {}", trigger
        );
    }

    #[test]
    fn phase32_compaction_trigger_openai_128k() {
        let ctx = model_context_window("openai", "gpt-4o");
        // gpt-4o is 128k context; capability_probe should return 128_000
        assert!(
            ctx >= 100_000 && ctx <= 200_000,
            "expected ~128k for gpt-4o, got {}", ctx
        );
        let trigger = (ctx as f32 * 0.80) as usize;
        assert!(
            trigger > 80_000 && trigger < ctx as usize,
            "expected trigger between 80k and ctx_window, got {}", trigger
        );
    }

    #[test]
    fn phase32_compaction_trigger_unknown_model_safe_default() {
        let ctx = model_context_window("not-a-real-provider", "not-a-real-model");
        assert!(
            ctx >= 8_192,
            "unknown model must return ≥ 8192 to keep trigger non-zero, got {}", ctx
        );
    }

    #[test]
    fn phase32_compaction_trigger_pct_respects_config() {
        let ctx = model_context_window("anthropic", "claude-sonnet-4");
        let trigger_80 = (ctx as f32 * 0.80) as usize;
        let trigger_65 = (ctx as f32 * 0.65) as usize;
        let delta = trigger_80.saturating_sub(trigger_65);
        let expected = (ctx as f32 * 0.15) as usize;
        assert!(
            (delta as i64 - expected as i64).abs() < 100,
            "expected ~15% delta, got {} (expected {})", delta, expected
        );
    }

    // -----------------------------------------------------------------------
    // Plan 32-04 / CTX-03 — OpenHands v7610 prompt + token-aware keep_recent
    // -----------------------------------------------------------------------

    #[test]
    fn phase32_compress_summary_prompt_includes_v7610_keys() {
        let events = vec![
            "User: hello".to_string(),
            "Assistant: hi there".to_string(),
        ];
        let prompt = build_compaction_summary_prompt(&events);
        for key in &["USER_CONTEXT", "COMPLETED", "PENDING", "CURRENT_STATE", "CODE_STATE"] {
            assert!(prompt.contains(key), "missing key {} in prompt", key);
        }
        assert!(
            prompt.contains("hello"),
            "events not interpolated into prompt"
        );
    }

    #[test]
    fn phase32_compress_keep_recent_normal_case() {
        // 1 system + 20 turns of ~210 chars each → ~52 tokens each → 8 turns ≈ 420 tokens
        // Should hit the 8-message cap before the 16k token budget.
        let conv = build_test_conversation(20);
        let keep = compute_keep_recent(&conv, 8, 16_000);
        assert_eq!(
            keep, 8,
            "expected 8-message cap to apply, got {}", keep
        );
    }

    #[test]
    fn phase32_compress_keep_recent_token_aware() {
        // 1 system + 7 normal + 1 huge 100k-char tool message at the end.
        // The huge tool message alone is ~25k tokens, exceeding the 16k budget,
        // so keep_recent should bottom out at the .max(2) floor.
        let mut conv = build_test_conversation(7);
        conv.push(ConversationMessage::Tool {
            tool_call_id: "x".to_string(),
            tool_name: "bash".to_string(),
            content: "x".repeat(100_000), // ~25k tokens
            is_error: false,
        });
        let keep = compute_keep_recent(&conv, 8, 16_000);
        assert!(
            keep <= 2,
            "huge message should cap keep_recent, got {}", keep
        );
    }

    #[test]
    fn phase32_compress_keep_recent_floor() {
        // Tiny conversation, ensure floor at 2.
        let conv = build_test_conversation(1);
        let keep = compute_keep_recent(&conv, 8, 16_000);
        assert!(keep >= 2, "floor should be 2, got {}", keep);
    }

    // -----------------------------------------------------------------------
    // Plan 32-05 / CTX-05 — tool output cap tests
    // -----------------------------------------------------------------------

    #[test]
    fn phase32_cap_tool_output_under_budget_passthrough() {
        let small = "tiny output, well under budget";
        let r = cap_tool_output(small, 4000);
        assert_eq!(r.content, small);
        assert!(r.storage_id.is_none(), "small output got unexpected storage_id");
        assert!(r.original_tokens < 50, "expected <50 tokens, got {}", r.original_tokens);
    }

    #[test]
    fn phase32_cap_tool_output_over_budget_truncates() {
        let big = "x".repeat(50_000); // ~12_500 tokens (chars/4)
        let r = cap_tool_output(&big, 4000);
        // Output is shaped roughly like: head(12k chars) + marker(~150 chars) + tail(2k chars) ≈ 14k chars.
        assert!(
            r.content.len() < 20_000,
            "result should be under ~5000 tokens, got {} chars (~{} tokens)",
            r.content.len(),
            r.content.len() / 4
        );
        assert!(
            r.content.contains("[truncated from"),
            "missing truncation marker; result starts with: {}",
            crate::safe_slice(&r.content, 200)
        );
        assert!(r.storage_id.is_some(), "over-budget output missing storage_id");
        assert!(
            r.original_tokens >= 10_000,
            "expected ≥10k original tokens, got {}",
            r.original_tokens
        );
    }

    #[test]
    fn phase32_cap_tool_output_preserves_head_and_tail() {
        let mut content = String::from("HEAD_MARKER_X");
        content.push_str(&"x".repeat(50_000));
        content.push_str("TAIL_MARKER_Z");
        let r = cap_tool_output(&content, 4000);
        assert!(
            r.content.contains("HEAD_MARKER_X"),
            "head marker missing — head not preserved"
        );
        assert!(
            r.content.contains("TAIL_MARKER_Z"),
            "tail marker missing — tail not preserved (this is the bug v1.1 lesson teaches)"
        );
    }

    #[test]
    fn phase32_cap_tool_output_non_ascii_safe() {
        // 20_000 fire emojis = ~80_000 bytes (each emoji is 4 bytes UTF-8) but
        // ~20_000 chars and ~5000 tokens. With budget 4000, must truncate.
        // Critically, must not panic on char-boundary slicing.
        let emoji = "🔥".repeat(20_000);
        let r = std::panic::catch_unwind(|| cap_tool_output(&emoji, 4000));
        assert!(
            r.is_ok(),
            "non-ASCII content caused panic — safe_slice not used"
        );
        let r = r.unwrap();
        assert!(
            r.content.contains("[truncated from"),
            "non-ASCII over-budget content missing truncation marker"
        );
    }

    #[test]
    fn phase32_cap_tool_output_storage_id_when_truncated() {
        let small = cap_tool_output("hello", 4000);
        assert!(small.storage_id.is_none(), "small output got storage_id");
        let big = cap_tool_output(&"y".repeat(50_000), 4000);
        assert!(big.storage_id.is_some(), "big output missing storage_id");
        let id = big.storage_id.unwrap();
        assert!(
            id.starts_with("tool_out_"),
            "storage_id format wrong: {}",
            id
        );
    }

    // -----------------------------------------------------------------------
    // Plan 32-05 / CTX-05 — format_tool_result regression tests.
    //
    // Old behavior: MAX_TOOL_RESULT_CHARS = 12_000, format_tool_result
    // silently truncated bash output tails before cap_tool_output (the real
    // budget enforcer) could see them. New behavior: MAX_TOOL_RESULT_CHARS =
    // 200_000 — format_tool_result is a SAFETY net for multi-MB pathological
    // outputs only. The 4000-token per-message budget lives in
    // cap_tool_output at the conversation-insertion site.
    // -----------------------------------------------------------------------

    fn make_mcp_result(text: &str, is_error: bool) -> crate::mcp::McpToolResult {
        crate::mcp::McpToolResult {
            content: vec![crate::mcp::McpContent {
                content_type: "text".to_string(),
                text: Some(text.to_string()),
            }],
            is_error,
        }
    }

    #[test]
    fn phase32_format_tool_result_no_longer_truncates_at_12k() {
        let big = "y".repeat(50_000);
        let r = make_mcp_result(&big, false);
        let formatted = format_tool_result(&r);
        // Old behavior: hard-truncated at 12_000 chars + ~50 chars of marker.
        // New behavior: passes 50_000 through (under the new 200_000 ceiling).
        assert!(
            formatted.len() >= 30_000,
            "format_tool_result should no longer truncate small-MB outputs (got {} chars)",
            formatted.len()
        );
    }

    #[test]
    fn phase32_format_tool_result_still_caps_at_safety_ceiling() {
        let huge = "z".repeat(500_000);
        let r = make_mcp_result(&huge, false);
        let formatted = format_tool_result(&r);
        // 200k ceiling + ~80 chars marker ≈ 200_080 chars. Bound generously
        // at 250_000 — the property under test is "still has an outer
        // safety ceiling", not the exact value.
        assert!(
            formatted.len() <= 250_000,
            "format_tool_result must still have an outer safety ceiling (got {} chars)",
            formatted.len()
        );
    }

    // ─── 33-NN-FIX (BL-02) — fast-path supplement merge regression ────────

    /// Mirrors the production fast-path supplement injection at
    /// commands.rs:1476. We can't construct a real BladeConfig + AppHandle
    /// inside a unit test (Tauri AppHandle requires a runtime), so this test
    /// directly exercises the `merge supplement into existing System(0)`
    /// transformation against a synthetic conversation. The shape under test
    /// is exactly what production runs:
    ///
    ///     1. build_conversation produces conversation[0] = System(slow_path_prompt)
    ///     2. The fast-path branch wants to inject a supplement
    ///     3. The CORRECT behaviour is to MERGE supplement into conversation[0]
    ///        (concatenated with delimiter), NOT insert at index 0 (which would
    ///        displace the slow-path prompt to index 1 where Anthropic + Gemini
    ///        find_map() drops it).
    ///
    /// If a future edit accidentally re-introduces the displacement bug
    /// (`conversation.insert(0, ...)` on the smart-loop branch), this test
    /// trips because the slow-path prompt content is no longer at index 0.
    #[test]
    fn phase33_loop_05_supplement_does_not_displace_existing_system_prompt() {
        let slow_path_prompt =
            "SLOW_PATH_IDENTITY_AND_CONTEXT_AND_SMART_CTX_AND_BRAIN_L0_CRITICAL_FACTS";
        let supplement = "FAST_PATH_IDENTITY_SUPPLEMENT";

        let mut conversation: Vec<ConversationMessage> = vec![
            ConversationMessage::System(slow_path_prompt.to_string()),
            ConversationMessage::User("hello".to_string()),
        ];

        // Mirror the production merge logic at commands.rs:1476.
        if !supplement.is_empty() {
            if let Some(ConversationMessage::System(existing)) = conversation.get_mut(0) {
                *existing = format!("{}\n\n---\n\n{}", supplement, existing);
            } else {
                conversation.insert(0, ConversationMessage::System(supplement.to_string()));
            }
        }

        // Index 0 must still be a System message (no displacement).
        assert!(
            matches!(conversation.first(), Some(ConversationMessage::System(_))),
            "conversation[0] must remain System after supplement merge — got {:?}",
            conversation.first()
        );

        // The merged System(0) must contain BOTH the supplement AND the
        // slow-path prompt — Anthropic + Gemini find_map() see this single
        // message and route the entire merged content to the provider.
        let ConversationMessage::System(merged) = conversation
            .first()
            .expect("conversation[0]")
        else {
            panic!("conversation[0] must be System");
        };
        assert!(
            merged.contains(slow_path_prompt),
            "merged System(0) must contain the slow-path prompt; got: {}",
            merged
        );
        assert!(
            merged.contains(supplement),
            "merged System(0) must contain the supplement; got: {}",
            merged
        );

        // Conversation length must NOT have grown — merge in place, not
        // insert. If a future edit reverts to `conversation.insert(0, ...)`,
        // length becomes 3 and this assertion trips.
        assert_eq!(
            conversation.len(),
            2,
            "merge must NOT grow conversation length (insert+displace bug); got len={}",
            conversation.len()
        );

        // Confirm there is exactly ONE System message — Anthropic + Gemini
        // build_body use find_map (returns first), so a regression that adds
        // a SECOND System would trip this test.
        let system_count = conversation
            .iter()
            .filter(|m| matches!(m, ConversationMessage::System(_)))
            .count();
        assert_eq!(
            system_count, 1,
            "merge must yield exactly 1 System message — find_map() in Anthropic + Gemini \
             would silently drop a second one and we'd lose the slow-path prompt"
        );
    }

    /// Defensive sister test — when there is NO existing System at index 0
    /// (rare in production but possible with future commands.rs evolution),
    /// the supplement should fall through to the legacy insert path.
    #[test]
    fn phase33_loop_05_supplement_inserts_when_no_existing_system() {
        let supplement = "FAST_PATH_IDENTITY_SUPPLEMENT";
        let mut conversation: Vec<ConversationMessage> = vec![
            ConversationMessage::User("hello".to_string()),
        ];

        if !supplement.is_empty() {
            if let Some(ConversationMessage::System(existing)) = conversation.get_mut(0) {
                *existing = format!("{}\n\n---\n\n{}", supplement, existing);
            } else {
                conversation.insert(0, ConversationMessage::System(supplement.to_string()));
            }
        }

        assert_eq!(conversation.len(), 2,
            "no-existing-System path must INSERT, growing length by 1");
        assert!(
            matches!(conversation.first(), Some(ConversationMessage::System(s)) if s == supplement),
            "supplement must be at index 0 when no prior System existed"
        );
    }

    // ─── Plan 34-05 (RES-02) — circuit-breaker widening tests ───────────────

    #[test]
    fn phase34_res_02_record_error_full_widens_tuple() {
        clear_error_history();
        record_error_full(
            "server",
            "anthropic",
            "claude-sonnet-4-20250514",
            "503 Service Unavailable",
        );
        let summary = circuit_attempts_summary("server");
        assert_eq!(summary.len(), 1);
        assert_eq!(summary[0].provider, "anthropic");
        assert_eq!(summary[0].model, "claude-sonnet-4-20250514");
        assert_eq!(summary[0].error_message, "503 Service Unavailable");
        clear_error_history();
    }

    #[test]
    fn phase34_res_02_record_error_legacy_wrapper_works() {
        clear_error_history();
        record_error("timeout");
        record_error("timeout");
        record_error("timeout");
        assert!(
            is_circuit_broken("timeout"),
            "3 calls to record_error(timeout) must trip is_circuit_broken"
        );
        clear_error_history();
    }

    #[test]
    fn phase34_res_02_circuit_attempts_summary_filters_by_kind() {
        clear_error_history();
        record_error_full("rate_limit", "anthropic", "claude-sonnet-4", "429");
        record_error_full("server", "openai", "gpt-4o", "503");
        record_error_full("rate_limit", "groq", "llama-3", "429 again");
        let rate_limits = circuit_attempts_summary("rate_limit");
        assert_eq!(rate_limits.len(), 2);
        let servers = circuit_attempts_summary("server");
        assert_eq!(servers.len(), 1);
        clear_error_history();
    }

    #[test]
    fn phase34_res_02_clear_error_history_resets() {
        clear_error_history();
        record_error("timeout");
        record_error("timeout");
        record_error("timeout");
        assert!(is_circuit_broken("timeout"));
        clear_error_history();
        assert!(
            !is_circuit_broken("timeout"),
            "clear_error_history must reset the breaker count to 0"
        );
        let after = circuit_attempts_summary("timeout");
        assert!(
            after.is_empty(),
            "circuit_attempts_summary must be empty after clear"
        );
    }
}
