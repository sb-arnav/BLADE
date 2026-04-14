// src-tauri/src/browser_agent.rs
//
// Browser automation foundation for BLADE.
//
// Inspired by browser-use (vendor/browser-use/browser_use/) which defines
// a clean action enum — Navigate, Click, Type, Screenshot, ReadPage, WaitFor —
// that an LLM-driven agent dispatches step by step.
//
// Current implementation:
//   Navigate  — HTTP GET via reqwest, returns final URL + page title
//   ReadPage  — HTTP GET, strips HTML tags, returns readable text content
//
// Stubs (require Playwright/CDP integration):
//   Click, Type, Screenshot, WaitFor — return a clear "not implemented" message
//   so the LLM can fall back gracefully.
//
// Tool definitions are provided for the LLM to call these as native tools.

use reqwest::Client;
use serde::{Deserialize, Serialize};

// ── Action enum ───────────────────────────────────────────────────────────────

/// The set of browser actions BLADE can perform.
/// Modelled after browser-use's ActionModel pattern.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum BrowserAction {
    /// Navigate to a URL (HTTP GET)
    Navigate { url: String },
    /// Click a CSS selector — requires Playwright
    Click { selector: String },
    /// Type text into a CSS selector — requires Playwright
    Type { selector: String, text: String },
    /// Take a screenshot — requires Playwright
    Screenshot,
    /// Fetch and return readable page text (HTTP GET + HTML strip)
    ReadPage { url: String },
    /// Wait for a CSS selector to appear — requires Playwright
    WaitFor { selector: String },
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────

fn make_client() -> Result<Client, String> {
    reqwest::Client::builder()
        .user_agent(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) \
             AppleWebKit/537.36 (KHTML, like Gecko) \
             Chrome/124.0.0.0 Safari/537.36",
        )
        .timeout(std::time::Duration::from_secs(20))
        .redirect(reqwest::redirect::Policy::limited(5))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))
}

/// Fetch a URL and return `(final_url, status_code, body_text)`.
async fn http_get(url: &str) -> Result<(String, u16, String), String> {
    let client = make_client()?;
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("HTTP request failed for '{}': {}", url, e))?;

    let final_url = response.url().to_string();
    let status = response.status().as_u16();
    let body = response
        .text()
        .await
        .map_err(|e| format!("Failed to read response body: {}", e))?;

    Ok((final_url, status, body))
}

// ── HTML stripping ────────────────────────────────────────────────────────────

