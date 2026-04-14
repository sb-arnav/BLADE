/// BLADE Temporal Intelligence — "What was I doing N hours ago?"
///
/// Queries the screen timeline, god-mode snapshots, and conversation history
/// to answer temporal questions and prepare contextual briefs.
///
/// Commands:
///   blade_what_was_i_doing  — reconstruct activity N hours back
///   blade_daily_standup     — summarize yesterday for standup
///   blade_meeting_prep      — compile a brief for a topic/meeting
///   detect_patterns         — find recurring temporal patterns in activity data

use chrono::{Datelike, Timelike};
use rusqlite::params;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ── DB helpers ────────────────────────────────────────────────────────────────

fn db_path() -> std::path::PathBuf {
    crate::config::blade_config_dir().join("blade.db")
}

fn open_db() -> Option<rusqlite::Connection> {
    rusqlite::Connection::open(db_path()).ok()
}

// ── Types ─────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TemporalPattern {
    pub pattern_type: String, // "work_start" | "lunch" | "deploy" | "focus_block" etc.
    pub description: String,  // human-readable e.g. "You usually start coding around 10am"
    pub confidence: f64,      // 0..1
    pub data_points: u32,
}

// ── Initialization ────────────────────────────────────────────────────────────

/// Ensure any temporal_intel-specific tables exist. Called at startup.
pub fn ensure_tables() {
    // temporal_intel reads from existing tables (screen_timeline, messages, knowledge, godmode_snapshots).
    // No dedicated tables needed at this time.
}

// ── Core queries ──────────────────────────────────────────────────────────────

/// Gather timeline entries and conversation messages from around N hours ago.
/// Returns the raw context text to feed into the LLM.
fn gather_context_at(hours_ago: u32) -> String {
    let now = chrono::Utc::now().timestamp();
    let target_ts = now - (hours_ago as i64 * 3600);
    let window_start = target_ts - 1800; // ± 30 min window
    let window_end = target_ts + 1800;

    let mut parts: Vec<String> = Vec::new();

    // --- Screen timeline entries ---
    if let Some(conn) = open_db() {
        let mut stmt = conn
            .prepare(
                "SELECT timestamp, window_title, app_name, description
                 FROM screen_timeline
                 WHERE timestamp >= ?1 AND timestamp <= ?2
                 ORDER BY timestamp ASC
                 LIMIT 20",
            )
            .ok();

        if let Some(ref mut s) = stmt {
            let rows = s.query_map(params![window_start, window_end], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                ))
            });

            if let Ok(rows) = rows {
                let entries: Vec<String> = rows
                    .flatten()
                    .map(|(ts, title, app, desc)| {
                        let dt = chrono::DateTime::from_timestamp(ts, 0)
                            .map(|d| d.with_timezone(&chrono::Local).format("%H:%M").to_string())
                            .unwrap_or_else(|| "??:??".to_string());
                        format!("[{}] {} ({}) — {}", dt, title, app, desc)
                    })
                    .collect();

                if !entries.is_empty() {
                    parts.push(format!(
                        "Screen activity:\n{}",
                        entries.join("\n")
                    ));
                }
            }
        }
    }

    // --- Conversation messages from that window ---
    if let Some(conn) = open_db() {
        let mut stmt = conn
            .prepare(
                "SELECT role, content, timestamp
                 FROM messages
                 WHERE timestamp >= ?1 AND timestamp <= ?2
                 ORDER BY timestamp ASC
                 LIMIT 15",
            )
            .ok();

        if let Some(ref mut s) = stmt {
            let rows = s.query_map(params![window_start * 1000, window_end * 1000], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)?,
                ))
            });

            if let Ok(rows) = rows {
                let entries: Vec<String> = rows
                    .flatten()
                    .map(|(role, content, _ts)| {
                        let snippet = &content[..content.len().min(200)];
                        format!("[{}]: {}…", role, snippet)
                    })
                    .collect();

                if !entries.is_empty() {
                    parts.push(format!(
                        "Conversations:\n{}",
                        entries.join("\n")
                    ));
                }
            }
        }
    }

    // --- God mode / godmode snapshots ---
    if let Some(conn) = open_db() {
        let mut stmt = conn
            .prepare(
                "SELECT timestamp, summary
                 FROM godmode_snapshots
                 WHERE timestamp >= ?1 AND timestamp <= ?2
                 ORDER BY timestamp ASC
                 LIMIT 5",
            )
            .ok();

        if let Some(ref mut s) = stmt {
            let rows = s.query_map(params![window_start, window_end], |row| {
                Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
            });

            if let Ok(rows) = rows {
                let entries: Vec<String> = rows
                    .flatten()
                    .map(|(ts, summary)| {
                        let dt = chrono::DateTime::from_timestamp(ts, 0)
                            .map(|d| d.with_timezone(&chrono::Local).format("%H:%M").to_string())
                            .unwrap_or_else(|| "??:??".to_string());
                        format!("[{}] {}", dt, summary)
                    })
                    .collect();

                if !entries.is_empty() {
                    parts.push(format!("God mode snapshots:\n{}", entries.join("\n")));
                }
            }
        }
    }

    parts.join("\n\n")
}

