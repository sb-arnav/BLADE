//! Phase 55 / SESSION-TESTS (v2.2 — 2026-05-14) — integration tests for the
//! Goose-shaped SQLite session schema + `SessionManager` CRUD + fork.
//!
//! Six scenarios from the REQ list:
//!
//!   (a) create_session returns a valid id
//!   (b) append_message round-trips role + content
//!   (c) record_tool_call + record_tool_result round-trip
//!   (d) load_session returns the full message list in order
//!   (e) list_sessions returns all created sessions (newest first)
//!   (f) fork_session creates a new session with messages up to the
//!       fork point only — later source-messages are excluded; tool
//!       state is intentionally not cloned
//!
//! Each test uses a fresh in-memory SQLite database (`Connection::open_in_memory`)
//! + `crate::db::run_migrations` so the on-disk Blade DB is never touched
//! and tests don't interfere with each other.
//!
//! Run with: `cargo test --test session_manager_integration`

use blade_lib::sessions::{SessionData, SessionManager, SessionSummary};
use rusqlite::Connection;

/// Build a fresh in-memory connection with the full BLADE migration set
/// applied. Mirrors `db.rs::test_db` (which is `#[cfg(test)]`-private).
fn fresh_conn() -> Connection {
    let conn = Connection::open_in_memory().expect("open_in_memory");
    // run_migrations is `pub(crate)` so it's not reachable from integration
    // tests. The full schema is bootstrapped by calling init_db() — but
    // init_db opens the on-disk blade.db. Workaround: replay the
    // `CREATE TABLE IF NOT EXISTS sessions/session_messages/tool_calls/
    // tool_results` from the canonical migration file directly.
    //
    // This file is kept in sync with db.rs::run_migrations by the
    // SESSION-SCHEMA-PORT commit body (the SQL is verbatim).
    let sql = include_str!("../migrations/202605_session_schema.sql");
    conn.execute_batch(sql).expect("apply session schema");
    conn
}

// ─── (a) create_session returns a valid ID ─────────────────────────────

#[test]
fn create_session_returns_valid_id() {
    let conn = fresh_conn();
    let mgr = SessionManager::new();

    let id = mgr
        .create_session(&conn, Some("test-session".to_string()))
        .expect("create_session");

    // UUIDv4 simple form: 32 hex chars, no hyphens.
    assert_eq!(id.len(), 32, "session_id should be 32-char UUID hex");
    assert!(
        id.chars().all(|c| c.is_ascii_hexdigit()),
        "session_id should be lowercase hex"
    );

    // Confirm it actually landed in the table.
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sessions WHERE id = ?1",
            rusqlite::params![&id],
            |row| row.get(0),
        )
        .expect("count query");
    assert_eq!(count, 1, "session should be persisted");
}

