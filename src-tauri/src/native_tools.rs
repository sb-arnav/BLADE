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
        ToolDefinition {
            name: "blade_list_dir".to_string(),
            description: "List files in a directory with name, size, and modification date. Use this for: browsing Downloads, Desktop, Documents, any folder. Works on all platforms. Returns files sorted newest-first.".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Directory path. Supports ~/ and common names like 'downloads', 'desktop', 'documents'"},
                    "since_days": {"type": "integer", "description": "Only show files modified in the last N days (optional)"},
                    "limit": {"type": "integer", "description": "Max files to return (default 50)"}
                },
                "required": ["path"]
            }),
        },
        ToolDefinition {
            name: "blade_set_clipboard".to_string(),
            description: "Copy text to the user's clipboard. Use this instead of shell commands (clip, pbcopy, xclip) — those mangle quotes and special characters.".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "text": {"type": "string", "description": "The text to copy to clipboard"}
                },
                "required": ["text"]
            }),
        },
        ToolDefinition {
            name: "blade_open_url".to_string(),
            description: "Open a URL in the user's default browser. Always use this instead of blade_bash for opening websites, YouTube videos, or any web links. The URL must be fully qualified (start with https://).".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "url": {"type": "string", "description": "The full URL to open, e.g. https://www.youtube.com/watch?v=dQw4w9WgXcQ"}
                },
                "required": ["url"]
            }),
        },
        ToolDefinition {
            name: "blade_ui_read".to_string(),
            description: "Read the UI elements of the currently focused window — returns buttons, inputs, labels, checkboxes, menus, etc. as a tree. Use this INSTEAD of screenshots to see what's on screen. Free, instant, no tokens.".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "max_depth": {"type": "integer", "description": "Tree depth (default 3)"},
                    "max_lines": {"type": "integer", "description": "Max output lines (default 40)"}
                }
            }),
        },
        ToolDefinition {
            name: "blade_ui_click".to_string(),
            description: "Click a UI element in the focused window by its name, automation ID, or type. No coordinates needed — finds the element by accessibility label. Preferred over blade_mouse for native apps.".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "Element name/label (e.g. 'OK', 'Submit', 'Search')"},
                    "automation_id": {"type": "string", "description": "Automation ID if known"},
                    "control_type": {"type": "string", "description": "Element type: button, edit, checkbox, combobox, listitem, menuitem, etc."},
                    "invoke": {"type": "boolean", "description": "Use invoke pattern instead of click (better for buttons, default false)"}
                }
            }),
        },
        ToolDefinition {
            name: "blade_ui_type".to_string(),
            description: "Find a text input in the focused window and set its value. Use for filling forms, search boxes, address bars.".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "Input field name/label"},
                    "automation_id": {"type": "string", "description": "Automation ID if known"},
                    "value": {"type": "string", "description": "Text to enter"}
                },
                "required": ["value"]
            }),
        },
        ToolDefinition {
            name: "blade_ui_wait".to_string(),
            description: "Wait for a UI element to appear (e.g. after opening an app or navigating). Returns when found or times out.".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "Element name to wait for"},
                    "timeout_ms": {"type": "integer", "description": "Max wait ms (default 5000)"}
                }
            }),
        },
        ToolDefinition {
            name: "blade_screenshot".to_string(),
            description: "LAST RESORT: take a screenshot. Prefer blade_ui_read for native apps. Only use this for games, canvas apps, or when ui_read returns nothing useful.".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "monitor": {"type": "integer", "description": "Monitor index (0 = primary, default 0)"}
                }
            }),
        },
        ToolDefinition {
            name: "blade_mouse".to_string(),
            description: "Move the mouse and/or click. Use to interact with anything on screen after taking a screenshot to find the target coordinates.".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "x": {"type": "integer", "description": "X coordinate (required for move/click)"},
                    "y": {"type": "integer", "description": "Y coordinate (required for move/click)"},
                    "action": {"type": "string", "enum": ["move", "click", "right_click", "double_click"], "description": "What to do (default: click)"}
                }
            }),
        },
        ToolDefinition {
            name: "blade_keyboard".to_string(),
            description: "Type text or press key combinations. Use to fill forms, trigger shortcuts, control apps after clicking into them.".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "text": {"type": "string", "description": "Text to type (unicode safe)"},
                    "key": {"type": "string", "description": "Named key to press: enter, escape, tab, space, backspace, delete, up, down, left, right, home, end, pageup, pagedown, f1-f12, or a single character"},
                    "modifiers": {"type": "array", "items": {"type": "string"}, "description": "Modifier keys to hold: ctrl, shift, alt, meta/win"}
                }
            }),
        },
        ToolDefinition {
            name: "blade_get_processes".to_string(),
            description: "List running processes/applications. Use to check if something is running, find a PID to kill, or see what apps are open.".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "filter": {"type": "string", "description": "Filter by process name (optional, case-insensitive)"}
                }
            }),
        },
        ToolDefinition {
            name: "blade_kill_process".to_string(),
            description: "Kill/close a running process by name or PID.".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "Process name (e.g. chrome.exe, notepad.exe)"},
                    "pid": {"type": "integer", "description": "Process ID"}
                }
            }),
        },
        ToolDefinition {
            name: "blade_search_web".to_string(),
            description: "Search the web and return top results with titles, URLs, and snippets. Use before blade_open_url when you need to find the right URL (latest video, docs page, etc.).".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Search query"},
                    "max_results": {"type": "integer", "description": "Number of results (default 5)"}
                },
                "required": ["query"]
            }),
        },
        ToolDefinition {
            name: "blade_update_thread".to_string(),
            description: "Update your own working memory — the live context document Blade keeps about what it's currently tracking. Use this to record key decisions, switch active projects, note open loops, or explicitly remember something important across the conversation. This is Blade's scratchpad, always injected into the next session.".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "content": {"type": "string", "description": "The new working memory content (max ~200 words, present-tense, dense)"},
                    "title": {"type": "string", "description": "One-line summary of active context"},
                    "project": {"type": "string", "description": "Project name this thread relates to (e.g. 'blade', 'staq', 'general')"}
                },
                "required": ["content"]
            }),
        },
        ToolDefinition {
            name: "blade_read_thread".to_string(),
            description: "Read Blade's current working memory thread — what was tracked from the last session. Use at the start of a conversation to recall active context.".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {}
            }),
        },
    ]
}