/// Gather context for the last 24 hours for standup.
fn gather_yesterday_context() -> String {
    let now = chrono::Utc::now().timestamp();
    let yesterday_start = now - 86400;

    let mut parts: Vec<String> = Vec::new();

    // Git commits made since yesterday
    if let Ok(output) = std::process::Command::new("git")
        .args([
            "log",
            "--oneline",
            "--all",
            "--since=24 hours ago",
            "--format=%h %s (%ar)",
        ])
        .output()
    {
        let commits = String::from_utf8_lossy(&output.stdout).to_string();
        if !commits.trim().is_empty() {
            parts.push(format!("Git commits (last 24h):\n{}", commits.trim()));
        }
    }

    // Files changed in git since yesterday
    if let Ok(output) = std::process::Command::new("git")
        .args(["diff", "--name-only", "HEAD@{24 hours ago}", "HEAD"])
        .output()
    {
        let files = String::from_utf8_lossy(&output.stdout).to_string();
        if !files.trim().is_empty() {
            let file_list: Vec<&str> = files.lines().take(20).collect();
            parts.push(format!("Files changed:\n{}", file_list.join("\n")));
        }
    }

    // Screen timeline summary for yesterday
    if let Some(conn) = open_db() {
        let mut stmt = conn
            .prepare(
                "SELECT app_name, COUNT(*) as cnt
                 FROM screen_timeline
                 WHERE timestamp >= ?1
                 GROUP BY app_name
                 ORDER BY cnt DESC
                 LIMIT 10",
            )
            .ok();

        if let Some(ref mut s) = stmt {
            let rows = s.query_map(params![yesterday_start], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
            });

            if let Ok(rows) = rows {
                let entries: Vec<String> = rows
                    .flatten()
                    .map(|(app, cnt)| format!("  {} ({} snapshots)", app, cnt))
                    .collect();

                if !entries.is_empty() {
                    parts.push(format!("Apps used:\n{}", entries.join("\n")));
                }
            }
        }
    }

    // Conversations from yesterday
    if let Some(conn) = open_db() {
        let mut stmt = conn
            .prepare(
                "SELECT content FROM messages
                 WHERE timestamp >= ?1 AND role = 'user'
                 ORDER BY timestamp ASC
                 LIMIT 20",
            )
            .ok();

        if let Some(ref mut s) = stmt {
            let rows = s.query_map(params![yesterday_start * 1000], |row| {
                row.get::<_, String>(0)
            });

            if let Ok(rows) = rows {
                let entries: Vec<String> = rows
                    .flatten()
                    .map(|c| {
                        let snippet = &c[..c.len().min(150)];
                        format!("  - {}", snippet)
                    })
                    .collect();

                if !entries.is_empty() {
                    parts.push(format!(
                        "Things I asked BLADE about:\n{}",
                        entries.join("\n")
                    ));
                }
            }
        }
    }

    parts.join("\n\n")
}

