// src-tauri/src/native_tools.rs
// Built-in AI tools — always available without MCP.
// Gives Blade the same file/shell/web execution capabilities as Claude Code.

use crate::providers::ToolDefinition;
use serde_json::{json, Value};
use std::time::Duration;

const MAX_OUTPUT: usize = 50_000;
const BASH_TIMEOUT_MS: u64 = 30_000;

// ── Tool catalogue ─────────────────────────────────────────────────────────────

pub fn tool_definitions() -> Vec<ToolDefinition> {
    vec![
        ToolDefinition {
            name: "blade_bash".to_string(),
            description: "Execute a shell command and return stdout + stderr. Use for: running code, tests, git, npm/cargo/pip, file listing, system info, anything needing a shell. Prefer this over asking the user to run commands.".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "command": {"type": "string", "description": "The shell command to execute"},
                    "cwd": {"type": "string", "description": "Working directory (optional, defaults to home)"},
                    "timeout_ms": {"type": "integer", "description": "Timeout milliseconds (default 30000)"}
                },
                "required": ["command"]
            }),
        },
        ToolDefinition {
            name: "blade_read_file".to_string(),
            description: "Read a file and return its contents. Use for: reading source code, configs, logs, markdown, any text file. Supports offset/limit for large files.".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "File path (absolute or ~/...)"},
                    "offset": {"type": "integer", "description": "Start from line N (0-indexed, optional)"},
                    "limit": {"type": "integer", "description": "Max lines to return (optional)"}
                },
                "required": ["path"]
            }),
        },
        ToolDefinition {
            name: "blade_write_file".to_string(),
            description: "Write or create a file. Creates parent directories if needed. Use for: creating new files, writing scripts, saving output. Prefer blade_edit_file for targeted changes to existing files.".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "File path to write"},
                    "content": {"type": "string", "description": "Full file content"}
                },
                "required": ["path", "content"]
            }),
        },
        ToolDefinition {
            name: "blade_edit_file".to_string(),
            description: "Make a surgical edit — replace old_string with new_string in a file. old_string must appear exactly once. Always prefer this over rewriting the whole file for targeted changes. Read the file first if unsure of exact content.".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "File to edit"},
                    "old_string": {"type": "string", "description": "Exact text to replace (must be unique in file)"},
                    "new_string": {"type": "string", "description": "Replacement text"}
                },
                "required": ["path", "old_string", "new_string"]
            }),
        },
        ToolDefinition {
            name: "blade_glob".to_string(),
            description: "Find files matching a glob pattern. Supports **, *, ?. Use for: discovering project structure, finding files by type, searching across a codebase.".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "pattern": {"type": "string", "description": "Glob pattern e.g. src/**/*.ts or **/*.json"},
                    "cwd": {"type": "string", "description": "Base directory for relative patterns (optional, defaults to home)"}
                },
                "required": ["pattern"]
            }),
        },
        ToolDefinition {
            name: "blade_web_fetch".to_string(),
            description: "Fetch a URL and return text content. Use for: reading docs, GitHub raw files, APIs, web pages, checking changelogs, downloading data.".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "url": {"type": "string", "description": "URL to fetch"},
                    "max_chars": {"type": "integer", "description": "Max characters to return (default 20000)"}
                },
                "required": ["url"]
            }),
        },
    ]
}

/// Check if a tool name is a native Blade tool
pub fn is_native(name: &str) -> bool {
    name.starts_with("blade_")
}

/// Risk level for native tools (used by permission system)
pub fn risk(name: &str) -> crate::permissions::ToolRisk {
    match name {
        "blade_bash" | "blade_write_file" | "blade_edit_file" => {
            crate::permissions::ToolRisk::Ask
        }
        _ => crate::permissions::ToolRisk::Auto,
    }
}

