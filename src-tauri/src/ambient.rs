/// Ambient intelligence monitor — runs in background from app launch.
/// Tracks what the user is doing, emits proactive_nudge events when
/// Blade has something useful to say without being asked.
use tauri::Emitter;

struct WindowSession {
    name: String,
    process: String,
    started: std::time::Instant,
    nudge_fired: bool,
}

/// Returns a brief first line from an error text — suitable for a nudge message.
fn error_headline(text: &str) -> String {
    text.lines()
        .find(|l| {
            let lo = l.to_lowercase();
            !l.trim().is_empty() && (lo.contains("error") || lo.contains("exception") || lo.contains("traceback") || lo.contains("panicked"))
        })
        .unwrap_or("an error")
        .trim()
        .chars()
        .take(120)
        .collect()
}

fn looks_like_error(text: &str) -> bool {
    if text.len() < 10 || text.len() > 20_000 { return false; }
    let lower = text.to_lowercase();
    lower.contains("traceback") || lower.contains("error:") ||
        lower.contains("exception:") || lower.contains("panicked at") ||
        lower.contains("typeerror:") || lower.contains("syntaxerror:") ||
        lower.contains("nameerror:") || lower.contains("valueerror:") ||
        lower.contains("attributeerror:") || lower.contains("nullpointerexception") ||
        lower.contains("uncaught error") || lower.contains("undefined is not a function") ||
        (lower.contains("fatal:") && lower.contains("error"))
}

