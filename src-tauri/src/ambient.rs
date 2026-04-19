/// Ambient intelligence monitor — runs in background from app launch.
/// Tracks what the user is doing, emits proactive_nudge events when
/// Blade has something useful to say without being asked.
use tauri::Emitter;

/// Personality variations — BLADE doesn't repeat the same line.
/// tick % N picks a different phrasing each time.
fn duration_msg(app_label: &str, mins: u64, tick: u64) -> String {
    match tick % 4 {
        0 => format!("{} minutes in {}. Want a summary, a break, or for me to take something off your plate?", mins, app_label),
        1 => format!("You've been deep in {} for {} minutes. I'm here if you need anything.", app_label, mins),
        2 => format!("Still in {} — {} minutes and counting. Say the word if you want a hand.", app_label, mins),
        _ => format!("{} straight minutes of {}. Respect. Let me know when you want a break or a status check.", mins, app_label),
    }
}

fn idle_msg(tick: u64) -> String {
    match tick % 3 {
        0 => "Hey — you've been away. Want the rundown on what happened?".to_string(),
        1 => "Welcome back. I've been watching things while you were gone.".to_string(),
        _ => "Looks like you stepped away. Ready for a quick catch-up?".to_string(),
    }
}

fn error_msg(headline: &str, tick: u64) -> String {
    match tick % 3 {
        0 => format!("Caught an error: {}. Want me to look into it?", headline),
        1 => format!("Error spotted: {}. I can diagnose this if you want.", headline),
        _ => format!("Something broke: {}. Say the word and I'll dig in.", headline),
    }
}

fn long_session_msg(hours: u64, tick: u64) -> String {
    match tick % 3 {
        0 => format!("{} hours in. Has the work shifted, or still on the same thing?", hours),
        1 => format!("You've been at this for {} hours straight. Want a perspective check?", hours),
        _ => format!("{}-hour session. I can give you a summary of where things stand.", hours),
    }
}

fn stale_thread_msg(headline: &str, tick: u64) -> String {
    match tick % 2 {
        0 => format!("Your thread '{}' has gone quiet. Still relevant, or should I update it?", headline),
        _ => format!("'{}' hasn't moved in a while. Want me to refresh it or archive it?", headline),
    }
}

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