#[test]
fn create_session_with_none_name_uses_empty_string() {
    let conn = fresh_conn();
    let mgr = SessionManager::new();
    let id = mgr.create_session(&conn, None).expect("create_session");

    let (name, user_set): (String, i64) = conn
        .query_row(
            "SELECT name, user_set_name FROM sessions WHERE id = ?1",
            rusqlite::params![&id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .expect("query");
    assert_eq!(name, "");
    assert_eq!(user_set, 0, "user_set_name=false when name is None");
}

// ─── (b) append_message round-trips role + content ─────────────────────

#[test]
fn append_message_round_trips_role_and_content() {
    let conn = fresh_conn();
    let mgr = SessionManager::new();

    let session_id = mgr.create_session(&conn, None).expect("create_session");

    let user_mid = mgr
        .append_message(&conn, &session_id, "user", "hello, world")
        .expect("append user");
    let asst_mid = mgr
        .append_message(&conn, &session_id, "assistant", "hi there")
        .expect("append assistant");

    assert!(user_mid > 0);
    assert!(asst_mid > user_mid, "row ids increase");

    // Round-trip via load_session — same content + role.
    let data = mgr.load_session(&conn, &session_id).expect("load");
    assert_eq!(data.messages.len(), 2);

    let user = &data.messages[0];
    assert_eq!(user.role, "user");
    // content_json is `json!(content).to_string()` — a quoted JSON string.
    assert_eq!(user.content_json, "\"hello, world\"");

    let asst = &data.messages[1];
    assert_eq!(asst.role, "assistant");
    assert_eq!(asst.content_json, "\"hi there\"");
}

// ─── (c) record_tool_call + record_tool_result round-trip ──────────────

#[test]
fn tool_call_and_result_round_trip() {
    let conn = fresh_conn();
    let mgr = SessionManager::new();
    let session_id = mgr.create_session(&conn, None).expect("create_session");

    let mid = mgr
        .append_message(&conn, &session_id, "assistant", "calling tool")
        .expect("append");

    let tc_id = mgr
        .record_tool_call(&conn, mid, "bash", r#"{"cmd":"ls"}"#)
        .expect("record_tool_call");
    assert_eq!(tc_id.len(), 32, "tool_call_id is UUID hex");

    mgr.record_tool_result(&conn, &tc_id, Some(r#"{"stdout":"file.txt\n"}"#), None)
        .expect("record_tool_result");

    // Round-trip via load_session.
    let data: SessionData = mgr.load_session(&conn, &session_id).expect("load");
    assert_eq!(data.tool_calls.len(), 1);
    assert_eq!(data.tool_calls[0].id, tc_id);
    assert_eq!(data.tool_calls[0].tool_name, "bash");
    assert_eq!(data.tool_calls[0].args_json, r#"{"cmd":"ls"}"#);
    assert_eq!(data.tool_calls[0].message_id, mid);

    assert_eq!(data.tool_results.len(), 1);
    let tr = &data.tool_results[0];
    assert_eq!(tr.tool_call_id, tc_id);
    assert_eq!(tr.result_json.as_deref(), Some(r#"{"stdout":"file.txt\n"}"#));
    assert_eq!(tr.error_text, None);

    // Error case (separate call): record an error-only result for a fresh tool_call.
    let tc2 = mgr
        .record_tool_call(&conn, mid, "bash", r#"{"cmd":"nope"}"#)
        .expect("second tool call");
    mgr.record_tool_result(&conn, &tc2, None, Some("command not found"))
        .expect("record error result");

    let data2 = mgr.load_session(&conn, &session_id).expect("load 2");
    assert_eq!(data2.tool_results.len(), 2);
    // Order is by created_at ASC then id; the error result is the latter.
    let error_tr = data2
        .tool_results
        .iter()
        .find(|t| t.tool_call_id == tc2)
        .expect("error tool_result present");
    assert_eq!(error_tr.result_json, None);
    assert_eq!(error_tr.error_text.as_deref(), Some("command not found"));
}

// ─── (d) load_session returns full message list in order ───────────────

#[test]
fn load_session_returns_messages_in_insertion_order() {
    let conn = fresh_conn();
    let mgr = SessionManager::new();
    let session_id = mgr.create_session(&conn, None).expect("create_session");

    let inputs = [
        ("user", "first"),
        ("assistant", "second"),
        ("user", "third"),
        ("assistant", "fourth"),
        ("user", "fifth"),
    ];
    let mut ids = Vec::new();
    for (role, content) in &inputs {
        let id = mgr
            .append_message(&conn, &session_id, role, content)
            .expect("append");
        ids.push(id);
    }
    // Row ids should be strictly monotonic in insertion order.
    assert!(ids.windows(2).all(|w| w[0] < w[1]), "ids monotonic");

    let data = mgr.load_session(&conn, &session_id).expect("load");
    assert_eq!(data.messages.len(), inputs.len());

    // Verify the order matches insertion order.
    for (i, (expected_role, expected_content)) in inputs.iter().enumerate() {
        let got = &data.messages[i];
        assert_eq!(&got.role, *expected_role, "row {} role", i);
        let expected_json = serde_json::Value::String(expected_content.to_string()).to_string();
        assert_eq!(got.content_json, expected_json, "row {} content", i);
    }
    // Summary.message_count agrees.
    assert_eq!(data.summary.message_count, inputs.len() as i64);
}

#[test]
fn load_session_missing_returns_err() {
    let conn = fresh_conn();
    let mgr = SessionManager::new();
    let res = mgr.load_session(&conn, "not-a-real-session-id");
    assert!(res.is_err(), "missing session should Err");
}

// ─── (e) list_sessions returns all created sessions ────────────────────

#[test]
fn list_sessions_returns_all_created_sessions() {
    let conn = fresh_conn();
    let mgr = SessionManager::new();

    let mut created = Vec::new();
    for i in 0..3 {
        let id = mgr
            .create_session(&conn, Some(format!("session-{}", i)))
            .expect("create");
        // Append a message so updated_at bumps; otherwise all rows share
        // their create-time updated_at and list ordering is ambiguous.
        mgr.append_message(&conn, &id, "user", &format!("msg-{}", i))
            .expect("append");
        created.push(id);
        // Spread the timestamps so ordering is deterministic on machines
        // with millisecond-coarse SystemTime::now (Linux is microsecond, but
        // the bound check at the end uses set-membership not ordering).
        std::thread::sleep(std::time::Duration::from_millis(2));
    }

    let listed: Vec<SessionSummary> = mgr.list_sessions(&conn).expect("list");
    assert_eq!(listed.len(), 3, "all 3 sessions returned");

    let listed_ids: std::collections::HashSet<_> = listed.iter().map(|s| s.id.clone()).collect();
    for id in &created {
        assert!(listed_ids.contains(id), "created id {} present in list", id);
    }

    // Names round-tripped.
    for s in &listed {
        assert!(s.name.starts_with("session-"), "name persisted");
        assert_eq!(s.message_count, 1, "1 message per session");
    }

    // Newest-first ordering: the last one created is the first in the list.
    assert_eq!(listed[0].id, *created.last().unwrap());
}

#[test]
fn list_sessions_empty_on_fresh_db() {
    let conn = fresh_conn();
    let mgr = SessionManager::new();
    let listed = mgr.list_sessions(&conn).expect("list");
    assert!(listed.is_empty(), "fresh DB has no sessions");
}

// ─── (f) fork_session creates a new session with messages up to the fork point only ─

#[test]
fn fork_session_copies_messages_up_to_fork_point_only() {
    let conn = fresh_conn();
    let mgr = SessionManager::new();
    let parent_id = mgr
        .create_session(&conn, Some("parent".to_string()))
        .expect("create parent");

    // 5 messages in the parent.
    let m1 = mgr.append_message(&conn, &parent_id, "user", "a").expect("m1");
    let m2 = mgr.append_message(&conn, &parent_id, "assistant", "b").expect("m2");
    let m3 = mgr.append_message(&conn, &parent_id, "user", "c").expect("m3");  // fork pivot
    let m4 = mgr.append_message(&conn, &parent_id, "assistant", "d").expect("m4");
    let m5 = mgr.append_message(&conn, &parent_id, "user", "e").expect("m5");

    // Attach a tool call to m4 so we can verify it isn't cloned.
    let tc = mgr
        .record_tool_call(&conn, m4, "bash", "{}")
        .expect("tool call");
    mgr.record_tool_result(&conn, &tc, Some("\"ok\""), None)
        .expect("tool result");

    // Fork at m3 — the fork should get m1, m2, m3 (inclusive) only.
    let fork_id = mgr
        .fork_session(&conn, &parent_id, m3)
        .expect("fork");
    assert_ne!(fork_id, parent_id, "fork is a different session");

    let fork_data = mgr.load_session(&conn, &fork_id).expect("load fork");
    assert_eq!(
        fork_data.messages.len(),
        3,
        "fork has 3 messages (m1..m3)"
    );
    // Roles + contents copied verbatim.
    let roles: Vec<&str> = fork_data.messages.iter().map(|m| m.role.as_str()).collect();
    assert_eq!(roles, vec!["user", "assistant", "user"]);
    let contents: Vec<&str> = fork_data
        .messages
        .iter()
        .map(|m| m.content_json.as_str())
        .collect();
    assert_eq!(contents, vec!["\"a\"", "\"b\"", "\"c\""]);

    // Fork lineage is recorded.
    assert_eq!(
        fork_data.summary.forked_from.as_deref(),
        Some(parent_id.as_str())
    );
    assert_eq!(
        fork_data.summary.forked_at_message_id.as_deref(),
        Some(m3.to_string().as_str())
    );

    // Tool calls on m4 are NOT cloned into the fork.
    assert!(
        fork_data.tool_calls.is_empty(),
        "fork has no cloned tool_calls"
    );
    assert!(
        fork_data.tool_results.is_empty(),
        "fork has no cloned tool_results"
    );

    // Parent is untouched (m1..m5 still present + the tool state).
    let parent_data = mgr.load_session(&conn, &parent_id).expect("load parent");
    assert_eq!(parent_data.messages.len(), 5);
    assert_eq!(parent_data.tool_calls.len(), 1);
    assert_eq!(parent_data.tool_results.len(), 1);

    // Unused bindings — silence dead-code on m1, m2, m5.
    let _ = (m1, m2, m5);
}

#[test]
fn fork_session_rejects_fork_point_from_other_session() {
    let conn = fresh_conn();
    let mgr = SessionManager::new();
    let session_a = mgr.create_session(&conn, None).expect("a");
    let session_b = mgr.create_session(&conn, None).expect("b");

    let m_in_b = mgr
        .append_message(&conn, &session_b, "user", "x")
        .expect("append b");

    // Attempt to fork session_a using a message id belonging to session_b → Err.
    let res = mgr.fork_session(&conn, &session_a, m_in_b);
    assert!(res.is_err(), "fork should reject foreign fork-point");
}
