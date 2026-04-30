//! intent_router.rs body — heuristic-first / LLM-fallback (D-04).
//!
//! Phase 18 (chat-first reinterpretation) — see 18-CONTEXT.md D-03 (parallel to TaskType)
//! and D-04 (heuristic-first, LLM-fallback).
//!
//! Plan 18-06 fills the Wave 0 skeleton with the heuristic-first body.
//! D-04 Step 2 (LLM-fallback) is DEFERRED to v1.3 per Plan 14 path B and 18-DEFERRAL.md —
//! heuristic-only suffices for v1.2 cold-install demo prompts. The hook
//! `classify_intent_llm` exists for v1.3 wiring; it returns None unconditionally in v1.2.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum IntentClass {
    ChatOnly,
    ActionRequired { service: String, action: String },
}

const ACTION_VERBS: &[&str] = &["post", "send", "create", "update", "comment", "draft", "reply"];

const SERVICES: &[(&str, &str)] = &[
    ("slack", "slack"),
    ("github", "github"),
    ("gmail", "gmail"),
    ("email", "gmail"), // alias — many users say "send email" meaning gmail
    ("calendar", "calendar"),
    ("linear", "linear"),
];

/// Heuristic-first classifier (D-04). Tier 1: action verb × service token.
/// Tier 2: LLM-fallback DEFERRED to v1.3 per Plan 14 path B and 18-DEFERRAL.md.
/// Tier 1 short-circuits ≥80% of inputs (RESEARCH § Anti-Patterns lock).
pub async fn classify_intent(message: &str) -> IntentClass {
    let lower = message.to_lowercase();

    // Tier 1: heuristic — action verb AND service token must both be present.
    if let Some((verb, service)) = match_heuristic(&lower) {
        return IntentClass::ActionRequired {
            service: service.to_string(),
            action: verb.to_string(),
        };
    }

    // Tier 2: LLM-fallback DEFERRED to v1.3 per Plan 14 path B and 18-DEFERRAL.md.
    // The hook exists; the body returns None unconditionally in v1.2.
    // Heuristic-only covers all cold-install demo prompts.
    classify_intent_llm(message)
        .await
        .unwrap_or(IntentClass::ChatOnly)
}

fn match_heuristic(lower: &str) -> Option<(&'static str, &'static str)> {
    for verb in ACTION_VERBS {
        if lower.contains(verb) {
            for (token, service) in SERVICES {
                if lower.contains(token) {
                    return Some((verb, service));
                }
            }
        }
    }
    None
}

/// Tier-2 LLM-fallback. Phase 18 ships a stub that returns None unconditionally.
/// D-04 Step 2 LLM-fallback DEFERRED to v1.3 per Plan 14 path B (see 18-DEFERRAL.md).
/// v1.3 wires the actual cheap-model call via `crate::router::select_provider`
/// when operator UAT surfaces heuristic miss-rate as a real friction.
async fn classify_intent_llm(_message: &str) -> Option<IntentClass> {
    None
}

#[tauri::command]
pub async fn intent_router_classify(message: String) -> IntentClass {
    classify_intent(&message).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn classify_chat_only_for_greeting() {
        let v = classify_intent("hello there how are you").await;
        assert_eq!(v, IntentClass::ChatOnly);
    }

    #[tokio::test]
    async fn classify_action_required_slack() {
        let v = classify_intent("post 'shipping today' to #team in Slack").await;
        match v {
            IntentClass::ActionRequired { service, action } => {
                assert_eq!(service, "slack");
                assert_eq!(action, "post");
            }
            _ => panic!("expected ActionRequired/slack/post, got {v:?}"),
        }
    }

    #[tokio::test]
    async fn classify_action_required_linear() {
        let v = classify_intent("create a Linear issue: test JARVIS demo from Phase 18").await;
        match v {
            IntentClass::ActionRequired { service, action } => {
                assert_eq!(service, "linear");
                assert_eq!(action, "create");
            }
            _ => panic!("expected ActionRequired/linear/create, got {v:?}"),
        }
    }

    #[tokio::test]
    async fn classify_action_required_gmail_via_email_alias() {
        let v = classify_intent("send an email to alice about the launch").await;
        match v {
            IntentClass::ActionRequired { service, action } => {
                assert_eq!(service, "gmail");
                assert_eq!(action, "send");
            }
            _ => panic!("expected ActionRequired/gmail/send, got {v:?}"),
        }
    }

    #[tokio::test]
    async fn classify_action_required_github_comment() {
        let v = classify_intent("comment on the GitHub PR with my review").await;
        match v {
            IntentClass::ActionRequired { service, action } => {
                assert_eq!(service, "github");
                assert_eq!(action, "comment");
            }
            _ => panic!("expected ActionRequired/github/comment, got {v:?}"),
        }
    }

    #[tokio::test]
    async fn classify_action_required_calendar_create() {
        let v = classify_intent("create a calendar event for tomorrow at 3pm").await;
        match v {
            IntentClass::ActionRequired { service, action } => {
                assert_eq!(service, "calendar");
                assert_eq!(action, "create");
            }
            _ => panic!("expected ActionRequired/calendar/create, got {v:?}"),
        }
    }

    #[tokio::test]
    async fn capitalization_invariant() {
        let v = classify_intent("POST a message to Slack").await;
        match v {
            IntentClass::ActionRequired { service, action } => {
                assert_eq!(service, "slack");
                assert_eq!(action, "post");
            }
            _ => panic!("capitalization should not affect classification"),
        }
    }

    #[tokio::test]
    async fn heuristic_short_circuits_fast() {
        // If Tier 1 matches, Tier 2 LLM-fallback should NOT be invoked.
        // Indirect test: a message that matches Tier 1 returns deterministically
        // (no async wait beyond the immediate match).
        let start = std::time::Instant::now();
        let _ = classify_intent("post to Slack").await;
        let elapsed = start.elapsed();
        // Tier 1 should complete in under 50ms; Tier 2 (if invoked) would be much slower.
        assert!(
            elapsed.as_millis() < 50,
            "heuristic should short-circuit; took {}ms",
            elapsed.as_millis()
        );
    }

    #[tokio::test]
    async fn no_action_verb_returns_chat_only() {
        // Service token alone (no action verb) → ChatOnly
        let v = classify_intent("tell me about slack as a company").await;
        assert_eq!(v, IntentClass::ChatOnly);
    }

    #[tokio::test]
    async fn no_service_token_returns_chat_only() {
        // Action verb alone (no service token) → ChatOnly
        let v = classify_intent("post-modernism is an art movement").await;
        // 'post' verb hits but no service token, so ChatOnly is expected.
        assert_eq!(v, IntentClass::ChatOnly);
    }
}