// ── Pattern detection ─────────────────────────────────────────────────────────

/// Analyze timeline data to find temporal patterns (work start time, lunch, etc.)
pub fn detect_patterns() -> Vec<TemporalPattern> {
    let conn = match open_db() {
        Some(c) => c,
        None => return vec![],
    };

    // Collect hour-of-day for all timeline entries
    let mut stmt = match conn.prepare(
        "SELECT timestamp FROM screen_timeline ORDER BY timestamp ASC",
    ) {
        Ok(s) => s,
        Err(_) => return vec![],
    };

    let timestamps: Vec<i64> = stmt
        .query_map([], |row| row.get(0))
        .ok()
        .map(|rows| rows.flatten().collect())
        .unwrap_or_default();

    if timestamps.len() < 20 {
        return vec![];
    }

    // Group by day → find first active hour per day
    let mut day_first_hour: HashMap<String, u32> = HashMap::new();
    let mut day_last_hour: HashMap<String, u32> = HashMap::new();
    let mut hour_counts: [u32; 24] = [0; 24];

    for ts in &timestamps {
        let dt = chrono::DateTime::from_timestamp(*ts, 0)
            .map(|d| d.with_timezone(&chrono::Local))
            .unwrap_or_else(chrono::Local::now);
        let day = dt.format("%Y-%m-%d").to_string();
        let hour = dt.hour();
        hour_counts[hour as usize] += 1;

        let entry = day_first_hour.entry(day.clone()).or_insert(hour);
        if hour < *entry {
            *entry = hour;
        }
        let last_entry = day_last_hour.entry(day).or_insert(hour);
        if hour > *last_entry {
            *last_entry = hour;
        }
    }

    let mut patterns: Vec<TemporalPattern> = Vec::new();

    // --- Work start time ---
    if day_first_hour.len() >= 5 {
        let first_hours: Vec<u32> = day_first_hour.values().copied().collect();
        let avg_start = first_hours.iter().sum::<u32>() as f64 / first_hours.len() as f64;
        let round_hour = avg_start.round() as u32;
        let confidence = calculate_hour_consistency(&first_hours, round_hour);

        if confidence > 0.4 {
            patterns.push(TemporalPattern {
                pattern_type: "work_start".to_string(),
                description: format!(
                    "You usually start working around {}:00{}",
                    if round_hour > 12 { round_hour - 12 } else { round_hour },
                    if round_hour >= 12 { "pm" } else { "am" }
                ),
                confidence,
                data_points: first_hours.len() as u32,
            });
        }
    }

    // --- Wrap-up time ---
    if day_last_hour.len() >= 5 {
        let last_hours: Vec<u32> = day_last_hour.values().copied().collect();
        let avg_end = last_hours.iter().sum::<u32>() as f64 / last_hours.len() as f64;
        let round_hour = avg_end.round() as u32;
        let confidence = calculate_hour_consistency(&last_hours, round_hour);

        if confidence > 0.4 {
            patterns.push(TemporalPattern {
                pattern_type: "work_end".to_string(),
                description: format!(
                    "You typically stop working around {}:00{}",
                    if round_hour > 12 { round_hour - 12 } else { round_hour },
                    if round_hour >= 12 { "pm" } else { "am" }
                ),
                confidence,
                data_points: last_hours.len() as u32,
            });
        }
    }

    // --- Peak focus hours (top 3 hours with most activity) ---
    let mut indexed_counts: Vec<(usize, u32)> = hour_counts.iter().copied().enumerate().collect();
    indexed_counts.sort_by(|a, b| b.1.cmp(&a.1));
    let peak_hours: Vec<u32> = indexed_counts.iter().take(3).map(|(h, _)| *h as u32).collect();
    if !peak_hours.is_empty() && indexed_counts[0].1 > 10 {
        let total: u32 = hour_counts.iter().sum();
        let peak_total: u32 = peak_hours.iter().map(|&h| hour_counts[h as usize]).sum();
        let confidence = peak_total as f64 / total as f64;
        let hour_strs: Vec<String> = peak_hours
            .iter()
            .map(|&h| {
                format!(
                    "{}{}",
                    if h > 12 { h - 12 } else { h },
                    if h >= 12 { "pm" } else { "am" }
                )
            })
            .collect();
        patterns.push(TemporalPattern {
            pattern_type: "peak_focus".to_string(),
            description: format!(
                "Your most active hours are {}",
                hour_strs.join(", ")
            ),
            confidence,
            data_points: total,
        });
    }

    // --- Lunch break (low activity around 12-14) ---
    let midday_activity: u32 = hour_counts[12] + hour_counts[13] + hour_counts[14];
    let morning_activity: u32 = hour_counts[9] + hour_counts[10] + hour_counts[11];
    if morning_activity > 0 && midday_activity < morning_activity / 2 {
        patterns.push(TemporalPattern {
            pattern_type: "lunch_break".to_string(),
            description: "You typically take lunch around 1pm".to_string(),
            confidence: 0.7,
            data_points: midday_activity,
        });
    }

    // --- Weekend vs weekday pattern ---
    let weekday_count = timestamps
        .iter()
        .filter(|&&ts| {
            chrono::DateTime::from_timestamp(ts, 0)
                .map(|d| {
                    let wd = d.with_timezone(&chrono::Local).weekday();
                    matches!(
                        wd,
                        chrono::Weekday::Mon
                            | chrono::Weekday::Tue
                            | chrono::Weekday::Wed
                            | chrono::Weekday::Thu
                            | chrono::Weekday::Fri
                    )
                })
                .unwrap_or(false)
        })
        .count();
    let total_count = timestamps.len();
    if total_count > 50 {
        let weekday_fraction = weekday_count as f64 / total_count as f64;
        if weekday_fraction > 0.8 {
            patterns.push(TemporalPattern {
                pattern_type: "weekday_focus".to_string(),
                description: "You work primarily on weekdays".to_string(),
                confidence: weekday_fraction,
                data_points: total_count as u32,
            });
        } else if weekday_fraction < 0.6 {
            patterns.push(TemporalPattern {
                pattern_type: "weekend_worker".to_string(),
                description: "You frequently work on weekends".to_string(),
                confidence: 1.0 - weekday_fraction,
                data_points: total_count as u32,
            });
        }
    }

    patterns
}

