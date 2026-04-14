/// Built-in MCP filesystem server — exposes safe file operations as MCP tools.
///
/// This is a built-in in-process server. It doesn't spawn a child process — instead
/// it registers its tools directly with McpManager when BLADE starts, alongside
/// the memory server.
///
/// Tools exposed:
/// - blade.fs.read_file   — read a file's contents (UTF-8)
/// - blade.fs.write_file  — write content to a file (creates dirs as needed)
/// - blade.fs.list_dir    — list files in a directory
/// - blade.fs.search      — search for files by name pattern (glob-style)

use crate::mcp::{McpContent, McpTool, McpToolResult};
use std::path::{Path, PathBuf};
use tokio::fs;

pub const SERVER_NAME: &str = "blade.fs";

pub fn register_built_in_tools() -> Vec<McpTool> {
    vec![
        McpTool {
            name: "read_file".to_string(),
            qualified_name: "blade.fs.read_file".to_string(),
            description: "Read the contents of a file. Returns UTF-8 text. \
                          Supports offset (line number to start from) and limit (max lines)."
                .to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "path":   {"type": "string",  "description": "Absolute or ~/ path to the file"},
                    "offset": {"type": "integer", "description": "Start from line N (0-indexed, optional)"},
                    "limit":  {"type": "integer", "description": "Max lines to return (optional)"}
                },
                "required": ["path"]
            }),
            server_name: SERVER_NAME.to_string(),
        },
        McpTool {
            name: "write_file".to_string(),
            qualified_name: "blade.fs.write_file".to_string(),
            description: "Write content to a file, creating parent directories if needed. \
                          Overwrites the file if it already exists."
                .to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "path":    {"type": "string", "description": "Absolute or ~/ path to write"},
                    "content": {"type": "string", "description": "Full content to write to the file"}
                },
                "required": ["path", "content"]
            }),
            server_name: SERVER_NAME.to_string(),
        },
        McpTool {
            name: "list_dir".to_string(),
            qualified_name: "blade.fs.list_dir".to_string(),
            description: "List files and directories inside a directory. Returns name, size, \
                          modification time, and whether each entry is a directory."
                .to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "path":  {"type": "string",  "description": "Directory path to list"},
                    "limit": {"type": "integer", "description": "Max entries to return (default 100)"}
                },
                "required": ["path"]
            }),
            server_name: SERVER_NAME.to_string(),
        },
        McpTool {
            name: "search".to_string(),
            qualified_name: "blade.fs.search".to_string(),
            description: "Search for files by name pattern within a directory tree. \
                          Supports * (any chars within a path segment) and ** (any path depth). \
                          Returns matching file paths."
                .to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "root":    {"type": "string", "description": "Root directory to search from"},
                    "pattern": {"type": "string", "description": "Glob pattern, e.g. '**/*.rs' or 'src/*.ts'"},
                    "limit":   {"type": "integer", "description": "Max results (default 50)"}
                },
                "required": ["root", "pattern"]
            }),
            server_name: SERVER_NAME.to_string(),
        },
    ]
}

