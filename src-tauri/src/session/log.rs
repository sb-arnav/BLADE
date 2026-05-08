// src-tauri/src/session/log.rs
//
// Phase 34 / SESS-01 — Append-only JSONL conversation log.
//
// Plan 34-03 shipped:
//   - SessionEvent enum (7 variants)
//   - ToolCallSnippet struct
//   - SessionWriter struct with stub new + append (no-ops)
//   - SESS_FORCE_APPEND_PANIC test seam
//
// Plan 34-08 fills the bodies:
//   - SessionWriter::new       — generates real ULID, creates dir, runs rotation
//   - SessionWriter::append    — flock-protected atomic append wrapped in
//                                catch_unwind so any panic (serde fail, ENOSPC,
//                                permission denied) does NOT crash chat
//   - rotate_old_sessions      — moves oldest *.jsonl to {dir}/archive/ at the
//                                keep_n_sessions threshold (move, not delete)
//   - now_ms                   — monotonic UNIX-millis helper used by every
//                                emit site for timestamp_ms
//   - SessionWriter::no_op     — error-recovery handle (used by commands.rs
//                                when SessionWriter::new returns Err)

use serde::{Deserialize, Serialize};
use std::fs::OpenOptions;
use std::io::Write;
use std::path::{Path, PathBuf};

use fs2::FileExt;
use ulid::Ulid;

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
/// Plan 34-08 fills `new` + `append` with real bodies (Plan 34-03 shipped
/// the stub).
pub struct SessionWriter {
    pub(crate) path: PathBuf,
    pub(crate) enabled: bool,
}

impl SessionWriter {
    /// Plan 34-08 — construct a writer for a NEW conversation. Generates a
    /// fresh Crockford-base32 ULID via `ulid::Ulid::new().to_string()`,
    /// creates `jsonl_log_dir` if missing, and runs rotation BEFORE creating
    /// the new file (rotation considers existing files only — the new file
    /// is not at risk of being archived on creation).
    ///
    /// When `enabled = false`, returns a no-op writer immediately:
    ///   - no directory created (CTX-07 escape hatch)
    ///   - no rotation run
    ///   - the ID is still generated for forensic continuity (so a later
    ///     toggle-on can reuse the ID surface)
    #[cfg(test)]
    pub fn new(jsonl_log_dir: &Path, enabled: bool) -> std::io::Result<(Self, String)> {
        Self::new_with_id(jsonl_log_dir, enabled, None)
    }

    /// Phase 34 / BL-01 + BL-02 (REVIEW finding) — construct a writer for a
    /// SPECIFIC session_id (resumed / forked conversations) instead of always
    /// generating a fresh ULID. When `existing_id` is `Some`, we reuse it
    /// verbatim — the JSONL file at `{dir}/{id}.jsonl` is opened in append
    /// mode (so subsequent `append` calls extend the existing log instead of
    /// stomping it) and rotation runs as usual. When `existing_id` is `None`,
    /// behavior matches the original `new`: fresh ULID, fresh file.
    ///
    /// Critical for the per-conversation cost cap (RES-03 + RES-04) and for
    /// SESS-02 resume — without this, every `send_message_stream` call would
    /// generate a brand-new session_id, so the per-conversation state stored
    /// in the global registry (loop_engine) would be unreachable on the next
    /// turn.
    pub fn new_with_id(
        jsonl_log_dir: &Path,
        enabled: bool,
        existing_id: Option<String>,
    ) -> std::io::Result<(Self, String)> {
        let id = existing_id.unwrap_or_else(|| Ulid::new().to_string());
        if !enabled {
            return Ok((Self { path: PathBuf::new(), enabled: false }, id));
        }
        std::fs::create_dir_all(jsonl_log_dir)?;
        // Rotation BEFORE the new file is created — only existing files get
        // archived. We read keep_n_sessions from the live config so a runtime
        // edit is honored without restart. The config load is panic-safe per
        // Phase 31's keyring-fallback discipline; if it fails, we use the
        // documented default of 100.
        let keep_n: usize = std::panic::catch_unwind(|| {
            crate::config::load_config().session.keep_n_sessions as usize
        })
        .unwrap_or(100);
        if let Err(e) = rotate_old_sessions(jsonl_log_dir, keep_n) {
            eprintln!(
                "[SESS-01] rotation failed at {}: {} — continuing with new session",
                jsonl_log_dir.display(),
                e
            );
        }
        let path = jsonl_log_dir.join(format!("{}.jsonl", &id));
        Ok((Self { path, enabled: true }, id))
    }

