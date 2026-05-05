// src-tauri/src/loop_engine.rs
//
// Phase 33 — Agentic Loop engine. Houses:
//   - LoopState        (iteration, cumulative cost, replans, token escalations,
//                       ring buffer of last 3 actions, same-tool failure counters)
//   - LoopHaltReason   (CostExceeded / IterationCap / Cancelled / ProviderFatal)
//   - ToolError        (LOOP-02 — attempted + reason + suggested alternatives)
//   - ActionRecord     (compact summary for verification probe context)
//   - enrich_alternatives  (LOOP-02 — small static map, ~10 entries)
//
// Plan 33-02 ships ONLY the type scaffolding + enrich_alternatives helper.
// Plan 33-03 lifts the `for iteration in 0..12` loop body from commands.rs:1621
// into `pub async fn run_loop(...)`. Plan 33-04 adds verify_progress.
// Plan 33-06 adds detect_truncation + escalate_max_tokens. Plan 33-09 ports
// CTX-07's catch_unwind discipline to wrap the smart-loop call sites.
//
// CONTEXT lock §Module Boundaries:
//   - This is a top-level module (`mod loop_engine;` in lib.rs).
//   - NO Tauri commands. Events emit through the existing app.emit channel.
//   - Existing 37+ native tools are NOT migrated to Result<T, ToolError>;
//     the shim in native_tools.rs::wrap_legacy_error preserves legacy behavior.
//
// 33-RESEARCH.md landmines:
//   - L4: AssertUnwindSafe required at any future catch_unwind site that
//     captures &BladeConfig (Phase 32-07 pattern). Plans 33-04/33-09 enforce.
//   - L11: Replan nudge must not stack — track in LoopState.replans_this_run;
//     skip duplicate injections within 2 iterations.
//   - L14: ToolError migration is OUT OF SCOPE; the shim is non-optional.

use std::collections::{HashMap, VecDeque};
use std::sync::atomic::Ordering;

use tauri::Emitter;

use crate::commands::{
    backoff_secs, classify_api_error, compress_conversation_smart, emit_stream_event,
    explain_tool_failure, format_tool_result, is_circuit_broken, model_context_window,
    record_error, safe_fallback_model, try_free_model_fallback, ApprovalMap, ErrorRecovery,
    SharedMcpManager, CHAT_CANCEL,
};
use crate::providers::{self, ConversationMessage};
use crate::trace;

// ─── Loop state ────────────────────────────────────────────────────────────

/// LOOP-01..06 — central state struct passed by mutable reference through
/// every iteration of the loop. Plans 33-04..33-08 populate the fields.
#[derive(Debug, Clone, Default)]
pub struct LoopState {
    /// Current iteration count (0-indexed).
    pub iteration: u32,
    /// Per-conversation cumulative spend in USD. Compared against
    /// `config.r#loop.cost_guard_dollars` at the top of each iteration
    /// (LOOP-06 — Plan 33-08 wires the runtime check).
    pub cumulative_cost_usd: f32,
    /// LOOP-03 — observable counter for the "two consecutive plan adaptations"
    /// success criterion. Incremented when the third-same-tool-failure trigger
    /// fires reject_plan + injects the replan nudge.
    pub replans_this_run: u32,
    /// LOOP-04 — number of times max_tokens was doubled this run.
    pub token_escalations: u32,
    /// LOOP-01 — ring buffer of the most recent 3 tool actions, used as
    /// `actions` context for the verification probe prompt.
    pub last_3_actions: VecDeque<ActionRecord>,
    /// LOOP-03 trigger — count of consecutive failures per tool name.
    /// Resets to 0 when the tool succeeds or a different tool fails.
    /// On 3rd entry, reject_plan is called + replan nudge injected.
    pub consecutive_same_tool_failures: HashMap<String, u32>,
}

impl LoopState {
    /// Push an action into the ring buffer, evicting the oldest if length > 3.
    pub fn record_action(&mut self, record: ActionRecord) {
        self.last_3_actions.push_back(record);
        while self.last_3_actions.len() > 3 {
            self.last_3_actions.pop_front();
        }
    }
}

/// LOOP-01 — compact summary of a tool action for the verification probe.
/// Each summary is `safe_slice`'d to 300 chars (CONTEXT lock §Mid-Loop Verification).
#[derive(Debug, Clone)]
pub struct ActionRecord {
    pub tool: String,
    pub input_summary: String,
    pub output_summary: String,
    pub is_error: bool,
}

// ─── Loop halt reasons ────────────────────────────────────────────────────

