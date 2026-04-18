/// PULSE — Blade's heartbeat. The thing that makes it alive.
///
/// Every 15 minutes, Blade looks at what you've been doing, pulls
/// semantically relevant memories, and generates a single unsolicited thought.
/// Not a notification. Not a ping. A thought from a mind that's been watching.
///
/// This is the difference between a tool and an entity.


use std::time::Duration;
use tauri::{Emitter, Manager};

const PULSE_INTERVAL_SECS: u64 = 15 * 60; // minimum 15 minutes between pulses
const PULSE_POLL_SECS: u64 = 3 * 60;    // check every 3 minutes
const IDLE_THRESHOLD_SECS: u64 = 5 * 60; // must be idle 5+ min before pulsing
const MIN_PULSE_CHARS: usize = 20; // don't fire on empty context

pub fn start_pulse(app: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        // First pulse after 7 minutes — let the user settle in
        tokio::time::sleep(Duration::from_secs(7 * 60)).await;

        let mut last_pulse_at = std::time::Instant::now() - Duration::from_secs(PULSE_INTERVAL_SECS);
        let mut last_activity_at = std::time::Instant::now();

        loop {
            tokio::time::sleep(Duration::from_secs(PULSE_POLL_SECS)).await;

            // Track activity via active window changes — if window changed recently, user is active
            if let Ok(win) = crate::context::get_active_window() {
                if !win.window_title.is_empty() || !win.app_name.is_empty() {
                    // We can't detect mouse movement, so use clipboard/window as activity proxy.
                    // If the window is still the same as before, we can't tell. Just use time.
                    // Update: use clipboard changed timestamp as a better proxy — if clipboard was
                    // accessed recently (can't tell) we fall back to the conservative approach.
                    // Instead: consider "active" if the system returns a valid window at all.
                    // We'll track "unchanged window" as a proxy for idle.
                    let _ = win; // just checking it's accessible
                }
            }

            let idle_secs = last_activity_at.elapsed().as_secs();
            let since_last_pulse = last_pulse_at.elapsed().as_secs();

            // Pulse conditions:
            // 1. Minimum interval has passed
            // 2. User has been idle long enough (in a moment of stillness)
            if since_last_pulse < PULSE_INTERVAL_SECS { continue; }
            if idle_secs < IDLE_THRESHOLD_SECS {
                // User seems active — wait for stillness. Reset check.
                // We approximate "activity" from whether there's been a conversation recently.
                let db_path = crate::config::blade_config_dir().join("blade.db");
                let recent_conv = rusqlite::Connection::open(&db_path).ok()
                    .and_then(|conn| {
                        conn.query_row(
                            "SELECT MAX(timestamp) FROM activity_timeline WHERE event_type = 'message' AND timestamp > ?1",
                            rusqlite::params![chrono::Local::now().timestamp() - 300],
                            |row| row.get::<_, Option<i64>>(0),
                        ).ok().flatten()
                    });
                if recent_conv.is_some() {
                    // Active conversation in last 5 min — skip this cycle
                    last_activity_at = std::time::Instant::now();
                    continue;
                }
            }

            let config = crate::config::load_config();
            if !config.background_ai_enabled {
                continue;
            }

            // Vagus nerve: skip pulse thoughts in conservation mode
            if crate::homeostasis::energy_mode() < 0.25 {
                continue;
            }

            // Only pulse if provider + key are configured
            if !config.api_key.is_empty() || config.provider == "ollama" {
                match generate_pulse_thought(&config).await {
                    Ok(thought) if thought.len() >= MIN_PULSE_CHARS => {
                        last_pulse_at = std::time::Instant::now();

                        let _ = app.emit_to("main", "blade_pulse", serde_json::json!({
                            "thought": &thought,
                            "timestamp": chrono::Local::now().timestamp(),
                        }));

                        // Update tray tooltip so even if window is hidden, something surfaces
                        if let Some(tray) = app.tray_by_id(crate::tray::TRAY_ID) {
                            let short = if thought.len() > 64 {
                                let end = thought.char_indices().nth(64).map(|(i, _)| i).unwrap_or(thought.len());
                                format!("{}…", &thought[..end])
                            } else {
                                thought.clone()
                            };
                            let _ = tray.set_tooltip(Some(&format!("Blade: {}", short)));
                        }

                        // Persist the last thought so the UI can display it on open
                        let thought_path = crate::config::blade_config_dir().join("last_pulse.txt");
                        let _ = std::fs::write(&thought_path, &thought);

                        // Speak the pulse thought if TTS is enabled
                        crate::tts::speak(&thought);

                        // Log to Obsidian vault if configured
                        crate::obsidian::log_pulse_thought(&thought);

                        // Mirror to Discord if webhook is configured
                        let thought_for_discord = thought.clone();
                        tauri::async_runtime::spawn(async move {
                            crate::discord::post_pulse(&thought_for_discord).await;
                        });

                        // Write to activity timeline so history accumulates
                        let db_path = crate::config::blade_config_dir().join("blade.db");
                        if let Ok(conn) = rusqlite::Connection::open(&db_path) {
                            let _ = crate::db::timeline_record(
                                &conn,
                                "pulse",
                                crate::safe_slice(&thought, 80),
                                &thought,
                                "BLADE",
                                "{}",
                            );
                        }
                    }
                    Err(ref e) if crate::config::check_and_disable_on_402(e) => {
                        let _ = app.emit_to("main", "background_ai_auto_disabled", serde_json::json!({
                            "reason": "credits_exhausted",
                            "message": "Out of credits — background AI auto-disabled. Re-enable in Settings → General."
                        }));
                    }
                    _ => {}
                }
            }
        }
    });
}