    /// Plan 34-08 — no-op writer used by error-recovery paths in commands.rs.
    /// Every method on this writer is a silent no-op; safe to call anywhere.
    pub fn no_op() -> Self {
        Self { path: PathBuf::new(), enabled: false }
    }

    /// Plan 35-07 — open a writer over an EXISTING `{dir}/{id}.jsonl`. Used by
    /// the DECOMP-02 sub-agent dispatch path to attach a `SessionWriter`
    /// instance to a forked session_id (which `Phase 34 SESS-04 fork_session`
    /// already wrote on disk). Unlike `new` / `new_with_id`, this:
    ///   - does NOT generate a fresh ULID
    ///   - does NOT run rotation (the file already exists)
    ///   - does NOT create the parent dir (caller's responsibility — fork
    ///     created it)
    ///
    /// When `enabled = false`, returns a no-op writer immediately. When the
    /// dir is non-empty but the file is missing on disk, the path is still
    /// constructed; `append` handles the missing-file create-on-write case
    /// via `OpenOptions::create+append`.
    ///
    /// Synchronous — no I/O performed at construction. Safe to call from
    /// async sub-agent dispatch hot-path.
    pub fn open_existing(jsonl_log_dir: &Path, id: &str, enabled: bool) -> Self {
        if !enabled {
            return Self { path: PathBuf::new(), enabled: false };
        }
        let path = jsonl_log_dir.join(format!("{}.jsonl", id));
        Self { path, enabled: true }
    }

    /// Plan 34-08 — atomic append. Wrapped in `catch_unwind` so a panic in
    /// serialization or I/O does NOT crash the chat. Mirrors Phase 33-09 /
    /// Plan 34-04 CTX-07 fallback discipline.
    ///
    /// Atomicity: `OpenOptions::create+append` opens with `O_APPEND` on POSIX,
    /// which guarantees that each `write_all` is atomically positioned at the
    /// end of the file by the kernel. We additionally take a `flock(LOCK_EX)`
    /// advisory lock to protect against future multi-window scenarios where
    /// two BLADE instances might write to the same file. On Windows, fs2's
    /// `lock_exclusive` maps to `LockFileEx`; on Unix it maps to `flock(2)`.
    /// Either way, the lock is released on file handle close (drop) even if
    /// `unlock` is not explicitly called.
    ///
    /// SESS_FORCE_APPEND_PANIC seam (Plan 34-03 declaration) is checked at
    /// the top of the catch_unwind closure — when set, panics deliberately,
    /// which catch_unwind catches. Used by the panic-injection regression
    /// test to assert the chat-continues posture holds.
    pub fn append(&self, event: &SessionEvent) {
        if !self.enabled {
            return;
        }
        let path = self.path.clone();
        let event_clone = event.clone();
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            // SESS_FORCE_APPEND_PANIC test seam — only compiled in #[cfg(test)].
            #[cfg(test)]
            SESS_FORCE_APPEND_PANIC.with(|p| {
                if p.get() {
                    panic!(
                        "test-only induced panic in SessionWriter::append (Plan 34-08 regression)"
                    );
                }
            });
            let line = serde_json::to_string(&event_clone).map_err(|e| {
                std::io::Error::new(std::io::ErrorKind::Other, e.to_string())
            })?;
            let mut f = OpenOptions::new()
                .create(true)
                .append(true)
                .open(&path)?;
            // Advisory lock — protects against multi-writer interleaving.
            // fs2 maps to flock(2) on Unix and LockFileEx on Windows.
            f.lock_exclusive()?;
            f.write_all(line.as_bytes())?;
            f.write_all(b"\n")?;
            // Best-effort unlock; even if unlock fails, the file handle close
            // releases the lock. Don't propagate unlock errors.
            let _ = f.unlock();
            Ok::<(), std::io::Error>(())
        }));
        match result {
            Ok(Ok(())) => {}
            Ok(Err(e)) => eprintln!(
                "[SESS-01] append io error at {}: {}",
                self.path.display(),
                e
            ),
            Err(_panic) => eprintln!(
                "[SESS-01] append panicked at {}; chat continues",
                self.path.display()
            ),
        }
    }
}

