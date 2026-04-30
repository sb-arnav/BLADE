//! gmail_outbound.rs — Gmail send write path (OAuth or MCP)
//!
//! Phase 18 (chat-first reinterpretation) — see 18-CONTEXT.md D-05 (priority-1 native tentacle).
//! Wave 0 skeleton: Tauri command + return shape + test stub.
//! Body (MCP detection + Gmail API HTTP send) lands in Plan 13.

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendResult {
    pub id: String,
    pub thread_id: String,
}

/// Send a Gmail message. Tauri command per CONTEXT D-05.
/// Wave 0 skeleton — Plan 13 implements the MCP-first / Gmail API HTTP-fallback body.
#[tauri::command]
pub async fn gmail_outbound_send(
    _app: AppHandle,
    to: String,
    subject: String,
    body: String,
) -> Result<SendResult, String> {
    crate::ecosystem::assert_observe_only_allowed("gmail", "send_message")?;
    let _ = (to, subject, body);
    Err("[gmail_outbound] not yet implemented (Wave 0 skeleton)".to_string())
}

#[cfg(test)]
mod tests {
    #[tokio::test]
    async fn skeleton_returns_not_implemented() {
        // Real tests land in Plan 13:
        //  - mcp_path_when_registered (Gmail MCP detected)
        //  - http_fallback_via_oauth_token
        //  - hard_fail_on_missing_creds (D-10)
        //  - 401-handling routes to "reconnect Gmail" (Phase 18 best-effort; OAuth refresh deferred to v1.3)
    }
}
