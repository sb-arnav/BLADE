// src-tauri/src/session/resume.rs
//
// Phase 34 / SESS-02 — Session resume from compaction boundary.
//
// Plan 34-03 ships the ResumedConversation struct + load_session stub.
// Plan 34-09 fills the body (JSONL replay halting at most-recent
// CompactionBoundary, [Earlier conversation summary] reuse, corrupt-line
// skip discipline).

use serde::{Deserialize, Serialize};
use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::Path;

use crate::session::log::SessionEvent;

// Note: ConversationMessage (providers::mod) does NOT derive
// Serialize/Deserialize, so it cannot live directly inside ResumedConversation
// (which crosses the Tauri IPC boundary). Plan 34-03 stores the messages as
// Vec<serde_json::Value> so the IPC type is fixed now and Wave 2-5 plans
// don't need to change this struct. Plan 34-09 emits the standard
// {"role": "...", "content": "..."} shape used by every Tauri stream emit
// site in commands.rs (see L1235, L1681, L2904 — same canonical shape).

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

/// SESS-02 — read a JSONL file, replay events into a Vec<message-json>
/// halting at the most-recent CompactionBoundary. Corrupt lines are skipped
/// with eprintln (no panic, no surface). Missing file → Err.
///
/// CONTEXT lock §SESS-02:
///   - Replay stops at most-recent CompactionBoundary.
///   - Everything before collapses into [Earlier conversation summary]\n{summary}
///     (Phase 32-04 exact format from commands.rs:459).
///   - Tool call results that were CAPPED by Phase 32 CTX-05 stay capped on
///     resume (the JSONL stores the truncated form).
///   - Resume does NOT replay halt reasons or loop events.
///   - Auto-resume on app boot is configurable via SessionConfig.auto_resume_last
///     (delegated to Plan 34-10's resume_session Tauri command + frontend hook).
///   - Resume failure is graceful — corrupt JSONL skipped, missing file → Err.
///
/// Validation note: the path is constructed by the Tauri command (Plan 34-10)
/// from `validate_session_id`-confirmed ID + jsonl_log_dir; load_session itself
/// trusts the path. Threat T-34-37 (HaltReason replay regression) is guarded
/// by `phase34_sess_02_resume_skips_halt_and_loop_events`.
pub fn load_session(path: &Path, session_id: &str) -> Result<ResumedConversation, String> {
    let f = File::open(path).map_err(|e| format!("open {}: {}", path.display(), e))?;
    let reader = BufReader::new(f);
    let mut events: Vec<SessionEvent> = Vec::new();
    for line in reader.lines() {
        let line = match line {
            Ok(l) => l,
            Err(e) => {
                eprintln!("[SESS-02] read line error: {}", e);
                continue;
            }
        };
        if line.trim().is_empty() {
            continue;
        }
        match serde_json::from_str::<SessionEvent>(&line) {
            Ok(e) => events.push(e),
            Err(e) => {
                eprintln!("[SESS-02] skip corrupt line: {}", e);
                continue;
            }
        }
    }

    // Find the most-recent CompactionBoundary; everything BEFORE it collapses
    // into a synthetic [Earlier conversation summary] User message.
    let last_boundary_idx = events
        .iter()
        .rposition(|e| matches!(e, SessionEvent::CompactionBoundary { .. }));

    let mut messages: Vec<serde_json::Value> = Vec::new();
    let start_idx = match last_boundary_idx {
        Some(i) => {
            if let SessionEvent::CompactionBoundary {
                summary_first_chars, ..
            } = &events[i]
            {
                // Phase 32-04 exact format (commands.rs:459)
                messages.push(serde_json::json!({
                    "role": "user",
                    "content": format!("[Earlier conversation summary]\n{}", summary_first_chars),
                }));
            }
            i + 1
        }
        None => 0,
    };

    for ev in &events[start_idx..] {
        match ev {
            SessionEvent::UserMessage { content, .. } => {
                messages.push(serde_json::json!({
                    "role": "user",
                    "content": content,
                }));
            }
            SessionEvent::AssistantTurn { content, .. } => {
                // tool_calls re-derivation is v1.6+ work (CONTEXT lock §SESS-02);
                // resumed AssistantTurns have empty tool_calls. The model sees
                // subsequent ToolCall events for context.
                messages.push(serde_json::json!({
                    "role": "assistant",
                    "content": content,
                    "tool_calls": [],
                }));
            }
            SessionEvent::ToolCall {
                name,
                result,
                error,
                ..
            } => {
                let content = result
                    .clone()
                    .or_else(|| error.clone())
                    .unwrap_or_default();
                messages.push(serde_json::json!({
                    "role": "tool",
                    "tool_name": name,
                    "content": content,
                    "is_error": error.is_some(),
                }));
            }
            // HaltReason / LoopEvent / CompactionBoundary / SessionMeta — NOT replayed.
            // Forensic-only per CONTEXT lock §SESS-02.
            // UserWithImage variant is NOT recorded by SessionWriter (Plan 34-08
            // emits UserMessage only); resume drops image content. v1.6+
            // limitation documented in 34-09-SUMMARY.md.
            _ => {}
        }
    }

    Ok(ResumedConversation {
        session_id: session_id.to_string(),
        messages,
        last_compaction_boundary_at: last_boundary_idx,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::session::log::SessionEvent;
    use std::io::Write;

    fn tmp_jsonl(label: &str, events: &[SessionEvent]) -> std::path::PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.subsec_nanos())
            .unwrap_or(0);
        let p = std::env::temp_dir().join(format!(
            "blade-sess-resume-{}-{}-{}.jsonl",
            label,
            std::process::id(),
            nanos
        ));
        let _ = std::fs::remove_file(&p);
        let mut f = std::fs::File::create(&p).expect("create");
        for e in events {
            let line = serde_json::to_string(e).expect("serialize");
            f.write_all(line.as_bytes()).expect("write");
            f.write_all(b"\n").expect("write");
        }
        p
    }

    #[test]
    fn phase34_sess_02_resume_from_compaction_boundary() {
        let events = vec![
            SessionEvent::SessionMeta {
                id: "01XX".into(),
                parent: None,
                fork_at_index: None,
                started_at_ms: 0,
            },
            SessionEvent::UserMessage {
                id: "u1".into(),
                content: "old1".into(),
                timestamp_ms: 1,
            },
            SessionEvent::AssistantTurn {
                content: "old assistant".into(),
                tool_calls: vec![],
                stop_reason: None,
                tokens_in: 5,
                tokens_out: 5,
                timestamp_ms: 2,
            },
            SessionEvent::CompactionBoundary {
                kept_message_count: 2,
                summary_first_chars: "earlier convo about X".into(),
                timestamp_ms: 3,
            },
            SessionEvent::UserMessage {
                id: "u2".into(),
                content: "post-boundary user".into(),
                timestamp_ms: 4,
            },
            SessionEvent::AssistantTurn {
                content: "post-boundary assistant".into(),
                tool_calls: vec![],
                stop_reason: None,
                tokens_in: 5,
                tokens_out: 5,
                timestamp_ms: 5,
            },
            SessionEvent::ToolCall {
                name: "read_file".into(),
                args: serde_json::json!({"path":"/tmp"}),
                result: Some("file contents".into()),
                error: None,
                timestamp_ms: 6,
            },
            SessionEvent::HaltReason {
                reason: "Cancelled".into(),
                payload: serde_json::json!({}),
                timestamp_ms: 7,
            },
        ];
        let p = tmp_jsonl("compaction", &events);
        let r = load_session(&p, "01XX").expect("load");
        let _ = std::fs::remove_file(&p);

        assert_eq!(
            r.messages.len(),
            4,
            "expected 4 messages: synthetic-summary + post-boundary user + assistant + tool"
        );
        // Synthetic summary at index 0
        let m0 = &r.messages[0];
        assert_eq!(m0["role"], "user");
        let content0 = m0["content"].as_str().expect("string content");
        assert!(
            content0.starts_with("[Earlier conversation summary]\n"),
            "first message must use Phase 32-04 format; got: {}",
            content0
        );
        assert!(content0.contains("earlier convo about X"));
        // Post-boundary user
        assert_eq!(r.messages[1]["role"], "user");
        assert_eq!(r.messages[1]["content"], "post-boundary user");
        // Post-boundary assistant
        assert_eq!(r.messages[2]["role"], "assistant");
        assert_eq!(r.messages[2]["content"], "post-boundary assistant");
        // Tool
        assert_eq!(r.messages[3]["role"], "tool");
        assert_eq!(r.messages[3]["tool_name"], "read_file");
        assert_eq!(r.messages[3]["content"], "file contents");
        assert_eq!(r.messages[3]["is_error"], false);
        // last_compaction_boundary_at populated (index of the boundary in events vec)
        assert!(r.last_compaction_boundary_at.is_some());
    }

    #[test]
    fn phase34_sess_02_resume_no_boundary_returns_full_history() {
        let events = vec![
            SessionEvent::SessionMeta {
                id: "01YY".into(),
                parent: None,
                fork_at_index: None,
                started_at_ms: 0,
            },
            SessionEvent::UserMessage {
                id: "u1".into(),
                content: "first user".into(),
                timestamp_ms: 1,
            },
            SessionEvent::AssistantTurn {
                content: "first assistant".into(),
                tool_calls: vec![],
                stop_reason: None,
                tokens_in: 5,
                tokens_out: 5,
                timestamp_ms: 2,
            },
            SessionEvent::UserMessage {
                id: "u2".into(),
                content: "second user".into(),
                timestamp_ms: 3,
            },
            SessionEvent::AssistantTurn {
                content: "second assistant".into(),
                tool_calls: vec![],
                stop_reason: None,
                tokens_in: 5,
                tokens_out: 5,
                timestamp_ms: 4,
            },
        ];
        let p = tmp_jsonl("no-boundary", &events);
        let r = load_session(&p, "01YY").expect("load");
        let _ = std::fs::remove_file(&p);

        assert_eq!(r.messages.len(), 4, "expected 4 messages, no synthetic stub");
        assert!(r.last_compaction_boundary_at.is_none());
        // SessionMeta is NOT replayed; the first replayed message is the
        // first UserMessage event (index 1 in the events vec).
        assert_eq!(r.messages[0]["role"], "user");
        assert_eq!(r.messages[0]["content"], "first user");
    }

    #[test]
    fn phase34_sess_02_resume_corrupt_line_skipped() {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.subsec_nanos())
            .unwrap_or(0);
        let p = std::env::temp_dir().join(format!(
            "blade-sess-resume-corrupt-{}-{}.jsonl",
            std::process::id(),
            nanos
        ));
        let _ = std::fs::remove_file(&p);
        let mut f = std::fs::File::create(&p).expect("create");
        // Valid event
        let e1 = SessionEvent::UserMessage {
            id: "u1".into(),
            content: "first".into(),
            timestamp_ms: 1,
        };
        let line1 = serde_json::to_string(&e1).expect("serialize");
        f.write_all(line1.as_bytes()).unwrap();
        f.write_all(b"\n").unwrap();
        // Garbage line
        f.write_all(b"this is not valid json {{{").unwrap();
        f.write_all(b"\n").unwrap();
        // Valid event
        let e2 = SessionEvent::UserMessage {
            id: "u2".into(),
            content: "second".into(),
            timestamp_ms: 2,
        };
        let line2 = serde_json::to_string(&e2).expect("serialize");
        f.write_all(line2.as_bytes()).unwrap();
        f.write_all(b"\n").unwrap();
        drop(f);
        let r = load_session(&p, "01ZZ").expect("load (corrupt line skipped)");
        let _ = std::fs::remove_file(&p);
        assert_eq!(
            r.messages.len(),
            2,
            "must skip corrupt line; expected 2 messages"
        );
        assert_eq!(r.messages[0]["content"], "first");
        assert_eq!(r.messages[1]["content"], "second");
    }

    #[test]
    fn phase34_sess_02_resume_missing_file_returns_err() {
        let r = load_session(
            std::path::Path::new("/tmp/blade-nonexistent-xyz-no-such-path.jsonl"),
            "01XX",
        );
        assert!(r.is_err(), "missing file must surface as Err");
    }

    #[test]
    fn phase34_sess_02_resume_uses_phase32_summary_format() {
        let events = vec![SessionEvent::CompactionBoundary {
            kept_message_count: 0,
            summary_first_chars: "test summary".into(),
            timestamp_ms: 1,
        }];
        let p = tmp_jsonl("format", &events);
        let r = load_session(&p, "01AA").expect("load");
        let _ = std::fs::remove_file(&p);
        assert_eq!(r.messages.len(), 1);
        let m0 = &r.messages[0];
        assert_eq!(m0["role"], "user");
        assert_eq!(
            m0["content"], "[Earlier conversation summary]\ntest summary",
            "synthetic message must use Phase 32-04 exact format"
        );
    }

    #[test]
    fn phase34_sess_02_resume_skips_halt_and_loop_events() {
        // T-34-37 guard: HaltReason / LoopEvent must NEVER be replayed as
        // ConversationMessage entries. Forensic-only per CONTEXT lock §SESS-02.
        let events = vec![
            SessionEvent::UserMessage {
                id: "u1".into(),
                content: "u1".into(),
                timestamp_ms: 0,
            },
            SessionEvent::HaltReason {
                reason: "Stuck".into(),
                payload: serde_json::json!({}),
                timestamp_ms: 1,
            },
            SessionEvent::LoopEvent {
                kind: "stuck_detected".into(),
                payload: serde_json::json!({}),
                timestamp_ms: 2,
            },
            SessionEvent::AssistantTurn {
                content: "a1".into(),
                tool_calls: vec![],
                stop_reason: None,
                tokens_in: 0,
                tokens_out: 0,
                timestamp_ms: 3,
            },
        ];
        let p = tmp_jsonl("skip-halt", &events);
        let r = load_session(&p, "01BB").expect("load");
        let _ = std::fs::remove_file(&p);
        assert_eq!(
            r.messages.len(),
            2,
            "HaltReason + LoopEvent must NOT be replayed; expected 2 messages (User + Assistant)"
        );
        assert_eq!(r.messages[0]["role"], "user");
        assert_eq!(r.messages[1]["role"], "assistant");
    }

    #[test]
    fn phase34_sess_02_resume_tool_call_error_marks_is_error() {
        // Sanity: ToolCall with error (not result) maps to is_error=true and
        // content = error message. Plan 34-09 must_haves §3 (ToolCall mapping).
        let events = vec![SessionEvent::ToolCall {
            name: "read_file".into(),
            args: serde_json::json!({"path":"/nonexistent"}),
            result: None,
            error: Some("ENOENT".into()),
            timestamp_ms: 1,
        }];
        let p = tmp_jsonl("tool-error", &events);
        let r = load_session(&p, "01CC").expect("load");
        let _ = std::fs::remove_file(&p);
        assert_eq!(r.messages.len(), 1);
        let m = &r.messages[0];
        assert_eq!(m["role"], "tool");
        assert_eq!(m["tool_name"], "read_file");
        assert_eq!(m["content"], "ENOENT");
        assert_eq!(m["is_error"], true);
    }
}