/// Plan 34-08 — wall-clock millis since UNIX epoch. Used by every event
/// emitter for `timestamp_ms`. Returns 0 if the system clock is before 1970
/// (which shouldn't happen but degrades gracefully).
pub(crate) fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Plan 34-08 — rotate old sessions when count > keep_n. Move oldest (by
/// ULID prefix lex sort — ULID's first 10 chars are timestamp-ordered) to
/// {dir}/archive/. Move, not delete (CONTEXT lock §SESS-01).
///
/// Idempotent: when count <= keep_n, no-op. When count > keep_n, moves
/// exactly `count - keep_n` oldest files. `archive/` is a sibling directory
/// in the same filesystem so `std::fs::rename` is atomic on every supported
/// platform.
pub(crate) fn rotate_old_sessions(dir: &Path, keep_n: usize) -> std::io::Result<()> {
    let mut entries: Vec<PathBuf> = std::fs::read_dir(dir)?
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.is_file())
        .filter(|p| p.extension().and_then(|s| s.to_str()) == Some("jsonl"))
        .collect();
    if entries.len() <= keep_n {
        return Ok(());
    }
    // ULID prefix is lex-sortable by timestamp; oldest first.
    entries.sort();
    let archive_dir = dir.join("archive");
    std::fs::create_dir_all(&archive_dir)?;
    let to_move = entries.len() - keep_n;
    for old in entries.iter().take(to_move) {
        let name = match old.file_name() {
            Some(n) => n,
            None => continue,
        };
        let dst = archive_dir.join(name);
        if let Err(e) = std::fs::rename(old, &dst) {
            eprintln!(
                "[SESS-01] rotation failed for {} → {}: {}",
                old.display(),
                dst.display(),
                e
            );
        }
    }
    Ok(())
}

