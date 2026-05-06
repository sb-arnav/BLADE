// src-tauri/src/session/list.rs
//
// Phase 34 / SESS-03 + SESS-04 — Session list + fork Tauri commands.
//
// Plan 34-03 ships SessionMeta struct + 4 Tauri command stubs.
// Plan 34-10 fills:
//   - list_sessions: walk jsonl_log_dir, parse each *.jsonl's first ~5 events,
//     extract SessionMeta, return sorted desc by started_at_ms
//   - resume_session: validate session_id, delegate to resume::load_session
//   - fork_session: validate parent_id, copy events up to fork_at_message_index,
//     prepend SessionMeta, write to new ULID
//   - get_conversation_cost: read JSONL, sum cost_update LoopEvent payloads

use serde::{Deserialize, Serialize};

/// SESS-03 — frontend-facing session metadata. Distinct from the
/// SessionEvent::SessionMeta variant (which only carries id/parent/etc, not
/// the message_count / approximate_tokens / first_message_excerpt fields).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionMeta {
    pub id: String,
    pub started_at_ms: u64,
    /// Count of UserMessage + AssistantTurn events in the JSONL.
    pub message_count: u32,
    /// safe_slice(first_user_message_content, 120).
    pub first_message_excerpt: String,
    /// Sum of (tokens_in + tokens_out) across AssistantTurn events.
    pub approximate_tokens: u32,
    /// Reason from most-recent HaltReason event, or None.
    pub halt_reason: Option<String>,
    /// Populated for forked sessions (SESS-04).
    pub parent: Option<String>,
}

/// SESS-03 — Tauri command. Plan 34-03 STUB returns empty vec. Plan 34-10 fills.
#[tauri::command]
pub async fn list_sessions() -> Result<Vec<SessionMeta>, String> {
    Ok(Vec::new())
}

/// SESS-02 — Tauri command. Plan 34-03 STUB returns Err. Plan 34-10 fills.
#[tauri::command]
pub async fn resume_session(_session_id: String)
    -> Result<crate::session::resume::ResumedConversation, String>
{
    Err("Plan 34-03 stub — Plan 34-10 fills body".to_string())
}

/// SESS-04 — Tauri command. Plan 34-03 STUB returns Err. Plan 34-10 fills.
#[tauri::command]
pub async fn fork_session(_parent_id: String, _fork_at_message_index: u32)
    -> Result<String, String>
{
    Err("Plan 34-03 stub — Plan 34-10 fills body".to_string())
}

/// RES-03 — Tauri command. Plan 34-03 STUB returns zeros. Plan 34-10 fills.
#[tauri::command]
pub async fn get_conversation_cost(_session_id: String)
    -> Result<serde_json::Value, String>
{
    Ok(serde_json::json!({
        "spent_usd": 0.0,
        "cap_usd": 25.0,
        "percent": 0.0
    }))
}

/// SESS-03 — validate that a session_id is a 26-char Crockford base32 ULID.
/// Rejects path-traversal, null bytes, slashes, etc. Plan 34-03 ships the
/// regex; Plan 34-10 wires it into every command body.
#[allow(dead_code)]
pub(crate) fn validate_session_id(id: &str) -> Result<(), String> {
    static RE: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    let re = RE.get_or_init(|| regex::Regex::new(r"^[0-9A-HJKMNP-TV-Z]{26}$").unwrap());
    if !re.is_match(id) {
        return Err(format!("invalid session id: {}", id));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn phase34_session_meta_serde_roundtrip() {
        let m = SessionMeta {
            id: "01ARZ3NDEKTSV4RRFFQ69G5FAV".to_string(),
            started_at_ms: 1234,
            message_count: 5,
            first_message_excerpt: "hello world".to_string(),
            approximate_tokens: 1000,
            halt_reason: Some("CostExceeded".to_string()),
            parent: None,
        };
        let json = serde_json::to_string(&m).expect("serialize");
        let parsed: SessionMeta = serde_json::from_str(&json).expect("parse");
        assert_eq!(parsed.id, m.id);
        assert_eq!(parsed.message_count, 5);
        assert_eq!(parsed.halt_reason, Some("CostExceeded".to_string()));
    }

    #[test]
    fn phase34_validate_session_id_accepts_ulid() {
        assert!(validate_session_id("01ARZ3NDEKTSV4RRFFQ69G5FAV").is_ok());
    }

    #[test]
    fn phase34_validate_session_id_rejects_traversal() {
        assert!(validate_session_id("../../etc/passwd").is_err());
        assert!(validate_session_id("..").is_err());
        assert!(validate_session_id("01ARZ3NDEKTSV4RRFFQ69G5FA/").is_err());
        assert!(validate_session_id("").is_err());
        assert!(validate_session_id("hello").is_err());
    }

    #[tokio::test]
    async fn phase34_list_sessions_stub_returns_empty() {
        let r = list_sessions().await.expect("stub returns Ok");
        assert!(r.is_empty());
    }
}
