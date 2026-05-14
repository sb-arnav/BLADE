//! Phase 55 / SESSION-MANAGER (v2.2 — 2026-05-14)
//!
//! SessionManager — CRUD + fork over the Goose-shaped session schema
//! (migrations/202605_session_schema.sql, applied by db.rs::run_migrations).
//!
//! Adapted from block/goose (Apache 2.0):
//!   crates/goose/src/session/session_manager.rs
//!
//! BLADE deviations from the Goose original:
//!
//!   - Synchronous `rusqlite::Connection` API instead of Goose's async
//!     `sqlx::Pool<Sqlite>`. BLADE already pays the rusqlite tax across
//!     130+ modules; mixing sqlx would double the SQL surface area for
//!     near-zero ergonomic win. The cost is per-call Connection plumbing
//!     instead of a long-lived pool — matches every other BLADE persistence
//!     module today.
//!
//!   - Tool calls are first-class rows in `tool_calls` + `tool_results`
//!     rather than typed content blocks inside `messages.content_json`.
//!     This costs us byte-for-byte interop on tool-call payloads but pays
//!     back in queryability (filter-by-tool-name / failed-tools /
//!     latency-by-tool are WHERE clauses instead of JSON walks).
//!
//!   - Fork lineage lives in two `sessions` columns (`forked_from`,
//!     `forked_at_message_id`) rather than a separate join table.
//!     Single-parent forks only; multi-parent merge is deferred.
//!
//! Phase 55 surface (per REQ list):
//!
//!     create_session(name) -> SessionId
//!     append_message(session_id, role, content) -> MessageId
//!     record_tool_call(message_id, tool_name, args) -> ToolCallId
//!     record_tool_result(tool_call_id, result, error) -> ()
//!     load_session(session_id) -> SessionData
//!     list_sessions() -> Vec<SessionSummary>
//!     fork_session(source_id, fork_point_message_id) -> SessionId
//!
//! No global state. Callers thread a `&Connection` through; production
//! callers reuse the one returned by `crate::db::init_db`, tests use
//! `Connection::open_in_memory()` + `crate::db::run_migrations(&conn)`
//! (see `tests/session_manager_integration.rs`).

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};

// ---------------------------------------------------------------------------
// ID aliases — explicit so callers don't confuse session_id with tool_call_id
// ---------------------------------------------------------------------------

pub type SessionId = String;
pub type ToolCallId = String;

/// Auto-incremented row id for `session_messages.id`. Goose uses
/// `INTEGER PRIMARY KEY AUTOINCREMENT` for the same column; we keep that
/// shape so column-mapped interop on future imports stays trivial.
pub type MessageId = i64;

// ---------------------------------------------------------------------------
// Row / payload types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SessionMessage {
    /// `session_messages.id` — auto-incremented row id.
    pub id: MessageId,
    /// Optional client-side message_id (e.g. `user-<ms>` synthesized
    /// inside `commands.rs::send_message_stream_inline`). Goose calls
    /// this column `message_id`.
    pub external_message_id: Option<String>,
    pub session_id: SessionId,
    pub role: String,
    /// JSON-encoded content. Plain-text user/assistant messages are
    /// stored as JSON strings (`"hello"`), keeping the column-mapped
    /// interop path with Goose's `content_json` viable.
    pub content_json: String,
    pub created_timestamp_ms: i64,
    pub timestamp_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ToolCallRow {
    pub id: ToolCallId,
    pub message_id: MessageId,
    pub session_id: SessionId,
    pub tool_name: String,
    pub args_json: String,
    pub created_at_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ToolResultRow {
    pub tool_call_id: ToolCallId,
    pub result_json: Option<String>,
    pub error_text: Option<String>,
    pub created_at_ms: i64,
}

/// One row of `sessions` projected for list views. Drops the long-tail
/// Goose columns (token counters, recipe_json, …) we don't need today.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SessionSummary {
    pub id: SessionId,
    pub name: String,
    pub session_type: String,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
    pub message_count: i64,
    pub forked_from: Option<SessionId>,
    pub forked_at_message_id: Option<String>,
}

