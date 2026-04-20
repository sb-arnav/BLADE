#![allow(dead_code)]

//! Scanner: git_remotes — parses `.git/config` to extract remote URLs.
//!
//! Threat mitigations:
//! - T-12-01: strips credentials (`user:token@`) from HTTPS URLs before storing
//! - T-12-05: uses crate::safe_slice for any path truncation in logs

use std::path::PathBuf;
use once_cell::sync::Lazy;
use regex::Regex;

#[allow(unused_imports)]
use crate::deep_scan::leads::{AccountRow, Lead, LeadKind, RepoRow, Tier};

// ── Compiled regexes ──────────────────────────────────────────────────────────

/// Match SSH remote URLs: `git@github.com:org/repo.git`
static SSH_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?m)url\s*=\s*git@([^:]+):([^/\s]+)/([^.\s]+?)(?:\.git)?\s*$").unwrap()
});

/// Match HTTPS remote URLs: `https://user:token@github.com/org/repo.git`
static HTTPS_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?m)url\s*=\s*https?://(?:[^@\s]+@)?([^/\s]+)/([^/\s]+)/([^.\s]+?)(?:\.git)?\s*$").unwrap()
});

// ── Platform mapping ──────────────────────────────────────────────────────────

fn host_to_platform(host: &str) -> &str {
    match host {
        h if h.contains("github.com") => "github",
        h if h.contains("gitlab.com") => "gitlab",
        h if h.contains("bitbucket.org") => "bitbucket",
        h if h.contains("dev.azure.com") || h.contains("visualstudio.com") => "azure",
        other => other,
    }
}

/// Strip credentials from an HTTPS URL: `https://user:token@host/...` → `https://host/...`
fn strip_credentials(url: &str) -> String {
    // Match https://anything@host and replace with https://host
    if let Some(at_pos) = url.find('@') {
        // Only strip if there's a scheme prefix before the @
        if let Some(scheme_end) = url.find("://") {
            if at_pos > scheme_end {
                let scheme = &url[..scheme_end + 3]; // "https://"
                let after_at = &url[at_pos + 1..];
                return format!("{}{}", scheme, after_at);
            }
        }
    }
    url.to_string()
}

// ── Scanner entry point ───────────────────────────────────────────────────────

/// Parse `.git/config` in the repo pointed to by the lead payload.
///
/// Returns (Vec<RepoRow>, Vec<AccountRow>, Vec<Lead>).
/// The RepoRow enriches the existing row with remote URL, org, repo_name.
/// AccountRow is produced for each discovered VCS account.
/// No follow-up leads are generated (git remote reads are terminal).
pub fn run(lead: &Lead) -> (Vec<RepoRow>, Vec<AccountRow>, Vec<Lead>) {
    let repo_path_str = match lead.payload.get("path").and_then(|v| v.as_str()) {
        Some(s) => s.to_string(),
        None => return (vec![], vec![], vec![]),
    };
    let repo_path = PathBuf::from(&repo_path_str);
    let git_config_path = repo_path.join(".git").join("config");

    let content = match std::fs::read_to_string(&git_config_path) {
        Ok(c) => c,
        Err(_) => return (vec![], vec![], vec![]),
    };

    let mut repos: Vec<RepoRow> = Vec::new();
    let mut accounts: Vec<AccountRow> = Vec::new();
    let mut seen_accounts: std::collections::HashSet<String> = std::collections::HashSet::new();

    // Parse SSH remotes
    for cap in SSH_RE.captures_iter(&content) {
        let host = cap.get(1).map(|m| m.as_str()).unwrap_or("");
        let org = cap.get(2).map(|m| m.as_str()).unwrap_or("");
        let repo_name = cap.get(3).map(|m| m.as_str()).unwrap_or("");
        let platform = host_to_platform(host);

        // Build clean remote URL (no credentials in SSH anyway)
        let remote_url = format!("git@{}:{}/{}", host, org, repo_name);

        let row = RepoRow {
            row_id: format!("repo:{}", repo_path_str),
            path: repo_path_str.clone(),
            remote_url: Some(remote_url),
            org: Some(org.to_string()),
            repo_name: Some(repo_name.to_string()),
            discovered_via: lead.payload.get("discovered_via").and_then(|v| v.as_str()).unwrap_or("git_remote").to_string(),
            source_scanner: "git_remotes".to_string(),
            ..Default::default()
        };
        repos.push(row);

        let account_key = format!("account:{}:{}", platform, org);
        if seen_accounts.insert(account_key.clone()) {
            accounts.push(AccountRow {
                row_id: account_key,
                platform: platform.to_string(),
                handle: org.to_string(),
                source: "git_remotes".to_string(),
                discovered_via: format!("git_remote:{}", crate::safe_slice(&repo_path_str, 80)),
            });
        }
    }

    // Parse HTTPS remotes (only if SSH didn't already produce a row for this path)
    for cap in HTTPS_RE.captures_iter(&content) {
        let host = cap.get(1).map(|m| m.as_str()).unwrap_or("");
        let org = cap.get(2).map(|m| m.as_str()).unwrap_or("");
        let repo_name = cap.get(3).map(|m| m.as_str()).unwrap_or("");
        let platform = host_to_platform(host);

        // Strip credentials before storing (T-12-01)
        // The regex already skips the `user:token@` part in capture groups, but the raw
        // URL might appear elsewhere — reconstruct clean URL from captured groups.
        let clean_url = format!("https://{}/{}/{}", host, org, repo_name);

        let row = RepoRow {
            row_id: format!("repo:{}", repo_path_str),
            path: repo_path_str.clone(),
            remote_url: Some(clean_url),
            org: Some(org.to_string()),
            repo_name: Some(repo_name.to_string()),
            discovered_via: lead.payload.get("discovered_via").and_then(|v| v.as_str()).unwrap_or("git_remote").to_string(),
            source_scanner: "git_remotes".to_string(),
            ..Default::default()
        };
        // Only add if SSH didn't already cover this path (avoid duplicate repo rows)
        if repos.iter().all(|r| r.row_id != row.row_id) {
            repos.push(row);
        }

        let account_key = format!("account:{}:{}", platform, org);
        if seen_accounts.insert(account_key.clone()) {
            accounts.push(AccountRow {
                row_id: account_key,
                platform: platform.to_string(),
                handle: org.to_string(),
                source: "git_remotes".to_string(),
                discovered_via: format!("git_remote:{}", crate::safe_slice(&repo_path_str, 80)),
            });
        }
    }

    (repos, accounts, vec![])
}

