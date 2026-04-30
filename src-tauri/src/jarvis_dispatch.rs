//! jarvis_dispatch.rs — outbound fan-out across native tentacles → MCP fallback → native_tools last
//!
//! Phase 18 (chat-first reinterpretation) — see 18-CONTEXT.md D-05 and
//! 18-RESEARCH.md § Dispatch Order Verdict (native-tentacle-FIRST).
//! Wave 0 skeleton: type contract + function skeleton + test stubs.
//! Body lands in Plan 14.
//!
//! NAMING: Tauri command is `jarvis_dispatch_action` (NOT `dispatch_action`)
//! because two private `dispatch_action` fns already exist in the tree
//! (action_tags.rs:84, goal_engine.rs:416 — both module-private, no Tauri-namespace
//! clash but greppability matters; PATTERNS.md § Pre-flight Namespace Check).

use serde::{Deserialize, Serialize};
use crate::intent_router::IntentClass;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum DispatchResult {
    Executed { service: String, payload: serde_json::Value },
    NoConsent,
    HardFailedNoCreds { service: String, suggestion: String },
    NotApplicable,
}

/// Wave 0 skeleton — Plan 14 implements the fan-out (native tentacle → MCP → native_tools)
/// + WriteScope acquisition + emit_jarvis_activity per D-17.
#[tauri::command]
pub async fn jarvis_dispatch_action(
    _app: tauri::AppHandle,
    _intent: IntentClass,
) -> Result<DispatchResult, String> {
    Ok(DispatchResult::NotApplicable)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn skeleton_returns_not_applicable() {
        // Real tests land in Plan 14:
        //  - routes_to_native_tentacle (Slack ActionRequired → slack_outbound_post_message)
        //  - mcp_fallback (when no native tentacle exists)
        //  - hard_fail_no_creds (D-10)
        //  - emits_activity_log (one entry per outcome — D-17)
        //  - WriteScope acquired before tentacle call, dropped after
    }
}
