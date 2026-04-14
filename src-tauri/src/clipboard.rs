use arboard::Clipboard;
use serde::{Deserialize, Serialize};
use std::hash::{Hash, Hasher};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter};

// ---------------------------------------------------------------------------
// Clipboard prefetch cache — one slot, keyed by content hash
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ClipboardContentType {
    Error,   // stack trace / error message
    Url,     // HTTP/HTTPS link
    Code,    // code snippet
    Command, // shell command
    Other,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClipboardPrefetch {
    pub content_hash: u64,
    pub content_type: ClipboardContentType,
    pub content_preview: String,  // first 120 chars
    pub analysis: String,         // pre-computed LLM answer
    pub prefetched_at: i64,
}

// One-slot cache — the last clipboard item analyzed
static PREFETCH_CACHE: std::sync::OnceLock<Mutex<Option<ClipboardPrefetch>>> =
    std::sync::OnceLock::new();

fn prefetch_cache() -> &'static Mutex<Option<ClipboardPrefetch>> {
    PREFETCH_CACHE.get_or_init(|| Mutex::new(None))
}

fn content_hash(text: &str) -> u64 {
    let mut h = std::collections::hash_map::DefaultHasher::new();
    crate::safe_slice(text, 500).hash(&mut h);
    h.finish()
}

/// Get the current prefetch result if it matches the given content.
#[allow(dead_code)]
pub fn get_prefetch_for(text: &str) -> Option<ClipboardPrefetch> {
    let hash = content_hash(text);
    prefetch_cache()
        .lock()
        .ok()?
        .as_ref()
        .filter(|p| p.content_hash == hash)
        .cloned()
}

/// Get the latest prefetch regardless of content (for brain injection).
pub fn get_latest_prefetch() -> Option<ClipboardPrefetch> {
    prefetch_cache().lock().ok()?.clone()
}

fn classify_content(text: &str) -> ClipboardContentType {
    let lower = text.to_lowercase();
    let trimmed = text.trim();

    if lower.starts_with("http://") || lower.starts_with("https://") {
        return ClipboardContentType::Url;
    }

    // Error patterns
    if lower.contains("traceback (most recent")
        || lower.contains("error:")
        || lower.contains("exception:")
        || lower.contains("panicked at")
        || lower.contains("typeerror:")
        || lower.contains("syntaxerror:")
        || lower.contains("nameerror:")
        || lower.contains("valueerror:")
        || lower.contains("attributeerror:")
        || lower.contains("nullpointerexception")
        || lower.contains("segfault")
        || lower.contains("sigsegv")
        || (lower.contains("at line") && lower.contains("error"))
        || (lower.contains("failed") && lower.contains("error"))
    {
        return ClipboardContentType::Error;
    }

    // Shell command patterns
    if (trimmed.starts_with("$ ") || trimmed.starts_with("# ") || trimmed.starts_with("> "))
        && !trimmed.contains('\n')
    {
        return ClipboardContentType::Command;
    }

    // Code snippets: has braces/brackets + common keywords
    let code_signals = ["fn ", "def ", "class ", "const ", "let ", "var ", "import ", "function ", "=>", "->", "{", "};"];
    let code_score: usize = code_signals.iter().filter(|s| text.contains(*s)).count();
    if code_score >= 2 {
        return ClipboardContentType::Code;
    }

    ClipboardContentType::Other
}

/// Decide whether a clipboard item is worth pre-analyzing (skip noise).
fn should_prefetch(text: &str, kind: &ClipboardContentType) -> bool {
    if text.len() < 30 { return false; }
    if text.len() > 20_000 { return false; }
    matches!(kind, ClipboardContentType::Error | ClipboardContentType::Code | ClipboardContentType::Url)
}

async fn prefetch_analysis(text: String, kind: ClipboardContentType, app: AppHandle) {
    let config = crate::config::load_config();
    if config.api_key.is_empty() && config.provider != "ollama" {
        return;
    }

    // Use cheapest available model for prefetch — speed matters more than quality here
    let (provider, key, model) = {
        let m = crate::config::cheap_model_for_provider(&config.provider, &config.model);
        (config.provider.clone(), config.api_key.clone(), m)
    };

    let prompt = match kind {
        ClipboardContentType::Error => format!(
            "The user just copied this error message. In 2-4 sentences, explain what caused it and the most likely fix. Be direct and practical.\n\nError:\n{}",
            crate::safe_slice(&text, 1500)
        ),
        ClipboardContentType::Code => format!(
            "The user just copied this code snippet. In 2-3 sentences, describe what it does and flag any obvious issues or improvements.\n\nCode:\n{}",
            crate::safe_slice(&text, 1200)
        ),
        ClipboardContentType::Url => format!(
            "The user just copied this URL. Briefly describe what it likely points to (1 sentence). URL: {}",
            crate::safe_slice(&text, 500)
        ),
        _ => return,
    };

    let msgs = vec![crate::providers::ConversationMessage::User(prompt)];

    match crate::providers::complete_turn(
        &provider, &key, &model, &msgs, &[], config.base_url.as_deref()
    ).await {
        Ok(turn) if !turn.content.trim().is_empty() => {
            let pf = ClipboardPrefetch {
                content_hash: content_hash(&text),
                content_type: kind.clone(),
                content_preview: text.chars().take(120).collect(),
                analysis: turn.content.trim().to_string(),
                prefetched_at: chrono::Utc::now().timestamp(),
            };
            if let Ok(mut cache) = prefetch_cache().lock() {
                *cache = Some(pf.clone());
            }
            // Notify frontend so it can show a subtle "ready" indicator
            let _ = app.emit("clipboard_prefetch_ready", serde_json::json!({
                "content_type": format!("{:?}", kind).to_lowercase(),
                "preview": crate::safe_slice(&text, 60),
            }));
        }
        _ => {}
    }
}