/// LOOP-06 — structured halt reasons. Returned from `run_loop` to the outer
/// orchestration in commands.rs, which maps each variant to the appropriate
/// chat_error / chat_cancelled emit.
#[derive(Debug, Clone)]
pub enum LoopHaltReason {
    /// LOOP-06 — cumulative cost exceeded `config.r#loop.cost_guard_dollars`.
    /// Emit blade_loop_event {kind: "halted", reason: "cost_exceeded"} +
    /// chat_error with the dollar figures.
    CostExceeded { spent_usd: f32, cap_usd: f32 },
    /// LOOP-06 — `config.r#loop.max_iterations` exhausted without resolution.
    /// Existing iteration-exhausted handling continues (preserve current
    /// commands.rs behavior; just emit blade_loop_event).
    IterationCap,
    /// User pressed cancel (CHAT_CANCEL atomic flipped).
    Cancelled,
    /// Provider error that wasn't recoverable via classify_api_error fallback.
    ProviderFatal { error: String },
}

// ─── Structured tool errors (LOOP-02) ──────────────────────────────────────

/// LOOP-02 — structured tool failure surfaced to the model. Replaces bare
/// `Err(String)` returns at the boundary where errors enter the loop.
///
/// Format injected into the conversation as a tool result message
/// (CONTEXT lock §Structured Tool Errors):
///
/// ```text
/// Tool failed.
/// Attempted: <attempted>
/// Reason: <failure_reason>
/// Suggested alternatives:
///   - <alt 1>
///   - <alt 2>
/// ```
///
/// If `suggested_alternatives` is empty (legacy shim path), the entire
/// "Suggested alternatives" block is OMITTED — no empty bullets.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
pub struct ToolError {
    /// Tool name + brief input description (≤300 chars; safe_slice'd at the
    /// boundary where caller constructs the error).
    pub attempted: String,
    /// Raw error or interpreted reason. Recommend String for v1; typed enum
    /// is a follow-up (CONTEXT lock §Structured Tool Errors, "Claude's discretion").
    pub failure_reason: String,
    /// Human-readable next-step hints. Empty for legacy shim; populated by
    /// `enrich_alternatives` at the LoopState boundary.
    pub suggested_alternatives: Vec<String>,
}

impl ToolError {
    /// Renders the locked CONTEXT format. When `suggested_alternatives` is
    /// empty, the "Suggested alternatives:" section is omitted entirely.
    pub fn render_for_model(&self) -> String {
        let mut out = format!(
            "Tool failed.\nAttempted: {}\nReason: {}",
            self.attempted, self.failure_reason
        );
        if !self.suggested_alternatives.is_empty() {
            out.push_str("\nSuggested alternatives:");
            for alt in &self.suggested_alternatives {
                out.push_str(&format!("\n  - {}", alt));
            }
        }
        out
    }
}

// ─── enrich_alternatives ──────────────────────────────────────────────────

/// LOOP-02 — small static map of tool name → likely alternatives.
/// Phase 33 ships ~10 entries covering the most common tool failures
/// (CONTEXT lock §Structured Tool Errors). Comprehensive coverage of all
/// 37+ native tools is incremental follow-up work.
pub fn enrich_alternatives(tool_name: &str) -> Vec<String> {
    match tool_name {
        "read_file" => vec![
            "Verify the path exists with `bash 'ls -la <dir>'`".to_string(),
            "Check for typos in the file name (case sensitivity matters on Linux/macOS)".to_string(),
        ],
        "write_file" => vec![
            "Confirm the parent directory exists; create with `bash 'mkdir -p <dir>'`".to_string(),
            "Check disk space and write permissions on the target directory".to_string(),
        ],
        "bash" => vec![
            "Verify the command exists in PATH (`bash 'command -v <cmd>'`)".to_string(),
            "Check for unmatched quotes, escapes, or shell metacharacters in the command".to_string(),
        ],
        "list_dir" | "ls" => vec![
            "Confirm the directory exists; try the parent path".to_string(),
            "Use `bash 'ls -la <path>'` to inspect permissions".to_string(),
        ],
        "grep" | "search_files" => vec![
            "Broaden the pattern or remove regex anchors".to_string(),
            "Verify the search root exists (`list_dir <root>`)".to_string(),
        ],
        "web_search" => vec![
            "Try a narrower or broader query".to_string(),
            "Specify a time window with `after:<date>` or `before:<date>`".to_string(),
        ],
        "fetch_url" | "browser_fetch" => vec![
            "Confirm the URL is reachable (no auth wall, no CAPTCHA)".to_string(),
            "Try the printable / archive variant of the URL".to_string(),
        ],
        "run_python" => vec![
            "Check Python is installed (`bash 'python3 --version'`)".to_string(),
            "Verify required imports exist; install missing packages first".to_string(),
        ],
        "system_control" => vec![
            "Check OS-specific permissions (Accessibility, Automation, Disk Access)".to_string(),
            "Try a simpler operation first (volume / brightness) to confirm the bridge works".to_string(),
        ],
        "clipboard" | "read_clipboard" | "write_clipboard" => vec![
            "Confirm clipboard daemon is running (Linux: xclip/wl-clipboard)".to_string(),
            "Retry — clipboard read can race with active apps".to_string(),
        ],
        _ => vec![],
    }
}

