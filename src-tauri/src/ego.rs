//! ego.rs — refusal detector + capability_gap classifier + retry orchestrator
//!
//! Phase 18 (chat-first reinterpretation) — see 18-CONTEXT.md D-11..D-15.
//! Wave 0 skeleton: type contracts + function skeletons + test stubs.
//! Bodies land in Plan 08.

use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::OnceLock;
use regex::Regex;
use tauri::AppHandle;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum EgoVerdict {
    Pass,
    Refusal { pattern: String, reason: String },
    CapabilityGap { capability: String, suggestion: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum EgoOutcome {
    Retried { new_response: String },
    AutoInstalled { capability: String, then_retried: String },
    HardRefused { final_response: String, logged_gap: bool },
}

// REFUSAL_PATTERNS — populated in Plan 08 (D-12 + RESEARCH § Refusal Pattern Tuning, 9 patterns).
// Wave 0 leaves the slot empty so the file compiles.
static REFUSAL_PATTERNS: OnceLock<Vec<(Regex, &'static str)>> = OnceLock::new();

fn refusal_patterns() -> &'static Vec<(Regex, &'static str)> {
    REFUSAL_PATTERNS.get_or_init(Vec::new)
}

// RETRY_COUNT — D-14 retry cap = 1 per turn. reset_retry_for_turn() called by commands.rs (Plan 15).
static RETRY_COUNT: AtomicU32 = AtomicU32::new(0);

pub fn reset_retry_for_turn() {
    RETRY_COUNT.store(0, Ordering::SeqCst);
}

/// Wave 0 skeleton — Plan 08 implements full regex-matcher + capability_gap precedence (D-13).
pub fn intercept_assistant_output(_transcript: &str) -> EgoVerdict {
    let _ = refusal_patterns();
    EgoVerdict::Pass
}

/// Wave 0 skeleton — Plan 08 implements full retry loop + auto_install routing.
pub async fn handle_refusal(_app: &AppHandle, _verdict: EgoVerdict, _original: &str) -> EgoOutcome {
    let _ = RETRY_COUNT.fetch_add(0, Ordering::SeqCst);
    EgoOutcome::HardRefused {
        final_response: String::new(),
        logged_gap: false,
    }
}

#[tauri::command]
pub fn ego_intercept(transcript: String) -> EgoVerdict {
    intercept_assistant_output(&transcript)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn skeleton_compiles() {
        let v = intercept_assistant_output("anything");
        assert!(matches!(v, EgoVerdict::Pass));
    }

    #[test]
    fn reset_retry_works() {
        RETRY_COUNT.store(5, Ordering::SeqCst);
        reset_retry_for_turn();
        assert_eq!(RETRY_COUNT.load(Ordering::SeqCst), 0);
    }

    // Real test cases land in Plan 08:
    //  - refusal_patterns_match (table-driven, ≥9 patterns)
    //  - no_false_positive_on_but_can (Pitfall 8 disjunction-aware post-check)
    //  - capability_gap_precedes_refusal (D-13)
    //  - retry_cap_holds (D-14)
}
