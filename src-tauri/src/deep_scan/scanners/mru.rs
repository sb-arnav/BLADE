#![allow(dead_code)]

//! Scanner: mru — finds recently modified files within a given time window.
//!
//! Threat mitigations:
//! - T-12-03: follow_links(false) on WalkDir — no symlink escape
//! - T-12-04: capped at 10,000 file entries
//! - T-12-05: safe_slice for any path string truncation

use std::path::PathBuf;
use walkdir::WalkDir;

use crate::deep_scan::leads::{Lead, MruFileRow};

/// Directories to skip entirely (same ignore list as fs_repos).
const IGNORE_DIRS: &[&str] = &[
    "node_modules", ".git", ".venv", "venv", "target", "dist", "build",
    ".next", ".turbo", "__pycache__",
];

/// Maximum depth for the MRU walk.
const MAX_DEPTH: usize = 6;

/// Maximum file entries checked per call (DoS guard — T-12-04).
const ENTRY_CAP: usize = 10_000;

/// Scan for files modified within `window_days` days, starting from the path
/// in the lead payload.
pub fn run(lead: &Lead, window_days: i64) -> Vec<MruFileRow> {
    let root_str = match lead.payload.get("path").and_then(|v| v.as_str()) {
        Some(s) => s.to_string(),
        None => return vec![],
    };
    let root = PathBuf::from(&root_str);

    // T-12-02: skip /mnt/c
    if root_str.starts_with("/mnt/c") {
        return vec![];
    }
    if !root.is_dir() {
        return vec![];
    }

    let cutoff = chrono::Utc::now() - chrono::Duration::days(window_days);
    let cutoff_secs = cutoff.timestamp();

    let mut results: Vec<MruFileRow> = Vec::new();
    let mut entry_count = 0usize;

    let walker = WalkDir::new(&root)
        .max_depth(MAX_DEPTH)
        .follow_links(false) // T-12-03
        .into_iter()
        .filter_entry(|e| {
            let name = e.file_name().to_string_lossy();
            !(e.file_type().is_dir() && IGNORE_DIRS.contains(&name.as_ref()))
        });

    for entry_result in walker {
        entry_count += 1;
        if entry_count > ENTRY_CAP { break; }

        let entry = match entry_result {
            Ok(e) => e,
            Err(_) => continue,
        };

        // Only process files (not dirs)
        if !entry.file_type().is_file() { continue; }

        let metadata = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };

        let mtime_secs = metadata.modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);

        // Filter by window
        if mtime_secs < cutoff_secs { continue; }

        let abs_path = entry.path().canonicalize().unwrap_or_else(|_| entry.path().to_path_buf());
        let path_str = abs_path.to_string_lossy().to_string();
        let size_bytes = metadata.len();

        // Infer project_root: walk up from file; if any ancestor has .git, use it
        let project_root = find_project_root(entry.path());

        results.push(MruFileRow {
            row_id: format!("file:{}", path_str),
            path: path_str,
            mtime_unix: mtime_secs,
            size_bytes,
            project_root,
            source: "mru".to_string(),
        });
    }

    results
}

/// Walk up from `path` looking for an ancestor that contains a `.git` directory.
fn find_project_root(path: &std::path::Path) -> Option<String> {
    let mut current = path.parent()?;
    loop {
        if current.join(".git").is_dir() {
            return Some(current.to_string_lossy().to_string());
        }
        current = current.parent()?;
    }
}

// ── Unit tests ────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::deep_scan::leads::{LeadKind, Tier};
    use filetime::{set_file_mtime, FileTime};
    use tempfile::tempdir;

    fn make_lead(path: &str) -> Lead {
        Lead::new(
            LeadKind::MruWalk,
            Tier::Hot,
            "test",
            serde_json::json!({ "path": path }),
        )
    }

    fn set_mtime_days_ago(path: &std::path::Path, days_ago: i64) {
        let secs = chrono::Utc::now().timestamp() - (days_ago * 86400);
        let ft = FileTime::from_unix_time(secs, 0);
        set_file_mtime(path, ft).expect("failed to set mtime");
    }

    #[test]
    fn test_filters_by_window() {
        let dir = tempdir().unwrap();
        let root = dir.path();

        // File modified 3 days ago — should be included with window_days=7
        let recent_file = root.join("recent.txt");
        std::fs::write(&recent_file, "recent").unwrap();
        set_mtime_days_ago(&recent_file, 3);

        // File modified 10 days ago — should be excluded with window_days=7
        let old_file = root.join("old.txt");
        std::fs::write(&old_file, "old").unwrap();
        set_mtime_days_ago(&old_file, 10);

        let lead = make_lead(root.to_str().unwrap());
        let results = run(&lead, 7);

        let paths: Vec<&str> = results.iter().map(|r| r.path.as_str()).collect();

        assert!(
            paths.iter().any(|p| p.contains("recent.txt")),
            "3-day-old file should be included; got: {:?}", paths
        );
        assert!(
            !paths.iter().any(|p| p.contains("old.txt")),
            "10-day-old file should be excluded with 7-day window; got: {:?}", paths
        );
    }

    #[test]
    fn test_respects_ignore_list() {
        let dir = tempdir().unwrap();
        let root = dir.path();

        // File inside node_modules — should be excluded
        let nm_dir = root.join("node_modules").join("somepkg");
        std::fs::create_dir_all(&nm_dir).unwrap();
        let nm_file = nm_dir.join("index.js");
        std::fs::write(&nm_file, "content").unwrap();
        set_mtime_days_ago(&nm_file, 1);

        // Normal file in root — should be included
        let good_file = root.join("main.rs");
        std::fs::write(&good_file, "fn main() {}").unwrap();
        set_mtime_days_ago(&good_file, 1);

        let lead = make_lead(root.to_str().unwrap());
        let results = run(&lead, 7);

        let paths: Vec<&str> = results.iter().map(|r| r.path.as_str()).collect();

        assert!(
            !paths.iter().any(|p| p.contains("node_modules")),
            "node_modules contents should be excluded; got: {:?}", paths
        );
        assert!(
            paths.iter().any(|p| p.contains("main.rs")),
            "normal file should be included; got: {:?}", paths
        );
    }
}
