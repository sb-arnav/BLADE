/// BLADE EXECUTION MEMORY — every shell command BLADE has ever run, stored forever.
///
/// Claude Code forgets every command it ran the moment the session ends.
/// BLADE remembers. When it sees an error, it checks if it's solved this before.
/// When it runs a build, it knows which flags worked last time.
///
/// This is the second pillar of BLADE's superiority: execution that learns.
///
/// Schema:
///   executions(id, command, cwd, stdout, stderr, exit_code, duration_ms, timestamp)
///   executions_fts (FTS5 virtual table over command + stdout + stderr)
///
/// On every blade_bash call, output is recorded. On error, semantic search
/// over past executions is automatic — BLADE may have already solved this.

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecutionRecord {
    pub id: i64,
    pub command: String,
    pub cwd: String,
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
    pub duration_ms: i64,
    pub timestamp: i64,
}

fn db_path() -> PathBuf {
    crate::config::blade_config_dir().join("execmem.db")
}

fn open_db() -> Result<Connection, String> {
    let path = db_path();
    let conn = Connection::open(&path).map_err(|e| format!("ExecMem DB error: {}", e))?;
    init_schema(&conn)?;
    Ok(conn)
}

fn init_schema(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS executions (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            command     TEXT NOT NULL,
            cwd         TEXT NOT NULL DEFAULT '',
            stdout      TEXT NOT NULL DEFAULT '',
            stderr      TEXT NOT NULL DEFAULT '',
            exit_code   INTEGER NOT NULL DEFAULT 0,
            duration_ms INTEGER NOT NULL DEFAULT 0,
            timestamp   INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_exec_ts ON executions(timestamp DESC);
        CREATE INDEX IF NOT EXISTS idx_exec_exit ON executions(exit_code);

        CREATE VIRTUAL TABLE IF NOT EXISTS executions_fts USING fts5(
            command,
            stdout,
            stderr,
            content='executions',
            content_rowid='id'
        );

        CREATE TRIGGER IF NOT EXISTS executions_ai AFTER INSERT ON executions BEGIN
            INSERT INTO executions_fts(rowid, command, stdout, stderr)
            VALUES (new.id, new.command, new.stdout, new.stderr);
        END;
        ",
    )
    .map_err(|e| format!("ExecMem schema error: {}", e))
}

/// Record a completed execution. Called automatically from blade_bash.
pub fn record(
    command: &str,
    cwd: &str,
    stdout: &str,
    stderr: &str,
    exit_code: i32,
    duration_ms: i64,
) {
    // Truncate massive outputs — we care about the signal, not the full log
    let stdout = &stdout[..stdout.len().min(8000)];
    let stderr = &stderr[..stderr.len().min(4000)];

    let Ok(conn) = open_db() else { return };
    let now = chrono::Utc::now().timestamp();
    let _ = conn.execute(
        "INSERT INTO executions (command, cwd, stdout, stderr, exit_code, duration_ms, timestamp)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![command, cwd, stdout, stderr, exit_code, duration_ms, now],
    );
}

/// Full-text search over execution history. Returns a formatted summary.
/// Used both by blade_recall_execution tool and by auto-injection on errors.
pub fn search(query: &str, limit: usize) -> Vec<ExecutionRecord> {
    let Ok(conn) = open_db() else { return vec![] };

    // Try FTS5 first, fall back to LIKE
    let fts_results: Result<Vec<ExecutionRecord>, _> = conn
        .prepare(
            "SELECT e.id, e.command, e.cwd, e.stdout, e.stderr, e.exit_code, e.duration_ms, e.timestamp
             FROM executions e
             JOIN executions_fts f ON e.id = f.rowid
             WHERE executions_fts MATCH ?1
             ORDER BY rank
             LIMIT ?2",
        )
        .and_then(|mut stmt| {
            stmt.query_map(params![query, limit as i64], row_to_record)
                .map(|rows| rows.filter_map(|r| r.ok()).collect())
        });

    match fts_results {
        Ok(rows) if !rows.is_empty() => rows,
        _ => {
            // LIKE fallback
            let pattern = format!("%{}%", query);
            conn.prepare(
                "SELECT id, command, cwd, stdout, stderr, exit_code, duration_ms, timestamp
                 FROM executions
                 WHERE command LIKE ?1 OR stdout LIKE ?1 OR stderr LIKE ?1
                 ORDER BY timestamp DESC
                 LIMIT ?2",
            )
            .and_then(|mut stmt| {
                stmt.query_map(params![pattern, limit as i64], row_to_record)
                    .map(|rows| rows.filter_map(|r| r.ok()).collect())
            })
            .unwrap_or_default()
        }
    }
}

