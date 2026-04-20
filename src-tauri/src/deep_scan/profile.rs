#![allow(dead_code)]

//! Profile overlay persistence and merge logic (Phase 12, Plan 12-03).
//!
//! Two-file persistence split:
//! - `scan_results.json`      — written by the scanner (read-only from this module)
//! - `profile_overlay.json`   — written by the user (edit/hide/delete/add actions)
//!
//! `profile_get_rendered` merges both files: overlay fields win, hidden/deleted
//! rows are excluded, orphaned overlay rows (no longer in scan) are flagged.
//!
//! The overlay file uses an atomic write (temp + rename) for crash safety (D-62).
//! Concurrent overlay writes are serialised via `OVERLAY_LOCK`.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::Ordering;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;

// ── Overlay action enum ───────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum OverlayAction {
    Edit,
    Hide,
    Delete,
    Add,
}

// ── Overlay persistence types ─────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OverlayEntry {
    pub action: OverlayAction,
    pub fields: Option<HashMap<String, Value>>,
    pub edited_at: DateTime<Utc>,
    /// Set to true when the row_id is absent from the latest scan results.
    pub not_found: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProfileOverlay {
    /// Always 1 — version gate for future migrations.
    pub version: u32,
    /// Map of row_id → overlay entry.
    pub rows: HashMap<String, OverlayEntry>,
}

impl Default for ProfileOverlay {
    fn default() -> Self {
        Self {
            version: 1,
            rows: HashMap::new(),
        }
    }
}

// ── Rendered view types ───────────────────────────────────────────────────────

/// A row as rendered by the UI — scan fields overridden by overlay fields.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RenderedRow {
    pub row_id: String,
    /// "repo" | "account" | "mru_file" | "tool" | "ide" | "bookmark"
    pub row_kind: String,
    pub fields: HashMap<String, Value>,
    pub source_scanner: String,
    pub orphaned: bool,
    pub edited: bool,
    pub overlay_action: Option<OverlayAction>,
}

/// Top-level rendered profile returned by `profile_get_rendered`.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ProfileView {
    pub repos: Vec<RenderedRow>,
    pub accounts: Vec<RenderedRow>,
    pub mru_files: Vec<RenderedRow>,
    pub tools: Vec<RenderedRow>,
    pub ides: Vec<RenderedRow>,
    pub bookmarks: Vec<RenderedRow>,
    pub rhythm_signals: Vec<crate::deep_scan::leads::RhythmSignal>,
    pub llm_enrichments: Option<crate::deep_scan::leads::LlmEnrichments>,
    pub scanned_at: Option<i64>,
}

// ── Overlay write lock (serialises concurrent saves) ─────────────────────────

static OVERLAY_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

// ── Storage path helpers ──────────────────────────────────────────────────────

fn overlay_path() -> PathBuf {
    crate::config::blade_config_dir()
        .join("identity")
        .join("profile_overlay.json")
}

// ── Overlay I/O ───────────────────────────────────────────────────────────────

/// Save the overlay to disk using an atomic write (temp file + rename).
/// `parent` directory is created if it does not exist.
pub fn save_overlay(overlay: &ProfileOverlay) -> Result<(), String> {
    save_overlay_to(overlay, &overlay_path())
}

/// Internal: save overlay to an explicit path (used by tests with temp dirs).
pub fn save_overlay_to(overlay: &ProfileOverlay, path: &PathBuf) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(overlay).map_err(|e| e.to_string())?;
    // Atomic write: write to .json.tmp then rename
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, &json).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, path).map_err(|e| e.to_string())?;
    Ok(())
}

/// Load the overlay from disk. Returns `Default` if the file is absent or corrupt.
pub fn load_overlay() -> ProfileOverlay {
    load_overlay_from(&overlay_path())
}

/// Internal: load overlay from an explicit path (used by tests with temp dirs).
pub fn load_overlay_from(path: &PathBuf) -> ProfileOverlay {
    match std::fs::read_to_string(path) {
        Ok(s) => serde_json::from_str(&s).unwrap_or_default(),
        Err(_) => ProfileOverlay::default(),
    }
}

// ── Row serialisation helpers ─────────────────────────────────────────────────

