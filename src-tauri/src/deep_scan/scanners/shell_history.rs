#![allow(dead_code)]

//! Scanner: shell_history — extracts tool invocation counts and cd-target paths.
//!
//! Threat mitigations (T-12-07):
//! - ONLY stores: command name (first token) + cd-target paths
//! - DISCARDS everything else — never stores arguments that may contain credentials
//! - All path truncations use crate::safe_slice (never &str[..n])
//! - test_no_secret_persistence asserts no secret string appears in output

use std::collections::HashMap;
use std::path::PathBuf;

use crate::deep_scan::leads::{Lead, LeadKind, Tier};

/// Row type for a detected CLI tool with invocation count from shell history.
#[derive(Debug, Clone)]
pub struct ToolRow {
    pub row_id: String,
    pub cli: String,
    pub installed: bool,
    pub version: Option<String>,
    pub invocations: Option<usize>,
    pub category: String,
    pub source: String,
}

/// Curated list of tools to track invocations for.
const TRACKED_TOOLS: &[&str] = &[
    "git", "npm", "cargo", "poetry", "uv", "docker", "kubectl", "vercel",
    "wrangler", "aws", "gcloud", "gh", "claude", "aider", "cursor", "code",
    "rg", "fd", "fzf", "pnpm", "yarn", "bun", "deno", "python3", "python",
    "rustc", "node", "terraform", "fly", "railway", "supabase",
];

/// Run the shell_history scanner for a given lead.
///
/// Returns (Vec<ToolRow>, Vec<Lead>) where leads are PathHint follow-ups
/// for unique existing cd-target directories.
pub fn run(lead: &Lead) -> (Vec<ToolRow>, Vec<Lead>) {
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    let mut invocations: HashMap<String, usize> = HashMap::new();
    let mut cd_paths: Vec<PathBuf> = Vec::new();
    let mut follow_ups: Vec<Lead> = Vec::new();

    let _lead_path = lead.payload.get("path").and_then(|v| v.as_str()).map(PathBuf::from);

    // History files to probe (in priority order)
    let histfile_env = std::env::var("HISTFILE").ok().map(PathBuf::from);
    let mut history_files: Vec<(PathBuf, &str)> = Vec::new();
    if let Some(hf) = histfile_env {
        if hf.exists() { history_files.push((hf, "env")); }
    }
    let candidates = [
        (home.join(".zsh_history"), "zsh"),
        (home.join(".bash_history"), "bash"),
        (home.join(".local").join("share").join("fish").join("fish_history"), "fish"),
    ];
    for (path, shell) in &candidates {
        if path.exists() {
            history_files.push((path.clone(), shell));
        }
    }

    for (hist_path, shell) in &history_files {
        parse_history_file(hist_path, shell, &home, &mut invocations, &mut cd_paths);
    }

    // Deduplicate cd paths
    cd_paths.sort();
    cd_paths.dedup();

    // Build PathHint leads for unique existing directories
    for cd_path in &cd_paths {
        if cd_path.is_dir() {
            let path_str = cd_path.to_string_lossy().to_string();
            follow_ups.push(Lead::new(
                LeadKind::ProjectRootHint,
                Tier::Warm,
                format!("shell_history_cd:{}", crate::safe_slice(&path_str, 80)),
                serde_json::json!({ "path": path_str }),
            ));
        }
    }

    // Build ToolRow for each tool that was invoked
    let tool_rows: Vec<ToolRow> = invocations.into_iter()
        .map(|(cli, count)| ToolRow {
            row_id: format!("tool:{}", cli),
            cli: cli.clone(),
            installed: false, // shell_history doesn't check installation
            version: None,
            invocations: Some(count),
            category: tool_category(&cli),
            source: "shell_history".to_string(),
        })
        .collect();

    (tool_rows, follow_ups)
}

/// Parse a single history file, extracting tool invocations and cd targets.
fn parse_history_file(
    path: &std::path::Path,
    shell: &str,
    home: &std::path::Path,
    invocations: &mut HashMap<String, usize>,
    cd_paths: &mut Vec<PathBuf>,
) {
    let Ok(content) = std::fs::read_to_string(path) else { return };

    // Take last 500 lines only
    let lines: Vec<&str> = content.lines().collect();
    let start = lines.len().saturating_sub(500);
    let last_lines = &lines[start..];

    for line in last_lines {
        let cmd = extract_command(line, shell);
        if cmd.is_empty() { continue; }

        // Extract only the first whitespace-separated token (command name)
        let cmd_name = cmd.split_whitespace().next().unwrap_or("").to_string();
        if cmd_name.is_empty() { continue; }

        // Handle cd: extract path argument; check if it exists
        if cmd.starts_with("cd ") {
            let rest = cmd[3..].trim().trim_matches('"').trim_matches('\'');
            if rest.is_empty() || rest == "~" || rest == "-" { continue; }
            let expanded = if rest.starts_with('~') {
                if rest.len() > 1 {
                    home.join(&rest[2..])
                } else {
                    home.to_path_buf()
                }
            } else {
                PathBuf::from(rest)
            };
            if expanded.is_dir() {
                cd_paths.push(expanded);
            }
            continue;
        }

        // Track invocations for curated tool list only
        if TRACKED_TOOLS.contains(&cmd_name.as_str()) {
            *invocations.entry(cmd_name).or_insert(0) += 1;
        }
        // DISCARD the rest of the command line — never store arguments
    }
}

