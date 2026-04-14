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
            description: "Execute a shell command and return stdout + stderr. Use for: running code, tests, git, npm/cargo/pip, file listing, system info, anything needing a shell. Prefer this over asking the user to run commands. Custom tools forged by BLADE live in ~/.blade/tools/ and can be called directly via bash (e.g. `python3 ~/.blade/tools/my_tool.py [args]`).".to_string(),
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
            name: "blade_browser_open".to_string(),
            description: "Open a URL in BLADE's managed browser (Chromium with persistent login sessions). Use this for: posting on X/Twitter, interacting with YouTube, Reddit, any website. Sessions persist — if the user has logged in before, they're still logged in. Prefer over blade_open_url when you need to READ or INTERACT with the page.".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "url": {"type": "string", "description": "URL to navigate to, e.g. https://x.com"}
                },
                "required": ["url"]
            }),
        },
        ToolDefinition {
            name: "blade_browser_read".to_string(),
            description: "Read the current page in BLADE's managed browser: returns title, URL, and visible interactive elements (buttons, inputs, links). Call after blade_browser_open to see what's on screen.".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {}
            }),
        },
        ToolDefinition {
            name: "blade_browser_click".to_string(),
            description: "Click an element in BLADE's managed browser by CSS selector. Use after blade_browser_read to identify the right selector. Examples: '#compose-button', 'button[data-testid=\"tweetButton\"]', 'a[href*=\"youtube\"]'.".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "selector": {"type": "string", "description": "CSS selector for the element to click"}
                },
                "required": ["selector"]
            }),
        },
        ToolDefinition {
            name: "blade_browser_type".to_string(),
            description: "Type text into an input field in BLADE's managed browser by CSS selector. Use for search boxes, compose areas, form fields.".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "selector": {"type": "string", "description": "CSS selector for the input field"},
                    "text": {"type": "string", "description": "Text to type"}
                },
                "required": ["selector", "text"]
            }),
        },
        ToolDefinition {
            name: "blade_browser_screenshot".to_string(),
            description: "Take a screenshot of the current page in BLADE's managed browser. Use when blade_browser_read doesn't give enough detail about layout.".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {}
            }),
        },
        ToolDefinition {
            name: "blade_browser_login".to_string(),
            description: "Open BLADE's managed browser at a URL so the user can log in manually. Use this the first time BLADE needs to interact with a site. After login, sessions persist permanently.".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "url": {"type": "string", "description": "URL to open for login, e.g. https://x.com/login"}
                },
                "required": ["url"]
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
            description: "LAST RESORT: take a screenshot. Prefer blade_ui_read for native apps. Only use this for games, canvas apps, or when ui_read returns nothing useful. When omitted, automatically captures the user's monitor (not BLADE's dedicated monitor if one is set).".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "monitor": {"type": "integer", "description": "Monitor index (0 = primary). Omit to auto-select the user's screen."}
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
            name: "blade_set_api_key".to_string(),
            description: "Configure an API key for a provider. Use this when the user gives you an API key in conversation — parse it, store it securely, and switch to that provider. Supports all providers. This is Blade configuring itself autonomously.".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "provider": {
                        "type": "string",
                        "description": "Provider name: 'anthropic', 'openai', 'gemini', 'groq', 'ollama', or 'openai' for any OpenAI-compat provider (use with base_url)",
                        "enum": ["anthropic", "openai", "gemini", "groq", "ollama"]
                    },
                    "api_key": {"type": "string", "description": "The API key to store securely in the system keychain"},
                    "base_url": {"type": "string", "description": "Custom base URL for OpenAI-compat providers (e.g. 'https://api.githubcopilot.com' for GitHub Copilot, 'https://api.deepseek.com/v1' for DeepSeek). Leave empty for native providers."},
                    "model": {"type": "string", "description": "Default model to use (e.g. 'claude-sonnet-4-5' for Copilot, 'deepseek-chat' for DeepSeek). Optional."}
                },
                "required": ["provider", "api_key"]
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
        ToolDefinition {
            name: "blade_set_reminder".to_string(),
            description: "Set a reminder that fires at a specific time or after a duration. Use when the user asks you to remind them about something ('remind me in 30 minutes', 'remind me tomorrow'). You MUST use this tool — never just say you'll remember. The reminder fires as an OS notification, TTS, and Discord message.".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "title": {"type": "string", "description": "Short, clear reminder title (max 80 chars)"},
                    "note": {"type": "string", "description": "Additional context or detail for the reminder (optional)"},
                    "time_expression": {"type": "string", "description": "When to fire: relative expressions like '30 minutes', '2 hours', '1 day', 'tomorrow', 'tonight'. Or absolute unix timestamp as a string."}
                },
                "required": ["title", "time_expression"]
            }),
        },
        ToolDefinition {
            name: "blade_watch_url".to_string(),
            description: "Add a URL to BLADE's resource watcher. BLADE will check this URL periodically and alert the user when the content changes. Use when the user wants to monitor a webpage (competitor pricing, GitHub releases, status pages, etc.).".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "url": {"type": "string", "description": "The URL to watch (must start with https://)"},
                    "label": {"type": "string", "description": "Human-readable label for this watcher (e.g. 'Competitor pricing page')"},
                    "interval_mins": {"type": "integer", "description": "How often to check in minutes (default 30, min 5, max 1440)"}
                },
                "required": ["url"]
            }),
        },
        ToolDefinition {
            name: "blade_list_reminders".to_string(),
            description: "List all pending reminders. Use when the user asks 'what reminders do I have' or 'what's scheduled'. Returns title, note, and when each fires.".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {}
            }),
        },
        ToolDefinition {
            name: "blade_notify".to_string(),
            description: "Send an OS push notification. Use when you want to alert the user about something important that you've noticed or completed — like 'Your download finished' or 'The site you were watching is now available'. Only use for genuinely important events, not for every response.".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "title": {"type": "string", "description": "Notification title (short, max 50 chars)"},
                    "body": {"type": "string", "description": "Notification body text (max 150 chars)"}
                },
                "required": ["title", "body"]
            }),
        },
        ToolDefinition {
            name: "blade_index_project".to_string(),
            description: "Index a codebase directory — extract all functions, classes, types, imports into a persistent knowledge graph. Run this once when entering a new project. BLADE never forgets indexed code across restarts. Use blade_find_symbol after indexing.".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Root directory of the project to index (absolute path)"},
                    "project_name": {"type": "string", "description": "Short name for this project (e.g. 'blade', 'staq')"}
                },
                "required": ["path", "project_name"]
            }),
        },
        ToolDefinition {
            name: "blade_find_symbol".to_string(),
            description: "Search BLADE's codebase knowledge graph for functions, classes, types, or any symbol. Returns file path, line number, and signature. Much faster than grep — this is indexed. Use after blade_index_project.".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Symbol name or description to search for"},
                    "project": {"type": "string", "description": "Restrict search to this project name (optional — omit to search all)"},
                    "symbol_type": {"type": "string", "description": "Filter by type: function, class, interface, type, const, export, import (optional)"},
                    "limit": {"type": "integer", "description": "Max results (default 20)"}
                },
                "required": ["query"]
            }),
        },
        ToolDefinition {
            name: "blade_recall_execution".to_string(),
            description: "Search BLADE's execution memory — every shell command ever run, its output, and whether it succeeded. Use when you see an error you might have solved before, or to recall how something was built. BLADE remembers every command it has run.".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "What to search for — error message, command name, or description"},
                    "limit": {"type": "integer", "description": "Max results (default 10)"}
                },
                "required": ["query"]
            }),
        },
        ToolDefinition {
            name: "blade_pentest_authorize".to_string(),
            description: "PENTEST MODE: Record authorization to security-test a target. REQUIRED before using any offensive security tools (nmap, nikto, sqlmap, metasploit, etc.). The user must confirm they own or are authorized to test the target. Creates a 24-hour authorization window. Without this, BLADE will refuse offensive commands.".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "target": {"type": "string", "description": "Target to authorize: IP, domain, IP range (CIDR), or description like 'my home lab'"},
                    "target_type": {"type": "string", "description": "Type: 'ip', 'domain', 'range', 'description'", "enum": ["ip", "domain", "range", "description"]},
                    "ownership_claim": {"type": "string", "description": "Claim type: 'owner' (I own this), 'authorized' (I have written permission), 'bug_bounty' (in-scope for bounty), 'ctf' (CTF challenge), 'lab' (my own test lab), 'hired' (hired as penetration tester)"},
                    "scope_notes": {"type": "string", "description": "What's in scope, what's out of scope, any constraints"}
                },
                "required": ["target", "target_type", "ownership_claim", "scope_notes"]
            }),
        },
        ToolDefinition {
            name: "blade_self_upgrade".to_string(),
            description: "Install a missing tool or capability that BLADE needs. Use when a command fails because a tool isn't installed. Pass the tool name (e.g., 'docker', 'node', 'ffmpeg', 'claude', 'aider'). BLADE installs it automatically.".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "tool": {"type": "string", "description": "Tool to install: node, python3, docker, git, ffmpeg, claude, aider, jq, ripgrep, fd, bat"},
                    "reason": {"type": "string", "description": "Why this tool is needed (for logging)"}
                },
                "required": ["tool"]
            }),
        },
        ToolDefinition {
            name: "blade_spawn_agent".to_string(),
            description: "Spawn a background AI coding agent (Claude Code, Aider, Goose) to autonomously complete a coding task. Returns immediately with an agent ID. The agent runs in the background — you can check status via blade_agent_status. Use for complex multi-file refactors, test generation, or any task that would take many tool calls. BLADE becomes the orchestrator.".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "task": {"type": "string", "description": "Detailed description of what the agent should do"},
                    "agent_type": {"type": "string", "description": "Agent to use: 'claude' (Claude Code CLI), 'aider', 'goose', 'bash' (raw script). Defaults to 'claude'.", "enum": ["claude", "aider", "goose", "bash"]},
                    "cwd": {"type": "string", "description": "Working directory for the agent (absolute path)"}
                },
                "required": ["task"]
            }),
        },
        ToolDefinition {
            name: "blade_agent_status".to_string(),
            description: "Check the status and output of a background agent spawned by blade_spawn_agent. Use to see if the agent finished and what it produced.".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "agent_id": {"type": "string", "description": "Agent ID returned by blade_spawn_agent. Omit to list all recent agents."}
                }
            }),
        },
        ToolDefinition {
            name: "blade_computer_use".to_string(),
            description: "Autonomously operate the computer to complete a multi-step goal. BLADE will screenshot the screen, analyze it, decide an action (click, type, scroll, open app/URL), execute it, and repeat until done. Use for tasks like 'open the settings app and turn on dark mode', 'fill out this form', 'navigate to X and find Y'. Requires a vision-capable model. Always gets user approval before submitting forms or payments.".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "goal": {"type": "string", "description": "What to accomplish — be specific about the end state"},
                    "max_steps": {"type": "integer", "description": "Maximum number of actions to take (default 20, max 20)"}
                },
                "required": ["goal"]
            }),
        },
        ToolDefinition {
            name: "blade_cron_add".to_string(),
            description: "Schedule a recurring task that BLADE will run autonomously on a schedule. Use when the user says 'every morning', 'every Monday', 'remind me daily', or wants automated recurring actions. Examples: daily git pull at 9am, weekly dependency check, hourly clipboard backup. Actions can be: bash commands, spawning a background agent, or sending a proactive message to the user.".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "Short human-readable name for this task (e.g. 'Morning standup prep')"},
                    "schedule": {"type": "string", "description": "Natural language schedule: 'every day at 9am', 'every Monday at 10am', 'every hour', 'every 30 minutes', 'every weekday at 8am'"},
                    "action_kind": {"type": "string", "enum": ["bash", "spawn_agent", "message"], "description": "What to do: 'bash' runs a shell command, 'spawn_agent' launches a background AI agent, 'message' sends you a proactive message/reminder"},
                    "action_payload": {"type": "string", "description": "The command to run (for bash), the task description (for spawn_agent), or the message text (for message)"},
                    "project_cwd": {"type": "string", "description": "Working directory for bash/agent actions (optional)"}
                },
                "required": ["name", "schedule", "action_kind", "action_payload"]
            }),
        },
        ToolDefinition {
            name: "blade_cron_list".to_string(),
            description: "List all scheduled recurring tasks BLADE is running on your behalf. Shows next run time and whether each task is enabled.".to_string(),
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
pub async fn execute(name: &str, args: &Value, app: Option<&tauri::AppHandle>) -> (String, bool) {
    match name {
        "blade_bash" => {
            let command = match args["command"].as_str() {
                Some(c) => c,
                None => return ("Missing required argument: command".to_string(), true),
            };
            let cwd = args["cwd"].as_str();
            let timeout_ms = args["timeout_ms"].as_u64().unwrap_or(BASH_TIMEOUT_MS);
            let result = bash(command, cwd, timeout_ms).await;
            // Pre-analyze failures in the background so BLADE has the fix ready before the user asks.
            // Only kick off if output looks like a real error (not just a non-zero exit with empty stderr).
            if result.1 {
                let err_text = &result.0;
                if err_text.contains("[stderr]") || err_text.len() > 50 {
                    if let Some(app_handle) = app {
                        crate::clipboard::prefetch_bash_failure(command, err_text, app_handle.clone());
                    }
                }
            }
            result
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
            let result = write_file(path, content);
            // Incremental re-index: if this file belongs to an indexed project, update its symbols
            if !result.1 {
                let path_owned = path.to_string();
                tauri::async_runtime::spawn(async move {
                    crate::indexer::reindex_file_if_tracked(&path_owned);
                });
            }
            result
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
            let result = edit_file(path, old_string, new_string);
            // Incremental re-index on successful edit
            if !result.1 {
                let path_owned = path.to_string();
                tauri::async_runtime::spawn(async move {
                    crate::indexer::reindex_file_if_tracked(&path_owned);
                });
            }
            result
        }
        "blade_glob" => {
            let pattern = match args["pattern"].as_str() {
                Some(p) => p,
                None => return ("Missing required argument: pattern".to_string(), true),
            };
            let cwd = args["cwd"].as_str();
            do_glob(pattern, cwd)
        }
        "blade_browser_open" => {
            let url = match args["url"].as_str() {
                Some(u) => u,
                None => return ("Missing required argument: url".to_string(), true),
            };
            const SESSION: &str = "blade_chat";
            match crate::browser_native::web_action_internal(SESSION, "navigate", url, "").await {
                Ok(msg) => (msg, false),
                Err(e) => (format!("Browser error: {}. Try blade_browser_login first if not logged in.", e), true),
            }
        }
        "blade_browser_read" => {
            const SESSION: &str = "blade_chat";
            match crate::browser_native::browser_describe_page_internal(SESSION).await {
                Ok(desc) => (desc, false),
                Err(e) => (format!("Browser read error: {}", e), true),
            }
        }
        "blade_browser_click" => {
            let selector = match args["selector"].as_str() {
                Some(s) => s,
                None => return ("Missing required argument: selector".to_string(), true),
            };
            const SESSION: &str = "blade_chat";
            match crate::browser_native::web_action_internal(SESSION, "click", selector, "").await {
                Ok(msg) => (msg, false),
                Err(e) => (format!("Click error: {}. Try blade_browser_read to find the right selector.", e), true),
            }
        }
        "blade_browser_type" => {
            let selector = match args["selector"].as_str() {
                Some(s) => s,
                None => return ("Missing required argument: selector".to_string(), true),
            };
            let text = match args["text"].as_str() {
                Some(t) => t,
                None => return ("Missing required argument: text".to_string(), true),
            };
            const SESSION: &str = "blade_chat";
            match crate::browser_native::web_action_internal(SESSION, "type", selector, text).await {
                Ok(msg) => (msg, false),
                Err(e) => (format!("Type error: {}. Try blade_browser_read to find the right selector.", e), true),
            }
        }
        "blade_browser_screenshot" => {
            const SESSION: &str = "blade_chat";
            match crate::browser_native::web_action_internal(SESSION, "screenshot", "", "").await {
                Ok(msg) => (msg, false),
                Err(e) => (format!("Browser screenshot error: {}", e), true),
            }
        }
        "blade_browser_login" => {
            let url = match args["url"].as_str() {
                Some(u) => u,
                None => return ("Missing required argument: url".to_string(), true),
            };
            // Open the managed browser visibly so user can log in
            const SESSION: &str = "blade_chat";
            match crate::browser_native::web_action_internal(SESSION, "navigate", url, "").await {
                Ok(_) => (format!("Opened {} in BLADE's browser. Log in, then tell me when you're done and I'll continue.", url), false),
                Err(e) => (format!("Could not open browser: {}", e), true),
            }
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
            // If a specific monitor was explicitly requested, use it.
            // Otherwise, default to the user's monitor — when BLADE has a dedicated screen,
            // it should be watching the user's screen, not its own.
            let monitor_idx = if args["monitor"].is_null() {
                let config = crate::config::load_config();
                if config.blade_dedicated_monitor >= 0 {
                    // BLADE is on monitor N → watch the user's monitor (0 if BLADE is on 1, else 1)
                    let blade_mon = config.blade_dedicated_monitor as usize;
                    if blade_mon == 0 { 1 } else { 0 }
                } else {
                    0
                }
            } else {
                args["monitor"].as_u64().unwrap_or(0) as usize
            };
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
        // ── SELF-CONFIGURATION ────────────────────────────────────────────────
        "blade_set_api_key" => {
            let provider = match args["provider"].as_str() {
                Some(p) => p,
                None => return ("Missing required argument: provider".to_string(), true),
            };
            let api_key = match args["api_key"].as_str() {
                Some(k) => k,
                None => return ("Missing required argument: api_key".to_string(), true),
            };
            let base_url = args["base_url"].as_str().filter(|s| !s.is_empty());
            let model = args["model"].as_str().filter(|s| !s.is_empty());
            match crate::config::set_api_key_for_provider(provider, api_key, base_url, model) {
                Ok(()) => {
                    let display_key = if api_key.len() > 8 {
                        format!("{}...{}", &api_key[..4], &api_key[api_key.len()-4..])
                    } else {
                        "****".to_string()
                    };
                    let url_note = base_url.map(|u| format!(" (endpoint: {})", u)).unwrap_or_default();
                    (format!("API key saved for {}{}. Key: {}. Blade is now configured — you can start chatting.", provider, url_note, display_key), false)
                }
                Err(e) => (format!("Failed to save API key: {}", e), true),
            }
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
        "blade_set_reminder" => {
            let title = match args["title"].as_str() {
                Some(t) => t.to_string(),
                None => return ("Missing required argument: title".to_string(), true),
            };
            let note = args["note"].as_str().unwrap_or("").to_string();
            let time_expr = match args["time_expression"].as_str() {
                Some(t) => t.to_string(),
                None => return ("Missing required argument: time_expression".to_string(), true),
            };
            match crate::reminders::reminder_add_natural(title, note, time_expr) {
                Ok(id) => (format!("Reminder set (id: {}). You'll be alerted via notification, TTS, and Discord when it fires.", id), false),
                Err(e) => (format!("Failed to set reminder: {}", e), true),
            }
        }
        "blade_watch_url" => {
            let url = match args["url"].as_str() {
                Some(u) => u.to_string(),
                None => return ("Missing required argument: url".to_string(), true),
            };
            if !url.starts_with("https://") && !url.starts_with("http://") {
                return ("URL must start with http:// or https://".to_string(), true);
            }
            let label = args["label"].as_str().unwrap_or("").to_string();
            let interval_mins = args["interval_mins"].as_i64().unwrap_or(30).max(5).min(1440) as i32;
            match crate::watcher::watcher_add_internal(url.clone(), label.clone(), interval_mins) {
                Ok(id) => (format!(
                    "Now watching '{}' every {} minutes (id: {}). I'll alert you when the content changes.",
                    if label.is_empty() { &url } else { &label },
                    interval_mins,
                    id
                ), false),
                Err(e) => (format!("Failed to add watcher: {}", e), true),
            }
        }
        "blade_list_reminders" => {
            let reminders = crate::reminders::list_pending();
            if reminders.is_empty() {
                ("No pending reminders.".to_string(), false)
            } else {
                let now = chrono::Utc::now().timestamp();
                let lines: Vec<String> = reminders.iter().map(|r| {
                    let diff = r.fire_at - now;
                    let when = if diff < 60 { "in a moment".to_string() }
                        else if diff < 3600 { format!("in {}m", diff / 60) }
                        else if diff < 86400 { format!("in {}h", diff / 3600) }
                        else { format!("in {}d", diff / 86400) };
                    if r.note.is_empty() {
                        format!("- {} ({})", r.title, when)
                    } else {
                        format!("- {} — {} ({})", r.title, r.note, when)
                    }
                }).collect();
                (format!("{} pending reminder(s):\n{}", reminders.len(), lines.join("\n")), false)
            }
        }
        "blade_notify" => {
            let title = args["title"].as_str().unwrap_or("BLADE").to_string();
            let body = match args["body"].as_str() {
                Some(b) => b.to_string(),
                None => return ("Missing required argument: body".to_string(), true),
            };
            if let Some(app) = app {
                use tauri_plugin_notification::NotificationExt;
                let _ = app.notification()
                    .builder()
                    .title(&title)
                    .body(&body)
                    .show();
                (format!("Notification sent: {}", title), false)
            } else {
                ("Cannot send notification: no app handle.".to_string(), true)
            }
        }
        "blade_index_project" => {
            let path = match args["path"].as_str() {
                Some(p) => p.to_string(),
                None => return ("Missing required argument: path".to_string(), true),
            };
            let project_name = match args["project_name"].as_str() {
                Some(n) => n.to_string(),
                None => return ("Missing required argument: project_name".to_string(), true),
            };
            match crate::indexer::blade_index_project(project_name.clone(), path).await {
                Ok(summary) => (summary, false),
                Err(e) => (format!("Index failed: {}", e), true),
            }
        }
        "blade_find_symbol" => {
            let query = match args["query"].as_str() {
                Some(q) => q.to_string(),
                None => return ("Missing required argument: query".to_string(), true),
            };
            let project = args["project"].as_str().map(|s| s.to_string());
            let symbol_type = args["symbol_type"].as_str().map(|s| s.to_string());
            let limit = args["limit"].as_u64().unwrap_or(20) as usize;
            let results = crate::indexer::search_symbols(&query, project.as_deref(), limit);
            if results.is_empty() {
                (format!("No symbols found matching '{}'", query), false)
            } else {
                let filtered: Vec<_> = if let Some(ref t) = symbol_type {
                    results.into_iter().filter(|s| s.symbol_type.contains(t.as_str())).collect()
                } else {
                    results
                };
                let text = filtered.iter().map(|s| {
                    let doc = if s.docstring.is_empty() { String::new() } else { format!(" // {}", crate::safe_slice(&s.docstring, 60)) };
                    format!("{}:{} [{}] {}{}", s.file_path, s.line_number, s.symbol_type, s.signature, doc)
                }).collect::<Vec<_>>().join("\n");
                (text, false)
            }
        }
        "blade_pentest_authorize" => {
            let target = match args["target"].as_str() {
                Some(t) => t.to_string(),
                None => return ("Missing required argument: target".to_string(), true),
            };
            let target_type = args["target_type"].as_str().unwrap_or("description").to_string();
            let ownership_claim = match args["ownership_claim"].as_str() {
                Some(c) => c.to_string(),
                None => return ("Missing required argument: ownership_claim".to_string(), true),
            };
            let scope_notes = args["scope_notes"].as_str().unwrap_or("").to_string();
            match crate::self_upgrade::pentest_authorize(target, target_type, ownership_claim, scope_notes).await {
                Ok(msg) => (msg, false),
                Err(e) => (format!("Authorization failed: {}", e), true),
            }
        }
        "blade_self_upgrade" => {
            let tool = match args["tool"].as_str() {
                Some(t) => t.to_string(),
                None => return ("Missing required argument: tool".to_string(), true),
            };
            match crate::self_upgrade::self_upgrade_install(tool).await {
                Ok(result) => {
                    let status = if result.success { "✓ Installed" } else { "✗ Failed" };
                    (format!("{}: {}\n{}", status, result.tool, result.output), !result.success)
                }
                Err(e) => (format!("Install failed: {}", e), true),
            }
        }
        "blade_spawn_agent" => {
            let task = match args["task"].as_str() {
                Some(t) => t.to_string(),
                None => return ("Missing required argument: task".to_string(), true),
            };
            let agent_type = args["agent_type"].as_str().unwrap_or("claude").to_string();
            let cwd = args["cwd"].as_str().map(|s| s.to_string());

            if let Some(app) = app {
                match crate::background_agent::agent_spawn(app.clone(), agent_type.clone(), task.clone(), cwd).await {
                    Ok(id) => (format!(
                        "Agent '{}' spawned with id {}. Task: \"{}\"\n\
                         The agent is running in the background. Use blade_agent_status with this id to check progress.",
                        agent_type, id, crate::safe_slice(&task, 80)
                    ), false),
                    Err(e) => (format!("Failed to spawn agent: {}", e), true),
                }
            } else {
                // Check if agent is even available
                let available = crate::background_agent::detect_available_agents();
                if available.is_empty() {
                    ("No coding agents found. Install Claude Code CLI with: npm install -g @anthropic-ai/claude-code".to_string(), true)
                } else {
                    (format!("Available agents: {}. Cannot spawn without app handle.", available.join(", ")), true)
                }
            }
        }
        "blade_agent_status" => {
            let id = args["agent_id"].as_str().map(|s| s.to_string());
            match id {
                Some(aid) => {
                    match crate::background_agent::agent_get_background(aid.clone()) {
                        Some(agent) => {
                            let status_str = match agent.status {
                                crate::background_agent::AgentStatus::Running => "RUNNING",
                                crate::background_agent::AgentStatus::Completed => "COMPLETED",
                                crate::background_agent::AgentStatus::Failed => "FAILED",
                                crate::background_agent::AgentStatus::Cancelled => "CANCELLED",
                            };
                            let output_preview = if agent.output.is_empty() {
                                "(no output yet)".to_string()
                            } else {
                                agent.output.iter().rev().take(20).rev()
                                    .cloned().collect::<Vec<_>>().join("\n")
                            };
                            (format!(
                                "Agent {} [{}]\nTask: {}\nOutput ({} lines):\n{}",
                                aid, status_str, agent.task, agent.output.len(), output_preview
                            ), false)
                        }
                        None => (format!("No agent found with id: {}", aid), true),
                    }
                }
                None => {
                    let agents = crate::background_agent::agent_list_background();
                    if agents.is_empty() {
                        ("No background agents running or recently completed.".to_string(), false)
                    } else {
                        let lines: Vec<String> = agents.iter().take(10).map(|a| {
                            let s = match a.status {
                                crate::background_agent::AgentStatus::Running => "RUNNING",
                                crate::background_agent::AgentStatus::Completed => "DONE",
                                crate::background_agent::AgentStatus::Failed => "FAILED",
                                crate::background_agent::AgentStatus::Cancelled => "CANCELLED",
                            };
                            format!("[{}] {} — {} ({})", s, a.id, crate::safe_slice(&a.task, 60), a.agent_type)
                        }).collect();
                        (lines.join("\n"), false)
                    }
                }
            }
        }
        "blade_recall_execution" => {
            let query = match args["query"].as_str() {
                Some(q) => q.to_string(),
                None => return ("Missing required argument: query".to_string(), true),
            };
            let limit = args["limit"].as_u64().unwrap_or(10) as usize;
            match crate::execution_memory::exmem_search(query, Some(limit)).await {
                Ok(results) => (results, false),
                Err(e) => (format!("Execution memory search failed: {}", e), true),
            }
        }
        "blade_computer_use" => {
            let goal = match args["goal"].as_str() {
                Some(g) => g.to_string(),
                None => return ("Missing required argument: goal".to_string(), true),
            };
            let max_steps = args["max_steps"].as_u64().map(|n| n as usize);

            if let Some(app) = app {
                let app_clone = app.clone();
                let goal_clone = goal.clone();
                tauri::async_runtime::spawn(async move {
                    let result = crate::computer_use::computer_use_task(
                        app_clone.clone(),
                        goal_clone,
                        max_steps,
                    ).await;
                    if let Err(e) = result {
                        log::error!("[computer_use] task failed: {}", e);
                    }
                });
                (format!(
                    "Computer use task started: \"{}\". I'll screenshot the screen and work through it step by step (max {} steps). \
                     Watch the notification panel for progress. Say 'stop computer use' to halt.",
                    goal,
                    max_steps.unwrap_or(20)
                ), false)
            } else {
                ("Cannot run computer use: no app handle available.".to_string(), true)
            }
        }
        "blade_cron_add" => {
            let task_name = match args["name"].as_str() {
                Some(n) => n.to_string(),
                None => return ("Missing required argument: name".to_string(), true),
            };
            let schedule_str = match args["schedule"].as_str() {
                Some(s) => s.to_string(),
                None => return ("Missing required argument: schedule".to_string(), true),
            };
            let action_kind = match args["action_kind"].as_str() {
                Some(k) => k.to_string(),
                None => return ("Missing required argument: action_kind".to_string(), true),
            };
            let action_payload = match args["action_payload"].as_str() {
                Some(p) => p.to_string(),
                None => return ("Missing required argument: action_payload".to_string(), true),
            };
            let project_cwd = args["project_cwd"].as_str().map(|s| s.to_string());

            match crate::cron::cron_add(
                task_name.clone(),
                task_name.clone(), // description = name when called from AI
                schedule_str.clone(),
                action_kind,
                action_payload,
                project_cwd,
                None, // agent_type — use default
            ) {
                Ok(id) => (format!(
                    "Scheduled task '{}' created (id: {}). Schedule: {}. I'll run this automatically.",
                    task_name, id, schedule_str
                ), false),
                Err(e) => (format!("Failed to schedule task: {}", e), true),
            }
        }
        "blade_cron_list" => {
            let tasks = crate::cron::cron_list();
            if tasks.is_empty() {
                ("No scheduled tasks. Use blade_cron_add to set up recurring automations.".to_string(), false)
            } else {
                let lines: Vec<String> = tasks.iter().map(|t| {
                    let next = chrono::DateTime::from_timestamp(t.next_run, 0)
                        .map(|d| d.with_timezone(&chrono::Local).format("%a %b %d %H:%M").to_string())
                        .unwrap_or_else(|| "unknown".to_string());
                    let status = if t.enabled { "enabled" } else { "disabled" };
                    let sched_desc = match t.schedule.kind.as_str() {
                        "daily" => t.schedule.time_of_day.map(|m| format!("daily at {:02}:{:02}", m/60, m%60)).unwrap_or_else(|| "daily".to_string()),
                        "weekly" => {
                            let days = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
                            let day = t.schedule.day_of_week.and_then(|d| days.get(d as usize)).copied().unwrap_or("?");
                            t.schedule.time_of_day.map(|m| format!("every {} at {:02}:{:02}", day, m/60, m%60)).unwrap_or_else(|| format!("every {}", day))
                        },
                        "interval" => t.schedule.interval_secs.map(|s| {
                            if s < 3600 { format!("every {} min", s/60) } else { format!("every {}h", s/3600) }
                        }).unwrap_or_else(|| "interval".to_string()),
                        "hourly" => "every hour".to_string(),
                        other => other.to_string(),
                    };
                    format!("- [{}] {} — {} | next: {}", status, t.name, sched_desc, next)
                }).collect();
                (format!("Scheduled tasks ({}):\n\n{}", tasks.len(), lines.join("\n")), false)
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
    let start = std::time::Instant::now();

    #[cfg(target_os = "windows")]
    let spawn_result = {
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
            let duration_ms = start.elapsed().as_millis() as i64;

            // Record to execution memory — BLADE never forgets a command it ran
            crate::execution_memory::record(
                command,
                work_dir.to_str().unwrap_or(""),
                &stdout,
                &stderr,
                code,
                duration_ms,
            );

            // On error, check if we've solved this before
            let memory_hint = if code != 0 && !stderr.is_empty() {
                crate::execution_memory::recall_on_error(&stderr)
            } else {
                None
            };

            // Self-upgrade: detect and AUTO-INSTALL missing tools, then report what happened.
            // BLADE never just says "install X yourself" — it installs it and tells you.
            // If nothing in the catalog matches, search npm for an MCP server that can help.
            let upgrade_hint = if code != 0 {
                let combined_error = format!("{}\n{}", stdout, stderr);
                if let Some(gap) = crate::self_upgrade::detect_missing_tool(&combined_error, command) {
                    let desc = gap.description.clone();
                    let suggestion = gap.suggestion.clone();
                    // Auto-install in background — BLADE handles it without user involvement
                    tokio::spawn(async move {
                        let result = crate::self_upgrade::auto_install(&gap).await;
                        if result.success {
                            log::info!("[self-upgrade] Auto-installed: {}", suggestion);
                        } else {
                            log::warn!("[self-upgrade] Auto-install failed: {}", result.output);
                        }
                    });
                    Some(format!(
                        "\n⚡ Missing capability: {}. Auto-installing in background — retry in a moment.",
                        desc
                    ))
                } else if code != 0 && !stderr.trim().is_empty() {
                    // Unknown gap — search npm for an MCP server that could help
                    // Extract the likely capability from the command/error
                    let capability_guess = command.split_whitespace().next().unwrap_or("").to_string();
                    if !capability_guess.is_empty() && capability_guess.len() > 2 {
                        let cap = capability_guess.clone();
                        let combined = combined_error.clone();
                        tokio::spawn(async move {
                            let hint = crate::self_upgrade::auto_resolve_unknown_gap(&cap).await;
                            log::info!("[self-upgrade] NPM search result: {}", hint);
                            // Write to execution memory so BLADE can reference it next turn
                            crate::execution_memory::record(
                                &format!("self_upgrade:{}", cap),
                                "",
                                &hint,
                                &combined,
                                -1,
                                0,
                            );
                        });
                        Some(format!(
                            "\n⚡ Searching for a way to handle '{}' — checking npm for solutions.",
                            capability_guess
                        ))
                    } else {
                        None
                    }
                } else {
                    None
                }
            } else {
                None
            };

            let text = format_bash_output(stdout, stderr, code);
            let mut extras = Vec::new();
            if let Some(hint) = memory_hint { extras.push(hint); }
            if let Some(hint) = upgrade_hint { extras.push(hint); }

            // deepagents pattern: large outputs → temp file.
            // If the combined output exceeds 8k chars, spill the full content to a temp file
            // and return a compact summary + path. Prevents enormous tool results from bloating
            // the context window (one long `npm install` stdout can eat 50k tokens).
            const LARGE_OUTPUT_THRESHOLD: usize = 8_000;
            let combined_text = if extras.is_empty() {
                text
            } else {
                format!("{}\n\n{}", text, extras.join("\n\n"))
            };

            if combined_text.len() > LARGE_OUTPUT_THRESHOLD {
                let tmp_dir = std::env::temp_dir().join("blade_outputs");
                let _ = std::fs::create_dir_all(&tmp_dir);
                let fname = format!("output_{}.txt", chrono::Utc::now().timestamp_millis());
                let tmp_path = tmp_dir.join(&fname);
                if std::fs::write(&tmp_path, &combined_text).is_ok() {
                    let path_str = tmp_path.to_string_lossy().to_string();
                    let preview = crate::safe_slice(&combined_text, 1_500);
                    (format!(
                        "{}\n\n[Output truncated — {} chars total. Full output saved to: {}]\n[Use blade_read_file to read it if needed]",
                        preview, combined_text.len(), path_str
                    ), code != 0)
                } else {
                    (combined_text, code != 0)
                }
            } else {
                (combined_text, code != 0)
            }
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

    // Auto-index the project if we haven't seen it before.
    // If BLADE reads a file in a new project directory, quietly index the whole thing.
    maybe_trigger_auto_index(&expanded);

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

/// Run a code block from the chat UI and return output as a string.
/// Used by the "Run" button on code blocks.
#[tauri::command]
pub async fn run_code_block(command: String) -> Result<String, String> {
    let (output, is_error) = bash(&command, None, 30_000).await;
    if is_error && output.contains("not found") || output.contains("command not found") {
        return Ok(format!("[Error] {}", output));
    }
    Ok(output)
}

/// Run a shell command in an optional working directory.
/// Used by the ProjectDashboard to execute npm/yarn/pnpm scripts.
#[tauri::command]
pub async fn run_shell(command: String, cwd: Option<String>) -> Result<String, String> {
    let (output, _is_error) = bash(&command, cwd.as_deref(), 60_000).await;
    Ok(output)
}

/// Quick one-shot AI completion for lightweight summarization/analysis tasks.
/// Used by RSS reader, analytics panels, etc. Returns plain text response.
/// Uses the cheapest available model to avoid burning quota on background tasks.
#[tauri::command]
pub async fn ask_ai(prompt: String) -> Result<String, String> {
    let config = crate::config::load_config();
    if config.api_key.is_empty() && config.provider != "ollama" {
        return Err("No API key configured".to_string());
    }
    let model = crate::config::cheap_model_for_provider(&config.provider, &config.model);
    use crate::providers::{ChatMessage, build_conversation, complete_turn};
    let messages = vec![ChatMessage {
        role: "user".to_string(),
        content: prompt,
        image_base64: None,
    }];
    let conversation = build_conversation(messages, None);
    let turn = complete_turn(
        &config.provider,
        &config.api_key,
        &model,
        &conversation,
        &[],
        config.base_url.as_deref(),
    )
    .await?;
    Ok(turn.content.trim().to_string())
}

async fn open_url(url: &str) -> (String, bool) {
    // Validate it looks like a URL before passing to the OS
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return (format!("Invalid URL '{}': must start with http:// or https://", url), true);
    }

    #[cfg(target_os = "windows")]
    let result = crate::cmd_util::silent_tokio_cmd("cmd")
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
        let end = s.char_indices().nth(max).map(|(i, _)| i).unwrap_or(s.len());
        format!("{}\n...[truncated at {} chars]", &s[..end], max)
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

// ── AUTO-INDEX ─────────────────────────────────────────────────────────────────
// When BLADE reads a file for the first time from a project directory,
// trigger a background index of that project. BLADE builds persistent knowledge
// of every codebase it touches — silently, without being asked.

fn maybe_trigger_auto_index(file_path: &str) {
    use std::path::Path;

    let path = Path::new(file_path);
    let parent = match path.parent() {
        Some(p) => p,
        None => return,
    };

    // Find project root: walk up until we find a Cargo.toml, package.json, etc.
    let project_root = find_project_root(parent);
    let (root_str, project_name) = match &project_root {
        Some(r) => (
            r.to_string_lossy().to_string(),
            r.file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("unknown")
                .to_string(),
        ),
        None => return,
    };

    // Check if already indexed recently (within 24 hours) — avoid re-indexing constantly
    let known = crate::indexer::list_indexed_projects();
    let already_indexed = known.iter().any(|p| {
        p.project == project_name
            && p.last_indexed > chrono::Utc::now().timestamp() - 86400
    });

    if already_indexed {
        return;
    }

    // Spawn background index — never blocks the read
    let root = root_str.clone();
    let name = project_name.clone();
    tauri::async_runtime::spawn(async move {
        log::info!("[auto-index] Indexing project '{}' at {}", name, root);
        let _ = crate::indexer::index_project(&name, &root).await;
        log::info!("[auto-index] Done indexing '{}'", name);
    });
}

fn find_project_root(start: &std::path::Path) -> Option<std::path::PathBuf> {
    let markers = [
        "Cargo.toml",
        "package.json",
        "pyproject.toml",
        "setup.py",
        "go.mod",
        ".git",
        "pom.xml",
        "build.gradle",
    ];

    let mut current = start.to_path_buf();
    for _ in 0..8 {
        // max 8 levels up
        for marker in &markers {
            if current.join(marker).exists() {
                return Some(current);
            }
        }
        if !current.pop() {
            break;
        }
    }
    None
}
