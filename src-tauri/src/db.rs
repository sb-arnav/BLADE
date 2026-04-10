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