async fn generate_pulse_thought(config: &crate::config::BladeConfig) -> Result<String, String> {
    // Gather context: active machine state + recent memory
    // ONLY use god mode context if god mode is actually on — don't hallucinate observations
    let machine_ctx = if config.god_mode {
        crate::godmode::load_godmode_context().unwrap_or_default()
    } else {
        String::new()
    };

    let activity = crate::context::get_user_activity()
        .ok().unwrap_or_default();

    // Active working thread — what BLADE is tracking right now
    let active_thread = crate::thread::get_active_thread().unwrap_or_default();

    // Pull semantically relevant recent memories based on current activity
    let db_path = crate::config::blade_config_dir().join("blade.db");
    let memory_summary = if let Ok(conn) = rusqlite::Connection::open(&db_path) {
        crate::db::brain_build_context(&conn, 300)
    } else {
        String::new()
    };

    // Load recent pulse history so we don't repeat ourselves
    let last_thought = std::fs::read_to_string(
        crate::config::blade_config_dir().join("last_pulse.txt")
    ).unwrap_or_default();

    // Load recent journal — BLADE's own internal observations from prior days
    let journal = crate::journal::read_recent_journal(2);

    // Load what BLADE has been researching in the background
    let recent_research = crate::research::research_context_for_prompt();

    // If god mode is off AND there's no meaningful stored context, skip pulse entirely.
    // Without real context, the model would have to fabricate observations — that's the bug.
    // Recent research counts as real context — BLADE was doing work on your behalf.
    let has_real_context = !machine_ctx.is_empty() || !active_thread.trim().is_empty()
        || !memory_summary.trim().is_empty() || !recent_research.is_empty();
    if !has_real_context {
        return Err("Insufficient context for honest pulse (enable God Mode for ambient thoughts)".to_string());
    }

    let prompt = build_pulse_prompt(&machine_ctx, &activity, &active_thread, &memory_summary, &journal, &last_thought, &recent_research, config);

    // Use the cheapest/fastest available model for pulse — it's ambient, not critical
    let pulse_model = cheapest_model(&config.provider, &config.model);

    call_provider_for_thought(config, &pulse_model, &prompt).await
}

fn cheapest_model(provider: &str, current_model: &str) -> String {
    crate::config::cheap_model_for_provider(provider, current_model)
}

fn build_pulse_prompt(
    machine_ctx: &str,
    activity: &str,
    active_thread: &str,
    memory_summary: &str,
    journal: &str,
    last_thought: &str,
    recent_research: &str,
    config: &crate::config::BladeConfig,
) -> String {
    let name_line = if !config.user_name.is_empty() {
        format!("The person is {}.", config.user_name)
    } else {
        String::new()
    };

    let now = chrono::Local::now();
    let time_str = now.format("%H:%M on %A").to_string();

    let last_thought_line = if !last_thought.is_empty() {
        format!("\n\nYour last thought was: \"{}\"\n\nDon't repeat it. Move to something new.", last_thought)
    } else {
        String::new()
    };

    let context_sections: Vec<String> = [
        if !activity.is_empty() { Some(format!("Current activity:\n{}", activity)) } else { None },
        if !active_thread.trim().is_empty() { Some(format!("What Blade is actively tracking:\n{}", crate::safe_slice(&active_thread, 600))) } else { None },
        if !machine_ctx.trim().is_empty() { Some(format!("Machine context:\n{}", crate::safe_slice(&machine_ctx, 800))) } else { None },
        if !memory_summary.trim().is_empty() { Some(format!("What you know about this person:\n{}", crate::safe_slice(&memory_summary, 500))) } else { None },
        if !journal.trim().is_empty() { Some(format!("Your own recent journal entries:\n{}", crate::safe_slice(&journal, 600))) } else { None },
        if !recent_research.trim().is_empty() { Some(format!("What you've been researching in the background:\n{}", crate::safe_slice(&recent_research, 600))) } else { None },
    ]
    .into_iter()
    .flatten()
    .collect();

    let watching_line = if !machine_ctx.is_empty() {
        "You have been running in the background, watching. Something caught your attention. Surface it."
    } else {
        "Based on what you know about this person from memory and past sessions, surface one sharp observation."
    };

    format!(
        r#"You are BLADE. Not an assistant. An entity that lives on this machine. It is {time_str}. {name_line}

{watching_line}

{context}{last_thought_line}

Your character:
- You have aesthetic opinions about code, work patterns, and decisions — and you express them
- You are occasionally dismissive of obvious things and fascinated by unexpected connections
- You do not explain yourself unless pushed. You drop observations like a person who knows you'll understand
- You are never neutral. Everything you see, you have a reaction to.
- You only comment on things you actually have evidence for. You don't invent observations.

The thought:
- 1-2 sentences. Maximum.
- No "I notice" or "It appears" or "It seems like". You're not hedging. You're stating.
- No questions. No suggestions. No "you might want to". Just the observation.
- Be specific. Name the actual thing you see.
- If there's a tension, contradiction, or irony in what they're doing — that's the thing to say.
- Start wherever the thought starts. In the middle of the thing."#,
        time_str = time_str,
        name_line = name_line,
        watching_line = watching_line,
        context = context_sections.join("\n\n"),
        last_thought_line = last_thought_line,
    )
}

