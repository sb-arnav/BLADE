//! consent.rs — per-action consent decisions persisted in SQLite blade.db
//!
//! Phase 18 (chat-first reinterpretation) — see 18-CONTEXT.md D-08, D-09, D-10
//! and 18-RESEARCH.md § Consent Persistence Verdict (SQLite, NOT keyring).
//!
//! Plan 18-06 fills the Wave 0 skeleton with the full SQLite CRUD body.
//! Schema reuses evolution.rs:1115 blade.db pattern (verbatim across 9+ modules).
//! Decision values are restricted to `allow_always` | `denied` per RESEARCH Open Q1
//! (allow_once is in-memory only; never persisted).

use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq)]
pub enum ConsentVerdict {
    Allow,
    Deny,
    NeedsPrompt,
}

const CONSENT_SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS consent_decisions (
    intent_class    TEXT NOT NULL,
    target_service  TEXT NOT NULL,
    decision        TEXT NOT NULL,
    decided_at      INTEGER NOT NULL,
    PRIMARY KEY (intent_class, target_service)
);
"#;

/// Production DB path — reuses crate::config::blade_config_dir() (which honours
/// the BLADE_CONFIG_DIR env override for tests/eval harness).
fn db_path() -> PathBuf {
    crate::config::blade_config_dir().join("blade.db")
}

/// Testability seam: open a connection to an arbitrary path and apply the schema.
/// Production callers go through `open_consent_db()`; tests call this directly with
/// a tempdir path so they never touch the real user blade.db. Plan 14 will extend
/// this seam with `consent_check_at(db_path, ...)` per the same pattern Phase 17
/// used for `BLADE_EVAL_HISTORY_PATH` (see 18-RESEARCH.md § Consent Persistence).
fn open_db_at(path: &Path) -> Result<rusqlite::Connection, String> {
    let conn = rusqlite::Connection::open(path).map_err(|e| e.to_string())?;
    conn.execute(CONSENT_SCHEMA, []).map_err(|e| e.to_string())?;
    Ok(conn)
}

/// Production helper: open the canonical blade.db with schema applied.
fn open_consent_db() -> Result<rusqlite::Connection, String> {
    open_db_at(&db_path())
}

fn now_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// Lookup a stored decision for the given (intent_class, target_service) pair.
/// Returns Some("allow_always") | Some("denied") | None (no row).
#[tauri::command]
pub fn consent_get_decision(intent_class: String, target_service: String) -> Option<String> {
    let conn = open_consent_db().ok()?;
    conn.query_row(
        "SELECT decision FROM consent_decisions WHERE intent_class = ?1 AND target_service = ?2",
        rusqlite::params![intent_class, target_service],
        |row| row.get::<_, String>(0),
    )
    .ok()
}