pub async fn handle_tool_call(
    tool_name: &str,
    args: serde_json::Value,
) -> Result<McpToolResult, String> {
    match tool_name {
        "read_file" => handle_read_file(args).await,
        "write_file" => handle_write_file(args).await,
        "list_dir" => handle_list_dir(args).await,
        "search" => handle_search(args).await,
        _ => Err(format!("Unknown blade.fs tool: {}", tool_name)),
    }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

fn ok_text(text: String) -> McpToolResult {
    McpToolResult {
        content: vec![McpContent {
            content_type: "text".to_string(),
            text: Some(text),
        }],
        is_error: false,
    }
}

fn err_text(text: String) -> McpToolResult {
    McpToolResult {
        content: vec![McpContent {
            content_type: "text".to_string(),
            text: Some(text),
        }],
        is_error: true,
    }
}

/// Expand a leading `~/` or `~\` to the user's home directory.
fn expand_path(raw: &str) -> PathBuf {
    if raw.starts_with("~/") || raw.starts_with("~\\") {
        if let Some(home) = dirs::home_dir() {
            return home.join(&raw[2..]);
        }
    }
    PathBuf::from(raw)
}

// ── Tool handlers ────────────────────────────────────────────────────────────

async fn handle_read_file(args: serde_json::Value) -> Result<McpToolResult, String> {
    let raw_path = match args["path"].as_str() {
        Some(p) => p.to_string(),
        None => return Ok(err_text("Missing required parameter: path".to_string())),
    };
    let path = expand_path(&raw_path);
    let offset = args["offset"].as_u64().unwrap_or(0) as usize;
    let limit = args["limit"].as_u64().map(|n| n as usize);

    let content = match fs::read_to_string(&path).await {
        Ok(c) => c,
        Err(e) => return Ok(err_text(format!("Failed to read '{}': {}", path.display(), e))),
    };

    let lines: Vec<&str> = content.lines().collect();
    let slice_start = offset.min(lines.len());
    let slice = &lines[slice_start..];
    let slice = match limit {
        Some(n) => &slice[..n.min(slice.len())],
        None => slice,
    };

    let result = serde_json::json!({
        "path": path.display().to_string(),
        "total_lines": lines.len(),
        "offset": slice_start,
        "returned_lines": slice.len(),
        "content": slice.join("\n")
    });

    Ok(ok_text(result.to_string()))
}

async fn handle_write_file(args: serde_json::Value) -> Result<McpToolResult, String> {
    let raw_path = match args["path"].as_str() {
        Some(p) => p.to_string(),
        None => return Ok(err_text("Missing required parameter: path".to_string())),
    };
    let content = match args["content"].as_str() {
        Some(c) => c.to_string(),
        None => return Ok(err_text("Missing required parameter: content".to_string())),
    };
    let path = expand_path(&raw_path);

    // Create parent directories if needed
    if let Some(parent) = path.parent() {
        if let Err(e) = fs::create_dir_all(parent).await {
            return Ok(err_text(format!(
                "Failed to create directories for '{}': {}",
                path.display(),
                e
            )));
        }
    }

    let bytes_written = content.len();
    if let Err(e) = fs::write(&path, &content).await {
        return Ok(err_text(format!("Failed to write '{}': {}", path.display(), e)));
    }

    Ok(ok_text(
        serde_json::json!({
            "ok": true,
            "path": path.display().to_string(),
            "bytes_written": bytes_written
        })
        .to_string(),
    ))
}

async fn handle_list_dir(args: serde_json::Value) -> Result<McpToolResult, String> {
    let raw_path = match args["path"].as_str() {
        Some(p) => p.to_string(),
        None => return Ok(err_text("Missing required parameter: path".to_string())),
    };
    let limit = args["limit"].as_u64().unwrap_or(100) as usize;
    let path = expand_path(&raw_path);

    let mut read_dir = match fs::read_dir(&path).await {
        Ok(rd) => rd,
        Err(e) => {
            return Ok(err_text(format!(
                "Failed to list '{}': {}",
                path.display(),
                e
            )))
        }
    };

    let mut entries = Vec::new();
    while let Ok(Some(entry)) = read_dir.next_entry().await {
        if entries.len() >= limit {
            break;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        let meta = entry.metadata().await;
        let (size, modified, is_dir) = match meta {
            Ok(m) => {
                let modified = m
                    .modified()
                    .ok()
                    .and_then(|t| {
                        t.duration_since(std::time::UNIX_EPOCH)
                            .ok()
                            .map(|d| d.as_secs())
                    })
                    .unwrap_or(0);
                (m.len(), modified, m.is_dir())
            }
            Err(_) => (0, 0, false),
        };
        entries.push(serde_json::json!({
            "name": name,
            "size": size,
            "modified": modified,
            "is_dir": is_dir
        }));
    }

    // Sort directories first, then by name
    entries.sort_by(|a, b| {
        let a_dir = a["is_dir"].as_bool().unwrap_or(false);
        let b_dir = b["is_dir"].as_bool().unwrap_or(false);
        b_dir
            .cmp(&a_dir)
            .then_with(|| a["name"].as_str().cmp(&b["name"].as_str()))
    });

    let result = serde_json::json!({
        "path": path.display().to_string(),
        "count": entries.len(),
        "entries": entries
    });

    Ok(ok_text(result.to_string()))
}

async fn handle_search(args: serde_json::Value) -> Result<McpToolResult, String> {
    let raw_root = match args["root"].as_str() {
        Some(r) => r.to_string(),
        None => return Ok(err_text("Missing required parameter: root".to_string())),
    };
    let pattern = match args["pattern"].as_str() {
        Some(p) => p.to_string(),
        None => return Ok(err_text("Missing required parameter: pattern".to_string())),
    };
    let limit = args["limit"].as_u64().unwrap_or(50) as usize;
    let root = expand_path(&raw_root);

    // Walk the directory tree and match file names against the pattern
    let mut matches: Vec<String> = Vec::new();
    search_recursive(&root, &root, &pattern, limit, &mut matches);

    let result = serde_json::json!({
        "root": root.display().to_string(),
        "pattern": pattern,
        "count": matches.len(),
        "paths": matches
    });

    Ok(ok_text(result.to_string()))
}

/// Recursively walk `dir`, matching each file's path (relative to `root`) against `pattern`.
/// Uses a simple glob matcher: `*` matches within one path segment, `**` matches any depth.
fn search_recursive(
    root: &Path,
    dir: &Path,
    pattern: &str,
    limit: usize,
    results: &mut Vec<String>,
) {
    if results.len() >= limit {
        return;
    }

    let read_dir = match std::fs::read_dir(dir) {
        Ok(rd) => rd,
        Err(_) => return,
    };

    for entry in read_dir.flatten() {
        if results.len() >= limit {
            break;
        }
        let path = entry.path();
        let relative = match path.strip_prefix(root) {
            Ok(r) => r.to_string_lossy().replace('\\', "/"),
            Err(_) => continue,
        };

        if path.is_dir() {
            search_recursive(root, &path, pattern, limit, results);
        } else if glob_match(pattern, &relative) {
            results.push(path.display().to_string());
        }
    }
}

/// Minimal glob matcher supporting `*` (within segment) and `**` (any depth).
fn glob_match(pattern: &str, path: &str) -> bool {
    glob_match_inner(
        &pattern.split('/').collect::<Vec<_>>(),
        &path.split('/').collect::<Vec<_>>(),
    )
}

fn glob_match_inner(pattern_parts: &[&str], path_parts: &[&str]) -> bool {
    if pattern_parts.is_empty() {
        return path_parts.is_empty();
    }

    let (head, tail) = (pattern_parts[0], &pattern_parts[1..]);

    if head == "**" {
        // ** matches zero or more path segments
        for i in 0..=path_parts.len() {
            if glob_match_inner(tail, &path_parts[i..]) {
                return true;
            }
        }
        return false;
    }

    if path_parts.is_empty() {
        return false;
    }

    let (path_head, path_tail) = (path_parts[0], &path_parts[1..]);
    segment_match(head, path_head) && glob_match_inner(tail, path_tail)
}

/// Match a single path segment against a pattern segment (supports `*` and `?`).
fn segment_match(pattern: &str, segment: &str) -> bool {
    let p: Vec<char> = pattern.chars().collect();
    let s: Vec<char> = segment.chars().collect();
    segment_match_chars(&p, &s)
}

fn segment_match_chars(p: &[char], s: &[char]) -> bool {
    if p.is_empty() {
        return s.is_empty();
    }
    match p[0] {
        '*' => {
            // * matches zero or more characters within the segment
            for i in 0..=s.len() {
                if segment_match_chars(&p[1..], &s[i..]) {
                    return true;
                }
            }
            false
        }
        '?' => !s.is_empty() && segment_match_chars(&p[1..], &s[1..]),
        c => !s.is_empty() && {
            // Case-insensitive on Windows, case-sensitive elsewhere
            #[cfg(target_os = "windows")]
            let eq = c.to_lowercase().eq(s[0].to_lowercase());
            #[cfg(not(target_os = "windows"))]
            let eq = c == s[0];
            eq && segment_match_chars(&p[1..], &s[1..])
        },
    }
}