// ---------------------------------------------------------------------------
// Clipboard watcher (extended with prefetch)
// ---------------------------------------------------------------------------

/// Watches the clipboard for changes and emits events to the frontend.
/// Also kicks off background pre-analysis for error messages, code snippets,
/// and URLs so BLADE has the answer ready before the user even asks.
pub fn start_clipboard_watcher(app: AppHandle) {
    let last_content: Arc<Mutex<String>> = Arc::new(Mutex::new(String::new()));

    std::thread::spawn(move || {
        let mut clipboard = match Clipboard::new() {
            Ok(c) => c,
            Err(_) => return,
        };

        loop {
            std::thread::sleep(Duration::from_secs(1));

            if let Ok(text) = clipboard.get_text() {
                let trimmed = text.trim().to_string();
                if trimmed.is_empty() {
                    continue;
                }

                let mut last = last_content.lock().unwrap();
                if *last != trimmed {
                    *last = trimmed.clone();
                    let _ = app.emit("clipboard_changed", &trimmed);

                    // Kick off background pre-analysis if content is actionable
                    let kind = classify_content(&trimmed);
                    let kind_str = format!("{:?}", kind).to_lowercase();

                    if should_prefetch(&trimmed, &kind) {
                        let text_clone = trimmed.clone();
                        let app_clone = app.clone();
                        let kind_clone = kind.clone();
                        tauri::async_runtime::spawn(async move {
                            prefetch_analysis(text_clone, kind_clone, app_clone).await;
                        });
                    }

                    // Route through decision gate for autonomous/suggested actions.
                    // Only act on clearly structured content (not plain Other text).
                    if !matches!(kind, ClipboardContentType::Other) {
                        let text_clone = trimmed.clone();
                        let app_clone = app.clone();
                        tauri::async_runtime::spawn(async move {
                            clipboard_auto_action(&app_clone, &text_clone, &kind_str).await;
                        });
                    }
                }
            }
        }
    });
}

/// Pre-analyze a bash failure. Call this immediately when a shell command exits non-zero.
/// The result is stored in the prefetch cache so BLADE has the fix ready before the user asks.
pub fn prefetch_bash_failure(command: &str, stderr: &str, app: AppHandle) {
    if stderr.trim().len() < 30 { return; }
    let combined = format!("$ {}\n{}", crate::safe_slice(command, 120), crate::safe_slice(stderr, 1500));
    if should_prefetch(&combined, &ClipboardContentType::Error) {
        let text = combined;
        let app_clone = app.clone();
        tauri::async_runtime::spawn(async move {
            prefetch_analysis(text, ClipboardContentType::Error, app_clone).await;
        });
    }
}

// ---------------------------------------------------------------------------
// Clipboard auto-action — wires clipboard events through the decision gate
// ---------------------------------------------------------------------------

/// Detect a rough language label from a code snippet (best-effort).
fn detect_lang(text: &str) -> &'static str {
    let t = text;
    if t.contains("fn ") && (t.contains("->") || t.contains("let ") || t.contains("pub ")) {
        return "Rust";
    }
    if t.contains("def ") && t.contains(":") {
        return "Python";
    }
    if t.contains("function ") || t.contains("const ") && t.contains("=>") || t.contains("async ") {
        return "JavaScript/TS";
    }
    if t.contains("public class ") || t.contains("System.out.println") {
        return "Java";
    }
    if t.contains("#include") || t.contains("std::") {
        return "C/C++";
    }
    if t.contains("<?php") {
        return "PHP";
    }
    if t.contains("<html") || t.contains("</div>") {
        return "HTML";
    }
    "code"
}