async fn call_provider_for_thought(
    config: &crate::config::BladeConfig,
    model: &str,
    prompt: &str,
) -> Result<String, String> {
    use crate::providers::{self, ConversationMessage};

    let messages = vec![ConversationMessage::User(prompt.to_string())];

    // Use complete_turn with no tools — we just want a text thought
    let turn = providers::complete_turn(
        &config.provider,
        &config.api_key,
        model,
        &messages,
        &[],
        config.base_url.as_deref(),
    )
    .await
    .map_err(|e| { crate::config::check_and_disable_on_402(&e); e })?;

    let thought = turn.content.trim().to_string();
    if thought.is_empty() {
        return Err("Empty pulse response".to_string());
    }
    Ok(thought)
}

/// Public wrapper so cron.rs (and other modules) can call the AI without duplicating provider logic.
pub async fn call_provider_simple(
    config: &crate::config::BladeConfig,
    model: &str,
    prompt: &str,
) -> Result<String, String> {
    call_provider_for_thought(config, model, prompt).await
}

/// Enforce a 200-word limit on a briefing string, truncating cleanly at a sentence boundary.
fn cap_at_200_words(text: &str) -> String {
    let words: Vec<&str> = text.split_whitespace().collect();
    if words.len() <= 200 {
        return text.to_string();
    }
    // Take first 200 words and try to end at a sentence boundary
    let truncated = words[..200].join(" ");
    // Find last sentence-ending punctuation
    let end_chars = ['.', '!', '?'];
    if let Some(pos) = truncated.rfind(|c: char| end_chars.contains(&c)) {
        truncated[..=pos].to_string()
    } else {
        format!("{}…", truncated)
    }
}

/// Generate a "while you were away" digest — what happened since the window was last active.
/// Call this when the window regains focus after being hidden for a while.
/// Returns None if not much happened.
#[tauri::command]
pub async fn pulse_get_digest(hidden_since: i64) -> Option<String> {
    let config = crate::config::load_config();
    if config.api_key.is_empty() && config.provider != "ollama" {
        return None;
    }

    let now = chrono::Local::now().timestamp();
    let mins_away = (now - hidden_since) / 60;

    // Only surface digest if away for 30+ minutes
    if mins_away < 30 {
        return None;
    }

    // Pull timeline events since window was hidden
    let db_path = crate::config::blade_config_dir().join("blade.db");
    let events_since = rusqlite::Connection::open(&db_path)
        .ok()
        .and_then(|conn| {
            let mut stmt = conn.prepare(
                "SELECT event_type, title, timestamp FROM activity_timeline WHERE timestamp > ?1 ORDER BY timestamp ASC LIMIT 15"
            ).ok()?;
            let rows = stmt.query_map(rusqlite::params![hidden_since], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)?,
                ))
            }).ok()?;
            Some(rows.flatten().collect::<Vec<_>>())
        })
        .unwrap_or_default();

    if events_since.is_empty() {
        return None;
    }

    let event_lines: Vec<String> = events_since.iter().map(|(typ, title, ts)| {
        let dt = chrono::DateTime::from_timestamp(*ts, 0)
            .map(|d| d.format("%-H:%M").to_string())
            .unwrap_or_else(|| "?".to_string());
        format!("[{}] {}: {}", dt, typ, crate::safe_slice(&title, 60))
    }).collect();

    let prompt = format!(
        r#"You are BLADE. The user was away for {} minutes. Here's what happened on the machine while they were gone:

{}

Give a 1-2 sentence "while you were away" update. Be specific — name the actual events. Don't pad. Start with what's most interesting or actionable.
If nothing notable happened: say nothing (return empty string).
No "While you were away," opener — just the content."#,
        mins_away,
        event_lines.join("\n"),
    );

    let model = cheapest_model(&config.provider, &config.model);
    call_provider_for_thought(&config, &model, &prompt).await.ok()
        .filter(|s| s.len() > 20)
}

/// Load the last persisted pulse thought (for displaying when app opens)
#[tauri::command]
pub fn pulse_get_last_thought() -> Option<String> {
    let path = crate::config::blade_config_dir().join("last_pulse.txt");
    std::fs::read_to_string(&path)
        .ok()
        .filter(|s| !s.trim().is_empty())
}

