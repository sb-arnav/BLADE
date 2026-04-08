use arboard::Clipboard;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter};

/// Watches the clipboard for changes and emits events to the frontend
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
                }
            }
        }
    });
}

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
