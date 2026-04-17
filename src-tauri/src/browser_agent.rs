#![allow(dead_code, unused_assignments)]

// src-tauri/src/browser_agent.rs
//
// Browser automation agent for BLADE — Phase 1 of the JARVIS plan.
//
// All browser actions are now backed by the CDP layer in browser_native.rs.
// The old HTTP-only stubs for Click/Type/Screenshot/WaitFor have been replaced
// with real implementations.
//
// The agent loop drives a vision LLM (screenshot + goal + history → next action)
// and emits "browser_agent_step" events to the frontend after each step.

use serde::{Deserialize, Serialize};
use tauri::Emitter;

// ── Action enum ───────────────────────────────────────────────────────────────

/// The set of browser actions BLADE can perform.
/// Modelled after browser-use's ActionModel pattern.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum BrowserAction {
    /// Navigate to a URL
    Navigate { url: String },
    /// Click a CSS selector
    Click { selector: String },
    /// Type text into a CSS selector
    Type { selector: String, text: String },
    /// Take a screenshot of the current page
    Screenshot,
    /// Navigate to URL and return readable page text
    ReadPage { url: String },
    /// Wait for a CSS selector to appear (polls every 500 ms, up to 10 s)
    WaitFor { selector: String },
    /// Signal the agent loop that the goal has been achieved
    Done { summary: String },
}

// ── Session helpers ───────────────────────────────────────────────────────────

const AGENT_SESSION: &str = "browser_agent_default";

// ── Action executor ───────────────────────────────────────────────────────────

/// Execute a `BrowserAction` via the CDP layer.
/// Returns `(result_text, is_error)`.
pub async fn execute_browser_action(action: &BrowserAction) -> (String, bool) {
    match action {
        BrowserAction::Navigate { url } => {
            match crate::browser_native::navigate_session(AGENT_SESSION, url).await {
                Ok(msg) => (msg, false),
                Err(e) => (e, true),
            }
        }

        BrowserAction::ReadPage { url } => {
            // Navigate first, then extract text
            match crate::browser_native::navigate_session(AGENT_SESSION, url).await {
                Err(e) => return (e, true),
                Ok(_) => {}
            }
            match crate::browser_native::read_page_content(AGENT_SESSION).await {
                Ok(text) => (format!("URL: {}\n\n{}", url, text), false),
                Err(e) => (e, true),
            }
        }

        BrowserAction::Click { selector } => {
            match crate::browser_native::click_selector(AGENT_SESSION, selector).await {
                Ok(msg) => (msg, false),
                Err(e) => (e, true),
            }
        }

        BrowserAction::Type { selector, text } => {
            match crate::browser_native::type_into_selector(AGENT_SESSION, selector, text).await {
                Ok(msg) => (msg, false),
                Err(e) => (e, true),
            }
        }

        BrowserAction::Screenshot => {
            match crate::browser_native::capture_screenshot_b64(AGENT_SESSION).await {
                Ok(b64) => (
                    format!("Screenshot captured ({} base64 chars)", b64.len()),
                    false,
                ),
                Err(e) => (e, true),
            }
        }

        BrowserAction::WaitFor { selector } => {
            match crate::browser_native::wait_for_selector_agent(AGENT_SESSION, selector, 10_000).await {
                Ok(msg) => (msg, false),
                Err(e) => (e, true),
            }
        }

        BrowserAction::Done { summary } => (format!("Goal achieved: {}", summary), false),
    }
}

// ── Tauri command: execute a single browser action ────────────────────────────

/// Tauri command: execute a browser action.
///
/// `action_json` must be a JSON object with an `"action"` discriminant field, e.g.:
/// ```json
/// { "action": "navigate", "url": "https://example.com" }
/// { "action": "read_page", "url": "https://docs.rs/serde" }
/// { "action": "click", "selector": "#submit-button" }
/// { "action": "type", "selector": "#search", "text": "hello" }
/// ```
#[tauri::command]
pub async fn browser_action(action_json: serde_json::Value) -> Result<String, String> {
    let action: BrowserAction = serde_json::from_value(action_json)
        .map_err(|e| format!("Invalid browser action: {}", e))?;

    let (result, is_error) = execute_browser_action(&action).await;
    if is_error {
        Err(result)
    } else {
        Ok(result)
    }
}

// ── Agent loop ────────────────────────────────────────────────────────────────

