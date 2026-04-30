//! intent_router.rs — IntentClass classification (chat vs cross-app action)
//!
//! Phase 18 (chat-first reinterpretation) — see 18-CONTEXT.md D-03 (parallel to TaskType)
//! and D-04 (heuristic-first, LLM-fallback).
//! Wave 0 skeleton: type contracts + function skeleton + test stubs.
//! Body lands in Plan 09.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum IntentClass {
    ChatOnly,
    ActionRequired { service: String, action: String },
}

/// Wave 0 skeleton — Plan 09 implements the heuristic-first / LLM-fallback body (D-04).
pub async fn classify_intent(_message: &str) -> IntentClass {
    IntentClass::ChatOnly
}

#[tauri::command]
pub async fn intent_router_classify(message: String) -> IntentClass {
    classify_intent(&message).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn skeleton_returns_chat_only() {
        let v = classify_intent("anything").await;
        assert_eq!(v, IntentClass::ChatOnly);
    }

    // Real test cases land in Plan 09:
    //  - classify_chat_only (returns ChatOnly for "hello world")
    //  - classify_action_required (returns ActionRequired{slack, post} for "post X to Slack")
    //  - heuristic_short_circuits (LLM-fallback NOT invoked when heuristic matches)
}