/// Fetch the <title> of a URL with a 5-second timeout.
/// Returns None on any error or timeout.
async fn fetch_url_title(url: &str) -> Option<String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(5))
        .user_agent("BLADE/1.0 (clipboard enrichment)")
        .build()
        .ok()?;

    let resp = client.get(url).send().await.ok()?;

    // Only parse HTML content-types
    let ct = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_lowercase();

    if !ct.contains("text/html") {
        // Non-HTML resource — return domain as label
        return url
            .parse::<reqwest::Url>()
            .ok()
            .and_then(|u| u.host_str().map(|h| h.to_string()));
    }

    // Read up to 8 KB — enough to find <title>
    let body = resp.bytes().await.ok()?;
    let html = std::str::from_utf8(&body[..body.len().min(8192)]).ok()?;

    // Simple regex-free title extraction
    let lower = html.to_lowercase();
    let start = lower.find("<title")?.checked_add(6)?;
    let open_end = html[start..].find('>')?;
    let content_start = start + open_end + 1;
    let content_end = lower[content_start..].find("</title>").map(|e| content_start + e)?;
    let raw = &html[content_start..content_end];
    let title = raw.trim().to_string();
    if title.is_empty() {
        None
    } else {
        Some(title)
    }
}

/// Build a `decision_gate::Signal` from clipboard content and route it through
/// the decision gate. Fires Tauri events based on the outcome.
pub async fn clipboard_auto_action(app: &tauri::AppHandle, content: &str, content_type: &str) {
    use crate::decision_gate::{Signal, DecisionOutcome};

    let preview = crate::safe_slice(content, 80);

    let signal = match content_type {
        "error" => Signal {
            source: "clipboard".to_string(),
            description: format!("Error detected in clipboard: {}", preview),
            confidence: 0.85,
            reversible: true,
            time_sensitive: true,
        },
        "url" => Signal {
            source: "clipboard".to_string(),
            description: format!("URL copied: {}", crate::safe_slice(content, 200)),
            confidence: 0.7,
            reversible: true,
            time_sensitive: false,
        },
        "code" => {
            let lang = detect_lang(content);
            let len = content.len();
            Signal {
                source: "clipboard".to_string(),
                description: format!("Code snippet copied ({}, {} chars)", lang, len),
                confidence: 0.6,
                reversible: true,
                time_sensitive: false,
            }
        }
        "command" => Signal {
            source: "clipboard".to_string(),
            description: format!("Shell command copied: {}", preview),
            confidence: 0.5,
            reversible: false,
            time_sensitive: false,
        },
        _ => return, // Other / noise — skip
    };

    let perception = crate::perception_fusion::get_latest().unwrap_or_default();
    let (_id, outcome) = crate::decision_gate::evaluate_and_record(signal, &perception).await;

    match outcome {
        DecisionOutcome::ActAutonomously { .. } => {
            match content_type {
                "url" => {
                    // Enrich URL: fetch page title in background
                    let url = content.trim().to_string();
                    let app_clone = app.clone();
                    tauri::async_runtime::spawn(async move {
                        let title = fetch_url_title(&url).await
                            .unwrap_or_else(|| "Unknown page".to_string());
                        let summary = format!("Enriched URL — title: {}", title);
                        let _ = app_clone.emit("clipboard_enriched", serde_json::json!({
                            "url": url,
                            "title": title,
                            "summary": summary,
                        }));
                    });
                }
                "error" => {
                    // Surface error with suggested fix prompt
                    let _ = app.emit("clipboard_error_detected", serde_json::json!({
                        "preview": preview,
                        "suggested_prompt": format!(
                            "I found this error in your clipboard. Diagnose it and suggest a fix:\n\n{}",
                            crate::safe_slice(content, 600)
                        ),
                    }));
                }
                _ => {}
            }
        }
        DecisionOutcome::AskUser { question, .. } => {
            let _ = app.emit("proactive_suggestion", serde_json::json!({
                "question": question,
                "content_type": content_type,
                "preview": preview,
            }));
        }
        DecisionOutcome::QueueForLater { task, .. } => {
            log::debug!("[clipboard_auto_action] Queued for later: {}", task);
        }
        DecisionOutcome::Ignore { .. } => {
            // Intentionally do nothing
        }
    }
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

/// Get current clipboard contents
#[tauri::command]
pub fn get_clipboard() -> Result<String, String> {
    let mut clipboard = Clipboard::new().map_err(|e| e.to_string())?;
    clipboard.get_text().map_err(|e| e.to_string())
}

/// Set clipboard contents
#[tauri::command]
pub fn set_clipboard(text: String) -> Result<(), String> {
    let mut clipboard = Clipboard::new().map_err(|e| e.to_string())?;
    clipboard.set_text(text).map_err(|e| e.to_string())
}

/// Get the pre-computed analysis for the current clipboard content (if available).
/// Returns null if nothing is cached or the clipboard has changed since prefetch.
#[tauri::command]
pub fn get_clipboard_prefetch() -> Option<ClipboardPrefetch> {
    get_latest_prefetch().filter(|p| {
        // Only return if prefetch is fresh (< 5 minutes old)
        let age = chrono::Utc::now().timestamp() - p.prefetched_at;
        age < 300
    })
}