/// Strip HTML tags and collapse whitespace to get readable plain text.
/// Also decodes common HTML entities.
fn strip_html(html: &str) -> String {
    let mut out = String::with_capacity(html.len() / 2);
    let mut in_tag = false;
    let mut in_script = false;
    let mut in_style = false;
    let bytes = html.as_bytes();
    let mut i = 0;

    while i < bytes.len() {
        let ch = bytes[i] as char;

        // Detect <script ... > and <style ... > blocks — drop entirely
        if !in_tag && ch == '<' {
            let rest = &html[i..];
            let tag_lower: String = rest
                .chars()
                .skip(1)
                .take(10)
                .collect::<String>()
                .to_lowercase();
            if tag_lower.starts_with("script") {
                in_script = true;
            } else if tag_lower.starts_with("style") {
                in_style = true;
            } else if in_script && tag_lower.starts_with("/script") {
                in_script = false;
            } else if in_style && tag_lower.starts_with("/style") {
                in_style = false;
            }
            in_tag = true;
            i += 1;
            continue;
        }

        if in_tag {
            if ch == '>' {
                in_tag = false;
                out.push(' '); // replace tag with a space
            }
            i += 1;
            continue;
        }

        if in_script || in_style {
            i += 1;
            continue;
        }

        // Decode common entities
        if ch == '&' {
            let rest = &html[i..];
            if let Some(end) = rest.find(';') {
                let entity = &rest[1..end];
                let decoded = match entity {
                    "amp"   => "&",
                    "lt"    => "<",
                    "gt"    => ">",
                    "quot"  => "\"",
                    "apos"  => "'",
                    "nbsp"  => " ",
                    "mdash" => "—",
                    "ndash" => "–",
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
        i += 1;
    }

    // Collapse runs of whitespace (tabs, spaces, newlines) to single spaces,
    // but preserve paragraph breaks (double newlines → blank line).
    let collapsed = out
        .lines()
        .map(|line| line.split_whitespace().collect::<Vec<_>>().join(" "))
        .collect::<Vec<_>>()
        .join("\n");

    // Collapse runs of 3+ blank lines down to 2
    let mut prev_blank = 0u8;
    let mut final_out = String::with_capacity(collapsed.len());
    for line in collapsed.lines() {
        if line.trim().is_empty() {
            prev_blank += 1;
            if prev_blank <= 2 {
                final_out.push('\n');
            }
        } else {
            prev_blank = 0;
            final_out.push_str(line);
            final_out.push('\n');
        }
    }

    final_out.trim().to_string()
}

/// Try to extract the <title> from an HTML document.
fn extract_title(html: &str) -> Option<String> {
    let lower = html.to_lowercase();
    let start = lower.find("<title>")? + "<title>".len();
    let end = lower[start..].find("</title>").map(|i| start + i)?;
    let raw = &html[start..end];
    let title = strip_html(raw).trim().to_string();
    if title.is_empty() { None } else { Some(title) }
}

// ── Action executor ───────────────────────────────────────────────────────────

/// Execute a `BrowserAction` and return `(result_string, is_error)`.
pub async fn execute_browser_action(action: &BrowserAction) -> (String, bool) {
    match action {
        BrowserAction::Navigate { url } => {
            match http_get(url).await {
                Ok((final_url, status, body)) => {
                    let title = extract_title(&body).unwrap_or_else(|| "(no title)".to_string());
                    (
                        format!(
                            "Navigated to: {}\nFinal URL: {}\nHTTP Status: {}\nPage title: {}",
                            url, final_url, status, title
                        ),
                        !(200..300).contains(&status),
                    )
                }
                Err(e) => (e, true),
            }
        }

        BrowserAction::ReadPage { url } => {
            match http_get(url).await {
                Ok((final_url, status, body)) => {
                    let title = extract_title(&body).unwrap_or_else(|| "(no title)".to_string());
                    let text = strip_html(&body);
                    // Cap output to avoid token explosion
                    const MAX_CHARS: usize = 20_000;
                    let truncated = if text.chars().count() > MAX_CHARS {
                        format!(
                            "{}…\n[Content truncated at {} chars]",
                            &text.chars().take(MAX_CHARS).collect::<String>(),
                            MAX_CHARS
                        )
                    } else {
                        text
                    };
                    (
                        format!(
                            "URL: {}\nFinal URL: {}\nHTTP Status: {}\nTitle: {}\n\n---\n\n{}",
                            url, final_url, status, title, truncated
                        ),
                        !(200..300).contains(&status),
                    )
                }
                Err(e) => (e, true),
            }
        }

        BrowserAction::Click { selector } => (
            format!(
                "Not implemented yet — requires Playwright. \
                 Selector requested: '{}'. \
                 Use blade_browser_click for managed browser sessions instead.",
                selector
            ),
            false,
        ),

        BrowserAction::Type { selector, text } => (
            format!(
                "Not implemented yet — requires Playwright. \
                 Selector: '{}', Text: '{}'. \
                 Use blade_browser_type for managed browser sessions instead.",
                selector, text
            ),
            false,
        ),

        BrowserAction::Screenshot => (
            "Not implemented yet — requires Playwright. \
             Use blade_screenshot for a desktop screenshot, \
             or blade_browser_screenshot for the managed browser."
                .to_string(),
            false,
        ),

        BrowserAction::WaitFor { selector } => (
            format!(
                "Not implemented yet — requires Playwright. \
                 Selector: '{}'. Use blade_browser_read to poll page state instead.",
                selector
            ),
            false,
        ),
    }
}

// ── Tauri command ─────────────────────────────────────────────────────────────

/// Tauri command: execute a browser action.
///
/// `action_json` must be a JSON object with an `"action"` discriminant field, e.g.:
/// ```json
/// { "action": "navigate", "url": "https://example.com" }
/// { "action": "read_page", "url": "https://docs.rs/serde" }
/// { "action": "click", "selector": "#submit-button" }
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

// ── Tool definitions for the LLM ──────────────────────────────────────────────

/// Return ToolDefinitions so the LLM can call browser actions as native tools.
pub fn tool_definitions() -> Vec<crate::providers::ToolDefinition> {
    use serde_json::json;
    vec![
        crate::providers::ToolDefinition {
            name: "blade_browser_navigate".to_string(),
            description: "Navigate to a URL via HTTP GET and return the page title and status. \
                          Use this to confirm a page loads successfully or to follow redirects. \
                          Unlike blade_web_fetch, this does not return page content — \
                          use blade_browser_read_page for content.".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "url": {
                        "type": "string",
                        "description": "Fully qualified URL to navigate to (must start with https:// or http://)"
                    }
                },
                "required": ["url"]
            }),
        },
        crate::providers::ToolDefinition {
            name: "blade_browser_read_page".to_string(),
            description: "Fetch a URL and return its readable text content (HTML tags stripped). \
                          Use for: reading documentation, extracting article text, scraping data \
                          from public pages. Returns up to 20,000 characters. For interactive \
                          pages (requiring login/JS), use blade_browser_open + blade_browser_read \
                          instead.".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "url": {
                        "type": "string",
                        "description": "URL to fetch and read"
                    }
                },
                "required": ["url"]
            }),
        },
        crate::providers::ToolDefinition {
            name: "blade_browser_click_pw".to_string(),
            description: "Click a CSS selector in a browser tab. \
                          NOT YET IMPLEMENTED — requires Playwright integration. \
                          Use blade_browser_click for managed browser sessions.".to_string(),
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
            name: "blade_browser_type_pw".to_string(),
            description: "Type text into a CSS selector. \
                          NOT YET IMPLEMENTED — requires Playwright integration. \
                          Use blade_browser_type for managed browser sessions.".to_string(),
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
            name: "blade_browser_screenshot_pw".to_string(),
            description: "Take a screenshot of the current browser tab. \
                          NOT YET IMPLEMENTED — requires Playwright integration. \
                          Use blade_browser_screenshot for the managed browser instead.".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {}
            }),
        },
        crate::providers::ToolDefinition {
            name: "blade_browser_wait_for".to_string(),
            description: "Wait for a CSS selector to appear on the page. \
                          NOT YET IMPLEMENTED — requires Playwright integration.".to_string(),
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
    ]
}
