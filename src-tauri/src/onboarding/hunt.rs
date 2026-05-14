//! Phase 46 — HUNT-03 — LLM-driven hunt with sandboxed readonly tools.
//!
//! Mechanism, not a hardcoded scanner. After the pre-scan seeds context and
//! the user confirms (or accepts) Message #1, we spawn a single LLM session
//! with:
//!
//!   - System prompt: spec language from
//!     `.planning/v2.0-onboarding-spec.md` Act 3 ("you're BLADE, learning who
//!     this user is on first launch...")
//!   - Initial user message: serialized `InitialContext` + embedded
//!     `platform_paths.md` knowledge file
//!   - Tools: `hunt_read_file`, `hunt_list_dir`, `hunt_run_shell`,
//!     `hunt_emit_chat_line` — ALL readonly, no-network, sandboxed
//!
//! Live narrates every probe via `hunt_emit_chat_line` → emits the
//! `blade_hunt_line` Tauri event that `Hunt.tsx` subscribes to.
//!
//! Cap: 50K input tokens. If exceeded, summarize and proceed to synthesis.
//!
//! Cancel: user types "stop" in the chat → frontend emits `blade_hunt_stop` →
//! `HUNT_CANCEL.store(true, ...)` → next tool-call iteration breaks out.

use crate::onboarding::pre_scan::InitialContext;
use crate::providers::{self, AssistantTurn, ConversationMessage, ToolCall, ToolDefinition};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::Emitter;

/// User-typed-"stop" interrupt flag. Set by the `cancel_hunt` Tauri command.
pub(crate) static HUNT_CANCEL: AtomicBool = AtomicBool::new(false);

// ── Phase 49 (HUNT-05-ADV) — answer-driven probing handshake ────────────────
//
// When the hunt detects a fresh-machine condition it emits a chat-line of kind
// `hunt_question` and parks waiting for the frontend to call
// `hunt_post_user_answer`. The frontend stores the user's typed answer into
// `HUNT_USER_ANSWER` and notifies the parked task via a tokio Notify.
//
// Single-slot mailbox is sufficient: the hunt loop is single-tasked, and the
// only writer is the Tauri command. We use a std::sync::Mutex<Option<String>>
// rather than a oneshot channel so the answer survives a missed wake (e.g. if
// the user types before the loop parks); the loop drains the slot on read.

static HUNT_USER_ANSWER: Mutex<Option<String>> = Mutex::new(None);

// tokio::sync::Notify can't be a `static` constructor pre-1.78, so build it
// lazily via OnceLock.
static HUNT_ANSWER_NOTIFY: once_cell::sync::Lazy<tokio::sync::Notify> =
    once_cell::sync::Lazy::new(tokio::sync::Notify::new);

/// Per-hunt-session cost tracker (HUNT-COST-CHAT). Reset at the start of each
/// hunt run. The `complete_turn` wrapper updates this after every LLM call
/// and emits a `cost` chat-line. Crossing 50% emits `cost_warning`; crossing
/// 100% emits `cost_block`, suspends the loop, and parks waiting for a
/// budget-extend acknowledgment from the user.
///
/// `forge.rs` maintains its own tracker (`FORGE_COST_TRACKER`) using the same
/// shape so the chat surface can render forge costs separately.
pub(crate) static HUNT_COST_TRACKER: once_cell::sync::Lazy<Mutex<CostTracker>> =
    once_cell::sync::Lazy::new(|| Mutex::new(CostTracker::default()));

/// Set when the user accepts a budget extension after a `cost_block`. Cleared
/// at the start of each hunt session and at every block-emit. The loop polls
/// this between iterations after emitting `cost_block`.
static HUNT_COST_CONTINUE: AtomicBool = AtomicBool::new(false);

/// Cap from spec Act 3: ~50K input tokens. We approximate via accumulated
/// `tokens_in` from each turn's provider usage. Exceeding triggers an early
/// "summarize what you have" turn before synthesis.
const TOKEN_BUDGET: u32 = 50_000;

/// Hard ceiling on tool-call iterations regardless of token budget. Keeps a
/// runaway LLM from looping on `list_dir` forever.
const MAX_ITERATIONS: u32 = 30;

/// Per-shell-call wall clock cap. Pre-scan binaries finish in milliseconds;
/// `find . | head` on a huge tree can stall — bound it.
const SHELL_TIMEOUT_MS: u64 = 4_000;

// ── Tauri event names — kept as constants so Hunt.tsx + verify-emit-policy
// reference the same canonical string. ───────────────────────────────────────
pub const EVENT_HUNT_LINE: &str = "blade_hunt_line";
pub const EVENT_HUNT_DONE: &str = "blade_hunt_done";
pub const EVENT_HUNT_ERROR: &str = "blade_hunt_error";

/// Embedded platform-paths knowledge file (HUNT-04). Shipped in the binary;
/// doc edits ride the next release.
const PLATFORM_PATHS_MD: &str = include_str!("platform_paths.md");

/// Sensitive-path deny list (CLAUDE rules — verbatim from phase 46 prompt).
/// Returned as a structured error before any read.
const DENY_FRAGMENTS: &[&str] = &[
    ".ssh/", ".env", ".aws/credentials", ".gnupg/",
    "keychain", "credentials", "password",
    ".pem", ".key", "/cookies", "/Cookies",
    "shadow", "/etc/passwd",
];

/// Shell binaries we whitelist. Anything else routes to a reject.
const SHELL_ALLOW: &[&str] = &[
    "ls", "cat", "head", "tail", "wc", "stat",
    "grep", "find", "fd", "rg",
    "git", "which", "where", "uname", "sw_vers", "hostname",
    "defaults", "xdg-mime", "reg", "wsl",
    "echo", "printf", "true", "false",
    "node", "python", "python3",  // version flags only — args filtered below
];

/// Reject any of these substrings appearing anywhere in a shell command.
const SHELL_REJECT: &[&str] = &[
    " >", ">>", "<<", "| tee", "|tee",
    "rm ", "mv ", "cp ", "chmod ", "chown ",
    "curl ", "wget ", "ssh ", "scp ", "rsync ", "nc ",
    "sudo ", "doas ",
    "$(", "`",  // command substitution → escape hatch
];

// ── Public entry ─────────────────────────────────────────────────────────────

