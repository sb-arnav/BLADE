use serde::{Deserialize, Serialize};

/// Tool risk level — determines whether user approval is needed
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ToolRisk {
    /// Safe to auto-run (read-only operations)
    Auto,
    /// Needs user confirmation (writes, deletes, sends)
    Ask,
    /// Blocked entirely
    Blocked,
}

/// Classify a tool's risk based on its name and description
pub fn classify_tool(name: &str, description: &str) -> ToolRisk {
    let name_lower = name.to_lowercase();
    let desc_lower = description.to_lowercase();

    // Blocked patterns — never auto-run
    let blocked = ["drop", "truncate", "format", "rm -rf", "shutdown", "reboot"];
    for pattern in &blocked {
        if name_lower.contains(pattern) || desc_lower.contains(pattern) {
            return ToolRisk::Blocked;
        }
    }

    // Dangerous patterns — require confirmation
    let dangerous = [
        "delete", "remove", "write", "create", "update", "modify",
        "send", "post", "put", "patch", "push", "deploy", "execute",
        "run", "shell", "bash", "exec", "install", "uninstall",
        "kill", "stop", "restart", "move", "rename", "upload",
        "publish", "release", "commit", "merge",
    ];
    for pattern in &dangerous {
        if name_lower.contains(pattern) || desc_lower.contains(pattern) {
            return ToolRisk::Ask;
        }
    }

    // Safe patterns — auto-run
    let safe = [
        "get", "list", "read", "search", "find", "show", "view",
        "fetch", "query", "describe", "info", "status", "count",
        "check", "verify", "validate", "parse", "format", "convert",
    ];
    for pattern in &safe {
        if name_lower.contains(pattern) {
            return ToolRisk::Auto;
        }
    }

    // Unknown — default to asking
    ToolRisk::Ask
}

#[tauri::command]
pub fn classify_mcp_tool(name: String, description: String) -> ToolRisk {
    classify_tool(&name, &description)
}