/// Convert a serialisable scan row to a flat `HashMap<String, Value>`.
fn row_to_fields<T: Serialize>(row: &T) -> HashMap<String, Value> {
    match serde_json::to_value(row) {
        Ok(Value::Object(map)) => map.into_iter().collect(),
        _ => HashMap::new(),
    }
}

/// Apply overlay fields on top of base fields (overlay value wins per key).
fn apply_overlay_fields(
    mut base: HashMap<String, Value>,
    overlay_fields: &HashMap<String, Value>,
) -> HashMap<String, Value> {
    for (k, v) in overlay_fields {
        base.insert(k.clone(), v.clone());
    }
    base
}

// ── Merge algorithm (D-62) ────────────────────────────────────────────────────

/// Merge `scan_results.json` rows with the `profile_overlay.json` overlay.
///
/// Rules:
/// 1. `delete` or `hide` action → row is excluded from output.
/// 2. `edit` action → scan row rendered with overlay fields applied, `edited=true`.
/// 3. No overlay → scan row rendered as-is, `edited=false`.
/// 4. `add` entries in overlay → RenderedRow with `source_scanner="user"`.
/// 5. Overlay rows with no matching scan row (and not `add`/`delete`) → `orphaned=true`.
pub fn merge_scan_with_overlay(
    scan: &crate::deep_scan::leads::DeepScanResults,
    overlay: &ProfileOverlay,
) -> ProfileView {
    // Collect the row_ids present in the scan so we can detect orphans.
    let mut scan_ids: std::collections::HashSet<String> = std::collections::HashSet::new();

    let mut view = ProfileView {
        scanned_at: if scan.scanned_at != 0 { Some(scan.scanned_at) } else { None },
        rhythm_signals: scan.rhythm_signals.clone(),
        llm_enrichments: scan.llm_enrichments.clone(),
        ..Default::default()
    };

    // ── Repos ────────────────────────────────────────────────────────────────
    for row in &scan.repo_rows {
        scan_ids.insert(row.row_id.clone());
        let entry = overlay.rows.get(&row.row_id);
        match entry.map(|e| &e.action) {
            Some(OverlayAction::Delete) | Some(OverlayAction::Hide) => continue,
            Some(OverlayAction::Edit) => {
                let base = row_to_fields(row);
                let merged = if let Some(of) = &entry.unwrap().fields {
                    apply_overlay_fields(base, of)
                } else {
                    base
                };
                view.repos.push(RenderedRow {
                    row_id: row.row_id.clone(),
                    row_kind: "repo".into(),
                    fields: merged,
                    source_scanner: row.source_scanner.clone(),
                    orphaned: false,
                    edited: true,
                    overlay_action: Some(OverlayAction::Edit),
                });
            }
            _ => {
                view.repos.push(RenderedRow {
                    row_id: row.row_id.clone(),
                    row_kind: "repo".into(),
                    fields: row_to_fields(row),
                    source_scanner: row.source_scanner.clone(),
                    orphaned: false,
                    edited: false,
                    overlay_action: None,
                });
            }
        }
    }

    // ── Accounts ─────────────────────────────────────────────────────────────
    for row in &scan.accounts {
        scan_ids.insert(row.row_id.clone());
        let entry = overlay.rows.get(&row.row_id);
        match entry.map(|e| &e.action) {
            Some(OverlayAction::Delete) | Some(OverlayAction::Hide) => continue,
            Some(OverlayAction::Edit) => {
                let base = row_to_fields(row);
                let merged = if let Some(of) = &entry.unwrap().fields {
                    apply_overlay_fields(base, of)
                } else {
                    base
                };
                view.accounts.push(RenderedRow {
                    row_id: row.row_id.clone(),
                    row_kind: "account".into(),
                    fields: merged,
                    source_scanner: row.source.clone(),
                    orphaned: false,
                    edited: true,
                    overlay_action: Some(OverlayAction::Edit),
                });
            }
            _ => {
                view.accounts.push(RenderedRow {
                    row_id: row.row_id.clone(),
                    row_kind: "account".into(),
                    fields: row_to_fields(row),
                    source_scanner: row.source.clone(),
                    orphaned: false,
                    edited: false,
                    overlay_action: None,
                });
            }
        }
    }

    // ── MRU files ─────────────────────────────────────────────────────────────
    for row in &scan.mru_files {
        scan_ids.insert(row.row_id.clone());
        let entry = overlay.rows.get(&row.row_id);
        match entry.map(|e| &e.action) {
            Some(OverlayAction::Delete) | Some(OverlayAction::Hide) => continue,
            Some(OverlayAction::Edit) => {
                let base = row_to_fields(row);
                let merged = if let Some(of) = &entry.unwrap().fields {
                    apply_overlay_fields(base, of)
                } else {
                    base
                };
                view.mru_files.push(RenderedRow {
                    row_id: row.row_id.clone(),
                    row_kind: "mru_file".into(),
                    fields: merged,
                    source_scanner: row.source.clone(),
                    orphaned: false,
                    edited: true,
                    overlay_action: Some(OverlayAction::Edit),
                });
            }
            _ => {
                view.mru_files.push(RenderedRow {
                    row_id: row.row_id.clone(),
                    row_kind: "mru_file".into(),
                    fields: row_to_fields(row),
                    source_scanner: row.source.clone(),
                    orphaned: false,
                    edited: false,
                    overlay_action: None,
                });
            }
        }
    }

    // ── "add" overlay entries (user-created rows with no scan counterpart) ────
    for (row_id, entry) in &overlay.rows {
        if entry.action != OverlayAction::Add {
            continue;
        }
        let fields = entry.fields.clone().unwrap_or_default();
        // Infer row_kind from row_id prefix or from fields
        let row_kind = fields
            .get("row_kind")
            .and_then(|v| v.as_str())
            .unwrap_or("account")
            .to_string();
        let rendered = RenderedRow {
            row_id: row_id.clone(),
            row_kind: row_kind.clone(),
            fields,
            source_scanner: "user".into(),
            orphaned: false,
            edited: false,
            overlay_action: Some(OverlayAction::Add),
        };
        match row_kind.as_str() {
            "repo" => view.repos.push(rendered),
            "mru_file" => view.mru_files.push(rendered),
            "tool" => view.tools.push(rendered),
            "ide" => view.ides.push(rendered),
            "bookmark" => view.bookmarks.push(rendered),
            _ => view.accounts.push(rendered),
        }
    }

    // ── Orphaned overlay entries (not in scan, not "add", not "delete") ───────
    for (row_id, entry) in &overlay.rows {
        if entry.action == OverlayAction::Add || entry.action == OverlayAction::Delete {
            continue;
        }
        if scan_ids.contains(row_id) {
            continue;
        }
        // This overlay entry references a row no longer in the scan → orphaned
        let fields = entry.fields.clone().unwrap_or_default();
        let row_kind = fields
            .get("row_kind")
            .and_then(|v| v.as_str())
            .unwrap_or("repo")
            .to_string();
        let rendered = RenderedRow {
            row_id: row_id.clone(),
            row_kind: row_kind.clone(),
            fields,
            source_scanner: "overlay".into(),
            orphaned: true,
            edited: entry.action == OverlayAction::Edit,
            overlay_action: Some(entry.action.clone()),
        };
        match row_kind.as_str() {
            "account" => view.accounts.push(rendered),
            "mru_file" => view.mru_files.push(rendered),
            "tool" => view.tools.push(rendered),
            "ide" => view.ides.push(rendered),
            "bookmark" => view.bookmarks.push(rendered),
            _ => view.repos.push(rendered),
        }
    }

    view
}