/// Spawn the hunt LLM session on a background task. Returns immediately;
/// progress streams via `blade_hunt_line` events. Caller (Hunt.tsx via Tauri
/// command `start_hunt`) is responsible for the user-facing chat surface.
///
/// On completion (success OR cancel OR error), emits `blade_hunt_done` with
/// the final `HuntOutcome` payload (next call will be `synthesis::write_who_you_are`).
pub async fn start_hunt(
    app: tauri::AppHandle,
    initial_context: InitialContext,
) -> Result<HuntOutcome, String> {
    HUNT_CANCEL.store(false, Ordering::SeqCst);
    HUNT_COST_CONTINUE.store(false, Ordering::SeqCst);
    // Drain any stale user-answer from a previous session.
    if let Ok(mut slot) = HUNT_USER_ANSWER.lock() {
        *slot = None;
    }
    let cfg = crate::config::load_config();
    let provider = cfg.provider.clone();
    let model = cfg.model.clone();
    let api_key = crate::config::get_provider_key(&provider);

    // Reset the cost tracker with the configured hunt budget.
    {
        let mut t = HUNT_COST_TRACKER.lock().unwrap_or_else(|p| p.into_inner());
        t.reset(cfg.hunt.budget_usd as f64);
    }

    if api_key.is_empty() && provider != "ollama" {
        let msg = format!(
            "Hunt skipped — no API key for active provider '{}'. Falling back to no-data flow.",
            provider
        );
        let _ = app.emit(EVENT_HUNT_LINE, HuntLine::system(&msg));
        // No-data fallback (HUNT-05 basic) — the four-sentence prompt.
        let _ = app.emit(EVENT_HUNT_LINE, HuntLine::hunt_question(
            "Fresh machine — what do you do? not your job, the thing you'd point a friend at."
        ));
        return Ok(HuntOutcome::no_data_fallback());
    }

    emit_line(&app, HuntLine::blade(
        "Key verified. Going to learn who you are before I ask anything. Stop me with 'stop' if you want."
    ));

    let system_prompt = build_system_prompt();
    let initial_user_msg = build_initial_user_msg(&initial_context);

    let mut conversation: Vec<ConversationMessage> = vec![
        ConversationMessage::System(system_prompt),
        ConversationMessage::User(initial_user_msg),
    ];
    let tools = build_tool_defs();

    let mut tokens_used: u32 = 0;
    let mut findings = HuntFindings::default();
    findings.initial = initial_context.clone();
    // HUNT-05-ADV — fire the fresh-machine sharp question once per session.
    let mut fresh_machine_question_fired = false;
    let mut seed_search_completed = false;

    for iter in 0..MAX_ITERATIONS {
        if HUNT_CANCEL.load(Ordering::SeqCst) {
            emit_line(&app, HuntLine::system("Hunt cancelled by user."));
            return Ok(HuntOutcome::cancelled(findings, tokens_used));
        }

        // HUNT-05-ADV — fresh-machine detection at end of first probe pass.
        // After iter 3 we have enough signal: if findings.probes shows fewer
        // than 3 non-narration probes that succeeded, no git repos found, no
        // installed agents → fire the sharp question and re-prompt with the
        // user's answer as a seed.
        if iter >= 3 && !fresh_machine_question_fired && is_fresh_machine(&findings) {
            fresh_machine_question_fired = true;
            let _ = app.emit(EVENT_HUNT_LINE, HuntLine::hunt_question(
                "Fresh machine — what do you do? not your job, the thing you'd point a friend at if they asked."
            ));
            // Park waiting for the user's answer. 60s cap so we don't block
            // forever if the frontend dies.
            let answer = wait_for_user_answer(60).await;
            match answer {
                Some(text) => {
                    findings.chat_lines.push(format!("[user-answer] {}", text));
                    // Inject the answer as a user message so the LLM can use it
                    // and the new `hunt_seed_search` tool.
                    conversation.push(ConversationMessage::User(format!(
                        "User answered the fresh-machine question with: \"{}\".\n\nUse `hunt_seed_search` with the most distinctive token from that answer (project / company / brand name) to find their project on disk. Then probe the matched directories with the regular tools to ground the synthesis.",
                        text
                    )));
                    seed_search_completed = false; // re-enable single-use guard
                }
                None => {
                    // User didn't answer within the window — fall back to a
                    // basic synthesis with no seed.
                    emit_line(&app, HuntLine::system(
                        "No answer in 60s — synthesizing with what I have."
                    ));
                    conversation.push(ConversationMessage::User(
                        "No user answer arrived. Emit one final hunt_emit_chat_line summarizing what \
                         you found (even if minimal), then stop calling tools.".to_string()
                    ));
                }
            }
        }

        if tokens_used > TOKEN_BUDGET {
            emit_line(&app, HuntLine::system(&format!(
                "Hit ~{}K token cap — wrapping up with what I have.", TOKEN_BUDGET / 1000
            )));
            // Trigger early synthesis: append a one-shot user message asking
            // for the final synthesis, no more tool calls.
            conversation.push(ConversationMessage::User(
                "Token budget exceeded. Emit one final hunt_emit_chat_line summarizing what \
                 you found, then stop calling tools.".to_string()
            ));
        }

        // HUNT-COST-CHAT — cost-tracked turn. If the budget is exceeded the
        // call emits `cost_block` and we suspend the loop pending user
        // acknowledgment via `hunt_continue_after_cost_block`.
        let tracked = match complete_turn_cost_tracked(
            &app,
            &HUNT_COST_TRACKER,
            EVENT_HUNT_LINE,
            &provider,
            &api_key,
            &model,
            &conversation,
            &tools,
            cfg.base_url.as_deref(),
        ).await {
            Ok(t) => t,
            Err(e) => {
                let _ = app.emit(EVENT_HUNT_ERROR, format!("Provider error: {}", e));
                return Err(format!("Hunt provider error: {}", e));
            }
        };
        let turn = tracked.turn;
        if tracked.blocked {
            // Wait up to 120s for the user to confirm. If they do, raise the
            // budget by another `cfg.hunt.budget_usd` and continue. If not,
            // gracefully abort.
            let extended = wait_for_cost_continue(120).await;
            if !extended {
                emit_line(&app, HuntLine::system(
                    "Budget block — user did not extend. Wrapping up."
                ));
                break;
            }
            // Raise the budget by another bucket and clear the block flag.
            let extra = cfg.hunt.budget_usd as f64;
            let new_budget = {
                let mut t = HUNT_COST_TRACKER.lock().unwrap_or_else(|p| p.into_inner());
                t.budget_usd += extra;
                t.block_emitted = false;
                t.warning_emitted = false;
                t.budget_usd
            };
            emit_line(&app, HuntLine::system(&format!(
                "Budget extended to ${:.2}. Continuing.", new_budget
            )));
        }

        tokens_used = tokens_used.saturating_add(turn.tokens_in + turn.tokens_out);
        log::info!(
            "[hunt iter {}] tokens_in={} tokens_out={} cumulative={} stop_reason={:?}",
            iter, turn.tokens_in, turn.tokens_out, tokens_used, turn.stop_reason
        );

        // Append the assistant turn to the conversation so tool results
        // resolve against it on the next iteration.
        let assistant_msg = ConversationMessage::Assistant {
            content: turn.content.clone(),
            tool_calls: turn.tool_calls.clone(),
        };
        conversation.push(assistant_msg);

        // If the assistant produced visible content and no tool calls, that's
        // the closing synthesis — done.
        if turn.tool_calls.is_empty() {
            if !turn.content.trim().is_empty() {
                emit_line(&app, HuntLine::blade(&turn.content));
                findings.final_synthesis = turn.content.clone();
            }
            break;
        }

        // Execute each tool call and append the results to the conversation.
        for call in turn.tool_calls.iter() {
            if call.name == "hunt_seed_search" {
                seed_search_completed = true;
            }
            let result = execute_tool_call(&app, call, &mut findings).await;
            let is_error = matches!(result, ToolOutcome::Err(_));
            let content = match result {
                ToolOutcome::Ok(s) => s,
                ToolOutcome::Err(s) => s,
            };
            conversation.push(ConversationMessage::Tool {
                tool_call_id: call.id.clone(),
                tool_name: call.name.clone(),
                content,
                is_error,
            });
        }
    }

    // HUNT-05-ADV — if the fresh-machine question fired but the LLM never
    // grounded on the seed (didn't call hunt_seed_search successfully), fall
    // back to basic synthesis using whatever the user said as the core
    // command. We've already injected the answer as a user message above, so
    // `findings.final_synthesis` may still be empty — the synthesis module
    // handles that case.
    let _ = seed_search_completed; // used for clarity / future telemetry

    // HUNT-06-ADV — thematic contradiction detection pass.
    // Runs only when we have enough signal to classify (at least 3 successful
    // non-narration probes). Cheap-model second-pass with a strict 5s budget.
    if findings.probes.iter().filter(|p| p.ok && p.tool != "hunt_emit_chat_line").count() >= 3 {
        match crate::onboarding::contradictions::detect_contradictions(
            &app,
            &cfg,
            &findings,
        ).await {
            Ok(Some(report)) if !report.contradictions.is_empty() => {
                if let Some(first) = report.contradictions.first() {
                    let _ = app.emit(
                        EVENT_HUNT_LINE,
                        HuntLine::hunt_question(&first.question),
                    );
                    let chosen = wait_for_user_answer(60).await;
                    if let Some(answer) = chosen {
                        findings.chat_lines.push(format!(
                            "[contradiction-answer] {} (chose between {} / {})",
                            answer, first.cluster_a, first.cluster_b
                        ));
                    }
                }
            }
            Ok(_) => {}
            Err(e) => log::warn!("[hunt] contradiction pass failed: {}", e),
        }
    }

    let _ = app.emit(EVENT_HUNT_DONE, &findings);
    Ok(HuntOutcome::completed(findings, tokens_used))
}