/// A single step's record kept in the action history fed back to the LLM.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct AgentStep {
    step: u32,
    action: String,
    result: String,
}

/// LLM response format for the agent loop.
/// The LLM must reply with a JSON object matching one of the BrowserAction variants.
///
/// System prompt instructs the LLM to reply *only* with a JSON action object.
/// Supported actions:
///   { "action": "navigate",   "url": "..." }
///   { "action": "click",      "selector": "..." }
///   { "action": "type",       "selector": "...", "text": "..." }
///   { "action": "screenshot" }
///   { "action": "read_page",  "url": "..." }
///   { "action": "wait_for",   "selector": "..." }
///   { "action": "done",       "summary": "..." }
const AGENT_SYSTEM_PROMPT: &str = r#"You are a browser automation agent. You control a real web browser via CDP.

Given:
  - A screenshot of the current browser page (base64 PNG, may be absent on step 1)
  - A goal from the user
  - The history of actions you have already taken

Respond with ONLY a JSON object representing the NEXT single action to take.

Available actions:
  {"action":"navigate","url":"<full URL>"}
  {"action":"click","selector":"<CSS selector>"}
  {"action":"type","selector":"<CSS selector>","text":"<text to type>"}
  {"action":"screenshot"}
  {"action":"read_page","url":"<full URL>"}
  {"action":"wait_for","selector":"<CSS selector>"}
  {"action":"done","summary":"<what was achieved>"}

Rules:
- Reply with ONE action object and nothing else — no markdown, no explanation.
- Use "done" when the goal is fully achieved.
- Prefer CSS selectors that are stable (id, data-testid, aria-label).
- If you need to see the page state, use "screenshot" first.
"#;

/// Drive a browser agent loop: take screenshot → ask LLM → execute action → repeat.
///
/// Emits `browser_agent_step` events to the frontend after each step with:
///   `{ step, action_json, result, screenshot_b64 }`
///
/// Returns a final summary string or an error.
#[tauri::command]
pub async fn browser_agent_loop(
    app: tauri::AppHandle,
    goal: String,
    max_steps: u32,
) -> Result<String, String> {
    use crate::providers::{complete_turn, ConversationMessage};

    let config = crate::config::load_config();
    if config.api_key.is_empty() {
        return Err("No API key configured. Please add a provider key in BLADE settings.".to_string());
    }

    // Prefer a vision-capable model.  The user's configured model is used as-is;
    // most modern models (GPT-4o, Claude 3.x, Gemini 1.5) support vision.
    let model = &config.model;
    let provider = &config.provider;
    let api_key = &config.api_key;

    let mut history: Vec<AgentStep> = Vec::new();
    let mut final_result = String::new();

    for step in 0..max_steps {
        // 1. Take a screenshot of the current page
        let screenshot_b64 = crate::browser_native::capture_screenshot_b64(AGENT_SESSION)
            .await
            .unwrap_or_default(); // graceful: blank if browser not open yet

        // 2. Build the LLM conversation
        //    System: agent instructions
        //    User:   goal + history + screenshot
        let history_text = if history.is_empty() {
            "No actions taken yet.".to_string()
        } else {
            history
                .iter()
                .map(|s| format!("Step {}: {} → {}", s.step, s.action, s.result))
                .collect::<Vec<_>>()
                .join("\n")
        };

        let user_text = format!(
            "Goal: {}\n\nAction history:\n{}\n\nDecide the next action.",
            goal, history_text
        );

        let messages: Vec<ConversationMessage> = vec![
            ConversationMessage::System(AGENT_SYSTEM_PROMPT.to_string()),
            if screenshot_b64.is_empty() {
                ConversationMessage::User(user_text)
            } else {
                ConversationMessage::UserWithImage {
                    text: user_text,
                    image_base64: screenshot_b64.clone(),
                }
            },
        ];

        // 3. Ask the LLM for the next action
        let turn = complete_turn(provider, api_key, model, &messages, &crate::providers::no_tools(), None).await
            .map_err(|e| format!("LLM error at step {}: {}", step + 1, e))?;

        let raw = turn.content.trim().to_string();

        // Use the structured-output repair helper: strips markdown fences,
        // fixes trailing commas, extracts JSON from prose, etc.
        let json_val = crate::providers::extract_and_repair_json(&raw)
            .map_err(|e| format!(
                "LLM returned unparseable action at step {}: {} — raw: {}",
                step + 1, e, crate::safe_slice(&raw, 300)
            ))?;

        // 4. Parse the action
        let action: BrowserAction = serde_json::from_value(json_val).map_err(|e| {
            format!(
                "LLM returned invalid action JSON at step {}: {} — raw: {}",
                step + 1,
                e,
                crate::safe_slice(&raw, 300)
            )
        })?;

        let action_label = action_label(&action);

        // 5. Check for done
        if let BrowserAction::Done { ref summary } = action {
            final_result = summary.clone();
            let _ = app.emit(
                "browser_agent_step",
                serde_json::json!({
                    "step": step + 1,
                    "action": action_label,
                    "result": final_result,
                    "screenshot_b64": screenshot_b64,
                    "done": true,
                }),
            );
            return Ok(final_result);
        }

        // 6. Execute the action
        let (result_text, is_error) = execute_browser_action(&action).await;

        // 7. Emit progress event to frontend
        let _ = app.emit(
            "browser_agent_step",
            serde_json::json!({
                "step": step + 1,
                "action": action_label,
                "result": result_text,
                "screenshot_b64": screenshot_b64,
                "done": false,
                "is_error": is_error,
            }),
        );

        history.push(AgentStep {
            step: step + 1,
            action: action_label,
            result: if is_error {
                format!("ERROR: {}", result_text)
            } else {
                result_text
            },
        });

        // Small pause between steps to avoid hammering the browser
        tokio::time::sleep(std::time::Duration::from_millis(300)).await;
    }

    // Reached max_steps without a Done action
    let summary = format!(
        "Reached max_steps ({}) without completing goal. Last {} actions:\n{}",
        max_steps,
        history.len().min(5),
        history
            .iter()
            .rev()
            .take(5)
            .map(|s| format!("  Step {}: {} → {}", s.step, s.action, s.result))
            .collect::<Vec<_>>()
            .join("\n")
    );
    Ok(summary)
}