pub fn start_ambient_monitor(app: tauri::AppHandle) {
    // Detect multiple monitors immediately at startup and on hot-plug changes
    let mut last_monitor_count: usize = 0;
    if let Ok(monitors) = xcap::Monitor::all() {
        last_monitor_count = monitors.len();
        if monitors.len() > 1 {
            let _ = app.emit("multiple_monitors_detected", serde_json::json!({
                "count": monitors.len(),
                "message": format!(
                    "I can see {} monitors. Want to dedicate one exclusively to me? I'll open everything there and keep your main screen clean.",
                    monitors.len()
                )
            }));
        }
    }

    tauri::async_runtime::spawn(async move {
        let mut current: Option<WindowSession> = None;
        let mut last_activity = std::time::Instant::now();
        let mut idle_nudged = false;
        let mut tick: u64 = 0;
        let mut last_error_hash: u64 = 0;
        let mut last_clipboard_action_hash: u64 = 0;
        let session_start = std::time::Instant::now();
        let mut long_session_nudged = false;
        let mut stale_thread_nudged = false;
        let mut monitor_count = last_monitor_count;

        loop {
            tokio::time::sleep(tokio::time::Duration::from_secs(30)).await;
            tick += 1;

            // Hot-plug monitor detection — fire whenever count changes
            if let Ok(monitors) = xcap::Monitor::all() {
                let new_count = monitors.len();
                if new_count != monitor_count {
                    if new_count > monitor_count && new_count > 1 {
                        // New monitor connected
                        let _ = app.emit("multiple_monitors_detected", serde_json::json!({
                            "count": new_count,
                            "message": format!(
                                "New monitor detected ({} total). Want me to move to it? I'll stay there and watch your main screen for you.",
                                new_count
                            )
                        }));
                    } else if new_count < monitor_count {
                        // Monitor disconnected — if BLADE was on it, clear the dedicated setting
                        let config = crate::config::load_config();
                        if config.blade_dedicated_monitor >= new_count as i32 {
                            let mut cfg = config;
                            cfg.blade_dedicated_monitor = -1;
                            let _ = crate::config::save_config(&cfg);
                        }
                        let _ = app.emit("monitor_disconnected", serde_json::json!({
                            "count": new_count
                        }));
                    }
                    monitor_count = new_count;
                }
            }

            // Proactively detect errors in clipboard — nudge if BLADE sees something new
            if let Ok(mut clipboard) = arboard::Clipboard::new() {
                if let Ok(text) = clipboard.get_text() {
                    if looks_like_error(&text) {
                        use std::hash::{Hash, Hasher};
                        let mut h = std::collections::hash_map::DefaultHasher::new();
                        crate::safe_slice(&text, 500).hash(&mut h);
                        let hash = h.finish();
                        if hash != last_error_hash {
                            last_error_hash = hash;
                            last_clipboard_action_hash = hash;
                            let headline = error_headline(&text);
                            let _ = app.emit("proactive_nudge", serde_json::json!({
                                "message": format!("I see an error in your clipboard: {}. Want me to diagnose it?", headline),
                                "type": "error_detected",
                                "raw": crate::safe_slice(&text, 800),
                            }));

                            // Route through decision gate — detached so the ambient loop continues
                            let text_clone = text.clone();
                            let app_clone = app.clone();
                            tauri::async_runtime::spawn(async move {
                                crate::clipboard::clipboard_auto_action(
                                    &app_clone,
                                    &text_clone,
                                    "error",
                                ).await;
                            });
                        }
                    } else {
                        // Classify and route non-error clipboard content through the decision gate
                        use std::hash::{Hash, Hasher};
                        let mut h = std::collections::hash_map::DefaultHasher::new();
                        crate::safe_slice(&text, 500).hash(&mut h);
                        let hash = h.finish();
                        if hash != last_clipboard_action_hash {
                            let lower = text.to_lowercase();
                            let content_type = if lower.starts_with("http://") || lower.starts_with("https://") {
                                Some("url")
                            } else {
                                // Mirror classify_content code-detection logic
                                let code_signals = ["fn ", "def ", "class ", "const ", "let ", "var ", "import ", "function ", "=>", "->", "{", "};"];
                                let code_score: usize = code_signals.iter().filter(|s| text.contains(*s)).count();
                                if code_score >= 2 { Some("code") } else { None }
                            };
                            if let Some(ct) = content_type {
                                last_clipboard_action_hash = hash;
                                let text_clone = text.clone();
                                let app_clone = app.clone();
                                let ct_str = ct.to_string();
                                tauri::async_runtime::spawn(async move {
                                    crate::clipboard::clipboard_auto_action(
                                        &app_clone,
                                        &text_clone,
                                        &ct_str,
                                    ).await;
                                });
                            }
                        }
                    }
                }
            }

            let win = crate::context::get_active_window().ok();

            match &win {
                Some(w) if !w.app_name.is_empty() || !w.window_title.is_empty() => {
                    last_activity = std::time::Instant::now();
                    idle_nudged = false;

                    let key = format!("{}|{}", w.app_name, w.window_title);
                    let prev_key = current.as_ref().map(|s| format!("{}|{}", s.process, s.name));

                    if prev_key.as_deref() != Some(&key) {
                        // App or window switched — record to timeline
                        let db_path = crate::config::blade_config_dir().join("blade.db");
                        if let Ok(conn) = rusqlite::Connection::open(&db_path) {
                            let title = if w.window_title.is_empty() {
                                w.app_name.clone()
                            } else {
                                format!("{} — {}", w.app_name, crate::safe_slice(&w.window_title, 60))
                            };
                            let _ = crate::db::timeline_record(
                                &conn,
                                "window_switch",
                                &title,
                                "",
                                &w.app_name,
                                "{}",
                            );
                        }
                        current = Some(WindowSession {
                            name: w.window_title.clone(),
                            process: w.app_name.clone(),
                            started: std::time::Instant::now(),
                            nudge_fired: false,
                        });
                    } else if let Some(ref mut sess) = current {
                        let mins = sess.started.elapsed().as_secs() / 60;

                        // Nudge after 45 min on same app
                        if mins >= 45 && !sess.nudge_fired {
                            sess.nudge_fired = true;
                            let app_label = friendly_app(&sess.process);
                            let _ = app.emit("proactive_nudge", serde_json::json!({
                                "message": format!(
                                    "You've been in {} for {} minutes straight. Need a break, a summary, or want me to take something off your plate?",
                                    app_label, mins
                                ),
                                "type": "duration",
                                "context": sess.process
                            }));
                        }
                    }

                    // Every ~10 min (20 ticks): ambient context update to frontend
                    if tick % 20 == 0 {
                        let activity = crate::context::get_user_activity().ok().unwrap_or_default();
                        if !activity.is_empty() {
                            let _ = app.emit("ambient_update", serde_json::json!({
                                "activity": activity
                            }));
                        }
                    }
                }
                _ => {
                    // Can't detect window
                    let idle_mins = last_activity.elapsed().as_secs() / 60;

                    if idle_mins >= 20 && !idle_nudged {
                        idle_nudged = true;
                        let _ = app.emit("proactive_nudge", serde_json::json!({
                            "message": "You've been away a while. Back? Want a quick summary of where we left off, or something to jump back into?",
                            "type": "idle"
                        }));
                    }
                }
            }

            // ── Temporal awareness checks (every ~30 min = 60 ticks) ──────────
            if tick % 60 == 0 && tick > 0 {

                // 1. Long session — 2+ hours of active use
                let session_hours = session_start.elapsed().as_secs() / 3600;
                if session_hours >= 2 && !long_session_nudged {
                    long_session_nudged = true;
                    let _ = app.emit("proactive_nudge", serde_json::json!({
                        "message": format!(
                            "You've been at this for {} hours. Still the same thing, or has the work shifted?",
                            session_hours
                        ),
                        "type": "long_session",
                    }));
                }

                // 2. Stale thread — thread hasn't been updated in 2+ hours
                if !stale_thread_nudged {
                    let thread_stale = {
                        let db_path = crate::config::blade_config_dir().join("blade.db");
                        rusqlite::Connection::open(&db_path).ok()
                            .and_then(|conn| {
                                conn.query_row(
                                    "SELECT MAX(updated_at) FROM active_threads",
                                    [],
                                    |row| row.get::<_, Option<i64>>(0),
                                ).ok().flatten()
                            })
                            .map(|ts| {
                                let now = chrono::Local::now().timestamp();
                                now - ts > 7200 // stale if not updated in 2h
                            })
                            .unwrap_or(false)
                    };

                    if let Some(thread) = thread_stale.then(|| crate::thread::get_active_thread()).flatten() {
                        if !thread.trim().is_empty() {
                            stale_thread_nudged = true;
                            let headline = thread.lines().next().unwrap_or("your active thread").trim().to_string();
                            let _ = app.emit("proactive_nudge", serde_json::json!({
                                "message": format!(
                                    "Your thread '{}' hasn't moved in two hours. Still relevant, or should I update it?",
                                    crate::safe_slice(&headline, 60)
                                ),
                                "type": "stale_thread",
                            }));
                        }
                    }
                }
            }
        }
    });
}

fn friendly_app(process: &str) -> &str {
    let p = process.to_lowercase();
    if p.contains("chrome") || p.contains("msedge") || p.contains("firefox") { return "the browser"; }
    if p.contains("code") || p.contains("vim") || p.contains("nvim") { return "your editor"; }
    if p.contains("terminal") || p.contains("cmd") || p.contains("powershell") || p.contains("wt") { return "the terminal"; }
    if p.contains("figma") || p.contains("sketch") { return "Figma"; }
    if p.contains("slack") { return "Slack"; }
    if p.contains("discord") { return "Discord"; }
    if p.contains("spotify") { return "Spotify"; }
    if p.contains("youtube") { return "YouTube"; }
    if process.is_empty() { return "whatever you're doing"; }
    process
}