/// Dispatch a native tool call. Returns (output, is_error).
pub async fn execute(name: &str, args: &Value) -> (String, bool) {
    match name {
        "blade_bash" => {
            let command = match args["command"].as_str() {
                Some(c) => c,
                None => return ("Missing required argument: command".to_string(), true),
            };
            let cwd = args["cwd"].as_str();
            let timeout_ms = args["timeout_ms"].as_u64().unwrap_or(BASH_TIMEOUT_MS);
            bash(command, cwd, timeout_ms).await
        }
        "blade_read_file" => {
            let path = match args["path"].as_str() {
                Some(p) => p,
                None => return ("Missing required argument: path".to_string(), true),
            };
            let offset = args["offset"].as_u64().unwrap_or(0) as usize;
            let limit = args["limit"].as_u64().map(|v| v as usize);
            read_file(path, offset, limit)
        }
        "blade_write_file" => {
            let path = match args["path"].as_str() {
                Some(p) => p,
                None => return ("Missing required argument: path".to_string(), true),
            };
            let content = match args["content"].as_str() {
                Some(c) => c,
                None => return ("Missing required argument: content".to_string(), true),
            };
            write_file(path, content)
        }
        "blade_edit_file" => {
            let path = match args["path"].as_str() {
                Some(p) => p,
                None => return ("Missing required argument: path".to_string(), true),
            };
            let old_string = match args["old_string"].as_str() {
                Some(s) => s,
                None => return ("Missing required argument: old_string".to_string(), true),
            };
            let new_string = match args["new_string"].as_str() {
                Some(s) => s,
                None => return ("Missing required argument: new_string".to_string(), true),
            };
            edit_file(path, old_string, new_string)
        }
        "blade_glob" => {
            let pattern = match args["pattern"].as_str() {
                Some(p) => p,
                None => return ("Missing required argument: pattern".to_string(), true),
            };
            let cwd = args["cwd"].as_str();
            do_glob(pattern, cwd)
        }
        "blade_web_fetch" => {
            let url = match args["url"].as_str() {
                Some(u) => u,
                None => return ("Missing required argument: url".to_string(), true),
            };
            let max_chars = args["max_chars"].as_u64().map(|v| v as usize).unwrap_or(20_000);
            web_fetch(url, max_chars).await
        }
        _ => (format!("Unknown native tool: {}", name), true),
    }
}

// ── Implementations ───────────────────────────────────────────────────────────

async fn bash(command: &str, cwd: Option<&str>, timeout_ms: u64) -> (String, bool) {
    let home = dirs::home_dir().unwrap_or_default();
    let work_dir = cwd
        .map(|d| expand_home(d))
        .map(std::path::PathBuf::from)
        .unwrap_or(home);

    let spawn_result = if cfg!(target_os = "windows") {
        tokio::process::Command::new("cmd")
            .args(["/C", command])
            .current_dir(&work_dir)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
    } else {
        tokio::process::Command::new("sh")
            .args(["-c", command])
            .current_dir(&work_dir)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
    };

    let child = match spawn_result {
        Ok(c) => c,
        Err(e) => return (format!("Failed to spawn: {}", e), true),
    };

    let result = tokio::time::timeout(
        Duration::from_millis(timeout_ms),
        child.wait_with_output(),
    )
    .await;

    match result {
        Ok(Ok(output)) => {
            let stdout = String::from_utf8_lossy(&output.stdout).into_owned();
            let stderr = String::from_utf8_lossy(&output.stderr).into_owned();
            let code = output.status.code().unwrap_or(-1);
            let text = format_bash_output(stdout, stderr, code);
            (text, code != 0)
        }
        Ok(Err(e)) => (format!("Command error: {}", e), true),
        Err(_) => (format!("Command timed out after {}ms", timeout_ms), true),
    }
}

fn format_bash_output(stdout: String, stderr: String, code: i32) -> String {
    let mut parts: Vec<String> = Vec::new();
    if !stdout.is_empty() {
        let s = truncate(stdout, MAX_OUTPUT);
        parts.push(s);
    }
    if !stderr.is_empty() {
        let s = truncate(stderr, MAX_OUTPUT);
        parts.push(format!("[stderr]\n{}", s));
    }
    if parts.is_empty() {
        format!("[exit {}]", code)
    } else {
        parts.join("\n")
    }
}