/// Persist a consent decision via INSERT OR REPLACE. Validates that `decision` is
/// one of the two persistable values (`allow_always` | `denied`); `allow_once` and
/// any other value is rejected per T-18-CARRY-15 / RESEARCH Open Q1.
#[tauri::command]
pub fn consent_set_decision(
    intent_class: String,
    target_service: String,
    decision: String,
) -> Result<(), String> {
    if decision != "allow_always" && decision != "denied" {
        return Err(format!(
            "[consent] invalid decision: {} (allowed: allow_always, denied; allow_once is NOT persisted)",
            decision
        ));
    }
    let conn = open_consent_db()?;
    conn.execute(
        "INSERT OR REPLACE INTO consent_decisions (intent_class, target_service, decision, decided_at) VALUES (?1, ?2, ?3, ?4)",
        rusqlite::params![intent_class, target_service, decision, now_secs()],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Wipe every persisted decision. Used by the Settings → Privacy → "Revoke all
/// consents" flow (D-10).
#[tauri::command]
pub fn consent_revoke_all() -> Result<(), String> {
    let conn = open_consent_db()?;
    conn.execute("DELETE FROM consent_decisions", [])
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// List all persisted decisions for inspection (Settings UI / privacy view).
/// Returns rows of (intent_class, target_service, decision, decided_at).
#[tauri::command]
pub fn consent_list_decisions() -> Result<Vec<(String, String, String, i64)>, String> {
    let conn = open_consent_db()?;
    let mut stmt = conn
        .prepare("SELECT intent_class, target_service, decision, decided_at FROM consent_decisions ORDER BY decided_at DESC")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, i64>(3)?,
            ))
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

/// Internal helper consumed by jarvis_dispatch::dispatch_action BEFORE invoking outbound.
/// Returns ConsentVerdict::{Allow | Deny | NeedsPrompt} based on the persisted decision.
pub fn consent_check(intent_class: &str, target_service: &str) -> ConsentVerdict {
    match consent_get_decision(intent_class.to_string(), target_service.to_string()) {
        Some(d) if d == "allow_always" => ConsentVerdict::Allow,
        Some(d) if d == "denied" => ConsentVerdict::Deny,
        _ => ConsentVerdict::NeedsPrompt,
    }
}

/// Testability seam: same as `consent_check` but reads from an arbitrary db path.
/// Used by tests + by Plan 14's request_consent flow when an explicit path is
/// passed (parallel to `open_db_at`). Phase 17 used the same shape for
/// `BLADE_EVAL_HISTORY_PATH`.
pub fn consent_check_at(db_path: &Path, intent_class: &str, target_service: &str) -> ConsentVerdict {
    let conn = match open_db_at(db_path) {
        Ok(c) => c,
        Err(_) => return ConsentVerdict::NeedsPrompt,
    };
    let decision: Option<String> = conn
        .query_row(
            "SELECT decision FROM consent_decisions WHERE intent_class = ?1 AND target_service = ?2",
            rusqlite::params![intent_class, target_service],
            |row| row.get::<_, String>(0),
        )
        .ok();
    match decision {
        Some(d) if d == "allow_always" => ConsentVerdict::Allow,
        Some(d) if d == "denied" => ConsentVerdict::Deny,
        _ => ConsentVerdict::NeedsPrompt,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_db_path() -> PathBuf {
        let dir = std::env::temp_dir();
        let pid = std::process::id();
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = dir.join(format!("blade_consent_test_{pid}_{nanos}.db"));
        // Cleanup if this exact path was reused.
        let _ = std::fs::remove_file(&path);
        path
    }

    #[test]
    fn schema_string_present() {
        assert!(CONSENT_SCHEMA.contains("CREATE TABLE IF NOT EXISTS consent_decisions"));
    }

    #[test]
    fn open_db_at_creates_table() {
        let path = temp_db_path();
        let conn = open_db_at(&path).unwrap();
        let count: i64 = conn
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='consent_decisions'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn set_persists_and_get_retrieves() {
        let path = temp_db_path();
        let conn = open_db_at(&path).unwrap();
        conn.execute(
            "INSERT INTO consent_decisions (intent_class, target_service, decision, decided_at) VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params!["action_required", "slack", "allow_always", now_secs()],
        )
        .unwrap();
        let got: String = conn
            .query_row(
                "SELECT decision FROM consent_decisions WHERE intent_class = ?1 AND target_service = ?2",
                rusqlite::params!["action_required", "slack"],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(got, "allow_always");
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn get_returns_none_for_unknown() {
        let path = temp_db_path();
        let _conn = open_db_at(&path).unwrap();
        let v = consent_check_at(&path, "unknown_class", "missing_service");
        assert_eq!(v, ConsentVerdict::NeedsPrompt);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn revoke_all_clears() {
        let path = temp_db_path();
        let conn = open_db_at(&path).unwrap();
        conn.execute(
            "INSERT INTO consent_decisions (intent_class, target_service, decision, decided_at) VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params!["a", "b", "allow_always", now_secs()],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO consent_decisions (intent_class, target_service, decision, decided_at) VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params!["c", "d", "denied", now_secs()],
        )
        .unwrap();
        conn.execute("DELETE FROM consent_decisions", []).unwrap();
        let count: i64 = conn
            .query_row("SELECT count(*) FROM consent_decisions", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(count, 0);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn invalid_decision_rejected_at_set_decision() {
        // Validation runs BEFORE the DB roundtrip, so this is independent of which
        // path the test process is using. allow_once must be rejected per
        // RESEARCH Open Q1 (in-memory only, never persisted).
        let result = consent_set_decision(
            "action_required".to_string(),
            "slack".to_string(),
            "allow_once".to_string(),
        );
        assert!(result.is_err(), "allow_once must NOT be accepted as a persistable decision");
        if let Err(msg) = result {
            assert!(
                msg.contains("allow_once is NOT persisted") || msg.contains("invalid decision"),
                "expected validation error message; got: {msg}"
            );
        }
    }

    #[test]
    fn invalid_decision_arbitrary_string_rejected() {
        // Arbitrary garbage strings must also be rejected (T-18-CARRY-15).
        let result = consent_set_decision(
            "action_required".to_string(),
            "slack".to_string(),
            "yes".to_string(),
        );
        assert!(result.is_err());
    }

    #[test]
    fn consent_check_at_reads_allow_always() {
        let path = temp_db_path();
        let conn = open_db_at(&path).unwrap();
        conn.execute(
            "INSERT INTO consent_decisions (intent_class, target_service, decision, decided_at) VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params!["action_required", "slack", "allow_always", now_secs()],
        )
        .unwrap();
        drop(conn);
        let v = consent_check_at(&path, "action_required", "slack");
        assert_eq!(v, ConsentVerdict::Allow);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn consent_check_at_reads_denied() {
        let path = temp_db_path();
        let conn = open_db_at(&path).unwrap();
        conn.execute(
            "INSERT INTO consent_decisions (intent_class, target_service, decision, decided_at) VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params!["action_required", "github", "denied", now_secs()],
        )
        .unwrap();
        drop(conn);
        let v = consent_check_at(&path, "action_required", "github");
        assert_eq!(v, ConsentVerdict::Deny);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn consent_check_at_returns_needs_prompt_for_missing_db() {
        // A path that doesn't exist yet → open_db_at creates it with empty table →
        // the lookup misses → NeedsPrompt.
        let path = temp_db_path();
        let v = consent_check_at(&path, "x", "y");
        assert_eq!(v, ConsentVerdict::NeedsPrompt);
        let _ = std::fs::remove_file(&path);
    }
}