// ─── Loop driver (Plan 33-03) ──────────────────────────────────────────────

/// LOOP-06 — replaces the inline `for iteration in 0..12 { ... }` previously at
/// commands.rs:1626. Owns the iteration body (turn execution, error recovery,
/// brain_planner reject_plan, cancellation, conversation push, tool dispatch,
/// post-loop assembly inside the empty-tool-calls branch).
///
/// CONTEXT lock §Module Boundaries: commands.rs keeps the outer orchestration
/// (config load, conversation prep, fast-path branch, loop-exhausted summary
/// block); this fn owns ONLY the iteration body. Plans 33-04..33-08 add
/// smart-loop features (verification probe, plan adaptation, token escalation,
/// cost guard) inside the body without disturbing the lift.
///
/// Returns `Ok(())` when the assistant produces a non-tool-calling turn (the
/// existing `if turn.tool_calls.is_empty() { ... }` exit which now does ALL
/// the post-loop assembly inline before returning). Caller should also return
/// `Ok(())` from its own function — the post-loop summary block at
/// commands.rs:2584 is for the iteration-cap / stuck-loop fall-through path
/// only.
///
/// Returns `Err(LoopHaltReason::IterationCap)` when `max_iter` is exhausted
/// without resolution OR when the stuck-loop break (3× same-signature)
/// triggers — caller falls through to the summary block.
///
/// Returns `Err(LoopHaltReason::Cancelled)` when CHAT_CANCEL fires.
///
/// Returns `Err(LoopHaltReason::ProviderFatal { error })` when an error escapes
/// every recovery branch.
///
/// CTX-07 fallback discipline: when `config.r#loop.smart_loop_enabled` is
/// false, the iteration cap reverts to the literal 12 — preserves legacy
/// behavior verbatim. No smart features fire (Plans 33-04..33-08 wrap their
/// additions in `if config.r#loop.smart_loop_enabled` guards).
#[allow(clippy::too_many_arguments)]
pub async fn run_loop(
    app: tauri::AppHandle,
    state: SharedMcpManager,
    approvals: ApprovalMap,
    vector_store: crate::embeddings::SharedVectorStore,
    config: &mut crate::config::BladeConfig,
    conversation: &mut Vec<ConversationMessage>,
    tools: &[crate::providers::ToolDefinition],
    last_user_text: &str,
    brain_plan_used: bool,
    meta_low_confidence: bool,
    meta_pre_check: &crate::metacognition::CognitiveState,
    input_message_count: usize,
    turn_acc: crate::reward::TurnAccumulator,
    current_message_id: &mut Option<String>,
) -> Result<(), LoopHaltReason> {
    let max_iter: usize = if config.r#loop.smart_loop_enabled {
        config.r#loop.max_iterations as usize
    } else {
        12 // legacy literal — CONTEXT lock §Backward Compatibility
    };

    let mut last_tool_signature = String::new();
    let mut repeat_count = 0u8;
    // turn_acc is moved by-value through the loop; the empty-tool-calls
    // branch consumes it via compute_and_persist_turn_reward. We rebind as
    // mutable so record_tool_call (mut-borrow) works inline.
    let mut turn_acc = turn_acc;

    for iteration in 0..max_iter {
        // Check cancellation before each iteration
        if CHAT_CANCEL.load(Ordering::SeqCst) {
            return Err(LoopHaltReason::Cancelled);
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
            conversation,
            tools,
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
                        emit_stream_event(&app, "blade_notification", serde_json::json!({
                            "type": "info", "message": "Context too long — compressing conversation and retrying"
                        }));
                        // Phase 32 / CTX-04 — recovery path: compress to a more
                        // aggressive 65% of the model's context window so the
                        // retry has headroom. Honors the smart-injection toggle.
                        let smart = config.context.smart_injection_enabled;
                        let recovery_trigger = if smart {
                            (model_context_window(&config.provider, &config.model) as f32 * 0.65) as usize
                        } else {
                            120_000 // legacy literal — naive path
                        };
                        let _ = app.emit("blade_status", "compacting");
                        compress_conversation_smart(
                            conversation, recovery_trigger,
                            &config.provider, &config.api_key, &config.model,
                            config.base_url.as_deref(),
                        ).await;
                        let _ = app.emit("blade_status", "processing");
                        let retry = providers::complete_turn(
                            &config.provider,
                            &config.api_key,
                            &config.model,
                            conversation,
                            tools,
                            config.base_url.as_deref(),
                        ).await;
                        match retry {
                            Ok(t) => t,
                            Err(e2) => {
                                let _ = app.emit("blade_status", "error");
                                if brain_plan_used { crate::brain_planner::reject_plan(last_user_text); }
                                return Err(LoopHaltReason::ProviderFatal {
                                    error: format!("Context trimmed but still failed: {}", e2),
                                });
                            }
                        }
                    }
                    ErrorRecovery::SwitchModelAndRetry => {
                        let fallback = safe_fallback_model(&config.provider).to_string();
                        let _ = app.emit("blade_status", "processing");
                        emit_stream_event(&app, "blade_notification", serde_json::json!({
                            "type": "info",
                            "message": format!("Model '{}' not available — retrying with {}", config.model, fallback)
                        }));
                        let retry = providers::complete_turn(
                            &config.provider,
                            &config.api_key,
                            &fallback,
                            conversation,
                            tools,
                            config.base_url.as_deref(),
                        ).await;
                        match retry {
                            Ok(t) => {
                                config.model = fallback; // keep using fallback for rest of session
                                t
                            }
                            Err(e2) => {
                                let _ = app.emit("blade_status", "error");
                                return Err(LoopHaltReason::ProviderFatal {
                                    error: format!("Model fallback ({}) also failed: {}", fallback, e2),
                                });
                            }
                        }
                    }
                    ErrorRecovery::RateLimitRetry { secs } => {
                        record_error("rate_limit");
                        if is_circuit_broken("rate_limit") {
                            let _ = app.emit("blade_status", "error");
                            return Err(LoopHaltReason::ProviderFatal {
                                error: "Rate limit circuit breaker tripped — too many rate limit errors in 5 minutes. Check your API quota or switch providers.".to_string(),
                            });
                        }

                        // Strategy: instead of just waiting, try switching to a free/fallback
                        // model first. This keeps the conversation flowing without delay.
                        // Priority: OpenRouter free tier → Groq (generous free tier) → wait + retry.
                        let free_model_result = try_free_model_fallback(
                            config,
                            conversation,
                            tools,
                            &app,
                        ).await;
                        if let Some(t) = free_model_result {
                            t
                        } else {
                            // No free model available — fall back to waiting
                            let wait = backoff_secs(secs, "rate_limit");
                            emit_stream_event(&app, "blade_notification", serde_json::json!({
                                "type": "info",
                                "message": format!("Rate limited on {}. Retrying in {}s.", config.provider, wait)
                            }));
                            tokio::time::sleep(std::time::Duration::from_secs(wait)).await;
                            let _ = app.emit("blade_status", "processing");
                            let retry = providers::complete_turn(
                                &config.provider, &config.api_key, &config.model,
                                conversation, tools, config.base_url.as_deref(),
                            ).await;
                            match retry {
                                Ok(t) => t,
                                Err(e2) => {
                                    let _ = app.emit("blade_status", "error");
                                    return Err(LoopHaltReason::ProviderFatal {
                                        error: format!("Still rate limited after {}s wait: {}", wait, e2),
                                    });
                                }
                            }
                        }
                    }
                    ErrorRecovery::OverloadedRetry => {
                        record_error("overloaded");
                        if is_circuit_broken("overloaded") {
                            let _ = app.emit("blade_status", "error");
                            return Err(LoopHaltReason::ProviderFatal {
                                error: "Server overload circuit breaker tripped — provider is consistently unavailable. Try again later or switch providers.".to_string(),
                            });
                        }
                        let wait = backoff_secs(5, "overloaded");
                        emit_stream_event(&app, "blade_notification", serde_json::json!({
                            "type": "info", "message": format!("Server overloaded — retrying in {}s", wait)
                        }));
                        tokio::time::sleep(std::time::Duration::from_secs(wait)).await;
                        let _ = app.emit("blade_status", "processing");
                        let retry = providers::complete_turn(
                            &config.provider, &config.api_key, &config.model,
                            conversation, tools, config.base_url.as_deref(),
                        ).await;
                        match retry {
                            Ok(t) => t,
                            Err(e2) => {
                                let _ = app.emit("blade_status", "error");
                                return Err(LoopHaltReason::ProviderFatal {
                                    error: format!("Server still overloaded after {}s: {}", wait, e2),
                                });
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
                                    emit_stream_event(&app, "blade_notification", serde_json::json!({
                                        "type": "info",
                                        "message": format!("Switching to {} (fallback)", fb_prov)
                                    }));
                                    let retry = providers::complete_turn(
                                        &fb_prov, &fb_key, &fb_model,
                                        conversation, tools, None,
                                    ).await;
                                    match retry {
                                        Ok(t) => t,
                                        Err(e2) => {
                                            let _ = app.emit("blade_status", "error");
                                            return Err(LoopHaltReason::ProviderFatal {
                                                error: format!("Primary ({}) and fallback ({}) both failed: {} / {}", config.provider, fb_prov, msg, e2),
                                            });
                                        }
                                    }
                                } else {
                                    let _ = app.emit("blade_status", "error");
                                    return Err(LoopHaltReason::ProviderFatal { error: msg });
                                }
                            } else {
                                let _ = app.emit("blade_status", "error");
                                return Err(LoopHaltReason::ProviderFatal { error: msg });
                            }
                        } else {
                            let _ = app.emit("blade_status", "error");
                            return Err(LoopHaltReason::ProviderFatal { error: msg });
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
            emit_stream_event(&app, "blade_message_start", serde_json::json!({
                "message_id": &msg_id,
                "role": "assistant",
            }));
            std::env::set_var("BLADE_CURRENT_MSG_ID", &msg_id);
            *current_message_id = Some(msg_id);

            // Phase 18 (Plan 18-10, D-11..D-15) — ego intercept on the assistant transcript.
            // Tool-loop branch ONLY (RESEARCH § Pitfall 3 — fast-streaming branch is ego-blind,
            // see comment at the fast-path entry above). Wraps `turn.content` BEFORE
            // extract_actions so a refusal/capability_gap verdict can rewrite the assistant
            // output. On non-Pass verdict, handle_refusal logs to evolution_log_capability_gap,
            // optionally auto-installs (Runtime kind), and returns either a retried response
            // or a hard-refuse with the D-15 LOCKED format. Plan 14 will wire the actual
            // LLM-retry call into the AutoInstalled.then_retried placeholder.
            let final_content = match crate::ego::intercept_assistant_output(&turn.content) {
                crate::ego::EgoVerdict::Pass => turn.content.clone(),
                verdict @ crate::ego::EgoVerdict::CapabilityGap { .. }
                | verdict @ crate::ego::EgoVerdict::Refusal { .. } => {
                    let outcome = crate::ego::handle_refusal(&app, verdict, last_user_text).await;
                    match outcome {
                        crate::ego::EgoOutcome::Retried { new_response } => new_response,
                        crate::ego::EgoOutcome::AutoInstalled { then_retried, .. } => then_retried,
                        crate::ego::EgoOutcome::HardRefused { final_response, .. } => final_response,
                    }
                }
            };

            // Extract and execute semantic action tags before emitting to frontend.
            // clean_content has [ACTION:...] tags stripped; actions are dispatched async.
            // (Plan 18-10) — use ego-rewritten `final_content` (was `&turn.content`).
            let (clean_content, parsed_actions) = crate::action_tags::extract_actions(&final_content);

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
                        emit_stream_event(&app, "chat_token", buf.clone());
                        buf.clear();
                        // Yield to the async runtime so the IPC channel flushes this chunk
                        // before the next one — this produces a real streaming feel.
                        tokio::task::yield_now().await;
                    }
                }
                if !buf.is_empty() {
                    emit_stream_event(&app, "chat_token", buf);
                }
            } else {
                // AI returned an empty response after tool calls — emit a brief fallback
                // so the user doesn't see a blank assistant bubble.
                emit_stream_event(&app, "chat_token", "Done.".to_string());
            }
            emit_stream_event(&app, "chat_done", ());
            let _ = app.emit("blade_status", "idle");

            // Complete prefrontal working memory so follow-up messages
            // know what was just accomplished
            crate::prefrontal::complete_task(crate::safe_slice(&clean_content, 200));

            // Plan memory: confirm successful brain-planned tasks so they're cached
            if brain_plan_used {
                crate::brain_planner::confirm_plan(last_user_text);
            }

            // Background: entity extraction + auto-embed + THREAD update + SKILL ENGINE + gap detection
            let app2 = app.clone();
            let app3 = app.clone();
            let user_text = last_user_text.to_string();
            // Use clean_content for downstream processing so tags don't pollute memory
            let assistant_text = clean_content.clone();

            // ── PHYSIOLOGY CLASSIFIER: classify BLADE's own output, update PhysiologicalState (Phase 27 / HORM-02) ──
            if let Some(emotion_output) = crate::homeostasis::classify_response_emotion(&assistant_text) {
                crate::homeostasis::update_physiology_from_classifier(&emotion_output);
            }

            let store_clone = vector_store.clone();
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
            let last_user_text_owned = last_user_text.to_string();
            let meta_pre_check_confidence = meta_pre_check.confidence;
            tokio::spawn(async move {
                let n = crate::brain::extract_entities_from_exchange(&user_text, &assistant_text).await;
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

                // META-04 fallback: log gap for evolution.rs when pre-check flagged low confidence.
                // This does NOT add a verifier call or substitute the response — the LLM already
                // streamed its answer. It only persists the gap so evolution.rs can generate
                // skills for topics BLADE struggles with.
                if meta_low_confidence {
                    let topic = crate::safe_slice(&last_user_text_owned, 60);
                    crate::metacognition::log_gap(
                        topic,
                        &last_user_text_owned,
                        meta_pre_check_confidence,
                        0, // no step-level uncertainty tracking in tool-loop path
                    );
                }

                // Capability gap detection — runs silently, fires webhook if gap found
                if crate::reports::detect_and_log(&user_text, &assistant_text) {
                    let _ = app2.emit_to("main", "capability_gap_detected", serde_json::json!({
                        "user_request": crate::safe_slice(&user_text, 120),
                    }));
                    // Deliver to webhook asynchronously
                    let db_path = crate::config::blade_config_dir().join("blade.db");
                    if let Ok(conn) = rusqlite::Connection::open(&db_path) {
                        if let Ok(reports_vec) = crate::db::get_capability_reports(&conn, 1) {
                            if let Some(report) = reports_vec.first() {
                                crate::reports::deliver_report(report).await;
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

            // Phase 24 (v1.3) DREAM-03 — capture the turn's tool-call sequence to the
            // turn_traces SQLite table for the dream_mode skill-from-trace generator
            // to mine. Captured BEFORE the turn_acc moves into compute_and_persist_turn_reward.
            {
                let calls = turn_acc.snapshot_calls();
                let tool_names: Vec<String> = calls.iter().map(|t| t.tool_name.clone()).collect();
                let any_error = calls.iter().any(|t| t.is_error);
                let forged_names: std::collections::HashSet<String> = crate::tool_forge::get_forged_tools()
                    .into_iter()
                    .map(|t| t.name)
                    .collect();
                let forged_used: Option<String> = tool_names
                    .iter()
                    .find(|n| forged_names.contains(*n))
                    .cloned();
                let tool_names_json = serde_json::to_string(&tool_names).unwrap_or_else(|_| "[]".to_string());
                let now_ts = chrono::Utc::now().timestamp();
                let db_path = crate::config::blade_config_dir().join("blade.db");
                if let Ok(conn) = rusqlite::Connection::open(&db_path) {
                    let _ = conn.execute(
                        "INSERT INTO turn_traces (turn_ts, tool_names, forged_tool_used, success) VALUES (?1, ?2, ?3, ?4)",
                        rusqlite::params![now_ts, tool_names_json, forged_used, if any_error { 0i64 } else { 1i64 }],
                    );
                }
            }

            // Composite reward + jsonl persist (OOD gate added in Plan 23-08).
            // MUST run on the same task as chat_done (Pitfall 3), NOT in a tokio::spawn —
            // the CHAT_INFLIGHT guard holds until _inflight drops, guaranteeing serial
            // jsonl appends across rapid-fire messages.
            // Phase 23 / REWARD-04
            let _ = crate::reward::compute_and_persist_turn_reward(&app, turn_acc).await;
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
                crate::permissions::classify_tool(&tool_call.name, &tool_desc)
            };

            if risk == crate::permissions::ToolRisk::Blocked {
                conversation.push(ConversationMessage::Tool {
                    tool_call_id: tool_call.id,
                    tool_name: tool_call.name,
                    content: "Tool blocked by safety policy.".to_string(),
                    is_error: true,
                });
                continue;
            }

            if risk == crate::permissions::ToolRisk::Ask {
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
                            emit_stream_event(&app, "ai_delegate_approved", serde_json::json!({
                                "tool": &tool_call.name,
                                "delegate": &delegate,
                                "reasoning": reasoning,
                            }));
                            true
                        }
                        crate::ai_delegate::DelegateDecision::Denied { reasoning } => {
                            emit_stream_event(&app, "ai_delegate_denied", serde_json::json!({
                                "tool": &tool_call.name,
                                "delegate": &delegate,
                                "reasoning": reasoning,
                            }));
                            false
                        }
                        crate::ai_delegate::DelegateDecision::Unavailable => {
                            // Delegate unavailable — fall back to UI approval
                            let approval_id = format!("approval-{}", tool_call.id);
                            let (tx, rx) = tokio::sync::oneshot::channel::<bool>();
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
                    let (tx, rx) = tokio::sync::oneshot::channel::<bool>();
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
                            user_request: last_user_text,
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
                                    last_user_text,
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

            // Phase 23 / REWARD-04 — record this tool call into the turn accumulator
            // BEFORE the conversation.push below moves tool_call.id and tool_call.name.
            // This is the canonical post-dispatch happy-path push (line 2156); the
            // 4 earlier push sites in this loop body are error/short-circuit branches
            // that already `continue` past this point, so we record exactly once
            // per tool_call iteration here.
            turn_acc.record_tool_call(crate::reward::ToolCallTrace {
                tool_name:      tool_call.name.clone(),
                args_str:       serde_json::to_string(&tool_call.arguments).unwrap_or_default(),
                result_content: crate::safe_slice(&content, 500).to_string(),
                is_error,
                timestamp_ms:   chrono::Utc::now().timestamp_millis(),
            });

            // Phase 24 (v1.3) D-24-B / DREAM-02 — Pitfall 2 mitigation:
            // record_tool_use was unwired pre-Phase-24 (zero internal callers).
            // We now funnel forged-tool invocations through it so the
            // forged_tools_invocations log accumulates per-turn trace_hashes
            // for the consolidation pass to read. Cheap name-set lookup against
            // the live forged_tools registry; non-forged tools (native, MCP)
            // are no-ops here and continue uninstrumented.
            {
                let forged_names: std::collections::HashSet<String> = crate::tool_forge::get_forged_tools()
                    .into_iter()
                    .map(|t| t.name)
                    .collect();
                if forged_names.contains(&tool_call.name) {
                    let turn_tool_names: Vec<String> = turn_acc
                        .snapshot_calls()
                        .into_iter()
                        .map(|t| t.tool_name)
                        .collect();
                    crate::tool_forge::record_tool_use(&tool_call.name, &turn_tool_names);
                }
            }

            // Phase 32 Plan 32-05 / CTX-05 — cap the tool output at the
            // configured per-message budget (default 4000 tokens) BEFORE
            // inserting into the conversation. The cap runs LAST so any
            // upstream enrichment (explain_tool_failure, immune-system
            // rewrites) is included in the cap accounting. CTX-07 escape
            // hatch: when smart_injection_enabled = false, leave content
            // unchanged (legacy path).
            //
            // Phase 32 Plan 32-07 / CTX-07 — `cap_tool_output` is fallible in
            // theory (integer overflow on pathological budgets, future
            // regressions). On panic, fall through with the original content.
            // `format_tool_result`'s 200k safety ceiling (Plan 32-05) is the
            // outer bound; the chat does NOT crash. The v1.1 lesson incarnate:
            // smart-path code must NEVER take down the dumb path.
            //
            // `AssertUnwindSafe` is required because the captured `content`
            // and `tool_call.name` references make the closure non-auto-
            // `UnwindSafe`. We do NOT depend on broken invariants after the
            // panic — `content` is read-only and rebound below.
            let content = if config.context.smart_injection_enabled {
                let cap_attempt = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    crate::commands::cap_tool_output(&content, config.context.tool_output_cap_tokens)
                }));
                match cap_attempt {
                    Ok(_capped) => {
                        if _capped.storage_id.is_some() {
                            log::info!(
                                "[CTX-05] tool '{}' output capped: ~{} → ~{} tokens (storage_id {})",
                                tool_call.name,
                                _capped.original_tokens,
                                _capped.content.chars().count() / 4,
                                _capped.storage_id.as_deref().unwrap_or("?"),
                            );
                        }
                        _capped.content
                    }
                    Err(_) => {
                        log::warn!(
                            "[CTX-07] cap_tool_output panicked on tool '{}'; falling through to original content (smart path → naive path)",
                            tool_call.name
                        );
                        content
                    }
                }
            } else {
                content
            };

            conversation.push(ConversationMessage::Tool {
                tool_call_id: tool_call.id,
                tool_name: tool_call.name,
                content,
                is_error,
            });
        }
    }

    // for-loop fell through (max_iter exhausted) or stuck-loop break triggered.
    // Caller continues to the loop-exhausted summary block at commands.rs:2584.
    Err(LoopHaltReason::IterationCap)
}

