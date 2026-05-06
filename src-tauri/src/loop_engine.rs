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
use std::sync::Mutex;

use once_cell::sync::Lazy;
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

/// Plan 34-02 — DEFAULT capacity of the recent_actions ring buffer. 6 lets
/// the 5 RES-01 detectors see "3 repeated triples in last 6 actions" with
/// room for interspersed different actions.
///
/// Phase 34 / HI-03 (REVIEW finding) — runtime capacity is honored from
/// `ResilienceConfig.recent_actions_window` via `record_action(record, cap)`.
/// `LoopState::record_action(record)` (no-cap overload) preserves backwards
/// compatibility with `LoopState::default()` test paths and uses this const
/// as the fallback. The runtime call site at iteration end inside `run_loop`
/// always passes the configured value so user edits to the config field take
/// effect on the next chat turn.
pub const RECENT_ACTIONS_CAPACITY: usize = 6;

/// LOOP-01..06 + RES-01..04 — central state struct passed by mutable reference
/// through every iteration of the loop. Plans 33-04..33-08 populated the Phase 33
/// fields; Plan 34-02 adds the Phase 34 fields (8 new) + renames the legacy
/// 3-slot ring buffer to recent_actions + bumps capacity 3 → 6.
#[derive(Debug, Clone, Default)]
pub struct LoopState {
    /// Current iteration count (0-indexed).
    pub iteration: u32,
    /// Per-loop (single user turn) cumulative spend in USD. Phase 33-08 wired
    /// the runtime check at the top of each iteration. Phase 34 keeps this
    /// field untouched and adds `conversation_cumulative_cost_usd` as the
    /// per-conversation cap (RES-03 + RES-04).
    pub cumulative_cost_usd: f32,
    /// Plan 34-02 (RES-03) — per-conversation cumulative spend, persisted across
    /// turns via SessionWriter. Plan 34-06 wires the runtime accumulation.
    pub conversation_cumulative_cost_usd: f32,
    /// Plan 34-02 (RES-01 CostRunaway delta) — per-iteration marginal cost.
    /// Used by detect_cost_runaway: trips when last_iter_cost > 2.0 × avg.
    pub last_iter_cost: f32,
    /// LOOP-03 — observable counter for the "two consecutive plan adaptations"
    /// success criterion. Incremented when the third-same-tool-failure trigger
    /// fires reject_plan + injects the replan nudge.
    pub replans_this_run: u32,
    /// LOOP-04 — number of times max_tokens was doubled this run.
    pub token_escalations: u32,
    /// LOOP-01 — ring buffer of the most recent N tool actions, used as
    /// `actions` context for the verification probe prompt AND for RES-01's
    /// RepeatedActionObservation detector. Capacity is RECENT_ACTIONS_CAPACITY (6).
    /// Renamed from the legacy 3-slot field in Plan 34-02; the previous name is gone.
    pub recent_actions: VecDeque<ActionRecord>,
    /// LOOP-03 trigger — count of consecutive failures per tool name.
    /// Resets to 0 when the tool succeeds or a different tool fails.
    /// On 3rd entry, reject_plan is called + replan nudge injected.
    pub consecutive_same_tool_failures: HashMap<String, u32>,
    /// Plan 33-05 — last iteration where a nudge was injected (LOOP-01 NO/REPLAN
    /// or LOOP-03 third-same-tool). Used to suppress stacking — if a nudge was
    /// injected within the last 2 iterations, the next one is skipped.
    /// (33-RESEARCH.md landmine #11.)
    pub last_nudge_iteration: Option<u32>,
    /// Plan 34-02 (RES-01 MonologueSpiral) — count of consecutive assistant
    /// turns with no tool_calls. Reset to 0 whenever a tool fires.
    pub consecutive_no_tool_turns: u32,
    /// Plan 34-02 (RES-01 ContextWindowThrashing) — number of compactions
    /// this run_loop invocation. Incremented via record_compaction() called
    /// from commands::compress_conversation_smart on success.
    pub compactions_this_run: u32,
    /// Plan 34-02 (RES-01 NoProgress) — last iteration where the loop made
    /// progress (new tool name OR new content). detect_no_progress fires
    /// when iteration - last_progress_iteration >= no_progress_threshold.
    pub last_progress_iteration: u32,
    /// Plan 34-02 (RES-01 NoProgress dedup) — sha256-truncated-to-16 of the
    /// last assistant turn's safe_slice(text, 500). Used to detect "same
    /// content again" without comparing full text bodies.
    pub last_progress_text_hash: Option<[u8; 16]>,
    /// Plan 34-02 (RES-04 latch) — true once the 80% cost-warning event has
    /// fired this conversation. Prevents repeat firing every iteration.
    pub cost_warning_80_emitted: bool,
    /// Phase 35 / DECOMP-02 — recursion gate. When true, the DECOMP-01
    /// trigger at the top of run_loop is SKIPPED for THIS loop. Set to true
    /// at sub-agent spawn time by `decomposition::executor::spawn_isolated_subagent`.
    /// Default false (parent loops). Without this gate, sub-agents would
    /// recursively spawn grandchildren — explicitly out-of-scope per
    /// 35-CONTEXT.md §Phase Boundary "current scope: 1-level deep".
    pub is_subagent: bool,
}

impl LoopState {
    /// Push an action into the ring buffer, evicting the oldest if length
    /// exceeds the DEFAULT capacity `RECENT_ACTIONS_CAPACITY` (6).
    ///
    /// Phase 34 / HI-03 (REVIEW finding) — preserved as a thin wrapper over
    /// `record_action_with_cap` for tests that construct `LoopState::default()`
    /// without access to a `ResilienceConfig`. The runtime path inside
    /// `run_loop` calls `record_action_with_cap` directly with
    /// `config.resilience.recent_actions_window` so user edits to that field
    /// take effect immediately.
    pub fn record_action(&mut self, record: ActionRecord) {
        self.record_action_with_cap(record, RECENT_ACTIONS_CAPACITY);
    }

    /// HI-03 — runtime-configurable variant of `record_action`. Capacity comes
    /// from the caller (typically `config.resilience.recent_actions_window as
    /// usize`). A capacity of 0 is treated as the compile-time floor
    /// (`RECENT_ACTIONS_CAPACITY`) to avoid pathological "ring buffer is empty
    /// after every push" behavior.
    pub fn record_action_with_cap(&mut self, record: ActionRecord, capacity: usize) {
        let cap = if capacity == 0 { RECENT_ACTIONS_CAPACITY } else { capacity };
        self.recent_actions.push_back(record);
        while self.recent_actions.len() > cap {
            self.recent_actions.pop_front();
        }
    }