/// Calculate what fraction of hours fall within ±1 of the target hour.
fn calculate_hour_consistency(hours: &[u32], target: u32) -> f64 {
    if hours.is_empty() {
        return 0.0;
    }
    let close = hours
        .iter()
        .filter(|&&h| (h as i32 - target as i32).abs() <= 1)
        .count();
    close as f64 / hours.len() as f64
}

// ── LLM-powered functions ─────────────────────────────────────────────────────

/// Reconstruct what the user was doing N hours ago.
pub async fn what_was_i_doing(hours_ago: u32) -> Result<String, String> {
    let context = gather_context_at(hours_ago);

    if context.is_empty() {
        return Ok(format!(
            "No activity data found for {} hour{} ago. Either the screen timeline was not running at that time, or no conversations were logged.",
            hours_ago,
            if hours_ago == 1 { "" } else { "s" }
        ));
    }

    let target_time = chrono::Local::now() - chrono::Duration::hours(hours_ago as i64);
    let time_str = target_time.format("%I:%M %p on %A, %B %d").to_string();

    let prompt = format!(
        "You are BLADE, the user's AI. Based on the following activity data from around {}, \
         give a clear, factual 2-4 sentence summary of what the user was working on at that time. \
         Be specific — mention apps, files, topics, or tasks visible in the data.\n\n\
         Activity data:\n{}\n\n\
         Respond in second person (\"You were...\"). Keep it brief and direct.",
        time_str, context
    );

    llm_call(prompt).await
}