/// Check if a tool name is a native Blade tool
pub fn is_native(name: &str) -> bool {
    name.starts_with("blade_")
}

/// Risk level for native tools (used by permission system)
/// All native tools are auto-approved — Blade is a personal desktop AI,
/// the user is always the operator.
pub fn risk(_name: &str) -> crate::permissions::ToolRisk {
    crate::permissions::ToolRisk::Auto
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
        "blade_list_dir" => {
            let path = match args["path"].as_str() {
                Some(p) => p,
                None => return ("Missing required argument: path".to_string(), true),
            };
            let since_days = args["since_days"].as_u64().map(|d| d as u64);
            let limit = args["limit"].as_u64().map(|l| l as usize).unwrap_or(50);
            list_dir(path, since_days, limit)
        }
        "blade_set_clipboard" => {
            let text = match args["text"].as_str() {
                Some(t) => t,
                None => return ("Missing required argument: text".to_string(), true),
            };
            set_clipboard(text)
        }
        "blade_open_url" => {
            let url = match args["url"].as_str() {
                Some(u) => u,
                None => return ("Missing required argument: url".to_string(), true),
            };
            open_url(url).await
        }
        "blade_screenshot" => {
            let monitor_idx = args["monitor"].as_u64().unwrap_or(0) as usize;
            screenshot(monitor_idx).await
        }
        "blade_mouse" => {
            let x = args["x"].as_i64().map(|v| v as i32);
            let y = args["y"].as_i64().map(|v| v as i32);
            let action = args["action"].as_str().unwrap_or("click");
            mouse_action(x, y, action)
        }
        "blade_keyboard" => {
            let text = args["text"].as_str();
            let key = args["key"].as_str();
            let modifiers: Vec<&str> = args["modifiers"]
                .as_array()
                .map(|a| a.iter().filter_map(|v| v.as_str()).collect())
                .unwrap_or_default();
            keyboard_action(text, key, &modifiers)
        }
        "blade_get_processes" => {
            let filter = args["filter"].as_str();
            get_processes(filter).await
        }
        "blade_kill_process" => {
            let name = args["name"].as_str();
            let pid = args["pid"].as_i64().map(|v| v as u32);
            kill_process(name, pid).await
        }
        "blade_search_web" => {
            let query = match args["query"].as_str() {
                Some(q) => q,
                None => return ("Missing required argument: query".to_string(), true),
            };
            let max = args["max_results"].as_u64().unwrap_or(5) as usize;
            search_web(query, max).await
        }
        "blade_ui_read" => {
            let max_depth = args["max_depth"].as_u64().map(|v| v as u32);
            let max_lines = args["max_lines"].as_u64().map(|v| v as u32);
            ui_read(max_depth, max_lines)
        }
        "blade_ui_click" => {
            let name = args["name"].as_str().map(|s| s.to_string());
            let automation_id = args["automation_id"].as_str().map(|s| s.to_string());
            let control_type = args["control_type"].as_str().map(|s| s.to_string());
            let invoke = args["invoke"].as_bool().unwrap_or(false);
            ui_click(name, automation_id, control_type, invoke)
        }
        "blade_ui_type" => {
            let name = args["name"].as_str().map(|s| s.to_string());
            let automation_id = args["automation_id"].as_str().map(|s| s.to_string());
            let value = match args["value"].as_str() {
                Some(v) => v.to_string(),
                None => return ("Missing required argument: value".to_string(), true),
            };
            ui_type(name, automation_id, value)
        }
        "blade_ui_wait" => {
            let name = args["name"].as_str().map(|s| s.to_string());
            let timeout_ms = args["timeout_ms"].as_u64();
            ui_wait(name, timeout_ms)
        }
        // ── THREAD: Blade's working memory ─────────────────────────────────────
        "blade_update_thread" => {
            let content = match args["content"].as_str() {
                Some(c) => c.to_string(),
                None => return ("Missing required argument: content".to_string(), true),
            };
            let title = args["title"].as_str().map(|s| s.to_string());
            let project = args["project"].as_str().map(|s| s.to_string());
            match crate::thread::write_thread(
                &title.unwrap_or_else(|| "Active Context".to_string()),
                &content,
                &project.unwrap_or_else(|| "general".to_string()),
            ) {
                Ok(()) => ("Working memory updated.".to_string(), false),
                Err(e) => (format!("Failed to update thread: {}", e), true),
            }
        }
        "blade_read_thread" => {
            match crate::thread::get_active_thread() {
                Some(content) => (format!("Current working memory:\n\n{}", content), false),
                None => ("No active thread — working memory is empty.".to_string(), false),
            }
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

    #[cfg(target_os = "windows")]
    let spawn_result = {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        tokio::process::Command::new("cmd")
            .args(["/C", command])
            .current_dir(&work_dir)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
    };

    #[cfg(not(target_os = "windows"))]
    let spawn_result = tokio::process::Command::new("sh")
        .args(["-c", command])
        .current_dir(&work_dir)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn();

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

fn resolve_dir(path: &str) -> std::path::PathBuf {
    let home = dirs::home_dir().unwrap_or_default();
    let lower = path.to_lowercase();

    // Friendly names for common folders
    let resolved = match lower.trim_matches(['/', '\\', ' '].as_ref()) {
        "downloads" | "download" => home.join("Downloads"),
        "desktop" => home.join("Desktop"),
        "documents" | "docs" => home.join("Documents"),
        "pictures" | "photos" => home.join("Pictures"),
        "music" => home.join("Music"),
        "videos" => home.join("Videos"),
        _ => std::path::PathBuf::from(expand_home(path)),
    };
    resolved
}

fn list_dir(path: &str, since_days: Option<u64>, limit: usize) -> (String, bool) {
    let dir = resolve_dir(path);

    let entries = match std::fs::read_dir(&dir) {
        Ok(e) => e,
        Err(e) => return (format!("Cannot read '{}': {}", dir.display(), e), true),
    };

    let cutoff = since_days.map(|d| {
        std::time::SystemTime::now()
            .checked_sub(std::time::Duration::from_secs(d * 86400))
            .unwrap_or(std::time::UNIX_EPOCH)
    });

    let mut files: Vec<(std::time::SystemTime, String)> = entries
        .filter_map(|e| e.ok())
        .filter_map(|entry| {
            let meta = entry.metadata().ok()?;
            let modified = meta.modified().ok()?;
            if let Some(cutoff) = cutoff {
                if modified < cutoff { return None; }
            }
            let name = entry.file_name().to_string_lossy().to_string();
            let size = if meta.is_dir() {
                "<dir>".to_string()
            } else {
                let bytes = meta.len();
                if bytes >= 1_000_000 { format!("{:.1} MB", bytes as f64 / 1_000_000.0) }
                else if bytes >= 1_000 { format!("{:.0} KB", bytes as f64 / 1_000.0) }
                else { format!("{} B", bytes) }
            };

            // Format date
            let datetime: chrono::DateTime<chrono::Local> = modified.into();
            let date_str = datetime.format("%Y-%m-%d %H:%M").to_string();

            Some((modified, format!("{:<12} {}  {}", size, date_str, name)))
        })
        .collect();

    // Newest first
    files.sort_by(|a, b| b.0.cmp(&a.0));
    files.truncate(limit);

    if files.is_empty() {
        return (format!("No files found in {}", dir.display()), false);
    }

    let header = format!("{} files in {}:\n{:<12} {}  {}",
        files.len(), dir.display(), "SIZE", "MODIFIED", "NAME");
    let rows: Vec<String> = files.into_iter().map(|(_, row)| row).collect();
    (format!("{}\n{}", header, rows.join("\n")), false)
}

fn set_clipboard(text: &str) -> (String, bool) {
    match arboard::Clipboard::new().and_then(|mut c| c.set_text(text)) {
        Ok(_) => (format!("Copied {} chars to clipboard.", text.len()), false),
        Err(e) => (format!("Clipboard error: {}", e), true),
    }
}

async fn open_url(url: &str) -> (String, bool) {
    // Validate it looks like a URL before passing to the OS
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return (format!("Invalid URL '{}': must start with http:// or https://", url), true);
    }

    #[cfg(target_os = "windows")]
    let result = tokio::process::Command::new("cmd")
        .args(["/C", "start", "", url])
        .spawn();

    #[cfg(target_os = "macos")]
    let result = tokio::process::Command::new("open")
        .arg(url)
        .spawn();

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    let result = tokio::process::Command::new("xdg-open")
        .arg(url)
        .spawn();

    match result {
        Ok(_) => (format!("Opened {} in default browser.", url), false),
        Err(e) => (format!("Failed to open URL: {}", e), true),
    }
}

async fn screenshot(monitor_idx: usize) -> (String, bool) {
    use base64::Engine;
    use std::io::Cursor;

    let monitors = match xcap::Monitor::all() {
        Ok(m) => m,
        Err(e) => return (format!("Screen capture unavailable: {}", e), true),
    };
    let monitor = monitors.get(monitor_idx).or_else(|| monitors.first());
    let monitor = match monitor {
        Some(m) => m,
        None => return ("No monitors found".to_string(), true),
    };
    let image = match monitor.capture_image() {
        Ok(img) => img,
        Err(e) => return (format!("Capture failed: {}", e), true),
    };

    // Resize to max 1280px wide to keep token cost manageable
    let (w, h) = (image.width(), image.height());
    let resized = if w > 1280 {
        let scale = 1280.0 / w as f32;
        let nw = 1280u32;
        let nh = (h as f32 * scale) as u32;
        image::imageops::resize(&image, nw, nh, image::imageops::FilterType::Lanczos3)
    } else {
        image
    };

    let mut buf = Cursor::new(Vec::new());
    if let Err(e) = resized.write_to(&mut buf, image::ImageFormat::Png) {
        return (format!("PNG encode failed: {}", e), true);
    }
    let b64 = base64::engine::general_purpose::STANDARD.encode(buf.into_inner());

    (format!("data:image/png;base64,{}", b64), false)
}

fn mouse_action(x: Option<i32>, y: Option<i32>, action: &str) -> (String, bool) {
    use enigo::{Enigo, Settings, Mouse, Button, Direction::Click, Coordinate::Abs};

    let mut enigo = match Enigo::new(&Settings::default()) {
        Ok(e) => e,
        Err(e) => return (format!("Input control unavailable: {}", e), true),
    };

    if let (Some(x), Some(y)) = (x, y) {
        if let Err(e) = enigo.move_mouse(x, y, Abs) {
            return (format!("Mouse move failed: {}", e), true);
        }
    }

    if action == "move" {
        return (format!("Mouse moved to ({}, {})", x.unwrap_or(0), y.unwrap_or(0)), false);
    }

    // Small delay to let OS process the move
    std::thread::sleep(std::time::Duration::from_millis(50));

    let result = match action {
        "right_click" => enigo.button(Button::Right, Click),
        "double_click" => enigo.button(Button::Left, Click)
            .and_then(|_| { std::thread::sleep(std::time::Duration::from_millis(50)); enigo.button(Button::Left, Click) }),
        _ => enigo.button(Button::Left, Click), // default: click
    };

    match result {
        Ok(_) => (format!("{} at ({}, {})", action, x.unwrap_or(0), y.unwrap_or(0)), false),
        Err(e) => (format!("Mouse action failed: {}", e), true),
    }
}

fn keyboard_action(text: Option<&str>, key: Option<&str>, modifiers: &[&str]) -> (String, bool) {
    use enigo::{Enigo, Settings, Keyboard, Key, Direction::{Click, Press, Release}};

    let mut enigo = match Enigo::new(&Settings::default()) {
        Ok(e) => e,
        Err(e) => return (format!("Input control unavailable: {}", e), true),
    };

    // Hold modifiers
    let mod_keys: Vec<Key> = modifiers.iter().filter_map(|m| match *m {
        "ctrl" | "control" => Some(Key::Control),
        "shift" => Some(Key::Shift),
        "alt" => Some(Key::Alt),
        "meta" | "win" | "super" => Some(Key::Meta),
        _ => None,
    }).collect();

    for k in &mod_keys {
        let _ = enigo.key(*k, Press);
    }

    let result = if let Some(text) = text {
        enigo.text(text).map(|_| format!("Typed: {}", text))
    } else if let Some(key_name) = key {
        let k = match key_name.to_lowercase().as_str() {
            "enter" | "return" => Key::Return,
            "escape" | "esc" => Key::Escape,
            "tab" => Key::Tab,
            "space" => Key::Space,
            "backspace" => Key::Backspace,
            "delete" | "del" => Key::Delete,
            "up" => Key::UpArrow,
            "down" => Key::DownArrow,
            "left" => Key::LeftArrow,
            "right" => Key::RightArrow,
            "home" => Key::Home,
            "end" => Key::End,
            "pageup" => Key::PageUp,
            "pagedown" => Key::PageDown,
            "f1" => Key::F1, "f2" => Key::F2, "f3" => Key::F3, "f4" => Key::F4,
            "f5" => Key::F5, "f6" => Key::F6, "f7" => Key::F7, "f8" => Key::F8,
            "f9" => Key::F9, "f10" => Key::F10, "f11" => Key::F11, "f12" => Key::F12,
            s if s.len() == 1 => Key::Unicode(s.chars().next().unwrap()),
            _ => return (format!("Unknown key: {}", key_name), true),
        };
        enigo.key(k, Click).map(|_| format!("Pressed: {}", key_name))
    } else {
        return ("Provide either 'text' or 'key'".to_string(), true);
    };

    // Release modifiers
    for k in mod_keys.iter().rev() {
        let _ = enigo.key(*k, Release);
    }

    match result {
        Ok(msg) => (msg, false),
        Err(e) => (format!("Keyboard action failed: {}", e), true),
    }
}

async fn get_processes(filter: Option<&str>) -> (String, bool) {
    #[cfg(target_os = "windows")]
    let cmd = "tasklist /FO CSV /NH";
    #[cfg(not(target_os = "windows"))]
    let cmd = "ps -eo pid,comm,%mem --sort=-%mem";

    let (output, is_err) = bash(cmd, None, 10_000).await;
    if is_err {
        return (output, true);
    }

    #[cfg(target_os = "windows")]
    let lines: Vec<String> = output.lines()
        .filter_map(|line| {
            // CSV: "chrome.exe","1234","Console","1","50,000 K"
            let parts: Vec<&str> = line.trim_matches('"').splitn(5, "\",\"").collect();
            if parts.len() < 2 { return None; }
            let name = parts[0].trim_matches('"');
            let pid = parts[1].trim_matches('"');
            let mem = parts.get(4).unwrap_or(&"").trim_matches('"').replace(" K", "K");
            let entry = format!("{:<30} PID:{:<8} MEM:{}", name, pid, mem);
            if let Some(f) = filter {
                if !name.to_lowercase().contains(&f.to_lowercase()) { return None; }
            }
            Some(entry)
        })
        .take(50)
        .collect();

    #[cfg(not(target_os = "windows"))]
    let lines: Vec<String> = output.lines()
        .filter(|l| {
            if let Some(f) = filter {
                l.to_lowercase().contains(&f.to_lowercase())
            } else { true }
        })
        .take(50)
        .map(|l| l.to_string())
        .collect();

    if lines.is_empty() {
        return (filter.map(|f| format!("No processes matching '{}'", f)).unwrap_or("No processes found".to_string()), false);
    }
    (format!("{} processes:\n{}", lines.len(), lines.join("\n")), false)
}

async fn kill_process(name: Option<&str>, pid: Option<u32>) -> (String, bool) {
    #[cfg(target_os = "windows")]
    let cmd = match (name, pid) {
        (_, Some(p)) => format!("taskkill /F /PID {}", p),
        (Some(n), _) => format!("taskkill /F /IM \"{}\"", n),
        _ => return ("Provide name or pid".to_string(), true),
    };
    #[cfg(not(target_os = "windows"))]
    let cmd = match (name, pid) {
        (_, Some(p)) => format!("kill -9 {}", p),
        (Some(n), _) => format!("pkill -f \"{}\"", n),
        _ => return ("Provide name or pid".to_string(), true),
    };
    bash(&cmd, None, 5_000).await
}

async fn search_web(query: &str, max_results: usize) -> (String, bool) {
    let encoded = urlencoding::encode(query);
    let url = format!("https://lite.duckduckgo.com/lite/?q={}", encoded);

    let (html, is_err) = web_fetch(&url, 50_000).await;
    if is_err { return (html, true); }

    // Parse results from DuckDuckGo Lite HTML
    // Results look like: <a class="result-link" href="...">Title</a>
    // and snippets in <td class="result-snippet">...
    let mut results: Vec<String> = Vec::new();
    let mut last_url = String::new();
    let mut last_title = String::new();
    let mut i = 0;

    for line in html.lines() {
        if results.len() >= max_results { break; }
        let trimmed = line.trim();

        // Extract URL from href
        if trimmed.contains("result-link") {
            if let Some(href_start) = trimmed.find("href=\"//") {
                let rest = &trimmed[href_start + 6..];
                if let Some(end) = rest.find('"') {
                    last_url = format!("https:{}", &rest[..end]);
                }
            } else if let Some(href_start) = trimmed.find("href=\"https") {
                let rest = &trimmed[href_start + 6..];
                if let Some(end) = rest.find('"') {
                    last_url = rest[..end].to_string();
                }
            }
            // Extract title text between > and </a>
            if let Some(start) = trimmed.rfind('>') {
                let after = &trimmed[start + 1..];
                if let Some(end) = after.find('<') {
                    last_title = after[..end].trim().to_string();
                }
            }
        }

        // Snippet comes after
        if trimmed.contains("result-snippet") && !last_url.is_empty() {
            let snippet_text = trimmed
                .replace("<td class=\"result-snippet\">", "")
                .replace("</td>", "")
                .replace("<b>", "")
                .replace("</b>", "")
                .trim()
                .to_string();
            if !last_title.is_empty() || !snippet_text.is_empty() {
                results.push(format!("{}. {}\n   {}\n   {}", i + 1, last_title, snippet_text, last_url));
                i += 1;
            }
            last_url.clear();
            last_title.clear();
        }
    }

    if results.is_empty() {
        return (format!("No results found for: {}", query), false);
    }
    (format!("Search results for '{}':\n\n{}", query, results.join("\n\n")), false)
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

// ── UI Automation wrappers ─────────────────────────────────────────────────────

fn ui_read(max_depth: Option<u32>, max_lines: Option<u32>) -> (String, bool) {
    match crate::ui_automation::uia_describe_active_window(max_depth, None, max_lines) {
        Ok(text) => (text, false),
        Err(e) => (e, true),
    }
}

fn ui_click(
    name: Option<String>,
    automation_id: Option<String>,
    control_type: Option<String>,
    invoke: bool,
) -> (String, bool) {
    let selector = crate::ui_automation::UiSelector {
        name,
        automation_id,
        class_name: None,
        control_type,
    };
    let result = if invoke {
        crate::ui_automation::uia_invoke_element(selector)
    } else {
        crate::ui_automation::uia_click_element(selector)
    };
    match result {
        Ok(msg) => (msg, false),
        Err(e) => (e, true),
    }
}

fn ui_type(name: Option<String>, automation_id: Option<String>, value: String) -> (String, bool) {
    let selector = crate::ui_automation::UiSelector {
        name,
        automation_id,
        class_name: None,
        control_type: None,
    };
    match crate::ui_automation::uia_set_element_value(selector, value) {
        Ok(msg) => (msg, false),
        Err(e) => (e, true),
    }
}

fn ui_wait(name: Option<String>, timeout_ms: Option<u64>) -> (String, bool) {
    let selector = crate::ui_automation::UiSelector {
        name,
        automation_id: None,
        class_name: None,
        control_type: None,
    };
    match crate::ui_automation::uia_wait_for_element(selector, timeout_ms) {
        Ok(msg) => (msg, false),
        Err(e) => (e, true),
    }
}