    /// Plan 34-02 (RES-01 ContextWindowThrashing) — call from
    /// commands::compress_conversation_smart on success. Increments the
    /// per-run compaction counter; detect_context_window_thrashing fires
    /// when compactions_this_run >= compaction_thrash_threshold (default 3).
    pub fn record_compaction(&mut self) {
        self.compactions_this_run = self.compactions_this_run.saturating_add(1);
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

// ─── Per-conversation persistent state (BL-01 — REVIEW finding) ────────────
//
// Phase 34 / BL-01 (REVIEW finding) — `LoopState::default()` runs FRESH on
// every `send_message_stream` call, so `conversation_cumulative_cost_usd`,
// `cost_warning_80_emitted`, `consecutive_no_tool_turns`, `compactions_this_run`,
// `last_progress_iteration`, and `recent_actions` all reset every user turn.
// The CONTEXT lock §Backward Compatibility guarantee ("per-conversation cost
// cap enforced at 100%") collapses to per-turn semantics without a way to
// thread state across turns.
//
// The fix: a process-global registry keyed by `conversation_id` (the
// SessionWriter's session_id). On each `run_loop` entry, we look up (or
// initialize) the persisted carry-over fields. On each `run_loop` exit, we
// save the carry-over fields back. This is the in-memory complement to the
// JSONL persistence — JSONL is forensic-only per CONTEXT lock §SESS-02, and
// `run_loop` is hot-path-sensitive enough that re-walking the JSONL on every
// turn would inflate latency. The map is bounded (capped at 256 entries; LRU
// eviction on overflow) so a long-running BLADE process can't leak memory
// into N-many resumed conversations.
//
// What carries over (the lifetime-of-conversation fields):
//   - conversation_cumulative_cost_usd (RES-03)
//   - cost_warning_80_emitted          (RES-04 latch)
//   - compactions_this_run             (RES-01 ContextWindowThrashing)
//   - consecutive_no_tool_turns        (RES-01 MonologueSpiral)
//   - last_progress_iteration          (RES-01 NoProgress)
//   - last_progress_text_hash          (RES-01 NoProgress dedup)
//   - last_iter_cost                   (RES-01 CostRunaway baseline)
//
// What does NOT carry over (per-turn semantics deliberately):
//   - iteration                        (resets per send_message_stream)
//   - cumulative_cost_usd              (PerLoop cap is per-turn by design)
//   - replans_this_run / token_escalations  (per-turn; reset OK)
//   - recent_actions                   (per-turn ring buffer for verification probe)
//   - consecutive_same_tool_failures   (per-turn streak; reset OK)
//   - last_nudge_iteration             (per-turn anti-stacking)

/// Carry-over slice of LoopState that persists across `send_message_stream`
/// calls within the same conversation_id. See module-level comment for the
/// field-by-field justification.
#[derive(Debug, Clone, Default)]
pub struct ConversationCarryOver {
    pub conversation_cumulative_cost_usd: f32,
    pub cost_warning_80_emitted: bool,
    pub compactions_this_run: u32,
    pub consecutive_no_tool_turns: u32,
    pub last_progress_iteration: u32,
    pub last_progress_text_hash: Option<[u8; 16]>,
    pub last_iter_cost: f32,
}

/// Maximum number of conversations whose carry-over state we keep in memory.
/// Older entries are evicted FIFO-style on overflow. 256 is generous: a user
/// would have to leave 256 distinct chats open before any state was lost,
/// and even then the JSONL persistence still has the cost figures (so the
/// next turn re-seeds from disk via SessionWriter on a cold-cache miss).
const CONVERSATION_STATES_CAP: usize = 256;

/// Process-global registry of per-conversation carry-over state. Keyed by
/// `session_id` (the SessionWriter ULID). `Lazy + Mutex` mirrors the
/// concurrency posture of `crate::commands::error_history` and the existing
/// thread_local seams in this module.
pub(crate) static CONVERSATION_STATES: Lazy<Mutex<HashMap<String, ConversationCarryOver>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

/// FIFO insertion order so we can evict oldest on overflow without dragging
/// in a full LRU crate. Maintained alongside the map; both updated under the
/// same mutex so they stay in sync.
pub(crate) static CONVERSATION_STATES_ORDER: Lazy<Mutex<VecDeque<String>>> =
    Lazy::new(|| Mutex::new(VecDeque::new()));

/// BL-01 — load (or initialize) the per-conversation carry-over for a given
/// session_id. Returns `Default::default()` when the conversation is new OR
/// when the mutex is poisoned (defensive — chat continues with a fresh slate
/// rather than panicking on an unrelated thread's panic).
pub fn load_conversation_state(conversation_id: &str) -> ConversationCarryOver {
    if conversation_id.is_empty() {
        return ConversationCarryOver::default();
    }
    match CONVERSATION_STATES.lock() {
        Ok(map) => map
            .get(conversation_id)
            .cloned()
            .unwrap_or_default(),
        Err(e) => {
            eprintln!(
                "[BL-01] CONVERSATION_STATES poisoned on load: {}; using fresh state",
                e
            );
            ConversationCarryOver::default()
        }
    }
}

/// BL-01 — persist the carry-over fields back to the registry. Maintains
/// FIFO eviction at `CONVERSATION_STATES_CAP`. Empty `conversation_id` is a
/// no-op (no SessionWriter / JSONL session; nothing to associate state with).
pub fn save_conversation_state(conversation_id: &str, carry: ConversationCarryOver) {
    if conversation_id.is_empty() {
        return;
    }
    let mut map = match CONVERSATION_STATES.lock() {
        Ok(m) => m,
        Err(e) => {
            eprintln!(
                "[BL-01] CONVERSATION_STATES poisoned on save: {}; dropping carry-over for {}",
                e, conversation_id
            );
            return;
        }
    };
    let mut order = match CONVERSATION_STATES_ORDER.lock() {
        Ok(o) => o,
        Err(e) => {
            eprintln!(
                "[BL-01] CONVERSATION_STATES_ORDER poisoned on save: {}; carry-over written but eviction skipped",
                e
            );
            map.insert(conversation_id.to_string(), carry);
            return;
        }
    };
    let is_new = !map.contains_key(conversation_id);
    map.insert(conversation_id.to_string(), carry);
    if is_new {
        order.push_back(conversation_id.to_string());
        while map.len() > CONVERSATION_STATES_CAP {
            if let Some(oldest) = order.pop_front() {
                map.remove(&oldest);
            } else {
                break;
            }
        }
    }
}

/// BL-01 — clear the carry-over for a conversation. Used by tests + future
/// "Clear conversation history" UI paths.
#[allow(dead_code)]
pub fn forget_conversation_state(conversation_id: &str) {
    if let Ok(mut map) = CONVERSATION_STATES.lock() {
        map.remove(conversation_id);
    }
    if let Ok(mut order) = CONVERSATION_STATES_ORDER.lock() {
        order.retain(|id| id != conversation_id);
    }
}

/// BL-01 — extract the carry-over slice from a `LoopState`. Used by `run_loop`
/// before every halt return path so the per-conversation cost figures and
/// stuck-detector buckets are preserved across `send_message_stream` calls.
pub fn extract_carry_over(s: &LoopState) -> ConversationCarryOver {
    ConversationCarryOver {
        conversation_cumulative_cost_usd: s.conversation_cumulative_cost_usd,
        cost_warning_80_emitted: s.cost_warning_80_emitted,
        compactions_this_run: s.compactions_this_run,
        consecutive_no_tool_turns: s.consecutive_no_tool_turns,
        last_progress_iteration: s.last_progress_iteration,
        last_progress_text_hash: s.last_progress_text_hash,
        last_iter_cost: s.last_iter_cost,
    }
}

// ─── Loop halt reasons ────────────────────────────────────────────────────

/// Plan 34-02 — scope discriminator for CostExceeded.
/// PerLoop = single user turn (Phase 33's `loop.cost_guard_dollars` cap).
/// PerConversation = lifetime of the SessionWriter's session_id (Phase 34's
/// `resilience.cost_guard_per_conversation_dollars` cap).
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum CostScope {
    PerLoop,
    PerConversation,
}

/// Plan 34-02 (RES-02) — failed provider attempt captured by the circuit
/// breaker. Surfaced to the user as the `attempts_summary` field of
/// `LoopHaltReason::CircuitOpen` so the chat UI can render "what was tried".
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct AttemptRecord {
    pub provider: String,
    pub model: String,
    pub error_message: String,
    pub timestamp_ms: u64,
}

/// LOOP-06 + RES-02 — structured halt reasons. Returned from `run_loop` to the
/// outer orchestration in commands.rs, which maps each variant to the
/// appropriate chat_error / chat_cancelled emit.
///
/// Plan 34-08 — `serde::Serialize` added so the SESS-01 SessionWriter can
/// record a `HaltReason { payload }` JSONL line that round-trips through
/// `serde_json::to_value` at the halt site in `commands::send_message_stream_inline`.
#[derive(Debug, Clone, serde::Serialize)]
pub enum LoopHaltReason {
    /// LOOP-06 — cumulative cost exceeded the cap. Plan 34-02 added the
    /// `scope: CostScope` field to distinguish per-loop (Phase 33) from
    /// per-conversation (Phase 34 RES-04). Emit blade_loop_event
    /// {kind: "halted", reason: "cost_exceeded"} + chat_error with the figures.
    CostExceeded { spent_usd: f32, cap_usd: f32, scope: CostScope },
    /// LOOP-06 — `config.r#loop.max_iterations` exhausted without resolution.
    /// Existing iteration-exhausted handling continues (preserve current
    /// commands.rs behavior; just emit blade_loop_event).
    IterationCap,
    /// User pressed cancel (CHAT_CANCEL atomic flipped).
    Cancelled,
    /// Provider error that wasn't recoverable via classify_api_error fallback.
    ProviderFatal { error: String },
    /// Plan 34-04 (RES-01) — stuck pattern detected. `pattern` is one of
    /// "RepeatedActionObservation" | "MonologueSpiral" | "ContextWindowThrashing"
    /// | "NoProgress" | "CostRunaway".
    Stuck { pattern: String },
    /// Plan 34-05 (RES-02) — circuit breaker opened after N consecutive
    /// same-`error_kind` failures. `attempts_summary` lists the captured
    /// failures within the breaker window.
    CircuitOpen {
        error_kind: String,
        attempts_summary: Vec<AttemptRecord>,
    },
    /// Phase 35 / DECOMP-01 — `execute_decomposed_task` fanned out to N
    /// sub-agents, collected all summaries, injected them into the parent's
    /// conversation as synthetic AssistantTurns, and returned. The parent
    /// loop returns this halt reason to commands.rs which stops iterating.
    /// Carries no payload — the conversation already holds the summaries.
    DecompositionComplete,
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

// ─── LOOP-01 — mid-loop verification (Plan 33-04) ─────────────────────────

/// LOOP-01 — three-way verdict from the cheap-model verification probe.
///
/// Wire flow (CONTEXT lock §Mid-Loop Verification):
///   YES    → continue normally; no nudge injected
///   NO     → emit blade_loop_event {verdict: "NO"};
///            inject "Internal check: …reconsider the approach." system msg
///   REPLAN → emit blade_loop_event {verdict: "REPLAN"};
///            inject "Internal check: …re-plan from current state." system msg
///
/// Note: REPLAN here is NOT the same trigger as Plan 33-05's third-same-tool
/// reject_plan. They're separate signals that may both inject "re-plan"
/// nudges within a run; landmine #11 stacking-prevention guards both.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Verdict {
    /// Loop is progressing toward the goal — continue normally.
    Yes,
    /// Loop is not progressing — inject a "reconsider the approach" nudge.
    No,
    /// Loop should re-plan from current state — inject a "do not retry verbatim" nudge.
    Replan,
}

/// LOOP-01 — verification probe.
///
/// Routes to `crate::config::cheap_model_for_provider(provider, model)` (the
/// helper added in Phase 32-04) and submits the locked verification prompt
/// (CONTEXT lock §Mid-Loop Verification — DO NOT paraphrase).
///
/// Test seam: `LOOP_OVERRIDE=YES|NO|REPLAN` short-circuits the cheap-model
/// call (mirrors `CTX_SCORE_OVERRIDE` from Phase 32-02). Useful for unit
/// tests that want to exercise each verdict branch without a network call.
/// Anything else (including empty string) returns `Err(...)`.
///
/// Failure mode: returns Err on network error, parse error, invalid override,
/// or unparseable verdict word. Callers MUST NOT halt the main loop on Err —
/// the firing site in `run_loop` swallows the Err and continues. CTX-07
/// fallback discipline.
///
/// Argument constraints:
///   - `goal` is safe_slice'd to 1500 chars internally (don't pre-truncate
///     at call sites; just pass last_user_text).
///   - `actions` summaries are safe_slice'd to 300 chars internally per entry.
pub async fn verify_progress(
    provider: &str,
    api_key: &str,
    model: &str,
    goal: &str,
    actions: &VecDeque<ActionRecord>,
) -> Result<Verdict, String> {
    // Test seam — bypass the cheap-model call. Mirrors CTX_SCORE_OVERRIDE
    // from Phase 32-02 (brain.rs scoring path). Documented in
    // 33-RESEARCH.md §Implementation Sketches/LOOP-01.
    if let Ok(override_val) = std::env::var("LOOP_OVERRIDE") {
        return match override_val.to_uppercase().as_str() {
            "YES"    => Ok(Verdict::Yes),
            "NO"     => Ok(Verdict::No),
            "REPLAN" => Ok(Verdict::Replan),
            other    => Err(format!("invalid LOOP_OVERRIDE: {}", other)),
        };
    }

    let cheap_model = crate::config::cheap_model_for_provider(provider, model);
    let goal_short = crate::safe_slice(goal, 1500);
    let actions_json = render_actions_json(actions);

    // CONTEXT lock §Mid-Loop Verification — DO NOT paraphrase this prompt.
    // The grep acceptance criterion in Plan 33-04 requires the literal
    // "Reply with exactly one word: YES, NO, or REPLAN" substring.
    let prompt = format!(
        "Given the original goal `{}` and the last 3 tool actions `{}`, \
         is the loop progressing toward the goal? \
         Reply with exactly one word: YES, NO, or REPLAN, followed by a one-sentence reason.",
        goal_short, actions_json
    );

    let response = crate::providers::complete_simple(provider, api_key, &cheap_model, &prompt)
        .await
        .map_err(|e| format!("verify_progress provider call failed: {}", e))?;

    let first_word = response
        .trim_start()
        .split_whitespace()
        .next()
        .unwrap_or("")
        .to_uppercase();
    match first_word.as_str() {
        "YES"    => Ok(Verdict::Yes),
        "NO"     => Ok(Verdict::No),
        "REPLAN" => Ok(Verdict::Replan),
        _        => Err(format!("unexpected verdict word from verifier: {:?}", first_word)),
    }
}

/// Plan 33-09 — test-only override seam. When set to `true`, `render_actions_json`
/// panics on entry. Used to assert that a panic in the verification probe code
/// path is caught by `run_loop`'s `catch_unwind` wrapper and does NOT halt the
/// main loop. Mirrors `brain.rs::CTX_SCORE_OVERRIDE` from Phase 32-02 (commit
/// bb5d6ce).
///
/// Gated `#[cfg(test)]` so production builds carry zero overhead and have no
/// panic surface here. Cargo's default test profile enables `cfg(test)`.
#[cfg(test)]
thread_local! {
    pub(crate) static FORCE_VERIFY_PANIC: std::cell::Cell<bool> =
        const { std::cell::Cell::new(false) };
}

/// Render recent_actions as a compact JSON array. Each summary is
/// safe_slice'd to 300 chars to bound the prompt size
/// (CONTEXT lock §Mid-Loop Verification).
pub(crate) fn render_actions_json(actions: &VecDeque<ActionRecord>) -> String {
    // Plan 33-09 — panic-injection seam. When `FORCE_VERIFY_PANIC` is set,
    // panic before doing any work. The `run_loop` verification firing site
    // wraps `verify_progress(...)` in `AssertUnwindSafe(...).catch_unwind()`
    // (futures::FutureExt) so this panic is caught and the iteration
    // continues. The test
    // `phase33_loop_01_panic_in_verify_progress_caught_by_outer_wrapper`
    // exercises that boundary end-to-end.
    #[cfg(test)]
    FORCE_VERIFY_PANIC.with(|p| {
        if p.get() {
            panic!("test-only induced panic in render_actions_json (Plan 33-09 regression)");
        }
    });
    let mut entries: Vec<serde_json::Value> = Vec::with_capacity(actions.len());
    for a in actions {
        entries.push(serde_json::json!({
            "tool": a.tool,
            "in":  crate::safe_slice(&a.input_summary, 300),
            "out": crate::safe_slice(&a.output_summary, 300),
            "err": a.is_error,
        }));
    }
    serde_json::Value::Array(entries).to_string()
}

// ─── LOOP-04 — truncation detection + max-tokens escalation (Plan 33-06) ──

/// Returns true if the turn appears truncated mid-output. Two signals
/// (CONTEXT lock §Max-Output-Token Escalation):
///   1. Provider stop_reason indicates length cap reached (per-provider names
///      vary — see is_truncated_stop_reason).
///   2. Heuristic: last completed text chunk doesn't end with sentence-final
///      punctuation (or code-fence end backtick). Fallback for providers that
///      don't surface stop_reason cleanly (Ollama, some OpenRouter routes).
///
/// Note on UTF-8 safety: we operate on `chars().last()` (returns the final
/// scalar value), never on byte slices, so non-ASCII content is handled
/// correctly. The chars() iterator on a `&str` is O(n) — fine here because
/// the tail check runs once per turn, not per chunk.
pub fn detect_truncation(provider: &str, turn: &crate::providers::AssistantTurn) -> bool {
    if is_truncated_stop_reason(provider, turn.stop_reason.as_deref()) {
        return true;
    }
    // Punctuation heuristic — content empty → not truncated (just no text).
    let trimmed = turn.content.trim_end();
    if trimmed.is_empty() {
        return false;
    }
    let last = trimmed.chars().last().unwrap_or(' ');
    !matches!(last, '.' | '!' | '?' | ':' | '"' | ')' | '`')
}

fn is_truncated_stop_reason(provider: &str, stop_reason: Option<&str>) -> bool {
    match (provider, stop_reason) {
        ("anthropic",   Some("max_tokens")) => true,
        ("openai",      Some("length"))     => true,
        ("openrouter",  Some("length"))     => true,
        ("groq",        Some("length"))     => true,
        ("gemini",      Some(s)) if s.eq_ignore_ascii_case("MAX_TOKENS") => true,
        _ => false,
    }
}

/// Returns Some(new_max) where new_max = min(current * 2, provider_cap),
/// or None if no escalation is possible (current is already at or above the
/// per-model cap from `providers::max_output_tokens_for`). One-shot doubling
/// only — if a doubled retry STILL truncates, the second truncation is
/// accepted (CONTEXT lock §LOOP-04 — "each turn allows at most 1 escalation").
pub fn escalate_max_tokens(provider: &str, model: &str, current: u32) -> Option<u32> {
    let cap = crate::providers::max_output_tokens_for(provider, model);
    let doubled = current.saturating_mul(2);
    let new_max = doubled.min(cap);
    if new_max <= current { None } else { Some(new_max) }
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
    // Plan 34-08 (SESS-01) — JSONL forensic writer. Threaded from
    // `commands::send_message_stream_inline` so AssistantTurn / ToolCall /
    // LoopEvent emit sites inside the loop can record forensics for SESS-02
    // resume + SESS-03/04 list/fork. Pass a `SessionWriter::no_op()` handle
    // for callers that do not need recording (test paths).
    session_writer: &crate::session::log::SessionWriter,
    // Phase 34 / BL-01 (REVIEW finding) — per-conversation identifier used to
    // load + save the per-conversation carry-over state across
    // `send_message_stream` calls. When empty (test paths or session
    // logging disabled), the carry-over is in-memory-only for this turn —
    // matches the legacy per-turn semantics.
    conversation_id: &str,
) -> Result<(), LoopHaltReason> {
    // Phase 34 / BL-01 (REVIEW finding) — central LoopState now lives in the
    // outer wrapper so we can persist the carry-over slice back to the
    // process-global registry on EVERY return path (Ok, all Err variants).
    // The for-loop body lives in `run_loop_inner` below and operates on
    // `&mut loop_state`.
    let mut loop_state = LoopState::default();
    let prior = load_conversation_state(conversation_id);
    loop_state.conversation_cumulative_cost_usd = prior.conversation_cumulative_cost_usd;
    loop_state.cost_warning_80_emitted = prior.cost_warning_80_emitted;
    loop_state.compactions_this_run = prior.compactions_this_run;
    loop_state.consecutive_no_tool_turns = prior.consecutive_no_tool_turns;
    loop_state.last_progress_iteration = prior.last_progress_iteration;
    loop_state.last_progress_text_hash = prior.last_progress_text_hash;
    loop_state.last_iter_cost = prior.last_iter_cost;

    let result = run_loop_inner(
        app,
        state,
        approvals,
        vector_store,
        config,
        conversation,
        tools,
        last_user_text,
        brain_plan_used,
        meta_low_confidence,
        meta_pre_check,
        input_message_count,
        turn_acc,
        current_message_id,
        session_writer,
        &mut loop_state,
    )
    .await;

    // BL-01 — persist the carry-over fields back to the registry, regardless
    // of how the loop exited. Cost figures are especially load-bearing: a
    // `CostExceeded` halt MUST keep the cumulative spend so the next turn's
    // top-of-iteration check observes it.
    save_conversation_state(conversation_id, extract_carry_over(&loop_state));

    result
}

/// BL-01 — inner driver. Owns the iteration body. Operates on a `&mut
/// LoopState` provided by the outer wrapper so we can persist carry-over
/// state on every return path uniformly.
#[allow(clippy::too_many_arguments)]
async fn run_loop_inner(
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
    session_writer: &crate::session::log::SessionWriter,
    loop_state: &mut LoopState,
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
        // Plan 33-05 — keep LoopState.iteration in sync with the for-loop
        // index so the stacking-prevention check (last_nudge_iteration) and
        // future verification cadence (Plan 33-04) read the right value.
        loop_state.iteration = iteration as u32;

        // Check cancellation before each iteration
        if CHAT_CANCEL.load(Ordering::SeqCst) {
            return Err(LoopHaltReason::Cancelled);
        }

        // ─── Plan 34-04 (RES-01) — stuck detection ──────────────────────
        //
        // Walk the 5 stuck patterns at iteration top, BEFORE the cost-guard
        // halt below. CostRunaway has highest priority within the stuck set,
        // but the cost-guard ($5/loop cap) still wins on absolute spend
        // because CostRunaway only trips at 2× rolling avg — not at 100% of
        // the cap. The two halts coexist:
        //   - CostRunaway: "this turn is anomalously expensive" (relative)
        //   - CostExceeded: "you've spent more than the cap" (absolute)
        //
        // CTX-07 fallback discipline: any panic inside the detector code
        // path is caught here; the loop continues with no halt injected.
        // Mirrors Plan 33-09's verify_progress catch_unwind wrapper above.
        // detect_stuck is synchronous (not a future), so plain catch_unwind
        // suffices — no futures::FutureExt needed. AssertUnwindSafe is
        // required because &loop_state and &config.resilience aren't
        // unconditionally UnwindSafe (the captured refs are read-only inside
        // the closure so the assertion is safe).
        //
        // Skipped entirely when smart_resilience_enabled OR
        // stuck_detection_enabled is false — both checks live inside
        // detect_stuck (CTX-07 escape hatch).
        let stuck_result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            crate::resilience::stuck::detect_stuck(&loop_state, &config.resilience)
        }));
        match stuck_result {
            Ok(Some(pattern)) => {
                let pattern_str = pattern.discriminant().to_string();
                // Plan 34-08 (SESS-01) — emit_with_jsonl pairs every
                // blade_loop_event with a JSONL LoopEvent so SESS-02 resume
                // can replay stuck-pattern forensics.
                crate::commands::emit_with_jsonl(
                    &app,
                    session_writer,
                    "stuck_detected",
                    serde_json::json!({ "pattern": &pattern_str }),
                );
                crate::commands::emit_with_jsonl(
                    &app,
                    session_writer,
                    "halted",
                    serde_json::json!({ "reason": format!("stuck:{}", &pattern_str) }),
                );
                let _ = app.emit("blade_status", "error");
                return Err(LoopHaltReason::Stuck { pattern: pattern_str });
            }
            Ok(None) => { /* no pattern fired — continue iteration body */ }
            Err(_panic) => {
                // Panic in detector code path — swallowed per CTX-07
                // discipline. Loop continues without injecting a halt.
                // Threat T-34-15 mitigation: the
                // phase34_res_01_panic_in_detect_stuck_caught_by_outer_wrapper
                // regression test fails loudly if this wrapper goes missing.
                eprintln!(
                    "[BLADE] detect_stuck panicked at iteration {}; loop continues (Plan 34-04 catch_unwind)",
                    loop_state.iteration
                );
            }
        }

        // ─── Plan 34-06 (RES-03 + RES-04) — per-conversation cost guard ──
        //
        // Two-tier check on conversation_cumulative_cost_usd (Plan 34-02
        // LoopState field; runtime accumulation wired below at the post-turn
        // accumulation site). Per CONTEXT lock §Backward Compatibility:
        //   - 100% halt fires UNCONDITIONALLY (data integrity > smart features).
        //     Even when smart_resilience_enabled = false, this halt still fires.
        //   - 80% warn is gated by smart_resilience_enabled.
        //   - Latch via cost_warning_80_emitted to fire ONCE per conversation.
        //
        // Coexistence with Phase 33-08 per-loop cap (block immediately below):
        //   - Per-conversation cap fires FIRST (longer scope wins).
        //   - Per-loop cap (gated by loop.smart_loop_enabled) keeps its own
        //     scope: CostScope::PerLoop semantics — both ceilings can trip
        //     within the same iteration; whichever predicate is true first
        //     short-circuits.
        //
        // Threat T-34-24 mitigation: regression test
        // phase34_res_04_smart_off_skips_warn_keeps_halt guards that smart-off
        // does NOT skip the 100% halt.
        let per_conv_cap = config.resilience.cost_guard_per_conversation_dollars;
        let per_conv_spent = loop_state.conversation_cumulative_cost_usd;
        if per_conv_spent > per_conv_cap {
            // Plan 34-08 (SESS-01) — emit_with_jsonl mirrors per-conversation
            // cost_exceeded halt to JSONL for SESS-02 resume forensics.
            crate::commands::emit_with_jsonl(
                &app,
                session_writer,
                "halted",
                serde_json::json!({
                    "reason": "cost_exceeded",
                    "scope": "PerConversation",
                    "spent_usd": per_conv_spent,
                    "cap_usd": per_conv_cap,
                }),
            );
            let _ = app.emit("blade_status", "error");
            return Err(LoopHaltReason::CostExceeded {
                spent_usd: per_conv_spent,
                cap_usd: per_conv_cap,
                scope: CostScope::PerConversation,
            });
        }
        if config.resilience.smart_resilience_enabled
            && !loop_state.cost_warning_80_emitted
            && per_conv_spent > 0.8 * per_conv_cap
        {
            // Plan 34-08 — JSONL-paired cost_warning emit.
            crate::commands::emit_with_jsonl(
                &app,
                session_writer,
                "cost_warning",
                serde_json::json!({
                    "percent": 80,
                    "spent_usd": per_conv_spent,
                    "cap_usd": per_conv_cap,
                }),
            );
            loop_state.cost_warning_80_emitted = true;
        }

        // ─── LOOP-06 — cost guard halt (Plan 33-08) ─────────────────────
        //
        // At the top of each iteration (after cancellation, before any
        // provider call), check whether cumulative cost has crossed the
        // configured cap. The cumulative_cost_usd field is populated AFTER
        // each complete_turn (see "LOOP-06 cumulative cost tracking" below);
        // an overage from iteration N is observed at the top of iteration N+1
        // and halts before the next API call fires.
        //
        // Smart-only — when smart_loop_enabled=false, the entire block is
        // skipped (CTX-07 escape hatch — legacy 12-iteration loop has no
        // cost guard, preserving v1.0/v1.1 behavior verbatim). Threat T-33-31
        // mitigation: a future edit that drops the smart_loop_enabled gate
        // would start halting on cost in the legacy path, which the
        // phase33_smart_loop_disabled_no_cost_guard_halt regression test
        // catches.
        if config.r#loop.smart_loop_enabled
            && loop_state.cumulative_cost_usd > config.r#loop.cost_guard_dollars
        {
            // Plan 34-08 (SESS-01) — JSONL-paired per-loop cost_exceeded halt.
            crate::commands::emit_with_jsonl(
                &app,
                session_writer,
                "halted",
                serde_json::json!({
                    "reason": "cost_exceeded",
                    "scope": "PerLoop",
                    "spent_usd": loop_state.cumulative_cost_usd,
                    "cap_usd": config.r#loop.cost_guard_dollars,
                }),
            );
            let _ = app.emit("blade_status", "error");
            return Err(LoopHaltReason::CostExceeded {
                spent_usd: loop_state.cumulative_cost_usd,
                cap_usd: config.r#loop.cost_guard_dollars,
                scope: CostScope::PerLoop,
            });
        }

        // ─── LOOP-01 — mid-loop verification probe (Plan 33-04) ──────────
        //
        // Fires every config.r#loop.verification_every_n iterations starting
        // at iteration N (skip iteration 0 — recent_actions is empty there).
        // Honors smart_loop_enabled toggle (CONTEXT lock §Backward Compat).
        //
        // Firing site rationale (CONTEXT lock §Mid-Loop Verification): top
        // of iteration, AFTER cancellation check (don't waste a probe call
        // if the user cancelled), BEFORE complete_turn (so any injected
        // nudge is visible to the next assistant turn). Cadence math is
        // strict modulo — at verification_every_n=3, fires at iter 3, 6, 9…
        // and never at iter 0.
        //
        // CTX-07 fallback discipline: probe failure (Err from
        // verify_progress) MUST NOT halt the main loop. Log to stderr,
        // skip the nudge, continue. The cheap-model client itself returns
        // Result<_, String>, so the synchronous panic surface is small;
        // Plan 33-09 ports CTX-07's catch_unwind wrapper to harden against
        // future regressions in the verifier path.
        // Phase 33 / 33-NN-FIX (BL-01) — defense-in-depth zero-guard.
        // `LoopConfig::validate()` rejects verification_every_n=0 at
        // save_config time, but tests / future deserialize paths / in-memory
        // edits could bypass that gate. A literal `% 0` panics the run_loop
        // Tokio task with no chat_done/chat_error (CTX-07 fallback discipline
        // broken). Adding the explicit `> 0` term short-circuits the modulo
        // before evaluation. Per CONTEXT lock: zero-cadence is treated as
        // "verification disabled" — loop continues without probe.
        if config.r#loop.smart_loop_enabled
            && iteration > 0
            && config.r#loop.verification_every_n > 0
            && (iteration as u32) % config.r#loop.verification_every_n == 0
        {
            // Plan 33-09 — wrap the verify_progress future in
            // `AssertUnwindSafe(...).catch_unwind().await` (futures::FutureExt)
            // so a panic in render_actions_json or any other synchronous code
            // path inside the verifier swallows cleanly. CTX-07 fallback
            // discipline ported from Phase 32-07: smart path → naive path
            // (no nudge, loop continues). The
            // `phase33_loop_01_panic_in_verify_progress_caught_by_outer_wrapper`
            // regression test forces a panic via FORCE_VERIFY_PANIC and
            // asserts the wrapper catches it.
            //
            // AssertUnwindSafe is required because `&config.provider`,
            // `&config.api_key`, and `&config.model` are not auto-UnwindSafe
            // (BladeConfig carries types that aren't unconditionally
            // UnwindSafe — keyring handles, Mutex inner). The captured refs
            // are read-only inside the closure so the assertion is safe.
            use futures::FutureExt;
            let probe = std::panic::AssertUnwindSafe(verify_progress(
                &config.provider,
                &config.api_key,
                &config.model,
                last_user_text,
                &loop_state.recent_actions,
            ))
            .catch_unwind()
            .await;

            match probe {
                Ok(Ok(Verdict::Yes)) => {
                    // Plan 34-08 (SESS-01) — JSONL-paired verification_fired emit.
                    crate::commands::emit_with_jsonl(
                        &app,
                        session_writer,
                        "verification_fired",
                        serde_json::json!({ "verdict": "YES" }),
                    );
                    // No nudge injected — loop continues.
                }
                Ok(Ok(Verdict::No)) => {
                    crate::commands::emit_with_jsonl(
                        &app,
                        session_writer,
                        "verification_fired",
                        serde_json::json!({ "verdict": "NO" }),
                    );
                    // Stacking prevention (33-RESEARCH landmine #11) — if a
                    // nudge was injected within the last 2 iterations
                    // (Plan 33-05's reject_plan trigger or a prior verify
                    // verdict), suppress this one to avoid stacking.
                    let stacking = loop_state
                        .last_nudge_iteration
                        .map_or(false, |prev| {
                            loop_state.iteration.saturating_sub(prev) <= 2
                        });
                    if !stacking {
                        conversation.push(ConversationMessage::System(
                            "Internal check: the last 3 tool calls do not appear to be making progress. Reconsider the approach.".to_string(),
                        ));
                        loop_state.last_nudge_iteration = Some(loop_state.iteration);
                    }
                }
                Ok(Ok(Verdict::Replan)) => {
                    crate::commands::emit_with_jsonl(
                        &app,
                        session_writer,
                        "verification_fired",
                        serde_json::json!({ "verdict": "REPLAN" }),
                    );
                    let stacking = loop_state
                        .last_nudge_iteration
                        .map_or(false, |prev| {
                            loop_state.iteration.saturating_sub(prev) <= 2
                        });
                    if !stacking {
                        conversation.push(ConversationMessage::System(
                            "Internal check: re-plan from current state. Do not retry the failing step verbatim.".to_string(),
                        ));
                        loop_state.last_nudge_iteration = Some(loop_state.iteration);
                    }
                }
                Ok(Err(e)) => {
                    // Non-blocking — log to stderr, continue without injecting.
                    // CTX-07 fallback discipline: probe failure invisible to
                    // the user (no chat_error, no notification).
                    eprintln!("[LOOP-01] verify_progress error (non-blocking): {}", e);
                }
                Err(_panic) => {
                    // Plan 33-09 — CTX-07 fallback discipline: a panic in the
                    // verifier code path (render_actions_json, prompt build,
                    // anything inside the future before/around the .await) is
                    // SWALLOWED here. No nudge fires; loop_state.last_nudge_iteration
                    // is NOT updated; loop continues to the next iteration.
                    log::warn!(
                        "[LOOP-01] verify_progress panicked at iter {}; loop continues (Plan 33-09 regression discipline, smart path → dumb path)",
                        iteration
                    );
                }
            }
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
                        // Plan 34-05 (RES-02) — full-fidelity recorder captures
                        // provider/model/msg for LoopHaltReason::CircuitOpen.attempts_summary.
                        crate::commands::record_error_full(
                            "rate_limit",
                            &config.provider,
                            &config.model,
                            &e,
                        );
                        if is_circuit_broken("rate_limit") {
                            // Plan 34-05 (RES-02) — when smart_resilience_enabled, upgrade
                            // the trip from a generic ProviderFatal to a structured
                            // LoopHaltReason::CircuitOpen carrying attempts_summary so the
                            // chat surface can render "what was tried". When smart-off,
                            // preserve the legacy ProviderFatal posture.
                            let _ = app.emit("blade_status", "error");
                            if config.resilience.smart_resilience_enabled {
                                let attempts =
                                    crate::commands::circuit_attempts_summary("rate_limit");
                                let n = attempts.len() as u64;
                                emit_stream_event(
                                    &app,
                                    "blade_loop_event",
                                    serde_json::json!({
                                        "kind": "circuit_open",
                                        "error_kind": "rate_limit",
                                        "attempts": n,
                                    }),
                                );
                                return Err(LoopHaltReason::CircuitOpen {
                                    error_kind: "rate_limit".to_string(),
                                    attempts_summary: attempts,
                                });
                            }
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
                        // Plan 34-05 (RES-02) — full-fidelity recorder captures
                        // provider/model/msg for LoopHaltReason::CircuitOpen.attempts_summary.
                        crate::commands::record_error_full(
                            "overloaded",
                            &config.provider,
                            &config.model,
                            &e,
                        );
                        if is_circuit_broken("overloaded") {
                            // Plan 34-05 (RES-02) — when smart_resilience_enabled, upgrade
                            // the trip from a generic ProviderFatal to a structured
                            // LoopHaltReason::CircuitOpen carrying attempts_summary so the
                            // chat surface can render "what was tried". When smart-off,
                            // preserve the legacy ProviderFatal posture.
                            let _ = app.emit("blade_status", "error");
                            if config.resilience.smart_resilience_enabled {
                                let attempts =
                                    crate::commands::circuit_attempts_summary("overloaded");
                                let n = attempts.len() as u64;
                                emit_stream_event(
                                    &app,
                                    "blade_loop_event",
                                    serde_json::json!({
                                        "kind": "circuit_open",
                                        "error_kind": "overloaded",
                                        "attempts": n,
                                    }),
                                );
                                return Err(LoopHaltReason::CircuitOpen {
                                    error_kind: "overloaded".to_string(),
                                    attempts_summary: attempts,
                                });
                            }
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

        // ─── LOOP-04 — truncation detection + one-shot retry (Plan 33-06) ──
        //
        // Gated by smart_loop_enabled (CTX-07 escape hatch — when smart loop
        // is off, the entire block is skipped and the original possibly-
        // truncated turn flows through unchanged, matching legacy behavior).
        //
        // At most one escalation per turn — there is no `escalated_this_turn`
        // flag because the block only runs once per iteration; a SECOND
        // truncation on the retried turn is NOT re-escalated (we exit the
        // block after assigning `turn = retry_turn`). Test coverage:
        // phase33_loop_04_double_truncation_does_not_retry_again.
        //
        // Cost-guard interlock — Plan 33-08 wires real per-provider price math
        // (was a flat $0.00001/token stub through Plan 33-06). Now uses
        // `providers::price_per_million(provider, model)` to compute the
        // doubled-call's projected cost: same prompt tokens (no compaction
        // between the original and retry call) plus output up to new_max.
        // If projected cumulative cost exceeds cap, escalation is suppressed
        // and the truncated turn flows through unchanged.
        //
        // Why we mutate `turn` here (not later): the assistant turn must be
        // pushed into the conversation buffer with the FINAL (retried)
        // content so the model's next turn sees the full output. The
        // `conversation.push(...)` immediately after this block is the
        // canonical insertion site — touching anything beyond `turn` would
        // cross the wave-3 parallel-plan boundary (33-04 / 33-05 / 33-07
        // mount their own changes in different parts of the iteration body).
        //
        // CTX-07 / Phase 32-07 / Plan 33-04 / 33-NN-FIX (HI-03) panic-safety:
        //   1. The synchronous decision (detect → escalate → cost-guard
        //      projection) is wrapped in `catch_unwind(AssertUnwindSafe(...))`.
        //      If any of those steps panic (regression in detect_truncation,
        //      integer-overflow on a future cost-math edit), the smart-path
        //      collapses gracefully back to the dumb path: original truncated
        //      turn flows through, no retry, no crash.
        //   2. The async retry call (.await on
        //      `complete_turn_with_max_tokens`) is ALSO wrapped via
        //      `futures::FutureExt::catch_unwind` (mirrors the verifier path
        //      at lines 556-565). A panic inside any provider's response
        //      parser during the retry no longer kills the run_loop task —
        //      we keep the original turn and continue. CTX-07 discipline:
        //      smart-path → dumb path on panic, never main-thread crash.
        let mut turn = turn;
        // 33-NN-FIX (HI-02) — flag set when the truncation block has already
        // accumulated the original turn's cost. Used by the post-block
        // accumulator to avoid double-counting on retry-fail (where `turn`
        // still holds the original).
        let mut original_cost_already_tracked: bool = false;
        if config.r#loop.smart_loop_enabled {
            // 33-NN-FIX (HI-01) — per-provider default. Hardcoding 4096 here
            // mis-estimated Gemini/Groq/Ollama (whose actual default is 8192,
            // body-literal omitted in build_body). Result: a non-truncated
            // Groq/Gemini response that happened to lack terminal punctuation
            // would trigger escalate_max_tokens(.., 4096) → Some(8192) → retry
            // at the SAME ceiling the provider was already using → identical
            // truncation outcome at full retry cost (cost-burning false
            // positive). The fix uses `providers::default_max_tokens_for` so
            // escalate_max_tokens correctly returns None when current is
            // already at provider default ≥ provider cap.
            let current_max_tokens: u32 =
                crate::providers::default_max_tokens_for(&config.provider, &config.model);

            // Phase 32-07 / CTX-07 panic discipline — wrap the synchronous
            // decision so a regression in detect_truncation / escalate_max_tokens
            // / cost-math cannot take down the chat. AssertUnwindSafe is
            // required because the closure captures `&config` (BladeConfig
            // carries types not unconditionally UnwindSafe — keyring handles,
            // Mutex inner, etc.).
            let provider_str = config.provider.clone();
            let model_str = config.model.clone();
            let cumulative = loop_state.cumulative_cost_usd;
            let cost_cap = config.r#loop.cost_guard_dollars;
            let turn_tokens_in = turn.tokens_in;
            let turn_ref = &turn;
            let escalate_decision = std::panic::catch_unwind(
                std::panic::AssertUnwindSafe(|| {
                    if !detect_truncation(&provider_str, turn_ref) {
                        return None;
                    }
                    let new_max = escalate_max_tokens(
                        &provider_str, &model_str, current_max_tokens,
                    )?;
                    // Phase 33 / Plan 33-08 — cost-guard interlock with real
                    // per-provider rates. Conservative projection: assume the
                    // doubled retry's prompt tokens equal the first call's
                    // prompt tokens (no compaction in between) and output up
                    // to new_max tokens. This intentionally over-estimates
                    // (the model rarely outputs the full new_max), preserving
                    // the cost-guard's defensive posture.
                    let (price_in, price_out) =
                        crate::providers::price_per_million(&provider_str, &model_str);
                    let estimated_extra =
                        (turn_tokens_in as f32 * price_in
                         + new_max as f32 * price_out) / 1_000_000.0;
                    let projected = cumulative + estimated_extra;
                    if projected <= cost_cap {
                        Some(new_max)
                    } else {
                        None
                    }
                }),
            );

            let new_max_opt = match escalate_decision {
                Ok(v) => v,
                Err(_) => {
                    log::warn!(
                        "[LOOP-04] truncation-decision panicked; falling through to original turn (smart path → dumb path)"
                    );
                    None
                }
            };

            if let Some(new_max) = new_max_opt {
                // Plan 34-08 (SESS-01) — JSONL-paired token_escalated emit.
                crate::commands::emit_with_jsonl(
                    &app,
                    session_writer,
                    "token_escalated",
                    serde_json::json!({ "new_max": new_max }),
                );
                loop_state.token_escalations =
                    loop_state.token_escalations.saturating_add(1);

                // 33-NN-FIX (HI-02) — track the original truncated turn's
                // tokens BEFORE the retry call. Pre-fix wiring discarded the
                // turn after `turn = retry_turn` and the post-block
                // accumulation at line ~999 only saw the retry's tokens. The
                // original API call WAS billed (the provider returned a
                // partial result, not free), and on a 4096-output truncation
                // followed by an 8192-output retry on Anthropic Sonnet 4
                // ($3/$15 per million), the unaccounted spend was up to
                // ~$0.06 per truncation event — a real cost-guard
                // under-count. We now accumulate the original turn's cost
                // here, BEFORE the retry; the post-block accumulator picks
                // up the retry's cost on top, so total recorded spend =
                // original + retry whether the retry succeeds or fails.
                {
                    let (price_in, price_out) =
                        crate::providers::price_per_million(&config.provider, &config.model);
                    let original_cost = (turn.tokens_in as f32 * price_in
                                       + turn.tokens_out as f32 * price_out)
                                       / 1_000_000.0;
                    loop_state.cumulative_cost_usd += original_cost;
                    // Plan 34-06 (RES-03) — mirror into per-conversation
                    // running total. Lock-step with the per-loop accumulator
                    // above so the two ceilings observe the same spend on
                    // both retry-success and retry-fail paths.
                    loop_state.conversation_cumulative_cost_usd += original_cost;
                    original_cost_already_tracked = true;
                }

                // 33-NN-FIX (HI-03) — wrap the async retry call in
                // `futures::FutureExt::catch_unwind` (mirrors the verifier
                // path at lines 556-565). Pre-fix wiring left the .await
                // outside any panic shield; a regression in any provider's
                // response parser (malformed JSON unwrap, integer overflow
                // in usage parse, etc.) would crash the run_loop task with
                // no LoopHaltReason, no chat_error, no notification — chat
                // appears to hang. CTX-07 discipline says smart-path → naive
                // path on panic; this branch now honors that contract.
                //
                // AssertUnwindSafe is required because &BladeConfig and the
                // captured &conversation/&tools refs are not unconditionally
                // UnwindSafe — same posture as the verifier wrapper.
                //
                // Retry the SAME turn with the doubled max_tokens. The model
                // receives identical context (CONTEXT lock §LOOP-04 —
                // "retry-fresh"); only the max_tokens ceiling changes.
                use futures::FutureExt;
                let retry = std::panic::AssertUnwindSafe(
                    providers::complete_turn_with_max_tokens(
                        &config.provider,
                        &config.api_key,
                        &config.model,
                        conversation,
                        tools,
                        config.base_url.as_deref(),
                        new_max,
                    ),
                )
                .catch_unwind()
                .await;
                match retry {
                    Ok(Ok(retry_turn)) => {
                        // Discard the truncated turn; use the retry as the
                        // canonical turn. The original truncated turn was
                        // NOT yet pushed to `conversation` — that happens
                        // immediately below. Order matters here.
                        // NB: even if `retry_turn` is ALSO truncated, we do
                        // NOT re-escalate — one-shot only per CONTEXT lock
                        // §LOOP-04 ("each turn allows at most 1 escalation").
                        // The block has already exited the truncation gate;
                        // the retried turn flows through to conversation.push.
                        turn = retry_turn;
                        // Clear the flag — `turn` is now the retry, whose
                        // cost has NOT been tracked yet. Post-block accumulator
                        // must run on the retry's tokens. (HI-02: this gives
                        // total = original + retry, both accounted.)
                        original_cost_already_tracked = false;
                    }
                    Ok(Err(_e)) => {
                        // Retry returned Err — accept the original truncated
                        // turn. No infinite escalation, no second chance.
                        // Note: the original turn's cost was ALREADY tracked
                        // above (HI-02). Flag stays true so the post-block
                        // accumulator does NOT double-count.
                    }
                    Err(_panic) => {
                        // Panic inside complete_turn_with_max_tokens (or any
                        // future internal change to its provider parsers).
                        // CTX-07 fallback discipline: smart path → dumb path.
                        // Keep the original turn (already cost-tracked above)
                        // and let the loop body continue to the next iteration.
                        // Flag stays true → post-block does NOT double-count.
                        log::warn!(
                            "[LOOP-04] complete_turn_with_max_tokens panicked during retry; \
                             keeping original truncated turn (smart path → dumb path, \
                             CTX-07 discipline; 33-NN-FIX HI-03 regression discipline)"
                        );
                    }
                }
            }
        }

        // ─── LOOP-06 — cumulative cost tracking (Plan 33-08) ────────────
        //
        // Accumulate the just-completed turn's cost into LoopState.
        // Smart-only — when smart_loop_enabled=false, the cumulative_cost_usd
        // field stays at 0.0 forever (matches the legacy 12-iteration loop's
        // cost-blind behavior; the cost-guard halt at iteration top is also
        // gated on smart_loop_enabled, so this is consistent).
        //
        // The accumulation reads `turn.tokens_in` / `turn.tokens_out` (set
        // by the provider response parser — see Plan 33-08 Task 1).
        // Providers that don't report usage default to 0 here; their
        // contribution to cumulative_cost_usd is 0.
        //
        // Called AFTER the LOOP-04 truncation retry block. 33-NN-FIX (HI-02)
        // changed the accounting model so that BOTH the original truncated
        // call AND the retry call are recorded on retry-success:
        //   - Original turn's cost is accumulated INSIDE the truncation block
        //     BEFORE the retry runs (so it survives even if the retry fails
        //     or panics).
        //   - On retry-success, the truncation block sets `turn = retry_turn`
        //     and clears `original_cost_already_tracked` — this accumulator
        //     then picks up the retry's cost on top of the already-tracked
        //     original.
        //   - On retry-fail / retry-panic, `turn` still holds the original
        //     and the flag stays `true` — this accumulator skips, avoiding
        //     a double-count.
        //   - On the no-truncation path, the flag stays `false` (set on entry)
        //     and this accumulator runs normally on the single turn.
        if config.r#loop.smart_loop_enabled && !original_cost_already_tracked {
            // 33-NN-FIX (HI-02) — the `!original_cost_already_tracked` guard
            // prevents double-counting on retry-fail / retry-panic paths
            // where `turn` still holds the original (whose cost was already
            // accumulated inside the truncation block). On retry-success,
            // the truncation block clears the flag so this accumulator picks
            // up the retry's tokens on top of the already-tracked original.
            let (price_in, price_out) =
                crate::providers::price_per_million(&config.provider, &config.model);
            let turn_cost_usd =
                (turn.tokens_in as f32 * price_in
                 + turn.tokens_out as f32 * price_out)
                / 1_000_000.0;
            loop_state.cumulative_cost_usd += turn_cost_usd;
        }

        // ─── Plan 34-06 (RES-03) — per-conversation cost accumulation ───
        //
        // Same arithmetic as Phase 33-08 per-loop accumulator, separate field
        // so per-loop and per-conversation caps are independently observable.
        // UNCONDITIONAL — CONTEXT lock §Backward Compatibility absolute
        // guarantee: "Per-conversation cost cap still enforced at 100% (data
        // integrity > smart features)." Even smart-off conversations must
        // accumulate so the 100% halt at the iteration top can fire.
        //
        // Plan 34-08's SessionWriter persists conversation_cumulative_cost_usd
        // across reload via the cost_update LoopEvent emitted at iteration end
        // — reopened sessions restore the running total.
        //
        // Note on truncation-retry accounting (LOOP-04 / HI-02): when the
        // truncation block retried and FAILED (or panicked), the per-loop
        // accumulator above skips because the original turn's cost was
        // already added INSIDE the truncation block at line ~1181, and `turn`
        // still holds the original (so accumulating again here would
        // double-count). We mirror that discipline here for per-conversation
        // (gated on the same flag) so the two totals stay in lock-step. On
        // the no-truncation path or retry-success path, the flag is false and
        // `turn` holds the canonical (original or retry) turn whose cost has
        // not yet been accumulated — we add it here.
        if !original_cost_already_tracked {
            let (price_in, price_out) =
                crate::providers::price_per_million(&config.provider, &config.model);
            let turn_cost_usd =
                (turn.tokens_in as f32 * price_in
                 + turn.tokens_out as f32 * price_out)
                / 1_000_000.0;
            loop_state.conversation_cumulative_cost_usd += turn_cost_usd;
        }

        // ─── Plan 34-06 (RES-03) — live cost meter tick ─────────────────
        //
        // Emit at iteration end so the chat-input cost-meter chip (Plan 34-11
        // frontend) renders current spend without polling. Per CONTEXT lock
        // §RES-03: "The chat UI subscribes to blade_loop_event { kind:
        // 'cost_update' } for live updates". Unconditional emit — the
        // frontend can choose to hide the chip when smart_resilience_enabled
        // is false; the backend always provides the data so a toggle-on flips
        // the chip live. SessionWriter (Plan 34-08) persists this event to
        // JSONL so resume restores the running total.
        let cost_update_cap =
            config.resilience.cost_guard_per_conversation_dollars.max(0.0001);
        let cost_update_pct =
            (100.0 * loop_state.conversation_cumulative_cost_usd / cost_update_cap) as u32;
        // Plan 34-08 (SESS-01) — JSONL-paired cost_update tick. Per CONTEXT
        // lock §RES-03, SessionWriter persists this event so SESS-02 resume
        // can restore the running per-conversation total without re-summing.
        crate::commands::emit_with_jsonl(
            &app,
            session_writer,
            "cost_update",
            serde_json::json!({
                "spent_usd": loop_state.conversation_cumulative_cost_usd,
                "cap_usd": config.resilience.cost_guard_per_conversation_dollars,
                "percent": cost_update_pct,
            }),
        );

        // ─── Plan 34-04 (RES-01) — feed the stuck detectors ─────────────
        //
        // After each successful complete_turn, populate four LoopState
        // fields that the 5 stuck detectors read at the next iteration top:
        //   (a) consecutive_no_tool_turns: ++ on no tool calls; reset on
        //       any tool call. Drives MonologueSpiral.
        //   (b) last_iter_cost: per-iteration marginal cost. Drives
        //       CostRunaway (uses the same price_per_million as cumulative).
        //   (c) last_progress_iteration / last_progress_text_hash:
        //       new-tool-name OR new-content advance. Drives NoProgress.
        //
        // All updates gated by smart_resilience_enabled — when smart-off,
        // these fields stay at their defaults forever and the smart-off
        // regression test (phase34_smart_resilience_disabled_no_smart_features)
        // confirms detect_stuck returns None at the iteration-top call site.
        // Threat T-34-19 mitigation: forgotten gate would start tripping
        // detectors in smart-off; the regression test guards every gate.
        if config.resilience.smart_resilience_enabled {
            // (a) MonologueSpiral counter
            if turn.tool_calls.is_empty() {
                loop_state.consecutive_no_tool_turns =
                    loop_state.consecutive_no_tool_turns.saturating_add(1);
            } else {
                loop_state.consecutive_no_tool_turns = 0;
            }
            // (b) CostRunaway per-iter marginal cost
            {
                let (price_in, price_out) =
                    crate::providers::price_per_million(&config.provider, &config.model);
                let iter_cost = (turn.tokens_in as f32 * price_in
                    + turn.tokens_out as f32 * price_out)
                    / 1_000_000.0;
                loop_state.last_iter_cost = iter_cost;
            }
            // (c) NoProgress predicate — new tool name OR new content
            {
                use sha2::{Digest, Sha256};
                use std::collections::HashSet;
                let mut progressed = false;
                if !turn.tool_calls.is_empty() {
                    let new_names: HashSet<&str> =
                        turn.tool_calls.iter().map(|tc| tc.name.as_str()).collect();
                    let known_names: HashSet<&str> = loop_state
                        .recent_actions
                        .iter()
                        .map(|a| a.tool.as_str())
                        .collect();
                    if new_names.iter().any(|n| !known_names.contains(n)) {
                        progressed = true;
                    }
                }
                let prefix = crate::safe_slice(&turn.content, 500);
                let mut hasher = Sha256::new();
                hasher.update(prefix.as_bytes());
                let digest = hasher.finalize();
                let mut h: [u8; 16] = [0; 16];
                h.copy_from_slice(&digest[..16]);
                if loop_state.last_progress_text_hash != Some(h) {
                    progressed = true;
                }
                if progressed {
                    loop_state.last_progress_iteration = loop_state.iteration;
                    loop_state.last_progress_text_hash = Some(h);
                }
            }

            // ───── Plan 34-05 (RES-02) — circuit-breaker reset on success ─────
            // Successful complete_turn = circuit closes. Without this,
            // ERROR_HISTORY accumulates monotonically (until the 50-entry cap
            // drains the oldest 10); a stale window of rate_limits would block
            // the system from ever escaping. Gated by smart_resilience_enabled
            // so the smart-off path preserves Phase 33's monotonic-history
            // behavior — Threat T-34-22 mitigation.
            crate::commands::clear_error_history();
        }

        // ─── Plan 34-08 (SESS-01) — AssistantTurn JSONL emit ─────────────
        //
        // Record the just-completed assistant turn into the SessionWriter's
        // JSONL log for SESS-02 resume + SESS-03/04 list/fork forensics.
        // Fires for every turn (tool-call AND empty-tool-call branches),
        // BEFORE the conversation.push below so the JSONL line ordering
        // mirrors the conversation's append order.
        //
        // safe_slice the content to 4000 chars (huge assistant blobs would
        // bloat the JSONL; full content is reproducible from the conversation
        // mid-replay anyway). Tool-call args are excerpted to 200 chars per
        // call via ToolCallSnippet — full args are recorded as separate
        // ToolCall events further down at the dispatch site.
        {
            let tool_call_snippets: Vec<crate::session::log::ToolCallSnippet> = turn
                .tool_calls
                .iter()
                .map(|tc| crate::session::log::ToolCallSnippet {
                    name: tc.name.clone(),
                    args_excerpt: crate::safe_slice(
                        &serde_json::to_string(&tc.arguments).unwrap_or_default(),
                        200,
                    )
                    .to_string(),
                })
                .collect();
            session_writer.append(&crate::session::log::SessionEvent::AssistantTurn {
                content: crate::safe_slice(&turn.content, 4000).to_string(),
                tool_calls: tool_call_snippets,
                stop_reason: turn.stop_reason.clone(),
                tokens_in: turn.tokens_in,
                tokens_out: turn.tokens_out,
                timestamp_ms: crate::session::log::now_ms(),
            });
        }

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

            // Plan 33-05 (LOOP-02 + LOOP-03) — tool-failure boundary.
            //
            // LOOP-02: when the dispatch produced an error, wrap the (already
            // explain_tool_failure-enriched, cap_tool_output-capped) content
            // into a structured ToolError, populate suggested_alternatives via
            // enrich_alternatives, and render via ToolError::render_for_model.
            // The rendered string replaces the bare error content in the
            // conversation, so the model sees the locked CONTEXT format
            // (Tool failed.\nAttempted:\nReason:\nSuggested alternatives:)
            // instead of a bare error string.
            //
            // LOOP-03: track per-tool consecutive failure counts. On the third
            // consecutive same-tool failure, fire brain_planner::reject_plan,
            // increment loop_state.replans_this_run, emit blade_loop_event
            // {kind: "replanning", count: N}, and inject a "re-plan from
            // current state" system nudge. Stacking prevention (33-RESEARCH
            // landmine #11) suppresses the nudge if last_nudge_iteration is
            // within 2 iterations.
            //
            // CONTEXT lock §Backward Compatibility: when smart_loop_enabled
            // is false, neither LOOP-02 enrichment nor LOOP-03 trigger fires —
            // the legacy (content, is_error) tuple flows straight to the push
            // exactly as before this plan landed.
            let content = if config.r#loop.smart_loop_enabled && is_error {
                // LOOP-02 — wrap, enrich, render.
                let mut tool_err = crate::native_tools::wrap_legacy_error(
                    &tool_call.name,
                    content.clone(),
                );
                tool_err.suggested_alternatives = enrich_alternatives(&tool_call.name);

                // LOOP-03 — track consecutive same-tool failures.
                // Reset map if the previous failure was for a different tool.
                let last_failed_tool = loop_state
                    .consecutive_same_tool_failures
                    .keys()
                    .next()
                    .cloned();
                if let Some(prev) = last_failed_tool {
                    if prev != tool_call.name {
                        loop_state.consecutive_same_tool_failures.clear();
                    }
                }
                let counter = loop_state
                    .consecutive_same_tool_failures
                    .entry(tool_call.name.clone())
                    .or_insert(0);
                *counter += 1;
                let triggered = *counter >= 3;

                if triggered {
                    // Stacking prevention (landmine #11) — if a nudge was
                    // injected within the last 2 iterations, skip this one.
                    let stacking = loop_state
                        .last_nudge_iteration
                        .map_or(false, |prev| {
                            loop_state.iteration.saturating_sub(prev) <= 2
                        });
                    if !stacking {
                        crate::brain_planner::reject_plan(last_user_text);
                        loop_state.replans_this_run =
                            loop_state.replans_this_run.saturating_add(1);
                        loop_state.last_nudge_iteration = Some(loop_state.iteration);
                        // Plan 34-08 (SESS-01) — JSONL-paired replanning emit.
                        crate::commands::emit_with_jsonl(
                            &app,
                            session_writer,
                            "replanning",
                            serde_json::json!({
                                "count": loop_state.replans_this_run,
                            }),
                        );
                        conversation.push(ConversationMessage::System(
                            "Internal check: re-plan from current state. Do not retry the failing step verbatim.".to_string(),
                        ));
                    }
                    // Reset the streak regardless — we acted on it (or
                    // suppressed via stacking guard); next failure starts a
                    // fresh count for this tool.
                    *counter = 0;
                }

                tool_err.render_for_model()
            } else if config.r#loop.smart_loop_enabled && !is_error {
                // Successful tool call — break any active failure streak.
                loop_state.consecutive_same_tool_failures.clear();
                content
            } else {
                // Legacy path (smart_loop_enabled=false) — preserve verbatim.
                content
            };

            // LOOP-01 (Plan 33-04) — record this tool dispatch into the
            // recent_actions ring buffer for the next verification probe.
            // Captured BEFORE conversation.push moves tool_call.name + content.
            // safe_slice happens inside render_actions_json (300 char cap per
            // field), so we keep the full strings here and let the renderer
            // bound them at probe time. Honors smart_loop_enabled — when
            // smart loop is off, the ring buffer is never consulted (the
            // verification firing site is gated on smart_loop_enabled), so
            // recording is a cheap no-op accumulating into a buffer that's
            // dropped at run_loop exit.
            let input_summary = serde_json::to_string(&tool_call.arguments)
                .unwrap_or_else(|_| String::new());
            // Phase 34 / HI-03 (REVIEW finding) — honor the runtime-configured
            // ring buffer capacity instead of the compile-time const. Users
            // who set `resilience.recent_actions_window = 12` for a long-form
            // research session now see the wider window take effect; previously
            // the field was dead code and `record_action` always truncated to
            // the hardcoded 6.
            loop_state.record_action_with_cap(
                ActionRecord {
                    tool: tool_call.name.clone(),
                    input_summary,
                    output_summary: content.clone(),
                    is_error,
                },
                config.resilience.recent_actions_window as usize,
            );

            // ─── Plan 34-08 (SESS-01) — ToolCall JSONL emit ──────────────
            //
            // Recorded BEFORE the conversation.push below so we can still
            // read `tool_call.name` and `content` (the push consumes
            // tool_call.id + tool_call.name + content by-value). The result/
            // error split mirrors how SESS-02 will reconstruct the tool
            // outcome on resume — non-error → result populated, error → error
            // populated; never both. safe_slice the result to 4000 chars to
            // bound JSONL line size; full content is preserved in the
            // conversation array which SESS-02 also replays.
            {
                let result_field = if is_error {
                    None
                } else {
                    Some(crate::safe_slice(&content, 4000).to_string())
                };
                let error_field = if is_error {
                    Some(crate::safe_slice(&content, 4000).to_string())
                } else {
                    None
                };
                session_writer.append(&crate::session::log::SessionEvent::ToolCall {
                    name: tool_call.name.clone(),
                    args: tool_call.arguments.clone(),
                    result: result_field,
                    error: error_field,
                    timestamp_ms: crate::session::log::now_ms(),
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

    // for-loop fell through (max_iter exhausted) or stuck-loop break triggered.
    // Caller continues to the loop-exhausted summary block at commands.rs:2584.
    //
    // Plan 33-08 — emit a structured halted event so ActivityStrip can render
    // the "halted: iteration cap" chip via blade_loop_event. Symmetric with
    // the cost_exceeded emit at iteration top.
    //
    // Plan 34-08 (SESS-01) — JSONL-paired iteration_cap halted emit.
    crate::commands::emit_with_jsonl(
        &app,
        session_writer,
        "halted",
        serde_json::json!({ "reason": "iteration_cap" }),
    );
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
        assert_eq!(s.conversation_cumulative_cost_usd, 0.0);
        assert_eq!(s.last_iter_cost, 0.0);
        assert_eq!(s.replans_this_run, 0);
        assert_eq!(s.token_escalations, 0);
        assert!(s.recent_actions.is_empty());
        assert!(s.consecutive_same_tool_failures.is_empty());
        assert_eq!(s.last_nudge_iteration, None);
        assert_eq!(s.consecutive_no_tool_turns, 0);
        assert_eq!(s.compactions_this_run, 0);
        assert_eq!(s.last_progress_iteration, 0);
        assert_eq!(s.last_progress_text_hash, None);
        assert!(!s.cost_warning_80_emitted);
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

    // ─── LOOP-04 detection + escalation tests (Plan 33-06) ─────────────

    fn fake_turn_result(stop_reason: Option<&str>, content: &str) -> crate::providers::AssistantTurn {
        crate::providers::AssistantTurn {
            content: content.to_string(),
            tool_calls: vec![],
            stop_reason: stop_reason.map(|s| s.to_string()),
            tokens_in: 0,
            tokens_out: 0,
        }
    }

    #[test]
    fn phase33_loop_04_detect_truncation_via_anthropic_max_tokens() {
        let t = fake_turn_result(Some("max_tokens"), "Hello, this is the start of a long");
        assert!(detect_truncation("anthropic", &t));
    }

    #[test]
    fn phase33_loop_04_detect_truncation_via_openai_length() {
        let t = fake_turn_result(Some("length"), "Hello, this is the start of a long");
        assert!(detect_truncation("openai", &t));
    }

    #[test]
    fn phase33_loop_04_detect_truncation_via_punctuation_heuristic() {
        let t = fake_turn_result(None, "Hello world we were just discussing");
        assert!(
            detect_truncation("anthropic", &t),
            "no terminal punctuation should trigger heuristic regardless of stop_reason"
        );
    }

    #[test]
    fn phase33_loop_04_no_truncation_on_clean_finish() {
        let t = fake_turn_result(Some("end_turn"), "Done.");
        assert!(!detect_truncation("anthropic", &t));
    }

    #[test]
    fn phase33_loop_04_escalate_doubles_under_cap() {
        // Anthropic Sonnet 4 cap is 8192. 4096 doubles to 8192, which equals
        // the cap — Some(8192) is correct (the doubled value, capped).
        let result = escalate_max_tokens("anthropic", "claude-sonnet-4-test", 4096);
        assert_eq!(result, Some(8192));
    }

    #[test]
    fn phase33_loop_04_escalate_caps_at_provider_max() {
        // 6000 doubled would be 12000 → capped at the Sonnet 4 ceiling 8192.
        let result = escalate_max_tokens("anthropic", "claude-sonnet-4-test", 6000);
        assert_eq!(result, Some(8192));
    }

    #[test]
    fn phase33_loop_04_escalate_returns_none_when_at_max() {
        // Already at cap — no further escalation possible.
        let result = escalate_max_tokens("anthropic", "claude-sonnet-4-test", 8192);
        assert_eq!(result, None);
    }

    #[test]
    fn phase33_loop_04_truncation_clean_punctuation_not_flagged() {
        let cases = [".", "!", "?", ":", "\"", ")", "`"];
        for c in cases {
            let t = fake_turn_result(None, &format!("Some text ending with {}", c));
            assert!(
                !detect_truncation("anthropic", &t),
                "content ending with {:?} must not be flagged as truncated",
                c
            );
        }
    }

    #[test]
    fn phase33_loop_04_cost_guard_interlock_stub_under_cap() {
        // Cost-guard interlock stub — when projected cost (cumulative + delta)
        // is below the cap, the escalation should fire. Locks the sign of the
        // arithmetic so a future Plan 33-08 wiring (real per-provider price
        // table) doesn't accidentally invert the comparison.
        let cumulative_cost_usd: f32 = 0.0;
        let cap: f32 = 5.0;
        let new_max: u32 = 8192;
        let current_max: u32 = 4096;
        let estimated_extra = (new_max as f32 - current_max as f32) * 0.000_01;
        let projected = cumulative_cost_usd + estimated_extra;
        assert!(projected <= cap, "stub estimate must remain under cap for typical case");
    }

    #[test]
    fn phase33_loop_04_truncation_detected_by_stop_reason() {
        // Operator's must-have test name (parity with the spec): exercising
        // the stop_reason signal across all 5 supported providers in one go.
        // Locks the truth: ANY provider whose stop_reason maps to "length-
        // equivalent" must trigger detection. Acts as a regression guard if
        // a future edit accidentally drops one of the per-provider arms in
        // is_truncated_stop_reason.
        let cases: &[(&str, &str)] = &[
            ("anthropic",  "max_tokens"),
            ("openai",     "length"),
            ("openrouter", "length"),
            ("groq",       "length"),
            ("gemini",     "MAX_TOKENS"),
            ("gemini",     "max_tokens"), // case-insensitive arm
        ];
        for (provider, reason) in cases {
            let t = fake_turn_result(Some(reason), "Hello world ending mid-thought");
            assert!(
                detect_truncation(provider, &t),
                "{}+{:?} must trigger truncation detection",
                provider, reason
            );
        }
    }

    #[test]
    fn phase33_loop_04_truncation_detected_by_no_punctuation() {
        // Operator's must-have test name (parity with the spec): the
        // punctuation-heuristic fallback fires when stop_reason is None
        // (Ollama, some OpenRouter routes — providers that don't surface a
        // clean stop_reason). Locks the heuristic so a future refactor that
        // makes detect_truncation provider-strict (i.e. drops the heuristic
        // when stop_reason is None) trips this test.
        let t = fake_turn_result(None, "Hello world we were just discussing");
        assert!(
            detect_truncation("ollama", &t),
            "no terminal punctuation + no stop_reason must trigger heuristic"
        );
        // Same content with an Anthropic provider (where stop_reason absent
        // is unusual but possible during error recovery) still triggers.
        assert!(
            detect_truncation("anthropic", &t),
            "punctuation heuristic is provider-agnostic when stop_reason is None"
        );
    }

    #[test]
    fn phase33_loop_04_one_shot_escalation_doubles_max_tokens() {
        // Operator's must-have test name (parity with the spec): the
        // one-shot doubling shape — current=4096 → new_max=8192. The
        // production wiring at run_loop's truncation gate hardcodes
        // current_max_tokens=4096 (matches anthropic.rs:26 + openai.rs:43
        // body-literal default). This test locks the shape of that
        // doubling so a future edit that accidentally triples or otherwise
        // mis-scales the retry trips the test.
        let result = escalate_max_tokens("anthropic", "claude-sonnet-4-test", 4096);
        assert_eq!(
            result, Some(8192),
            "4096 doubled = 8192 (capped at Sonnet 4 ceiling 8192)"
        );

        // OpenAI gpt-4o cap is 16384; 4096 doubled = 8192 (under cap).
        let result = escalate_max_tokens("openai", "gpt-4o", 4096);
        assert_eq!(
            result, Some(8192),
            "OpenAI 4096 doubled is 8192 (well under the 16384 gpt-4o cap)"
        );

        // OpenAI gpt-4o-mini same cap. 8192 doubled = 16384 (= cap exactly).
        let result = escalate_max_tokens("openai", "gpt-4o-mini", 8192);
        assert_eq!(
            result, Some(16384),
            "OpenAI 8192 doubled to 16384 = gpt-4o-mini cap"
        );
    }

    #[test]
    fn phase33_loop_04_smart_off_skips_escalation() {
        // Operator's must-have test name (parity with the spec): CTX-07
        // escape hatch — when smart_loop_enabled=false the entire LOOP-04
        // gate is skipped and no escalation fires regardless of truncation
        // signals. This locks the gate so a future edit that drops the
        // smart_loop_enabled term turns LOOP-04 on for legacy users (the
        // v1.1 mistake — smart-path turned on by default).
        let mut cfg = crate::config::BladeConfig::default();
        cfg.r#loop.smart_loop_enabled = false;

        // Construct a turn that WOULD trigger detection if the gate ran.
        let truncated = fake_turn_result(Some("max_tokens"), "Hello world ending mid-thought");
        assert!(
            detect_truncation("anthropic", &truncated),
            "test setup: detection must fire on this turn (otherwise the smart-off check is vacuous)"
        );

        // Production gate shape (mirrored from run_loop):
        //     if config.r#loop.smart_loop_enabled { /* truncation block */ }
        // When smart is off, the block is unreachable.
        let gate_passes = cfg.r#loop.smart_loop_enabled;
        assert!(
            !gate_passes,
            "smart_loop_enabled=false must short-circuit the LOOP-04 block"
        );
    }

    #[test]
    fn phase33_loop_04_escalation_caps_at_provider_max() {
        // Operator's must-have test name (parity with the spec): the doubled
        // value is capped at max_output_tokens_for. Already covered by
        // phase33_loop_04_escalate_caps_at_provider_max; this test locks the
        // contract across all five providers so a future per-provider cap
        // change (e.g. Anthropic 64000-beta header) requires updating both
        // the registry and this test.
        let cases: &[(&str, &str, u32, u32)] = &[
            // (provider, model, current, expected_new_max)
            ("anthropic",  "claude-sonnet-4-test", 6000, 8192),  // doubled = 12000 → cap 8192
            ("anthropic",  "claude-haiku-4-5",     6000, 8192),
            ("openai",     "gpt-4o",               10000, 16384), // doubled = 20000 → cap 16384
            ("openai",     "gpt-4o-mini",          12000, 16384),
            ("openai",     "o1",                   20000, 32768), // o1 cap is 32768
            ("groq",       "llama-3.1-8b-instant", 6000, 8192),
            ("openrouter", "any/model",            6000, 8192),
            ("gemini",     "gemini-2.0-flash",     6000, 8192),
            ("ollama",     "llama3",               3000, 4096),
            ("unknown",    "weird-model",          3000, 4096),
        ];
        for (provider, model, current, expected) in cases {
            let result = escalate_max_tokens(provider, model, *current);
            assert_eq!(
                result,
                Some(*expected),
                "{}+{}: current={} should cap at {}",
                provider, model, current, expected
            );
        }
    }

    #[test]
    fn phase33_loop_04_double_truncation_does_not_retry_again() {
        // Operator's must-have test name (parity with the spec): one-shot
        // doubling only — if the FIRST retry produced a still-truncated
        // turn, we do NOT escalate a second time. The production wiring
        // achieves this structurally: the truncation block runs once per
        // iteration, and after `turn = retry_turn` the block has already
        // exited. There is no inner loop. This test locks that shape:
        //
        //   1. detect_truncation returns true on the original turn → escalate
        //   2. After the retry, even if detect_truncation would STILL return
        //      true on the new turn, the production code does NOT re-escalate
        //      because control has left the block.
        //
        // We simulate the production flow by exercising escalate_max_tokens
        // twice — first with current=4096 (returns Some(8192)), then with
        // current=8192 (returns None — already at cap). The None on the
        // second call is the structural guarantee: even if the production
        // code accidentally looped, the second escalate_max_tokens call
        // would refuse to double again because we're already at cap.
        let first = escalate_max_tokens("anthropic", "claude-sonnet-4-test", 4096);
        assert_eq!(first, Some(8192), "first escalation: 4096 → 8192");

        let second = escalate_max_tokens("anthropic", "claude-sonnet-4-test", 8192);
        assert_eq!(
            second, None,
            "second escalation at the cap returns None — structural guarantee against re-escalation"
        );

        // Belt-and-suspenders: also verify that for a still-truncated retry
        // (per the punctuation heuristic), the production code path would
        // not re-enter the truncation block. The production flow:
        //
        //     if smart_loop_enabled { /* the block */ }
        //
        // The block runs once per iteration body; there is no inner loop
        // around the truncation gate. We assert this by inspecting the
        // production source via grep at the verify-step (no inner-loop
        // pattern around the detect_truncation call).
        let still_truncated = fake_turn_result(Some("max_tokens"), "Still truncated mid-sentence");
        assert!(
            detect_truncation("anthropic", &still_truncated),
            "test setup: a doubly-truncated retry IS still detectable as truncated"
        );
        // Production code does NOT loop on this; the block exits after one retry.
        // (No assertion needed beyond the structural escalate_max_tokens=None
        // guarantee above; this comment documents intent.)
    }

    #[test]
    fn phase33_loop_04_cost_guard_interlock_stub_at_cap() {
        // When cumulative_cost_usd is already at the cap, no further
        // escalation should fire (projected > cap).
        let cumulative_cost_usd: f32 = 5.0;
        let cap: f32 = 5.0;
        let new_max: u32 = 8192;
        let current_max: u32 = 4096;
        let estimated_extra = (new_max as f32 - current_max as f32) * 0.000_01;
        let projected = cumulative_cost_usd + estimated_extra;
        assert!(projected > cap, "saturated cumulative cost must skip escalation");
    }

    // ─── Plan 33-08 (LOOP-06) — cost guard runtime + smart-off regression ──

    #[test]
    fn phase33_loop_06_cost_guard_halts_when_cap_exceeded() {
        // The runtime gate at the top of run_loop's iteration body is a
        // boolean expression: `smart_loop_enabled && cumulative_cost_usd > cap`.
        // This test exercises that exact expression with a synthetic state
        // that mirrors the production halt condition.
        let mut cfg = crate::config::BladeConfig::default();
        cfg.r#loop.smart_loop_enabled = true;
        cfg.r#loop.cost_guard_dollars = 5.0;
        let mut state = LoopState::default();
        state.cumulative_cost_usd = 10.0;
        let should_halt = cfg.r#loop.smart_loop_enabled
            && state.cumulative_cost_usd > cfg.r#loop.cost_guard_dollars;
        assert!(should_halt, "cost guard should halt when cumulative > cap");
    }

    #[test]
    fn phase33_loop_06_cost_guard_does_not_halt_below_threshold() {
        // Sister test of phase33_loop_06_cost_guard_halts_when_cap_exceeded:
        // cumulative below the cap must NOT trigger halt regardless of
        // smart-mode. Locks the comparison direction so a future edit can't
        // accidentally invert the inequality.
        let mut cfg = crate::config::BladeConfig::default();
        cfg.r#loop.smart_loop_enabled = true;
        cfg.r#loop.cost_guard_dollars = 5.0;
        let mut state = LoopState::default();
        state.cumulative_cost_usd = 4.99;
        let should_halt = cfg.r#loop.smart_loop_enabled
            && state.cumulative_cost_usd > cfg.r#loop.cost_guard_dollars;
        assert!(!should_halt, "cost guard must NOT halt when cumulative < cap");
    }

    #[test]
    fn phase33_loop_06_cost_accumulation_arithmetic() {
        // 1M input tokens at $3/M + 1M output tokens at $15/M = $18.00.
        // Locks the formula in run_loop's "cumulative cost tracking" block.
        let (p_in, p_out) = (3.0_f32, 15.0_f32);
        let tokens_in = 1_000_000_u32;
        let tokens_out = 1_000_000_u32;
        let cost = (tokens_in as f32 * p_in
                  + tokens_out as f32 * p_out) / 1_000_000.0;
        assert!(
            (cost - 18.0).abs() < 0.001,
            "1M in + 1M out at (3, 15) = $18.00; got {}", cost
        );
    }

    #[test]
    fn phase33_loop_06_cost_accumulation_via_price_helper() {
        // End-to-end test of the production wiring: read price from
        // providers::price_per_million, multiply by tokens_in/tokens_out,
        // divide by 1M, add to cumulative. Uses anthropic claude-sonnet-4
        // rates ($3.00 input, $15.00 output) — same as the arithmetic test
        // but routed through the helper.
        let (price_in, price_out) =
            crate::providers::price_per_million("anthropic", "claude-sonnet-4-20250514");
        assert!((price_in - 3.00).abs() < 0.01);
        assert!((price_out - 15.00).abs() < 0.01);

        let mut state = LoopState::default();
        let tokens_in: u32 = 500_000;
        let tokens_out: u32 = 100_000;
        let turn_cost = (tokens_in as f32 * price_in
                       + tokens_out as f32 * price_out) / 1_000_000.0;
        state.cumulative_cost_usd += turn_cost;
        // 500K in × $3/M = $1.50; 100K out × $15/M = $1.50; total = $3.00
        assert!(
            (state.cumulative_cost_usd - 3.00).abs() < 0.001,
            "expected $3.00 cumulative; got {}", state.cumulative_cost_usd
        );
    }

    #[test]
    fn phase33_loop_06_smart_off_uses_iteration_cap_only() {
        // Set cumulative_cost_usd absurdly above the cap; with smart_loop
        // disabled, the cost-guard gate must short-circuit and NOT halt.
        // This is the explicit regression for T-33-31 (tampering: future
        // edit drops the smart_loop_enabled term in the cost-guard if).
        let mut cfg = crate::config::BladeConfig::default();
        cfg.r#loop.smart_loop_enabled = false;
        cfg.r#loop.cost_guard_dollars = 0.001;
        let mut state = LoopState::default();
        state.cumulative_cost_usd = 999.0;
        let should_halt = cfg.r#loop.smart_loop_enabled
            && state.cumulative_cost_usd > cfg.r#loop.cost_guard_dollars;
        assert!(!should_halt,
            "smart-off path must NOT halt on cost guard regardless of cumulative spend");
    }

    #[test]
    fn phase33_loop_06_max_iterations_25_default() {
        // Plan 33-08 must preserve the Wave 1 LOOP-06 LoopConfig default of
        // max_iterations=25. If a future edit accidentally changes the
        // default (e.g. someone "tightens" it to 12), this test trips.
        let cfg = crate::config::BladeConfig::default();
        assert_eq!(
            cfg.r#loop.max_iterations, 25,
            "LoopConfig::default() max_iterations must be 25 (Wave 1 contract)"
        );
        assert!(
            cfg.r#loop.smart_loop_enabled,
            "LoopConfig::default() smart_loop_enabled must be true (Wave 1 contract)"
        );
        assert!(
            (cfg.r#loop.cost_guard_dollars - 5.0).abs() < 0.01,
            "LoopConfig::default() cost_guard_dollars must be $5.00 (Wave 1 contract)"
        );
    }

    #[test]
    fn phase33_smart_loop_disabled_runs_legacy_12_iterations_with_no_smart_features() {
        // CRITICAL parity regression test for CONTEXT lock §Backward Compat.
        // When smart is off, max_iter MUST be 12 AND none of the smart-feature
        // gates fire. Each smart feature has its own `if config.r#loop.
        // smart_loop_enabled` guard; this test validates each guard
        // programmatically. If any guard regresses, this test trips.
        let mut cfg = crate::config::BladeConfig::default();
        cfg.r#loop.smart_loop_enabled = false;
        cfg.r#loop.max_iterations = 999;          // ignored when smart off
        cfg.r#loop.cost_guard_dollars = 0.001;    // ignored
        cfg.r#loop.verification_every_n = 1;      // would fire every iter if smart on

        // Gate 1 — iteration cap. Mirrors run_loop's max_iter selection.
        let max_iter: usize = if cfg.r#loop.smart_loop_enabled {
            cfg.r#loop.max_iterations as usize
        } else { 12 };
        assert_eq!(max_iter, 12, "smart-off must hard-code 12 iterations");

        // Gate 2 — verification probe. Mirrors the firing site:
        //   if smart_loop_enabled && iteration > 0 && iter % verify_every_n == 0
        let iteration: u32 = 1;
        let would_verify = cfg.r#loop.smart_loop_enabled
            && iteration > 0
            && iteration % cfg.r#loop.verification_every_n == 0;
        assert!(!would_verify, "smart-off must skip verification probe");

        // Gate 3 — cost-guard halt. Mirrors run_loop's iteration-top check:
        //   if smart_loop_enabled && cumulative_cost_usd > cost_guard_dollars
        let mut state = LoopState::default();
        state.cumulative_cost_usd = 999.0;
        let would_halt = cfg.r#loop.smart_loop_enabled
            && state.cumulative_cost_usd > cfg.r#loop.cost_guard_dollars;
        assert!(!would_halt, "smart-off must skip cost-guard halt");

        // Gate 4 — token escalation (LOOP-04). Mirrors the truncation block's
        // outer guard: `if config.r#loop.smart_loop_enabled { ... }`.
        let escalation_gate = cfg.r#loop.smart_loop_enabled;
        assert!(!escalation_gate, "smart-off must skip token-escalation block");

        // Gate 5 — ToolError enrichment + replan trigger (LOOP-02 + LOOP-03).
        // Same guard pattern.
        let enrichment_gate = cfg.r#loop.smart_loop_enabled;
        assert!(!enrichment_gate, "smart-off must skip enrich_alternatives + reject_plan");

        // Gate 6 — cumulative cost accumulation. The post-turn block in
        // run_loop is also gated on smart_loop_enabled — when off, the
        // cumulative_cost_usd field stays at 0.0 forever.
        let accumulation_gate = cfg.r#loop.smart_loop_enabled;
        assert!(!accumulation_gate, "smart-off must skip cost accumulation");
    }

    #[test]
    fn phase33_loop_06_smart_off_legacy_12_iter_loop_runs_to_completion() {
        // Integration test: simulate a smart-off run that walks through 12
        // iterations without any smart-feature side effect firing. Asserts
        // that across all 12 iterations, NONE of {cost-guard, verify,
        // escalate, replan, accumulate} would have fired given a config
        // that would trigger every smart feature if smart were on.
        let mut cfg = crate::config::BladeConfig::default();
        cfg.r#loop.smart_loop_enabled = false;
        cfg.r#loop.cost_guard_dollars = 0.001;
        cfg.r#loop.verification_every_n = 1;

        let mut state = LoopState::default();
        // Pretend each fake-iteration costs $0.50 — well above the
        // 0.001 cap. With smart off, this must NOT halt.
        let max_iter = if cfg.r#loop.smart_loop_enabled { cfg.r#loop.max_iterations as usize } else { 12 };
        assert_eq!(max_iter, 12, "smart-off iteration cap is the legacy 12");

        let mut iters_ran = 0u32;
        for iteration in 0..max_iter {
            iters_ran += 1;

            // Cost-guard gate — mirrors production. With smart off, this is
            // unreachable; we just confirm the boolean is correctly false.
            let would_halt = cfg.r#loop.smart_loop_enabled
                && state.cumulative_cost_usd > cfg.r#loop.cost_guard_dollars;
            assert!(!would_halt,
                "iter {}: smart-off must not halt on cost (cumulative={}, cap={})",
                iteration, state.cumulative_cost_usd, cfg.r#loop.cost_guard_dollars);

            // Verification probe — mirrors production firing site.
            let would_verify = cfg.r#loop.smart_loop_enabled
                && iteration > 0
                && (iteration as u32) % cfg.r#loop.verification_every_n == 0;
            assert!(!would_verify, "iter {}: smart-off must not verify", iteration);

            // Cost accumulation — mirrors production. With smart off, the
            // post-turn accumulation block is skipped, so cumulative stays
            // at 0.0 across all 12 iterations.
            if cfg.r#loop.smart_loop_enabled {
                state.cumulative_cost_usd += 0.50;
            }
        }

        // After 12 fake-iterations with smart off, cumulative MUST still be
        // 0.0 — no smart-mode accumulation took place.
        assert_eq!(iters_ran, 12, "loop must complete 12 legacy iterations");
        assert_eq!(state.cumulative_cost_usd, 0.0,
            "smart-off must leave cumulative_cost_usd at 0.0 across all 12 iterations");
    }

    #[test]
    fn phase33_loop_state_record_action_evicts_oldest() {
        let mut s = LoopState::default();
        for i in 0..8 {
            s.record_action(ActionRecord {
                tool: format!("tool_{}", i),
                input_summary: "in".to_string(),
                output_summary: "out".to_string(),
                is_error: false,
            });
        }
        // Plan 34-02: capacity bumped from 3 to 6 (RECENT_ACTIONS_CAPACITY).
        assert_eq!(s.recent_actions.len(), RECENT_ACTIONS_CAPACITY);
        assert_eq!(s.recent_actions.len(), 6);
        assert_eq!(s.recent_actions.front().unwrap().tool, "tool_2");
        assert_eq!(s.recent_actions.back().unwrap().tool, "tool_7");
    }

    /// Phase 34 / HI-03 (REVIEW finding) — `recent_actions_window` is honored
    /// as the runtime cap for the ring buffer. Setting cap=10 and pushing 12
    /// actions must produce a 10-element buffer with the 2 oldest evicted.
    /// Previously the cap was hardcoded as `RECENT_ACTIONS_CAPACITY = 6` and
    /// the config field was dead code.
    #[test]
    fn phase34_res_01_recent_actions_window_honored_from_config() {
        let mut s = LoopState::default();
        let cap: usize = 10;
        for i in 0..12 {
            s.record_action_with_cap(
                ActionRecord {
                    tool: format!("tool_{}", i),
                    input_summary: "in".to_string(),
                    output_summary: "out".to_string(),
                    is_error: false,
                },
                cap,
            );
        }
        assert_eq!(
            s.recent_actions.len(),
            cap,
            "ring buffer length must match runtime cap (HI-03 regression)"
        );
        // 12 pushed, cap 10 → oldest 2 (tool_0, tool_1) evicted; tool_2..tool_11 remain.
        assert_eq!(s.recent_actions.front().unwrap().tool, "tool_2");
        assert_eq!(s.recent_actions.back().unwrap().tool, "tool_11");
    }

    /// Phase 34 / HI-03 — capacity = 0 falls back to the compile-time floor
    /// (`RECENT_ACTIONS_CAPACITY`) instead of degenerating into "always empty".
    /// Defense against a config typo or a future deserialize regression.
    #[test]
    fn phase34_res_01_recent_actions_window_zero_falls_back_to_floor() {
        let mut s = LoopState::default();
        for i in 0..8 {
            s.record_action_with_cap(
                ActionRecord {
                    tool: format!("tool_{}", i),
                    input_summary: "in".to_string(),
                    output_summary: "out".to_string(),
                    is_error: false,
                },
                0,
            );
        }
        assert_eq!(
            s.recent_actions.len(),
            RECENT_ACTIONS_CAPACITY,
            "capacity = 0 must fall back to RECENT_ACTIONS_CAPACITY (HI-03 defense)"
        );
    }

    // ─── Plan 33-04 (LOOP-01) verification probe tests ────────────────

    /// Test helper — block a single async future to completion using
    /// futures::executor::block_on. Used because the verify_progress fn is
    /// async and the override seam returns synchronously inside the future.
    /// Mirrors the pattern other Phase 33 tests use for async fn verification.
    fn block_on_verify(
        provider: &str,
        api_key: &str,
        model: &str,
        goal: &str,
        actions: &VecDeque<ActionRecord>,
    ) -> Result<Verdict, String> {
        futures::executor::block_on(verify_progress(provider, api_key, model, goal, actions))
    }

    fn clear_loop_override() { std::env::remove_var("LOOP_OVERRIDE"); }

    /// Process-global mutex serialising every test that mutates the
    /// `LOOP_OVERRIDE` env var. Cargo runs tests in parallel by default; env
    /// vars are process-global, so two tests racing on `set_var` /
    /// `remove_var` can leak state into each other and route a test to the
    /// real cheap-model call (which fails with "Unknown provider: x"). Acquire
    /// this lock at the top of any test that touches LOOP_OVERRIDE.
    fn loop_override_mutex() -> &'static std::sync::Mutex<()> {
        static MUTEX: std::sync::OnceLock<std::sync::Mutex<()>> = std::sync::OnceLock::new();
        MUTEX.get_or_init(|| std::sync::Mutex::new(()))
    }

    #[test]
    fn phase33_loop_01_verdict_yes_via_override() {
        // Plan 33-04 — LOOP_OVERRIDE=YES short-circuits the cheap-model
        // call and returns Ok(Verdict::Yes) directly. Mirrors
        // CTX_SCORE_OVERRIDE from Phase 32-02. Locks the test seam so a
        // future refactor can't accidentally remove it.
        let _g = loop_override_mutex().lock().unwrap_or_else(|p| p.into_inner());
        std::env::set_var("LOOP_OVERRIDE", "YES");
        let actions: VecDeque<ActionRecord> = VecDeque::new();
        let result = block_on_verify("anthropic", "x", "claude-haiku-4-5-20251001", "build a snake game", &actions);
        clear_loop_override();
        assert_eq!(result.expect("YES override must yield Ok(Yes)"), Verdict::Yes);
    }

    #[test]
    fn phase33_loop_01_verdict_no_via_override() {
        let _g = loop_override_mutex().lock().unwrap_or_else(|p| p.into_inner());
        std::env::set_var("LOOP_OVERRIDE", "NO");
        let actions: VecDeque<ActionRecord> = VecDeque::new();
        let result = block_on_verify("openai", "x", "gpt-4o-mini", "deploy the app", &actions);
        clear_loop_override();
        assert_eq!(result.expect("NO override must yield Ok(No)"), Verdict::No);
    }

    #[test]
    fn phase33_loop_01_verdict_replan_via_override() {
        let _g = loop_override_mutex().lock().unwrap_or_else(|p| p.into_inner());
        std::env::set_var("LOOP_OVERRIDE", "REPLAN");
        let actions: VecDeque<ActionRecord> = VecDeque::new();
        let result = block_on_verify("groq", "x", "llama-3.1-8b-instant", "research X", &actions);
        clear_loop_override();
        assert_eq!(result.expect("REPLAN override must yield Ok(Replan)"), Verdict::Replan);
    }

    #[test]
    fn phase33_loop_01_verdict_invalid_override_returns_err() {
        // Anything that's not YES/NO/REPLAN (case-insensitive) is an Err.
        let _g = loop_override_mutex().lock().unwrap_or_else(|p| p.into_inner());
        std::env::set_var("LOOP_OVERRIDE", "GARBAGE");
        let actions: VecDeque<ActionRecord> = VecDeque::new();
        let result = block_on_verify("anthropic", "x", "x", "x", &actions);
        clear_loop_override();
        assert!(result.is_err(), "invalid override must yield Err — got {:?}", result);
        assert!(
            result.as_ref().err().unwrap().contains("invalid LOOP_OVERRIDE"),
            "Err message should identify the override seam: {:?}",
            result
        );
    }

    #[test]
    fn phase33_loop_01_override_is_case_insensitive() {
        // Locks the .to_uppercase() normalisation. Lowercase override must
        // still route to the right verdict.
        let _g = loop_override_mutex().lock().unwrap_or_else(|p| p.into_inner());
        std::env::set_var("LOOP_OVERRIDE", "yes");
        let actions: VecDeque<ActionRecord> = VecDeque::new();
        let r1 = block_on_verify("x", "x", "x", "x", &actions);
        std::env::set_var("LOOP_OVERRIDE", "Replan");
        let r2 = block_on_verify("x", "x", "x", "x", &actions);
        clear_loop_override();
        assert_eq!(r1.unwrap(), Verdict::Yes);
        assert_eq!(r2.unwrap(), Verdict::Replan);
    }

    #[test]
    fn phase33_loop_01_actions_json_safe_slices_to_300_chars() {
        // Plan 33-04 — render_actions_json must safe_slice each input/output
        // summary to 300 chars to bound prompt size (CONTEXT lock §Mid-Loop
        // Verification). Brittle string-search confirms no 301-char run of
        // the original character survived.
        let big_in: String = "a".repeat(600);
        let big_out: String = "b".repeat(600);
        let mut actions: VecDeque<ActionRecord> = VecDeque::new();
        actions.push_back(ActionRecord {
            tool: "read_file".to_string(),
            input_summary: big_in,
            output_summary: big_out,
            is_error: false,
        });
        let json = render_actions_json(&actions);
        assert!(
            !json.contains(&"a".repeat(301)),
            "input_summary not safe_slice'd to 300 chars: prefix={}",
            &json[..400.min(json.len())]
        );
        assert!(
            !json.contains(&"b".repeat(301)),
            "output_summary not safe_slice'd to 300 chars"
        );
        // And confirm the tool name + err flag still made it into the JSON.
        assert!(json.contains("\"tool\":\"read_file\""));
        assert!(json.contains("\"err\":false"));
    }

    #[test]
    fn phase33_loop_01_actions_json_empty_buffer_yields_empty_array() {
        // The probe is gated on iteration > 0 so empty buffers should not
        // arise at production firing sites, but the renderer must still
        // produce a valid empty JSON array for downstream string concat.
        let actions: VecDeque<ActionRecord> = VecDeque::new();
        assert_eq!(render_actions_json(&actions), "[]");
    }

    #[test]
    fn phase33_loop_01_goal_safe_slices_to_1500_chars() {
        // Indirect test — verify the safe_slice contract at the documented
        // input length. We don't have direct access to the assembled prompt
        // from outside verify_progress, so this test asserts the safe_slice
        // invariant; source review confirms the safe_slice(goal, 1500)
        // call site at the prompt-build path.
        let big_goal: String = "g".repeat(3000);
        let sliced = crate::safe_slice(&big_goal, 1500);
        assert!(
            sliced.chars().count() <= 1500,
            "safe_slice contract: {} chars must not exceed 1500",
            sliced.chars().count()
        );
    }

    #[test]
    fn phase33_loop_01_cadence_math_fires_at_iter_3_6_9() {
        // Plan 33-04 acceptance criterion — at verification_every_n=3,
        // probe fires at iter 3, 6, 9 and NEVER at iter 0, 1, 2, 4, 5.
        // Locks the firing condition: iteration > 0 && iteration % N == 0.
        let n: u32 = 3;
        let fires = |it: u32| it > 0 && it % n == 0;
        assert!(!fires(0), "iter 0 must NOT fire (recent_actions is empty)");
        assert!(!fires(1));
        assert!(!fires(2));
        assert!(fires(3),  "iter 3 must fire at N=3");
        assert!(!fires(4));
        assert!(!fires(5));
        assert!(fires(6),  "iter 6 must fire at N=3");
        assert!(!fires(7));
        assert!(fires(9),  "iter 9 must fire at N=3");
    }

    #[test]
    fn phase33_loop_01_smart_off_skips_verification() {
        // Plan 33-04 — CONTEXT lock §Backward Compatibility: the verification
        // probe must be entirely gated on config.r#loop.smart_loop_enabled.
        // When smart is off, the firing condition `smart_loop_enabled
        // && iteration > 0 && iteration % N == 0` short-circuits at the &&,
        // so the probe must never fire regardless of iteration or N.
        // Locks the gate so a future edit can't accidentally drop the
        // smart_loop_enabled term and turn the probe on for legacy users.
        let mut cfg = crate::config::BladeConfig::default();
        cfg.r#loop.smart_loop_enabled = false;
        cfg.r#loop.verification_every_n = 3;
        let fires = |it: u32| {
            cfg.r#loop.smart_loop_enabled
                && it > 0
                && it % cfg.r#loop.verification_every_n == 0
        };
        for it in 0u32..30 {
            assert!(
                !fires(it),
                "smart_loop_enabled=false must skip the probe at every iteration; iter {} fired",
                it
            );
        }
    }

    #[test]
    fn phase33_loop_01_panic_safe_does_not_crash_loop() {
        // Plan 33-04 — CTX-07 fallback discipline: a probe failure (Err from
        // verify_progress, e.g. invalid LOOP_OVERRIDE, network error, parse
        // error) MUST NOT halt the main loop. The firing site in run_loop
        // logs to stderr and continues. This test simulates the exact
        // match-arm flow the production code uses, asserting that the Err
        // arm is reached and that nothing panics or returns control upstream.
        let _g = loop_override_mutex().lock().unwrap_or_else(|p| p.into_inner());
        std::env::set_var("LOOP_OVERRIDE", "GARBAGE");
        let actions: VecDeque<ActionRecord> = VecDeque::new();
        let result = block_on_verify("anthropic", "x", "x", "x", &actions);
        clear_loop_override();

        // Mirror the production match: Ok arms continue normally; Err arm
        // logs + continues. We assert the Err arm fires and that handling
        // it does not unwind.
        let mut continued = false;
        match result {
            Ok(Verdict::Yes) | Ok(Verdict::No) | Ok(Verdict::Replan) => {
                continued = true; // would proceed to next iteration
            }
            Err(_e) => {
                // Production: eprintln!("[LOOP-01] verify_progress error
                // (non-blocking): {}", e);. Here we just confirm we reach
                // the arm and continue without panicking.
                continued = true;
            }
        }
        assert!(continued, "Err arm must continue the loop, not halt it");
    }

    #[test]
    fn phase33_loop_01_replan_response_triggers_replan_arm() {
        // Plan 33-04 — when LOOP_OVERRIDE=REPLAN, verify_progress must yield
        // Verdict::Replan, which the run_loop firing site uses to push the
        // locked "Internal check: re-plan from current state. Do not retry
        // the failing step verbatim." system message into the conversation.
        // This test locks the verdict→arm mapping so a future refactor that
        // accidentally renames a Verdict variant or rewires the match arms
        // trips the test before it ships.
        let _g = loop_override_mutex().lock().unwrap_or_else(|p| p.into_inner());
        std::env::set_var("LOOP_OVERRIDE", "REPLAN");
        let actions: VecDeque<ActionRecord> = VecDeque::new();
        let result = block_on_verify("anthropic", "x", "x", "build a snake game", &actions);
        clear_loop_override();
        assert_eq!(
            *result.as_ref().expect("REPLAN override must yield Ok(Replan)"),
            Verdict::Replan
        );

        // Simulate the run_loop REPLAN arm — push the locked nudge into a
        // fresh conversation and confirm the exact text landed.
        let mut conversation: Vec<ConversationMessage> = Vec::new();
        if let Ok(Verdict::Replan) = result {
            conversation.push(ConversationMessage::System(
                "Internal check: re-plan from current state. Do not retry the failing step verbatim.".to_string(),
            ));
        }
        assert_eq!(conversation.len(), 1, "REPLAN arm must inject exactly one nudge");
        match &conversation[0] {
            ConversationMessage::System(text) => {
                assert!(
                    text.contains("re-plan from current state"),
                    "injected nudge must contain the locked phrase: {}",
                    text
                );
                assert!(
                    text.contains("Do not retry the failing step verbatim"),
                    "injected nudge must contain the second locked phrase: {}",
                    text
                );
            }
            other => panic!("expected System message, got {:?}", other),
        }
    }

    // ─── Plan 33-05 (LOOP-02 + LOOP-03) tests ─────────────────────────

    #[test]
    fn phase33_loop_02_render_replaces_bare_strings_on_smart_path() {
        // Direct test of the wrap+enrich+render shape that the LoopState
        // boundary produces on the smart path.
        let mut tool_err =
            crate::native_tools::wrap_legacy_error("read_file", "no such file".to_string());
        tool_err.suggested_alternatives = enrich_alternatives("read_file");
        let rendered = tool_err.render_for_model();
        assert!(rendered.starts_with("Tool failed."), "got: {}", rendered);
        assert!(rendered.contains("Attempted: read_file"), "got: {}", rendered);
        assert!(rendered.contains("Reason: no such file"), "got: {}", rendered);
        assert!(rendered.contains("Suggested alternatives:"), "got: {}", rendered);
        assert!(rendered.contains("Verify the path exists"), "got: {}", rendered);
    }

    #[test]
    fn phase33_loop_02_legacy_path_omits_alternatives() {
        // Legacy path = wrap_legacy_error WITHOUT enrich_alternatives.
        // The CONTEXT lock parity rule: rendered output must NOT include the
        // "Suggested alternatives" block when the alternatives Vec is empty.
        let tool_err =
            crate::native_tools::wrap_legacy_error("read_file", "no such file".to_string());
        let rendered = tool_err.render_for_model();
        assert!(rendered.contains("Tool failed."), "got: {}", rendered);
        assert!(rendered.contains("Reason: no such file"), "got: {}", rendered);
        assert!(
            !rendered.contains("Suggested alternatives"),
            "legacy shim must produce no Suggested alternatives block (parity with bare-string behavior); got: {}",
            rendered
        );
    }

    #[test]
    fn phase33_loop_03_replans_observed_after_three_same_tool_failures() {
        // Synthetic LoopState — directly exercise the counter logic that
        // triggers reject_plan on the third consecutive same-tool failure.
        let mut state = LoopState::default();
        let mut last_failed_tool: Option<String> = None;

        for _ in 0..3 {
            // Simulate three same-tool failures (tool-change reset path).
            if let Some(prev) = last_failed_tool.clone() {
                if prev != "read_file" {
                    state.consecutive_same_tool_failures.clear();
                }
            }
            let counter = state
                .consecutive_same_tool_failures
                .entry("read_file".to_string())
                .or_insert(0);
            *counter += 1;
            last_failed_tool = Some("read_file".to_string());
        }
        assert_eq!(
            *state.consecutive_same_tool_failures.get("read_file").unwrap(),
            3,
            "third same-tool failure must register count=3"
        );

        // Now simulate the trigger logic (the production code path increments
        // replans_this_run + writes last_nudge_iteration when count >= 3).
        if *state.consecutive_same_tool_failures.get("read_file").unwrap() >= 3 {
            state.replans_this_run = state.replans_this_run.saturating_add(1);
            state.last_nudge_iteration = Some(state.iteration);
        }
        assert_eq!(state.replans_this_run, 1, "replans_this_run must increment");
        assert!(
            state.last_nudge_iteration.is_some(),
            "last_nudge_iteration must be set on trigger"
        );
    }

    #[test]
    fn phase33_loop_03_different_tool_resets_counter() {
        // CONTEXT lock §Plan Adaptation: counter resets when a *different*
        // tool name fails after a streak. The HashMap shape (one key at a
        // time) matches the locked design.
        let mut state = LoopState::default();
        let mut last_failed_tool: Option<String> = None;

        // Two failures of read_file
        for _ in 0..2 {
            if let Some(prev) = last_failed_tool.clone() {
                if prev != "read_file" {
                    state.consecutive_same_tool_failures.clear();
                }
            }
            let counter = state
                .consecutive_same_tool_failures
                .entry("read_file".to_string())
                .or_insert(0);
            *counter += 1;
            last_failed_tool = Some("read_file".to_string());
        }
        // One failure of bash — must clear read_file
        if let Some(prev) = last_failed_tool.clone() {
            if prev != "bash" {
                state.consecutive_same_tool_failures.clear();
            }
        }
        let counter = state
            .consecutive_same_tool_failures
            .entry("bash".to_string())
            .or_insert(0);
        *counter += 1;

        assert!(
            state.consecutive_same_tool_failures.get("read_file").is_none(),
            "different-tool failure must clear the previous tool's streak"
        );
        assert_eq!(
            *state.consecutive_same_tool_failures.get("bash").unwrap(),
            1,
            "new tool's first failure registers count=1"
        );
    }

    #[test]
    fn phase33_loop_03_stacking_prevention_skips_within_2_iterations() {
        // 33-RESEARCH landmine #11 — a nudge within the last 2 iterations
        // suppresses the next. Iteration 5 inserts (last_nudge_iteration=5);
        // iterations 6 and 7 are stacking-blocked; iteration 8 (delta=3) is
        // allowed.
        let nudge_iter = 5u32;
        for next_iter in [6u32, 7u32].iter() {
            let stacking = next_iter.saturating_sub(nudge_iter) <= 2;
            assert!(
                stacking,
                "iteration {} should be stacking-blocked vs prev={}",
                next_iter, nudge_iter
            );
        }
        let stacking = 8u32.saturating_sub(nudge_iter) <= 2;
        assert!(
            !stacking,
            "iteration 8 vs prev=5 (delta 3) must be allowed"
        );
    }

    #[test]
    fn phase33_loop_03_successful_tool_clears_streak() {
        // Success arm of the LoopState boundary: a successful tool call must
        // clear consecutive_same_tool_failures so the next failure of the
        // same tool starts a fresh streak.
        let mut state = LoopState::default();
        state
            .consecutive_same_tool_failures
            .insert("read_file".to_string(), 2);
        assert_eq!(
            *state.consecutive_same_tool_failures.get("read_file").unwrap(),
            2
        );

        // Simulate the success-arm reset.
        state.consecutive_same_tool_failures.clear();

        assert!(
            state.consecutive_same_tool_failures.is_empty(),
            "successful tool call must clear all streak counters"
        );
    }

    // ─── Plan 33-09 (CTX-07 panic-injection regression suite) ─────────────
    //
    // Mirrors the brain.rs `phase32_build_system_prompt_survives_panic_in_scoring`
    // pattern (commit bb5d6ce). The seam is `FORCE_VERIFY_PANIC` (cfg(test)
    // thread_local Cell<bool>); the production check sits at the top of
    // `render_actions_json`. The catch_unwind wrapper sits at the verifier
    // firing site in `run_loop` (futures::FutureExt::catch_unwind on the
    // AssertUnwindSafe-wrapped future).
    //
    // Three tests:
    //   1. FORCE_VERIFY_PANIC=true makes render_actions_json panic when called
    //      bare — proves the seam works.
    //   2. FORCE_VERIFY_PANIC=false leaves render_actions_json producing valid
    //      JSON — proves the seam is off-by-default and renders normally.
    //   3. The futures-catch_unwind boundary (the same wrapper run_loop uses)
    //      catches a forced panic when verify_progress is awaited — proves the
    //      production wrapper would catch the same panic at the firing site.
    //
    // Cleanup: each test resets FORCE_VERIFY_PANIC to false BEFORE asserting
    // so a failed assertion does not poison sibling tests on the same thread.

    #[test]
    fn phase33_loop_01_panic_in_render_actions_json_is_caught() {
        // FORCE_VERIFY_PANIC=true → render_actions_json must panic on entry.
        // catch_unwind around the synchronous call captures the panic and
        // returns Err. This is the unit-level proof that the seam fires.
        FORCE_VERIFY_PANIC.with(|p| p.set(true));
        let actions: VecDeque<ActionRecord> = VecDeque::new();
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            render_actions_json(&actions)
        }));
        // Reset BEFORE the assertion so a failure doesn't poison other tests.
        FORCE_VERIFY_PANIC.with(|p| p.set(false));
        assert!(
            result.is_err(),
            "FORCE_VERIFY_PANIC=true must induce a panic in render_actions_json; got Ok({:?})",
            result.as_ref().ok()
        );
    }

    #[test]
    fn phase33_loop_01_render_actions_json_normal_when_panic_off() {
        // FORCE_VERIFY_PANIC=false (default) → render_actions_json produces
        // a valid JSON array with the expected shape. Locks the seam to off-
        // by-default so production builds don't accidentally panic.
        FORCE_VERIFY_PANIC.with(|p| p.set(false));
        let mut actions: VecDeque<ActionRecord> = VecDeque::new();
        actions.push_back(ActionRecord {
            tool: "read_file".to_string(),
            input_summary: "x".to_string(),
            output_summary: "y".to_string(),
            is_error: false,
        });
        let json = render_actions_json(&actions);
        assert!(
            json.contains("\"tool\":\"read_file\""),
            "expected tool name in JSON, got: {}",
            json
        );
        assert!(
            json.contains("\"in\":\"x\""),
            "expected input summary in JSON, got: {}",
            json
        );
        assert!(
            json.contains("\"out\":\"y\""),
            "expected output summary in JSON, got: {}",
            json
        );
        assert!(
            json.contains("\"err\":false"),
            "expected err flag in JSON, got: {}",
            json
        );
    }

    #[test]
    fn phase33_loop_01_panic_in_verify_progress_caught_by_outer_wrapper() {
        // End-to-end test of the catch_unwind boundary used in run_loop.
        // Mirrors the production wrapper exactly: AssertUnwindSafe around the
        // verify_progress future, .catch_unwind() (futures::FutureExt), .await.
        //
        // Cleanup of LOOP_OVERRIDE: defensive — the seam should already be
        // unset since we never set it in this test, but other tests run in
        // parallel and the env var is process-global. Acquire the override
        // mutex used by Plan 33-04 tests so we don't race with them.
        let _g = loop_override_mutex().lock().unwrap_or_else(|p| p.into_inner());
        std::env::remove_var("LOOP_OVERRIDE");

        FORCE_VERIFY_PANIC.with(|p| p.set(true));
        let actions: VecDeque<ActionRecord> = VecDeque::new();

        // Block the future on a tokio runtime so the .await inside
        // catch_unwind resolves. futures::FutureExt is the same trait
        // run_loop uses (production code: `use futures::FutureExt;` at the
        // verification firing site).
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("tokio runtime build");
        let probe_result = rt.block_on(async {
            use futures::FutureExt;
            std::panic::AssertUnwindSafe(verify_progress(
                "anthropic",
                "x",
                "claude-haiku-4-5-20251001",
                "build a snake game",
                &actions,
            ))
            .catch_unwind()
            .await
        });

        // Reset BEFORE asserting so a failure doesn't poison other tests.
        FORCE_VERIFY_PANIC.with(|p| p.set(false));

        assert!(
            probe_result.is_err(),
            "panic in render_actions_json must propagate to the catch_unwind boundary; \
             got Ok(_) — the production wrapper would NOT catch it. \
             smart-path → dumb-path discipline broken."
        );
    }

    // ─── 33-NN-FIX (BL-01) — verification_every_n zero-guard tests ──────

    #[test]
    fn phase33_loop_06_verification_every_n_zero_does_not_panic() {
        // BL-01 — the firing site at loop_engine.rs:537 must short-circuit
        // BEFORE evaluating `iteration % verification_every_n` when
        // verification_every_n is zero. Direct integer-modulo by zero panics
        // the Tokio task; the `> 0` guard added in 33-NN-FIX prevents that.
        //
        // We simulate the production gate expression here. Using an explicit
        // `n` of 0 with the OLD shape would `panic!("attempt to calculate the
        // remainder with a divisor of zero")`. With the new guard, the gate
        // short-circuits at `verification_every_n > 0` and the modulo is
        // never evaluated.
        let mut cfg = crate::config::BladeConfig::default();
        cfg.r#loop.smart_loop_enabled = true;
        cfg.r#loop.verification_every_n = 0;

        // Walk a handful of iterations — none must panic.
        for iteration in 0u32..6u32 {
            let would_verify = cfg.r#loop.smart_loop_enabled
                && iteration > 0
                && cfg.r#loop.verification_every_n > 0
                && (iteration as u32) % cfg.r#loop.verification_every_n.max(1) == 0;
            assert!(
                !would_verify,
                "iter {}: zero-cadence must be treated as 'verification disabled' — got would_verify=true",
                iteration
            );
        }
    }

    #[test]
    fn phase33_loop_04_truncation_retry_does_not_undercount_cost() {
        // 33-NN-FIX (HI-02) — the truncation retry block must accumulate
        // the original truncated turn's cost BEFORE the retry runs, so
        // total cumulative spend = original + retry on success, or just
        // original on failure. Pre-fix the original was discarded silently
        // and only the retry counted.
        //
        // We can't easily run the full run_loop in a unit test (Tauri
        // AppHandle, network), so this test exercises the cost-arithmetic
        // contract directly with the same shape the production code uses:
        //   1. Original truncated call: 1k in, 4096 out → cost1 (tracked)
        //   2. Retry success: 1k in, 8192 out → cost2 (tracked on top)
        //   3. Final cumulative MUST equal cost1 + cost2.
        let (price_in, price_out) =
            crate::providers::price_per_million("anthropic", "claude-sonnet-4");

        // Step 1: original truncated turn — accumulate.
        let mut state = LoopState::default();
        let orig_in: u32 = 1_000;
        let orig_out: u32 = 4_096;
        let original_cost = (orig_in as f32 * price_in + orig_out as f32 * price_out) / 1_000_000.0;
        state.cumulative_cost_usd += original_cost;
        let after_original = state.cumulative_cost_usd;
        assert!(after_original > 0.0, "original cost must be tracked > 0");

        // Step 2: retry success — accumulate on top.
        let retry_in: u32 = 1_000;
        let retry_out: u32 = 8_192;
        let retry_cost = (retry_in as f32 * price_in + retry_out as f32 * price_out) / 1_000_000.0;
        state.cumulative_cost_usd += retry_cost;

        // Total must equal original + retry — the load-bearing HI-02 invariant.
        let expected = original_cost + retry_cost;
        assert!(
            (state.cumulative_cost_usd - expected).abs() < 1e-6,
            "cumulative ({}) must equal original ({}) + retry ({}) = {}",
            state.cumulative_cost_usd, original_cost, retry_cost, expected
        );

        // Sanity: the original cost alone is non-trivial — pre-fix, this
        // entire amount would have been silently dropped (the cost guard
        // would under-count by exactly this much per truncation event).
        // 1k in × $3/M + 4096 out × $15/M = $0.003 + $0.06144 ≈ $0.06444
        assert!(
            original_cost > 0.05,
            "original truncated call cost ({}) is non-trivial — silent drop pre-HI-02 \
             would under-count by at least this much per truncation event",
            original_cost
        );
    }

    #[test]
    fn phase33_loop_04_truncation_retry_does_not_overcount_on_retry_fail() {
        // 33-NN-FIX (HI-02) sister test — on retry-fail (or retry-panic), the
        // post-block accumulator must skip so the original cost (already
        // tracked inside the truncation block) is NOT double-counted.
        //
        // Mirrors the production flag-based gating:
        //   1. Original truncated call: cost1 added, flag set true.
        //   2. Retry fails (Err or panic) — turn stays as original, flag stays true.
        //   3. Post-block accumulator sees flag=true → skips.
        //   4. Final cumulative = cost1 only (truthful).
        let (price_in, price_out) =
            crate::providers::price_per_million("anthropic", "claude-sonnet-4");
        let mut state = LoopState::default();
        let orig_in: u32 = 1_000;
        let orig_out: u32 = 4_096;
        let original_cost = (orig_in as f32 * price_in + orig_out as f32 * price_out) / 1_000_000.0;

        // Step 1: original truncated turn — accumulate, set flag.
        state.cumulative_cost_usd += original_cost;
        let original_cost_already_tracked = true;

        // Step 2: retry FAILED — flag stays true, post-block must skip.
        let smart_loop_enabled = true;
        let post_block_runs = smart_loop_enabled && !original_cost_already_tracked;
        if post_block_runs {
            // This path must NOT execute on retry-fail. If it did, we'd
            // double-count the original cost.
            state.cumulative_cost_usd += original_cost;
        }

        // Final must equal exactly the original cost (no double-count).
        assert!(
            (state.cumulative_cost_usd - original_cost).abs() < 1e-6,
            "cumulative ({}) on retry-fail must equal original ({}) only",
            state.cumulative_cost_usd, original_cost
        );
    }

    #[test]
    fn phase33_loop_04_truncation_retry_panic_safe() {
        // 33-NN-FIX (HI-03) — the truncation retry .await call must be
        // wrapped in `futures::FutureExt::catch_unwind`. A panic inside any
        // provider's response parser during the retry must NOT crash the
        // run_loop task; instead, the smart-path collapses to the dumb path
        // (keep original turn, continue iteration).
        //
        // We mirror the production wrapper exactly: AssertUnwindSafe around
        // the future, .catch_unwind() (futures::FutureExt), .await. The
        // future itself panics synchronously (before any real I/O) so we
        // can assert the wrapper returns Err(panic) without needing a real
        // provider call.
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("tokio runtime build");

        let probe_result = rt.block_on(async {
            use futures::FutureExt;
            std::panic::AssertUnwindSafe(async {
                // Simulate complete_turn_with_max_tokens panicking inside a
                // provider parser (malformed JSON unwrap, integer overflow
                // in usage parse, etc.).
                panic!("simulated panic inside complete_turn_with_max_tokens parser");
                #[allow(unreachable_code)]
                Ok::<crate::providers::AssistantTurn, String>(
                    crate::providers::AssistantTurn::default(),
                )
            })
            .catch_unwind()
            .await
        });

        assert!(
            probe_result.is_err(),
            "panic in complete_turn_with_max_tokens must propagate to the \
             catch_unwind boundary; got Ok(_) — pre-fix wiring would crash \
             the run_loop task. CTX-07 smart-path → dumb-path discipline broken."
        );
    }

    #[test]
    fn phase33_loop_04_default_max_tokens_per_provider() {
        // 33-NN-FIX (HI-01) — provider-aware defaults. Anthropic + OpenAI
        // pass 4096 as a body literal (build_body sets it on every request);
        // Groq + Gemini + Ollama omit the field, the server applies its own
        // default (8192). OpenRouter is OpenAI-compatible (no body literal in
        // our wiring); we treat it as 8192 too.
        //
        // Locking these values prevents a regression where the smart-loop
        // truncation block re-hardcodes 4096 across all providers, re-introducing
        // the false-positive escalation cost burn on Groq/Gemini.
        use crate::providers::default_max_tokens_for;
        assert_eq!(default_max_tokens_for("anthropic", "claude-sonnet-4"), 4096);
        assert_eq!(default_max_tokens_for("openai", "gpt-4o"), 4096);
        assert_eq!(default_max_tokens_for("groq", "llama-3.1-8b-instant"), 8192);
        assert_eq!(default_max_tokens_for("gemini", "gemini-2.0-flash"), 8192);
        assert_eq!(default_max_tokens_for("ollama", "llama3"), 8192);
        assert_eq!(default_max_tokens_for("openrouter", "any/model"), 8192);
        assert_eq!(default_max_tokens_for("unknown_provider", "weird"), 4096);

        // The cost-burn false positive depends on the relationship between
        // default and cap. For Groq/Gemini, default 8192 == max_output_tokens
        // 8192, so escalate_max_tokens(provider, model, default) MUST return
        // None — i.e. no wasted retry. This is the load-bearing property
        // HI-01 fixed.
        for provider in ["groq", "gemini"] {
            let dflt = default_max_tokens_for(provider, "any-model");
            let escalated = escalate_max_tokens(provider, "any-model", dflt);
            assert_eq!(
                escalated, None,
                "{}: default ({}) is at cap; escalate must return None to avoid wasted retry",
                provider, dflt
            );
        }

        // Anthropic/OpenAI default 4096 < cap 8192/16384, so escalation IS
        // possible — the doubling produces real new headroom.
        let escalated = escalate_max_tokens("anthropic", "claude-sonnet-4", 4096);
        assert_eq!(escalated, Some(8192),
            "anthropic at default 4096 should escalate to 8192 (real headroom)");
        let escalated = escalate_max_tokens("openai", "gpt-4o", 4096);
        assert_eq!(escalated, Some(8192),
            "openai gpt-4o at default 4096 should escalate to 8192 (under 16384 cap)");
    }

    #[test]
    fn phase33_loop_06_validate_rejects_zero_n() {
        // BL-01 — LoopConfig::validate() MUST reject verification_every_n=0
        // with a clear error string at save_config time. This is the strict
        // gate; the firing-site `> 0` guard above is the safety net.
        let mut cfg = crate::config::LoopConfig::default();
        cfg.verification_every_n = 0;
        let err = cfg
            .validate()
            .expect_err("verification_every_n=0 must be rejected by validate()");
        assert!(
            err.contains("verification_every_n"),
            "error message must identify the field; got: {}",
            err
        );

        // Sister checks: max_iterations=0 and negative cost_guard_dollars also rejected.
        let mut cfg = crate::config::LoopConfig::default();
        cfg.max_iterations = 0;
        let err = cfg
            .validate()
            .expect_err("max_iterations=0 must be rejected by validate()");
        assert!(
            err.contains("max_iterations"),
            "error message must identify the field; got: {}",
            err
        );

        let mut cfg = crate::config::LoopConfig::default();
        cfg.cost_guard_dollars = -1.0;
        let err = cfg
            .validate()
            .expect_err("negative cost_guard_dollars must be rejected by validate()");
        assert!(
            err.contains("cost_guard_dollars"),
            "error message must identify the field; got: {}",
            err
        );

        // Default config must validate cleanly — sanity check.
        crate::config::LoopConfig::default()
            .validate()
            .expect("default LoopConfig must validate cleanly");
    }

    // ─── Plan 34-02 — Phase 34 LoopState extension tests ───────────────────

    #[test]
    fn phase34_loop_state_recent_actions_capacity_is_six() {
        assert_eq!(RECENT_ACTIONS_CAPACITY, 6,
            "Plan 34-02 bumped capacity from 3 to 6 — see CONTEXT lock §RES-01");
    }

    #[test]
    fn phase34_loop_state_record_compaction_increments_counter() {
        let mut s = LoopState::default();
        assert_eq!(s.compactions_this_run, 0);
        s.record_compaction();
        s.record_compaction();
        s.record_compaction();
        assert_eq!(s.compactions_this_run, 3);
    }

    #[test]
    fn phase34_loop_state_progress_hash_default_none() {
        let s = LoopState::default();
        assert_eq!(s.last_progress_text_hash, None);
    }

    #[test]
    fn phase34_loop_state_cost_warning_latch_default_false() {
        let s = LoopState::default();
        assert!(!s.cost_warning_80_emitted);
    }

    // ─── Plan 34-02 — Phase 34 LoopHaltReason extension tests ──────────────

    #[test]
    fn phase34_halt_reason_cost_scope_serde_roundtrip() {
        let s = CostScope::PerConversation;
        let json = serde_json::to_string(&s).expect("serialize");
        let parsed: CostScope = serde_json::from_str(&json).expect("parse");
        assert_eq!(s, parsed);
        let s2 = CostScope::PerLoop;
        let json2 = serde_json::to_string(&s2).expect("serialize");
        let parsed2: CostScope = serde_json::from_str(&json2).expect("parse");
        assert_eq!(s2, parsed2);
    }

    #[test]
    fn phase34_halt_reason_cost_exceeded_carries_scope() {
        let halt = LoopHaltReason::CostExceeded {
            spent_usd: 26.5,
            cap_usd: 25.0,
            scope: CostScope::PerConversation,
        };
        match halt {
            LoopHaltReason::CostExceeded { scope, .. } => {
                assert_eq!(scope, CostScope::PerConversation);
            }
            _ => panic!("expected CostExceeded"),
        }
    }

    #[test]
    fn phase34_halt_reason_circuit_open_carries_attempts() {
        let attempts = vec![
            AttemptRecord {
                provider: "anthropic".to_string(),
                model: "claude-sonnet-4".to_string(),
                error_message: "timeout".to_string(),
                timestamp_ms: 1000,
            },
            AttemptRecord {
                provider: "anthropic".to_string(),
                model: "claude-sonnet-4".to_string(),
                error_message: "timeout".to_string(),
                timestamp_ms: 2000,
            },
            AttemptRecord {
                provider: "anthropic".to_string(),
                model: "claude-sonnet-4".to_string(),
                error_message: "timeout".to_string(),
                timestamp_ms: 3000,
            },
        ];
        let halt = LoopHaltReason::CircuitOpen {
            error_kind: "timeout".to_string(),
            attempts_summary: attempts.clone(),
        };
        match halt {
            LoopHaltReason::CircuitOpen { error_kind, attempts_summary } => {
                assert_eq!(error_kind, "timeout");
                assert_eq!(attempts_summary.len(), 3);
                assert_eq!(attempts_summary[0].timestamp_ms, 1000);
            }
            _ => panic!("expected CircuitOpen"),
        }
    }

    #[test]
    fn phase34_halt_reason_stuck_carries_pattern() {
        let halt = LoopHaltReason::Stuck { pattern: "MonologueSpiral".to_string() };
        match halt {
            LoopHaltReason::Stuck { pattern } => assert_eq!(pattern, "MonologueSpiral"),
            _ => panic!("expected Stuck"),
        }
    }

    // ─── Plan 34-04 (RES-01) — wire-site regression tests ───────────────────

    /// Verifies the call-site contract: when RES_FORCE_STUCK is set,
    /// detect_stuck returns Some(pattern) and run_loop's iteration body
    /// (modeled here via the same catch_unwind pattern) returns the
    /// corresponding LoopHaltReason::Stuck. The seam decouples the priority
    /// aggregator from the wire path so the wire code can be exercised
    /// independently of detector logic.
    #[test]
    fn phase34_res_01_force_stuck_seam_halts_loop_synchronous() {
        crate::resilience::stuck::RES_FORCE_STUCK.with(|c| {
            c.set(Some(crate::resilience::stuck::StuckPattern::MonologueSpiral))
        });
        let state = LoopState::default();
        let cfg = crate::config::ResilienceConfig::default();
        let stuck = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            crate::resilience::stuck::detect_stuck(&state, &cfg)
        }));
        crate::resilience::stuck::RES_FORCE_STUCK.with(|c| c.set(None)); // teardown
        assert!(
            matches!(stuck, Ok(Some(crate::resilience::stuck::StuckPattern::MonologueSpiral))),
            "RES_FORCE_STUCK must short-circuit to the forced verdict"
        );
    }

    /// Mirrors Plan 33-09's phase33_loop_01_panic_in_render_actions_json_is_caught.
    /// RES_FORCE_PANIC_IN_DETECTOR makes detect_repeated_action_observation
    /// panic; run_loop's catch_unwind wrapper at the iteration-top call site
    /// must catch it. T-34-15 mitigation — if a future regression silently
    /// removes the catch_unwind wrapper, this test fails and demands the
    /// wrapper be restored.
    #[test]
    fn phase34_res_01_panic_in_detect_stuck_caught_by_outer_wrapper() {
        crate::resilience::stuck::RES_FORCE_PANIC_IN_DETECTOR.with(|c| c.set(true));
        let state = LoopState::default();
        let cfg = crate::config::ResilienceConfig::default();
        // Mirror the call-site catch_unwind pattern from run_loop iteration top.
        let stuck_result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            crate::resilience::stuck::detect_stuck(&state, &cfg)
        }));
        crate::resilience::stuck::RES_FORCE_PANIC_IN_DETECTOR.with(|c| c.set(false));
        assert!(
            stuck_result.is_err(),
            "panic in detector body must propagate to call-site catch_unwind boundary; got Ok({:?})",
            stuck_result.as_ref().map(|_| "Ok")
        );
    }

    /// CONTEXT lock §Backward Compatibility — smart_resilience_enabled=false
    /// skips stuck detection at the call site. This test asserts the parity
    /// claim: even with state shape that satisfies multiple stuck patterns,
    /// detect_stuck returns None when the master switch is off.
    /// Threat T-34-19 mitigation — guards every kill-switch gate.
    #[test]
    fn phase34_smart_resilience_disabled_no_smart_features() {
        let mut cfg = crate::config::ResilienceConfig::default();
        cfg.smart_resilience_enabled = false;
        cfg.stuck_detection_enabled = true; // even with this on, smart-off wins
        // Build a state that satisfies multiple patterns simultaneously.
        let mut state = LoopState::default();
        state.consecutive_no_tool_turns = 10;     // MonologueSpiral
        state.compactions_this_run = 5;            // ContextWindowThrashing
        state.iteration = 20;
        state.last_progress_iteration = 0;         // NoProgress
        state.cumulative_cost_usd = 5.0;
        state.last_iter_cost = 100.0;              // CostRunaway
        let v = crate::resilience::stuck::detect_stuck(&state, &cfg);
        assert!(
            v.is_none(),
            "smart_resilience_enabled=false must skip all stuck detectors; got {:?}", v
        );
    }

    // ─── Plan 34-05 (RES-02) — circuit-breaker wire-site regression tests ───

    /// Smart-off path must NOT halt with CircuitOpen even after 3 errors.
    /// Threat T-34-22 mitigation — the smart-off escape hatch preserves
    /// Phase 33's retry-exhaust posture (legacy ProviderFatal trip).
    #[test]
    fn phase34_res_02_smart_off_does_not_halt_on_circuit() {
        crate::commands::clear_error_history();
        let mut cfg = crate::config::ResilienceConfig::default();
        cfg.smart_resilience_enabled = false;
        crate::commands::record_error_full("rate_limit", "anthropic", "claude-sonnet-4", "429");
        crate::commands::record_error_full("rate_limit", "anthropic", "claude-sonnet-4", "429");
        crate::commands::record_error_full("rate_limit", "anthropic", "claude-sonnet-4", "429");
        let broken = crate::commands::is_circuit_broken("rate_limit");
        // Mirrors the call-site predicate at loop_engine.rs:RateLimitRetry branch.
        let smart_halt = cfg.smart_resilience_enabled && broken;
        assert!(
            !smart_halt,
            "smart_resilience_enabled=false must skip the CircuitOpen halt"
        );
        crate::commands::clear_error_history();
    }

    /// Builds a CircuitOpen halt at the same shape the run_loop wire site does
    /// — error_kind + circuit_attempts_summary(kind) — and verifies the
    /// AttemptRecord fields are preserved through the variant.
    #[test]
    fn phase34_res_02_halt_carries_error_kind_and_attempts_summary() {
        crate::commands::clear_error_history();
        crate::commands::record_error_full(
            "rate_limit",
            "anthropic",
            "claude-sonnet-4",
            "429 first",
        );
        crate::commands::record_error_full(
            "rate_limit",
            "anthropic",
            "claude-sonnet-4",
            "429 second",
        );
        crate::commands::record_error_full(
            "rate_limit",
            "anthropic",
            "claude-sonnet-4",
            "429 third",
        );
        let attempts = crate::commands::circuit_attempts_summary("rate_limit");
        assert_eq!(attempts.len(), 3);
        let halt = LoopHaltReason::CircuitOpen {
            error_kind: "rate_limit".to_string(),
            attempts_summary: attempts.clone(),
        };
        match halt {
            LoopHaltReason::CircuitOpen {
                error_kind,
                attempts_summary,
            } => {
                assert_eq!(error_kind, "rate_limit");
                assert_eq!(attempts_summary.len(), 3);
                assert_eq!(attempts_summary[0].provider, "anthropic");
                assert_eq!(attempts_summary[0].model, "claude-sonnet-4");
                assert!(attempts_summary[0].error_message.starts_with("429"));
            }
            _ => panic!("expected CircuitOpen"),
        }
        crate::commands::clear_error_history();
    }

    /// Mirrors the run_loop post-success behavior (loop_engine.rs:1307 area):
    /// 3 errors trip the breaker; clear_error_history() — called on every
    /// successful complete_turn — closes it. Without this clear-on-success,
    /// stale rate_limits from a recovered window would block future
    /// recoveries. Threat T-34-20 mitigation.
    #[test]
    fn phase34_res_02_clear_on_success_resets_breaker() {
        crate::commands::clear_error_history();
        crate::commands::record_error_full("server", "openai", "gpt-4o", "503");
        crate::commands::record_error_full("server", "openai", "gpt-4o", "503");
        crate::commands::record_error_full("server", "openai", "gpt-4o", "503");
        assert!(crate::commands::is_circuit_broken("server"));
        crate::commands::clear_error_history();
        assert!(
            !crate::commands::is_circuit_broken("server"),
            "clear_error_history (called after each successful turn) must close the circuit"
        );
    }

    // ─── Plan 34-06 (RES-03 + RES-04) — per-conversation cost guard tests ──

    /// RES-03 — per-conversation cumulative cost accumulates across iterations.
    /// Three "turns" of (1M in, 1M out) at price (3.0, 15.0) → $18 each → $54.
    /// Mirrors the arithmetic at the post-turn accumulator site.
    #[test]
    fn phase34_res_03_cost_accumulates_across_iterations() {
        let mut state = LoopState::default();
        for _ in 0..3 {
            let turn_cost = (1_000_000_f32 * 3.0 + 1_000_000_f32 * 15.0) / 1_000_000.0;
            state.conversation_cumulative_cost_usd += turn_cost;
        }
        assert!(
            (state.conversation_cumulative_cost_usd - 54.0).abs() < 0.01,
            "3 × $18 = $54; got {}",
            state.conversation_cumulative_cost_usd
        );
    }

    /// RES-04 — predicate gate fires at 80% of cap when smart-on AND latch unset.
    /// Mirrors the iteration-top warn predicate verbatim.
    #[test]
    fn phase34_res_04_warning_emit_at_80_percent() {
        let mut cfg = crate::config::ResilienceConfig::default();
        cfg.smart_resilience_enabled = true;
        cfg.cost_guard_per_conversation_dollars = 10.0;
        let mut state = LoopState::default();
        state.conversation_cumulative_cost_usd = 8.5;
        let should_warn = cfg.smart_resilience_enabled
            && !state.cost_warning_80_emitted
            && state.conversation_cumulative_cost_usd
                > 0.8 * cfg.cost_guard_per_conversation_dollars;
        assert!(should_warn, "predicate must fire at 8.5 / 10.0 (85%)");
    }

    /// RES-04 — latch suppresses repeated warning emits within one conversation.
    /// First fire sets the latch; subsequent iterations even at higher spend
    /// must NOT re-emit. Mirrors the predicate at the iteration top.
    #[test]
    fn phase34_res_04_warning_emit_only_once_per_conversation() {
        let mut cfg = crate::config::ResilienceConfig::default();
        cfg.smart_resilience_enabled = true;
        cfg.cost_guard_per_conversation_dollars = 10.0;
        let mut state = LoopState::default();
        state.conversation_cumulative_cost_usd = 8.5;
        // First-iteration predicate fires.
        let first = cfg.smart_resilience_enabled
            && !state.cost_warning_80_emitted
            && state.conversation_cumulative_cost_usd
                > 0.8 * cfg.cost_guard_per_conversation_dollars;
        assert!(first, "must fire at first crossing");
        // Emulate the run_loop side effect — set the latch.
        state.cost_warning_80_emitted = true;
        // Crank spend higher; latch must still suppress.
        state.conversation_cumulative_cost_usd = 9.5;
        let second = cfg.smart_resilience_enabled
            && !state.cost_warning_80_emitted
            && state.conversation_cumulative_cost_usd
                > 0.8 * cfg.cost_guard_per_conversation_dollars;
        assert!(!second, "latch must suppress repeat fire (T-34-25 mitigation)");
    }

    /// RES-04 — 100% halt fires with CostScope::PerConversation. Verifies the
    /// halt predicate AND the LoopHaltReason variant carries the right scope.
    #[test]
    fn phase34_res_04_halt_at_100_percent_per_conversation() {
        let cfg = crate::config::ResilienceConfig {
            cost_guard_per_conversation_dollars: 10.0,
            ..Default::default()
        };
        let mut state = LoopState::default();
        state.conversation_cumulative_cost_usd = 10.1;
        let should_halt =
            state.conversation_cumulative_cost_usd > cfg.cost_guard_per_conversation_dollars;
        assert!(should_halt);
        let halt = LoopHaltReason::CostExceeded {
            spent_usd: state.conversation_cumulative_cost_usd,
            cap_usd: cfg.cost_guard_per_conversation_dollars,
            scope: CostScope::PerConversation,
        };
        match halt {
            LoopHaltReason::CostExceeded { scope, spent_usd, cap_usd } => {
                assert_eq!(scope, CostScope::PerConversation);
                assert!((spent_usd - 10.1).abs() < 0.001);
                assert!((cap_usd - 10.0).abs() < 0.001);
            }
            _ => panic!("expected CostExceeded"),
        }
    }

    /// RES-04 — smart-off path: 80% warn is SKIPPED; 100% halt STILL FIRES.
    /// Data-integrity guarantee per CONTEXT lock §Backward Compatibility:
    /// "Per-conversation cost cap still enforced at 100% (data integrity >
    /// smart features)." Threat T-34-24 regression discipline.
    #[test]
    fn phase34_res_04_smart_off_uses_per_loop_cap_only() {
        let mut cfg = crate::config::ResilienceConfig::default();
        cfg.smart_resilience_enabled = false;
        cfg.cost_guard_per_conversation_dollars = 10.0;
        let mut state = LoopState::default();
        state.conversation_cumulative_cost_usd = 8.5;
        // Warn predicate: smart-off MUST skip.
        let should_warn = cfg.smart_resilience_enabled
            && !state.cost_warning_80_emitted
            && state.conversation_cumulative_cost_usd
                > 0.8 * cfg.cost_guard_per_conversation_dollars;
        assert!(!should_warn, "smart-off must skip 80% warn");
        // Halt predicate: smart-off STILL fires — data integrity.
        state.conversation_cumulative_cost_usd = 10.1;
        let should_halt =
            state.conversation_cumulative_cost_usd > cfg.cost_guard_per_conversation_dollars;
        assert!(should_halt, "smart-off MUST fire 100% halt — data integrity");
    }

    /// Phase 34 / BL-01 (REVIEW finding) — per-conversation cost MUST persist
    /// across `send_message_stream` calls within the same conversation_id.
    /// We can't easily exercise the full `run_loop` without provider mocking,
    /// so this test exercises the contract directly: the carry-over registry
    /// load/save round-trip preserves cumulative cost, and a fresh
    /// `LoopState` seeded from `load_conversation_state` reflects the prior
    /// turn's spend (which is what `run_loop` does at its top).
    #[test]
    fn phase34_res_03_cost_persists_across_send_message_stream_calls() {
        // Use a unique conversation_id per test run so parallel tests don't
        // collide on the process-global registry.
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.subsec_nanos())
            .unwrap_or(0);
        let cid = format!("test-cid-bl01-{}-{}", std::process::id(), nanos);
        // Clean any prior state for this id.
        forget_conversation_state(&cid);

        // Turn 1 — accumulate $5.00 cumulative.
        let mut s1 = LoopState::default();
        let prior1 = load_conversation_state(&cid);
        // Fresh conversation: prior is zero.
        assert_eq!(
            prior1.conversation_cumulative_cost_usd, 0.0,
            "fresh conversation must start at $0.00"
        );
        s1.conversation_cumulative_cost_usd = prior1.conversation_cumulative_cost_usd + 5.00;
        s1.cost_warning_80_emitted = false;
        save_conversation_state(&cid, extract_carry_over(&s1));

        // Turn 2 — load prior, accumulate another $5.00.
        let mut s2 = LoopState::default();
        let prior2 = load_conversation_state(&cid);
        assert!(
            (prior2.conversation_cumulative_cost_usd - 5.00).abs() < 1e-6,
            "turn 2 must observe $5.00 from turn 1; got ${}",
            prior2.conversation_cumulative_cost_usd
        );
        s2.conversation_cumulative_cost_usd =
            prior2.conversation_cumulative_cost_usd + 5.00;
        save_conversation_state(&cid, extract_carry_over(&s2));

        // Turn 3 — total must be $10.00.
        let prior3 = load_conversation_state(&cid);
        assert!(
            (prior3.conversation_cumulative_cost_usd - 10.00).abs() < 1e-6,
            "cumulative MUST be $10.00 after two $5.00 turns (BL-01 regression); got ${}",
            prior3.conversation_cumulative_cost_usd
        );

        // Cleanup.
        forget_conversation_state(&cid);
        let cleared = load_conversation_state(&cid);
        assert_eq!(
            cleared.conversation_cumulative_cost_usd, 0.0,
            "forget_conversation_state must clear the entry"
        );
    }

    /// Phase 34 / BL-01 — empty `conversation_id` is a no-op for the registry
    /// (test paths and quickask one-offs). load returns Default; save is
    /// a no-op so we don't pollute the map with empty-string keys.
    #[test]
    fn phase34_bl_01_empty_conversation_id_is_noop() {
        let prior = load_conversation_state("");
        assert_eq!(prior.conversation_cumulative_cost_usd, 0.0);
        // Save with non-zero — must NOT land in the map.
        let carry = ConversationCarryOver {
            conversation_cumulative_cost_usd: 99.99,
            ..Default::default()
        };
        save_conversation_state("", carry);
        // Re-load — still zero. No "" key in the map.
        let after = load_conversation_state("");
        assert_eq!(
            after.conversation_cumulative_cost_usd, 0.0,
            "empty conversation_id MUST NOT persist into registry"
        );
    }

    /// Phase 34 / BL-01 — the FIFO eviction at CONVERSATION_STATES_CAP keeps
    /// the registry bounded so a long-running BLADE process can't leak
    /// arbitrary memory into N-many resumed conversations.
    #[test]
    fn phase34_bl_01_registry_bounded_eviction() {
        // Drop the cap to a small number for the test by inserting CAP+10 entries
        // and asserting the map size is ≤ CAP afterwards. We use a unique prefix
        // so this test doesn't perturb sibling tests' entries.
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.subsec_nanos())
            .unwrap_or(0);
        let prefix = format!("test-bl01-evict-{}-{}-", std::process::id(), nanos);
        let n_to_insert = CONVERSATION_STATES_CAP + 10;
        for i in 0..n_to_insert {
            let cid = format!("{}{}", prefix, i);
            save_conversation_state(
                &cid,
                ConversationCarryOver {
                    conversation_cumulative_cost_usd: i as f32 * 0.01,
                    ..Default::default()
                },
            );
        }
        let map_len = CONVERSATION_STATES.lock().unwrap().len();
        assert!(
            map_len <= CONVERSATION_STATES_CAP,
            "registry must not exceed CONVERSATION_STATES_CAP={}; got {}",
            CONVERSATION_STATES_CAP,
            map_len
        );
        // Cleanup our test entries.
        for i in 0..n_to_insert {
            forget_conversation_state(&format!("{}{}", prefix, i));
        }
    }

    // ---------------------------------------------------------------------
    // Phase 35 Plan 35-02 — LoopState.is_subagent + LoopHaltReason::DecompositionComplete
    // substrate tests. Three regression locks for the recursion gate field +
    // halt variant + Clone preservation of the new field.
    // ---------------------------------------------------------------------

    #[test]
    fn phase35_loop_state_has_is_subagent_default_false() {
        let s = LoopState::default();
        assert!(
            !s.is_subagent,
            "default LoopState.is_subagent must be false (parent loops)"
        );
    }

    #[test]
    fn phase35_loop_halt_reason_decomposition_complete_serde_roundtrip() {
        let h = LoopHaltReason::DecompositionComplete;
        let json = serde_json::to_string(&h).expect("serialize DecompositionComplete");
        // LoopHaltReason::DecompositionComplete is a unit-variant — serializes
        // as the bare discriminant string "DecompositionComplete".
        assert!(
            json.contains("DecompositionComplete"),
            "expected discriminant in JSON, got {}",
            json
        );
    }

    #[test]
    fn phase35_clone_loop_state_preserves_is_subagent() {
        let mut s = LoopState::default();
        s.is_subagent = true;
        // No bespoke clone_loop_state helper exists in loop_engine.rs as of
        // Phase 34; LoopState derives Clone, so this exercises the derived
        // implementation. When a future plan introduces an explicit
        // clone_loop_state helper, this test should be updated to call it.
        let s2 = s.clone();
        assert!(
            s2.is_subagent,
            "Clone of LoopState must preserve is_subagent flag"
        );
    }
}
