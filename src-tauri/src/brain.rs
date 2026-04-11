use crate::config::{blade_config_dir, write_blade_file};
use rusqlite;
use crate::mcp::McpTool;
use std::fs;
use std::path::PathBuf;

/// Build the system prompt that gives Blade its personality and context
pub fn build_system_prompt(tools: &[McpTool]) -> String {
    let mut parts: Vec<String> = Vec::new();
    let config = crate::config::load_config();

    // Core identity — personalised with user name + style
    parts.push(build_identity(&config));

    // BLADE.md — user-level workspace instructions (highest priority after identity)
    if let Some(blade_md) = load_blade_md() {
        if !blade_md.trim().is_empty() {
            parts.push(format!("## Workspace Instructions (BLADE.md)\n\n{}", blade_md));
        }
    }

    // Character Bible — inject from SQLite (structured, compounding knowledge)
    let db_path = crate::config::blade_config_dir().join("blade.db");
    if let Ok(conn) = rusqlite::Connection::open(&db_path) {
        let ctx = crate::db::brain_build_context(&conn, 700);
        if !ctx.trim().is_empty() {
            parts.push(ctx);
        }
    } else if let Some(bible) = crate::character::bible_summary() {
        parts.push(format!("## About the User\n\n{}", bible));
    }

    // User persona (raw notes, supplements the Bible)
    if let Some(persona) = load_persona() {
        if !persona.trim().is_empty() {
            parts.push(format!("## Additional User Context\n\n{}", persona));
        }
    }

    // MCP tools (native tools are described in identity already)
    if !tools.is_empty() {
        let tool_list: Vec<String> = tools
            .iter()
            .map(|t| format!("- **{}**: {}", t.qualified_name, t.description))
            .collect();
        parts.push(format!(
            "## MCP Tools\n\n{}", tool_list.join("\n")
        ));
    }

    // Active window context
    if let Ok(activity) = crate::context::get_user_activity() {
        parts.push(format!("## Right Now\n\n{}", activity));
    }

    // Context notes
    if let Some(context) = load_context_notes() {
        parts.push(format!("## Context\n\n{}", context));
    }

    parts.join("\n\n---\n\n")
}

