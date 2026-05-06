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

/// RES-03 — Tauri command. Returns `{spent_usd, cap_usd, percent}` for the
/// conversation identified by `session_id`. Reads `{jsonl_log_dir}/<id>.jsonl`,
/// finds the LAST `LoopEvent` with `kind == "cost_update"`, returns its payload
/// joined with the current cost cap. When no cost_update events exist
/// (brand-new session OR every turn ran with smart-off and never emitted —
/// see Plan 34-06 loop_engine cost_update emit which fires UNCONDITIONALLY),
/// returns `spent_usd = 0`.
///
/// Used by:
///   - the chat-input cost-meter chip on session load (one-shot poll —
///     Plan 34-11 frontend);
///   - live ticks come via the `blade_loop_event { kind: "cost_update" }`
///     stream; this command answers "what was the spend before I subscribed?".
///
/// Threat T-34-26 disposition (accept): jsonl_log_dir lives inside the user's
/// own config dir (chmod 0700 on macOS/Linux); cross-user access requires sudo.
/// Threat T-34-27 disposition (accept): forward read with last-wins. For
/// sessions ≥ 10 MB a v1.6 follow-up reads the file's tail first.
#[tauri::command]
pub async fn get_conversation_cost(
    session_id: String,
) -> Result<serde_json::Value, String> {
    validate_session_id(&session_id)?;
    let cfg = crate::config::load_config();
    let cap = cfg.resilience.cost_guard_per_conversation_dollars;
    let dir = cfg.session.jsonl_log_dir.clone();
    let path = dir.join(format!("{}.jsonl", &session_id));
    if !path.exists() {
        return Ok(serde_json::json!({
            "spent_usd": 0.0_f32,
            "cap_usd": cap,
            "percent": 0_u32,
        }));
    }
    let f = std::fs::File::open(&path).map_err(|e| e.to_string())?;
    use std::io::BufRead;
    let reader = std::io::BufReader::new(f);
    let mut last_spent: f32 = 0.0;
    for line in reader.lines() {
        let line = line.map_err(|e| e.to_string())?;
        if line.trim().is_empty() {
            continue;
        }
        match serde_json::from_str::<crate::session::log::SessionEvent>(&line) {
            Ok(crate::session::log::SessionEvent::LoopEvent { kind, payload, .. })
                if kind == "cost_update" =>
            {
                if let Some(s) = payload.get("spent_usd").and_then(|v| v.as_f64()) {
                    last_spent = s as f32;
                }
            }
            Ok(_) => continue,
            Err(e) => {
                // Threat T-34-X (defense): a single corrupt line cannot block
                // the whole read. Log to stderr and continue scanning.
                eprintln!(
                    "[SESS-03] get_conversation_cost: skip corrupt JSONL line in {}: {}",
                    session_id, e
                );
                continue;
            }
        }
    }
    let percent = (100.0 * last_spent / cap.max(0.0001)) as u32;
    Ok(serde_json::json!({
        "spent_usd": last_spent,
        "cap_usd": cap,
        "percent": percent,
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

    /// Plan 34-06 — tests that mutate the process-global BLADE_CONFIG_DIR
    /// env var must run serially. Cargo's default parallel-by-default test
    /// harness will interleave set_var/remove_var across threads otherwise,
    /// causing a sibling test to read another test's tmp dir. We acquire
    /// this mutex at the top of every BLADE_CONFIG_DIR-touching test.
    static TEST_ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

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

    // ─── Plan 34-06 (RES-03) — get_conversation_cost JSONL read tests ─────

    /// RES-03 — get_conversation_cost reads the LAST cost_update LoopEvent
    /// from the JSONL (not sum, not first — last-wins because each iteration's
    /// emit overwrites the running total). Writes 3 events with spent values
    /// 1.0, 2.0, 3.5 and asserts the read returns 3.5.
    #[tokio::test]
    async fn phase34_get_conversation_cost_reads_last_cost_update() {
        let _guard = TEST_ENV_LOCK.lock().unwrap_or_else(|p| p.into_inner());
        let tmp = std::env::temp_dir().join(format!(
            "blade-test-cost-last-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        ));
        let _ = std::fs::create_dir_all(&tmp);
        std::env::set_var("BLADE_CONFIG_DIR", &tmp);

        let sessions_dir = tmp.join("sessions");
        std::fs::create_dir_all(&sessions_dir).expect("create sessions dir");
        let session_id = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
        let path = sessions_dir.join(format!("{}.jsonl", session_id));

        let events = vec![
            crate::session::log::SessionEvent::LoopEvent {
                kind: "cost_update".to_string(),
                payload: serde_json::json!({"spent_usd": 1.0, "cap_usd": 25.0, "percent": 4}),
                timestamp_ms: 1000,
            },
            crate::session::log::SessionEvent::LoopEvent {
                kind: "cost_update".to_string(),
                payload: serde_json::json!({"spent_usd": 2.0, "cap_usd": 25.0, "percent": 8}),
                timestamp_ms: 2000,
            },
            crate::session::log::SessionEvent::LoopEvent {
                kind: "cost_update".to_string(),
                payload: serde_json::json!({"spent_usd": 3.5, "cap_usd": 25.0, "percent": 14}),
                timestamp_ms: 3000,
            },
        ];
        use std::io::Write;
        let mut f = std::fs::File::create(&path).expect("create jsonl");
        for e in &events {
            let line = serde_json::to_string(e).expect("serialize");
            f.write_all(line.as_bytes()).expect("write");
            f.write_all(b"\n").expect("newline");
        }
        drop(f);

        let r = get_conversation_cost(session_id.to_string())
            .await
            .expect("read");
        let spent = r["spent_usd"].as_f64().expect("spent_usd");
        assert!(
            (spent - 3.5).abs() < 0.001,
            "expected last cost_update.spent_usd=3.5; got {}",
            spent
        );
        std::env::remove_var("BLADE_CONFIG_DIR");
        let _ = std::fs::remove_dir_all(&tmp);
    }

    /// RES-03 — missing JSONL (brand-new session that hasn't run yet) returns
    /// spent_usd=0 with the configured cap. NOT an error.
    #[tokio::test]
    async fn phase34_get_conversation_cost_missing_session_returns_zero() {
        let _guard = TEST_ENV_LOCK.lock().unwrap_or_else(|p| p.into_inner());
        let tmp = std::env::temp_dir().join(format!(
            "blade-test-cost-missing-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        ));
        // Create the dir but NOT the sessions/ subdir or any JSONL — the
        // command must handle the missing-file path cleanly.
        let _ = std::fs::create_dir_all(&tmp);
        std::env::set_var("BLADE_CONFIG_DIR", &tmp);
        let r = get_conversation_cost("01ARZ3NDEKTSV4RRFFQ69G5FAV".to_string())
            .await
            .expect("read");
        let spent = r["spent_usd"].as_f64().expect("spent_usd");
        assert_eq!(spent, 0.0);
        std::env::remove_var("BLADE_CONFIG_DIR");
        let _ = std::fs::remove_dir_all(&tmp);
    }

    /// RES-03 / SESS-03 — validate_session_id rejects path-traversal IDs
    /// before any filesystem access fires. Defense in depth even though the
    /// canonical path build (jsonl_log_dir.join(format!("{}.jsonl"))) would
    /// not honor a ".." segment cleanly anyway.
    #[tokio::test]
    async fn phase34_get_conversation_cost_rejects_invalid_id() {
        let r = get_conversation_cost("../../etc/passwd".to_string()).await;
        assert!(r.is_err(), "must reject path-traversal id");
    }
}
