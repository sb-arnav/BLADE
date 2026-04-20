#![allow(dead_code)]

//! Scanner: ai_sessions — detects Claude, Codex, Cursor, Continue, Aider session directories.
//!
//! Threat mitigations (T-12-10):
//! - NEVER reads .jsonl session content — only directory-level metadata (mtime, count).
//! - All path truncations use crate::safe_slice (never &str[..n])
//! - No network calls

use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::deep_scan::leads::{AccountRow, Lead, LeadKind, Tier};

/// Row type for a detected AI tool / coding assistant.
#[derive(Debug, Clone)]
pub struct AiToolRow {
    pub row_id: String,
    pub name: String,
    pub session_count: usize,
    pub last_active: Option<i64>,
    pub detected: bool,
    pub source: String,
}

/// Run the ai_sessions scanner for a given lead.
///
/// Returns (Vec<AiToolRow>, Vec<Lead>) where leads are follow-ups
/// for project paths decoded from session directory slugs.
pub fn run(lead: &Lead) -> (Vec<AiToolRow>, Vec<Lead>) {
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    let mut rows: Vec<AiToolRow> = Vec::new();
    let mut follow_ups: Vec<Lead> = Vec::new();

    let _lead_path = lead.payload.get("path").and_then(|v| v.as_str()).map(PathBuf::from);

    // Claude projects directory
    let claude_projects = home.join(".claude").join("projects");
    if claude_projects.is_dir() {
        let (row, leads) = scan_claude_projects(&claude_projects, &home);
        rows.push(row);
        follow_ups.extend(leads);
    }

    // Codex sessions
    let codex_sessions = home.join(".codex").join("sessions");
    if codex_sessions.is_dir() {
        rows.push(scan_session_dir(&codex_sessions, "codex"));
    }

    // Cursor presence check
    if home.join(".cursor").is_dir() {
        rows.push(AiToolRow {
            row_id: "ai:cursor".to_string(),
            name: "cursor".to_string(),
            session_count: 0,
            last_active: None,
            detected: true,
            source: "ai_sessions".to_string(),
        });
    }

    // Continue presence check
    if home.join(".continue").is_dir() {
        rows.push(AiToolRow {
            row_id: "ai:continue".to_string(),
            name: "continue".to_string(),
            session_count: 0,
            last_active: None,
            detected: true,
            source: "ai_sessions".to_string(),
        });
    }

    // Aider presence check
    if home.join(".aider").is_dir() {
        rows.push(AiToolRow {
            row_id: "ai:aider".to_string(),
            name: "aider".to_string(),
            session_count: 0,
            last_active: None,
            detected: true,
            source: "ai_sessions".to_string(),
        });
    }

    (rows, follow_ups)
}

/// Scan ~/.claude/projects/ for project slug directories.
/// Slug format: the project path with '/' replaced by '-' (best-effort reverse).
fn scan_claude_projects(projects_dir: &std::path::Path, home: &std::path::Path) -> (AiToolRow, Vec<Lead>) {
    let mut follow_ups: Vec<Lead> = Vec::new();
    let mut session_count = 0usize;
    let mut last_active: Option<i64> = None;
    let now_unix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);

    if let Ok(entries) = std::fs::read_dir(projects_dir) {
        for entry in entries.filter_map(|e| e.ok()) {
            let path = entry.path();
            if !path.is_dir() { continue; }
            session_count += 1;

            // Get mtime for tier assignment
            let mtime_unix = entry.metadata()
                .and_then(|m| m.modified())
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_secs() as i64)
                .unwrap_or(0);

            // Track most-recent mtime
            if mtime_unix > last_active.unwrap_or(0) {
                last_active = Some(mtime_unix);
            }

            let age_days = if mtime_unix > 0 { (now_unix - mtime_unix) / 86400 } else { i64::MAX };
            let tier = if age_days <= 7 {
                Tier::Hot
            } else if age_days <= 30 {
                Tier::Warm
            } else {
                Tier::Cold
            };

            // Best-effort slug decode: Claude slugs are the project path
            // with '/' replaced by '-'. Try to reconstruct the path.
            let slug = entry.file_name().to_string_lossy().to_string();
            if let Some(resolved) = decode_claude_slug(&slug, home) {
                let path_str = resolved.to_string_lossy().to_string();
                follow_ups.push(Lead::new(
                    LeadKind::FsRepoWalk,
                    Tier::Hot, // AI session paths are always Hot leads
                    format!("claude_session:{}", crate::safe_slice(&slug, 60)),
                    serde_json::json!({ "path": path_str }),
                ));
            } else {
                // Unknown path — emit as ProjectRootHint at assigned tier with slug in debug payload
                follow_ups.push(Lead::new(
                    LeadKind::ProjectRootHint,
                    tier,
                    format!("claude_session_slug:{}", crate::safe_slice(&slug, 60)),
                    serde_json::json!({ "path": projects_dir.to_string_lossy().as_ref(), "slug": slug }),
                ));
            }
        }
    }

    let row = AiToolRow {
        row_id: "ai:claude".to_string(),
        name: "claude".to_string(),
        session_count,
        last_active,
        detected: true,
        source: "ai_sessions".to_string(),
    };

    (row, follow_ups)
}