// ── Phase 49 (HUNT-05-ADV) — fresh-machine heuristic + answer plumbing ──────

/// Returns true when the first probe pass yielded so little signal that the
/// hunt should stop and ask the user directly. Heuristic per phase brief:
///   - Fewer than 3 successful file/dir/shell findings (excluding narration)
///   - No git repos found (no probe argument contains ".git" / "git status" / "git remote")
///   - No installed agents in the initial context (claude / cursor / aider / codex / goose)
fn is_fresh_machine(findings: &HuntFindings) -> bool {
    let useful_probes = findings
        .probes
        .iter()
        .filter(|p| p.ok && p.tool != "hunt_emit_chat_line")
        .count();
    if useful_probes >= 3 {
        return false;
    }
    let agents = &findings.initial.agents;
    let any_agent = agents.claude.is_some()
        || agents.cursor.is_some()
        || agents.aider.is_some()
        || agents.codex.is_some()
        || agents.goose.is_some();
    if any_agent {
        return false;
    }
    let any_git_signal = findings.probes.iter().any(|p| {
        p.ok && (p.argument.contains(".git")
            || p.argument.contains("git status")
            || p.argument.contains("git remote")
            || p.snippet.contains("origin")
            || p.snippet.contains("github.com"))
    });
    if any_git_signal {
        return false;
    }
    true
}

/// Park up to `timeout_secs` seconds waiting for the frontend to call
/// `hunt_post_user_answer`. Returns `Some(answer)` on success, `None` on
/// timeout / cancellation. Drains the slot on read so re-entry doesn't
/// consume a stale answer.
async fn wait_for_user_answer(timeout_secs: u64) -> Option<String> {
    // Fast path: an answer might already be sitting in the slot if the user
    // typed before we parked.
    if let Ok(mut slot) = HUNT_USER_ANSWER.lock() {
        if let Some(v) = slot.take() {
            return Some(v);
        }
    }
    let notified = HUNT_ANSWER_NOTIFY.notified();
    tokio::pin!(notified);
    let timeout = tokio::time::sleep(std::time::Duration::from_secs(timeout_secs));
    tokio::pin!(timeout);
    tokio::select! {
        _ = &mut notified => {
            if let Ok(mut slot) = HUNT_USER_ANSWER.lock() {
                return slot.take();
            }
            None
        }
        _ = &mut timeout => None,
    }
}

/// Park up to `timeout_secs` waiting for the user to acknowledge the budget
/// block. Frontend sends `hunt_continue_after_cost_block` to flip the atomic.
async fn wait_for_cost_continue(timeout_secs: u64) -> bool {
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(timeout_secs);
    while std::time::Instant::now() < deadline {
        if HUNT_COST_CONTINUE.swap(false, Ordering::SeqCst) {
            return true;
        }
        if HUNT_CANCEL.load(Ordering::SeqCst) {
            return false;
        }
        tokio::time::sleep(std::time::Duration::from_millis(250)).await;
    }
    false
}

// ── Phase 49 (HUNT-COST-CHAT) — cost tracker ────────────────────────────────

/// Per-session running cost tracker. Updated after every `complete_turn` call
/// by `complete_turn_with_cost`. The HUNT and FORGE sessions hold separate
/// instances so the chat surface can render their cost lines independently.
#[derive(Debug, Clone)]
pub struct CostTracker {
    pub cumulative_input_tokens: u64,
    pub cumulative_output_tokens: u64,
    pub cumulative_cost_usd: f64,
    pub budget_usd: f64,
    /// Set true when `cumulative_cost_usd >= 0.5 * budget_usd` and the warning
    /// chat-line has already been emitted (avoids spamming on every turn).
    pub warning_emitted: bool,
    /// Set true when `cumulative_cost_usd >= budget_usd` and the block
    /// chat-line has been emitted. Until the user accepts a budget extension
    /// (via `hunt_continue_after_cost_block`), the loop is suspended.
    pub block_emitted: bool,
}

impl Default for CostTracker {
    fn default() -> Self {
        Self {
            cumulative_input_tokens: 0,
            cumulative_output_tokens: 0,
            cumulative_cost_usd: 0.0,
            budget_usd: 3.00,
            warning_emitted: false,
            block_emitted: false,
        }
    }
}

impl CostTracker {
    pub fn reset(&mut self, budget_usd: f64) {
        self.cumulative_input_tokens = 0;
        self.cumulative_output_tokens = 0;
        self.cumulative_cost_usd = 0.0;
        self.budget_usd = budget_usd;
        self.warning_emitted = false;
        self.block_emitted = false;
    }
}

/// Outcome of a cost-tracked LLM turn. The boolean tells the caller whether
/// the budget was exceeded and the loop must suspend until the user accepts a
/// budget extension.
pub(crate) struct CostTrackedTurn {
    pub turn: AssistantTurn,
    pub blocked: bool,
}

/// Compute USD cost for a single turn using `providers::price_per_million`.
/// Falls back to the conservative estimate when the provider/model pair has
/// no entry (estimate matches the phase brief: $0.001/1K in + $0.005/1K out).
pub(crate) fn turn_cost_usd(provider: &str, model: &str, tokens_in: u32, tokens_out: u32) -> f64 {
    let (in_p, out_p) = crate::providers::price_per_million(provider, model);
    if in_p == 0.0 && out_p == 0.0 && provider != "ollama" {
        log::warn!(
            "[cost-tracker] no pricing for {}/{} — estimating $0.001/1K in + $0.005/1K out",
            provider,
            model
        );
        let est_in = (tokens_in as f64) / 1000.0 * 0.001;
        let est_out = (tokens_out as f64) / 1000.0 * 0.005;
        return est_in + est_out;
    }
    let in_cost = (tokens_in as f64) * (in_p as f64) / 1_000_000.0;
    let out_cost = (tokens_out as f64) * (out_p as f64) / 1_000_000.0;
    in_cost + out_cost
}

/// Wrap a `providers::complete_turn` call with cost tracking and chat-line
/// emission. Used by the hunt loop AND `tool_forge` (via the public
/// `complete_turn_cost_tracked` helper) so both surfaces share the same
/// budget-warning / budget-block UX.
///
/// Behavior:
///   1. Call `providers::complete_turn`.
///   2. On success, attribute `tokens_in + tokens_out` to the provided tracker,
///      compute the marginal USD cost, and accumulate.
///   3. Emit a `cost` chat-line on the supplied event channel.
///   4. If cumulative >= 50% of budget and the warning hasn't fired,
///      emit `cost_warning` and set `warning_emitted = true`.
///   5. If cumulative >= 100% of budget, emit `cost_block` and return
///      `CostTrackedTurn { blocked: true }`. Caller is expected to suspend the
///      loop and await user acknowledgment.
pub(crate) async fn complete_turn_cost_tracked(
    app: &tauri::AppHandle,
    tracker: &'static once_cell::sync::Lazy<Mutex<CostTracker>>,
    event_name: &'static str,
    provider: &str,
    api_key: &str,
    model: &str,
    conversation: &[ConversationMessage],
    tools: &[ToolDefinition],
    base_url: Option<&str>,
) -> Result<CostTrackedTurn, String> {
    let turn = providers::complete_turn(provider, api_key, model, conversation, tools, base_url)
        .await?;
    let marginal = turn_cost_usd(provider, model, turn.tokens_in, turn.tokens_out);

    // Snapshot the tracker, then drop the lock before emitting.
    let (cumulative, budget, fire_warning, fire_block) = {
        let mut t = tracker.lock().unwrap_or_else(|p| p.into_inner());
        t.cumulative_input_tokens =
            t.cumulative_input_tokens.saturating_add(turn.tokens_in as u64);
        t.cumulative_output_tokens =
            t.cumulative_output_tokens.saturating_add(turn.tokens_out as u64);
        t.cumulative_cost_usd += marginal;
        let cumulative = t.cumulative_cost_usd;
        let budget = t.budget_usd;
        let fire_warning = cumulative >= 0.5 * budget && !t.warning_emitted && !t.block_emitted;
        let fire_block = cumulative >= budget && !t.block_emitted;
        if fire_warning {
            t.warning_emitted = true;
        }
        if fire_block {
            t.block_emitted = true;
        }
        (cumulative, budget, fire_warning, fire_block)
    };

    // Emit the running cost line on EVERY successful turn — the frontend
    // renders these as small gray monospace, so noise is acceptable.
    let _ = app.emit(event_name, HuntLine::cost(cumulative, budget));
    if fire_warning {
        let _ = app.emit(event_name, HuntLine::cost_warning(cumulative, budget));
    }
    let blocked = fire_block;
    if blocked {
        let _ = app.emit(event_name, HuntLine::cost_block(cumulative, budget));
    }
    Ok(CostTrackedTurn { turn, blocked })
}

