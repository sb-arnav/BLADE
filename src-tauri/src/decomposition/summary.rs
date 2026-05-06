//! DECOMP-03: per-sub-agent summary distillation.
//!
//! `distill_subagent_summary(subagent_id, role, &config)` reads the
//! sub-agent's JSONL via Phase 34 SESS-02's `load_session`, runs a cheap-model
//! pass with a fixed prompt, returns a 1-paragraph SubagentSummary capped at
//! `config.decomposition.subagent_summary_max_tokens` (default 800).
//!
//! Plan 35-02 STUB — body returns Err. Real implementation in Plan 35-06.

use serde::{Deserialize, Serialize};

use crate::agents::AgentRole;
use crate::config::BladeConfig;

/// Sub-agent → parent return type. ONE per StepGroup.
///
/// Format injected into the parent's conversation as a synthetic
/// AssistantTurn-shaped ConversationMessage:
///
/// ```text
/// [Sub-agent summary — step {step_index}, {role}, session {ULID[..8]}…]
/// {summary_text}
///
/// (success={success}, tokens={tokens_used}, cost=${cost_usd:.4f}; full conversation in session {ULID})
/// ```
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubagentSummary {
    pub step_index: u32,
    /// ULID — drillable via SessionsView.
    pub subagent_session_id: String,
    /// AgentRole.as_str() form, lowercase.
    pub role: String,
    pub success: bool,
    /// safe_slice'd to subagent_summary_max_tokens × 4 chars (rough token→char approximation).
    pub summary_text: String,
    pub tokens_used: u32,
    pub cost_usd: f32,
}

#[cfg(test)]
thread_local! {
    /// Plan 35-06 — tests verify the catch_unwind fallback produces a
    /// heuristic 200-char summary when summary distillation panics.
    pub(crate) static DECOMP_FORCE_DISTILL_PANIC: std::cell::Cell<bool> =
        std::cell::Cell::new(false);
}

/// Run cheap-model summary pass over the sub-agent's full conversation.
///
/// Plan 35-02 STUB — returns Err("not yet wired"). Plan 35-06 fills the body
/// with load_session + cheap_model_for_provider + complete_simple +
/// catch_unwind heuristic fallback.
pub async fn distill_subagent_summary(
    _subagent_session_id: &str,
    _role: AgentRole,
    _config: &BladeConfig,
) -> Result<SubagentSummary, String> {
    #[cfg(test)]
    {
        if DECOMP_FORCE_DISTILL_PANIC.with(|c| c.get()) {
            panic!("test-only induced panic in distill_subagent_summary (Plan 35-06 regression seam)");
        }
    }
    Err("Plan 35-02 stub — distill_subagent_summary body wired in Plan 35-06".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn phase35_subagent_summary_serde_roundtrip() {
        let s = SubagentSummary {
            step_index: 0,
            subagent_session_id: "01ARZ3NDEKTSV4RRFFQ69G5FAV".to_string(),
            role: "coder".to_string(),
            success: true,
            summary_text: "compiled cleanly".to_string(),
            tokens_used: 100,
            cost_usd: 0.001,
        };
        let json = serde_json::to_string(&s).expect("serialize");
        let parsed: SubagentSummary = serde_json::from_str(&json).expect("parse");
        assert_eq!(parsed.step_index, s.step_index);
        assert_eq!(parsed.subagent_session_id, s.subagent_session_id);
    }

    #[test]
    fn phase35_decomp_force_distill_panic_seam_declared() {
        // Verify the seam compiles + can be set/cleared.
        DECOMP_FORCE_DISTILL_PANIC.with(|c| c.set(true));
        let got = DECOMP_FORCE_DISTILL_PANIC.with(|c| c.get());
        DECOMP_FORCE_DISTILL_PANIC.with(|c| c.set(false));
        assert!(got, "seam round-trips a bool");
    }

    #[tokio::test]
    async fn phase35_distill_subagent_summary_stub_returns_err() {
        // Plan 35-02 STUB — verify the body returns the locked Err shape
        // before Plan 35-06 fills it. Reset the panic seam first to ensure
        // we exercise the Err branch and not the panic branch.
        DECOMP_FORCE_DISTILL_PANIC.with(|c| c.set(false));
        let cfg = BladeConfig::default();
        let result = distill_subagent_summary("fake-id", AgentRole::Researcher, &cfg).await;
        assert!(result.is_err(), "stub must return Err until Plan 35-06");
        let msg = result.unwrap_err();
        assert!(msg.contains("Plan 35-02 stub"), "unexpected err msg: {}", msg);
    }
}