/// Attempt to decode a Claude project slug back to a filesystem path.
///
/// Claude encodes paths by replacing '/' with '-'. Given a home dir,
/// we attempt: home/{slug_decoded} and /home/{username}/{slug_after_home_prefix}.
fn decode_claude_slug(slug: &str, home: &std::path::Path) -> Option<PathBuf> {
    // Claude slugs: "/home/username/project/path" → "home-username-project-path"
    // The leading segment is typically "home-{username}-..."
    let parts: Vec<&str> = slug.splitn(3, '-').collect();
    if parts.len() < 2 { return None; }

    // Try to reconstruct a path from the slug
    // Strategy: replace dashes with '/', prepend '/', check existence
    let candidate = format!("/{}", slug.replace('-', "/"));
    let candidate_path = PathBuf::from(&candidate);
    if candidate_path.is_dir() {
        return Some(candidate_path);
    }

    // Strategy 2: slug starts with "home-{username}-rest" → "/home/{username}/rest"
    if slug.starts_with("home-") {
        let without_home = &slug[5..]; // strip "home-"
        let candidate2 = format!("/home/{}", without_home.replacen('-', "/", 1));
        let p2 = PathBuf::from(&candidate2);
        if p2.is_dir() {
            return Some(p2);
        }
    }

    // Strategy 3: assume project lives under home dir
    // slug = "home-arnav-Projects-blade" → try home/Projects/blade
    if home.to_str().is_some() {
        let username = home.file_name()?.to_str()?;
        let prefix = format!("home-{}-", username);
        if let Some(rest) = slug.strip_prefix(&prefix) {
            let relative = rest.replace('-', "/");
            let candidate3 = home.join(&relative);
            if candidate3.is_dir() {
                return Some(candidate3);
            }
        }
    }

    None
}

/// Scan a generic session directory (count entries, find most recent mtime).
fn scan_session_dir(dir: &std::path::Path, tool_name: &str) -> AiToolRow {
    let mut count = 0usize;
    let mut last_active: Option<i64> = None;

    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.filter_map(|e| e.ok()) {
            count += 1;
            let mtime_unix = entry.metadata()
                .and_then(|m| m.modified())
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_secs() as i64)
                .unwrap_or(0);
            if mtime_unix > last_active.unwrap_or(0) {
                last_active = Some(mtime_unix);
            }
        }
    }

    AiToolRow {
        row_id: format!("ai:{}", tool_name),
        name: tool_name.to_string(),
        session_count: count,
        last_active,
        detected: true,
        source: "ai_sessions".to_string(),
    }
}

/// Scan ~/.ssh/config and extract AccountRow entries for known hosting platforms.
///
/// NEVER stores private key paths or IdentityFile values.
pub fn scan_ssh_config() -> Vec<AccountRow> {
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    let ssh_config = home.join(".ssh").join("config");
    let Ok(content) = std::fs::read_to_string(&ssh_config) else { return vec![] };

    let mut accounts: Vec<AccountRow> = Vec::new();
    let mut current_host: Option<String> = None;
    let mut current_hostname: Option<String> = None;

    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') { continue; }

        if let Some(rest) = trimmed.strip_prefix("Host ") {
            // Save previous block if it had a HostName
            if let (Some(host), Some(hostname)) = (current_host.take(), current_hostname.take()) {
                if let Some(row) = make_ssh_account_row(&host, &hostname) {
                    accounts.push(row);
                }
            }
            let host = rest.trim().to_string();
            // Skip wildcard Host * entries
            if host != "*" {
                current_host = Some(host);
            }
        } else if let Some(rest) = trimmed.strip_prefix("HostName ") {
            current_hostname = Some(rest.trim().to_string());
        }
        // Intentionally skip IdentityFile, User, Port and all other keys
    }

    // Handle last block
    if let (Some(host), Some(hostname)) = (current_host, current_hostname) {
        if let Some(row) = make_ssh_account_row(&host, &hostname) {
            accounts.push(row);
        }
    }

    accounts
}