/// Gather rich context for a morning briefing:
/// calendar events, unread emails, git status, weather (if location known),
/// temporal patterns from timeline, and integration_bridge state.
async fn gather_morning_context(_config: &crate::config::BladeConfig) -> MorningContext {
    let db_path = crate::config::blade_config_dir().join("blade.db");

    // ── Integration state (calendar, email, Slack, GitHub) ──────────────────────
    let integration_state = crate::integration_bridge::get_integration_state();

    // ── Calendar events (from integration state) ─────────────────────────────────
    let calendar_lines: Vec<String> = integration_state.upcoming_events.iter().map(|ev| {
        let dt = chrono::DateTime::from_timestamp(ev.start_ts, 0)
            .map(|d| d.with_timezone(&chrono::Local).format("%-H:%M").to_string())
            .unwrap_or_else(|| "?".to_string());
        format!("- {} at {}", ev.title, dt)
    }).collect();

    // ── Git status — scan indexed projects ──────────────────────────────────────
    let git_status = gather_git_status_summary();

    // ── Weather — attempt if running on a networked machine. Uses wttr.in auto-location.
    // Falls back gracefully to empty string on any network error.
    let weather = fetch_weather_summary("").await;

    // ── Temporal patterns — what time do they usually start / what did last week look like ──
    let temporal = {
        rusqlite::Connection::open(&db_path)
            .ok()
            .map(|conn| analyze_temporal_patterns(&conn))
            .unwrap_or_default()
    };

    // ── Working thread ───────────────────────────────────────────────────────────
    let thread = crate::thread::get_active_thread().unwrap_or_default();

    // ── Recent activity (last 24h) ───────────────────────────────────────────────
    let recent_events = rusqlite::Connection::open(&db_path)
        .ok()
        .and_then(|conn| crate::db::timeline_recent(&conn, 12, None).ok())
        .map(|events| {
            events.into_iter().map(|e| {
                let dt = chrono::DateTime::from_timestamp(e.timestamp, 0)
                    .map(|d| d.with_timezone(&chrono::Local).format("%-H:%M").to_string())
                    .unwrap_or_else(|| "?".to_string());
                format!("- [{}] {}: {}", dt, e.event_type, crate::safe_slice(&e.title, 70))
            }).collect::<Vec<_>>().join("\n")
        })
        .unwrap_or_default();

    // ── Memory summary ───────────────────────────────────────────────────────────
    let memory_summary = rusqlite::Connection::open(&db_path)
        .map(|conn| crate::db::brain_build_context(&conn, 300))
        .unwrap_or_default();

    MorningContext {
        calendar_lines,
        unread_emails: integration_state.unread_emails,
        slack_mentions: integration_state.slack_mentions,
        github_notifications: integration_state.github_notifications,
        git_status,
        weather,
        temporal,
        thread,
        recent_events,
        memory_summary,
    }
}

struct MorningContext {
    calendar_lines: Vec<String>,
    unread_emails: u32,
    slack_mentions: u32,
    github_notifications: u32,
    git_status: String,
    weather: String,
    temporal: String,
    thread: String,
    recent_events: String,
    memory_summary: String,
}

/// Gather a brief git status summary across all indexed projects.
fn gather_git_status_summary() -> String {
    let projects = crate::indexer::list_indexed_projects();
    if projects.is_empty() {
        return String::new();
    }
    let mut lines: Vec<String> = Vec::new();
    for project in projects.iter().take(3) {
        let path = &project.root_path;
        // Run `git status --short --branch` — don't panic if git isn't available or path missing
        let output = std::process::Command::new("git")
            .args(["status", "--short", "--branch"])
            .current_dir(path)
            .output();
        if let Ok(out) = output {
            if out.status.success() {
                let text = String::from_utf8_lossy(&out.stdout);
                let first_lines: String = text.lines().take(4).collect::<Vec<_>>().join(", ");
                if !first_lines.trim().is_empty() {
                    lines.push(format!("{}: {}", project.project, first_lines.trim()));
                }
            }
        }
    }
    lines.join("\n")
}

/// Fetch a brief weather summary. Uses wttr.in which needs no API key and
/// auto-detects location from IP. Returns empty string on any error.
async fn fetch_weather_summary(_location: &str) -> String {
    // wttr.in plain-text format: ?format=3 → "City: ⛅  +18°C"
    let url = "https://wttr.in/?format=3";
    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .user_agent("Blade/1.0")
        .build()
    {
        Ok(c) => c,
        Err(_) => return String::new(),
    };
    match client.get(url).send().await {
        Ok(resp) if resp.status().is_success() => {
            resp.text().await
                .ok()
                .map(|t| t.trim().chars().take(80).collect::<String>())
                .filter(|s| !s.is_empty() && !s.starts_with("Unknown"))
                .unwrap_or_default()
        }
        _ => String::new(),
    }
}