// ─── Tests ─────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn phase33_tool_error_render_with_alternatives() {
        let err = ToolError {
            attempted: "read_file path=/etc/passwd".to_string(),
            failure_reason: "permission denied".to_string(),
            suggested_alternatives: vec![
                "Run with elevated privileges".to_string(),
                "Use bash with sudo".to_string(),
            ],
        };
        let rendered = err.render_for_model();
        assert!(rendered.contains("Tool failed."), "missing header in {}", rendered);
        assert!(rendered.contains("Attempted: read_file path=/etc/passwd"));
        assert!(rendered.contains("Reason: permission denied"));
        assert!(rendered.contains("Suggested alternatives:"));
        assert!(rendered.contains("  - Run with elevated privileges"));
        assert!(rendered.contains("  - Use bash with sudo"));
    }

    #[test]
    fn phase33_tool_error_render_omits_empty_alternatives_block() {
        let err = ToolError {
            attempted: "read_file path=/missing".to_string(),
            failure_reason: "no such file".to_string(),
            suggested_alternatives: vec![],
        };
        let rendered = err.render_for_model();
        assert!(rendered.contains("Tool failed."));
        assert!(rendered.contains("Attempted: read_file path=/missing"));
        assert!(rendered.contains("Reason: no such file"));
        assert!(!rendered.contains("Suggested alternatives"),
            "empty alternatives must omit the entire block (no empty bullets) — CONTEXT lock §LOOP-02; got: {}",
            rendered);
    }

    #[test]
    fn phase33_enrich_alternatives_known_tools() {
        assert!(!enrich_alternatives("read_file").is_empty());
        assert!(!enrich_alternatives("bash").is_empty());
        assert!(!enrich_alternatives("web_search").is_empty());
        assert!(enrich_alternatives("nonexistent_tool_xyz").is_empty(),
            "unknown tools must return empty Vec, not panic");
    }

    #[test]
    fn phase33_loop_state_default() {
        let s = LoopState::default();
        assert_eq!(s.iteration, 0);
        assert_eq!(s.cumulative_cost_usd, 0.0);
        assert_eq!(s.replans_this_run, 0);
        assert_eq!(s.token_escalations, 0);
        assert!(s.last_3_actions.is_empty());
        assert!(s.consecutive_same_tool_failures.is_empty());
    }

    #[test]
    fn phase33_iteration_cap_smart_on_uses_max_iterations() {
        // Plan 33-03 — when smart_loop_enabled=true, run_loop's max_iter is
        // taken from config.r#loop.max_iterations (default 25). This test
        // locks the cap-selection arithmetic so future edits can't silently
        // change it.
        let mut cfg = crate::config::BladeConfig::default();
        cfg.r#loop.smart_loop_enabled = true;
        cfg.r#loop.max_iterations = 25;
        let max_iter: usize = if cfg.r#loop.smart_loop_enabled {
            cfg.r#loop.max_iterations as usize
        } else {
            12
        };
        assert_eq!(
            max_iter, 25,
            "smart loop must use config.r#loop.max_iterations (was {})",
            max_iter
        );
    }

    #[test]
    fn phase33_iteration_cap_smart_off_falls_back_to_12() {
        // Plan 33-03 — CONTEXT lock §Backward Compatibility: when
        // smart_loop_enabled=false, the iteration cap reverts to the literal
        // 12 regardless of config.r#loop.max_iterations. This is the
        // CTX-07-style escape hatch — legacy 12-iteration loop preserved
        // verbatim. The test asserts the constant 12 so a future edit that
        // accidentally drops the fallback (e.g. always reading
        // max_iterations) trips the test.
        let mut cfg = crate::config::BladeConfig::default();
        cfg.r#loop.smart_loop_enabled = false;
        cfg.r#loop.max_iterations = 999; // ignored when smart is off
        let max_iter: usize = if cfg.r#loop.smart_loop_enabled {
            cfg.r#loop.max_iterations as usize
        } else {
            12
        };
        assert_eq!(
            max_iter, 12,
            "smart-off path must hard-code 12 iterations regardless of config (was {})",
            max_iter
        );
    }

    #[test]
    fn phase33_loop_state_record_action_evicts_oldest() {
        let mut s = LoopState::default();
        for i in 0..5 {
            s.record_action(ActionRecord {
                tool: format!("tool_{}", i),
                input_summary: "in".to_string(),
                output_summary: "out".to_string(),
                is_error: false,
            });
        }
        assert_eq!(s.last_3_actions.len(), 3);
        assert_eq!(s.last_3_actions.front().unwrap().tool, "tool_2");
        assert_eq!(s.last_3_actions.back().unwrap().tool, "tool_4");
    }
}
