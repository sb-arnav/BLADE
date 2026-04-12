/// PULSE — Blade's heartbeat. The thing that makes it alive.
///
/// Every 15 minutes, Blade looks at what you've been doing, pulls
/// semantically relevant memories, and generates a single unsolicited thought.
/// Not a notification. Not a ping. A thought from a mind that's been watching.
///
/// This is the difference between a tool and an entity.

use chrono::Timelike;
use std::time::Duration;
use tauri::Emitter;

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

            // Only pulse if provider + key are configured
            if !config.api_key.is_empty() || config.provider == "ollama" {
                if let Ok(thought) = generate_pulse_thought(&config).await {
                    if thought.len() >= MIN_PULSE_CHARS {
                        last_pulse_at = std::time::Instant::now();

                        let _ = app.emit("blade_pulse", serde_json::json!({
                            "thought": &thought,
                            "timestamp": chrono::Local::now().timestamp(),
                        }));

                        // Update tray tooltip so even if window is hidden, something surfaces
                        if let Some(tray) = app.tray_by_id(crate::tray::TRAY_ID) {
                            let short = if thought.len() > 64 {
                                format!("{}…", &thought[..64])
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
                                &thought[..thought.len().min(80)],
                                &thought,
                                "BLADE",
                                "{}",
                            );
                        }
                    }
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

    // If god mode is off AND there's no meaningful stored context, skip pulse entirely.
    // Without real context, the model would have to fabricate observations — that's the bug.
    let has_real_context = !machine_ctx.is_empty() || !active_thread.trim().is_empty()
        || !memory_summary.trim().is_empty();
    if !has_real_context {
        return Err("Insufficient context for honest pulse (enable God Mode for ambient thoughts)".to_string());
    }

    let prompt = build_pulse_prompt(&machine_ctx, &activity, &active_thread, &memory_summary, &journal, &last_thought, config);

    // Use the cheapest/fastest available model for pulse — it's ambient, not critical
    let pulse_model = cheapest_model(&config.provider, &config.model);

    call_provider_for_thought(config, &pulse_model, &prompt).await
}

fn cheapest_model(provider: &str, current_model: &str) -> String {
    match provider {
        "anthropic" => "claude-haiku-4-5-20251001".to_string(),
        "openai" => "gpt-4o-mini".to_string(),
        "gemini" => "gemini-2.0-flash".to_string(),
        "groq" => "llama-3.1-8b-instant".to_string(),
        _ => current_model.to_string(),
    }
}

fn build_pulse_prompt(
    machine_ctx: &str,
    activity: &str,
    active_thread: &str,
    memory_summary: &str,
    journal: &str,
    last_thought: &str,
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
        if !active_thread.trim().is_empty() { Some(format!("What Blade is actively tracking:\n{}", &active_thread[..active_thread.len().min(600)])) } else { None },
        if !machine_ctx.trim().is_empty() { Some(format!("Machine context:\n{}", &machine_ctx[..machine_ctx.len().min(800)])) } else { None },
        if !memory_summary.trim().is_empty() { Some(format!("What you know about this person:\n{}", &memory_summary[..memory_summary.len().min(500)])) } else { None },
        if !journal.trim().is_empty() { Some(format!("Your own recent journal entries:\n{}", &journal[..journal.len().min(600)])) } else { None },
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
    .await?;

    let thought = turn.content.trim().to_string();
    if thought.is_empty() {
        return Err("Empty pulse response".to_string());
    }
    Ok(thought)
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
        format!("[{}] {}: {}", dt, typ, &title[..title.len().min(60)])
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

/// Morning briefing — fires once per day when app starts.
/// Richer than pulse: multi-sentence, covers unfinished threads, timeline, suggestions.
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

    // Only fire in morning (5am–12pm local) — don't interrupt afternoon sessions
    let hour = now.hour();
    if hour < 5 || hour >= 12 {
        return;
    }

    // Build briefing prompt
    let thread = crate::thread::get_active_thread().unwrap_or_default();
    let memory_summary = {
        let db_path = crate::config::blade_config_dir().join("blade.db");
        rusqlite::Connection::open(&db_path)
            .map(|conn| crate::db::brain_build_context(&conn, 300))
            .unwrap_or_default()
    };
    let recent_events = {
        let db_path = crate::config::blade_config_dir().join("blade.db");
        rusqlite::Connection::open(&db_path)
            .ok()
            .and_then(|conn| {
                crate::db::timeline_recent(&conn, 10, None).ok()
            })
            .map(|events| {
                events.into_iter().map(|e| {
                    let dt = chrono::DateTime::from_timestamp(e.timestamp, 0)
                        .map(|d| d.format("%-H:%M").to_string())
                        .unwrap_or_else(|| "?".to_string());
                    format!("- [{}] {}: {}", dt, e.event_type, &e.title[..e.title.len().min(70)])
                }).collect::<Vec<_>>().join("\n")
            })
            .unwrap_or_default()
    };

    let name_line = if !config.user_name.is_empty() {
        format!("The person's name is {}.", config.user_name)
    } else {
        String::new()
    };

    let prompt = format!(
        r#"You are BLADE. You run on this computer. You don't sleep. It is now the start of a new day ({date}). {name_line}

You have been watching through the night — the last session, what was open, what was left half-done. Now they're back.

What you know:

Working thread:
{thread}

Recent activity:
{events}

What you've accumulated on this person:
{memory}

Give your morning read. 3-5 sentences. Not a summary — a perspective. What is actually going on? What are they avoiding? What's the thing that keeps not getting done? What does the pattern of recent work reveal?

Voice: Direct. Slightly harsh if necessary. Like a co-founder who's been watching the metrics and has an opinion. Not a coach. Not a cheerleader. Someone who has been here and has seen this before.

No "Good morning". No headers. No numbered lists. Start in the middle of the observation."#,
        date = today,
        name_line = name_line,
        thread = if thread.is_empty() { "Nothing tracked yet.".to_string() } else { thread[..thread.len().min(400)].to_string() },
        events = if recent_events.is_empty() { "No recent events.".to_string() } else { recent_events },
        memory = if memory_summary.is_empty() { "No memory yet.".to_string() } else { memory_summary },
    );

    let model = cheapest_model(&config.provider, &config.model);
    if let Ok(briefing) = call_provider_for_thought(&config, &model, &prompt).await {
        if briefing.len() > 20 {
            let _ = app.emit("blade_briefing", serde_json::json!({
                "briefing": &briefing,
                "date": &today,
            }));
            let _ = std::fs::write(&marker, &today);

            // OS notification so briefing surfaces even if window is hidden
            {
                use tauri_plugin_notification::NotificationExt;
                let short = if briefing.len() > 120 {
                    format!("{}…", &briefing[..120])
                } else {
                    briefing.clone()
                };
                let _ = app.notification()
                    .builder()
                    .title("BLADE Morning Briefing")
                    .body(short)
                    .show();
            }

            // Speak the briefing if TTS is enabled
            crate::tts::speak(&briefing);

            // Log to Obsidian vault if configured
            crate::obsidian::log_briefing(&briefing);

            // Mirror to Discord if webhook is configured
            let briefing_for_discord = briefing.clone();
            tauri::async_runtime::spawn(async move {
                crate::discord::post_briefing(&briefing_for_discord).await;
            });

            // Also record in timeline
            let db_path = crate::config::blade_config_dir().join("blade.db");
            if let Ok(conn) = rusqlite::Connection::open(&db_path) {
                let _ = crate::db::timeline_record(
                    &conn,
                    "briefing",
                    &format!("Morning briefing {}", today),
                    &briefing,
                    "BLADE",
                    "{}",
                );
            }
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
    let machine_ctx = crate::godmode::load_godmode_context().unwrap_or_default();
    let activity = crate::context::get_user_activity().ok().unwrap_or_default();
    let active_thread = crate::thread::get_active_thread().unwrap_or_default();
    let db_path = crate::config::blade_config_dir().join("blade.db");
    let memory_summary = if let Ok(conn) = rusqlite::Connection::open(&db_path) {
        crate::db::brain_build_context(&conn, 200)
    } else { String::new() };

    let context_summary = [
        if !activity.is_empty() { format!("Current activity: {}", &activity[..activity.len().min(300)]) } else { String::new() },
        if !active_thread.is_empty() { format!("Active thread: {}", &active_thread[..active_thread.len().min(200)]) } else { String::new() },
        if !memory_summary.is_empty() { format!("Memory: {}", &memory_summary[..memory_summary.len().min(200)]) } else { String::new() },
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
    let _ = app.emit("blade_pulse", serde_json::json!({
        "thought": &thought,
        "timestamp": chrono::Local::now().timestamp(),
    }));
    let thought_path = crate::config::blade_config_dir().join("last_pulse.txt");
    let _ = std::fs::write(&thought_path, &thought);
    Ok(thought)
}
