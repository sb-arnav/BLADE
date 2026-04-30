//! ego.rs — refusal detector + capability_gap classifier + retry orchestrator
//!
//! Phase 18 (chat-first reinterpretation) — see 18-CONTEXT.md D-11..D-15.
//! Plan 18-05 (Wave 1) Task 1: refusal patterns + intercept_assistant_output body.
//! Task 2 (handle_refusal + emit_jarvis_intercept) lands in the next commit.

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

// REFUSAL_PATTERNS — D-12 + RESEARCH § Refusal Pattern Tuning (9 patterns to ship).
// Pattern 9 (need_integration) is FIRST per D-13 precedence: CapabilityGap classification
// outranks Refusal classification when an "I'd need a {service} integration" hint is present.
static REFUSAL_PATTERNS: OnceLock<Vec<(Regex, &'static str)>> = OnceLock::new();

fn refusal_patterns() -> &'static Vec<(Regex, &'static str)> {
    REFUSAL_PATTERNS.get_or_init(|| {
        vec![
            // Pattern 9 first per D-13: CapabilityGap precedes Refusal classification.
            (Regex::new(r"(?i)\bI'?d need (a |an )?\w+ (integration|tool|api)\b").unwrap(), "need_integration"),
            // 5 mandatory refusal patterns (D-12)
            (Regex::new(r"(?i)\bI can'?t\b(?: directly)?").unwrap(), "i_cant"),
            (Regex::new(r"(?i)\bI don'?t have access\b").unwrap(),   "no_access"),
            (Regex::new(r"(?i)\bI'?m not able to\b").unwrap(),       "not_able"),
            (Regex::new(r"(?i)\bI cannot directly\b").unwrap(),      "cannot_directly"),
            (Regex::new(r"(?i)\bI lack the\b").unwrap(),             "lack_the"),
            // 3 stretch patterns (D-12 mentions; RESEARCH recommends ship-now per § Refusal Pattern Tuning)
            (Regex::new(r"(?i)\bas an AI\b").unwrap(),               "as_an_ai"),
            (Regex::new(r"(?i)\bI'?m unable to\b").unwrap(),         "unable_to"),
            (Regex::new(r"(?i)\bI don'?t have the (capability|ability|tools)\b").unwrap(), "no_capability"),
        ]
    })
}

// RETRY_COUNT — D-14 retry cap = 1 per turn. reset_retry_for_turn() called by commands.rs (Plan 18-10).
static RETRY_COUNT: AtomicU32 = AtomicU32::new(0);

pub fn reset_retry_for_turn() {
    RETRY_COUNT.store(0, Ordering::SeqCst);
}

/// Phase 18 D-11/D-12/D-13 — refusal detector + capability_gap classifier with
/// disjunction-aware post-check (RESEARCH § Pitfall 8).
///
/// Order:
///   1. Pattern 9 (`need_integration`) → CapabilityGap (D-13 precedence)
///   2. Patterns 1-8 → Refusal IF the next ~80 chars do NOT contain `\bbut\b.+\bcan\b`
///      (suppresses false positives like "I can't help with X, but I can suggest Y")
///   3. Otherwise → Pass
pub fn intercept_assistant_output(transcript: &str) -> EgoVerdict {
    static DISJUNCTION_POSTCHECK: OnceLock<Regex> = OnceLock::new();
    let post = DISJUNCTION_POSTCHECK.get_or_init(|| Regex::new(r"\bbut\b.+\bcan\b").unwrap());

    for (re, label) in refusal_patterns().iter() {
        if let Some(m) = re.find(transcript) {
            // Pattern 9 → CapabilityGap (D-13 precedence)
            if *label == "need_integration" {
                // Extract the capability noun. Match shape: "I'd need a SLACK integration"
                // — split the matched substring and take the token before "integration|tool|api".
                let matched = m.as_str();
                let tokens: Vec<&str> = matched.split_whitespace().collect();
                let capability = tokens
                    .iter()
                    .position(|t| {
                        let lt = t.to_lowercase();
                        lt == "integration" || lt == "tool" || lt == "api"
                    })
                    .and_then(|idx| tokens.get(idx.saturating_sub(1)))
                    .map(|s| s.to_string())
                    .unwrap_or_else(|| "unknown".to_string());
                return EgoVerdict::CapabilityGap {
                    capability,
                    suggestion: "Connect via Integrations tab".to_string(),
                };
            }
            // Patterns 1-8 → Refusal (with disjunction post-check per Pitfall 8).
            // Slice the next 80 chars from the match end. Prefer a direct slice when it
            // lands on a UTF-8 boundary; fall back to safe_slice for non-ASCII content.
            let end = m.end();
            let lookahead_end = transcript.len().min(end + 80);
            let lookahead_owned: String;
            let lookahead: &str = if let Some(slice) = transcript.get(end..lookahead_end) {
                slice
            } else {
                let remaining = &transcript[end..];
                lookahead_owned = crate::safe_slice(remaining, 80).to_string();
                &lookahead_owned
            };
            if post.is_match(lookahead) {
                return EgoVerdict::Pass;
            }
            return EgoVerdict::Refusal {
                pattern: label.to_string(),
                reason: m.as_str().to_string(),
            };
        }
    }
    EgoVerdict::Pass
}

