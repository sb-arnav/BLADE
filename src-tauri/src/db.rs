use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ConversationRow {
    pub id: String,
    pub title: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub message_count: i64,
    pub pinned: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct MessageRow {
    pub id: String,
    pub conversation_id: String,
    pub role: String,
    pub content: String,
    pub image_base64: Option<String>,
    pub timestamp: i64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ConversationWithMessages {
    pub conversation: ConversationRow,
    pub messages: Vec<MessageRow>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct KnowledgeRow {
    pub id: String,
    pub title: String,
    pub content: String,
    pub tags: String, // JSON array string
    pub source: String,
    pub conversation_id: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct AnalyticsEvent {
    pub id: i64,
    pub event_type: String,
    pub timestamp: i64,
    pub metadata: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct SearchResult {
    pub message_id: String,
    pub conversation_id: String,
    pub role: String,
    pub content: String,
    pub timestamp: i64,
    pub rank: f64,
}

// ---------------------------------------------------------------------------
// Brain row types
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct BrainStyleTagRow {
    pub id: String,
    pub tag: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct BrainPreferenceRow {
    pub id: String,
    pub text: String,
    pub confidence: f64,
    pub source: String,
    pub updated_at: i64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct BrainNodeRow {
    pub id: String,
    pub label: String,
    pub kind: String,
    pub summary: String,
    pub mention_count: i64,
    pub last_seen_at: i64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct BrainEdgeRow {
    pub id: String,
    pub from_id: String,
    pub to_id: String,
    pub label: String,
    pub weight: i64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct BrainSkillRow {
    pub id: String,
    pub name: String,
    pub trigger_pattern: String,
    pub prompt_modifier: String,
    pub tools_json: String,
    pub usage_count: i64,
    pub active: bool,
    pub created_at: i64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct BrainMemoryRow {
    pub id: String,
    pub text: String,
    pub source_conversation_id: String,
    pub entities_json: String,
    pub confidence: f64,
    pub created_at: i64,
    pub expires_at: Option<i64>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct BrainReactionRow {
    pub id: String,
    pub message_id: String,
    pub polarity: i64,
    pub content: String,
    pub context_json: String,
    pub created_at: i64,
}

// ---------------------------------------------------------------------------
// Database initialization
// ---------------------------------------------------------------------------

/// Opens (or creates) the Blade database and runs all migrations.
/// The database file lives at `<blade_config_dir>/blade.db`.
/// WAL mode is enabled for concurrent reads and FTS5 is used for full-text
/// search on messages and knowledge entries.
pub fn init_db() -> Result<Connection, String> {
    let db_path = crate::config::blade_config_dir().join("blade.db");

    // Ensure the parent directory exists
    if let Some(parent) = db_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("DB error: failed to create config dir: {}", e))?;
    }

    let conn = Connection::open(&db_path).map_err(|e| format!("DB error: {}", e))?;

    // Enable WAL mode for concurrent reads
    conn.pragma_update(None, "journal_mode", "WAL")
        .map_err(|e| format!("DB error: {}", e))?;

    // Enable foreign keys
    conn.pragma_update(None, "foreign_keys", "ON")
        .map_err(|e| format!("DB error: {}", e))?;

    run_migrations(&conn)?;

    Ok(conn)
}

/// Runs all CREATE TABLE IF NOT EXISTS migrations.
fn run_migrations(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "
        -- Conversations
        CREATE TABLE IF NOT EXISTS conversations (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL DEFAULT '',
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            message_count INTEGER NOT NULL DEFAULT 0,
            pinned INTEGER NOT NULL DEFAULT 0
        );

        -- Messages
        CREATE TABLE IF NOT EXISTS messages (
            id TEXT PRIMARY KEY,
            conversation_id TEXT NOT NULL,
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            image_base64 TEXT,
            timestamp INTEGER NOT NULL,
            FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
        );

        -- Knowledge base
        CREATE TABLE IF NOT EXISTS knowledge_entries (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            content TEXT NOT NULL,
            tags TEXT NOT NULL DEFAULT '[]',
            source TEXT NOT NULL DEFAULT 'manual',
            conversation_id TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );

        -- Analytics events
        CREATE TABLE IF NOT EXISTS analytics_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            event_type TEXT NOT NULL,
            timestamp INTEGER NOT NULL,
            metadata TEXT
        );

        -- Templates
        CREATE TABLE IF NOT EXISTS templates (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            content TEXT NOT NULL,
            variables TEXT NOT NULL DEFAULT '[]',
            category TEXT NOT NULL DEFAULT 'custom',
            icon TEXT NOT NULL DEFAULT '📝',
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            usage_count INTEGER NOT NULL DEFAULT 0,
            is_builtin INTEGER NOT NULL DEFAULT 0
        );

        -- Workflows
        CREATE TABLE IF NOT EXISTS workflows (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            icon TEXT NOT NULL DEFAULT '⚡',
            steps TEXT NOT NULL DEFAULT '[]',
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            run_count INTEGER NOT NULL DEFAULT 0,
            is_builtin INTEGER NOT NULL DEFAULT 0
        );

        -- Settings key-value store
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

        -- Agent tasks
        CREATE TABLE IF NOT EXISTS agent_tasks (
            id TEXT PRIMARY KEY,
            goal TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            steps TEXT NOT NULL DEFAULT '[]',
            step_outputs TEXT NOT NULL DEFAULT '{}',
            current_step INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            completed_at INTEGER,
            error TEXT
        );

        -- ── Brain (Character Bible) ───────────────────────────────────────────

        -- Key-value identity (name, role)
        CREATE TABLE IF NOT EXISTS brain_identity (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

        -- Working style tags e.g. ships-fast, no-fluff
        CREATE TABLE IF NOT EXISTS brain_style_tags (
            id TEXT PRIMARY KEY,
            tag TEXT NOT NULL UNIQUE
        );

        -- Derived + manual preferences from feedback loop
        CREATE TABLE IF NOT EXISTS brain_preferences (
            id TEXT PRIMARY KEY,
            text TEXT NOT NULL,
            confidence REAL NOT NULL DEFAULT 0.5,
            source TEXT NOT NULL DEFAULT 'manual',
            updated_at INTEGER NOT NULL
        );

        -- Knowledge graph nodes
        CREATE TABLE IF NOT EXISTS brain_nodes (
            id TEXT PRIMARY KEY,
            label TEXT NOT NULL,
            kind TEXT NOT NULL DEFAULT 'concept',
            summary TEXT NOT NULL DEFAULT '',
            mention_count INTEGER NOT NULL DEFAULT 1,
            last_seen_at INTEGER NOT NULL
        );

        -- Knowledge graph edges
        CREATE TABLE IF NOT EXISTS brain_edges (
            id TEXT PRIMARY KEY,
            from_id TEXT NOT NULL,
            to_id TEXT NOT NULL,
            label TEXT NOT NULL DEFAULT 'related',
            weight INTEGER NOT NULL DEFAULT 1,
            FOREIGN KEY (from_id) REFERENCES brain_nodes(id) ON DELETE CASCADE,
            FOREIGN KEY (to_id) REFERENCES brain_nodes(id) ON DELETE CASCADE,
            UNIQUE(from_id, to_id, label)
        );

        -- Learned skills (auto-discovered patterns)
        CREATE TABLE IF NOT EXISTS brain_skills (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            trigger_pattern TEXT NOT NULL,
            prompt_modifier TEXT NOT NULL,
            tools_json TEXT NOT NULL DEFAULT '[]',
            usage_count INTEGER NOT NULL DEFAULT 0,
            active INTEGER NOT NULL DEFAULT 1,
            created_at INTEGER NOT NULL
        );

        -- Memory entries extracted from conversations
        CREATE TABLE IF NOT EXISTS brain_memories (
            id TEXT PRIMARY KEY,
            text TEXT NOT NULL,
            source_conversation_id TEXT NOT NULL DEFAULT '',
            entities_json TEXT NOT NULL DEFAULT '[]',
            confidence REAL NOT NULL DEFAULT 0.7,
            created_at INTEGER NOT NULL,
            expires_at INTEGER
        );

        -- Raw feedback reactions (👍👎) for pattern detection
        CREATE TABLE IF NOT EXISTS brain_reactions (
            id TEXT PRIMARY KEY,
            message_id TEXT NOT NULL,
            polarity INTEGER NOT NULL,
            content TEXT NOT NULL,
            context_json TEXT NOT NULL DEFAULT '{}',
            created_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS capability_reports (
            id TEXT PRIMARY KEY,
            category TEXT NOT NULL,
            title TEXT NOT NULL,
            description TEXT NOT NULL,
            user_request TEXT NOT NULL DEFAULT '',
            blade_response TEXT NOT NULL DEFAULT '',
            suggested_fix TEXT NOT NULL DEFAULT '',
            severity TEXT NOT NULL DEFAULT 'medium',
            status TEXT NOT NULL DEFAULT 'open',
            reported_at INTEGER NOT NULL,
            resolved_at INTEGER
        );

        -- Persistent vector store: embeddings survive app restarts
        CREATE TABLE IF NOT EXISTS vector_entries (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            content TEXT NOT NULL,
            embedding BLOB NOT NULL,
            source_type TEXT NOT NULL DEFAULT 'conversation',
            source_id TEXT NOT NULL DEFAULT '',
            created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_vector_entries_source ON vector_entries(source_type, source_id);

        -- ── BLADE NERVOUS SYSTEM ─────────────────────────────────────────────

        -- THREAD: Blade's living working memory per project.
        -- Auto-updated after every conversation. Injected into every system prompt.
        -- This is what gives Blade continuity between sessions.
        CREATE TABLE IF NOT EXISTS active_threads (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL DEFAULT 'Active Context',
            content TEXT NOT NULL,
            project TEXT NOT NULL DEFAULT 'general',
            updated_at INTEGER NOT NULL,
            turn_count INTEGER NOT NULL DEFAULT 0
        );

        -- SKILL ENGINE: raw tool loop patterns before they graduate to brain_skills.
        -- When count >= 3, synthesize into a named skill with a prompt modifier.
        CREATE TABLE IF NOT EXISTS skill_candidates (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            query_hash TEXT NOT NULL,
            query_example TEXT NOT NULL,
            tool_sequence TEXT NOT NULL,
            result_summary TEXT NOT NULL,
            count INTEGER NOT NULL DEFAULT 1,
            last_seen INTEGER NOT NULL
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_skill_candidates_hash ON skill_candidates(query_hash);

        -- Activity timeline: every significant event BLADE observes
        CREATE TABLE IF NOT EXISTS activity_timeline (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp INTEGER NOT NULL,
            event_type TEXT NOT NULL,
            title TEXT NOT NULL DEFAULT '',
            content TEXT NOT NULL DEFAULT '',
            app_name TEXT NOT NULL DEFAULT '',
            metadata TEXT NOT NULL DEFAULT '{}'
        );
        CREATE INDEX IF NOT EXISTS idx_activity_timeline_ts ON activity_timeline(timestamp DESC);
        CREATE INDEX IF NOT EXISTS idx_activity_timeline_type ON activity_timeline(event_type);
        CREATE TABLE IF NOT EXISTS watchers (
            id TEXT PRIMARY KEY,
            url TEXT NOT NULL,
            label TEXT NOT NULL DEFAULT '',
            interval_mins INTEGER NOT NULL DEFAULT 30,
            last_content_hash TEXT NOT NULL DEFAULT '',
            last_checked INTEGER NOT NULL DEFAULT 0,
            last_changed INTEGER NOT NULL DEFAULT 0,
            active INTEGER NOT NULL DEFAULT 1,
            created_at INTEGER NOT NULL
        );
        ",
    )
    .map_err(|e| format!("DB error: {}", e))?;

    // FTS5 virtual tables must be created separately because execute_batch
    // does not always handle virtual table creation inside a batch reliably.
    conn.execute(
        "CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(content, content=messages, content_rowid=rowid);",
        [],
    )
    .map_err(|e| format!("DB error: {}", e))?;

    conn.execute(
        "CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts USING fts5(title, content, tags, content=knowledge_entries, content_rowid=rowid);",
        [],
    )
    .map_err(|e| format!("DB error: {}", e))?;

    Ok(())
}

// ---------------------------------------------------------------------------
// Capability Reports — CRUD
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct CapabilityReport {
    pub id: String,
    pub category: String,      // "capability_gap" | "runtime_error" | "missing_tool" | "failed_mission" | "user_friction"
    pub title: String,
    pub description: String,
    pub user_request: String,
    pub blade_response: String,
    pub suggested_fix: String,
    pub severity: String,      // "low" | "medium" | "high" | "critical"
    pub status: String,        // "open" | "investigating" | "resolved" | "wont_fix"
    pub reported_at: i64,
    pub resolved_at: Option<i64>,
}

pub fn report_capability_gap(
    conn: &Connection,
    id: &str,
    category: &str,
    title: &str,
    description: &str,
    user_request: &str,
    blade_response: &str,
    suggested_fix: &str,
    severity: &str,
) -> Result<(), String> {
    let now = chrono::Utc::now().timestamp_millis();
    conn.execute(
        "INSERT OR IGNORE INTO capability_reports(id,category,title,description,user_request,blade_response,suggested_fix,severity,status,reported_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,'open',?9)",
        params![id, category, title, description, user_request, blade_response, suggested_fix, severity, now],
    ).map_err(|e| format!("DB error: {}", e))?;
    Ok(())
}

pub fn get_capability_reports(conn: &Connection, limit: usize) -> Result<Vec<CapabilityReport>, String> {
    let mut stmt = conn.prepare(
        "SELECT id,category,title,description,user_request,blade_response,suggested_fix,severity,status,reported_at,resolved_at FROM capability_reports ORDER BY reported_at DESC LIMIT ?1"
    ).map_err(|e| format!("DB error: {}", e))?;
    let rows = stmt.query_map(params![limit as i64], |row| Ok(CapabilityReport {
        id: row.get(0)?,
        category: row.get(1)?,
        title: row.get(2)?,
        description: row.get(3)?,
        user_request: row.get(4)?,
        blade_response: row.get(5)?,
        suggested_fix: row.get(6)?,
        severity: row.get(7)?,
        status: row.get(8)?,
        reported_at: row.get(9)?,
        resolved_at: row.get(10)?,
    })).map_err(|e| format!("DB error: {}", e))?
    .filter_map(|r| r.ok()).collect();
    Ok(rows)
}

pub fn update_report_status(conn: &Connection, id: &str, status: &str) -> Result<(), String> {
    let resolved_at = if status == "resolved" { Some(chrono::Utc::now().timestamp_millis()) } else { None };
    conn.execute(
        "UPDATE capability_reports SET status=?1, resolved_at=?2 WHERE id=?3",
        params![status, resolved_at, id],
    ).map_err(|e| format!("DB error: {}", e))?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Conversations — CRUD
// ---------------------------------------------------------------------------

/// Returns all conversations ordered by most-recently-updated first.
pub fn list_conversations(conn: &Connection) -> Result<Vec<ConversationRow>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, title, created_at, updated_at, message_count, pinned
             FROM conversations
             ORDER BY pinned DESC, updated_at DESC",
        )
        .map_err(|e| format!("DB error: {}", e))?;

    let rows = stmt
        .query_map([], |row| {
            Ok(ConversationRow {
                id: row.get(0)?,
                title: row.get(1)?,
                created_at: row.get(2)?,
                updated_at: row.get(3)?,
                message_count: row.get(4)?,
                pinned: row.get::<_, i64>(5)? != 0,
            })
        })
        .map_err(|e| format!("DB error: {}", e))?;

    let mut conversations = Vec::new();
    for row in rows {
        conversations.push(row.map_err(|e| format!("DB error: {}", e))?);
    }
    Ok(conversations)
}

/// Fetches a single conversation together with all of its messages.
pub fn get_conversation(conn: &Connection, id: &str) -> Result<ConversationWithMessages, String> {
    let conversation = conn
        .query_row(
            "SELECT id, title, created_at, updated_at, message_count, pinned
             FROM conversations WHERE id = ?1",
            params![id],
            |row| {
                Ok(ConversationRow {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    created_at: row.get(2)?,
                    updated_at: row.get(3)?,
                    message_count: row.get(4)?,
                    pinned: row.get::<_, i64>(5)? != 0,
                })
            },
        )
        .map_err(|e| format!("DB error: {}", e))?;

    let mut stmt = conn
        .prepare(
            "SELECT id, conversation_id, role, content, image_base64, timestamp
             FROM messages
             WHERE conversation_id = ?1
             ORDER BY timestamp ASC",
        )
        .map_err(|e| format!("DB error: {}", e))?;

    let msg_rows = stmt
        .query_map(params![id], |row| {
            Ok(MessageRow {
                id: row.get(0)?,
                conversation_id: row.get(1)?,
                role: row.get(2)?,
                content: row.get(3)?,
                image_base64: row.get(4)?,
                timestamp: row.get(5)?,
            })
        })
        .map_err(|e| format!("DB error: {}", e))?;

    let mut messages = Vec::new();
    for msg in msg_rows {
        messages.push(msg.map_err(|e| format!("DB error: {}", e))?);
    }

    Ok(ConversationWithMessages {
        conversation,
        messages,
    })
}

/// Upserts a conversation and replaces all of its messages atomically.
/// Returns the saved `ConversationRow`.
pub fn save_conversation(
    conn: &Connection,
    id: &str,
    title: &str,
    messages: &[MessageRow],
) -> Result<ConversationRow, String> {
    let now = chrono::Utc::now().timestamp_millis();
    let message_count = messages.len() as i64;

    // Check whether the conversation already exists so we can preserve
    // the original created_at timestamp.
    let existing_created_at: Option<i64> = conn
        .query_row(
            "SELECT created_at FROM conversations WHERE id = ?1",
            params![id],
            |row| row.get(0),
        )
        .ok();

    let created_at = existing_created_at.unwrap_or(now);

    // Upsert conversation
    conn.execute(
        "INSERT INTO conversations (id, title, created_at, updated_at, message_count)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(id) DO UPDATE SET
             title = excluded.title,
             updated_at = excluded.updated_at,
             message_count = excluded.message_count",
        params![id, title, created_at, now, message_count],
    )
    .map_err(|e| format!("DB error: {}", e))?;

    // Delete old messages for this conversation
    conn.execute(
        "DELETE FROM messages WHERE conversation_id = ?1",
        params![id],
    )
    .map_err(|e| format!("DB error: {}", e))?;

    // Insert new messages
    let mut stmt = conn
        .prepare(
            "INSERT INTO messages (id, conversation_id, role, content, image_base64, timestamp)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        )
        .map_err(|e| format!("DB error: {}", e))?;

    for msg in messages {
        stmt.execute(params![
            msg.id,
            msg.conversation_id,
            msg.role,
            msg.content,
            msg.image_base64,
            msg.timestamp,
        ])
        .map_err(|e| format!("DB error: {}", e))?;
    }

    // Rebuild FTS index for affected messages
    rebuild_messages_fts(conn, id)?;

    // Read back the saved conversation to return it
    let pinned: i64 = conn
        .query_row(
            "SELECT pinned FROM conversations WHERE id = ?1",
            params![id],
            |row| row.get(0),
        )
        .map_err(|e| format!("DB error: {}", e))?;

    Ok(ConversationRow {
        id: id.to_string(),
        title: title.to_string(),
        created_at,
        updated_at: now,
        message_count,
        pinned: pinned != 0,
    })
}

/// Deletes a conversation and all associated messages (CASCADE).
pub fn delete_conversation(conn: &Connection, id: &str) -> Result<(), String> {
    // Delete messages first (in case foreign key cascade isn't enforced)
    conn.execute(
        "DELETE FROM messages WHERE conversation_id = ?1",
        params![id],
    )
    .map_err(|e| format!("DB error: {}", e))?;

    conn.execute("DELETE FROM conversations WHERE id = ?1", params![id])
        .map_err(|e| format!("DB error: {}", e))?;

    Ok(())
}

// ---------------------------------------------------------------------------
// Conversations — FTS helpers
// ---------------------------------------------------------------------------

/// Rebuilds the FTS index entries for all messages in a given conversation.
fn rebuild_messages_fts(conn: &Connection, conversation_id: &str) -> Result<(), String> {
    // Remove stale FTS entries for this conversation's messages by rowid
    // We do a full rebuild of the FTS content for these messages.
    // First, get the rowids we need to care about.
    let mut stmt = conn
        .prepare("SELECT rowid, content FROM messages WHERE conversation_id = ?1")
        .map_err(|e| format!("DB error: {}", e))?;

    let rows: Vec<(i64, String)> = stmt
        .query_map(params![conversation_id], |row| {
            Ok((row.get(0)?, row.get(1)?))
        })
        .map_err(|e| format!("DB error: {}", e))?
        .filter_map(|r| r.ok())
        .collect();

    // Delete old FTS rows for these rowids, then re-insert
    for (rowid, _) in &rows {
        // Delete uses the special FTS5 delete command
        let _ = conn.execute(
            "INSERT INTO messages_fts(messages_fts, rowid, content) VALUES('delete', ?1, '')",
            params![rowid],
        );
    }

    for (rowid, content) in &rows {
        conn.execute(
            "INSERT INTO messages_fts(rowid, content) VALUES(?1, ?2)",
            params![rowid, content],
        )
        .map_err(|e| format!("DB error: {}", e))?;
    }

    Ok(())
}

/// Full-text search across all messages using FTS5.
/// Returns results ranked by relevance (best first).
pub fn search_messages(conn: &Connection, query: &str) -> Result<Vec<SearchResult>, String> {
    if query.trim().is_empty() {
        return Ok(Vec::new());
    }

    // Sanitize the query for FTS5: wrap each word in double quotes to avoid
    // syntax errors from special characters.
    let sanitized = sanitize_fts_query(query);

    let mut stmt = conn
        .prepare(
            "SELECT m.id, m.conversation_id, m.role, m.content, m.timestamp, f.rank
             FROM messages_fts f
             JOIN messages m ON m.rowid = f.rowid
             WHERE messages_fts MATCH ?1
             ORDER BY f.rank
             LIMIT 50",
        )
        .map_err(|e| format!("DB error: {}", e))?;

    let rows = stmt
        .query_map(params![sanitized], |row| {
            Ok(SearchResult {
                message_id: row.get(0)?,
                conversation_id: row.get(1)?,
                role: row.get(2)?,
                content: row.get(3)?,
                timestamp: row.get(4)?,
                rank: row.get(5)?,
            })
        })
        .map_err(|e| format!("DB error: {}", e))?;

    let mut results = Vec::new();
    for row in rows {
        results.push(row.map_err(|e| format!("DB error: {}", e))?);
    }
    Ok(results)
}

/// Escapes / sanitizes a user query for FTS5 MATCH. Each whitespace-separated
/// token is wrapped in double quotes so that special FTS5 operators (AND, OR,
/// NOT, *, etc.) are treated as literals.
fn sanitize_fts_query(query: &str) -> String {
    query
        .split_whitespace()
        .map(|word| {
            // Escape any double quotes inside the word
            let escaped = word.replace('"', "\"\"");
            format!("\"{}\"", escaped)
        })
        .collect::<Vec<_>>()
        .join(" ")
}

// ---------------------------------------------------------------------------
// Knowledge — CRUD
// ---------------------------------------------------------------------------

/// Returns all knowledge entries ordered by most-recently-updated first.
pub fn list_knowledge(conn: &Connection) -> Result<Vec<KnowledgeRow>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, title, content, tags, source, conversation_id, created_at, updated_at
             FROM knowledge_entries
             ORDER BY updated_at DESC",
        )
        .map_err(|e| format!("DB error: {}", e))?;

    let rows = stmt
        .query_map([], |row| {
            Ok(KnowledgeRow {
                id: row.get(0)?,
                title: row.get(1)?,
                content: row.get(2)?,
                tags: row.get(3)?,
                source: row.get(4)?,
                conversation_id: row.get(5)?,
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
            })
        })
        .map_err(|e| format!("DB error: {}", e))?;

    let mut entries = Vec::new();
    for row in rows {
        entries.push(row.map_err(|e| format!("DB error: {}", e))?);
    }
    Ok(entries)
}

/// Inserts a new knowledge entry and updates the FTS index.
pub fn add_knowledge(conn: &Connection, entry: &KnowledgeRow) -> Result<(), String> {
    conn.execute(
        "INSERT INTO knowledge_entries (id, title, content, tags, source, conversation_id, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            entry.id,
            entry.title,
            entry.content,
            entry.tags,
            entry.source,
            entry.conversation_id,
            entry.created_at,
            entry.updated_at,
        ],
    )
    .map_err(|e| format!("DB error: {}", e))?;

    // Insert into FTS index
    let rowid: i64 = conn
        .query_row(
            "SELECT rowid FROM knowledge_entries WHERE id = ?1",
            params![entry.id],
            |row| row.get(0),
        )
        .map_err(|e| format!("DB error: {}", e))?;

    conn.execute(
        "INSERT INTO knowledge_fts(rowid, title, content, tags) VALUES(?1, ?2, ?3, ?4)",
        params![rowid, entry.title, entry.content, entry.tags],
    )
    .map_err(|e| format!("DB error: {}", e))?;

    Ok(())
}

/// Updates an existing knowledge entry and refreshes the FTS index.
pub fn update_knowledge(conn: &Connection, entry: &KnowledgeRow) -> Result<(), String> {
    // Grab the rowid and old values for FTS delete before updating
    let (rowid, old_title, old_content, old_tags): (i64, String, String, String) = conn
        .query_row(
            "SELECT rowid, title, content, tags FROM knowledge_entries WHERE id = ?1",
            params![entry.id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .map_err(|e| format!("DB error: {}", e))?;

    conn.execute(
        "UPDATE knowledge_entries
         SET title = ?1, content = ?2, tags = ?3, source = ?4,
             conversation_id = ?5, updated_at = ?6
         WHERE id = ?7",
        params![
            entry.title,
            entry.content,
            entry.tags,
            entry.source,
            entry.conversation_id,
            entry.updated_at,
            entry.id,
        ],
    )
    .map_err(|e| format!("DB error: {}", e))?;

    // Update FTS: delete old entry, insert new
    conn.execute(
        "INSERT INTO knowledge_fts(knowledge_fts, rowid, title, content, tags) VALUES('delete', ?1, ?2, ?3, ?4)",
        params![rowid, old_title, old_content, old_tags],
    )
    .map_err(|e| format!("DB error: {}", e))?;

    conn.execute(
        "INSERT INTO knowledge_fts(rowid, title, content, tags) VALUES(?1, ?2, ?3, ?4)",
        params![rowid, entry.title, entry.content, entry.tags],
    )
    .map_err(|e| format!("DB error: {}", e))?;

    Ok(())
}

/// Deletes a knowledge entry and removes it from the FTS index.
pub fn delete_knowledge(conn: &Connection, id: &str) -> Result<(), String> {
    // Grab rowid and column values for FTS delete
    let result: Result<(i64, String, String, String), _> = conn.query_row(
        "SELECT rowid, title, content, tags FROM knowledge_entries WHERE id = ?1",
        params![id],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
    );

    if let Ok((rowid, old_title, old_content, old_tags)) = result {
        // Remove from FTS
        let _ = conn.execute(
            "INSERT INTO knowledge_fts(knowledge_fts, rowid, title, content, tags) VALUES('delete', ?1, ?2, ?3, ?4)",
            params![rowid, old_title, old_content, old_tags],
        );
    }

    conn.execute("DELETE FROM knowledge_entries WHERE id = ?1", params![id])
        .map_err(|e| format!("DB error: {}", e))?;

    Ok(())
}

/// Full-text search across knowledge entries using FTS5.
pub fn search_knowledge(conn: &Connection, query: &str) -> Result<Vec<KnowledgeRow>, String> {
    if query.trim().is_empty() {
        return Ok(Vec::new());
    }

    let sanitized = sanitize_fts_query(query);

    let mut stmt = conn
        .prepare(
            "SELECT k.id, k.title, k.content, k.tags, k.source, k.conversation_id,
                    k.created_at, k.updated_at
             FROM knowledge_fts f
             JOIN knowledge_entries k ON k.rowid = f.rowid
             WHERE knowledge_fts MATCH ?1
             ORDER BY f.rank
             LIMIT 50",
        )
        .map_err(|e| format!("DB error: {}", e))?;

    let rows = stmt
        .query_map(params![sanitized], |row| {
            Ok(KnowledgeRow {
                id: row.get(0)?,
                title: row.get(1)?,
                content: row.get(2)?,
                tags: row.get(3)?,
                source: row.get(4)?,
                conversation_id: row.get(5)?,
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
            })
        })
        .map_err(|e| format!("DB error: {}", e))?;

    let mut results = Vec::new();
    for row in rows {
        results.push(row.map_err(|e| format!("DB error: {}", e))?);
    }
    Ok(results)
}

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------

/// Records an analytics event with an optional JSON metadata blob.
pub fn track_event(
    conn: &Connection,
    event_type: &str,
    metadata: Option<&str>,
) -> Result<(), String> {
    let now = chrono::Utc::now().timestamp_millis();

    conn.execute(
        "INSERT INTO analytics_events (event_type, timestamp, metadata)
         VALUES (?1, ?2, ?3)",
        params![event_type, now, metadata],
    )
    .map_err(|e| format!("DB error: {}", e))?;

    Ok(())
}

/// Returns all analytics events whose timestamp is >= `since` (epoch millis).
pub fn get_events_since(conn: &Connection, since: i64) -> Result<Vec<AnalyticsEvent>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, event_type, timestamp, metadata
             FROM analytics_events
             WHERE timestamp >= ?1
             ORDER BY timestamp DESC",
        )
        .map_err(|e| format!("DB error: {}", e))?;

    let rows = stmt
        .query_map(params![since], |row| {
            Ok(AnalyticsEvent {
                id: row.get(0)?,
                event_type: row.get(1)?,
                timestamp: row.get(2)?,
                metadata: row.get(3)?,
            })
        })
        .map_err(|e| format!("DB error: {}", e))?;

    let mut events = Vec::new();
    for row in rows {
        events.push(row.map_err(|e| format!("DB error: {}", e))?);
    }
    Ok(events)
}

/// Deletes analytics events older than the given timestamp (epoch millis).
pub fn prune_old_events(conn: &Connection, older_than: i64) -> Result<(), String> {
    conn.execute(
        "DELETE FROM analytics_events WHERE timestamp < ?1",
        params![older_than],
    )
    .map_err(|e| format!("DB error: {}", e))?;

    Ok(())
}

// ---------------------------------------------------------------------------
// Settings — key/value store
// ---------------------------------------------------------------------------

/// Retrieves a setting value by key. Returns `None` if the key does not exist.
pub fn get_setting(conn: &Connection, key: &str) -> Result<Option<String>, String> {
    let result = conn.query_row(
        "SELECT value FROM settings WHERE key = ?1",
        params![key],
        |row| row.get::<_, String>(0),
    );

    match result {
        Ok(value) => Ok(Some(value)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(format!("DB error: {}", e)),
    }
}

/// Upserts a setting value. If the key already exists its value is replaced.
pub fn set_setting(conn: &Connection, key: &str, value: &str) -> Result<(), String> {
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )
    .map_err(|e| format!("DB error: {}", e))?;

    Ok(())
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    /// Creates an in-memory database with all migrations applied.
    fn test_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "foreign_keys", "ON").unwrap();
        run_migrations(&conn).unwrap();
        conn
    }

    #[test]
    fn test_migrations_idempotent() {
        let conn = test_db();
        // Running migrations a second time should be fine
        run_migrations(&conn).unwrap();
    }

    #[test]
    fn test_conversation_crud() {
        let conn = test_db();

        // Initially empty
        let convos = list_conversations(&conn).unwrap();
        assert!(convos.is_empty());

        // Save a conversation with messages
        let messages = vec![
            MessageRow {
                id: "m1".into(),
                conversation_id: "c1".into(),
                role: "user".into(),
                content: "Hello world".into(),
                image_base64: None,
                timestamp: 1000,
            },
            MessageRow {
                id: "m2".into(),
                conversation_id: "c1".into(),
                role: "assistant".into(),
                content: "Hi there!".into(),
                image_base64: None,
                timestamp: 2000,
            },
        ];

        let saved = save_conversation(&conn, "c1", "Test Chat", &messages).unwrap();
        assert_eq!(saved.id, "c1");
        assert_eq!(saved.title, "Test Chat");
        assert_eq!(saved.message_count, 2);

        // List should now contain one conversation
        let convos = list_conversations(&conn).unwrap();
        assert_eq!(convos.len(), 1);
        assert_eq!(convos[0].id, "c1");

        // Get with messages
        let full = get_conversation(&conn, "c1").unwrap();
        assert_eq!(full.messages.len(), 2);
        assert_eq!(full.messages[0].content, "Hello world");

        // Update: change title and messages
        let new_messages = vec![MessageRow {
            id: "m3".into(),
            conversation_id: "c1".into(),
            role: "user".into(),
            content: "New message".into(),
            image_base64: None,
            timestamp: 3000,
        }];
        let updated = save_conversation(&conn, "c1", "Updated Chat", &new_messages).unwrap();
        assert_eq!(updated.title, "Updated Chat");
        assert_eq!(updated.message_count, 1);
        // created_at should be preserved
        assert_eq!(updated.created_at, saved.created_at);

        // Delete
        delete_conversation(&conn, "c1").unwrap();
        let convos = list_conversations(&conn).unwrap();
        assert!(convos.is_empty());
    }

    #[test]
    fn test_search_messages() {
        let conn = test_db();

        let messages = vec![
            MessageRow {
                id: "m1".into(),
                conversation_id: "c1".into(),
                role: "user".into(),
                content: "Tell me about Rust programming".into(),
                image_base64: None,
                timestamp: 1000,
            },
            MessageRow {
                id: "m2".into(),
                conversation_id: "c1".into(),
                role: "assistant".into(),
                content: "Rust is a systems programming language".into(),
                image_base64: None,
                timestamp: 2000,
            },
        ];

        save_conversation(&conn, "c1", "Rust Chat", &messages).unwrap();

        let results = search_messages(&conn, "Rust").unwrap();
        assert!(!results.is_empty());

        // Empty query returns empty
        let results = search_messages(&conn, "").unwrap();
        assert!(results.is_empty());
    }

    #[test]
    fn test_knowledge_crud() {
        let conn = test_db();

        let entry = KnowledgeRow {
            id: "k1".into(),
            title: "Rust Tips".into(),
            content: "Always use clippy for linting".into(),
            tags: "[\"rust\", \"tips\"]".into(),
            source: "manual".into(),
            conversation_id: None,
            created_at: 1000,
            updated_at: 1000,
        };

        add_knowledge(&conn, &entry).unwrap();

        let entries = list_knowledge(&conn).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].title, "Rust Tips");

        // Update
        let mut updated_entry = entry.clone();
        updated_entry.title = "Rust Best Practices".into();
        updated_entry.updated_at = 2000;
        update_knowledge(&conn, &updated_entry).unwrap();

        let entries = list_knowledge(&conn).unwrap();
        assert_eq!(entries[0].title, "Rust Best Practices");

        // Search
        let results = search_knowledge(&conn, "clippy").unwrap();
        assert!(!results.is_empty());

        // Delete
        delete_knowledge(&conn, "k1").unwrap();
        let entries = list_knowledge(&conn).unwrap();
        assert!(entries.is_empty());
    }

    #[test]
    fn test_analytics() {
        let conn = test_db();

        track_event(&conn, "app_open", None).unwrap();
        track_event(&conn, "message_sent", Some("{\"model\": \"gpt-4\"}")).unwrap();

        let events = get_events_since(&conn, 0).unwrap();
        assert_eq!(events.len(), 2);
        assert_eq!(events[0].event_type, "message_sent"); // DESC order

        // Prune: set threshold in the far future to delete all
        prune_old_events(&conn, i64::MAX).unwrap();
        let events = get_events_since(&conn, 0).unwrap();
        assert!(events.is_empty());
    }

    #[test]
    fn test_settings() {
        let conn = test_db();

        // Non-existent key returns None
        assert_eq!(get_setting(&conn, "theme").unwrap(), None);

        // Set and get
        set_setting(&conn, "theme", "dark").unwrap();
        assert_eq!(get_setting(&conn, "theme").unwrap(), Some("dark".into()));

        // Overwrite
        set_setting(&conn, "theme", "light").unwrap();
        assert_eq!(get_setting(&conn, "theme").unwrap(), Some("light".into()));
    }
}

// ---------------------------------------------------------------------------
// Brain — CRUD
// ---------------------------------------------------------------------------

pub fn brain_get_identity(conn: &Connection) -> Result<std::collections::HashMap<String, String>, String> {
    let mut stmt = conn
        .prepare("SELECT key, value FROM brain_identity")
        .map_err(|e| format!("DB error: {}", e))?;
    let map: std::collections::HashMap<String, String> = stmt
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
        .map_err(|e| format!("DB error: {}", e))?
        .filter_map(|r| r.ok())
        .collect();
    Ok(map)
}

pub fn brain_set_identity(conn: &Connection, key: &str, value: &str) -> Result<(), String> {
    conn.execute(
        "INSERT INTO brain_identity(key, value) VALUES(?1, ?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        params![key, value],
    )
    .map_err(|e| format!("DB error: {}", e))?;
    Ok(())
}

pub fn brain_get_style_tags(conn: &Connection) -> Result<Vec<String>, String> {
    let mut stmt = conn.prepare("SELECT tag FROM brain_style_tags ORDER BY tag").map_err(|e| format!("DB error: {}", e))?;
    let tags = stmt.query_map([], |row| row.get(0)).map_err(|e| format!("DB error: {}", e))?.filter_map(|r| r.ok()).collect();
    Ok(tags)
}

pub fn brain_get_style_tag_entries(conn: &Connection) -> Result<Vec<BrainStyleTagRow>, String> {
    let mut stmt = conn
        .prepare("SELECT id, tag FROM brain_style_tags ORDER BY tag")
        .map_err(|e| format!("DB error: {}", e))?;
    let rows = stmt
        .query_map([], |row| {
            Ok(BrainStyleTagRow {
                id: row.get(0)?,
                tag: row.get(1)?,
            })
        })
        .map_err(|e| format!("DB error: {}", e))?
        .filter_map(|r| r.ok())
        .collect();
    Ok(rows)
}

pub fn brain_add_style_tag(conn: &Connection, id: &str, tag: &str) -> Result<(), String> {
    conn.execute("INSERT OR IGNORE INTO brain_style_tags(id, tag) VALUES(?1, ?2)", params![id, tag]).map_err(|e| format!("DB error: {}", e))?;
    Ok(())
}

pub fn brain_remove_style_tag(conn: &Connection, id: &str) -> Result<(), String> {
    conn.execute("DELETE FROM brain_style_tags WHERE id=?1", params![id]).map_err(|e| format!("DB error: {}", e))?;
    Ok(())
}

pub fn brain_get_preferences(conn: &Connection) -> Result<Vec<BrainPreferenceRow>, String> {
    let mut stmt = conn.prepare("SELECT id, text, confidence, source, updated_at FROM brain_preferences ORDER BY confidence DESC").map_err(|e| format!("DB error: {}", e))?;
    let rows = stmt.query_map([], |row| Ok(BrainPreferenceRow {
        id: row.get(0)?, text: row.get(1)?, confidence: row.get(2)?, source: row.get(3)?, updated_at: row.get(4)?,
    })).map_err(|e| format!("DB error: {}", e))?.filter_map(|r| r.ok()).collect();
    Ok(rows)
}

pub fn brain_upsert_preference(conn: &Connection, id: &str, text: &str, confidence: f64, source: &str) -> Result<(), String> {
    let now = chrono::Utc::now().timestamp_millis();
    conn.execute(
        "INSERT INTO brain_preferences(id, text, confidence, source, updated_at) VALUES(?1,?2,?3,?4,?5) ON CONFLICT(id) DO UPDATE SET text=excluded.text, confidence=excluded.confidence, source=excluded.source, updated_at=excluded.updated_at",
        params![id, text, confidence, source, now],
    ).map_err(|e| format!("DB error: {}", e))?;
    Ok(())
}

pub fn brain_delete_preference(conn: &Connection, id: &str) -> Result<(), String> {
    conn.execute("DELETE FROM brain_preferences WHERE id=?1", params![id]).map_err(|e| format!("DB error: {}", e))?;
    Ok(())
}

pub fn brain_get_memories(conn: &Connection, limit: i64) -> Result<Vec<BrainMemoryRow>, String> {
    let mut stmt = conn.prepare("SELECT id, text, source_conversation_id, entities_json, confidence, created_at, expires_at FROM brain_memories WHERE (expires_at IS NULL OR expires_at > ?1) ORDER BY created_at DESC LIMIT ?2").map_err(|e| format!("DB error: {}", e))?;
    let now = chrono::Utc::now().timestamp_millis();
    let rows = stmt.query_map(params![now, limit], |row| Ok(BrainMemoryRow {
        id: row.get(0)?, text: row.get(1)?, source_conversation_id: row.get(2)?, entities_json: row.get(3)?, confidence: row.get(4)?, created_at: row.get(5)?, expires_at: row.get(6)?,
    })).map_err(|e| format!("DB error: {}", e))?.filter_map(|r| r.ok()).collect();
    Ok(rows)
}

pub fn brain_add_memory(conn: &Connection, id: &str, text: &str, source_conversation_id: &str, entities_json: &str, confidence: f64, expires_at: Option<i64>) -> Result<(), String> {
    let now = chrono::Utc::now().timestamp_millis();
    // Enforce 500-entry cap: delete oldest if over limit
    let count: i64 = conn.query_row("SELECT COUNT(*) FROM brain_memories", [], |row| row.get(0)).unwrap_or(0);
    if count >= 500 {
        conn.execute("DELETE FROM brain_memories WHERE id IN (SELECT id FROM brain_memories ORDER BY confidence ASC, created_at ASC LIMIT 10)", []).ok();
    }
    conn.execute(
        "INSERT OR IGNORE INTO brain_memories(id, text, source_conversation_id, entities_json, confidence, created_at, expires_at) VALUES(?1,?2,?3,?4,?5,?6,?7)",
        params![id, text, source_conversation_id, entities_json, confidence, now, expires_at],
    ).map_err(|e| format!("DB error: {}", e))?;
    Ok(())
}

pub fn brain_delete_memory(conn: &Connection, id: &str) -> Result<(), String> {
    conn.execute("DELETE FROM brain_memories WHERE id=?1", params![id]).map_err(|e| format!("DB error: {}", e))?;
    Ok(())
}

pub fn brain_clear_memories(conn: &Connection) -> Result<(), String> {
    conn.execute("DELETE FROM brain_memories", []).map_err(|e| format!("DB error: {}", e))?;
    Ok(())
}

pub fn brain_get_nodes(conn: &Connection) -> Result<Vec<BrainNodeRow>, String> {
    let mut stmt = conn.prepare("SELECT id, label, kind, summary, mention_count, last_seen_at FROM brain_nodes ORDER BY mention_count DESC").map_err(|e| format!("DB error: {}", e))?;
    let rows = stmt.query_map([], |row| Ok(BrainNodeRow {
        id: row.get(0)?, label: row.get(1)?, kind: row.get(2)?, summary: row.get(3)?, mention_count: row.get(4)?, last_seen_at: row.get(5)?,
    })).map_err(|e| format!("DB error: {}", e))?.filter_map(|r| r.ok()).collect();
    Ok(rows)
}

pub fn brain_upsert_node(conn: &Connection, id: &str, label: &str, kind: &str, summary: &str) -> Result<(), String> {
    let now = chrono::Utc::now().timestamp_millis();
    conn.execute(
        "INSERT INTO brain_nodes(id, label, kind, summary, mention_count, last_seen_at) VALUES(?1,?2,?3,?4,1,?5) ON CONFLICT(id) DO UPDATE SET mention_count=mention_count+1, last_seen_at=excluded.last_seen_at, summary=CASE WHEN excluded.summary!='' THEN excluded.summary ELSE summary END",
        params![id, label, kind, summary, now],
    ).map_err(|e| format!("DB error: {}", e))?;
    Ok(())
}

pub fn brain_delete_node(conn: &Connection, id: &str) -> Result<(), String> {
    conn.execute("DELETE FROM brain_nodes WHERE id=?1", params![id]).map_err(|e| format!("DB error: {}", e))?;
    Ok(())
}

pub fn brain_get_edges(conn: &Connection) -> Result<Vec<BrainEdgeRow>, String> {
    let mut stmt = conn.prepare("SELECT id, from_id, to_id, label, weight FROM brain_edges ORDER BY weight DESC").map_err(|e| format!("DB error: {}", e))?;
    let rows = stmt.query_map([], |row| Ok(BrainEdgeRow {
        id: row.get(0)?, from_id: row.get(1)?, to_id: row.get(2)?, label: row.get(3)?, weight: row.get(4)?,
    })).map_err(|e| format!("DB error: {}", e))?.filter_map(|r| r.ok()).collect();
    Ok(rows)
}

pub fn brain_upsert_edge(conn: &Connection, id: &str, from_id: &str, to_id: &str, label: &str) -> Result<(), String> {
    conn.execute(
        "INSERT INTO brain_edges(id, from_id, to_id, label, weight) VALUES(?1,?2,?3,?4,1) ON CONFLICT(from_id, to_id, label) DO UPDATE SET weight=weight+1",
        params![id, from_id, to_id, label],
    ).map_err(|e| format!("DB error: {}", e))?;
    Ok(())
}

pub fn brain_get_skills(conn: &Connection) -> Result<Vec<BrainSkillRow>, String> {
    let mut stmt = conn.prepare("SELECT id, name, trigger_pattern, prompt_modifier, tools_json, usage_count, active, created_at FROM brain_skills ORDER BY usage_count DESC").map_err(|e| format!("DB error: {}", e))?;
    let rows = stmt.query_map([], |row| Ok(BrainSkillRow {
        id: row.get(0)?, name: row.get(1)?, trigger_pattern: row.get(2)?, prompt_modifier: row.get(3)?, tools_json: row.get(4)?, usage_count: row.get(5)?, active: row.get::<_, i64>(6)? != 0, created_at: row.get(7)?,
    })).map_err(|e| format!("DB error: {}", e))?.filter_map(|r| r.ok()).collect();
    Ok(rows)
}

pub fn brain_upsert_skill(conn: &Connection, id: &str, name: &str, trigger_pattern: &str, prompt_modifier: &str, tools_json: &str) -> Result<(), String> {
    let now = chrono::Utc::now().timestamp_millis();
    conn.execute(
        "INSERT INTO brain_skills(id, name, trigger_pattern, prompt_modifier, tools_json, usage_count, active, created_at) VALUES(?1,?2,?3,?4,?5,0,1,?6) ON CONFLICT(id) DO UPDATE SET name=excluded.name, trigger_pattern=excluded.trigger_pattern, prompt_modifier=excluded.prompt_modifier, tools_json=excluded.tools_json",
        params![id, name, trigger_pattern, prompt_modifier, tools_json, now],
    ).map_err(|e| format!("DB error: {}", e))?;
    Ok(())
}

pub fn brain_delete_skill(conn: &Connection, id: &str) -> Result<(), String> {
    conn.execute("DELETE FROM brain_skills WHERE id=?1", params![id]).map_err(|e| format!("DB error: {}", e))?;
    Ok(())
}

pub fn brain_set_skill_active(conn: &Connection, id: &str, active: bool) -> Result<(), String> {
    conn.execute("UPDATE brain_skills SET active=?1 WHERE id=?2", params![active as i64, id]).map_err(|e| format!("DB error: {}", e))?;
    Ok(())
}

pub fn brain_increment_skill_usage(conn: &Connection, id: &str) -> Result<(), String> {
    conn.execute("UPDATE brain_skills SET usage_count=usage_count+1 WHERE id=?1", params![id]).map_err(|e| format!("DB error: {}", e))?;
    Ok(())
}

pub fn brain_add_reaction(conn: &Connection, id: &str, message_id: &str, polarity: i64, content: &str, context_json: &str) -> Result<(), String> {
    let now = chrono::Utc::now().timestamp_millis();
    conn.execute(
        "INSERT OR IGNORE INTO brain_reactions(id, message_id, polarity, content, context_json, created_at) VALUES(?1,?2,?3,?4,?5,?6)",
        params![id, message_id, polarity, content, context_json, now],
    ).map_err(|e| format!("DB error: {}", e))?;
    Ok(())
}

pub fn brain_get_reactions(conn: &Connection, limit: i64) -> Result<Vec<BrainReactionRow>, String> {
    let mut stmt = conn.prepare("SELECT id, message_id, polarity, content, context_json, created_at FROM brain_reactions ORDER BY created_at DESC LIMIT ?1").map_err(|e| format!("DB error: {}", e))?;
    let rows = stmt.query_map(params![limit], |row| Ok(BrainReactionRow {
        id: row.get(0)?, message_id: row.get(1)?, polarity: row.get(2)?, content: row.get(3)?, context_json: row.get(4)?, created_at: row.get(5)?,
    })).map_err(|e| format!("DB error: {}", e))?.filter_map(|r| r.ok()).collect();
    Ok(rows)
}

/// Builds the character bible context string for injection into the system prompt.
/// Respects a soft token budget (1 token ≈ 4 chars).
pub fn brain_build_context(conn: &Connection, budget_tokens: usize) -> String {
    let budget_chars = budget_tokens * 4;
    let mut parts: Vec<String> = Vec::new();

    // Identity block
    let identity = brain_get_identity(conn).unwrap_or_default();
    let name = identity.get("name").cloned().unwrap_or_default();
    let role = identity.get("role").cloned().unwrap_or_default();
    if !name.is_empty() || !role.is_empty() {
        parts.push(format!("## About the User\nName: {}\nRole: {}", name, role));
    }

    // Style tags
    if let Ok(tags) = brain_get_style_tags(conn) {
        if !tags.is_empty() {
            parts.push(format!("Working style: {}", tags.join(", ")));
        }
    }

    // Top preferences (confidence > 0.6)
    if let Ok(prefs) = brain_get_preferences(conn) {
        let high_conf: Vec<String> = prefs.iter().filter(|p| p.confidence > 0.6).take(5).map(|p| format!("- {}", p.text)).collect();
        if !high_conf.is_empty() {
            parts.push(format!("Preferences:\n{}", high_conf.join("\n")));
        }
    }

    // Recent memories (trim to budget)
    if let Ok(memories) = brain_get_memories(conn, 20) {
        let mem_lines: Vec<String> = memories.iter().map(|m| format!("- {}", m.text)).collect();
        if !mem_lines.is_empty() {
            parts.push(format!("Known facts:\n{}", mem_lines.join("\n")));
        }
    }

    // Knowledge graph summary (top nodes by mention)
    if let Ok(nodes) = brain_get_nodes(conn) {
        let top: Vec<String> = nodes.iter().take(10).map(|n| format!("- {} ({})", n.label, n.kind)).collect();
        if !top.is_empty() {
            parts.push(format!("Key entities:\n{}", top.join("\n")));
        }
    }

    let result = parts.join("\n\n");
    if result.len() > budget_chars {
        result[..budget_chars].to_string()
    } else {
        result
    }
}

// ---------------------------------------------------------------------------
// THREAD — working memory CRUD
// ---------------------------------------------------------------------------

pub fn thread_get(conn: &Connection) -> Option<String> {
    conn.query_row(
        "SELECT content FROM active_threads ORDER BY updated_at DESC LIMIT 1",
        [],
        |row| row.get::<_, String>(0),
    )
    .ok()
    .filter(|s| !s.trim().is_empty())
}

pub fn thread_get_full(conn: &Connection) -> Option<(String, String, String)> {
    conn.query_row(
        "SELECT title, content, project FROM active_threads ORDER BY updated_at DESC LIMIT 1",
        [],
        |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?)),
    )
    .ok()
}

pub fn thread_upsert(conn: &Connection, title: &str, content: &str, project: &str) -> Result<(), String> {
    let now = chrono::Utc::now().timestamp_millis();
    // Use project as the natural key
    let id = format!("thread-{}", project.to_lowercase().replace(' ', "-"));
    conn.execute(
        "INSERT INTO active_threads(id, title, content, project, updated_at, turn_count)
         VALUES(?1, ?2, ?3, ?4, ?5, 1)
         ON CONFLICT(id) DO UPDATE SET
             title = excluded.title,
             content = excluded.content,
             updated_at = excluded.updated_at,
             turn_count = turn_count + 1",
        params![id, title, content, project, now],
    )
    .map_err(|e| format!("DB error: {}", e))?;
    Ok(())
}

// ---------------------------------------------------------------------------
// SKILL ENGINE — candidate CRUD
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct SkillCandidateRow {
    pub id: i64,
    pub query_hash: String,
    pub query_example: String,
    pub tool_sequence: String,
    pub result_summary: String,
    pub count: i64,
    pub last_seen: i64,
}

pub fn skill_candidate_record(
    conn: &Connection,
    query_hash: &str,
    query_example: &str,
    tool_sequence: &str,
    result_summary: &str,
) -> Result<(), String> {
    let now = chrono::Utc::now().timestamp_millis();
    conn.execute(
        "INSERT INTO skill_candidates(query_hash, query_example, tool_sequence, result_summary, count, last_seen)
         VALUES(?1, ?2, ?3, ?4, 1, ?5)
         ON CONFLICT(query_hash) DO UPDATE SET
             count = count + 1,
             last_seen = excluded.last_seen",
        params![query_hash, query_example, tool_sequence, result_summary, now],
    )
    .map_err(|e| format!("DB error: {}", e))?;
    Ok(())
}

pub fn skill_candidates_ripe(conn: &Connection, threshold: i64) -> Result<Vec<SkillCandidateRow>, String> {
    let mut stmt = conn.prepare(
        "SELECT id, query_hash, query_example, tool_sequence, result_summary, count, last_seen
         FROM skill_candidates WHERE count >= ?1 ORDER BY count DESC"
    ).map_err(|e| format!("DB error: {}", e))?;
    let rows = stmt.query_map(params![threshold], |row| {
        Ok(SkillCandidateRow {
            id: row.get(0)?,
            query_hash: row.get(1)?,
            query_example: row.get(2)?,
            tool_sequence: row.get(3)?,
            result_summary: row.get(4)?,
            count: row.get(5)?,
            last_seen: row.get(6)?,
        })
    }).map_err(|e| format!("DB error: {}", e))?
    .filter_map(|r| r.ok()).collect();
    Ok(rows)
}

pub fn skill_candidate_delete(conn: &Connection, id: i64) -> Result<(), String> {
    conn.execute("DELETE FROM skill_candidates WHERE id=?1", params![id])
        .map_err(|e| format!("DB error: {}", e))?;
    Ok(())
}

/// Record a single event in the activity timeline.
/// event_type: "window_switch" | "clipboard" | "conversation" | "tool_call" | "god_mode" | "file"
pub fn timeline_record(
    conn: &Connection,
    event_type: &str,
    title: &str,
    content: &str,
    app_name: &str,
    metadata_json: &str,
) -> Result<i64, String> {
    let ts = chrono::Utc::now().timestamp();
    conn.execute(
        "INSERT INTO activity_timeline (timestamp, event_type, title, content, app_name, metadata)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![ts, event_type, title, content, app_name, metadata_json],
    )
    .map_err(|e| format!("DB error: {}", e))?;
    Ok(conn.last_insert_rowid())
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct TimelineEvent {
    pub id: i64,
    pub timestamp: i64,
    pub event_type: String,
    pub title: String,
    pub content: String,
    pub app_name: String,
    pub metadata: String,
}

/// Fetch the N most recent timeline events, optionally filtered by event_type.
pub fn timeline_recent(
    conn: &Connection,
    limit: i64,
    event_type_filter: Option<&str>,
) -> Result<Vec<TimelineEvent>, String> {
    let rows: Vec<TimelineEvent> = if let Some(et) = event_type_filter {
        let mut stmt = conn.prepare(
            "SELECT id, timestamp, event_type, title, content, app_name, metadata
             FROM activity_timeline WHERE event_type=?1
             ORDER BY timestamp DESC LIMIT ?2",
        ).map_err(|e| format!("DB error: {}", e))?;
        let mapped = stmt.query_map(params![et, limit], |row| {
            Ok(TimelineEvent {
                id: row.get(0)?,
                timestamp: row.get(1)?,
                event_type: row.get(2)?,
                title: row.get(3)?,
                content: row.get(4)?,
                app_name: row.get(5)?,
                metadata: row.get(6)?,
            })
        }).map_err(|e| format!("DB error: {}", e))?;
        mapped.filter_map(|r| r.ok()).collect()
    } else {
        let mut stmt = conn.prepare(
            "SELECT id, timestamp, event_type, title, content, app_name, metadata
             FROM activity_timeline ORDER BY timestamp DESC LIMIT ?1",
        ).map_err(|e| format!("DB error: {}", e))?;
        let mapped = stmt.query_map(params![limit], |row| {
            Ok(TimelineEvent {
                id: row.get(0)?,
                timestamp: row.get(1)?,
                event_type: row.get(2)?,
                title: row.get(3)?,
                content: row.get(4)?,
                app_name: row.get(5)?,
                metadata: row.get(6)?,
            })
        }).map_err(|e| format!("DB error: {}", e))?;
        mapped.filter_map(|r| r.ok()).collect()
    };
    Ok(rows)
}

/// Prune timeline events older than N days
pub fn timeline_prune(conn: &Connection, days: i64) -> Result<usize, String> {
    let cutoff = chrono::Utc::now().timestamp() - (days * 86400);
    let n = conn.execute(
        "DELETE FROM activity_timeline WHERE timestamp < ?1",
        params![cutoff],
    ).map_err(|e| format!("DB error: {}", e))?;
    Ok(n)
}
