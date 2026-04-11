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

pub fn start_ambient_monitor(app: tauri::AppHandle) {
    // Detect multiple monitors immediately at startup
    if let Ok(monitors) = xcap::Monitor::all() {
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

        loop {
            tokio::time::sleep(tokio::time::Duration::from_secs(30)).await;
            tick += 1;

            let win = crate::context::get_active_window().ok();

            match &win {
                Some(w) if !w.app_name.is_empty() || !w.window_title.is_empty() => {
                    last_activity = std::time::Instant::now();
                    idle_nudged = false;

                    let key = format!("{}|{}", w.app_name, w.window_title);
                    let prev_key = current.as_ref().map(|s| format!("{}|{}", s.process, s.name));

                    if prev_key.as_deref() != Some(&key) {
                        // App or window switched
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
                        let activity = crate::context::get_user_activity().unwrap_or_default();
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