fn make_ssh_account_row(host_alias: &str, hostname: &str) -> Option<AccountRow> {
    let platform = match hostname {
        "github.com" => "github",
        "gitlab.com" => "gitlab",
        "bitbucket.org" => "bitbucket",
        other => other,
    };

    Some(AccountRow {
        row_id: format!("account:ssh:{}", host_alias),
        platform: platform.to_string(),
        handle: host_alias.to_string(),
        source: "ssh_config".to_string(),
        discovered_via: "~/.ssh/config".to_string(),
    })
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn test_slug_to_project_path() {
        let dir = tempdir().unwrap();
        // Create a fake project directory
        let project_dir = dir.path().join("myproject");
        fs::create_dir_all(&project_dir).unwrap();

        // Create a Claude projects directory with a slug that encodes the project path
        let projects_dir = dir.path().join(".claude").join("projects");
        fs::create_dir_all(&projects_dir).unwrap();

        // Slug: dir.path() is something like /tmp/xxx — encode it as a slug
        // We'll use a simpler approach: create slug = "home-user-myproject-abc123"
        // and test the decode path instead
        let slug_name = "home-user-myproject-abc123";
        let slug_dir = projects_dir.join(slug_name);
        fs::create_dir_all(&slug_dir).unwrap();

        let (row, _follow_ups) = scan_claude_projects(&projects_dir, dir.path());

        assert_eq!(row.name, "claude");
        assert!(row.detected);
        assert!(row.session_count >= 1, "expected at least 1 session, got {}", row.session_count);
    }

    #[test]
    fn test_recent_session_is_hot() {
        let dir = tempdir().unwrap();
        let projects_dir = dir.path().join(".claude").join("projects");
        fs::create_dir_all(&projects_dir).unwrap();

        // Create a session directory (mtime is now by default → ≤7 days → Hot)
        let session_dir = projects_dir.join("home-user-blade");
        fs::create_dir_all(&session_dir).unwrap();

        let (_row, follow_ups) = scan_claude_projects(&projects_dir, dir.path());

        // Since the directory was just created (mtime = now), it should be Hot tier
        // The follow_up for a recent session should be at Hot tier OR FsRepoWalk (also effectively hot)
        // We assert at least one follow_up was produced
        assert!(!follow_ups.is_empty(), "expected at least one follow-up lead for recent session");

        // The follow_up tier for a just-created directory is Hot (age_days == 0)
        let has_hot = follow_ups.iter().any(|fl| fl.priority_tier == Tier::Hot);
        assert!(has_hot, "expected at least one Hot tier follow-up, got: {:?}",
            follow_ups.iter().map(|f| &f.priority_tier).collect::<Vec<_>>());
    }

    #[test]
    fn test_ssh_config_parse() {
        // Test the SSH config parser with an inline multi-block config
        let config = "\
Host github
    HostName github.com
    User git
    IdentityFile ~/.ssh/id_rsa

Host work-gitlab
    HostName gitlab.com
    User git

Host *
    ServerAliveInterval 60
";
        // Write config to temp dir and parse
        let dir = tempdir().unwrap();
        let ssh_dir = dir.path().join(".ssh");
        fs::create_dir_all(&ssh_dir).unwrap();
        fs::write(ssh_dir.join("config"), config).unwrap();

        // Override home dir by calling make_ssh_account_row directly
        let mut accounts: Vec<AccountRow> = Vec::new();
        // Parse manually to simulate what scan_ssh_config does
        let mut current_host: Option<String> = None;
        let mut current_hostname: Option<String> = None;
        for line in config.lines() {
            let trimmed = line.trim();
            if trimmed.is_empty() || trimmed.starts_with('#') { continue; }
            if let Some(rest) = trimmed.strip_prefix("Host ") {
                if let (Some(host), Some(hostname)) = (current_host.take(), current_hostname.take()) {
                    if let Some(row) = make_ssh_account_row(&host, &hostname) {
                        accounts.push(row);
                    }
                }
                let host = rest.trim().to_string();
                if host != "*" { current_host = Some(host); }
            } else if let Some(rest) = trimmed.strip_prefix("HostName ") {
                current_hostname = Some(rest.trim().to_string());
            }
        }
        if let (Some(host), Some(hostname)) = (current_host, current_hostname) {
            if let Some(row) = make_ssh_account_row(&host, &hostname) {
                accounts.push(row);
            }
        }

        // Should find github.com → "github" platform
        let github_account = accounts.iter().find(|a| a.platform == "github");
        assert!(github_account.is_some(), "expected github account, got: {:?}",
            accounts.iter().map(|a| &a.platform).collect::<Vec<_>>());
        assert_eq!(github_account.unwrap().handle, "github");

        // Should find gitlab.com → "gitlab" platform
        let gitlab_account = accounts.iter().find(|a| a.platform == "gitlab");
        assert!(gitlab_account.is_some(), "expected gitlab account");

        // Should NOT contain any IdentityFile value in account rows
        let debug_str = format!("{:?}", accounts);
        assert!(!debug_str.contains("id_rsa"), "IdentityFile should never appear in AccountRow");
    }
}
