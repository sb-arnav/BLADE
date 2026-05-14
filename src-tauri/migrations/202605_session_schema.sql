-- Phase 55 / SESSION-SCHEMA-PORT (v2.2 — 2026-05-14)
--
-- Goose-shaped SQLite session schema for cross-session continuity,
-- session-fork support, and future Goose interop.
--
-- Adapted from block/goose (Apache 2.0):
--   crates/goose/src/session/session_manager.rs
--   (CREATE TABLE sessions / messages around line 653 / 685)
--
-- BLADE retains Goose's `sessions` + `messages` column shape verbatim so
-- a future cross-tool interop path (read Goose's sessions.db, write
-- BLADE's blade.db) is a column-mapped copy, not a structural rewrite.
-- BLADE additionally promotes tool invocations to first-class rows
-- (`tool_calls` + `tool_results`), which Goose stuffs into `messages.content_json`.
-- This costs us byte-for-byte interop on tool-call payloads but pays back
-- in queryability: filtering by tool name, latency, or error code is a
-- WHERE clause instead of a JSON walk over every message.
--
-- Idempotent / safe to run on every startup — uses CREATE TABLE IF NOT
-- EXISTS + CREATE INDEX IF NOT EXISTS throughout. Live `db.rs::run_migrations`
-- applies this batch verbatim on every boot per the BLADE migration
-- convention (Phase 58 precedent at `202605_deprecate_vector_indexes.sql`).
--
-- Note: BLADE's existing `conversations` + `messages` tables remain in
-- place. Phase 55 dual-writes to the new `sessions` + `session_messages`
-- tables (renamed to avoid colliding with the legacy `messages` table).
-- A v2.3 cutover will retire the legacy path once dogfood signal confirms
-- the new path. We preserve Goose's `messages` column shape under the
-- BLADE-namespaced `session_messages` table so column-mapped interop
-- still works (rename at copy time).

-- ──────────────────────────────────────────────────────────────────────
-- 1. sessions — top-level session metadata
--    Mirrors Goose `crates/goose/src/session/session_manager.rs:653` shape.
--    Subset of Goose's columns; the ones BLADE doesn't use today
--    (extension_data, schedule_id, recipe_json, etc.) are kept as nullable
--    TEXT to preserve column-mapped interop on future imports.
-- ──────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sessions (
    id                          TEXT PRIMARY KEY,
    name                        TEXT NOT NULL DEFAULT '',
    description                 TEXT NOT NULL DEFAULT '',
    user_set_name               INTEGER NOT NULL DEFAULT 0,    -- BOOLEAN
    session_type                TEXT NOT NULL DEFAULT 'user',  -- 'user' | 'scheduled' | 'sub_agent' | 'hidden' | 'terminal' | 'gateway' | 'acp'
    working_dir                 TEXT NOT NULL DEFAULT '',
    created_at                  INTEGER NOT NULL,              -- unix ms (BLADE convention; Goose uses TIMESTAMP)
    updated_at                  INTEGER NOT NULL,              -- unix ms
    extension_data              TEXT NOT NULL DEFAULT '{}',    -- JSON
    total_tokens                INTEGER,
    input_tokens                INTEGER,
    output_tokens               INTEGER,
    accumulated_total_tokens    INTEGER,
    accumulated_input_tokens    INTEGER,
    accumulated_output_tokens   INTEGER,
    schedule_id                 TEXT,
    recipe_json                 TEXT,
    user_recipe_values_json     TEXT,
    provider_name               TEXT,
    model_config_json           TEXT,
    goose_mode                  TEXT NOT NULL DEFAULT 'auto',
    archived_at                 INTEGER,                       -- unix ms; null when active
    project_id                  TEXT,
    -- BLADE-specific (not in Goose): fork lineage so session-fork stays queryable.
    -- A non-null `forked_from` points to the parent session.id; `forked_at_message_id`
    -- pins the message after which the fork diverged.
    forked_from                 TEXT,
    forked_at_message_id        TEXT
);

CREATE INDEX IF NOT EXISTS idx_sessions_updated     ON sessions(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_type        ON sessions(session_type);
CREATE INDEX IF NOT EXISTS idx_sessions_created     ON sessions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_forked_from ON sessions(forked_from);

-- ──────────────────────────────────────────────────────────────────────
-- 2. session_messages — per-session message log
--    Mirrors Goose `crates/goose/src/session/session_manager.rs:685` shape.
--    Goose names this table `messages`; BLADE namespaces it `session_messages`
--    to avoid colliding with the legacy `messages` table (v2.3 retires the
--    legacy path; at that point this can be renamed back to `messages`).
-- ──────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS session_messages (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id        TEXT,
    session_id        TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    role              TEXT NOT NULL,                          -- 'user' | 'assistant' | 'system' | 'tool'
    content_json      TEXT NOT NULL,                          -- JSON-encoded content blocks (Goose-shaped)
    created_timestamp INTEGER NOT NULL,                       -- unix ms (Goose's `created_timestamp`)
    timestamp         INTEGER NOT NULL,                       -- unix ms (wall clock; Goose uses TIMESTAMP DEFAULT CURRENT_TIMESTAMP)
    tokens            INTEGER,
    metadata_json     TEXT
);

CREATE INDEX IF NOT EXISTS idx_session_messages_session    ON session_messages(session_id);
CREATE INDEX IF NOT EXISTS idx_session_messages_timestamp  ON session_messages(timestamp);
CREATE INDEX IF NOT EXISTS idx_session_messages_message_id ON session_messages(message_id);
CREATE INDEX IF NOT EXISTS idx_session_messages_created    ON session_messages(created_timestamp);

-- ──────────────────────────────────────────────────────────────────────
-- 3. tool_calls — first-class tool invocation rows
--    Goose stuffs tool calls into `messages.content_json` as a typed
--    content block. BLADE promotes them so query paths (tool-by-name,
--    failed-tools, latency histograms) don't need a JSON walk.
--    Each tool_call belongs to a message (typically an assistant message
--    that requested the tool) and a session.
-- ──────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tool_calls (
    id           TEXT PRIMARY KEY,                            -- ULID/UUID
    message_id   INTEGER NOT NULL REFERENCES session_messages(id) ON DELETE CASCADE,
    session_id   TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    tool_name    TEXT NOT NULL,
    args_json    TEXT NOT NULL DEFAULT '{}',
    created_at   INTEGER NOT NULL                              -- unix ms
);

CREATE INDEX IF NOT EXISTS idx_tool_calls_session    ON tool_calls(session_id);
CREATE INDEX IF NOT EXISTS idx_tool_calls_message    ON tool_calls(message_id);
CREATE INDEX IF NOT EXISTS idx_tool_calls_tool_name  ON tool_calls(tool_name);
CREATE INDEX IF NOT EXISTS idx_tool_calls_created    ON tool_calls(created_at DESC);

-- ──────────────────────────────────────────────────────────────────────
-- 4. tool_results — outputs/errors keyed back to tool_calls.id
--    Separate row so a single tool_call can carry exactly one result
--    (1:1) but the result can be appended asynchronously, after the
--    call row exists. error_text is NULL on success; result_json is
--    NULL on error. Both NULL = still-pending.
-- ──────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tool_results (
    tool_call_id TEXT PRIMARY KEY REFERENCES tool_calls(id) ON DELETE CASCADE,
    result_json  TEXT,                                         -- nullable
    error_text   TEXT,                                         -- nullable
    created_at   INTEGER NOT NULL                              -- unix ms
);

CREATE INDEX IF NOT EXISTS idx_tool_results_created ON tool_results(created_at DESC);