fn action_label(action: &BrowserAction) -> String {
    match action {
        BrowserAction::Navigate { url } => format!("navigate({})", url),
        BrowserAction::Click { selector } => format!("click({})", selector),
        BrowserAction::Type { selector, text } => format!("type({}, {:?})", selector, text),
        BrowserAction::Screenshot => "screenshot".to_string(),
        BrowserAction::ReadPage { url } => format!("read_page({})", url),
        BrowserAction::WaitFor { selector } => format!("wait_for({})", selector),
        BrowserAction::Done { summary } => format!("done({})", summary),
    }
}

// ── HTML helpers (kept for ReadPage fallback / tests) ─────────────────────────

/// Strip HTML tags and collapse whitespace to get readable plain text.
/// Also decodes common HTML entities.
fn strip_html(html: &str) -> String {
    let mut out = String::with_capacity(html.len() / 2);
    let mut in_tag = false;
    let mut in_script = false;
    let mut in_style = false;
    let mut i = 0usize;

    while i < html.len() {
        let ch = match html[i..].chars().next() {
            Some(c) => c,
            None => break,
        };
        let ch_len = ch.len_utf8();

        if (in_script || in_style) && !in_tag {
            if ch == '<' {
                let rest = &html[i..];
                let tag_lower: String = rest.chars().skip(1).take(9).collect::<String>().to_lowercase();
                if in_script && tag_lower.starts_with("/script") {
                    in_script = false;
                    in_tag = true;
                } else if in_style && tag_lower.starts_with("/style") {
                    in_style = false;
                    in_tag = true;
                }
            }
            i += ch_len;
            continue;
        }

        if !in_tag && ch == '<' {
            let rest = &html[i..];
            let tag_lower: String = rest.chars().skip(1).take(10).collect::<String>().to_lowercase();
            if tag_lower.starts_with("script") { in_script = true; }
            else if tag_lower.starts_with("style") { in_style = true; }
            in_tag = true;
            i += ch_len;
            continue;
        }

        if in_tag {
            if ch == '>' {
                in_tag = false;
                out.push(' ');
            }
            i += ch_len;
            continue;
        }

        if ch == '&' {
            let rest = &html[i..];
            let mut byte_pos = 1usize;
            let mut char_count = 0usize;
            let mut semi_byte_pos: Option<usize> = None;
            for c in rest.chars().skip(1) {
                if char_count >= 10 { break; }
                if c == ';' { semi_byte_pos = Some(byte_pos); break; }
                byte_pos += c.len_utf8();
                char_count += 1;
            }
            if let Some(end) = semi_byte_pos {
                let entity = &rest[1..end];
                let decoded = match entity {
                    "amp"    => "&",
                    "lt"     => "<",
                    "gt"     => ">",
                    "quot"   => "\"",
                    "apos"   => "'",
                    "nbsp"   => " ",
                    "mdash"  => "—",
                    "ndash"  => "–",
                    "hellip" => "...",
                    _ => "",
                };
                if !decoded.is_empty() {
                    out.push_str(decoded);
                    i += end + 1;
                    continue;
                }
            }
        }

        out.push(ch);
        i += ch_len;
    }

    let collapsed = out
        .lines()
        .map(|line| line.split_whitespace().collect::<Vec<_>>().join(" "))
        .collect::<Vec<_>>()
        .join("\n");

    let mut prev_blank = 0u8;
    let mut final_out = String::with_capacity(collapsed.len());
    for line in collapsed.lines() {
        if line.trim().is_empty() {
            prev_blank += 1;
            if prev_blank <= 2 { final_out.push('\n'); }
        } else {
            prev_blank = 0;
            final_out.push_str(line);
            final_out.push('\n');
        }
    }
    final_out.trim().to_string()
}