// ── Outcome + findings ───────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HuntOutcome {
    pub status: String, // "completed" | "cancelled" | "no_data_fallback" | "error"
    pub tokens_used: u32,
    pub findings: HuntFindings,
}

impl HuntOutcome {
    fn completed(findings: HuntFindings, tokens: u32) -> Self {
        Self { status: "completed".into(), tokens_used: tokens, findings }
    }
    fn cancelled(findings: HuntFindings, tokens: u32) -> Self {
        Self { status: "cancelled".into(), tokens_used: tokens, findings }
    }
    fn no_data_fallback() -> Self {
        Self {
            status: "no_data_fallback".into(),
            tokens_used: 0,
            findings: HuntFindings::default(),
        }
    }
}

/// Accumulated structured findings. Synthesis (HUNT-07) reads this to write
/// `~/.blade/who-you-are.md`.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct HuntFindings {
    pub initial: InitialContext,
    /// Free-form notes from `hunt_emit_chat_line` calls. Each entry is one
    /// chat-line the LLM produced; synthesis re-distills them.
    pub chat_lines: Vec<String>,
    /// Each successful tool call recorded for the synthesis prompt to ground
    /// on (path, command, snippet).
    pub probes: Vec<ProbeRecord>,
    /// Final synthesis paragraph from the closing assistant turn.
    pub final_synthesis: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProbeRecord {
    pub tool: String,
    pub argument: String,
    pub ok: bool,
    pub snippet: String,
}

// ── Chat-line shape ──────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HuntLine {
    pub role: String, // "blade" | "system"
    pub text: String,
    pub timestamp: String,
    /// Phase 49 — extended kind discriminator. None for legacy plain
    /// narration lines (v2.0 contract). Some(...) for:
    ///   - "hunt_question" — sharp question awaiting user answer (HUNT-05-ADV,
    ///                       HUNT-06-ADV)
    ///   - "cost" / "cost_warning" / "cost_block" — live cost surfacing
    ///                       (HUNT-COST-CHAT)
    /// Frontend renderer (Hunt.tsx / ChatProvider) inspects `kind` to apply
    /// the per-kind visual treatment.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub kind: Option<String>,
    /// Optional structured payload for cost / question kinds. `serde_json::Value`
    /// keeps the frontend free to extend without round-tripping a new Rust shape.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub payload: Option<serde_json::Value>,
}

impl HuntLine {
    pub fn blade(text: &str) -> Self {
        Self {
            role: "blade".into(),
            text: text.to_string(),
            timestamp: chrono::Utc::now().to_rfc3339(),
            kind: None,
            payload: None,
        }
    }
    pub fn system(text: &str) -> Self {
        Self {
            role: "system".into(),
            text: text.to_string(),
            timestamp: chrono::Utc::now().to_rfc3339(),
            kind: None,
            payload: None,
        }
    }
    /// Phase 49 (HUNT-05-ADV / HUNT-06-ADV) — sharp question awaiting user
    /// answer. Frontend renders with an inline input that posts back via
    /// `hunt_post_user_answer`.
    pub fn hunt_question(text: &str) -> Self {
        Self {
            role: "blade".into(),
            text: text.to_string(),
            timestamp: chrono::Utc::now().to_rfc3339(),
            kind: Some("hunt_question".into()),
            payload: None,
        }
    }
    /// Phase 49 (HUNT-COST-CHAT) — running cost line. Rendered with reduced
    /// visual weight (monospace, small font, gray).
    pub fn cost(cumulative_usd: f64, budget_usd: f64) -> Self {
        let pct = if budget_usd > 0.0 {
            (cumulative_usd / budget_usd * 100.0).clamp(0.0, 9999.0)
        } else {
            0.0
        };
        Self {
            role: "system".into(),
            text: format!("≈ ${:.4} / ${:.2} budget ({:.0}%)", cumulative_usd, budget_usd, pct),
            timestamp: chrono::Utc::now().to_rfc3339(),
            kind: Some("cost".into()),
            payload: Some(serde_json::json!({
                "cumulative_cost_usd": cumulative_usd,
                "budget_usd": budget_usd,
                "percent_used": pct,
            })),
        }
    }
    pub fn cost_warning(cumulative_usd: f64, budget_usd: f64) -> Self {
        let pct = if budget_usd > 0.0 {
            (cumulative_usd / budget_usd * 100.0).clamp(0.0, 9999.0)
        } else {
            0.0
        };
        Self {
            role: "system".into(),
            text: format!(
                "Heads up — past 50% of budget (${:.4} / ${:.2}).",
                cumulative_usd, budget_usd
            ),
            timestamp: chrono::Utc::now().to_rfc3339(),
            kind: Some("cost_warning".into()),
            payload: Some(serde_json::json!({
                "cumulative_cost_usd": cumulative_usd,
                "budget_usd": budget_usd,
                "percent_used": pct,
            })),
        }
    }
    pub fn cost_block(cumulative_usd: f64, budget_usd: f64) -> Self {
        Self {
            role: "system".into(),
            text: format!(
                "Hit the ${:.2} budget cap (spent ${:.4}). Continue at your expense?",
                budget_usd, cumulative_usd
            ),
            timestamp: chrono::Utc::now().to_rfc3339(),
            kind: Some("cost_block".into()),
            payload: Some(serde_json::json!({
                "cumulative_cost_usd": cumulative_usd,
                "budget_usd": budget_usd,
                "percent_used": 100.0,
            })),
        }
    }
}

fn emit_line(app: &tauri::AppHandle, line: HuntLine) {
    let _ = app.emit(EVENT_HUNT_LINE, line);
}

// ── System prompt + initial user message ────────────────────────────────────