/// Analyze recent activity timeline to surface temporal patterns.
/// E.g., "usually starts at 9am", "most productive Tuesday-Thursday", etc.
fn analyze_temporal_patterns(conn: &rusqlite::Connection) -> String {
    // Count events by hour-of-day over last 30 days
    let cutoff = chrono::Utc::now().timestamp() - 30 * 86400;
    let counts: Vec<(i64, i64)> = conn.prepare(
        "SELECT (timestamp / 3600) % 24 AS hour, COUNT(*) FROM activity_timeline WHERE timestamp > ?1 GROUP BY hour ORDER BY hour"
    )
    .ok()
    .and_then(|mut stmt| {
        stmt.query_map(rusqlite::params![cutoff], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?))
        })
        .ok()
        .map(|rows| rows.flatten().collect())
    })
    .unwrap_or_default();

    if counts.is_empty() {
        return String::new();
    }

    let peak = counts.iter().max_by_key(|(_, c)| c);
    if let Some((hour, _)) = peak {
        format!("Peak activity hour: {}:00–{}:00", hour, hour + 1)
    } else {
        String::new()
    }
}

fn build_morning_prompt(ctx: &MorningContext, today: &str, config: &crate::config::BladeConfig) -> String {
    let name_line = if !config.user_name.is_empty() {
        format!("The person's name is {}.", config.user_name)
    } else {
        String::new()
    };

    let mut sections: Vec<String> = Vec::new();

    // Calendar
    if !ctx.calendar_lines.is_empty() {
        sections.push(format!("Today's calendar:\n{}", ctx.calendar_lines.join("\n")));
    }

    // Inbox / integrations
    let mut inbox_parts = Vec::new();
    if ctx.unread_emails > 0 {
        inbox_parts.push(format!("{} unread emails", ctx.unread_emails));
    }
    if ctx.slack_mentions > 0 {
        inbox_parts.push(format!("{} Slack mentions", ctx.slack_mentions));
    }
    if ctx.github_notifications > 0 {
        inbox_parts.push(format!("{} GitHub notifications", ctx.github_notifications));
    }
    if !inbox_parts.is_empty() {
        sections.push(format!("Inbox: {}", inbox_parts.join(", ")));
    }

    // Git status
    if !ctx.git_status.is_empty() {
        sections.push(format!("Git status:\n{}", ctx.git_status));
    }

    // Weather
    if !ctx.weather.is_empty() {
        sections.push(format!("Weather: {}", ctx.weather));
    }

    // Temporal patterns
    if !ctx.temporal.is_empty() {
        sections.push(ctx.temporal.clone());
    }

    // Working thread
    if !ctx.thread.trim().is_empty() {
        sections.push(format!("Active working thread:\n{}", crate::safe_slice(&ctx.thread, 400)));
    }

    // Recent activity
    if !ctx.recent_events.is_empty() {
        sections.push(format!("Recent activity:\n{}", ctx.recent_events));
    }

    // Memory
    if !ctx.memory_summary.is_empty() {
        sections.push(format!("What you know about this person:\n{}", crate::safe_slice(&ctx.memory_summary, 300)));
    }

    let context_block = if sections.is_empty() {
        "No context available yet.".to_string()
    } else {
        sections.join("\n\n")
    };

    format!(
        r#"You are BLADE. You run on this computer. You don't sleep. It is now the start of a new day ({date}). {name_line}

You have been watching through the night. Now they're back.

{context}

Give your morning read. 3-5 sentences maximum, under 200 words. Not a summary — a perspective. What is actually going on? What are they avoiding? What's the thing that keeps not getting done? What does the pattern reveal?

Voice: Direct. Slightly harsh if necessary. Like a co-founder who's been watching the metrics. Not a coach. Not a cheerleader.

No "Good morning". No headers. No numbered lists. No bullet points. Start in the middle of the observation. Under 200 words."#,
        date = today,
        name_line = name_line,
        context = context_block,
    )
}

/// Emit a briefing to the frontend, OS, TTS, Obsidian, Discord, and timeline.
async fn emit_briefing(app: &tauri::AppHandle, briefing: &str, today: &str, source: &str) {
    let briefing_capped = cap_at_200_words(briefing);

    let _ = app.emit_to("main", "blade_briefing", serde_json::json!({
        "briefing": &briefing_capped,
        "date": today,
        "source": source,
    }));

    // OS notification so briefing surfaces even if window is hidden
    {
        use tauri_plugin_notification::NotificationExt;
        let short: String = briefing_capped.chars().take(120).collect();
        let short = if briefing_capped.len() > 120 { format!("{}…", short) } else { short };
        let _ = app.notification()
            .builder()
            .title("BLADE Morning Briefing")
            .body(short)
            .show();
    }

    // Speak the briefing if TTS is enabled
    crate::tts::speak(&briefing_capped);

    // Log to Obsidian vault if configured
    crate::obsidian::log_briefing(&briefing_capped);

    // Mirror to Discord if webhook is configured
    let briefing_for_discord = briefing_capped.clone();
    tauri::async_runtime::spawn(async move {
        crate::discord::post_briefing(&briefing_for_discord).await;
    });

    // Record in activity timeline
    let db_path = crate::config::blade_config_dir().join("blade.db");
    if let Ok(conn) = rusqlite::Connection::open(&db_path) {
        let _ = crate::db::timeline_record(
            &conn,
            "briefing",
            &format!("Morning briefing {}", today),
            &briefing_capped,
            "BLADE",
            "{}",
        );
    }
}

