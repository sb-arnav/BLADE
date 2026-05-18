// Phase 74 (v2.4) — ToolGuardrails per-turn loop detection.
//
// Pattern-lift from NousResearch/hermes-agent `agent/tool_guardrails.py` (MIT).
// Tracks per-turn tool-call observations across the agent loop and emits
// decisions (warn / halt) when patterns suggest the loop is stuck: same tool
// failing repeatedly, identical call repeated, idempotent reads with no
// follow-up mutation.
//
// Pure data structure; loop_engine wires in observations + reads decisions.
// Warnings are non-blocking guidance; hard stops are explicit opt-in (default
// off) so interactive use gets a nudge without the loop being killed.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Tools whose effects are read-only / idempotent. Repeated calls without
/// intervening mutation suggest the model is spinning.
pub const IDEMPOTENT_TOOLS: &[&str] = &[
    "read_file", "search_files", "web_search", "web_extract",
    "session_search", "browser_snapshot", "browser_console", "browser_get_images",
    "mcp_filesystem_read_file", "mcp_filesystem_read_text_file",
    "mcp_filesystem_read_multiple_files", "mcp_filesystem_list_directory",
    "mcp_filesystem_list_directory_with_sizes", "mcp_filesystem_directory_tree",
    "mcp_filesystem_get_file_info", "mcp_filesystem_search_files",
];

