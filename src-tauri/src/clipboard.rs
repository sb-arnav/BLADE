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
    text[..text.len().min(500)].hash(&mut h);
    h.finish()
}

/// Get the current prefetch result if it matches the given content.
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
        let m = match config.provider.as_str() {
            "anthropic" => "claude-haiku-4-5-20251001",
            "openai" => "gpt-4o-mini",
            "gemini" => "gemini-2.0-flash",
            "groq" => "llama-3.1-8b-instant",
            _ => &config.model,
        };
        (config.provider.clone(), config.api_key.clone(), m.to_string())
    };

    let prompt = match kind {
        ClipboardContentType::Error => format!(
            "The user just copied this error message. In 2-4 sentences, explain what caused it and the most likely fix. Be direct and practical.\n\nError:\n{}",
            &text[..text.len().min(1500)]
        ),
        ClipboardContentType::Code => format!(
            "The user just copied this code snippet. In 2-3 sentences, describe what it does and flag any obvious issues or improvements.\n\nCode:\n{}",
            &text[..text.len().min(1200)]
        ),
        ClipboardContentType::Url => format!(
            "The user just copied this URL. Briefly describe what it likely points to (1 sentence). URL: {}",
            &text[..text.len().min(500)]
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
                "preview": &text[..text.len().min(60)],
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
                    if should_prefetch(&trimmed, &kind) {
                        let text_clone = trimmed.clone();
                        let app_clone = app.clone();
                        tauri::async_runtime::spawn(async move {
                            prefetch_analysis(text_clone, kind, app_clone).await;
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
    let combined = format!("$ {}\n{}", &command[..command.len().min(120)], &stderr[..stderr.len().min(1500)]);
    if should_prefetch(&combined, &ClipboardContentType::Error) {
        let text = combined;
        let app_clone = app.clone();
        tauri::async_runtime::spawn(async move {
            prefetch_analysis(text, ClipboardContentType::Error, app_clone).await;
        });
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