fn read_file(path: &str, offset: usize, limit: Option<usize>) -> (String, bool) {
    let expanded = expand_home(path);
    match std::fs::read_to_string(&expanded) {
        Ok(content) => {
            let lines: Vec<&str> = content.lines().collect();
            let start = offset.min(lines.len());
            let end = limit.map(|l| (start + l).min(lines.len())).unwrap_or(lines.len());
            let slice = lines[start..end].join("\n");
            let result = truncate(slice, MAX_OUTPUT);
            (if result.is_empty() { "(empty file)".to_string() } else { result }, false)
        }
        Err(e) => (format!("Cannot read '{}': {}", path, e), true),
    }
}

fn write_file(path: &str, content: &str) -> (String, bool) {
    let expanded = expand_home(path);
    let p = std::path::Path::new(&expanded);
    if let Some(parent) = p.parent() {
        if let Err(e) = std::fs::create_dir_all(parent) {
            return (format!("Cannot create directories: {}", e), true);
        }
    }
    match std::fs::write(&expanded, content) {
        Ok(_) => (format!("Wrote {} ({} bytes)", path, content.len()), false),
        Err(e) => (format!("Cannot write '{}': {}", path, e), true),
    }
}

fn edit_file(path: &str, old_string: &str, new_string: &str) -> (String, bool) {
    let expanded = expand_home(path);
    let content = match std::fs::read_to_string(&expanded) {
        Ok(c) => c,
        Err(e) => return (format!("Cannot read '{}': {}", path, e), true),
    };

    let count = content.matches(old_string).count();
    if count == 0 {
        return (
            format!(
                "old_string not found in '{}'. Read the file first to get exact content.",
                path
            ),
            true,
        );
    }
    if count > 1 {
        return (
            format!(
                "old_string appears {} times in '{}' — it must be unique. Add more surrounding context.",
                count, path
            ),
            true,
        );
    }

    let new_content = content.replacen(old_string, new_string, 1);
    match std::fs::write(&expanded, new_content) {
        Ok(_) => (format!("Edited '{}' successfully", path), false),
        Err(e) => (format!("Cannot write '{}': {}", path, e), true),
    }
}

fn do_glob(pattern: &str, cwd: Option<&str>) -> (String, bool) {
    let home = dirs::home_dir().unwrap_or_default();
    let base = cwd
        .map(|d| expand_home(d))
        .map(std::path::PathBuf::from)
        .unwrap_or(home);

    let full_pattern = if std::path::Path::new(pattern).is_absolute() {
        pattern.to_string()
    } else {
        format!("{}/{}", base.to_string_lossy(), pattern)
    };

    match glob::glob(&full_pattern) {
        Ok(paths) => {
            let mut results: Vec<String> = paths
                .filter_map(|p| p.ok())
                .map(|p| p.to_string_lossy().to_string())
                .take(500)
                .collect();
            if results.is_empty() {
                return ("No files matched.".to_string(), false);
            }
            results.sort();
            (results.join("\n"), false)
        }
        Err(e) => (format!("Invalid glob pattern '{}': {}", pattern, e), true),
    }
}

async fn web_fetch(url: &str, max_chars: usize) -> (String, bool) {
    let client = match reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .user_agent("Blade/0.2")
        .build()
    {
        Ok(c) => c,
        Err(e) => return (format!("HTTP client error: {}", e), true),
    };

    match client.get(url).send().await {
        Ok(resp) => {
            let status = resp.status();
            match resp.text().await {
                Ok(text) => {
                    let trimmed = truncate(text, max_chars);
                    (format!("[HTTP {}]\n{}", status, trimmed), !status.is_success())
                }
                Err(e) => (format!("Failed to read body: {}", e), true),
            }
        }
        Err(e) => (format!("Fetch failed: {}", e), true),
    }
}

fn expand_home(path: &str) -> String {
    if path.starts_with("~/") {
        if let Some(home) = dirs::home_dir() {
            return format!("{}/{}", home.to_string_lossy(), &path[2..]);
        }
    }
    path.to_string()
}

fn truncate(s: String, max: usize) -> String {
    if s.len() > max {
        format!("{}\n...[truncated at {} chars]", &s[..max], max)
    } else {
        s
    }
}