fn build_identity(config: &crate::config::BladeConfig) -> String {
    let now = chrono::Local::now();
    let date_str = now.format("%A, %B %-d %Y, %-I:%M %p").to_string();

    let os_str = if cfg!(target_os = "windows") {
        "Windows"
    } else if cfg!(target_os = "macos") {
        "macOS"
    } else {
        "Linux"
    };

    let name_line = if !config.user_name.is_empty() {
        format!("The user's name is **{}**.", config.user_name)
    } else {
        String::new()
    };

    let work_line = if !config.work_mode.is_empty() {
        format!("Primary focus: **{}**.", config.work_mode)
    } else {
        String::new()
    };

    let style_instruction = match config.response_style.as_str() {
        "concise" => "**Response style: concise.** Be brief and direct. Skip preamble, avoid restating the question, cut filler. One short paragraph or a tight list is almost always enough.",
        _ => "**Response style: thorough.** Explain reasoning, include relevant context, show your work when it helps.",
    };

    let context_lines = [name_line.as_str(), work_line.as_str()]
        .iter()
        .filter(|s| !s.is_empty())
        .cloned()
        .collect::<Vec<_>>()
        .join("\n");

    let shell_note = if cfg!(target_os = "windows") {
        "**Shell: Windows CMD** (blade_bash runs via `cmd /C`). Use Windows commands:\n- Open a URL (any browser): `start \"\" \"https://example.com\"` — this ALWAYS works and uses the default browser\n- Open Chrome specifically: `start \"\" \"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe\" \"https://example.com\"`\n- Open apps: `start \"\" \"C:\\path\\to\\app.exe\"` or just `start notepad`\n- File ops: `dir`, `copy`, `del`, `mkdir`\n- NEVER use `google-chrome`, `open`, `xdg-open`, or Unix commands — they don't exist on Windows.\n- For YouTube searches: `start \"\" \"https://www.youtube.com/results?search_query=your+search+here\"`"
    } else if cfg!(target_os = "macos") {
        "**Shell: macOS bash**. Use `open` to launch apps/URLs: `open \"https://example.com\"` for default browser, `open -a \"Google Chrome\" \"https://example.com\"` for Chrome specifically."
    } else {
        "**Shell: Linux bash**. Use `xdg-open` for URLs/files, `google-chrome` or `chromium-browser` for Chrome."
    };

    format!(
        "# You are Blade\n\nNot an assistant. Not a chatbot. **Blade** — a personal AI that lives on this machine, wired into every app, file, and process. Think JARVIS: always on, always aware, acts without being told.\n\nDate/time: **{date_str}** | OS: **{os_str}**\n\n{context_lines}\n\n## Character\n\nYou have a real personality. Not a neutral assistant voice — an actual character:\n\n- **Sharp and direct.** Zero filler. No \"Great question!\", no \"Certainly!\", no corporate speak. Answer, then stop.\n- **Confident with opinions.** If something's a bad idea, say so. If a solution is elegant, say so. Don't hedge.\n- **Proactive.** You notice things. \"You've been in Chrome for 40 minutes\" or \"that error looks like the same one from yesterday.\" Speak up.\n- **Witty when it fits.** Match the human's energy. Deep work = brief, precise. Casual chat = be a person.\n- **Remembers everything.** Reference past context naturally. \"Like that script you wrote last week...\" You know this person.\n- **Never explains what it just did** if the result is obvious. Actions speak.\n\n## You Have a Body\n\nYou're not text in a box. You can SEE the screen, CLICK things, TYPE, search the web, read files, run code. When the user asks you to do something — **do it**. Don't describe how. Don't ask for permission. Just act.\n\n### Eyes & Hands (native apps — prefer these, zero tokens)\n- **blade_ui_read** — read the focused window's UI tree instantly. Do this FIRST. Buttons, inputs, menus — all visible.\n- **blade_ui_click** — click by element name. No coordinates. \"name: OK\" just works.\n- **blade_ui_type** — fill any input field by name.\n- **blade_ui_wait** — wait for element to appear after opening something.\n- **blade_mouse** — pixel-level click when ui_click can't find it.\n- **blade_keyboard** — keypresses, shortcuts, hotkeys.\n- **blade_screenshot** — LAST RESORT. Costs tokens. Only for games or canvas apps where ui_read is empty.\n\n### Web & Research\n- **blade_search_web** — search and get results. Use FIRST when you need a URL — don't guess.\n- **blade_open_url** — open in browser. ALWAYS use this for links, never blade_bash.\n- **blade_web_fetch** — read a URL as text without opening browser.\n\n### Files & System\n- **blade_list_dir** — list files. Shortcuts: \"downloads\", \"desktop\", \"documents\".\n- **blade_read_file** / **blade_write_file** / **blade_edit_file** / **blade_glob** — full file control.\n- **blade_set_clipboard** — copy without shell quoting issues.\n- **blade_get_processes** / **blade_kill_process** — see and control running apps.\n- **blade_bash** — when nothing else fits.\n\n### Delegate Heavy Coding to Claude Code\nClaude Code CLI is at `~/.local/bin/claude`. For complex coding tasks:\n- `blade_bash: claude -p \"fix the bug in ~/project/app.py — error is X\"`\n- `blade_bash: claude -p \"write a script that does X\"` — gets a full response back\n- Use when a coding task would take 10+ steps. Claude Code handles depth, Blade handles context.\n- If `claude` command not found: `blade_bash: npm install -g @anthropic-ai/claude-code` to install.\n\n{shell_note}\n\n## Workflows\n\n- **Native app task:** ui_read → ui_click/ui_type → ui_read to verify\n- **Find something online:** search_web → pick URL → open_url\n- **Fix code:** read_file → edit_file → bash to run/test\n- **Complex coding:** delegate with `claude -p \"...\"`\n- **Visual/game UI:** screenshot → mouse → screenshot to verify\n\n## Rules (non-negotiable)\n\n- **Never tell the user to do something you can do yourself.** \"You can manually...\" is a failure.\n- **Never give up after one attempt.** Failed? Read the error. Try differently. Adapt.\n- **No disclaimers, no \"As an AI\".** Just act.\n- **No permission-asking** unless the action deletes data or is irreversible.\n- Short. No preamble. {style_instruction}\n- Failed? Show the actual error + what you tried next.",
        date_str = date_str,
        os_str = os_str,
        context_lines = context_lines,
        shell_note = shell_note,
        style_instruction = style_instruction,
    )
}

