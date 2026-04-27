#![allow(dead_code)]

//! Scanner: which_sweep — detects installed CLIs from a curated 40-tool list.
//!
//! Uses `which <tool>` subprocess then `<tool> --version` for version string.
//! All version strings are truncated via crate::safe_slice (max 40 chars).
//!
//! Threat mitigations (T-12-09):
//! - Version output capped at 40 chars via safe_slice
//! - Non-UTF8 output handled via String::from_utf8_lossy
//! - No network calls

/// Re-export the shared ToolRow type from shell_history (same struct shape).
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

/// Curated list of 40 CLI tools to probe.
const TOOLS: &[&str] = &[
    // Dev CLIs
    "git", "node", "python3", "python", "rustc", "cargo", "poetry", "uv",
    "npm", "pnpm", "yarn", "bun", "deno", "docker", "kubectl", "terraform",
    "vercel", "wrangler", "aws", "gcloud", "supabase", "railway", "fly",
    "gh", "glab",
    // AI CLIs
    "claude", "codex", "aider", "goose", "continue",
    // OS tools
    "rg", "fd", "fzf", "jq", "yq", "bat", "eza", "exa", "zoxide",
];

/// Run the which_sweep scanner (no lead needed — this is a global breadth-fill scan).
pub fn run() -> Vec<ToolRow> {
    TOOLS.iter().map(|cli| run_for_single_tool(cli, None)).collect()
}

/// Run the which check for a single CLI tool.
/// `path_prefix` is used in tests to prepend a directory to PATH for finding stubs.
pub fn run_for_single_tool(cli: &str, path_prefix: Option<&str>) -> ToolRow {
    let which_result = run_which(cli, path_prefix);

    let (installed, version) = match which_result {
        None => (false, None),
        Some(tool_path) => {
            let ver = run_version(&tool_path);
            (true, ver)
        }
    };

    ToolRow {
        row_id: format!("tool:{}", cli),
        cli: cli.to_string(),
        installed,
        version,
        invocations: None,
        category: tool_category(cli).to_string(),
        source: "which_sweep".to_string(),
    }
}

/// Run `which <cli>` and return the path string if found.
fn run_which(cli: &str, path_prefix: Option<&str>) -> Option<String> {
    let mut cmd = std::process::Command::new("which");
    cmd.arg(cli);

    // For tests: prepend a temp dir to PATH so stub executables are found
    if let Some(prefix) = path_prefix {
        let current_path = std::env::var("PATH").unwrap_or_default();
        let new_path = format!("{}:{}", prefix, current_path);
        cmd.env("PATH", new_path);
    }

    let output = cmd.output().ok()?;
    if !output.status.success() { return None; }
    let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if path.is_empty() { return None; }
    Some(path)
}

/// Run `<tool_path> --version` and return the first line, truncated to 40 chars.
fn run_version(tool_path: &str) -> Option<String> {
    let output = std::process::Command::new(tool_path)
        .arg("--version")
        .output()
        .ok()?;

    // Some tools write version to stderr (e.g., git)
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);

    let version_str = if !stdout.trim().is_empty() {
        stdout.lines().next().unwrap_or("").to_string()
    } else {
        stderr.lines().next().unwrap_or("").to_string()
    };

    if version_str.is_empty() { return None; }

    // T-12-09: cap version string at 40 chars via safe_slice
    let truncated = crate::safe_slice(&version_str, 40).to_string();
    Some(truncated)
}

/// Map a CLI name to its category string.
fn tool_category(cli: &str) -> &'static str {
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
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::os::unix::fs::PermissionsExt;
    use tempfile::tempdir;

    #[test]
    fn test_detects_installed() {
        let dir = tempdir().unwrap();
        let stub_path = dir.path().join("fake-tool");

        // Create a stub executable that exits 0 and prints a version
        #[cfg(unix)]
        {
            fs::write(&stub_path, "#!/bin/sh\necho 'fake-tool version 1.0.0'\n").unwrap();
            let mut perms = fs::metadata(&stub_path).unwrap().permissions();
            perms.set_mode(0o755);
            fs::set_permissions(&stub_path, perms).unwrap();
        }

        let path_prefix = dir.path().to_str().unwrap();
        let row = run_for_single_tool("fake-tool", Some(path_prefix));

        assert!(row.installed, "expected fake-tool to be detected as installed");
        assert_eq!(row.cli, "fake-tool");
        assert!(row.version.is_some(), "expected version string");
    }

    #[test]
    fn test_safe_slice_version() {
        // Test that a 200-char version string is truncated to ≤40 chars
        let long_version = "a".repeat(200);
        let truncated = crate::safe_slice(&long_version, 40).to_string();
        assert!(
            truncated.len() <= 40,
            "version should be capped at 40 chars, got {} chars: {:?}", truncated.len(), truncated
        );
    }

    #[test]
    fn test_not_installed_tool() {
        // A tool that definitely doesn't exist
        let row = run_for_single_tool("definitely-not-a-real-tool-xyz-12345", None);
        assert!(!row.installed, "non-existent tool should have installed=false");
        assert!(row.version.is_none(), "non-existent tool should have no version");
    }
}