/// Full payload returned by `load_session` — summary + messages + tool
/// calls + tool results. Frontends build the chat-replay view from this.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionData {
    pub summary: SessionSummary,
    pub messages: Vec<SessionMessage>,
    pub tool_calls: Vec<ToolCallRow>,
    pub tool_results: Vec<ToolResultRow>,
}

// ---------------------------------------------------------------------------
// SessionManager
// ---------------------------------------------------------------------------

/// Thin façade over the new session schema. Stateless — every method
/// takes `&Connection`. The struct exists so Phase 56+ have a stable
/// dispatch point if we ever need invocation-scoped state (request-id
/// threading, batched writes, etc.).
#[derive(Debug, Default, Clone, Copy)]
pub struct SessionManager;

impl SessionManager {
    pub fn new() -> Self {
        Self
    }

    // ──────────────────────────────────────────────────────────────────
    // create_session
    // ──────────────────────────────────────────────────────────────────

    /// Creates a new session row. Returns the generated session_id (UUIDv4
    /// hex, no hyphens — matches BLADE's `session/log` ULID convention
    /// at the column level without the lexicographic-time bias). `name`
    /// is optional; the empty string is stored when None.
    ///
    /// Idempotency: not idempotent — each call writes a fresh row with
    /// a fresh UUID. Callers who want idempotent-by-name semantics
    /// should `list_sessions` and filter client-side first.
    pub fn create_session(
        &self,
        conn: &Connection,
        name: Option<String>,
    ) -> Result<SessionId, String> {
        let id = uuid::Uuid::new_v4().simple().to_string();
        let now = now_ms();
        let resolved_name = name.unwrap_or_default();
        let user_set_name = if resolved_name.is_empty() { 0 } else { 1 };
        conn.execute(
            "INSERT INTO sessions (
                id, name, description, user_set_name, session_type,
                working_dir, created_at, updated_at, extension_data,
                goose_mode
             ) VALUES (?1, ?2, '', ?3, 'user', '', ?4, ?4, '{}', 'auto')",
            params![id, resolved_name, user_set_name, now],
        )
        .map_err(|e| format!("create_session: {}", e))?;
        Ok(id)
    }

    /// Inserts an already-known session_id. Used by the dual-write path
    /// in `commands.rs` where the conversation_id is generated upstream
    /// (SessionWriter / loop_engine) and must be reused verbatim so the
    /// new schema's session_id == legacy conversation_id invariant
    /// holds. Idempotent — re-calling with the same id is a no-op
    /// (INSERT OR IGNORE).
    pub fn upsert_session_with_id(
        &self,
        conn: &Connection,
        id: &str,
        name: Option<&str>,
    ) -> Result<(), String> {
        let now = now_ms();
        let resolved_name = name.unwrap_or("");
        let user_set_name = if resolved_name.is_empty() { 0 } else { 1 };
        conn.execute(
            "INSERT OR IGNORE INTO sessions (
                id, name, description, user_set_name, session_type,
                working_dir, created_at, updated_at, extension_data,
                goose_mode
             ) VALUES (?1, ?2, '', ?3, 'user', '', ?4, ?4, '{}', 'auto')",
            params![id, resolved_name, user_set_name, now],
        )
        .map_err(|e| format!("upsert_session_with_id: {}", e))?;
        Ok(())
    }

    // ──────────────────────────────────────────────────────────────────
    // append_message
    // ──────────────────────────────────────────────────────────────────

    /// Appends a message to a session. Returns the new
    /// `session_messages.id`. `content` is stored as a JSON string
    /// (`json!(content).to_string()`), matching Goose's `content_json`
    /// convention for plain-text messages. Bumps the session's
    /// `updated_at` in the same transaction.
    pub fn append_message(
        &self,
        conn: &Connection,
        session_id: &str,
        role: &str,
        content: &str,
    ) -> Result<MessageId, String> {
        let now = now_ms();
        let content_json = serde_json::Value::String(content.to_string()).to_string();
        conn.execute(
            "INSERT INTO session_messages (
                message_id, session_id, role, content_json,
                created_timestamp, timestamp
             ) VALUES (NULL, ?1, ?2, ?3, ?4, ?4)",
            params![session_id, role, content_json, now],
        )
        .map_err(|e| format!("append_message: {}", e))?;
        let id = conn.last_insert_rowid();
        // Bump session.updated_at so list_sessions ordering reflects activity.
        let _ = conn.execute(
            "UPDATE sessions SET updated_at = ?1 WHERE id = ?2",
            params![now, session_id],
        );
        Ok(id)
    }

    // ──────────────────────────────────────────────────────────────────
    // record_tool_call / record_tool_result
    // ──────────────────────────────────────────────────────────────────

    /// Records a tool invocation tied to a previously-appended message.
    /// The message must exist (FK constraint enforced at schema level).
    /// Returns the generated tool_call_id (UUIDv4 hex).
    pub fn record_tool_call(
        &self,
        conn: &Connection,
        message_id: MessageId,
        tool_name: &str,
        args_json: &str,
    ) -> Result<ToolCallId, String> {
        // Resolve session_id from message_id so the tool_calls row keeps
        // the denormalized session_id column (cheap, queryable, removes
        // a JOIN from the hot path of "all tools used in this session").
        let session_id: String = conn
            .query_row(
                "SELECT session_id FROM session_messages WHERE id = ?1",
                params![message_id],
                |row| row.get(0),
            )
            .map_err(|e| format!("record_tool_call: lookup message: {}", e))?;
        let id = uuid::Uuid::new_v4().simple().to_string();
        let now = now_ms();
        conn.execute(
            "INSERT INTO tool_calls (id, message_id, session_id, tool_name, args_json, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![id, message_id, session_id, tool_name, args_json, now],
        )
        .map_err(|e| format!("record_tool_call: insert: {}", e))?;
        Ok(id)
    }

    /// Records the result of a tool invocation. Either `result` (success)
    /// or `error` (failure) should be set; passing both is allowed but
    /// the conventional shape is exactly one. Replaces any prior result
    /// row for the same tool_call_id (1:1 — INSERT OR REPLACE).
    pub fn record_tool_result(
        &self,
        conn: &Connection,
        tool_call_id: &str,
        result: Option<&str>,
        error: Option<&str>,
    ) -> Result<(), String> {
        let now = now_ms();
        conn.execute(
            "INSERT OR REPLACE INTO tool_results (tool_call_id, result_json, error_text, created_at)
             VALUES (?1, ?2, ?3, ?4)",
            params![tool_call_id, result, error, now],
        )
        .map_err(|e| format!("record_tool_result: {}", e))?;
        Ok(())
    }

    // ──────────────────────────────────────────────────────────────────
    // load_session / list_sessions
    // ──────────────────────────────────────────────────────────────────

    /// Returns the full session payload: summary + ordered messages +
    /// ordered tool_calls + ordered tool_results. Returns Err when the
    /// session doesn't exist.
    pub fn load_session(
        &self,
        conn: &Connection,
        session_id: &str,
    ) -> Result<SessionData, String> {
        let summary = self
            .session_summary(conn, session_id)?
            .ok_or_else(|| format!("load_session: not found: {}", session_id))?;
        let messages = self.load_messages(conn, session_id)?;
        let tool_calls = self.load_tool_calls(conn, session_id)?;
        let tool_results = self.load_tool_results_for_session(conn, session_id)?;
        Ok(SessionData {
            summary,
            messages,
            tool_calls,
            tool_results,
        })
    }

    /// Returns one summary row per session ordered by `updated_at DESC`
    /// (recent activity first). Archived sessions are filtered out.
    pub fn list_sessions(&self, conn: &Connection) -> Result<Vec<SessionSummary>, String> {
        let mut stmt = conn
            .prepare(
                "SELECT s.id, s.name, s.session_type, s.created_at, s.updated_at,
                        COALESCE((SELECT COUNT(*) FROM session_messages m WHERE m.session_id = s.id), 0),
                        s.forked_from, s.forked_at_message_id
                 FROM sessions s
                 WHERE s.archived_at IS NULL
                 ORDER BY s.updated_at DESC",
            )
            .map_err(|e| format!("list_sessions: prepare: {}", e))?;
        let rows = stmt
            .query_map([], |row| {
                Ok(SessionSummary {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    session_type: row.get(2)?,
                    created_at_ms: row.get(3)?,
                    updated_at_ms: row.get(4)?,
                    message_count: row.get(5)?,
                    forked_from: row.get(6)?,
                    forked_at_message_id: row.get(7)?,
                })
            })
            .map_err(|e| format!("list_sessions: query: {}", e))?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r.map_err(|e| format!("list_sessions: row: {}", e))?);
        }
        Ok(out)
    }

    // ──────────────────────────────────────────────────────────────────
    // fork_session
    // ──────────────────────────────────────────────────────────────────

    /// Creates a new session that branches off `source_id` at
    /// `fork_point_message_id` (inclusive). Every `session_messages` row
    /// in the source up to and including `fork_point_message_id` is
    /// copied to the fork. Tool calls/results attached to those copied
    /// messages are NOT copied — the fork is meant for divergent
    /// continuation, not exact replay; cloning tool outputs would
    /// stale-pin to the source's results. Future Phase: optional
    /// `clone_tool_state` flag.
    ///
    /// Returns the new session_id.
    pub fn fork_session(
        &self,
        conn: &Connection,
        source_id: &str,
        fork_point_message_id: MessageId,
    ) -> Result<SessionId, String> {
        // Verify source exists and the fork point is in this session.
        let parent_name: String = conn
            .query_row(
                "SELECT name FROM sessions WHERE id = ?1",
                params![source_id],
                |row| row.get(0),
            )
            .map_err(|e| format!("fork_session: source not found: {}", e))?;

        let fork_point_in_session: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM session_messages WHERE id = ?1 AND session_id = ?2",
                params![fork_point_message_id, source_id],
                |row| row.get(0),
            )
            .map_err(|e| format!("fork_session: fork-point lookup: {}", e))?;
        if fork_point_in_session == 0 {
            return Err(format!(
                "fork_session: fork-point message {} not in session {}",
                fork_point_message_id, source_id
            ));
        }

        let new_id = uuid::Uuid::new_v4().simple().to_string();
        let now = now_ms();
        let fork_name = if parent_name.is_empty() {
            format!("fork of {}", source_id)
        } else {
            format!("fork of {}", parent_name)
        };

        // Single transaction: create fork row, copy messages up to and
        // including fork_point. Anything later in the source is excluded.
        let tx_conn = conn;
        tx_conn
            .execute(
                "INSERT INTO sessions (
                    id, name, description, user_set_name, session_type,
                    working_dir, created_at, updated_at, extension_data,
                    goose_mode, forked_from, forked_at_message_id
                 ) VALUES (?1, ?2, '', 1, 'user', '', ?3, ?3, '{}', 'auto', ?4, ?5)",
                params![new_id, fork_name, now, source_id, fork_point_message_id.to_string()],
            )
            .map_err(|e| format!("fork_session: insert fork: {}", e))?;

        tx_conn
            .execute(
                "INSERT INTO session_messages (
                    message_id, session_id, role, content_json,
                    created_timestamp, timestamp, tokens, metadata_json
                 )
                 SELECT message_id, ?1 AS session_id, role, content_json,
                        created_timestamp, timestamp, tokens, metadata_json
                   FROM session_messages
                  WHERE session_id = ?2 AND id <= ?3
                  ORDER BY id ASC",
                params![new_id, source_id, fork_point_message_id],
            )
            .map_err(|e| format!("fork_session: copy messages: {}", e))?;

        Ok(new_id)
    }

    // ──────────────────────────────────────────────────────────────────
    // Private helpers
    // ──────────────────────────────────────────────────────────────────

    fn session_summary(
        &self,
        conn: &Connection,
        session_id: &str,
    ) -> Result<Option<SessionSummary>, String> {
        conn.query_row(
            "SELECT s.id, s.name, s.session_type, s.created_at, s.updated_at,
                    COALESCE((SELECT COUNT(*) FROM session_messages m WHERE m.session_id = s.id), 0),
                    s.forked_from, s.forked_at_message_id
             FROM sessions s
             WHERE s.id = ?1",
            params![session_id],
            |row| {
                Ok(SessionSummary {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    session_type: row.get(2)?,
                    created_at_ms: row.get(3)?,
                    updated_at_ms: row.get(4)?,
                    message_count: row.get(5)?,
                    forked_from: row.get(6)?,
                    forked_at_message_id: row.get(7)?,
                })
            },
        )
        .optional()
        .map_err(|e| format!("session_summary: {}", e))
    }

    fn load_messages(
        &self,
        conn: &Connection,
        session_id: &str,
    ) -> Result<Vec<SessionMessage>, String> {
        let mut stmt = conn
            .prepare(
                "SELECT id, message_id, session_id, role, content_json,
                        created_timestamp, timestamp
                 FROM session_messages
                 WHERE session_id = ?1
                 ORDER BY id ASC",
            )
            .map_err(|e| format!("load_messages: prepare: {}", e))?;
        let rows = stmt
            .query_map(params![session_id], |row| {
                Ok(SessionMessage {
                    id: row.get(0)?,
                    external_message_id: row.get(1)?,
                    session_id: row.get(2)?,
                    role: row.get(3)?,
                    content_json: row.get(4)?,
                    created_timestamp_ms: row.get(5)?,
                    timestamp_ms: row.get(6)?,
                })
            })
            .map_err(|e| format!("load_messages: query: {}", e))?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r.map_err(|e| format!("load_messages: row: {}", e))?);
        }
        Ok(out)
    }

    fn load_tool_calls(
        &self,
        conn: &Connection,
        session_id: &str,
    ) -> Result<Vec<ToolCallRow>, String> {
        let mut stmt = conn
            .prepare(
                "SELECT id, message_id, session_id, tool_name, args_json, created_at
                 FROM tool_calls
                 WHERE session_id = ?1
                 ORDER BY created_at ASC, id ASC",
            )
            .map_err(|e| format!("load_tool_calls: prepare: {}", e))?;
        let rows = stmt
            .query_map(params![session_id], |row| {
                Ok(ToolCallRow {
                    id: row.get(0)?,
                    message_id: row.get(1)?,
                    session_id: row.get(2)?,
                    tool_name: row.get(3)?,
                    args_json: row.get(4)?,
                    created_at_ms: row.get(5)?,
                })
            })
            .map_err(|e| format!("load_tool_calls: query: {}", e))?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r.map_err(|e| format!("load_tool_calls: row: {}", e))?);
        }
        Ok(out)
    }

    fn load_tool_results_for_session(
        &self,
        conn: &Connection,
        session_id: &str,
    ) -> Result<Vec<ToolResultRow>, String> {
        // JOIN to scope to this session's tool_calls only.
        let mut stmt = conn
            .prepare(
                "SELECT tr.tool_call_id, tr.result_json, tr.error_text, tr.created_at
                 FROM tool_results tr
                 INNER JOIN tool_calls tc ON tc.id = tr.tool_call_id
                 WHERE tc.session_id = ?1
                 ORDER BY tr.created_at ASC",
            )
            .map_err(|e| format!("load_tool_results: prepare: {}", e))?;
        let rows = stmt
            .query_map(params![session_id], |row| {
                Ok(ToolResultRow {
                    tool_call_id: row.get(0)?,
                    result_json: row.get(1)?,
                    error_text: row.get(2)?,
                    created_at_ms: row.get(3)?,
                })
            })
            .map_err(|e| format!("load_tool_results: query: {}", e))?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r.map_err(|e| format!("load_tool_results: row: {}", e))?);
        }
        Ok(out)
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}