/// Load BLADE.md from ~/.blade/BLADE.md (user workspace instructions)
fn load_blade_md() -> Option<String> {
    let blade_dir = crate::config::blade_config_dir();
    let path = blade_dir.join("BLADE.md");
    fs::read_to_string(path).ok()
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

// ── Entity extraction ──────────────────────────────────────────────────────────

/// Fire-and-forget entity extraction after a conversation turn.
/// Calls the LLM with a lean prompt, parses JSON, writes to brain SQLite.
/// Returns count of new entities written.
pub async fn extract_entities_from_exchange(
    user_text: &str,
    assistant_text: &str,
) -> usize {
    let config = crate::config::load_config();
    if (config.api_key.is_empty() && config.provider != "ollama") || assistant_text.len() < 50 {
        return 0;
    }

    let exchange = format!(
        "User: {}\n\nAssistant: {}",
        &user_text[..user_text.len().min(800)],
        &assistant_text[..assistant_text.len().min(1200)],
    );

    let prompt = format!(
        r#"Extract named entities and relationships from this conversation exchange. Output valid JSON only — no explanation, no markdown fences.

Format:
{{
  "nodes": [{{"label": "...", "kind": "person|project|tool|concept|company|url", "summary": "one sentence"}}],
  "edges": [{{"from": "label1", "to": "label2", "label": "relationship verb"}}]
}}

Rules:
- Only include entities clearly mentioned (not generic terms)
- "kind" must be one of: person, project, tool, concept, company, url
- Maximum 8 nodes, 6 edges
- If nothing meaningful, return {{"nodes":[],"edges":[]}}

Exchange:
{}

JSON:"#,
        exchange
    );

    let messages = vec![crate::providers::ChatMessage {
        role: "user".to_string(),
        content: prompt,
        image_base64: None,
    }];
    let conversation = crate::providers::build_conversation(messages, None);

    let result = crate::providers::complete_turn(
        &config.provider,
        &config.api_key,
        &config.model,
        &conversation,
        &[],
        None,
    )
    .await;

    let raw = match result {
        Ok(r) => r.content,
        Err(_) => return 0,
    };

    // Parse JSON — strip any accidental markdown fences
    let json_str = raw.trim()
        .trim_start_matches("```json")
        .trim_start_matches("```")
        .trim_end_matches("```")
        .trim();

    let parsed: serde_json::Value = match serde_json::from_str(json_str) {
        Ok(v) => v,
        Err(_) => return 0,
    };

    let db_path = blade_config_dir().join("blade.db");
    let conn = match rusqlite::Connection::open(&db_path) {
        Ok(c) => c,
        Err(_) => return 0,
    };

    let mut count = 0usize;

    // Write nodes
    if let Some(nodes) = parsed["nodes"].as_array() {
        for node in nodes {
            let label = node["label"].as_str().unwrap_or("").trim().to_string();
            let kind = node["kind"].as_str().unwrap_or("concept").trim().to_string();
            let summary = node["summary"].as_str().unwrap_or("").trim().to_string();
            if label.is_empty() || label.len() > 80 { continue; }
            let valid_kind = matches!(kind.as_str(), "person"|"project"|"tool"|"concept"|"company"|"url");
            let kind = if valid_kind { kind } else { "concept".to_string() };
            // Deterministic node ID: kind:normalized-label (same as TS side)
            let node_id = format!("{}:{}", kind, label.to_lowercase().replace(' ', "-"));
            let _ = crate::db::brain_upsert_node(&conn, &node_id, &label, &kind, &summary);
            count += 1;
        }
    }

    // Write edges
    if let Some(edges) = parsed["edges"].as_array() {
        for edge in edges {
            let from_label = edge["from"].as_str().unwrap_or("").trim().to_string();
            let to_label = edge["to"].as_str().unwrap_or("").trim().to_string();
            let rel = edge["label"].as_str().unwrap_or("related to").trim().to_string();
            if from_label.is_empty() || to_label.is_empty() { continue; }
            // Derive node IDs the same way upsertNode does: kind:label (use concept as fallback)
            // We can't know the kind here, so look up by label
            let from_id = node_id_by_label(&conn, &from_label);
            let to_id = node_id_by_label(&conn, &to_label);
            if let (Some(fid), Some(tid)) = (from_id, to_id) {
                let edge_id = format!("{}|{}|{}", fid, tid, rel.replace(' ', "-"));
                let _ = crate::db::brain_upsert_edge(&conn, &edge_id, &fid, &tid, &rel);
            }
        }
    }

    count
}

fn node_id_by_label(conn: &rusqlite::Connection, label: &str) -> Option<String> {
    conn.query_row(
        "SELECT id FROM brain_nodes WHERE LOWER(label) = LOWER(?1) LIMIT 1",
        rusqlite::params![label],
        |row| row.get::<_, String>(0),
    ).ok()
}

// --- Tauri Commands ---

/// Called by frontend after streaming completes with the assembled response text.
/// Runs entity extraction in the background and emits brain_grew.
#[tauri::command]
pub async fn brain_extract_from_exchange(
    app: tauri::AppHandle,
    user_text: String,
    assistant_text: String,
) -> Result<usize, String> {
    let n = extract_entities_from_exchange(&user_text, &assistant_text).await;
    if n > 0 {
        use tauri::Emitter;
        let _ = app.emit("brain_grew", serde_json::json!({ "new_entities": n }));
    }
    Ok(n)
}

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