/// Extract the actual command from a history line based on shell format.
///
/// Zsh extended: ": 1700000000:0;actual_command args"
/// Fish YAML:    "- cmd: actual_command args"
/// Bash:         "actual_command args"
///
/// Returns only the command string (NEVER the args for secret commands).
/// Note: we return the full command string so cd-path extraction can work,
/// but we only store the cmd_name (first token) for tracked tools.
fn extract_command<'a>(line: &'a str, shell: &str) -> &'a str {
    match shell {
        "zsh" | "env" => {
            // Zsh extended history format: ": <timestamp>:<elapsed>;<command>"
            if line.starts_with(": ") {
                line.splitn(2, ';').nth(1).unwrap_or("").trim()
            } else {
                line.trim()
            }
        }
        "fish" => {
            // Fish YAML format: "- cmd: <command>"
            if let Some(rest) = line.strip_prefix("- cmd: ") {
                rest.trim()
            } else {
                // Skip non-cmd lines in fish history (when:, paths:, etc.)
                ""
            }
        }
        _ => line.trim(), // bash
    }
}

/// Map a CLI name to its category.
fn tool_category(cli: &str) -> String {
    match cli {
        "git" | "gh" | "glab" => "vcs",
        "node" | "rustc" | "cargo" | "poetry" | "uv" | "python3" | "python"
        | "npm" | "pnpm" | "yarn" | "bun" | "deno" => "lang",
        "docker" | "kubectl" | "terraform" => "container",
        "vercel" | "wrangler" | "aws" | "gcloud" | "supabase" | "railway" | "fly" => "infra",
        "claude" | "codex" | "aider" | "goose" | "continue" => "ai",
        "rg" | "fd" | "fzf" | "jq" | "yq" | "bat" | "eza" | "exa" | "zoxide" => "os",
        "cursor" | "code" => "ide",
        _ => "other",
    }.to_string()
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    fn make_lead(path: &str) -> Lead {
        Lead::new(
            LeadKind::ShellHistoryScan,
            Tier::Warm,
            "test",
            serde_json::json!({ "path": path }),
        )
    }

    #[test]
    fn test_parses_zsh_ext() {
        let dir = tempdir().unwrap();
        let project_dir = dir.path().join("blade");
        fs::create_dir_all(&project_dir).unwrap();

        let zsh_line = format!(": 1700000000:0;cd {}", project_dir.to_string_lossy());
        let hist_file = dir.path().join(".zsh_history");
        fs::write(&hist_file, &zsh_line).unwrap();

        let mut invocations = HashMap::new();
        let mut cd_paths = Vec::new();
        parse_history_file(&hist_file, "zsh", dir.path(), &mut invocations, &mut cd_paths);

        assert!(
            cd_paths.iter().any(|p| p.ends_with("blade")),
            "expected blade path in cd_paths, got: {:?}", cd_paths
        );
    }

    #[test]
    fn test_no_secret_persistence() {
        let dir = tempdir().unwrap();
        let hist_file = dir.path().join(".bash_history");
        // Write a line that contains a secret
        fs::write(&hist_file, "export API_KEY=sk-proj-abc123\ngit status\n").unwrap();

        let mut invocations = HashMap::new();
        let mut cd_paths = Vec::new();
        parse_history_file(&hist_file, "bash", dir.path(), &mut invocations, &mut cd_paths);

        // Build tool rows from invocations
        let tool_rows: Vec<ToolRow> = invocations.into_iter()
            .map(|(cli, count)| ToolRow {
                row_id: format!("tool:{}", cli),
                cli: cli.clone(),
                installed: false,
                version: None,
                invocations: Some(count),
                category: tool_category(&cli),
                source: "shell_history".to_string(),
            })
            .collect();

        // The debug output must NOT contain the secret
        let debug_str = format!("{:?}", tool_rows);
        assert!(
            !debug_str.contains("sk-proj-abc123"),
            "Secret must never appear in ToolRow output. Debug: {}", debug_str
        );
        // Also check cd_paths
        let cd_debug = format!("{:?}", cd_paths);
        assert!(
            !cd_debug.contains("sk-proj-abc123"),
            "Secret must never appear in cd_paths. Debug: {}", cd_debug
        );
    }

    #[test]
    fn test_fish_yaml() {
        let dir = tempdir().unwrap();
        let staq_dir = dir.path().join("Staq");
        fs::create_dir_all(&staq_dir).unwrap();

        let fish_content = format!(
            "- cmd: cd {}\n  when: 1700000000\n",
            staq_dir.to_string_lossy()
        );
        let hist_file = dir.path().join("fish_history");
        fs::write(&hist_file, &fish_content).unwrap();

        let mut invocations = HashMap::new();
        let mut cd_paths = Vec::new();
        parse_history_file(&hist_file, "fish", dir.path(), &mut invocations, &mut cd_paths);

        assert!(
            cd_paths.iter().any(|p| p.ends_with("Staq")),
            "expected Staq path in cd_paths, got: {:?}", cd_paths
        );
    }
}
