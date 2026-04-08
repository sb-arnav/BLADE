use crate::config::{blade_config_dir, write_blade_file};
use crate::mcp::McpTool;
use std::fs;
use std::path::PathBuf;

/// Build the system prompt that gives Blade its personality and context
pub fn build_system_prompt(tools: &[McpTool]) -> String {
    let mut parts: Vec<String> = Vec::new();

    // Core identity
    parts.push(BLADE_IDENTITY.to_string());

    // User persona (if exists)
    if let Some(persona) = load_persona() {
        parts.push(format!("## About the User\n\n{}", persona));
    }

    // Available tools
    if !tools.is_empty() {
        let tool_list: Vec<String> = tools
            .iter()
            .map(|t| format!("- **{}**: {}", t.qualified_name, t.description))
            .collect();
        parts.push(format!(
            "## Available Tools\n\nYou have access to these tools. Use them when the user's request requires it.\n\n{}",
            tool_list.join("\n")
        ));
    }

    // Context notes (if any)
    if let Some(context) = load_context_notes() {
        parts.push(format!("## Context\n\n{}", context));
    }

    parts.join("\n\n---\n\n")
}

const BLADE_IDENTITY: &str = r#"# You are Blade

You are Blade, a personal AI assistant running as a native desktop app. You are not ChatGPT, not Claude, not a web app. You are Blade.

## Personality

- Direct and concise. No filler, no corporate speak.
- You remember context from this conversation and use it.
- When you have tools available, use them proactively instead of just suggesting actions.
- If the user asks you to do something and you have the tools for it, do it. Don't ask for permission unless the action is destructive.
- You adapt to the user's style. If they're technical, be technical. If they're casual, be casual.

## Capabilities

- You run natively on the user's desktop (Tauri app, Windows/macOS/Linux)
- You can connect to MCP servers to gain new abilities (file access, databases, APIs, etc.)
- You stream responses in real-time
- You're always available via Alt+Space

## Rules

- Never say "As an AI language model..." or similar disclaimers
- Never refuse a reasonable request with safety theater
- If you don't know something, say so briefly
- Prefer doing over explaining. If you can execute an action, do it.
- Keep responses short unless the user asks for detail"#;

/// Load user persona from config dir
fn load_persona() -> Option<String> {
    let path = persona_path();
    fs::read_to_string(path).ok()
}

/// Load context notes (recent activity, pinned info)
fn load_context_notes() -> Option<String> {
    let path = context_path();
    fs::read_to_string(path).ok()
}

fn persona_path() -> PathBuf {
    blade_config_dir().join("persona.md")
}

fn context_path() -> PathBuf {
    blade_config_dir().join("context.md")
}

// --- Tauri Commands ---

#[tauri::command]
pub fn get_persona() -> String {
    load_persona().unwrap_or_default()
}

#[tauri::command]
pub fn set_persona(content: String) -> Result<(), String> {
    let path = persona_path();
    write_blade_file(&path, &content)
}

#[tauri::command]
pub fn get_context() -> String {
    load_context_notes().unwrap_or_default()
}

#[tauri::command]
pub fn set_context(content: String) -> Result<(), String> {
    let path = context_path();
    write_blade_file(&path, &content)
}