/// Tools that change state. Resets the no-progress counter.
pub const MUTATING_TOOLS: &[&str] = &[
    "terminal", "execute_code", "write_file", "patch", "todo", "memory",
    "skill_manage", "browser_click", "browser_type", "browser_press",
    "browser_scroll", "browser_navigate", "send_message", "cronjob",
    "delegate_task", "process",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum GuardrailDecision {
    /// Continue normally.
    Allow,
    /// Continue but surface a warning to the loop / chat UI.
    Warn(WarnKind),
    /// Halt the loop. Returns the user-facing reason.
    Halt(HaltKind),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum WarnKind {
    ExactCallRepeating,
    SameToolFailing,
    IdempotentNoProgress,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum HaltKind {
    ExactCallRepeatingTooMany,
    SameToolFailingTooMany,
    IdempotentNoProgressTooMany,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GuardrailConfig {
    pub warnings_enabled: bool,
    pub hard_stop_enabled: bool,
    pub exact_failure_warn_after: u32,
    pub exact_failure_block_after: u32,
    pub same_tool_failure_warn_after: u32,
    pub same_tool_failure_halt_after: u32,
    pub no_progress_warn_after: u32,
    pub no_progress_block_after: u32,
}

impl Default for GuardrailConfig {
    fn default() -> Self {
        Self {
            warnings_enabled: true,
            hard_stop_enabled: false, // explicit opt-in for halts (matches upstream)
            exact_failure_warn_after: 2,
            exact_failure_block_after: 5,
            same_tool_failure_warn_after: 3,
            same_tool_failure_halt_after: 8,
            no_progress_warn_after: 2,
            no_progress_block_after: 5,
        }
    }
}

#[derive(Debug, Clone, Default)]
pub struct GuardrailObserver {
    pub config: GuardrailConfig,
    exact_call_counts: HashMap<u64, u32>,
    tool_failure_counts: HashMap<String, u32>,
    idempotent_calls_since_mutation: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ToolCallObservation<'a> {
    pub tool_name: &'a str,
    pub args_json: &'a str,
    pub succeeded: bool,
}

impl GuardrailObserver {
    pub fn new(config: GuardrailConfig) -> Self {
        Self {
            config,
            exact_call_counts: HashMap::new(),
            tool_failure_counts: HashMap::new(),
            idempotent_calls_since_mutation: 0,
        }
    }

    /// Reset per-turn counters (call between user turns).
    pub fn reset_turn(&mut self) {
        self.exact_call_counts.clear();
        self.tool_failure_counts.clear();
        // idempotent_calls_since_mutation persists across turns intentionally —
        // a stuck pattern can span multiple turns.
    }

    /// Hard reset (call at conversation start).
    pub fn reset_all(&mut self) {
        self.reset_turn();
        self.idempotent_calls_since_mutation = 0;
    }

    /// Observe a tool call result + return the loop's decision.
    pub fn observe(&mut self, call: ToolCallObservation) -> GuardrailDecision {
        let is_idempotent = IDEMPOTENT_TOOLS.contains(&call.tool_name);
        let is_mutating = MUTATING_TOOLS.contains(&call.tool_name);

        // Track no-progress on idempotent / mutation reset.
        if is_mutating && call.succeeded {
            self.idempotent_calls_since_mutation = 0;
        } else if is_idempotent {
            self.idempotent_calls_since_mutation = self.idempotent_calls_since_mutation.saturating_add(1);
        }

        // Exact-call repeat detection (same tool + same args).
        let call_hash = fnv1a(&format!("{}|{}", call.tool_name, call.args_json));
        let exact = self.exact_call_counts.entry(call_hash).or_insert(0);
        *exact = exact.saturating_add(1);
        let exact_count = *exact;

        // Same-tool failure tracking.
        let mut tool_failures = 0u32;
        if !call.succeeded {
            let entry = self.tool_failure_counts.entry(call.tool_name.to_string()).or_insert(0);
            *entry = entry.saturating_add(1);
            tool_failures = *entry;
        }

        // Halt checks first (hard_stop_enabled gate).
        if self.config.hard_stop_enabled {
            if !call.succeeded && exact_count >= self.config.exact_failure_block_after {
                return GuardrailDecision::Halt(HaltKind::ExactCallRepeatingTooMany);
            }
            if tool_failures >= self.config.same_tool_failure_halt_after {
                return GuardrailDecision::Halt(HaltKind::SameToolFailingTooMany);
            }
            if is_idempotent && self.idempotent_calls_since_mutation >= self.config.no_progress_block_after {
                return GuardrailDecision::Halt(HaltKind::IdempotentNoProgressTooMany);
            }
        }

        // Warn checks (gated on warnings_enabled).
        if self.config.warnings_enabled {
            if !call.succeeded && exact_count >= self.config.exact_failure_warn_after {
                return GuardrailDecision::Warn(WarnKind::ExactCallRepeating);
            }
            if tool_failures >= self.config.same_tool_failure_warn_after {
                return GuardrailDecision::Warn(WarnKind::SameToolFailing);
            }
            if is_idempotent && self.idempotent_calls_since_mutation >= self.config.no_progress_warn_after {
                return GuardrailDecision::Warn(WarnKind::IdempotentNoProgress);
            }
        }

        GuardrailDecision::Allow
    }
}

/// FNV-1a 64-bit hash — small + deterministic; avoids pulling in DefaultHasher
/// which doesn't guarantee stable values across compiler versions.
fn fnv1a(s: &str) -> u64 {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in s.as_bytes() {
        h ^= *b as u64;
        h = h.wrapping_mul(0x100_0000_01b3);
    }
    h
}

// ── Phase 74 falsification — runnable tests ─────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn read_call(args: &str, ok: bool) -> ToolCallObservation<'_> {
        ToolCallObservation { tool_name: "read_file", args_json: args, succeeded: ok }
    }

    fn write_call(ok: bool) -> ToolCallObservation<'static> {
        ToolCallObservation { tool_name: "write_file", args_json: "{}", succeeded: ok }
    }

    #[test]
    fn fresh_observer_allows_first_call() {
        let mut g = GuardrailObserver::new(GuardrailConfig::default());
        assert_eq!(g.observe(read_call("{\"path\":\"a\"}", true)), GuardrailDecision::Allow);
    }

    #[test]
    fn exact_repeat_failure_warns_then_halts_when_enabled() {
        let cfg = GuardrailConfig { hard_stop_enabled: true, ..Default::default() };
        let mut g = GuardrailObserver::new(cfg);
        // First failure: under warn threshold (2) → allow.
        assert_eq!(g.observe(read_call("{\"path\":\"x\"}", false)), GuardrailDecision::Allow);
        // Second identical failure: warn.
        assert!(matches!(g.observe(read_call("{\"path\":\"x\"}", false)),
                         GuardrailDecision::Warn(WarnKind::ExactCallRepeating)));
        // Calls 3, 4 still warn; call 5 (block_after=5) halts.
        let _ = g.observe(read_call("{\"path\":\"x\"}", false));
        let _ = g.observe(read_call("{\"path\":\"x\"}", false));
        assert!(matches!(g.observe(read_call("{\"path\":\"x\"}", false)),
                         GuardrailDecision::Halt(HaltKind::ExactCallRepeatingTooMany)));
    }

    #[test]
    fn same_tool_repeated_failures_warn_at_threshold() {
        let mut g = GuardrailObserver::new(GuardrailConfig::default());
        // Different args each time but same tool — only same_tool_failure_warn_after counts.
        let _ = g.observe(read_call("{\"p\":\"a\"}", false));
        let _ = g.observe(read_call("{\"p\":\"b\"}", false));
        assert!(matches!(g.observe(read_call("{\"p\":\"c\"}", false)),
                         GuardrailDecision::Warn(_)),
                "3rd same-tool failure should warn");
    }

    #[test]
    fn successful_mutation_resets_no_progress_counter() {
        let mut g = GuardrailObserver::new(GuardrailConfig::default());
        let _ = g.observe(read_call("{\"p\":\"a\"}", true));
        let _ = g.observe(read_call("{\"p\":\"b\"}", true));
        // 2 idempotent calls with no mutation → would warn next idempotent call.
        // Mutation resets the counter.
        let _ = g.observe(write_call(true));
        assert_eq!(g.idempotent_calls_since_mutation, 0);
        // Now a single read is back to allow.
        let d = g.observe(read_call("{\"p\":\"c\"}", true));
        assert_eq!(d, GuardrailDecision::Allow);
    }

    #[test]
    fn idempotent_no_progress_warns_after_threshold() {
        let mut g = GuardrailObserver::new(GuardrailConfig::default());
        // no_progress_warn_after=2 → 3rd idempotent call warns.
        let _ = g.observe(read_call("{\"p\":\"a\"}", true));
        let _ = g.observe(read_call("{\"p\":\"b\"}", true));
        assert!(matches!(g.observe(read_call("{\"p\":\"c\"}", true)),
                         GuardrailDecision::Warn(WarnKind::IdempotentNoProgress)));
    }

    #[test]
    fn warnings_disabled_returns_allow() {
        let cfg = GuardrailConfig { warnings_enabled: false, ..Default::default() };
        let mut g = GuardrailObserver::new(cfg);
        let _ = g.observe(read_call("{\"p\":\"a\"}", false));
        let _ = g.observe(read_call("{\"p\":\"a\"}", false));
        let _ = g.observe(read_call("{\"p\":\"a\"}", false));
        assert_eq!(g.observe(read_call("{\"p\":\"a\"}", false)), GuardrailDecision::Allow);
    }

    #[test]
    fn reset_turn_clears_per_turn_counts_keeps_no_progress() {
        let mut g = GuardrailObserver::new(GuardrailConfig::default());
        let _ = g.observe(read_call("{\"p\":\"a\"}", true));
        let _ = g.observe(read_call("{\"p\":\"b\"}", true));
        g.reset_turn();
        assert!(g.exact_call_counts.is_empty());
        assert_eq!(g.idempotent_calls_since_mutation, 2,
                   "no-progress counter persists across turns");
        g.reset_all();
        assert_eq!(g.idempotent_calls_since_mutation, 0,
                   "reset_all clears no-progress too");
    }

    #[test]
    fn fnv1a_is_deterministic() {
        assert_eq!(fnv1a("read_file|{\"p\":\"x\"}"), fnv1a("read_file|{\"p\":\"x\"}"));
        assert_ne!(fnv1a("read_file|{\"p\":\"x\"}"), fnv1a("read_file|{\"p\":\"y\"}"));
    }
}