/// Generate a daily standup summary: what happened since yesterday.
pub async fn daily_standup_prep() -> Result<String, String> {
    let context = gather_yesterday_context();

    let today = chrono::Local::now().format("%A, %B %d").to_string();

    let prompt = format!(
        "You are BLADE helping prepare a daily standup for {}. \
         Based on the following activity from the last 24 hours, generate a concise standup summary with three sections:\n\
         - Yesterday (what was accomplished)\n\
         - Today (logical next steps based on what was in progress)\n\
         - Blockers (any visible errors, stuck points, or things that might need attention)\n\n\
         Activity data:\n{}\n\n\
         Keep it concise and professional — 3-7 bullet points total. \
         If the data is sparse, make reasonable inferences and flag uncertainty.",
        today, context
    );

    llm_call(prompt).await
}

/// Compile a meeting brief by searching memory, conversations, and files for a topic.
pub async fn meeting_prep(topic: String) -> Result<String, String> {
    // Search conversations for context
    let mut context_parts: Vec<String> = Vec::new();

    if let Some(conn) = open_db() {
        // Search messages for the topic
        let search_pattern = format!("%{}%", topic.to_lowercase());
        let mut stmt = conn
            .prepare(
                "SELECT role, content, timestamp
                 FROM messages
                 WHERE LOWER(content) LIKE ?1
                 ORDER BY timestamp DESC
                 LIMIT 10",
            )
            .ok();

        if let Some(ref mut s) = stmt {
            let rows = s.query_map(params![search_pattern], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)?,
                ))
            });

            if let Ok(rows) = rows {
                let entries: Vec<String> = rows
                    .flatten()
                    .map(|(role, content, ts)| {
                        let dt = chrono::DateTime::from_timestamp(ts / 1000, 0)
                            .map(|d| d.with_timezone(&chrono::Local).format("%b %d").to_string())
                            .unwrap_or_else(|| "unknown date".to_string());
                        let snippet = &content[..content.len().min(300)];
                        format!("[{} - {}]: {}", role, dt, snippet)
                    })
                    .collect();

                if !entries.is_empty() {
                    context_parts.push(format!(
                        "Past conversations about '{}':\n{}",
                        topic,
                        entries.join("\n---\n")
                    ));
                }
            }
        }

        // Search knowledge base
        let mut stmt2 = conn
            .prepare(
                "SELECT title, content FROM knowledge
                 WHERE LOWER(title) LIKE ?1 OR LOWER(content) LIKE ?1
                 ORDER BY updated_at DESC
                 LIMIT 5",
            )
            .ok();

        if let Some(ref mut s2) = stmt2 {
            let rows = s2.query_map(params![search_pattern], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            });

            if let Ok(rows) = rows {
                let entries: Vec<String> = rows
                    .flatten()
                    .map(|(title, content)| {
                        let snippet = &content[..content.len().min(400)];
                        format!("**{}**: {}", title, snippet)
                    })
                    .collect();

                if !entries.is_empty() {
                    context_parts.push(format!(
                        "Knowledge base entries:\n{}",
                        entries.join("\n---\n")
                    ));
                }
            }
        }
    }

    // Also search screen timeline for recent topic mentions
    if let Some(conn) = open_db() {
        let search_pattern = format!("%{}%", topic.to_lowercase());
        let mut stmt = conn
            .prepare(
                "SELECT timestamp, window_title, description
                 FROM screen_timeline
                 WHERE LOWER(description) LIKE ?1 OR LOWER(window_title) LIKE ?1
                 ORDER BY timestamp DESC
                 LIMIT 8",
            )
            .ok();

        if let Some(ref mut s) = stmt {
            let rows = s.query_map(params![search_pattern], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            });

            if let Ok(rows) = rows {
                let entries: Vec<String> = rows
                    .flatten()
                    .map(|(ts, title, desc)| {
                        let dt = chrono::DateTime::from_timestamp(ts, 0)
                            .map(|d| d.with_timezone(&chrono::Local).format("%b %d %H:%M").to_string())
                            .unwrap_or_else(|| "unknown".to_string());
                        format!("[{}] {} — {}", dt, title, desc)
                    })
                    .collect();

                if !entries.is_empty() {
                    context_parts.push(format!(
                        "Screen activity mentioning topic:\n{}",
                        entries.join("\n")
                    ));
                }
            }
        }
    }

    if context_parts.is_empty() {
        context_parts.push(format!(
            "No prior context found for '{}' in BLADE's memory.",
            topic
        ));
    }

    let combined_context = context_parts.join("\n\n");

    let prompt = format!(
        "You are BLADE helping prepare for a meeting or discussion about: \"{}\"\n\n\
         Based on the following context from memory, conversations, and recent activity:\n\n\
         {}\n\n\
         Generate a concise meeting brief with these sections:\n\
         ## Context\n(What BLADE knows about this topic from memory)\n\
         ## Key Points\n(Most relevant facts, decisions, or open questions)\n\
         ## Talking Points\n(3-5 points the user should be ready to discuss)\n\
         ## Action Items\n(Any known open tasks related to this topic)\n\n\
         Be concise and actionable. If context is sparse, say so and work with what's available.",
        topic, combined_context
    );

    llm_call(prompt).await
}

