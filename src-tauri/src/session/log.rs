// src-tauri/src/session/log.rs
//
// Phase 34 / SESS-01 — Append-only JSONL conversation log.
//
// Plan 34-03 ships:
//   - SessionEvent enum (7 variants)
//   - ToolCallSnippet struct
//   - SessionWriter struct with stub new + append (no-ops)
//   - SESS_FORCE_APPEND_PANIC test seam
//
// Plan 34-08 fills the bodies (ULID generation, flock-protected append,
// rotation policy, panic handling).

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// Compact tool-call summary for AssistantTurn events.
/// Full args are recorded as a separate ToolCall event.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ToolCallSnippet {
    pub name: String,
    pub args_excerpt: String,
}

/// SESS-01 — append-only event log entries. JSONL line format:
///   {"kind": "user_message", "data": {...}}
/// 7 variants per CONTEXT lock §Append-Only JSONL Session Log:
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", content = "data")]
pub enum SessionEvent {
    /// First event in every JSONL file. Carries fork attribution for SESS-04.
    SessionMeta {
        id: String,
        parent: Option<String>,
        fork_at_index: Option<u32>,
        started_at_ms: u64,
    },
    UserMessage {
        id: String,
        content: String,
        timestamp_ms: u64,
    },
    AssistantTurn {
        content: String,
        tool_calls: Vec<ToolCallSnippet>,
        stop_reason: Option<String>,
        tokens_in: u32,
        tokens_out: u32,
        timestamp_ms: u64,
    },
    ToolCall {
        name: String,
        args: serde_json::Value,
        result: Option<String>,
        error: Option<String>,
        timestamp_ms: u64,
    },
    /// Phase 32-04 fires `[Earlier conversation summary]\n{summary}` as a
    /// synthetic User message; SESS-01 records the boundary so SESS-02 resume
    /// can replay everything FROM the boundary forward (the summary stub
    /// substitutes for everything before).
    CompactionBoundary {
        kept_message_count: u32,
        summary_first_chars: String,
        timestamp_ms: u64,
    },
    /// Every LoopHaltReason variant writes one of these on halt.
    HaltReason {
        reason: String,
        payload: serde_json::Value,
        timestamp_ms: u64,
    },
    /// Mirrors blade_loop_event for full-fidelity replay of stuck/circuit/cost
    /// events. Recorded for forensics; NOT replayed by SESS-02 (per CONTEXT lock).
    LoopEvent {
        kind: String,
        payload: serde_json::Value,
        timestamp_ms: u64,
    },
}

/// SESS-01 — atomic append-only writer. One per session_id. The path stays
/// constant for the conversation lifetime; the file grows monotonically.
///
/// Plan 34-03 ships the STUB. Plan 34-08 fills `new` + `append`.
#[allow(dead_code)]
pub struct SessionWriter {
    pub(crate) path: PathBuf,
    pub(crate) enabled: bool,
}

impl SessionWriter {
    /// Plan 34-03 STUB. Plan 34-08 replaces with real ULID generation +
    /// directory creation + rotation enforcement.
    ///
    /// Returns (writer, session_id) or Err on filesystem failure when
    /// enabled=true. When enabled=false, returns Ok with a no-op writer
    /// (no file created; ID is still generated for forensic continuity
    /// in case the user later toggles logging on).
    #[allow(dead_code)]
    pub fn new(_jsonl_log_dir: &std::path::Path, enabled: bool) -> std::io::Result<(Self, String)> {
        Ok((Self {
            path: PathBuf::new(),
            enabled,
        }, "00000000000000000000000000".to_string()))  // STUB ID
    }

    /// Plan 34-03 STUB. Plan 34-08 fills with flock-protected append +
    /// catch_unwind discipline + SESS_FORCE_APPEND_PANIC seam check.
    #[allow(dead_code)]
    pub fn append(&self, _event: &SessionEvent) {
        // Stub no-op.
    }
}

/// Plan 34-08 test seam — when set to true, SessionWriter::append panics.
/// Used to assert catch_unwind discipline (panic in append must NOT crash
/// the chat). Mirrors loop_engine::FORCE_VERIFY_PANIC (Plan 33-09).
#[cfg(test)]
thread_local! {
    pub(crate) static SESS_FORCE_APPEND_PANIC: std::cell::Cell<bool> =
        const { std::cell::Cell::new(false) };
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn phase34_session_event_serde_roundtrip_user_message() {
        let e = SessionEvent::UserMessage {
            id: "msg-1".to_string(),
            content: "hello".to_string(),
            timestamp_ms: 1234,
        };
        let json = serde_json::to_string(&e).expect("serialize");
        let parsed: serde_json::Value = serde_json::from_str(&json).expect("parse value");
        assert_eq!(parsed["kind"], "UserMessage");
        assert_eq!(parsed["data"]["content"], "hello");
    }

    #[test]
    fn phase34_session_event_serde_roundtrip_compaction_boundary() {
        let e = SessionEvent::CompactionBoundary {
            kept_message_count: 5,
            summary_first_chars: "earlier convo about X".to_string(),
            timestamp_ms: 5678,
        };
        let json = serde_json::to_string(&e).expect("serialize");
        let parsed: serde_json::Value = serde_json::from_str(&json).expect("parse value");
        assert_eq!(parsed["kind"], "CompactionBoundary");
        assert_eq!(parsed["data"]["kept_message_count"], 5);
    }

    #[test]
    fn phase34_session_event_all_seven_variants_serialize() {
        let events = vec![
            SessionEvent::SessionMeta { id: "x".into(), parent: None, fork_at_index: None, started_at_ms: 0 },
            SessionEvent::UserMessage { id: "u".into(), content: "c".into(), timestamp_ms: 0 },
            SessionEvent::AssistantTurn {
                content: "a".into(), tool_calls: vec![], stop_reason: None,
                tokens_in: 0, tokens_out: 0, timestamp_ms: 0,
            },
            SessionEvent::ToolCall {
                name: "t".into(), args: serde_json::json!({}),
                result: None, error: None, timestamp_ms: 0,
            },
            SessionEvent::CompactionBoundary { kept_message_count: 0, summary_first_chars: "s".into(), timestamp_ms: 0 },
            SessionEvent::HaltReason { reason: "r".into(), payload: serde_json::json!({}), timestamp_ms: 0 },
            SessionEvent::LoopEvent { kind: "k".into(), payload: serde_json::json!({}), timestamp_ms: 0 },
        ];
        for e in &events {
            let _json = serde_json::to_string(e).expect("each variant must serialize");
        }
    }

    #[test]
    fn phase34_session_writer_stub_construct() {
        let tmp = std::path::Path::new("/tmp/blade-test-stub");
        let (writer, id) = SessionWriter::new(tmp, false).expect("stub new");
        assert!(!writer.enabled);
        assert_eq!(id.len(), 26, "stub returns 26-char ID; Plan 34-08 returns real ULID");
    }
}