// ── Tauri commands ────────────────────────────────────────────────────────────

/// Returns the rendered profile: scan rows merged with the overlay.
/// Overlay fields win on any per-field conflict.
#[tauri::command]
pub async fn profile_get_rendered() -> Result<ProfileView, String> {
    let scan = crate::deep_scan::load_results_pub();
    let overlay = load_overlay();
    let view = match scan {
        Some(s) => merge_scan_with_overlay(&s, &overlay),
        None => ProfileView::default(),
    };
    Ok(view)
}

/// Upserts a user edit/hide/delete/add overlay entry for the given row_id.
/// Uses `OVERLAY_LOCK` to serialise concurrent writes.
#[tauri::command]
pub async fn profile_overlay_upsert(
    row_id: String,
    action: OverlayAction,
    fields: Option<HashMap<String, Value>>,
) -> Result<(), String> {
    let _guard = OVERLAY_LOCK.lock().await;
    let mut overlay = load_overlay();
    overlay.rows.insert(
        row_id,
        OverlayEntry {
            action,
            fields,
            edited_at: Utc::now(),
            not_found: false,
        },
    );
    save_overlay(&overlay)
}

/// Removes the overlay entry for the given row_id, restoring the raw scan value.
#[tauri::command]
pub async fn profile_overlay_reset(row_id: String) -> Result<(), String> {
    let _guard = OVERLAY_LOCK.lock().await;
    let mut overlay = load_overlay();
    overlay.rows.remove(&row_id);
    save_overlay(&overlay)
}