fn row_to_record(row: &rusqlite::Row) -> rusqlite::Result<ExecutionRecord> {
    Ok(ExecutionRecord {
        id: row.get(0)?,
        command: row.get(1)?,
        cwd: row.get(2)?,
        stdout: row.get(3)?,
        stderr: row.get(4)?,
        exit_code: row.get(5)?,
        duration_ms: row.get(6)?,
        timestamp: row.get(7)?,
    })
}

/// Format search results as human-readable text for BLADE to read.
fn format_results(records: &[ExecutionRecord]) -> String {
    if records.is_empty() {
        return "No matching executions found in memory.".to_string();
    }

    let mut lines = vec![format!("Found {} past execution(s):\n", records.len())];
    for r in records {
        let ts = chrono::DateTime::from_timestamp(r.timestamp, 0)
            .map(|d| d.format("%Y-%m-%d %H:%M").to_string())
            .unwrap_or_else(|| "unknown".to_string());

        let status = if r.exit_code == 0 { "✓" } else { "✗" };
        lines.push(format!("{} [{}] `{}`", status, ts, r.command));

        if !r.cwd.is_empty() && r.cwd != "/" {
            lines.push(format!("   cwd: {}", r.cwd));
        }

        if !r.stdout.is_empty() {
            let preview = &r.stdout[..r.stdout.len().min(300)];
            lines.push(format!("   out: {}", preview.replace('\n', " ↵ ")));
        }

        if !r.stderr.is_empty() {
            let preview = &r.stderr[..r.stderr.len().min(300)];
            lines.push(format!("   err: {}", preview.replace('\n', " ↵ ")));
        }

        lines.push(String::new());
    }

    lines.join("\n")
}

/// When BLADE encounters an error (exit_code != 0), auto-inject relevant past
/// solutions into context. This is the "I've seen this before" moment.
pub fn recall_on_error(error_text: &str) -> Option<String> {
    // Extract the most signal-dense part of the error
    let query = error_text
        .lines()
        .filter(|l| !l.trim().is_empty())
        .take(3)
        .collect::<Vec<_>>()
        .join(" ");

    if query.len() < 10 {
        return None;
    }

    let results = search(&query, 5);
    // Only inject if we found something where BLADE actually succeeded after the error
    let relevant: Vec<_> = results
        .iter()
        .filter(|r| r.exit_code == 0 || r.stderr.contains(&query[..query.len().min(30)]))
        .take(3)
        .collect();

    if relevant.is_empty() {
        None
    } else {
        Some(format!(
            "⚡ BLADE execution memory — similar past executions:\n\n{}",
            format_results(&relevant)
        ))
    }
}

/// Get recent executions for the session handoff (sync, no error return)
pub fn recent_for_handoff(limit: usize) -> Vec<ExecutionRecord> {
    let Ok(conn) = open_db() else { return vec![] };
    let n = limit as i64;
    conn.prepare(
        "SELECT id, command, cwd, stdout, stderr, exit_code, duration_ms, timestamp
         FROM executions ORDER BY timestamp DESC LIMIT ?1"
    ).ok().and_then(|mut s| {
        s.query_map(rusqlite::params![n], row_to_record).ok()
            .map(|rows| rows.filter_map(|r| r.ok()).collect())
    }).unwrap_or_default()
}

// ── Tauri commands ─────────────────────────────────────────────────────────────

/// Record a completed execution (called from frontend or other commands if needed).
#[tauri::command]
pub async fn exmem_record(
    command: String,
    cwd: String,
    stdout: String,
    stderr: String,
    exit_code: i32,
    duration_ms: i64,
) -> Result<(), String> {
    record(&command, &cwd, &stdout, &stderr, exit_code, duration_ms);
    Ok(())
}

/// Search execution memory — returns formatted text.
#[tauri::command]
pub async fn exmem_search(query: String, limit: Option<usize>) -> Result<String, String> {
    let records = search(&query, limit.unwrap_or(10));
    Ok(format_results(&records))
}

/// Get the N most recent executions regardless of content.
#[tauri::command]
pub async fn exmem_recent(limit: Option<usize>) -> Result<Vec<ExecutionRecord>, String> {
    let conn = open_db()?;
    let n = limit.unwrap_or(20) as i64;
    let mut stmt = conn
        .prepare(
            "SELECT id, command, cwd, stdout, stderr, exit_code, duration_ms, timestamp
             FROM executions ORDER BY timestamp DESC LIMIT ?1",
        )
        .map_err(|e| e.to_string())?;

    let records = stmt
        .query_map(params![n], row_to_record)
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    Ok(records)
}