// ── Unit tests ────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn make_git_config(content: &str) -> (tempfile::TempDir, Lead) {
        let dir = tempdir().unwrap();
        let git_dir = dir.path().join(".git");
        std::fs::create_dir_all(&git_dir).unwrap();
        std::fs::write(git_dir.join("config"), content).unwrap();
        let path = dir.path().to_str().unwrap().to_string();
        let lead = Lead::new(
            LeadKind::GitRemoteRead,
            Tier::Hot,
            "test",
            serde_json::json!({ "path": path }),
        );
        (dir, lead)
    }

    #[test]
    fn test_parses_ssh_url() {
        let config = r#"[core]
	repositoryformatversion = 0
[remote "origin"]
	url = git@github.com:arnav/blade.git
	fetch = +refs/heads/*:refs/remotes/origin/*
"#;
        let (_dir, lead) = make_git_config(config);
        let (repos, accounts, _) = run(&lead);

        assert!(!repos.is_empty(), "should find at least one repo");
        let repo = &repos[0];
        assert_eq!(repo.org.as_deref(), Some("arnav"), "org should be arnav");
        assert_eq!(repo.repo_name.as_deref(), Some("blade"), "repo_name should be blade");

        assert!(!accounts.is_empty(), "should find an account");
        let acc = &accounts[0];
        assert_eq!(acc.platform, "github", "platform should be github");
        assert_eq!(acc.handle, "arnav", "handle should be arnav");
    }

    #[test]
    fn test_parses_https_url() {
        let config = r#"[core]
	repositoryformatversion = 0
[remote "origin"]
	url = https://github.com/arnav/Staq.git
	fetch = +refs/heads/*:refs/remotes/origin/*
"#;
        let (_dir, lead) = make_git_config(config);
        let (repos, accounts, _) = run(&lead);

        assert!(!repos.is_empty(), "should find at least one repo");
        let repo = &repos[0];
        assert_eq!(repo.org.as_deref(), Some("arnav"), "org should be arnav");
        assert_eq!(repo.repo_name.as_deref(), Some("Staq"), "repo_name should be Staq");

        assert!(!accounts.is_empty(), "should find an account");
        assert_eq!(accounts[0].platform, "github");
    }

    #[test]
    fn test_no_auth_token_leak() {
        let config = r#"[core]
	repositoryformatversion = 0
[remote "origin"]
	url = https://user:supersecrettoken@github.com/org/repo.git
	fetch = +refs/heads/*:refs/remotes/origin/*
"#;
        let (_dir, lead) = make_git_config(config);
        let (repos, _, _) = run(&lead);

        // The stored URL must NOT contain the credential fragment
        for repo in &repos {
            if let Some(ref url) = repo.remote_url {
                assert!(
                    !url.contains("supersecrettoken"),
                    "remote_url must not contain auth token; got: {}", url
                );
                assert!(
                    !url.contains("user:"),
                    "remote_url must not contain username:password; got: {}", url
                );
            }
        }
    }
}