pub fn start_ambient_monitor(app: tauri::AppHandle) {
    // Detect multiple monitors immediately at startup and on hot-plug changes
    let mut last_monitor_count: usize = 0;
    if let Ok(monitors) = xcap::Monitor::all() {
        last_monitor_count = monitors.len();
        if monitors.len() > 1 {
            let _ = app.emit_to("main", "multiple_monitors_detected", serde_json::json!({
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
                        let _ = app.emit_to("main", "multiple_monitors_detected", serde_json::json!({
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
                        let _ = app.emit_to("main", "monitor_disconnected", serde_json::json!({
                            "count": new_count
                        }));
                    }
                    monitor_count = new_count;
                }
            }

            // Use the shared perception state — kept fresh by perception_fusion's 30s loop.
            // This eliminates duplicate clipboard reads and window polls on every tick.
            let perception = crate::perception_fusion::get_latest().unwrap_or_default();

            // ── Clipboard routing via perception state ────────────────────────
            // perception_fusion already classified the clipboard; we only act on change.
            if perception.clipboard_type == "error" && !perception.clipboard_preview.is_empty() {
                use std::hash::{Hash, Hasher};
                let mut h = std::collections::hash_map::DefaultHasher::new();
                perception.clipboard_preview.hash(&mut h);
                let hash = h.finish();
                if hash != last_error_hash {
                    last_error_hash = hash;
                    last_clipboard_action_hash = hash;
                    let headline = error_headline(&perception.clipboard_preview);
                    let _ = app.emit("proactive_nudge", serde_json::json!({
                        "message": error_msg(&headline, tick),
                        "type": "error_detected",
                        "raw": &perception.clipboard_preview,
                    }));
                    let text_clone = perception.clipboard_preview.clone();
                    let app_clone = app.clone();
                    tauri::async_runtime::spawn(async move {
                        crate::clipboard::clipboard_auto_action(&app_clone, &text_clone, "error").await;
                    });
                }
            } else if matches!(perception.clipboard_type.as_str(), "url" | "code")
                && !perception.clipboard_preview.is_empty()
            {
                use std::hash::{Hash, Hasher};
                let mut h = std::collections::hash_map::DefaultHasher::new();
                perception.clipboard_preview.hash(&mut h);
                let hash = h.finish();
                if hash != last_clipboard_action_hash {
                    last_clipboard_action_hash = hash;
                    let ct = perception.clipboard_type.clone();
                    let text_clone = perception.clipboard_preview.clone();
                    let app_clone = app.clone();
                    tauri::async_runtime::spawn(async move {
                        crate::clipboard::clipboard_auto_action(&app_clone, &text_clone, &ct).await;
                    });
                }
            }

            // ── Window / session tracking via perception state ─────────────────
            let active_app = &perception.active_app;
            let active_title = &perception.active_title;

            if !active_app.is_empty() || !active_title.is_empty() {
                // Detect return from away — generate catch-up summary
                if idle_nudged {
                    let away_mins = last_activity.elapsed().as_secs() / 60;
                    if away_mins >= 5 {
                        let app_catchup = app.clone();
                        tokio::spawn(async move {
                            let summary = generate_catchup_summary(away_mins).await;
                            if !summary.is_empty() {
                                let _ = app_catchup.emit_to("main", "blade_catchup", serde_json::json!({
                                    "away_minutes": away_mins,
                                    "summary": &summary,
                                }));
                                // Speak it
                                let _ = crate::tts::speak_and_wait(&app_catchup, &summary).await;
                                // Also show it via show_engine
                                crate::show_engine::trigger_auto_show(&app_catchup, "morning").await;
                            }
                        });
                    }
                }
                last_activity = std::time::Instant::now();
                idle_nudged = false;

                let key = format!("{}|{}", active_app, active_title);
                let prev_key = current.as_ref().map(|s| format!("{}|{}", s.process, s.name));

                if prev_key.as_deref() != Some(&key) {
                    // App or window switched — record to timeline
                    let db_path = crate::config::blade_config_dir().join("blade.db");
                    if let Ok(conn) = rusqlite::Connection::open(&db_path) {
                        let title = if active_title.is_empty() {
                            active_app.clone()
                        } else {
                            format!("{} — {}", active_app, crate::safe_slice(active_title, 60))
                        };
                        let _ = crate::db::timeline_record(&conn, "window_switch", &title, "", active_app, "{}");
                    }
                    current = Some(WindowSession {
                        name: active_title.clone(),
                        process: active_app.clone(),
                        started: std::time::Instant::now(),
                        nudge_fired: false,
                    });
                } else if let Some(ref mut sess) = current {
                    let mins = sess.started.elapsed().as_secs() / 60;
                    if mins >= 45 && !sess.nudge_fired {
                        sess.nudge_fired = true;
                        let app_label = friendly_app(&sess.process);
                        let _ = app.emit("proactive_nudge", serde_json::json!({
                            "message": duration_msg(app_label, mins, tick),
                            "type": "duration",
                            "context": sess.process
                        }));
                    }
                }

                // Every ~10 min (20 ticks): ambient context update to frontend
                if tick % 20 == 0 {
                    let activity = crate::context::get_user_activity().ok().unwrap_or_default();
                    if !activity.is_empty() {
                        let _ = app.emit_to("hud", "ambient_update", serde_json::json!({ "activity": activity }));
                    }
                }
            } else {
                // No active window in perception — user may be away
                let idle_mins = last_activity.elapsed().as_secs() / 60;
                if idle_mins >= 20 && !idle_nudged {
                    idle_nudged = true;
                    let _ = app.emit("proactive_nudge", serde_json::json!({
                        "message": idle_msg(tick),
                        "type": "idle"
                    }));
                }
            }

            // ── Meeting prep (every 5 min = 10 ticks) ─────────────────────────
            if tick % 10 == 0 {
                let istate = crate::integration_bridge::get_integration_state();
                if let Some(next) = istate.upcoming_events.first() {
                    if next.minutes_until >= 10 && next.minutes_until <= 15 {
                        // Meeting in 10-15 min — generate prep and speak it
                        let title = next.title.clone();
                        let mins = next.minutes_until;
                        let app_prep = app.clone();
                        tokio::spawn(async move {
                            let prep = format!(
                                "You have {} in {} minutes.",
                                crate::safe_slice(&title, 40), mins
                            );
                            let _ = crate::tts::speak_and_wait(&app_prep, &prep).await;
                            // Trigger auto-show for meeting prep
                            crate::show_engine::trigger_auto_show(&app_prep, "meeting_start").await;
                        });
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
                        "message": long_session_msg(session_hours, tick),
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
                                "message": stale_thread_msg(crate::safe_slice(&headline, 60), tick),
                                "type": "stale_thread",
                            }));
                        }
                    }
                }
            }
        }
    });
}

/// Generate a catch-up summary of what happened while the user was away.
async fn generate_catchup_summary(away_mins: u64) -> String {
    let mut parts: Vec<String> = Vec::new();
    let greeting = match (away_mins / 7) % 4 {
        0 => format!("Welcome back — {} minutes away.", away_mins),
        1 => format!("Hey, you're back. {} minutes gone.", away_mins),
        2 => format!("There you are. Been {} minutes.", away_mins),
        _ => format!("Good to see you. {} minutes since you left.", away_mins),
    };
    parts.push(greeting);

    // Hive: what happened across platforms
    let digest = crate::hive::get_hive_digest();
    if !digest.is_empty() && digest.contains("URGENT") {
        parts.push("Something needs your attention.".to_string());
    }

    // Integration state: unread counts
    let istate = crate::integration_bridge::get_integration_state();
    let mut counts: Vec<String> = Vec::new();
    if istate.unread_emails > 0 { counts.push(format!("{} unread emails", istate.unread_emails)); }
    if istate.slack_mentions > 0 { counts.push(format!("{} Slack mentions", istate.slack_mentions)); }
    if istate.github_notifications > 0 { counts.push(format!("{} GitHub notifications", istate.github_notifications)); }
    if !counts.is_empty() {
        parts.push(format!("While you were away: {}.", counts.join(", ")));
    }

    // Upcoming meetings
    if !istate.upcoming_events.is_empty() {
        let next = &istate.upcoming_events[0];
        if next.minutes_until <= 30 && next.minutes_until >= 0 {
            parts.push(format!("You have '{}' in {} minutes.", crate::safe_slice(&next.title, 40), next.minutes_until));
        }
    }

    // Proactive cards generated while away
    let cards = crate::proactive_vision::proactive_get_cards(Some(5));
    if !cards.is_empty() {
        parts.push(format!("{} observations while you were away.", cards.len()));
    }

    if parts.len() <= 1 {
        // Nothing happened
        return String::new();
    }

    parts.join(" ")
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