// ── Tool definitions for the LLM ──────────────────────────────────────────────

/// Return ToolDefinitions so the LLM can call browser actions as native tools.
pub fn tool_definitions() -> Vec<crate::providers::ToolDefinition> {
    use serde_json::json;
    vec![
        crate::providers::ToolDefinition {
            name: "blade_browser_navigate".to_string(),
            description: "Navigate the browser to a URL. \
                          Requires an active browser session (use connect_to_user_browser first). \
                          Returns confirmation once the page has loaded.".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "url": {
                        "type": "string",
                        "description": "Fully qualified URL (must start with https:// or http://)"
                    }
                },
                "required": ["url"]
            }),
        },
        crate::providers::ToolDefinition {
            name: "blade_browser_read_page".to_string(),
            description: "Navigate to a URL and return its readable text content (innerText). \
                          Uses the live browser — handles JS-rendered pages and authenticated sessions. \
                          Returns up to 20,000 characters.".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "url": {
                        "type": "string",
                        "description": "URL to navigate to and read"
                    }
                },
                "required": ["url"]
            }),
        },
        crate::providers::ToolDefinition {
            name: "blade_browser_click".to_string(),
            description: "Click an element in the browser by CSS selector. \
                          Use blade_browser_screenshot or blade_browser_read to find the right selector.".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "selector": {
                        "type": "string",
                        "description": "CSS selector of the element to click"
                    }
                },
                "required": ["selector"]
            }),
        },
        crate::providers::ToolDefinition {
            name: "blade_browser_type".to_string(),
            description: "Type text into an input field by CSS selector. \
                          Fires input and change events so React/Vue/Angular forms react correctly.".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "selector": {
                        "type": "string",
                        "description": "CSS selector of the input field"
                    },
                    "text": {
                        "type": "string",
                        "description": "Text to type"
                    }
                },
                "required": ["selector", "text"]
            }),
        },
        crate::providers::ToolDefinition {
            name: "blade_browser_screenshot".to_string(),
            description: "Take a screenshot of the current browser page. \
                          Returns a base64 PNG. Use to see the page state before deciding what to click.".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {}
            }),
        },
        crate::providers::ToolDefinition {
            name: "blade_browser_wait_for".to_string(),
            description: "Wait up to 10 seconds for a CSS selector to appear on the page. \
                          Use after navigation or clicking a button that loads new content.".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "selector": {
                        "type": "string",
                        "description": "CSS selector to wait for"
                    }
                },
                "required": ["selector"]
            }),
        },
        crate::providers::ToolDefinition {
            name: "blade_browser_agent_loop".to_string(),
            description: "Run an autonomous browser agent that will achieve a goal by navigating, \
                          clicking, typing, and reading pages. Give it a plain-English goal. \
                          The agent emits step-by-step progress events. Use for multi-step tasks \
                          like 'search for X on Google', 'fill out this form', 'read this article'.".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "goal": {
                        "type": "string",
                        "description": "Plain-English goal for the browser agent"
                    },
                    "max_steps": {
                        "type": "integer",
                        "description": "Maximum number of steps (default 15, max 50)"
                    }
                },
                "required": ["goal"]
            }),
        },
    ]
}