/// Make a cheap LLM call using the configured provider.
async fn llm_call(prompt: String) -> Result<String, String> {
    let config = crate::config::load_config();
    if config.api_key.is_empty() {
        return Err("No API key configured. Please set up a provider in BLADE settings.".to_string());
    }

    let (provider, api_key, model) =
        crate::config::resolve_provider_for_task(&config, &crate::router::TaskType::Complex);

    let messages = vec![crate::providers::ConversationMessage::User(prompt)];
    match crate::providers::complete_turn(&provider, &api_key, &model, &messages, &[], None).await {
        Ok(t) => Ok(t.content),
        Err(e) => Err(format!("LLM call failed: {e}")),
    }
}

// ── Tauri Commands ────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn temporal_what_was_i_doing(hours_ago: u32) -> Result<String, String> {
    what_was_i_doing(hours_ago).await
}

#[tauri::command]
pub async fn temporal_daily_standup() -> Result<String, String> {
    daily_standup_prep().await
}

#[tauri::command]
pub fn temporal_detect_patterns() -> Vec<TemporalPattern> {
    detect_patterns()
}

#[tauri::command]
pub async fn temporal_meeting_prep(topic: String) -> Result<String, String> {
    meeting_prep(topic).await
}

// ── Tool definitions for LLM use ─────────────────────────────────────────────

/// Return tool definitions so the LLM can call temporal intelligence functions.
pub fn get_tool_definitions() -> Vec<serde_json::Value> {
    vec![
        serde_json::json!({
            "name": "blade_what_was_i_doing",
            "description": "Reconstruct what the user was doing N hours ago by querying the screen timeline, god mode snapshots, and conversation history.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "hours_ago": {
                        "type": "integer",
                        "description": "How many hours back to look (e.g. 2 for 2 hours ago)",
                        "minimum": 0,
                        "maximum": 168
                    }
                },
                "required": ["hours_ago"]
            }
        }),
        serde_json::json!({
            "name": "blade_daily_standup",
            "description": "Summarize what happened in the last 24 hours: git commits, files changed, apps used, conversations with BLADE. Returns a formatted standup brief.",
            "input_schema": {
                "type": "object",
                "properties": {}
            }
        }),
        serde_json::json!({
            "name": "blade_meeting_prep",
            "description": "Search BLADE's memory, conversation history, and screen timeline for context related to a topic. Returns a structured meeting brief.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "topic": {
                        "type": "string",
                        "description": "The meeting topic, project name, or person to research"
                    }
                },
                "required": ["topic"]
            }
        }),
    ]
}
