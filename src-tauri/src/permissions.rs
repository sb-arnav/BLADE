use crate::config::blade_config_dir;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;

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

/// Classify a tool's risk — checks user overrides first, then pattern-based defaults
pub fn classify_tool(name: &str, description: &str) -> ToolRisk {
    // Check user overrides first
    let overrides = load_overrides();
    if let Some(risk) = overrides.get(name) {
        return risk.clone();
    }

    classify_default(name, description)
}

fn classify_default(name: &str, description: &str) -> ToolRisk {
    let name_lower = name.to_lowercase();
    let desc_lower = description.to_lowercase();

    let blocked = ["drop", "truncate", "format", "rm -rf", "shutdown", "reboot"];
    for pattern in &blocked {
        if name_lower.contains(pattern) || desc_lower.contains(pattern) {
            return ToolRisk::Blocked;
        }
    }

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

    let safe = [
        "get", "list", "read", "search", "find", "show", "view",
        "fetch", "query", "describe", "info", "status", "count",
        "check", "verify", "validate", "parse", "convert",
    ];
    for pattern in &safe {
        if name_lower.contains(pattern) {
            return ToolRisk::Auto;
        }
    }

    ToolRisk::Ask
}

// --- User Overrides ---

fn overrides_path() -> std::path::PathBuf {
    blade_config_dir().join("tool_overrides.json")
}

fn load_overrides() -> HashMap<String, ToolRisk> {
    let path = overrides_path();
    match fs::read_to_string(&path) {
        Ok(data) => serde_json::from_str(&data).unwrap_or_default(),
        Err(_) => HashMap::new(),
    }
}

fn save_overrides(overrides: &HashMap<String, ToolRisk>) -> Result<(), String> {
    let path = overrides_path();
    let data = serde_json::to_string_pretty(overrides).map_err(|e| e.to_string())?;
    crate::config::write_blade_file(&path, &data)
}

// --- Tauri Commands ---

#[tauri::command]
pub fn classify_mcp_tool(name: String, description: String) -> ToolRisk {
    classify_tool(&name, &description)
}

#[tauri::command]
pub fn set_tool_trust(tool_name: String, risk: ToolRisk) -> Result<(), String> {
    let mut overrides = load_overrides();
    overrides.insert(tool_name, risk);
    save_overrides(&overrides)
}

#[tauri::command]
pub fn reset_tool_trust(tool_name: String) -> Result<(), String> {
    let mut overrides = load_overrides();
    overrides.remove(&tool_name);
    save_overrides(&overrides)
}

#[tauri::command]
pub fn get_tool_overrides() -> HashMap<String, ToolRisk> {
    load_overrides()
}