/// Sets the SCAN_CANCEL flag, halting the drain loop at the next lead boundary.
#[tauri::command]
pub async fn scan_cancel() -> Result<(), String> {
    crate::deep_scan::queue::SCAN_CANCEL.store(true, Ordering::SeqCst);
    Ok(())
}

// ── Unit tests ────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::deep_scan::leads::{
        AccountRow, DeepScanResults, MruFileRow, RepoRow,
    };
    use tempfile::TempDir;

    // Helper: create a TempDir and return a path for the overlay file inside it.
    fn temp_overlay_path(dir: &TempDir) -> PathBuf {
        dir.path().join("identity").join("profile_overlay.json")
    }

    // Helper: build a minimal DeepScanResults with one repo row.
    fn make_scan_with_repo(row_id: &str, remote_url: &str) -> DeepScanResults {
        DeepScanResults {
            repo_rows: vec![RepoRow {
                row_id: row_id.to_string(),
                path: "/blade".into(),
                remote_url: Some(remote_url.to_string()),
                source_scanner: "fs_repos".into(),
                ..Default::default()
            }],
            ..Default::default()
        }
    }

    // ── test_roundtrip_overlay ────────────────────────────────────────────────

    #[test]
    fn test_roundtrip_overlay() {
        let dir = TempDir::new().unwrap();
        let path = temp_overlay_path(&dir);

        let mut overlay = ProfileOverlay::default();
        let mut fields = HashMap::new();
        fields.insert("note".to_string(), Value::String("hello".into()));
        overlay.rows.insert(
            "repo:/blade".to_string(),
            OverlayEntry {
                action: OverlayAction::Edit,
                fields: Some(fields),
                edited_at: Utc::now(),
                not_found: false,
            },
        );

        save_overlay_to(&overlay, &path).unwrap();
        let loaded = load_overlay_from(&path);

        assert!(loaded.rows.contains_key("repo:/blade"), "entry must survive round-trip");
        let entry = &loaded.rows["repo:/blade"];
        assert_eq!(entry.action, OverlayAction::Edit);
        let note = entry.fields.as_ref().unwrap().get("note").unwrap();
        assert_eq!(note.as_str().unwrap(), "hello");
    }

    // ── test_orphan_preservation ──────────────────────────────────────────────

    #[test]
    fn test_orphan_preservation() {
        // Overlay has an edit for "repo:/gone/path" which is NOT in the scan.
        let scan = DeepScanResults::default(); // empty scan
        let mut overlay = ProfileOverlay::default();
        let mut fields = HashMap::new();
        fields.insert("note".to_string(), Value::String("orphaned note".into()));
        overlay.rows.insert(
            "repo:/gone/path".to_string(),
            OverlayEntry {
                action: OverlayAction::Edit,
                fields: Some(fields),
                edited_at: Utc::now(),
                not_found: false,
            },
        );

        let view = merge_scan_with_overlay(&scan, &overlay);

        // The orphaned row should appear in repos (default row_kind fallback is "repo")
        let orphaned = view.repos.iter().find(|r| r.row_id == "repo:/gone/path");
        assert!(orphaned.is_some(), "orphaned row must be preserved");
        let orphaned = orphaned.unwrap();
        assert!(orphaned.orphaned, "orphaned flag must be true");
        assert_eq!(
            orphaned.fields.get("note").and_then(|v| v.as_str()),
            Some("orphaned note"),
            "overlay fields must be present on orphaned row"
        );
    }

    // ── test_overlay_edit_wins ────────────────────────────────────────────────

    #[test]
    fn test_overlay_edit_wins() {
        let scan = make_scan_with_repo(
            "repo:/blade",
            "https://github.com/old/blade",
        );
        let mut overlay = ProfileOverlay::default();
        let mut fields = HashMap::new();
        fields.insert(
            "remote_url".to_string(),
            Value::String("https://github.com/arnav/blade".into()),
        );
        overlay.rows.insert(
            "repo:/blade".to_string(),
            OverlayEntry {
                action: OverlayAction::Edit,
                fields: Some(fields),
                edited_at: Utc::now(),
                not_found: false,
            },
        );

        let view = merge_scan_with_overlay(&scan, &overlay);

        let repo = view.repos.iter().find(|r| r.row_id == "repo:/blade").unwrap();
        assert!(repo.edited, "edited flag must be set");
        let url = repo.fields.get("remote_url").and_then(|v| v.as_str()).unwrap();
        assert_eq!(url, "https://github.com/arnav/blade", "overlay value must win");
    }

    // ── test_overlay_hide_filters ─────────────────────────────────────────────

    #[test]
    fn test_overlay_hide_filters() {
        let scan = make_scan_with_repo("repo:/secret", "https://github.com/x/secret");
        let mut overlay = ProfileOverlay::default();
        overlay.rows.insert(
            "repo:/secret".to_string(),
            OverlayEntry {
                action: OverlayAction::Hide,
                fields: None,
                edited_at: Utc::now(),
                not_found: false,
            },
        );

        let view = merge_scan_with_overlay(&scan, &overlay);

        assert!(
            view.repos.iter().all(|r| r.row_id != "repo:/secret"),
            "hidden row must not appear in output"
        );
    }

    // ── test_overlay_delete_filters ───────────────────────────────────────────

    #[test]
    fn test_overlay_delete_filters() {
        let scan = make_scan_with_repo("repo:/todelete", "https://github.com/x/todelete");
        let mut overlay = ProfileOverlay::default();
        overlay.rows.insert(
            "repo:/todelete".to_string(),
            OverlayEntry {
                action: OverlayAction::Delete,
                fields: None,
                edited_at: Utc::now(),
                not_found: false,
            },
        );

        let view = merge_scan_with_overlay(&scan, &overlay);

        assert!(
            view.repos.iter().all(|r| r.row_id != "repo:/todelete"),
            "deleted row must not appear in output"
        );
    }

    // ── test_overlay_add_appends ──────────────────────────────────────────────

    #[test]
    fn test_overlay_add_appends() {
        // Overlay has action="add" with row_kind="account", no matching scan row.
        let scan = DeepScanResults::default();
        let mut overlay = ProfileOverlay::default();
        let mut fields = HashMap::new();
        fields.insert("row_kind".to_string(), Value::String("account".into()));
        fields.insert("handle".to_string(), Value::String("arnav".into()));
        overlay.rows.insert(
            "account:github:arnav".to_string(),
            OverlayEntry {
                action: OverlayAction::Add,
                fields: Some(fields),
                edited_at: Utc::now(),
                not_found: false,
            },
        );

        let view = merge_scan_with_overlay(&scan, &overlay);

        let added = view.accounts.iter().find(|r| r.row_id == "account:github:arnav");
        assert!(added.is_some(), "added row must appear in accounts");
        let added = added.unwrap();
        assert_eq!(added.source_scanner, "user");
        assert!(!added.orphaned);
    }

    // ── test_atomic_write_safety ──────────────────────────────────────────────

    #[test]
    fn test_atomic_write_safety() {
        let dir = TempDir::new().unwrap();
        let path = temp_overlay_path(&dir);

        let mut overlay = ProfileOverlay::default();
        overlay.rows.insert(
            "repo:/atomic".to_string(),
            OverlayEntry {
                action: OverlayAction::Edit,
                fields: Some({
                    let mut m = HashMap::new();
                    m.insert("x".to_string(), Value::Bool(true));
                    m
                }),
                edited_at: Utc::now(),
                not_found: false,
            },
        );

        // Atomic write via temp+rename
        save_overlay_to(&overlay, &path).unwrap();

        // Verify the .tmp file is gone (rename completed)
        let tmp_path = path.with_extension("json.tmp");
        assert!(
            !tmp_path.exists(),
            ".json.tmp file must not persist after atomic rename"
        );

        // Verify the data round-trips
        let loaded = load_overlay_from(&path);
        assert!(loaded.rows.contains_key("repo:/atomic"));
        let entry = &loaded.rows["repo:/atomic"];
        let x = entry.fields.as_ref().unwrap().get("x").unwrap();
        assert_eq!(x.as_bool().unwrap(), true);
    }
}