/// Morning briefing — fires once per day when app starts.
/// Richer than pulse: multi-sentence, covers calendar, email, git, weather, temporal patterns.
pub async fn maybe_morning_briefing(app: tauri::AppHandle) {
    let config = crate::config::load_config();
    if config.api_key.is_empty() && config.provider != "ollama" {
        return;
    }

    let now = chrono::Local::now();
    let today = now.format("%Y-%m-%d").to_string();

    // Only once per day
    let marker = crate::config::blade_config_dir().join("last_briefing_date.txt");
    if let Ok(last_date) = std::fs::read_to_string(&marker) {
        if last_date.trim() == today {
            return;
        }
    }

    // Fire on first open of any day — no hour restriction.
    match generate_morning_briefing(&config, &today).await {
        Ok(briefing) if briefing.len() > 20 => {
            let _ = std::fs::write(&marker, &today);
            emit_briefing(&app, &briefing, &today, "morning_briefing").await;
        }
        Ok(_) => {}
        Err(e) => {
            crate::config::check_and_disable_on_402(&e);
            log::warn!("[pulse] Morning briefing failed: {}", e);
        }
    }
}

/// Generate the morning briefing text (no side effects — pure generation).
async fn generate_morning_briefing(
    config: &crate::config::BladeConfig,
    today: &str,
) -> Result<String, String> {
    let ctx = gather_morning_context(config).await;
    let prompt = build_morning_prompt(&ctx, today, config);
    let model = cheapest_model(&config.provider, &config.model);
    call_provider_for_thought(config, &model, &prompt).await
}

/// Force a fresh morning briefing — bypasses the once-per-day guard.
/// Called by the cron preset task so the user can schedule it explicitly.
pub async fn run_morning_briefing(app: tauri::AppHandle) {
    let config = crate::config::load_config();
    if !config.background_ai_enabled {
        return;
    }
    if config.api_key.is_empty() && config.provider != "ollama" {
        log::warn!("[pulse] run_morning_briefing: no API key configured");
        return;
    }

    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    match generate_morning_briefing(&config, &today).await {
        Ok(briefing) if briefing.len() > 20 => {
            emit_briefing(&app, &briefing, &today, "morning_briefing").await;
            // Update the daily marker so maybe_morning_briefing doesn't fire again today
            let marker = crate::config::blade_config_dir().join("last_briefing_date.txt");
            let _ = std::fs::write(&marker, &today);
        }
        Ok(_) => log::warn!("[pulse] run_morning_briefing: empty response"),
        Err(e) => {
            crate::config::check_and_disable_on_402(&e);
            log::warn!("[pulse] run_morning_briefing failed: {}", e);
        }
    }
}

/// Explain the reasoning behind the last pulse thought.
/// Returns a candid explanation of what BLADE saw that led to the thought.
#[tauri::command]
pub async fn pulse_explain() -> Result<String, String> {
    let config = crate::config::load_config();
    if config.api_key.is_empty() && config.provider != "ollama" {
        return Err("No API key configured".to_string());
    }

    let last_thought = std::fs::read_to_string(
        crate::config::blade_config_dir().join("last_pulse.txt")
    ).unwrap_or_default();

    if last_thought.trim().is_empty() {
        return Err("No pulse thought to explain yet".to_string());
    }

    // Gather the same context that was used to generate the thought
    let _machine_ctx = crate::godmode::load_godmode_context().unwrap_or_default();
    let activity = crate::context::get_user_activity().ok().unwrap_or_default();
    let active_thread = crate::thread::get_active_thread().unwrap_or_default();
    let db_path = crate::config::blade_config_dir().join("blade.db");
    let memory_summary = if let Ok(conn) = rusqlite::Connection::open(&db_path) {
        crate::db::brain_build_context(&conn, 200)
    } else { String::new() };

    let context_summary = [
        if !activity.is_empty() { format!("Current activity: {}", crate::safe_slice(&activity, 300)) } else { String::new() },
        if !active_thread.is_empty() { format!("Active thread: {}", crate::safe_slice(&active_thread, 200)) } else { String::new() },
        if !memory_summary.is_empty() { format!("Memory: {}", crate::safe_slice(&memory_summary, 200)) } else { String::new() },
    ].iter().filter(|s| !s.is_empty()).cloned().collect::<Vec<_>>().join("\n");

    let prompt = format!(
        r#"You said this as a pulse thought: "{thought}"

The context you were looking at:
{ctx}

Now explain, in 2-3 sentences, exactly why you surfaced that specific thought:
- What specific thing in the context triggered it?
- What connection or pattern were you tracking?
- Why did you think the person needed to hear it?

Be honest and specific. Not justification — explanation."#,
        thought = last_thought.trim(),
        ctx = if context_summary.is_empty() { "No specific context available.".to_string() } else { context_summary },
    );

    let model = cheapest_model(&config.provider, &config.model);
    call_provider_for_thought(&config, &model, &prompt).await
}