// Plan 34-08 test seam — when set to true, SessionWriter::append panics.
// Used to assert catch_unwind discipline (panic in append must NOT crash
// the chat). Mirrors loop_engine::FORCE_VERIFY_PANIC (Plan 33-09).
#[cfg(test)]
thread_local! {
    pub(crate) static SESS_FORCE_APPEND_PANIC: std::cell::Cell<bool> =
        const { std::cell::Cell::new(false) };
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;

    fn tmp_dir(label: &str) -> PathBuf {
        // Include nanos to make tmp dirs unique across tests-in-same-process
        // even when std::process::id() collides with another test run.
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.subsec_nanos())
            .unwrap_or(0);
        let p = std::env::temp_dir().join(format!(
            "blade-sess-{}-{}-{}",
            label,
            std::process::id(),
            nanos
        ));
        let _ = std::fs::remove_dir_all(&p);
        std::fs::create_dir_all(&p).expect("create tmp");
        p
    }

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
            SessionEvent::SessionMeta {
                id: "x".into(),
                parent: None,
                fork_at_index: None,
                started_at_ms: 0,
            },
            SessionEvent::UserMessage {
                id: "u".into(),
                content: "c".into(),
                timestamp_ms: 0,
            },
            SessionEvent::AssistantTurn {
                content: "a".into(),
                tool_calls: vec![],
                stop_reason: None,
                tokens_in: 0,
                tokens_out: 0,
                timestamp_ms: 0,
            },
            SessionEvent::ToolCall {
                name: "t".into(),
                args: serde_json::json!({}),
                result: None,
                error: None,
                timestamp_ms: 0,
            },
            SessionEvent::CompactionBoundary {
                kept_message_count: 0,
                summary_first_chars: "s".into(),
                timestamp_ms: 0,
            },
            SessionEvent::HaltReason {
                reason: "r".into(),
                payload: serde_json::json!({}),
                timestamp_ms: 0,
            },
            SessionEvent::LoopEvent {
                kind: "k".into(),
                payload: serde_json::json!({}),
                timestamp_ms: 0,
            },
        ];
        for e in &events {
            let _json = serde_json::to_string(e).expect("each variant must serialize");
        }
    }

    #[test]
    fn phase34_sess_01_writer_new_creates_dir() {
        let dir = tmp_dir("new-creates-dir");
        let nested = dir.join("does/not/exist/yet");
        let (writer, id) = SessionWriter::new(&nested, true).expect("new succeeds");
        assert!(writer.enabled);
        assert!(nested.exists(), "jsonl_log_dir auto-created");
        assert_eq!(id.len(), 26, "ULID is 26 Crockford-base32 chars");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn phase34_sess_01_session_id_is_real_ulid() {
        let dir = tmp_dir("real-ulid");
        let (_, id) = SessionWriter::new(&dir, true).expect("new");
        let parsed = Ulid::from_string(&id).expect("ULID must parse");
        assert!(parsed.timestamp_ms() > 0, "ULID must encode a real timestamp");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn phase34_sess_01_jsonl_roundtrip() {
        let dir = tmp_dir("roundtrip");
        let (writer, _id) = SessionWriter::new(&dir, true).expect("new");
        let events = vec![
            SessionEvent::SessionMeta {
                id: "x".into(),
                parent: None,
                fork_at_index: None,
                started_at_ms: 0,
            },
            SessionEvent::UserMessage {
                id: "u".into(),
                content: "hello".into(),
                timestamp_ms: 1,
            },
            SessionEvent::AssistantTurn {
                content: "hi".into(),
                tool_calls: vec![ToolCallSnippet {
                    name: "read_file".into(),
                    args_excerpt: "{\"path\":\"/tmp\"}".into(),
                }],
                stop_reason: Some("end_turn".into()),
                tokens_in: 10,
                tokens_out: 5,
                timestamp_ms: 2,
            },
            SessionEvent::ToolCall {
                name: "read_file".into(),
                args: serde_json::json!({"path":"/tmp"}),
                result: Some("OK".into()),
                error: None,
                timestamp_ms: 3,
            },
            SessionEvent::CompactionBoundary {
                kept_message_count: 5,
                summary_first_chars: "summary".into(),
                timestamp_ms: 4,
            },
            SessionEvent::HaltReason {
                reason: "Cancelled".into(),
                payload: serde_json::json!({}),
                timestamp_ms: 5,
            },
            SessionEvent::LoopEvent {
                kind: "verification_fired".into(),
                payload: serde_json::json!({"verdict":"YES"}),
                timestamp_ms: 6,
            },
        ];
        for e in &events {
            writer.append(e);
        }
        // Read back
        let mut buf = String::new();
        std::fs::File::open(&writer.path)
            .unwrap()
            .read_to_string(&mut buf)
            .unwrap();
        let lines: Vec<&str> = buf.lines().filter(|l| !l.trim().is_empty()).collect();
        assert_eq!(lines.len(), 7, "all 7 variants must produce one line each");
        for (i, line) in lines.iter().enumerate() {
            let parsed: SessionEvent =
                serde_json::from_str(line).expect("parse line");
            // Round-trip via to_value; assert structural equality.
            let again = serde_json::to_value(&parsed).unwrap();
            let original = serde_json::to_value(&events[i]).unwrap();
            assert_eq!(again, original, "event {} roundtrip mismatch", i);
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn phase34_sess_01_panic_in_append_caught_by_outer_wrapper() {
        let dir = tmp_dir("panic-append");
        let (writer, _id) = SessionWriter::new(&dir, true).expect("new");
        SESS_FORCE_APPEND_PANIC.with(|p| p.set(true));
        // Must not propagate the panic; catch_unwind inside append catches it.
        // If catch_unwind is removed in a future regression, this test panics
        // and the test runner reports the panic message → the regression
        // surfaces loudly.
        writer.append(&SessionEvent::UserMessage {
            id: "x".into(),
            content: "x".into(),
            timestamp_ms: 0,
        });
        SESS_FORCE_APPEND_PANIC.with(|p| p.set(false));
        // No assertion: the test passes if no panic propagates to here.
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn phase34_jsonl_log_disabled_no_files_written() {
        let dir = tmp_dir("disabled");
        let (writer, _id) = SessionWriter::new(&dir, false).expect("new");
        assert!(!writer.enabled, "disabled writer must be enabled=false");
        writer.append(&SessionEvent::UserMessage {
            id: "x".into(),
            content: "x".into(),
            timestamp_ms: 0,
        });
        // The directory was created by tmp_dir(); no *.jsonl file should
        // exist inside it after a disabled append.
        let entries: Vec<_> = std::fs::read_dir(&dir)
            .map(|r| r.collect::<Vec<_>>())
            .unwrap_or_default();
        let jsonl_count = entries
            .iter()
            .filter_map(|e| e.as_ref().ok())
            .filter(|e| e.path().extension().and_then(|s| s.to_str()) == Some("jsonl"))
            .count();
        assert_eq!(
            jsonl_count, 0,
            "jsonl_log_enabled=false must NOT create any *.jsonl files"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn phase34_sess_01_rotation_moves_oldest_to_archive() {
        let dir = tmp_dir("rotation");
        // Create 105 fake JSONL files with sortable names (mimics ULID lex
        // ordering — earlier numbers are "older" in this synthetic test).
        for i in 0..105 {
            // 26-char names so sorted-by-string yields oldest-first.
            let name = format!("0{:025}.jsonl", i);
            let p = dir.join(name);
            std::fs::write(&p, b"{}\n").unwrap();
        }
        rotate_old_sessions(&dir, 100).expect("rotation");
        let remaining: Vec<_> = std::fs::read_dir(&dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.path().is_file())
            .filter(|e| e.path().extension().and_then(|s| s.to_str()) == Some("jsonl"))
            .collect();
        assert_eq!(
            remaining.len(),
            100,
            "only 100 most-recent must remain in dir"
        );
        let archive_dir = dir.join("archive");
        assert!(archive_dir.exists(), "archive/ created by rotation");
        let archived: Vec<_> = std::fs::read_dir(&archive_dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.path().extension().and_then(|s| s.to_str()) == Some("jsonl"))
            .collect();
        assert_eq!(
            archived.len(),
            5,
            "5 oldest must be moved to archive/"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn phase34_sess_01_rotation_idempotent_under_threshold() {
        let dir = tmp_dir("rotation-idempotent");
        for i in 0..50 {
            let name = format!("0{:025}.jsonl", i);
            std::fs::write(dir.join(name), b"{}\n").unwrap();
        }
        // 50 < 100 — rotation is a no-op.
        rotate_old_sessions(&dir, 100).expect("rotation no-op");
        let archive_dir = dir.join("archive");
        // archive/ should NOT be created when no files need moving.
        assert!(
            !archive_dir.exists(),
            "archive/ must not be created when count <= keep_n"
        );
        let remaining: Vec<_> = std::fs::read_dir(&dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.path().is_file())
            .filter(|e| e.path().extension().and_then(|s| s.to_str()) == Some("jsonl"))
            .collect();
        assert_eq!(remaining.len(), 50, "no files moved when under threshold");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn phase34_sess_01_session_writer_writes_session_meta_first() {
        let dir = tmp_dir("session-meta-first");
        let (writer, id) = SessionWriter::new(&dir, true).expect("new");
        // Mimic send_message_stream_inline's first event:
        writer.append(&SessionEvent::SessionMeta {
            id: id.clone(),
            parent: None,
            fork_at_index: None,
            started_at_ms: now_ms(),
        });
        let mut buf = String::new();
        std::fs::File::open(&writer.path)
            .unwrap()
            .read_to_string(&mut buf)
            .unwrap();
        let first_line = buf.lines().next().unwrap_or("");
        let parsed: serde_json::Value = serde_json::from_str(first_line).unwrap();
        assert_eq!(
            parsed["kind"], "SessionMeta",
            "first JSONL line must be SessionMeta event"
        );
        assert_eq!(
            parsed["data"]["id"], id,
            "SessionMeta.id must match the session_id returned by new()"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn phase34_session_writer_stub_construct() {
        // Plan 34-03 backwards-compat test: disabled writer constructs cleanly.
        // Plan 34-08 changed the contract slightly — disabled writers no
        // longer create the dir. Test now uses tmp_dir to avoid a hard-coded
        // /tmp path collision in CI.
        let dir = tmp_dir("stub");
        let (writer, id) = SessionWriter::new(&dir, false).expect("disabled new");
        assert!(!writer.enabled);
        assert_eq!(
            id.len(),
            26,
            "Plan 34-08 returns a real ULID even when disabled"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }
}
