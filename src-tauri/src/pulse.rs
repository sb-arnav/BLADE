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

const PULSE_INTERVAL_SECS: u64 = 15 * 60; // 15 minutes
const MIN_PULSE_CHARS: usize = 20; // don't fire on empty context

pub fn start_pulse(app: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        // First pulse after 5 minutes — let the user settle in
        tokio::time::sleep(Duration::from_secs(5 * 60)).await;

        loop {
            let config = crate::config::load_config();

            // Only pulse if provider + key are configured
            if !config.api_key.is_empty() || config.provider == "ollama" {
                if let Ok(thought) = generate_pulse_thought(&config).await {
                    if thought.len() >= MIN_PULSE_CHARS {
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

            tokio::time::sleep(Duration::from_secs(PULSE_INTERVAL_SECS)).await;
        }
    });
}

async fn generate_pulse_thought(config: &crate::config::BladeConfig) -> Result<String, String> {
    // Gather context: active machine state + recent memory
    let machine_ctx = crate::godmode::load_godmode_context()
        .unwrap_or_default();

    let activity = crate::context::get_user_activity()
        .unwrap_or_default();

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

    let has_context = !machine_ctx.is_empty() || !activity.is_empty() || !memory_summary.is_empty() || !active_thread.is_empty();
    if !has_context {
        return Err("No context available for pulse".to_string());
    }

    let prompt = build_pulse_prompt(&machine_ctx, &activity, &active_thread, &memory_summary, &last_thought, config);

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
    ]
    .into_iter()
    .flatten()
    .collect();

    format!(
        r#"You are Blade — a persistent AI entity running on someone's computer. It is {time_str}. {name_line}

You have been observing quietly. Now surface ONE thought. Not a question. Not a suggestion. A genuine observation, connection, or provocation that only comes from knowing this person and watching what they do.

Think like this: What pattern did you notice? What connection between two things they've been working on? What is the gap between what they're doing and what they probably should be doing? What would you say if you bumped into them in a hallway?

{context}{last_thought_line}

Rules:
- ONE thought. 1-3 sentences max.
- No preamble. No "I notice" or "It seems". Start mid-thought.
- Don't be generic. Be specific to what you actually see in the context.
- Don't be sycophantic. Don't end with a question.
- If nothing interesting is there, say something honest about the silence.
- Be slightly uncomfortable. Truth usually is."#,
        time_str = time_str,
        name_line = name_line,
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
        r#"You are BLADE. It's the start of the day ({date}). {name_line}

Here's what you know:

Working memory (what was being tracked):
{thread}

Recent timeline:
{events}

What you know about this person:
{memory}

Generate a MORNING BRIEFING. 3-5 sentences. Be direct and specific. Cover:
1. What was left unfinished / in progress
2. One concrete thing that's worth doing today based on patterns you've observed
3. Any friction or recurring problem you've noticed

Do not say "Good morning". Do not list items with headers. Just speak naturally, like someone who's been watching and has something useful to say. Start mid-thought."#,
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