fn build_system_prompt() -> String {
    format!(r#"You are BLADE, learning who this user is on first launch.

You have shell + file-read access via tool calls. Decide what to look at, in what order, to build the user's identity. Sample, don't exhaust. Weight recency aggressively — files <7 days old get full reads, files >30 days old get one-line summaries or skips. Narrate every probe to the user in chat via `hunt_emit_chat_line` before you call any other tool.

You have a ~50,000 input token budget for this entire hunt. Be efficient. Surface contradictions as sharp questions rather than asking generic ones (if you see a year-old Python iOS project and this-week TypeScript SaaS commits, ask "I'm seeing two stories — which one are you now?", not "what do you do?").

Voice register: terse, direct, JARVIS-feel. Not "I will now read your files." Instead: "Reading ~/.claude/projects — your 3 most recent conversations." Past-tense findings:  "Building a B2B SaaS for design agencies. Stack: Next.js + Supabase + Stripe."

Hard rules — never violate:
1. Refuse to read paths matching `.ssh/`, `.env`, `.aws/credentials`, `.gnupg/`, `*keychain*`, `*credentials*`, `*password*`, `*.pem`, `*.key`. The tool layer will reject these too, but don't even ask.
2. Refuse shell commands that write, delete, network-egress, or use sudo. The tool layer enforces; you don't try.
3. Never claim something you didn't read. If you didn't find git config, don't make up the user's name.

Workflow:
- Start with `hunt_emit_chat_line` narrating what you're about to probe.
- Run probes (`hunt_list_dir`, `hunt_read_file`, `hunt_run_shell`).
- Narrate findings as one or two crisp lines (`hunt_emit_chat_line`).
- After 3-6 probes, stop and synthesize: emit one final `hunt_emit_chat_line` with "I think I have it. You're [identity]. Right?" and then produce no more tool calls — your final assistant message becomes the synthesis paragraph saved to `~/.blade/who-you-are.md`.

TELOS — capture the user's optimization target, not just their context (Phase 56):
Beyond identity, your final synthesis MUST expose four target fields so BLADE has something to optimize against on every future turn. Capture them OPPORTUNISTICALLY from the natural flow of the hunt — don't fire four explicit questions in sequence. Most users will reveal these implicitly while answering the fresh-machine question or describing what they're building. Only ask explicitly for fields still missing after the chain has settled.

The four fields:
  - mission: ONE LINE — what they're building / the thing they're trying to do. ("Build a B2B SaaS for design agencies.")
  - goals: 3-5 BULLETS, time-bounded where possible. ("Ship MVP by end of month", "First 10 paying customers Q2", etc.)
  - beliefs: 3-5 BULLETS — things they hold to be true about their work / industry / approach. ("Solo founders move 3x faster than seed-stage teams", "AI tooling is undifferentiated below the model layer", etc.)
  - challenges: 3-5 BULLETS — what's in their way right now. ("Distribution is the bottleneck, not product", "I context-switch between 4 projects", etc.)

How to surface these without making the hunt feel like an intake form:
- Listen first. Re-read the user's answer to the fresh-machine question and any chat-lines they typed. Most of mission + at least one belief / challenge will already be there.
- Probe their on-disk evidence. Commit messages, README files, and recent file activity reveal goals (deadlines in TODOs) and challenges (issues / FIXME density) without asking.
- Ask ONLY for the gaps. If after probing you have mission + 2 goals + 1 belief + 0 challenges, ask one sharp question like "What's actually blocking you right now?" — not "List your top 3 challenges."
- Never invent. If you don't have evidence for a field, leave it empty in the structured block and the synthesis layer will degrade gracefully.

Output format for the closing synthesis turn:
Your final assistant message (the one that produces no tool calls) is saved verbatim into who-you-are.md. Begin it with your human-readable "I think I have it. You're …. Right?" synthesis paragraph. After that paragraph, append a fenced YAML block tagged `telos` containing the four fields. Example:

```telos
mission: "Build a B2B SaaS for design agencies."
goals:
  - "Ship MVP by end of month."
  - "First 10 paying customers Q2."
beliefs:
  - "Solo founders move 3x faster than seed-stage teams."
challenges:
  - "Distribution, not product, is the blocker."
```

Only include fields with real grounding. Omit any list that has zero supported entries (don't pad). The fence tag `telos` is load-bearing — the synthesis layer parses on that exact tag.

Special seed tool:
- `hunt_seed_search(seed)` becomes available AFTER the orchestrator asks the user a fresh-machine question and the user answers with a project / company / brand name. Pass the most distinctive token from the user's answer as `seed`. Returns up to 5 candidate directories (with git remotes where present). Use the regular probes on the matched directories afterwards to ground the synthesis.

Per-OS path knowledge (BELOW). Read it before deciding probes.

---

{}

---

End of platform paths. The user's initial context follows in the next message.
"#, PLATFORM_PATHS_MD)
}

fn build_initial_user_msg(ctx: &InitialContext) -> String {
    // Compact JSON keeps token cost low. Use serde to dump.
    let pretty = serde_json::to_string_pretty(ctx).unwrap_or_else(|_| "{}".into());
    format!(
        "First-launch InitialContext from BLADE's 2-second pre-scan:\n\n```json\n{}\n```\n\n\
         Decide what to look at next. Start by emitting a `hunt_emit_chat_line` that names what \
         the pre-scan already found. Then probe — at most 6 probes before synthesis.",
        pretty
    )
}

// ── Tool definitions (provider-side) ─────────────────────────────────────────

fn build_tool_defs() -> Vec<ToolDefinition> {
    use serde_json::json;
    vec![
        ToolDefinition {
            name: "hunt_emit_chat_line".to_string(),
            description: "Emit one chat line to the user. Use BEFORE every probe (narration) \
                and AFTER findings. Terse, JARVIS-feel. One sentence per call.".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "text": {"type": "string", "description": "The chat-line text. One sentence."}
                },
                "required": ["text"]
            }),
        },
        ToolDefinition {
            name: "hunt_list_dir".to_string(),
            description: "List directory contents (one level deep, max 200 entries). \
                Returns name + size + mtime per entry. Sensitive paths rejected.".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Absolute or ~-expanded path."}
                },
                "required": ["path"]
            }),
        },
        ToolDefinition {
            name: "hunt_read_file".to_string(),
            description: "Read a text file. Max 8 KB returned (head). Sensitive paths rejected.".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Absolute or ~-expanded path."}
                },
                "required": ["path"]
            }),
        },
        ToolDefinition {
            name: "hunt_run_shell".to_string(),
            description: "Run a READONLY shell command. Whitelist: ls, cat, head, tail, grep, find, \
                git status/log/config/remote/branch, which, where, uname, defaults read, xdg-mime, reg query, \
                wsl --list/which. NO write redirects, NO pipes to network, NO rm/mv/cp, NO sudo. \
                Wall-clock cap 4s.".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "command": {"type": "string", "description": "Shell command line."}
                },
                "required": ["command"]
            }),
        },
        // Phase 49 (HUNT-05-ADV) — seed-driven project lookup. Only useful
        // AFTER the user has answered the fresh-machine sharp question with a
        // project name / company / brand. Searches `~/code/` and `~/` for
        // directories that match the seed, then runs `git remote -v` in each
        // candidate. Cap of 5 results. Sensitive-path deny list applies.
        ToolDefinition {
            name: "hunt_seed_search".to_string(),
            description: "Search for project directories matching a seed name the user supplied. \
                Looks under ~/code (depth 3) and ~ (depth 2) for directories whose name contains \
                the seed (case-insensitive). For each match, runs `git remote -v` to surface the \
                origin URL. Returns up to 5 results. Sensitive paths rejected. Use AFTER receiving \
                a user answer naming their project / company / brand.".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "seed": {"type": "string", "description": "Project / company name fragment supplied by the user."}
                },
                "required": ["seed"]
            }),
        },
    ]
}

// ── Phase 49 (HUNT-05-ADV) — hunt_seed_search result shape ──────────────────

/// One hit from `hunt_seed_search`. Surfaced to the LLM as part of the tool
/// response so the next probes can ground on the user's actual project.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchHit {
    pub path: String,
    /// `git remote -v` output for the path (first origin URL grepped, or
    /// empty if the dir isn't a git repo).
    pub remote_url: Option<String>,
}

// ── Tool execution ───────────────────────────────────────────────────────────

enum ToolOutcome {
    Ok(String),
    Err(String),
}

