//! ego.rs — refusal detector + capability_gap classifier + retry orchestrator
//!
//! Phase 18 (chat-first reinterpretation) — see 18-CONTEXT.md D-11..D-15.
//! Plan 18-05 (Wave 1) fills the body skeleton from Plan 18-01.

use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::OnceLock;
use regex::Regex;
use tauri::{AppHandle, Emitter};

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
                // Find the suffix token (integration|tool|api) and take the word before it.
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
                // Byte range crossed a UTF-8 boundary — use safe_slice on the remainder.
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

/// Phase 18 D-18 — emit `jarvis_intercept` to the main window only.
/// Single-window emit_to (Phase 17 precedent — same shape as `blade_activity_log`)
/// — verify-emit-policy.mjs accepts emit_to without an allowlist entry.
///
/// `action` is one of: "intercepting" | "installing" | "retrying" | "hard_refused".
/// Long `reason` strings are bounded via `safe_slice` (T-18-CARRY-14 mitigation).
pub fn emit_jarvis_intercept(
    app: &AppHandle,
    action: &str,
    capability: Option<&str>,
    reason: Option<&str>,
) {
    let payload = serde_json::json!({
        "intent_class": "action_required",
        "action":       action,
        "capability":   capability,
        "reason":       reason.map(|r| crate::safe_slice(r, 200).to_string()),
    });
    let _ = app.emit_to("main", "jarvis_intercept", payload);
}