/// Wave 0 skeleton — Plan 18-05 Task 2 implements full retry loop + auto_install routing.
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

    // ── Pattern coverage (Task 1) ────────────────────────────────────────────

    #[test]
    fn pattern_i_cant_matches() {
        match intercept_assistant_output("I can't post to Slack right now.") {
            EgoVerdict::Refusal { pattern, .. } => assert_eq!(pattern, "i_cant"),
            v => panic!("expected Refusal/i_cant, got {v:?}"),
        }
    }

    #[test]
    fn pattern_no_access_matches() {
        match intercept_assistant_output("Sorry, I don't have access to your workspace.") {
            EgoVerdict::Refusal { pattern, .. } => assert_eq!(pattern, "no_access"),
            v => panic!("expected Refusal/no_access, got {v:?}"),
        }
    }

    #[test]
    fn pattern_not_able_matches() {
        match intercept_assistant_output("I'm not able to send emails directly.") {
            EgoVerdict::Refusal { pattern, .. } => assert_eq!(pattern, "not_able"),
            v => panic!("expected Refusal/not_able, got {v:?}"),
        }
    }

    #[test]
    fn pattern_cannot_directly_matches() {
        match intercept_assistant_output("I cannot directly access that file.") {
            EgoVerdict::Refusal { pattern, .. } => assert_eq!(pattern, "cannot_directly"),
            v => panic!("expected Refusal/cannot_directly, got {v:?}"),
        }
    }

    #[test]
    fn pattern_lack_the_matches() {
        match intercept_assistant_output("Unfortunately I lack the credentials for that.") {
            EgoVerdict::Refusal { pattern, .. } => assert_eq!(pattern, "lack_the"),
            v => panic!("expected Refusal/lack_the, got {v:?}"),
        }
    }

    #[test]
    fn pattern_as_an_ai_matches() {
        match intercept_assistant_output("Well, as an AI, I have certain limitations.") {
            EgoVerdict::Refusal { pattern, .. } => assert_eq!(pattern, "as_an_ai"),
            v => panic!("expected Refusal/as_an_ai, got {v:?}"),
        }
    }

    #[test]
    fn pattern_unable_to_matches() {
        match intercept_assistant_output("I'm unable to perform that operation.") {
            EgoVerdict::Refusal { pattern, .. } => assert_eq!(pattern, "unable_to"),
            v => panic!("expected Refusal/unable_to, got {v:?}"),
        }
    }

    #[test]
    fn pattern_no_capability_matches() {
        match intercept_assistant_output("I don't have the ability to access your calendar.") {
            EgoVerdict::Refusal { pattern, .. } => assert_eq!(pattern, "no_capability"),
            v => panic!("expected Refusal/no_capability, got {v:?}"),
        }
    }

    // ── Disjunction-aware post-check (Pitfall 8) ─────────────────────────────

    #[test]
    fn no_false_positive_on_but_can() {
        let v = intercept_assistant_output(
            "I can't help with that, but I can suggest some approaches.",
        );
        assert!(matches!(v, EgoVerdict::Pass), "expected Pass for disjunction, got {v:?}");
    }

    #[test]
    fn no_false_positive_on_however_can() {
        // Guard: the post-check is `but ... can`-anchored, not generic disjunction.
        let v = intercept_assistant_output(
            "I can't do X. However, I can do Y.",
        );
        assert!(matches!(v, EgoVerdict::Refusal { .. }), "post-check is `but ... can`-anchored");
    }

    #[test]
    fn pass_on_helpful_response() {
        let v = intercept_assistant_output(
            "Sure, I'll post that for you. Let me draft the message first.",
        );
        assert!(matches!(v, EgoVerdict::Pass));
    }

    // ── CapabilityGap precedence (D-13) ──────────────────────────────────────

    #[test]
    fn capability_gap_precedes_refusal() {
        let v = intercept_assistant_output(
            "I cannot directly post — I'd need a Slack integration to do that.",
        );
        match v {
            EgoVerdict::CapabilityGap { capability, .. } => {
                assert!(!capability.is_empty(), "expected non-empty capability");
                assert_eq!(capability.to_lowercase(), "slack");
            }
            v => panic!("expected CapabilityGap, got {v:?}"),
        }
    }

    #[test]
    fn capability_gap_extracts_capability_noun() {
        let v = intercept_assistant_output("To do that, I'd need a GitHub tool.");
        match v {
            EgoVerdict::CapabilityGap { capability, .. } => {
                assert_eq!(capability.to_lowercase(), "github");
            }
            v => panic!("expected CapabilityGap, got {v:?}"),
        }
    }

    // ── Non-ASCII (uses safe_slice on lookahead boundary cross) ──────────────

    #[test]
    fn safe_slice_used_on_long_content() {
        let long_unicode = "🦀".repeat(500);
        let v = intercept_assistant_output(&long_unicode);
        assert!(matches!(v, EgoVerdict::Pass));
    }

    #[test]
    fn skeleton_compiles() {
        let v = intercept_assistant_output("anything mundane");
        assert!(matches!(v, EgoVerdict::Pass));
    }

    #[test]
    fn reset_retry_works() {
        RETRY_COUNT.store(5, Ordering::SeqCst);
        reset_retry_for_turn();
        assert_eq!(RETRY_COUNT.load(Ordering::SeqCst), 0);
    }
}