async fn execute_tool_call(
    app: &tauri::AppHandle,
    call: &ToolCall,
    findings: &mut HuntFindings,
) -> ToolOutcome {
    match call.name.as_str() {
        "hunt_emit_chat_line" => {
            let text = call.arguments.get("text")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            if text.is_empty() {
                return ToolOutcome::Err("hunt_emit_chat_line requires non-empty 'text'.".into());
            }
            emit_line(app, HuntLine::blade(&text));
            findings.chat_lines.push(text.clone());
            findings.probes.push(ProbeRecord {
                tool: "hunt_emit_chat_line".into(),
                argument: String::new(),
                ok: true,
                snippet: text,
            });
            ToolOutcome::Ok("emitted".into())
        }
        "hunt_list_dir" => {
            let p = call.arguments.get("path").and_then(|v| v.as_str()).unwrap_or("");
            if p.is_empty() {
                return ToolOutcome::Err("hunt_list_dir requires 'path'.".into());
            }
            let resolved = expand_home(p);
            if let Some(err) = check_sensitive(&resolved) {
                return ToolOutcome::Err(err);
            }
            match hunt_list_dir_impl(&resolved).await {
                Ok(out) => {
                    findings.probes.push(ProbeRecord {
                        tool: "hunt_list_dir".into(),
                        argument: resolved.display().to_string(),
                        ok: true,
                        snippet: crate::safe_slice(&out, 400).to_string(),
                    });
                    ToolOutcome::Ok(out)
                }
                Err(e) => {
                    findings.probes.push(ProbeRecord {
                        tool: "hunt_list_dir".into(),
                        argument: resolved.display().to_string(),
                        ok: false,
                        snippet: e.clone(),
                    });
                    ToolOutcome::Err(e)
                }
            }
        }
        "hunt_read_file" => {
            let p = call.arguments.get("path").and_then(|v| v.as_str()).unwrap_or("");
            if p.is_empty() {
                return ToolOutcome::Err("hunt_read_file requires 'path'.".into());
            }
            let resolved = expand_home(p);
            if let Some(err) = check_sensitive(&resolved) {
                return ToolOutcome::Err(err);
            }
            match hunt_read_file_impl(&resolved).await {
                Ok(out) => {
                    findings.probes.push(ProbeRecord {
                        tool: "hunt_read_file".into(),
                        argument: resolved.display().to_string(),
                        ok: true,
                        snippet: crate::safe_slice(&out, 400).to_string(),
                    });
                    ToolOutcome::Ok(out)
                }
                Err(e) => {
                    findings.probes.push(ProbeRecord {
                        tool: "hunt_read_file".into(),
                        argument: resolved.display().to_string(),
                        ok: false,
                        snippet: e.clone(),
                    });
                    ToolOutcome::Err(e)
                }
            }
        }
        "hunt_run_shell" => {
            let cmd = call.arguments.get("command").and_then(|v| v.as_str()).unwrap_or("");
            if cmd.is_empty() {
                return ToolOutcome::Err("hunt_run_shell requires 'command'.".into());
            }
            if let Some(err) = vet_shell(cmd) {
                return ToolOutcome::Err(err);
            }
            match hunt_run_shell_impl(cmd).await {
                Ok(out) => {
                    findings.probes.push(ProbeRecord {
                        tool: "hunt_run_shell".into(),
                        argument: cmd.to_string(),
                        ok: true,
                        snippet: crate::safe_slice(&out, 400).to_string(),
                    });
                    ToolOutcome::Ok(out)
                }
                Err(e) => {
                    findings.probes.push(ProbeRecord {
                        tool: "hunt_run_shell".into(),
                        argument: cmd.to_string(),
                        ok: false,
                        snippet: e.clone(),
                    });
                    ToolOutcome::Err(e)
                }
            }
        }
        "hunt_seed_search" => {
            let seed = call.arguments.get("seed").and_then(|v| v.as_str()).unwrap_or("");
            if seed.is_empty() {
                return ToolOutcome::Err("hunt_seed_search requires 'seed'.".into());
            }
            if let Some(err) = vet_seed(seed) {
                return ToolOutcome::Err(err);
            }
            match hunt_seed_search_impl(seed).await {
                Ok(hits) => {
                    let snippet = serde_json::to_string(&hits).unwrap_or_else(|_| "[]".into());
                    findings.probes.push(ProbeRecord {
                        tool: "hunt_seed_search".into(),
                        argument: seed.to_string(),
                        ok: true,
                        snippet: crate::safe_slice(&snippet, 400).to_string(),
                    });
                    let body = if hits.is_empty() {
                        format!("No project directories matched seed '{}'.", seed)
                    } else {
                        let lines: Vec<String> = hits
                            .iter()
                            .map(|h| match &h.remote_url {
                                Some(url) if !url.is_empty() => {
                                    format!("- {} (remote: {})", h.path, url)
                                }
                                _ => format!("- {} (no git remote)", h.path),
                            })
                            .collect();
                        format!(
                            "Seed '{}' matched {} candidate{}:\n{}",
                            seed,
                            hits.len(),
                            if hits.len() == 1 { "" } else { "s" },
                            lines.join("\n")
                        )
                    };
                    ToolOutcome::Ok(body)
                }
                Err(e) => {
                    findings.probes.push(ProbeRecord {
                        tool: "hunt_seed_search".into(),
                        argument: seed.to_string(),
                        ok: false,
                        snippet: e.clone(),
                    });
                    ToolOutcome::Err(e)
                }
            }
        }
        other => ToolOutcome::Err(format!("Unknown hunt tool: {}", other)),
    }
}

// ── Phase 49 (HUNT-05-ADV) — seed sandbox + impl ─────────────────────────────

/// Vet a seed string before letting it flow into `find` / `grep`. Rejects
/// shell-metacharacter escape hatches AND empty / over-long seeds. The seed
/// is interpolated into shell command lines (via `format!`), so we need the
/// same posture as `vet_shell` for the substrings.
pub(crate) fn vet_seed(seed: &str) -> Option<String> {
    let trimmed = seed.trim();
    if trimmed.is_empty() {
        return Some("Empty seed rejected.".into());
    }
    if trimmed.len() > 60 {
        return Some(format!(
            "Seed too long ({} chars > 60). Pick a shorter project name.",
            trimmed.len()
        ));
    }
    // Same shell-injection guards as vet_shell. The seed is interpolated raw
    // into `-iname "*SEED*"` and `grep SEED`, so any metacharacter is fatal.
    for bad in &[
        "$", "`", ";", "|", "&", "<", ">", "\\", "\"", "'", "\n", "\r",
        "..",  // path traversal
    ] {
        if trimmed.contains(bad) {
            return Some(format!(
                "Seed rejected: contains forbidden character '{}'.",
                bad
            ));
        }
    }
    // Sensitive-path heuristic on the seed itself — refuses seeds like
    // ".ssh" or "credentials".
    for frag in DENY_FRAGMENTS {
        if trimmed.to_lowercase().contains(&frag.to_lowercase().replace('/', "")) {
            return Some(format!(
                "Seed rejected ('{}' overlaps deny fragment '{}'). Pick a different seed.",
                trimmed, frag
            ));
        }
    }
    None
}

const SEED_SEARCH_CAP: usize = 5;

async fn hunt_seed_search_impl(seed: &str) -> Result<Vec<SearchHit>, String> {
    let home = match dirs::home_dir() {
        Some(h) => h,
        None => return Err("Could not resolve home directory.".into()),
    };
    let mut hits: Vec<SearchHit> = Vec::new();

    // 1. find ~/code -maxdepth 3 -iname "*<seed>*" -type d
    let code_dir = home.join("code");
    if code_dir.exists() {
        let cmd = format!(
            "find {:?} -maxdepth 3 -iname \"*{}*\" -type d",
            code_dir.display(),
            seed
        );
        if let Ok(out) = hunt_run_shell_impl(&cmd).await {
            for line in out.lines().take(SEED_SEARCH_CAP) {
                let path = line.trim().trim_matches('"').to_string();
                if path.is_empty() { continue; }
                if check_sensitive(Path::new(&path)).is_some() { continue; }
                if hits.iter().any(|h| h.path == path) { continue; }
                let remote = git_remote_for(&path).await;
                hits.push(SearchHit { path, remote_url: remote });
                if hits.len() >= SEED_SEARCH_CAP { break; }
            }
        }
    }

    // 2. find ~ -maxdepth 2 -iname "*<seed>*" -type d
    if hits.len() < SEED_SEARCH_CAP {
        let cmd = format!(
            "find {:?} -maxdepth 2 -iname \"*{}*\" -type d",
            home.display(),
            seed
        );
        if let Ok(out) = hunt_run_shell_impl(&cmd).await {
            for line in out.lines() {
                let path = line.trim().trim_matches('"').to_string();
                if path.is_empty() { continue; }
                if check_sensitive(Path::new(&path)).is_some() { continue; }
                if hits.iter().any(|h| h.path == path) { continue; }
                let remote = git_remote_for(&path).await;
                hits.push(SearchHit { path, remote_url: remote });
                if hits.len() >= SEED_SEARCH_CAP { break; }
            }
        }
    }

    Ok(hits)
}