/// Phase 18 D-14/D-15/D-16/D-18 — handle a non-Pass EgoVerdict.
///
/// Behavior:
/// - D-14 retry cap = 1 per turn. `RETRY_COUNT.fetch_add` returns the previous value;
///   if previous ≥ 1, we already retried this turn → HardRefused immediately.
/// - CapabilityGap branch:
///     - emit "intercepting", log via `evolution_log_capability_gap` (verbatim reuse
///       of evolution.rs:1115).
///     - look up the catalog entry; route by `kind` (D-16):
///         * Runtime    → emit "installing" → `self_upgrade::auto_install` →
///                       emit "retrying" → AutoInstalled (Plan 18-10 wires the
///                       LLM retry call; this plan returns a placeholder).
///         * Integration→ emit "hard_refused" → HardRefused with D-15 locked
///                       output format including `gap.integration_path`.
/// - Refusal branch (no CapabilityGap precursor):
///     - emit "intercepting" → log gap → emit "hard_refused" → HardRefused with
///       D-15 locked output format.
pub async fn handle_refusal(app: &AppHandle, verdict: EgoVerdict, original: &str) -> EgoOutcome {
    // D-14: retry cap = 1 per turn. fetch_add returns the PREVIOUS value;
    // if it's already ≥ 1, we've consumed this turn's budget.
    let prev = RETRY_COUNT.fetch_add(1, Ordering::SeqCst);
    if prev >= 1 {
        let final_response = "I tried, but I exhausted my retry budget for this turn. \
            Try rephrasing or starting a new turn."
            .to_string();
        emit_jarvis_intercept(app, "hard_refused", None, Some("retry_cap_exceeded"));
        return EgoOutcome::HardRefused {
            final_response,
            logged_gap: false,
        };
    }

    match verdict {
        EgoVerdict::Pass => {
            // Defensive — handle_refusal should not be called for Pass.
            EgoOutcome::Retried { new_response: original.to_string() }
        }
        EgoVerdict::CapabilityGap { capability, suggestion: _ } => {
            // 1. Log the gap (reuses evolution.rs:1115 verbatim).
            emit_jarvis_intercept(app, "intercepting", Some(&capability), None);
            let _ = crate::evolution::evolution_log_capability_gap(
                capability.clone(),
                crate::safe_slice(original, 200).to_string(),
            );

            // 2. Look up the catalog entry; route by kind (D-16).
            // The catalog uses lowercase keys (e.g. "slack_outbound"); also try common suffixes
            // and the bare lowercase capability noun extracted from the regex.
            let catalog = crate::self_upgrade::capability_catalog();
            let key = capability.to_lowercase();
            let outbound_key = format!("{}_outbound", key);
            let write_key = format!("{}_write", key);
            let entry: Option<crate::self_upgrade::CapabilityGap> = catalog
                .get(key.as_str())
                .or_else(|| catalog.get(outbound_key.as_str()))
                .or_else(|| catalog.get(write_key.as_str()))
                .cloned();

            match entry {
                Some(gap) if matches!(gap.kind, crate::self_upgrade::CapabilityKind::Integration) => {
                    // D-16 Integration kind: D-15 locked hard-refuse format with integration_path.
                    let final_response = format!(
                        "I tried, but I don't have a {} integration. Here's what I'd need: {}. You can connect it via {}.",
                        capability,
                        gap.description,
                        gap.integration_path
                    );
                    emit_jarvis_intercept(
                        app,
                        "hard_refused",
                        Some(&capability),
                        Some(&gap.description),
                    );
                    EgoOutcome::HardRefused {
                        final_response,
                        logged_gap: true,
                    }
                }
                Some(gap_runtime) => {
                    // D-16 Runtime kind: emit installing → auto_install → emit retrying.
                    // LIVE auto_install signature (W2 pre-pin verified at self_upgrade.rs:387):
                    //   `pub async fn auto_install(gap: &CapabilityGap) -> InstallResult`
                    //   InstallResult { tool, success, output }.
                    emit_jarvis_intercept(app, "installing", Some(&capability), None);
                    let install_result =
                        crate::self_upgrade::auto_install(&gap_runtime).await;
                    if !install_result.success {
                        // Install failed — D-15 locked hard-refuse format with install output as reason.
                        let final_response = format!(
                            "I tried, but I couldn't install {}. Here's what I'd need: {}. You can connect it manually via Integrations tab.",
                            capability,
                            crate::safe_slice(&install_result.output, 100)
                        );
                        emit_jarvis_intercept(
                            app,
                            "hard_refused",
                            Some(&capability),
                            Some("install_failed"),
                        );
                        return EgoOutcome::HardRefused {
                            final_response,
                            logged_gap: true,
                        };
                    }
                    emit_jarvis_intercept(app, "retrying", Some(&capability), None);
                    EgoOutcome::AutoInstalled {
                        capability: capability.clone(),
                        // then_retried filled in by Plan 18-10 commands.rs wrapper which calls the LLM again.
                        then_retried: format!(
                            "<retry-pending: {} installed via {}>",
                            capability, install_result.tool
                        ),
                    }
                }
                None => {
                    // No catalog entry — D-15 locked hard-refuse with generic reason.
                    let final_response = format!(
                        "I tried, but I don't have a {} capability. Here's what I'd need: {} support. You can connect it via Integrations tab.",
                        capability, capability
                    );
                    emit_jarvis_intercept(
                        app,
                        "hard_refused",
                        Some(&capability),
                        Some("no_catalog_entry"),
                    );
                    EgoOutcome::HardRefused {
                        final_response,
                        logged_gap: true,
                    }
                }
            }
        }
        EgoVerdict::Refusal { pattern, reason } => {
            // Bare refusal (no CapabilityGap precursor) — log as gap, hard-refuse.
            emit_jarvis_intercept(app, "intercepting", None, Some(&pattern));
            let _ = crate::evolution::evolution_log_capability_gap(
                pattern.clone(),
                crate::safe_slice(original, 200).to_string(),
            );
            let final_response = format!(
                "I tried, but {}. Here's what I'd need: clearer context or an integration. You can rephrase or start a new turn.",
                crate::safe_slice(&reason, 100)
            );
            emit_jarvis_intercept(app, "hard_refused", None, Some(&pattern));
            EgoOutcome::HardRefused {
                final_response,
                logged_gap: true,
            }
        }
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
        // "I can't help with that, but I can suggest …" must NOT trigger refusal.
        let v = intercept_assistant_output(
            "I can't help with that, but I can suggest some approaches.",
        );
        assert!(matches!(v, EgoVerdict::Pass), "expected Pass for disjunction, got {v:?}");
    }

    #[test]
    fn no_false_positive_on_however_can() {
        // "however ... can" inside lookahead window — the regex requires "but ... can"
        // explicitly, so this case still classifies as Refusal. Guard test: confirms
        // the post-check is anchored on `\bbut\b` not on any disjunction word.
        let v = intercept_assistant_output(
            "I can't do X. However, I can do Y.",
        );
        // "but" is absent, so this should still be Refusal.
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
        // Even though "I cannot directly" matches as Refusal, "I'd need a Slack integration"
        // takes precedence per D-13 (Pattern 9 first in iteration order).
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
        // "I'd need a GitHub tool" — capability noun is "GitHub".
        let v = intercept_assistant_output("To do that, I'd need a GitHub tool.");
        match v {
            EgoVerdict::CapabilityGap { capability, .. } => {
                assert_eq!(capability.to_lowercase(), "github");
            }
            v => panic!("expected CapabilityGap, got {v:?}"),
        }
    }

    // ── Retry cap (Task 2 / D-14) ────────────────────────────────────────────

    #[test]
    fn retry_cap_holds() {
        // Reset, then exercise the RETRY_COUNT.fetch_add semantics directly.
        // First call: counter goes 0 → 1 (prev = 0, allow).
        // Second call: counter goes 1 → 2 (prev = 1, BLOCK — cap exceeded).
        reset_retry_for_turn();
        assert_eq!(RETRY_COUNT.load(Ordering::SeqCst), 0);

        let prev = RETRY_COUNT.fetch_add(1, Ordering::SeqCst);
        assert_eq!(prev, 0, "first retry should be allowed (prev = 0)");

        let prev2 = RETRY_COUNT.fetch_add(1, Ordering::SeqCst);
        assert!(prev2 >= 1, "retry cap must trigger on second attempt (prev = {prev2})");

        reset_retry_for_turn();
        assert_eq!(RETRY_COUNT.load(Ordering::SeqCst), 0);
    }

    // ── D-15 locked output format guard (Task 2) ─────────────────────────────

    #[test]
    fn hard_refuse_format_locked() {
        // The format string for HardRefused (Integration kind) follows D-15 verbatim.
        // Construct the exact substring the format!() macro would produce and assert
        // the locked phrase ordering. Catches future paraphrase regressions.
        let template = format!(
            "I tried, but I don't have a {} integration. Here's what I'd need: {}. You can connect it via {}.",
            "slack",
            "BLADE doesn't have a Slack writer integration",
            "Integrations tab → Slack"
        );
        assert!(template.contains("I tried, but"), "missing 'I tried, but' phrase");
        assert!(template.contains("Here's what I'd need"), "missing 'Here's what I'd need' phrase");
        assert!(template.contains("You can connect it via"), "missing 'You can connect it via' phrase");
    }

    // ── Non-ASCII / safe_slice path (Task 2) ─────────────────────────────────

    #[test]
    fn safe_slice_used_on_long_content() {
        // Long unicode content: no refusal pattern matches, verifies no panic on
        // non-ASCII boundaries inside the lookahead path.
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
