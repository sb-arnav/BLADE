//! slack_outbound.rs — Slack chat.postMessage write path
//!
//! Phase 18 (chat-first reinterpretation) — see 18-CONTEXT.md D-05 (priority-1 native tentacle)
//! and 18-RESEARCH.md § Cold-Install Demo Viability (Slack as primary demo target).
//! Wave 0 skeleton: Tauri command + return shape + test stub.
//! Body (MCP-or-HTTP fallback) lands in Plan 11.

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PostResult {
    pub ts: String,
    pub channel: String,
    pub ok: bool,
}

/// Post a message to a Slack channel. Tauri command per CONTEXT D-05.
/// Wave 0 skeleton — Plan 11 implements the MCP-first / HTTP-fallback body.
#[tauri::command]
pub async fn slack_outbound_post_message(
    _app: AppHandle,
    channel: String,
    text: String,
) -> Result<PostResult, String> {
    crate::ecosystem::assert_observe_only_allowed("slack", "post_message")?;
    let _ = (channel, text);
    Err("[slack_outbound] not yet implemented (Wave 0 skeleton)".to_string())
}

#[cfg(test)]
mod tests {
    #[tokio::test]
    async fn skeleton_returns_not_implemented() {
        // Real tests land in Plan 11:
        //  - mcp_path_when_registered (Slack MCP detected)
        //  - http_fallback_when_no_mcp
        //  - hard_fail_on_missing_creds (D-10)
        //  - assert_observe_only_allowed gates the call
        // Wave 0: just confirm the skeleton compiles and gates on observe_only.
    }
}
