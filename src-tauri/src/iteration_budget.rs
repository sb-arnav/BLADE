// Phase 73 (v2.4) — IterationBudget.
//
// Pattern-lift from NousResearch/hermes-agent `agent/iteration_budget.py` (MIT).
// Tracks per-conversation iteration count + optional cumulative token spend.
// Replaces BLADE's previous hardcoded `for _ in 0..12` iteration ceiling in
// loop_engine, and exposes structured escalation events for the loop to react
// to instead of just bailing silently.
//
// Pure data structure; no I/O, no async. Loop_engine wires this in when ready.

use serde::{Deserialize, Serialize};

/// Default ceiling — matches BLADE's prior hardcoded 12-iter limit. Configurable
/// per-conversation via `IterationBudget::with_max_iterations`.
pub const DEFAULT_MAX_ITERATIONS: u32 = 12;

/// Soft warning fires when iteration count hits this fraction of the cap.
const WARN_FRACTION: f32 = 0.75;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum BudgetState {
    /// Under the soft warning threshold.
    Healthy,
    /// Between WARN_FRACTION and the hard cap. Loop should consider
    /// compression / summarization before next tool dispatch.
    Warning,
    /// At or past the hard cap. Loop must escalate (return-to-user,
    /// auto-decompose, or escalate-to-better-model) instead of looping.
    Exhausted,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IterationBudget {
    max_iterations: u32,
    current: u32,
    token_spend: u64,
    token_cap: Option<u64>,
}

impl Default for IterationBudget {
    fn default() -> Self {
        Self {
            max_iterations: DEFAULT_MAX_ITERATIONS,
            current: 0,
            token_spend: 0,
            token_cap: None,
        }
    }
}

impl IterationBudget {
    pub fn with_max_iterations(max: u32) -> Self {
        Self { max_iterations: max.max(1), ..Self::default() }
    }

    pub fn with_token_cap(max_iter: u32, token_cap: u64) -> Self {
        Self {
            max_iterations: max_iter.max(1),
            token_cap: Some(token_cap),
            ..Self::default()
        }
    }

    /// Advance iteration counter by 1. Call before each model dispatch.
    pub fn tick(&mut self) {
        self.current = self.current.saturating_add(1);
    }

    /// Record tokens consumed by the last turn (input + output combined).
    pub fn record_tokens(&mut self, tokens: u64) {
        self.token_spend = self.token_spend.saturating_add(tokens);
    }

    /// Current iteration index (1-based after first tick; 0 before any tick).
    pub fn current(&self) -> u32 {
        self.current
    }

    pub fn max(&self) -> u32 {
        self.max_iterations
    }

    pub fn token_spend(&self) -> u64 {
        self.token_spend
    }

    /// Headline state. Token cap, if set, can independently trigger Exhausted.
    pub fn state(&self) -> BudgetState {
        if self.current >= self.max_iterations {
            return BudgetState::Exhausted;
        }
        if let Some(cap) = self.token_cap {
            if self.token_spend >= cap {
                return BudgetState::Exhausted;
            }
        }
        let warn_at = (self.max_iterations as f32 * WARN_FRACTION).ceil() as u32;
        if self.current >= warn_at {
            BudgetState::Warning
        } else {
            BudgetState::Healthy
        }
    }

    /// True if loop must halt before another model dispatch.
    pub fn is_exhausted(&self) -> bool {
        self.state() == BudgetState::Exhausted
    }

    /// Human-readable escalation reason for chat UI when exhausted.
    pub fn escalation_reason(&self) -> Option<String> {
        match self.state() {
            BudgetState::Exhausted => {
                if let Some(cap) = self.token_cap {
                    if self.token_spend >= cap {
                        return Some(format!(
                            "Token budget exhausted ({}/{} tokens across {} iterations)",
                            self.token_spend, cap, self.current
                        ));
                    }
                }
                Some(format!(
                    "Iteration ceiling hit ({} of {} iterations used)",
                    self.current, self.max_iterations
                ))
            }
            _ => None,
        }
    }
}

// ── Phase 73 falsification — runnable tests ─────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_is_twelve_iterations() {
        let b = IterationBudget::default();
        assert_eq!(b.max(), 12);
        assert_eq!(b.current(), 0);
        assert_eq!(b.state(), BudgetState::Healthy);
        assert!(!b.is_exhausted());
        assert!(b.escalation_reason().is_none());
    }

    #[test]
    fn tick_advances_and_hits_warning_at_75_percent() {
        // 12 iterations, warn at ceil(12 * 0.75) = 9.
        let mut b = IterationBudget::default();
        for _ in 0..8 { b.tick(); }
        assert_eq!(b.current(), 8);
        assert_eq!(b.state(), BudgetState::Healthy);
        b.tick(); // 9th
        assert_eq!(b.state(), BudgetState::Warning);
    }

    #[test]
    fn tick_hits_exhausted_at_max() {
        let mut b = IterationBudget::with_max_iterations(3);
        b.tick(); b.tick(); b.tick();
        assert!(b.is_exhausted(), "3/3 should be exhausted");
        let reason = b.escalation_reason().expect("escalation reason present");
        assert!(reason.contains("3"), "reason mentions count: {}", reason);
    }

    #[test]
    fn token_cap_can_trigger_exhausted_before_iterations_run_out() {
        let mut b = IterationBudget::with_token_cap(100, 1_000);
        b.tick();
        b.record_tokens(500);
        assert_eq!(b.state(), BudgetState::Healthy);
        b.record_tokens(600); // total 1100, over cap
        assert!(b.is_exhausted(), "token cap exhausts before iteration ceiling");
        let reason = b.escalation_reason().expect("escalation reason present");
        assert!(reason.contains("Token"), "token reason fired: {}", reason);
    }

    #[test]
    fn saturates_does_not_panic_on_overflow() {
        let mut b = IterationBudget::with_max_iterations(u32::MAX);
        // tick to u32::MAX-1, then way past — saturating_add prevents overflow.
        b.current = u32::MAX - 1;
        b.tick();
        b.tick(); // would overflow without saturating
        assert_eq!(b.current(), u32::MAX);
        let mut b2 = IterationBudget::with_token_cap(10, u64::MAX);
        b2.record_tokens(u64::MAX);
        b2.record_tokens(1); // would overflow
        assert_eq!(b2.token_spend(), u64::MAX);
    }

    #[test]
    fn with_max_iterations_floors_at_one() {
        let b = IterationBudget::with_max_iterations(0);
        assert_eq!(b.max(), 1, "max iterations is floored at 1 to prevent zero-iter loops");
    }
}
