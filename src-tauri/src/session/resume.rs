// src-tauri/src/session/resume.rs
//
// Phase 34 / SESS-02 — Session resume from compaction boundary.
//
// Plan 34-03 ships the ResumedConversation struct + load_session stub.
// Plan 34-09 fills the body (JSONL replay halting at most-recent
// CompactionBoundary, [Earlier conversation summary] reuse, corrupt-line
// skip discipline).

use serde::{Deserialize, Serialize};

// Note: ConversationMessage (providers::mod) does NOT derive
// Serialize/Deserialize, so it cannot live directly inside ResumedConversation
// (which crosses the Tauri IPC boundary). Plan 34-09 (load_session body) will
// convert ConversationMessage → serde_json::Value at the boundary, mirroring
// the existing brain.rs convention. Plan 34-03 stores the messages as
// Vec<serde_json::Value> so the IPC type is fixed now and Wave 2-5 plans don't
// need to change this struct.

/// SESS-02 — return shape of `resume_session` Tauri command.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResumedConversation {
    pub session_id: String,
    /// Vec<ConversationMessage> serialized as plain JSON for Tauri transport;
    /// the frontend receives this as a list of {role, content} objects via
    /// the existing serialisation that brain.rs uses today.
    pub messages: Vec<serde_json::Value>,
    /// JSONL line index of the most-recent CompactionBoundary, or None if
    /// the session has no boundary yet.
    pub last_compaction_boundary_at: Option<usize>,
}

/// SESS-02 — read a JSONL file, replay events into a Vec<ConversationMessage>
/// halting at the most-recent CompactionBoundary. Plan 34-03 ships a STUB
/// returning Err("not implemented"); Plan 34-09 fills the body.
#[allow(dead_code)]
pub fn load_session(_path: &std::path::Path, _session_id: &str)
    -> Result<ResumedConversation, String>
{
    Err("Plan 34-03 stub — Plan 34-09 fills load_session".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn phase34_load_session_stub_returns_err() {
        let r = load_session(std::path::Path::new("/tmp/nonexistent"), "x");
        assert!(r.is_err(), "Plan 34-03 stub returns Err");
    }
}