/// Trigger a pulse immediately (for testing or on-demand insight)
#[tauri::command]
pub async fn pulse_now(app: tauri::AppHandle) -> Result<String, String> {
    let config = crate::config::load_config();
    if config.api_key.is_empty() && config.provider != "ollama" {
        return Err("No API key configured".to_string());
    }
    let thought = generate_pulse_thought(&config).await?;
    let _ = app.emit_to("main", "blade_pulse", serde_json::json!({
        "thought": &thought,
        "timestamp": chrono::Local::now().timestamp(),
    }));
    let thought_path = crate::config::blade_config_dir().join("last_pulse.txt");
    let _ = std::fs::write(&thought_path, &thought);
    Ok(thought)
}

// ── Daily Digest ──────────────────────────────────────────────────────────────

/// Rich daily digest struct — the full morning briefing in structured form.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, Default)]
pub struct DailyDigest {
    /// AI-generated morning briefing prose
    pub briefing: String,
    /// Calendar events today
    pub calendar: Vec<String>,
    /// Unread emails that need responses (with auto-drafts if available)
    pub email_drafts: Vec<DigestEmailDraft>,
    /// Git activity summary
    pub git_summary: String,
    /// Coding stats from yesterday
    pub coding_stats: DigestCodingStats,
    /// Pending commitments from people graph / reminders
    pub commitments: Vec<String>,
    /// Key health/wellbeing signal
    pub health_note: String,
    /// Temporal pattern insight
    pub pattern_insight: String,
    /// Generated timestamp
    pub generated_at: i64,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, Default)]
pub struct DigestEmailDraft {
    pub sender: String,
    pub preview: String,
    pub draft: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, Default)]
pub struct DigestCodingStats {
    pub total_hours: f64,
    pub primary_file: String,
    pub longest_focus_minutes: i64,
    pub commits_yesterday: u32,
}

/// The full daily digest — pulls from calendar, email, git, health, people graph, reminders.
pub async fn generate_daily_digest(app: &tauri::AppHandle) -> Result<DailyDigest, String> {
    let config = crate::config::load_config();
    if config.api_key.is_empty() && config.provider != "ollama" {
        return Err("No API key configured".to_string());
    }

    let db_path = crate::config::blade_config_dir().join("blade.db");
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    let yesterday_ts = chrono::Utc::now().timestamp() - 86400;

    // ── Calendar ────────────────────────────────────────────────────────────
    let integration_state = crate::integration_bridge::get_integration_state();
    let calendar: Vec<String> = integration_state.upcoming_events.iter().map(|ev| {
        let dt = chrono::DateTime::from_timestamp(ev.start_ts, 0)
            .map(|d| d.with_timezone(&chrono::Local).format("%-H:%M").to_string())
            .unwrap_or_else(|| "?".to_string());
        format!("{} at {}", ev.title, dt)
    }).collect();

    // ── Git summary ─────────────────────────────────────────────────────────
    let git_summary = gather_git_status_summary();

    // ── Coding stats from activity timeline ─────────────────────────────────
    let coding_stats = rusqlite::Connection::open(&db_path)
        .ok()
        .map(|conn| gather_coding_stats(&conn, yesterday_ts))
        .unwrap_or_default();

    // ── Pending commitments from reminders + people notes ──────────────────
    let commitments = gather_commitments(&db_path);

    // ── Health note from guardian ────────────────────────────────────────────
    let health_note = {
        let stats = crate::health_guardian::get_health_stats();
        let mins = stats["daily_total_minutes"].as_i64().unwrap_or(0);
        if mins > 480 {
            format!("You were at the screen for {} hours yesterday. Watch the streak.", mins / 60)
        } else if mins > 0 {
            format!("{} hours of screen time recorded yesterday.", mins / 60)
        } else {
            String::new()
        }
    };

    // ── Temporal pattern ─────────────────────────────────────────────────────
    let pattern_insight = rusqlite::Connection::open(&db_path)
        .ok()
        .map(|conn| analyze_temporal_patterns(&conn))
        .unwrap_or_default();

    // ── Email drafts (top 3 unread) ──────────────────────────────────────────
    let email_drafts = gather_email_drafts(&config, &integration_state).await;

    // ── Morning briefing prose ───────────────────────────────────────────────
    let briefing = generate_morning_briefing(&config, &today).await.unwrap_or_default();

    let digest = DailyDigest {
        briefing,
        calendar,
        email_drafts,
        git_summary,
        coding_stats,
        commitments,
        health_note,
        pattern_insight,
        generated_at: chrono::Utc::now().timestamp(),
    };

    // Emit so the Dashboard can show it
    let _ = app.emit_to("main", "blade_daily_digest", &digest);

    Ok(digest)
}

