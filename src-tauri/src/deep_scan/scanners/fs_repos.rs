#![allow(dead_code)]

//! Scanner: fs_repos — walks a directory tree (max depth 6) finding `.git` dirs.
//!
//! Threat mitigations (T-12-02, T-12-03, T-12-04, T-12-05):
//! - follow_links(false) on every WalkDir — prevents symlink escape / infinite loops
//! - Skips /mnt/c root entirely — avoids 10x-slower Windows filesystem crossing
//! - Ignore list prunes entire subtrees (node_modules etc.)
//! - File count cap at 10,000 directory entries
//! - All path-to-string truncations use crate::safe_slice, never &str[..n]

use std::path::PathBuf;
use walkdir::WalkDir;

#[allow(unused_imports)]
use crate::deep_scan::leads::{Lead, LeadKind, RepoRow, Tier};

/// Directories to skip entirely (prune from walkdir traversal).
const IGNORE_DIRS: &[&str] = &[
    "node_modules", ".git", ".venv", "venv", "target", "dist", "build",
    ".next", ".turbo", "__pycache__",
];

/// Maximum depth for the filesystem walk.
const MAX_DEPTH: usize = 6;

/// Maximum directory entries checked per call (DoS guard — T-12-04).
const ENTRY_CAP: usize = 10_000;

/// Run the fs_repos scanner for a given lead.
///
/// Returns (Vec<RepoRow>, Vec<Lead>) where the Lead vec contains
/// `GitRemoteRead` follow-up leads for each discovered `.git` directory.
pub fn run(lead: &Lead) -> (Vec<RepoRow>, Vec<Lead>) {
    let root_str = match lead.payload.get("path").and_then(|v| v.as_str()) {
        Some(s) => s.to_string(),
        None => return (vec![], vec![]),
    };
    let root = PathBuf::from(&root_str);

    // T-12-02: skip /mnt/c entirely
    if root_str.starts_with("/mnt/c") {
        return (vec![], vec![]);
    }
    if !root.is_dir() {
        return (vec![], vec![]);
    }

    let mut repos: Vec<RepoRow> = Vec::new();
    let mut follow_ups: Vec<Lead> = Vec::new();
    let mut seen_repos: std::collections::HashSet<PathBuf> = std::collections::HashSet::new();
    let mut entry_count = 0usize;

    let walker = WalkDir::new(&root)
        .max_depth(MAX_DEPTH)
        .follow_links(false) // T-12-03
        .into_iter()
        .filter_entry(|e| {
            // Prune ignore dirs by name
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

        // We're looking for directories named ".git"
        if !entry.file_type().is_dir() { continue; }
        if entry.file_name() != ".git" { continue; }

        // Parent directory is the repo root
        let repo_root = match entry.path().parent() {
            Some(p) => p.to_path_buf(),
            None => continue,
        };

        // Dedup: skip if we already produced a row for this repo root
        let canonical = repo_root.canonicalize().unwrap_or_else(|_| repo_root.clone());
        if seen_repos.contains(&canonical) { continue; }
        seen_repos.insert(canonical.clone());

        let path_str = canonical.to_string_lossy().to_string();
        let row_id = format!("repo:{}", path_str);
        let row = RepoRow {
            row_id,
            path: path_str.clone(),
            discovered_via: "fs_walk".to_string(),
            source_scanner: "fs_repos".to_string(),
            ..Default::default()
        };
        repos.push(row);

        // Emit a GitRemoteRead follow-up lead at the same tier as the parent lead
        let follow_up = Lead::new(
            LeadKind::GitRemoteRead,
            lead.priority_tier.clone(),
            format!("fs_repos:{}", crate::safe_slice(&path_str, 80)),
            serde_json::json!({ "path": path_str }),
        );
        follow_ups.push(follow_up);
    }

    (repos, follow_ups)
}

// ── Unit tests ────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn make_lead(path: &str) -> Lead {
        Lead::new(
            LeadKind::FsRepoWalk,
            Tier::Hot,
            "test",
            serde_json::json!({ "path": path }),
        )
    }

    #[test]
    fn test_walks_maxdepth_six() {
        let dir = tempdir().unwrap();
        let root = dir.path();

        // Create a .git at depth 5 (should be found)
        let depth5 = root
            .join("a").join("b").join("c").join("d").join("repo5");
        std::fs::create_dir_all(depth5.join(".git")).unwrap();

        // Create a .git at depth 7 (beyond max — should NOT be found)
        let depth7 = root
            .join("x").join("y").join("z").join("w").join("v").join("u").join("repo7");
        std::fs::create_dir_all(depth7.join(".git")).unwrap();

        let lead = make_lead(root.to_str().unwrap());
        let (repos, _follow_ups) = run(&lead);

        let paths: Vec<&str> = repos.iter().map(|r| r.path.as_str()).collect();

        // depth5 repo should be found
        assert!(
            paths.iter().any(|p| p.contains("repo5")),
            "depth-5 repo should be found; got: {:?}", paths
        );
        // depth7 repo should NOT be found
        assert!(
            !paths.iter().any(|p| p.contains("repo7")),
            "depth-7 repo should be pruned; got: {:?}", paths
        );
    }

    #[test]
    fn test_ignore_list() {
        let dir = tempdir().unwrap();
        let root = dir.path();

        // .git inside node_modules — should be pruned entirely
        let nm_git = root.join("node_modules").join("some-pkg");
        std::fs::create_dir_all(nm_git.join(".git")).unwrap();

        // Normal repo outside node_modules — should be found
        let good_repo = root.join("my-project");
        std::fs::create_dir_all(good_repo.join(".git")).unwrap();

        let lead = make_lead(root.to_str().unwrap());
        let (repos, _) = run(&lead);

        let paths: Vec<&str> = repos.iter().map(|r| r.path.as_str()).collect();
        assert!(
            !paths.iter().any(|p| p.contains("node_modules")),
            "node_modules subtree should be ignored; got: {:?}", paths
        );
        assert!(
            paths.iter().any(|p| p.contains("my-project")),
            "normal repo should be found; got: {:?}", paths
        );
    }

    #[test]
    fn test_returns_followup_leads() {
        let dir = tempdir().unwrap();
        let root = dir.path();

        // Create a repo
        let repo = root.join("my-repo");
        std::fs::create_dir_all(repo.join(".git")).unwrap();

        let lead = make_lead(root.to_str().unwrap());
        let (repos, follow_ups) = run(&lead);

        assert!(!repos.is_empty(), "should find at least one repo");
        assert!(
            !follow_ups.is_empty(),
            "should return GitRemoteRead follow-up leads"
        );
        assert_eq!(
            follow_ups[0].kind,
            LeadKind::GitRemoteRead,
            "follow-up should be GitRemoteRead kind"
        );
    }
}
