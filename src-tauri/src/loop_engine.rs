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