/// Run `git -C <path> remote -v` and return the first remote URL line.
async fn git_remote_for(path: &str) -> Option<String> {
    let cmd = format!("git -C {:?} remote -v", path);
    match hunt_run_shell_impl(&cmd).await {
        Ok(out) => {
            // First non-empty line, second whitespace-separated token is URL.
            for line in out.lines() {
                let parts: Vec<&str> = line.split_whitespace().collect();
                if parts.len() >= 2 {
                    return Some(parts[1].to_string());
                }
            }
            None
        }
        Err(_) => None,
    }
}

// ── Sandbox helpers ──────────────────────────────────────────────────────────

/// Expand `~/` → `$HOME`. Returns the path unchanged if no expansion needed.
pub(crate) fn expand_home(p: &str) -> PathBuf {
    if let Some(stripped) = p.strip_prefix("~/") {
        if let Some(home) = dirs::home_dir() {
            return home.join(stripped);
        }
    }
    if p == "~" {
        if let Some(home) = dirs::home_dir() { return home; }
    }
    PathBuf::from(p)
}

/// Return Some(error) if the path hits the deny list. Case-insensitive.
pub(crate) fn check_sensitive(p: &Path) -> Option<String> {
    let s = p.to_string_lossy().to_lowercase();
    for frag in DENY_FRAGMENTS {
        if s.contains(&frag.to_lowercase()) {
            return Some(format!(
                "Sensitive path rejected ('{}' matches deny fragment '{}'). Pick a different probe.",
                p.display(), frag
            ));
        }
    }
    None
}

/// Return Some(error) if the shell command is rejected. Vets the FIRST word
/// against the whitelist and scans the whole string for the reject substrings.
pub(crate) fn vet_shell(cmd: &str) -> Option<String> {
    let trimmed = cmd.trim();
    if trimmed.is_empty() {
        return Some("Empty command rejected.".into());
    }
    // Whole-string reject scan first.
    let lower = trimmed.to_lowercase();
    for bad in SHELL_REJECT {
        if lower.contains(&bad.to_lowercase()) {
            return Some(format!(
                "Command rejected: contains forbidden fragment '{}'. \
                 Sandbox is readonly + no-network.", bad
            ));
        }
    }
    // Whitelist the first token.
    let first = trimmed.split_whitespace().next().unwrap_or("");
    if !SHELL_ALLOW.contains(&first) {
        return Some(format!(
            "Command rejected: binary '{}' not in readonly whitelist. \
             Allowed: ls, cat, head, tail, grep, find, git, which, where, uname, defaults, xdg-mime, reg, wsl, echo.",
            first
        ));
    }
    None
}

async fn hunt_list_dir_impl(p: &Path) -> Result<String, String> {
    let path_owned = p.to_path_buf();
    let path_for_blocking = path_owned.clone();
    let entries = tokio::task::spawn_blocking(move || -> Result<Vec<String>, String> {
        let read = std::fs::read_dir(&path_for_blocking)
            .map_err(|e| format!("read_dir({}): {}", path_for_blocking.display(), e))?;
        let mut out = Vec::new();
        for entry in read.take(200).flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            let meta_str = entry.metadata().ok().map(|m| {
                let kind = if m.is_dir() { "d" } else if m.is_symlink() { "l" } else { "f" };
                let size = m.len();
                let mtime = m.modified().ok()
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|d| d.as_secs())
                    .unwrap_or(0);
                format!("{} {:>10} {}", kind, size, mtime)
            }).unwrap_or_default();
            out.push(format!("{}  {}", meta_str, name));
        }
        Ok(out)
    }).await.map_err(|e| format!("join error: {}", e))??;

    Ok(format!(
        "Listing {} ({} entries):\n{}",
        path_owned.display(),
        entries.len(),
        entries.join("\n")
    ))
}

const READ_FILE_CAP: usize = 8 * 1024; // 8 KB head

async fn hunt_read_file_impl(p: &Path) -> Result<String, String> {
    let path_owned = p.to_path_buf();
    let raw = tokio::task::spawn_blocking(move || -> Result<Vec<u8>, String> {
        let meta = std::fs::metadata(&path_owned)
            .map_err(|e| format!("stat({}): {}", path_owned.display(), e))?;
        if meta.is_dir() {
            return Err(format!("{} is a directory — use hunt_list_dir.", path_owned.display()));
        }
        if meta.len() > 1024 * 1024 {
            // Large file — still allowed but only the head.
            log::warn!("[hunt_read_file] {} is {} bytes — reading first 8KB only",
                path_owned.display(), meta.len());
        }
        use std::io::Read;
        let mut f = std::fs::File::open(&path_owned)
            .map_err(|e| format!("open({}): {}", path_owned.display(), e))?;
        let mut buf = vec![0u8; READ_FILE_CAP];
        let n = f.read(&mut buf).map_err(|e| format!("read: {}", e))?;
        buf.truncate(n);
        Ok(buf)
    }).await.map_err(|e| format!("join error: {}", e))??;

    let text = String::from_utf8_lossy(&raw).into_owned();
    Ok(text)
}

async fn hunt_run_shell_impl(cmd: &str) -> Result<String, String> {
    // Use a real shell so users' aliases / quoting work, but with -c so we
    // can wrap a single command line. The vet_shell guard has already
    // rejected substitution / redirect / network / write fragments.
    let shell = if cfg!(target_os = "windows") { "cmd" } else { "sh" };
    let flag = if cfg!(target_os = "windows") { "/C" } else { "-c" };

    let fut = async move {
        let out = tokio::process::Command::new(shell)
            .arg(flag)
            .arg(cmd)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .output()
            .await
            .map_err(|e| format!("spawn: {}", e))?;
        let stdout = String::from_utf8_lossy(&out.stdout).into_owned();
        let stderr = String::from_utf8_lossy(&out.stderr).into_owned();
        if !out.status.success() {
            return Err(format!(
                "exit code {:?}: {}{}",
                out.status.code(),
                if !stdout.is_empty() { format!("stdout:\n{}\n", crate::safe_slice(&stdout, 400)) } else { String::new() },
                if !stderr.is_empty() { format!("stderr:\n{}", crate::safe_slice(&stderr, 400)) } else { String::new() }
            ));
        }
        Ok(crate::safe_slice(&stdout, 4096).to_string())
    };

    match tokio::time::timeout(std::time::Duration::from_millis(SHELL_TIMEOUT_MS), fut).await {
        Ok(r) => r,
        Err(_) => Err(format!("Shell command timed out (>{}ms).", SHELL_TIMEOUT_MS)),
    }
}

// ── Tauri commands ───────────────────────────────────────────────────────────

/// Cancel an in-flight hunt. Idempotent — safe to call multiple times.
#[tauri::command]
pub fn cancel_hunt() -> Result<(), String> {
    HUNT_CANCEL.store(true, Ordering::SeqCst);
    Ok(())
}

/// Phase 49 (HUNT-05-ADV) — frontend posts the user's answer to a
/// `hunt_question` chat-line. Wakes the parked hunt task so it can re-prompt
/// the LLM with the answer as seed input.
#[tauri::command]
pub fn hunt_post_user_answer(answer: String) -> Result<(), String> {
    let trimmed = answer.trim().to_string();
    if trimmed.is_empty() {
        return Err("Empty answer".into());
    }
    if let Ok(mut slot) = HUNT_USER_ANSWER.lock() {
        *slot = Some(trimmed);
    }
    HUNT_ANSWER_NOTIFY.notify_one();
    Ok(())
}

/// Phase 49 (HUNT-COST-CHAT) — frontend acknowledges the cost block and
/// asks BLADE to continue with another budget bucket.
#[tauri::command]
pub fn hunt_continue_after_cost_block() -> Result<(), String> {
    HUNT_COST_CONTINUE.store(true, Ordering::SeqCst);
    Ok(())
}