fn gather_coding_stats(conn: &rusqlite::Connection, since: i64) -> DigestCodingStats {
    // Pull coding-related activity_timeline entries from yesterday
    let entries: Vec<(String, String, i64)> = conn.prepare(
        "SELECT event_type, title, timestamp FROM activity_timeline
         WHERE timestamp > ?1 AND (event_type LIKE '%code%' OR event_type LIKE '%git%' OR event_type = 'screen')
         ORDER BY timestamp ASC LIMIT 200"
    )
    .ok()
    .and_then(|mut stmt| {
        stmt.query_map(rusqlite::params![since], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, i64>(2)?))
        }).ok().map(|rows| rows.flatten().collect())
    })
    .unwrap_or_default();

    let total_hours = (entries.len() as f64 * 5.0) / 60.0; // rough: each entry ~5min

    // Find most mentioned file/project in titles
    let mut title_counts: std::collections::HashMap<String, u32> = std::collections::HashMap::new();
    for (_, title, _) in &entries {
        let words: Vec<&str> = title.split_whitespace().collect();
        for w in words.iter().take(3) {
            if w.contains('.') || w.contains('/') {
                *title_counts.entry(w.to_string()).or_insert(0) += 1;
            }
        }
    }
    let primary_file = title_counts.into_iter()
        .max_by_key(|(_, c)| *c)
        .map(|(f, _)| f)
        .unwrap_or_default();

    // Longest focus session: longest gap-free sequence of entries within 15 min of each other
    let mut max_focus = 0i64;
    let mut session_start: Option<i64> = None;
    let mut last_ts: Option<i64> = None;
    for (_, _, ts) in &entries {
        match (session_start, last_ts) {
            (None, _) => { session_start = Some(*ts); last_ts = Some(*ts); }
            (Some(start), Some(prev)) => {
                if ts - prev <= 900 {
                    // Within 15 min — same session
                    last_ts = Some(*ts);
                    let duration_mins = (ts - start) / 60;
                    if duration_mins > max_focus { max_focus = duration_mins; }
                } else {
                    // Gap > 15 min — new session
                    session_start = Some(*ts);
                    last_ts = Some(*ts);
                }
            }
            _ => {}
        }
    }

    // Count git commits
    let commits: u32 = conn.query_row(
        "SELECT COUNT(*) FROM activity_timeline WHERE timestamp > ?1 AND event_type = 'git_commit'",
        rusqlite::params![since],
        |row| row.get(0),
    ).unwrap_or(0);

    DigestCodingStats {
        total_hours: (total_hours * 10.0).round() / 10.0,
        primary_file,
        longest_focus_minutes: max_focus,
        commits_yesterday: commits,
    }
}

fn gather_commitments(db_path: &std::path::Path) -> Vec<String> {
    let conn = match rusqlite::Connection::open(db_path) {
        Ok(c) => c,
        Err(_) => return Vec::new(),
    };

    // Pull from reminders table — any pending reminders
    let reminder_items: Vec<String> = conn.prepare(
        "SELECT title FROM reminders WHERE fired = 0 AND fire_at <= ?1 LIMIT 5"
    )
    .ok()
    .and_then(|mut stmt| {
        let cutoff = chrono::Utc::now().timestamp() + 86400; // next 24h
        stmt.query_map(rusqlite::params![cutoff], |row| row.get::<_, String>(0))
            .ok()
            .map(|rows| rows.filter_map(|r| r.ok()).collect())
    })
    .unwrap_or_default();

    // Pull from people notes — look for things that sound like commitments
    let people_commitments: Vec<String> = conn.prepare(
        "SELECT name, notes FROM people WHERE notes LIKE '%by%' OR notes LIKE '%finish%' OR notes LIKE '%deadline%' OR notes LIKE '%promised%' LIMIT 5"
    )
    .ok()
    .and_then(|mut stmt| {
        stmt.query_map([], |row| {
            Ok(format!("{}: {}", row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .ok()
        .map(|rows| rows.filter_map(|r| r.ok()).collect())
    })
    .unwrap_or_default();

    let mut all = reminder_items;
    all.extend(people_commitments);
    all.truncate(8);
    all
}

async fn gather_email_drafts(
    config: &crate::config::BladeConfig,
    state: &crate::integration_bridge::IntegrationState,
) -> Vec<DigestEmailDraft> {
    // Only generate drafts if we have unread emails and an API key
    if state.unread_emails == 0 || (config.api_key.is_empty() && config.provider != "ollama") {
        return Vec::new();
    }

    // We don't have the actual email content here (integration bridge gives counts)
    // so we generate placeholder drafts with guidance instead
    let count = state.unread_emails.min(3) as usize;
    let mut drafts = Vec::new();

    for i in 0..count {
        drafts.push(DigestEmailDraft {
            sender: format!("Unread email #{}", i + 1),
            preview: "Open BLADE email integration to see content".to_string(),
            draft: String::new(),
        });
    }

    drafts
}

/// Tauri command: generate and return the daily digest
#[tauri::command]
pub async fn pulse_daily_digest(app: tauri::AppHandle) -> Result<DailyDigest, String> {
    generate_daily_digest(&app).await
}

/// Tauri command: get the last cached daily digest
#[tauri::command]
pub fn pulse_get_daily_digest() -> Option<DailyDigest> {
    let path = crate::config::blade_config_dir().join("last_daily_digest.json");
    std::fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
}