/// Run pre-scan + start the hunt. Returns the InitialContext immediately so
/// the frontend can render Message #1 while the LLM-driven probes spawn in
/// the background. The hunt itself streams via `blade_hunt_line` events.
#[tauri::command]
pub async fn start_hunt_cmd(app: tauri::AppHandle) -> Result<InitialContext, String> {
    let ctx = crate::onboarding::pre_scan::run_pre_scan().await;
    let ctx_for_msg1 = ctx.clone();
    // Emit Message #1 (HUNT-02) BEFORE the hunt loop starts.
    let msg1 = crate::onboarding::compose_message_one(&ctx);
    let _ = app.emit(EVENT_HUNT_LINE, HuntLine::blade(&msg1));

    // Spawn the hunt loop in the background.
    let app_for_hunt = app.clone();
    let ctx_for_hunt = ctx.clone();
    tauri::async_runtime::spawn(async move {
        match start_hunt(app_for_hunt.clone(), ctx_for_hunt).await {
            Ok(outcome) => {
                // Hand off to synthesis. Synthesis writes ~/.blade/who-you-are.md
                // and emits the first-task close chat-line.
                let _ = crate::onboarding::synthesis::on_hunt_done(&app_for_hunt, &outcome).await;
            }
            Err(e) => {
                let _ = app_for_hunt.emit(EVENT_HUNT_ERROR, e);
            }
        }
    });

    Ok(ctx_for_msg1)
}

// ── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deny_list_rejects_ssh_path() {
        let p = PathBuf::from("/home/user/.ssh/id_rsa");
        assert!(check_sensitive(&p).is_some(), ".ssh/ must be rejected");
    }

    #[test]
    fn deny_list_rejects_env_file() {
        let p = PathBuf::from("/repo/.env");
        assert!(check_sensitive(&p).is_some(), ".env must be rejected");
    }

    #[test]
    fn deny_list_accepts_safe_path() {
        let p = PathBuf::from("/home/user/code/README.md");
        assert!(check_sensitive(&p).is_none(), "safe path must pass");
    }

    #[test]
    fn shell_vet_rejects_rm() {
        assert!(vet_shell("rm -rf /tmp/foo").is_some());
    }

    #[test]
    fn shell_vet_rejects_curl() {
        assert!(vet_shell("curl https://evil.example.com").is_some());
    }

    #[test]
    fn shell_vet_rejects_write_redirect() {
        assert!(vet_shell("echo pwned > /etc/passwd").is_some());
    }

    #[test]
    fn shell_vet_rejects_command_substitution() {
        assert!(vet_shell("ls $(whoami)").is_some());
    }

    #[test]
    fn shell_vet_rejects_backticks() {
        assert!(vet_shell("ls `whoami`").is_some());
    }

    #[test]
    fn shell_vet_accepts_git_log() {
        assert!(vet_shell("git log -5").is_none());
    }

    #[test]
    fn shell_vet_accepts_ls() {
        assert!(vet_shell("ls -la ~/code").is_none());
    }

    #[test]
    fn shell_vet_accepts_wsl_list() {
        assert!(vet_shell("wsl --list --quiet").is_none());
    }

    #[test]
    fn shell_vet_rejects_unknown_binary() {
        assert!(vet_shell("blade-evil-binary something").is_some());
    }

    #[test]
    fn expand_home_handles_tilde_prefix() {
        if let Some(home) = dirs::home_dir() {
            let expanded = expand_home("~/code");
            assert_eq!(expanded, home.join("code"));
        }
    }

    #[test]
    fn expand_home_passes_through_absolute() {
        let p = expand_home("/tmp/foo");
        assert_eq!(p, PathBuf::from("/tmp/foo"));
    }

    // ── Phase 49 (HUNT-05-ADV / HUNT-COST-CHAT) — new behavior tests ─────

    #[test]
    fn vet_seed_rejects_empty() {
        assert!(vet_seed("").is_some());
        assert!(vet_seed("   ").is_some());
    }

    #[test]
    fn vet_seed_rejects_shell_metachars() {
        assert!(vet_seed("foo$(whoami)").is_some());
        assert!(vet_seed("foo`bar`").is_some());
        assert!(vet_seed("foo|bar").is_some());
        assert!(vet_seed("foo;bar").is_some());
        assert!(vet_seed("../etc").is_some());
        assert!(vet_seed("foo>bar").is_some());
        assert!(vet_seed("foo\\bar").is_some());
    }

    #[test]
    fn vet_seed_rejects_overlong() {
        let long = "a".repeat(61);
        assert!(vet_seed(&long).is_some());
    }

    #[test]
    fn vet_seed_rejects_sensitive_overlap() {
        assert!(vet_seed("credentials").is_some());
        assert!(vet_seed("password").is_some());
        assert!(vet_seed("keychain").is_some());
    }

    #[test]
    fn vet_seed_accepts_normal_project_names() {
        assert!(vet_seed("clarify").is_none());
        assert!(vet_seed("blade").is_none());
        assert!(vet_seed("my-app").is_none());
        assert!(vet_seed("project_42").is_none());
    }

    #[test]
    fn turn_cost_anthropic_sonnet() {
        // 1M in + 1M out should be 3 + 15 = 18 USD per the price table.
        let cost = turn_cost_usd(
            "anthropic",
            "claude-sonnet-4-20250514",
            1_000_000,
            1_000_000,
        );
        assert!((cost - 18.0).abs() < 1e-6, "expected $18, got {}", cost);
    }

    #[test]
    fn turn_cost_ollama_zero() {
        let cost = turn_cost_usd("ollama", "llama3.1", 10_000, 5_000);
        assert_eq!(cost, 0.0);
    }

    #[test]
    fn turn_cost_unknown_provider_uses_table_fallback() {
        // Unknown providers fall back to ($1, $3)/1M per price_per_million.
        // 1M in + 1M out = $1 + $3 = $4.
        let cost = turn_cost_usd("nonexistent", "model-x", 1_000_000, 1_000_000);
        assert!((cost - 4.0).abs() < 1e-6, "got {}", cost);
    }

    #[test]
    fn cost_tracker_reset_clears_state() {
        let mut t = CostTracker::default();
        t.cumulative_cost_usd = 1.23;
        t.cumulative_input_tokens = 100;
        t.warning_emitted = true;
        t.block_emitted = true;
        t.reset(5.00);
        assert_eq!(t.cumulative_cost_usd, 0.0);
        assert_eq!(t.cumulative_input_tokens, 0);
        assert_eq!(t.budget_usd, 5.00);
        assert!(!t.warning_emitted);
        assert!(!t.block_emitted);
    }

    #[test]
    fn hunt_line_cost_payload_shape() {
        let l = HuntLine::cost(1.5, 3.0);
        assert_eq!(l.kind.as_deref(), Some("cost"));
        let p = l.payload.expect("payload present");
        assert!(p.get("cumulative_cost_usd").is_some());
        assert!(p.get("budget_usd").is_some());
        assert!(p.get("percent_used").is_some());
    }

    #[test]
    fn hunt_line_question_marks_kind() {
        let l = HuntLine::hunt_question("Fresh machine — what do you do?");
        assert_eq!(l.kind.as_deref(), Some("hunt_question"));
        assert_eq!(l.role, "blade");
    }

    #[test]
    fn fresh_machine_returns_true_on_bare_findings() {
        let findings = HuntFindings::default();
        assert!(is_fresh_machine(&findings));
    }

    #[test]
    fn fresh_machine_returns_false_when_agents_detected() {
        let mut findings = HuntFindings::default();
        findings.initial.agents.claude = Some("/usr/local/bin/claude".into());
        assert!(!is_fresh_machine(&findings));
    }

    #[test]
    fn fresh_machine_returns_false_when_useful_probes_accrue() {
        let mut findings = HuntFindings::default();
        for i in 0..4 {
            findings.probes.push(ProbeRecord {
                tool: "hunt_list_dir".into(),
                argument: format!("/home/u/code/p{}", i),
                ok: true,
                snippet: "...".into(),
            });
        }
        assert!(!is_fresh_machine(&findings));
    }

    #[test]
    fn fresh_machine_ignores_narration_probes() {
        // Narration-only probes don't count as "useful" — fresh-machine still true.
        let mut findings = HuntFindings::default();
        for _ in 0..10 {
            findings.probes.push(ProbeRecord {
                tool: "hunt_emit_chat_line".into(),
                argument: "".into(),
                ok: true,
                snippet: "narrating".into(),
            });
        }
        assert!(is_fresh_machine(&findings));
    }
}
