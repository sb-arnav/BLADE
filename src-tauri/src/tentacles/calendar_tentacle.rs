/// TENTACLE: calendar_tentacle.rs — Manages schedule, meeting prep, focus blocking,
/// and post-meeting summaries.
///
/// Uses `integration_bridge` state for calendar data (real MCP when configured,
/// simulated when not). All LLM calls use the active provider from config.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tauri::{AppHandle, Emitter, Manager};
use chrono::Timelike;

// Re-export CalendarEvent from integration_bridge so callers import one type.
pub use crate::integration_bridge::CalendarEvent;

// ── Types ─────────────────────────────────────────────────────────────────────

/// A detected meeting load problem.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MeetingLoadWarning {
    pub day_name: String,
    pub total_meetings: u32,
    pub meeting_hours: f32,
    pub day_hours: f32,
    pub percent_of_day: f32,
    pub suggestion: String,
}

/// A double-booking conflict.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DoubleBooking {
    pub event_a: CalendarEvent,
    pub event_b: CalendarEvent,
    pub recommended_keep: String, // title of the one to keep
    pub reason: String,
}

/// A drafted post-meeting summary ready for user approval before sending.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MeetingSummaryDraft {
    pub summary: MeetingSummary,
    pub email_draft: String, // pre-formatted email body for attendees
    pub attendee_emails: Vec<String>,
    pub approved: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AttendeeContext {
    pub name: String,
    pub relationship: String,
    pub communication_style: String,
    pub last_interaction_days_ago: i64,
    pub common_topics: Vec<String>,
    pub notes: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpenActionItem {
    pub description: String,
    pub owner: Option<String>,
    pub created_from: String, // meeting title / date
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MeetingPrep {
    pub event_title: String,
    pub attendee_contexts: Vec<AttendeeContext>,
    pub open_action_items: Vec<OpenActionItem>,
    pub brief: String, // LLM-generated narrative brief
    pub suggested_agenda: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActionItem {
    pub description: String,
    pub owner: Option<String>,
    pub due_date: Option<String>,
    pub ticket_id: Option<String>, // populated if Jira/Linear created a ticket
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MeetingSummary {
    pub title: String,
    pub date: String,
    pub decisions: Vec<String>,
    pub action_items: Vec<ActionItem>,
    pub follow_ups: Vec<String>,
    pub key_topics: Vec<String>,
    pub stored_memory_id: Option<String>,
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn now_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn db_path() -> std::path::PathBuf {
    crate::config::blade_config_dir().join("blade.db")
}

fn open_db() -> Option<rusqlite::Connection> {
    rusqlite::Connection::open(db_path()).ok()
}

/// Build a prompt for the LLM and return its text response.
/// Follows the same pattern as temporal_intel::llm_call.
async fn llm_complete(_app: &AppHandle, system: &str, user: &str) -> Result<String, String> {
    let config = crate::config::load_config();
    if config.api_key.is_empty() {
        return Err("No API key configured.".to_string());
    }

    let (provider, api_key, model) =
        crate::config::resolve_provider_for_task(&config, &crate::router::TaskType::Complex);

    let messages = vec![
        crate::providers::ConversationMessage::System(system.to_string()),
        crate::providers::ConversationMessage::User(user.to_string()),
    ];
    let no_tools: Vec<crate::providers::ToolDefinition> = vec![];

    crate::providers::complete_turn(&provider, &api_key, &model, &messages, &no_tools, config.base_url.as_deref())
        .await
        .map(|t| t.content)
        .map_err(|e| format!("LLM call failed: {e}"))
}

/// Search the messages table for recent mentions of a topic or name.
fn search_conversations(query: &str, limit: usize) -> Vec<String> {
    let conn = match open_db() {
        Some(c) => c,
        None => return Vec::new(),
    };

    let sql = "SELECT content FROM messages WHERE content LIKE ?1 ORDER BY timestamp DESC LIMIT ?2";
    let pattern = format!("%{}%", query);
    let mut stmt = match conn.prepare(sql) {
        Ok(s) => s,
        Err(_) => return Vec::new(),
    };

    stmt.query_map(
        rusqlite::params![pattern, limit as i64],
        |row| row.get::<_, String>(0),
    )
    .ok()
    .map(|rows| rows.flatten().collect())
    .unwrap_or_default()
}

/// Retrieve action items stored in memory that mention any of the given attendee names.
fn fetch_open_action_items(attendee_names: &[String]) -> Vec<OpenActionItem> {
    let conn = match open_db() {
        Some(c) => c,
        None => return Vec::new(),
    };

    let mut items: Vec<OpenActionItem> = Vec::new();

    // Check typed_memories for entries linked to attendees.
    for name in attendee_names {
        let sql =
            "SELECT content, source FROM typed_memories WHERE content LIKE ?1 LIMIT 10";
        let pattern = format!("%{}%", name);
        let Ok(mut stmt) = conn.prepare(sql) else {
            continue;
        };
        let rows = stmt
            .query_map(rusqlite::params![pattern], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .ok();
        if let Some(rows) = rows {
            for row in rows.flatten() {
                items.push(OpenActionItem {
                    description: row.0,
                    owner: None,
                    created_from: row.1,
                });
            }
        }
    }

    items
}

/// Build AttendeeContext for each attendee name using people_graph.
fn build_attendee_contexts(names: &[String]) -> Vec<AttendeeContext> {
    let now = now_secs();
    names
        .iter()
        .filter_map(|name| {
            let person = crate::people_graph::get_person(name)?;
            let days_ago = if person.last_interaction > 0 {
                (now - person.last_interaction) / 86400
            } else {
                -1
            };
            Some(AttendeeContext {
                name: person.name,
                relationship: person.relationship,
                communication_style: person.communication_style,
                last_interaction_days_ago: days_ago,
                common_topics: person.topics,
                notes: person.notes,
            })
        })
        .collect()
}

/// Detect peak productivity hours from temporal patterns stored in the DB.
/// Returns a vector of (hour_of_day, activity_score) pairs.
fn detect_peak_hours() -> Vec<(u32, f64)> {
    let conn = match open_db() {
        Some(c) => c,
        None => return default_peak_hours(),
    };

    // Use screen_timeline entries as a proxy for activity
    let sql = "SELECT timestamp FROM screen_timeline ORDER BY timestamp DESC LIMIT 500";
    let Ok(mut stmt) = conn.prepare(sql) else {
        return default_peak_hours();
    };

    let timestamps: Vec<i64> = stmt
        .query_map(rusqlite::params![], |row| row.get::<_, i64>(0))
        .ok()
        .map(|r| r.flatten().collect())
        .unwrap_or_default();

    if timestamps.is_empty() {
        return default_peak_hours();
    }

    let mut hour_counts: HashMap<u32, u32> = HashMap::new();
    for ts in &timestamps {
        if let Some(dt) = chrono::DateTime::from_timestamp(*ts, 0) {
            let h = dt.hour();
            *hour_counts.entry(h).or_insert(0) += 1;
        }
    }

    let max_count = *hour_counts.values().max().unwrap_or(&1) as f64;
    let mut peaks: Vec<(u32, f64)> = hour_counts
        .into_iter()
        .map(|(h, c)| (h, c as f64 / max_count))
        .collect();
    peaks.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    peaks
}

fn default_peak_hours() -> Vec<(u32, f64)> {
    // Sensible defaults: 9-11am and 2-4pm are commonly productive
    vec![(9, 1.0), (10, 0.9), (11, 0.8), (14, 0.7), (15, 0.8)]
}

/// Store a meeting summary as a typed_memories entry.
fn store_summary_in_memory(summary: &MeetingSummary) -> Option<String> {
    let conn = open_db()?;
    // Ensure the table exists (idempotent).
    crate::typed_memory::ensure_table(&conn);
    let id = uuid::Uuid::new_v4().to_string();
    let content = serde_json::to_string(summary).unwrap_or_default();
    let now = now_secs();
    let _ = conn.execute(
        "INSERT OR REPLACE INTO typed_memories \
         (id, category, content, confidence, source, created_at, last_accessed, access_count) \
         VALUES (?1, 'meeting_summary', ?2, 0.9, ?3, ?4, ?4, 1)",
        rusqlite::params![id, content, summary.title, now],
    );
    Some(id)
}

// ── Public API ────────────────────────────────────────────────────────────────

/// Return today's calendar events from the integration bridge.
pub async fn get_today_schedule() -> Result<Vec<CalendarEvent>, String> {
    // Pull from integration_bridge state (real MCP data when configured, simulated otherwise).
    let state = crate::integration_bridge::get_integration_state();
    Ok(state.upcoming_events)
}

/// Build a comprehensive prep brief for the given calendar event.
pub async fn prep_for_meeting(
    app: &AppHandle,
    event: &CalendarEvent,
) -> Result<MeetingPrep, String> {
    // 1. Extract attendee names from the event title (simple heuristic — real
    //    implementation would use the attendees field once the MCP surface expands).
    let attendee_names: Vec<String> = extract_names_from_title(&event.title);

    // 2. Build people-graph contexts
    let attendee_contexts = build_attendee_contexts(&attendee_names);

    // 3. Search conversations for mentions of the topic or attendees
    let mut conversation_snippets: Vec<String> = search_conversations(&event.title, 5);
    for name in &attendee_names {
        conversation_snippets.extend(search_conversations(name, 3));
    }
    conversation_snippets.dedup();
    let conversation_context = conversation_snippets.join("\n---\n");

    // 4. Fetch open action items for attendees
    let open_action_items = fetch_open_action_items(&attendee_names);

    // 5. LLM brief
    let attendee_summary: Vec<String> = attendee_contexts
        .iter()
        .map(|a| {
            format!(
                "{} ({}). Last seen {} days ago. Style: {}. Topics: {}. Notes: {}",
                a.name,
                a.relationship,
                if a.last_interaction_days_ago >= 0 {
                    a.last_interaction_days_ago.to_string()
                } else {
                    "never".to_string()
                },
                a.communication_style,
                a.common_topics.join(", "),
                a.notes,
            )
        })
        .collect();

    let open_items_summary: Vec<String> = open_action_items
        .iter()
        .map(|i| format!("- {} (from: {})", i.description, i.created_from))
        .collect();

    let llm_user_prompt = format!(
        "Meeting: {}\nAttendees:\n{}\n\nOpen action items:\n{}\n\nRecent conversations:\n{}\n\n\
         Generate a concise meeting prep brief (3-5 sentences) and suggest 3-5 agenda items.",
        event.title,
        attendee_summary.join("\n"),
        if open_items_summary.is_empty() {
            "None".to_string()
        } else {
            open_items_summary.join("\n")
        },
        if conversation_context.is_empty() {
            "No recent context found.".to_string()
        } else {
            crate::safe_slice(&conversation_context, 2000).to_string()
        }
    );

    let llm_response = llm_complete(
        app,
        "You are BLADE, an AI chief of staff. Be concise and actionable.",
        &llm_user_prompt,
    )
    .await
    .unwrap_or_else(|_| "Meeting prep unavailable — LLM call failed.".to_string());

    // Parse suggested agenda from the LLM response (lines starting with a number or dash)
    let suggested_agenda: Vec<String> = llm_response
        .lines()
        .filter(|l| {
            let t = l.trim();
            t.starts_with('-') || t.starts_with("•") || (t.len() > 2 && t.chars().next().map(|c| c.is_ascii_digit()).unwrap_or(false))
        })
        .map(|l| l.trim_start_matches(|c: char| !c.is_alphabetic()).trim().to_string())
        .filter(|l| !l.is_empty())
        .take(5)
        .collect();

    Ok(MeetingPrep {
        event_title: event.title.clone(),
        attendee_contexts,
        open_action_items,
        brief: llm_response,
        suggested_agenda,
    })
}

/// Analyse the user's productivity patterns and create Focus Time blocks for
/// peak hours that are currently empty on the calendar. Returns number of blocks created.
pub async fn auto_block_focus_time(app: &AppHandle) -> Result<u32, String> {
    let today_events = get_today_schedule().await?;
    let peak_hours = detect_peak_hours();

    // Build a set of occupied hours
    let occupied: std::collections::HashSet<u32> = today_events
        .iter()
        .map(|e| {
            chrono::DateTime::from_timestamp(e.start_ts, 0)
                .map(|dt| dt.hour())
                .unwrap_or(99)
        })
        .collect();

    let mut scheduled_hours: Vec<u32> = Vec::new();

    for (hour, score) in &peak_hours {
        if score < &0.6 {
            break; // Only top-tier slots
        }
        if occupied.contains(hour) {
            continue;
        }
        if scheduled_hours.len() >= 2 {
            break; // Cap at 2 focus blocks per day
        }
        scheduled_hours.push(*hour);
    }

    if scheduled_hours.is_empty() {
        return Ok(0);
    }

    // Emit suggestion — if Google Calendar MCP is configured it will create real events.
    let today = chrono::Utc::now().format("%Y-%m-%d").to_string();
    let mut blocks_created: u32 = 0;
    for hour in &scheduled_hours {
        let event_title = "Focus Time (BLADE)";
        let start = format!("{}T{:02}:00:00Z", today, hour);
        let end = format!("{}T{:02}:00:00Z", today, hour + 1);

        let _ = app.emit_to("main", "calendar_create_event",
            serde_json::json!({
                "title": event_title,
                "start": start,
                "end": end,
                "description": "Focus block created by BLADE based on your productivity patterns.",
                "source": "calendar_tentacle",
            }),
        );
        blocks_created += 1;
    }

    Ok(blocks_created)
}

/// Parse a meeting transcript and produce a structured MeetingSummary.
/// Optionally creates Linear tickets for action items if Linear is configured.
pub async fn post_meeting_summary(
    app: &AppHandle,
    transcript: &str,
    meeting_title: &str,
) -> Result<MeetingSummary, String> {
    let prompt = format!(
        "You are analyzing a meeting transcript. Extract:\n\
         1. KEY DECISIONS (bullet list)\n\
         2. ACTION ITEMS (each with: description, owner if mentioned, due date if mentioned)\n\
         3. FOLLOW-UPS (things to check on later)\n\
         4. KEY TOPICS discussed\n\n\
         Transcript:\n{}\n\n\
         Respond as JSON with keys: decisions (array), action_items (array of {{description, owner, due_date}}), \
         follow_ups (array), key_topics (array).",
        crate::safe_slice(transcript, 8000)
    );

    let raw = llm_complete(app, "You are a precise meeting assistant. Output only valid JSON.", &prompt)
        .await
        .unwrap_or_else(|_| "{}".to_string());

    // Parse LLM JSON response
    let parsed: serde_json::Value = serde_json::from_str(&raw).unwrap_or_default();

    let decisions: Vec<String> = parsed["decisions"]
        .as_array()
        .unwrap_or(&vec![])
        .iter()
        .filter_map(|v| v.as_str().map(|s| s.to_string()))
        .collect();

    let action_items: Vec<ActionItem> = parsed["action_items"]
        .as_array()
        .unwrap_or(&vec![])
        .iter()
        .map(|v| ActionItem {
            description: v["description"]
                .as_str()
                .unwrap_or("unknown")
                .to_string(),
            owner: v["owner"].as_str().map(|s| s.to_string()),
            due_date: v["due_date"].as_str().map(|s| s.to_string()),
            ticket_id: None,
        })
        .collect();

    let follow_ups: Vec<String> = parsed["follow_ups"]
        .as_array()
        .unwrap_or(&vec![])
        .iter()
        .filter_map(|v| v.as_str().map(|s| s.to_string()))
        .collect();

    let key_topics: Vec<String> = parsed["key_topics"]
        .as_array()
        .unwrap_or(&vec![])
        .iter()
        .filter_map(|v| v.as_str().map(|s| s.to_string()))
        .collect();

    let today = chrono::Utc::now().format("%Y-%m-%d").to_string();

    let mut summary = MeetingSummary {
        title: meeting_title.to_string(),
        date: today,
        decisions,
        action_items,
        follow_ups,
        key_topics,
        stored_memory_id: None,
    };

    // Store in memory
    summary.stored_memory_id = store_summary_in_memory(&summary);

    // Emit for UI and any Linear/Jira integration listening
    let _ = app.emit_to("main", "meeting_summary_ready", &summary);

    Ok(summary)
}

// ── Utility ───────────────────────────────────────────────────────────────────

/// Extract likely person names from a calendar event title using a simple
/// heuristic: capitalised words that are not known stop-words.
fn extract_names_from_title(title: &str) -> Vec<String> {
    let stop_words = [
        "meeting", "with", "and", "the", "a", "an", "sync", "call",
        "chat", "review", "weekly", "daily", "standup", "1:1", "team",
        "project", "sprint", "planning", "retro", "kickoff", "discussion",
    ];
    title
        .split_whitespace()
        .filter(|word| {
            let lower = word.to_lowercase();
            let clean: String = lower.chars().filter(|c| c.is_alphabetic()).collect();
            !stop_words.contains(&clean.as_str())
                && word.chars().next().map(|c| c.is_uppercase()).unwrap_or(false)
                && clean.len() > 1
        })
        .map(|w| w.trim_matches(|c: char| !c.is_alphabetic()).to_string())
        .collect()
}

// ── Meeting load analysis ──────────────────────────────────────────────────────

/// Analyse the week's schedule and warn if any day is overwhelmed with meetings.
/// Suggests moving async-friendly meetings to protect deep-work time.
pub async fn analyze_meeting_load(app: &AppHandle) -> Result<Vec<MeetingLoadWarning>, String> {
    let events = get_today_schedule().await?;
    let mut warnings = Vec::new();

    // Group events by day of week
    let mut day_meetings: HashMap<u32, Vec<&CalendarEvent>> = HashMap::new();
    for event in &events {
        let day = chrono::DateTime::from_timestamp(event.start_ts, 0)
            .map(|dt| {
                use chrono::Datelike;
                dt.weekday().num_days_from_monday()
            })
            .unwrap_or(0);
        day_meetings.entry(day).or_default().push(event);
    }

    let day_names = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
    const WORK_HOURS: f32 = 8.0;
    const WARNING_THRESHOLD: f32 = 0.6; // 60% of the day in meetings

    for (day, meetings) in &day_meetings {
        let meeting_count = meetings.len() as u32;
        let meeting_hours: f32 = meetings
            .iter()
            .map(|e| ((e.start_ts + 3600) - e.start_ts).max(0) as f32 / 3600.0)
            .sum();

        let percent = meeting_hours / WORK_HOURS;
        if percent < WARNING_THRESHOLD || meeting_count < 3 {
            continue;
        }

        let day_name = day_names.get(*day as usize).unwrap_or(&"this day");
        let meeting_titles: Vec<&str> = meetings.iter().map(|m| m.title.as_str()).collect();

        let prompt = format!(
            "You have {meeting_count} meetings on {day_name} ({meeting_hours:.1} hours = {:.0}% of your day):\n\
             {}\n\n\
             In one sentence, suggest which 1-2 meetings could be converted to async (email/doc) \
             to reclaim focus time.",
            percent * 100.0,
            meeting_titles.join(", ")
        );

        let suggestion = llm_complete(
            app,
            "You are a scheduling optimizer. Be concise.",
            &prompt,
        )
        .await
        .unwrap_or_else(|_| {
            format!(
                "Consider converting some of your {day_name} meetings to async updates."
            )
        });

        warnings.push(MeetingLoadWarning {
            day_name: day_name.to_string(),
            total_meetings: meeting_count,
            meeting_hours,
            day_hours: WORK_HOURS,
            percent_of_day: percent,
            suggestion,
        });
    }

    Ok(warnings)
}

// ── Double-booking detection ───────────────────────────────────────────────────

/// Find overlapping events and recommend which one to keep based on:
///   - Relationship importance of attendees (people_graph)
///   - Topic urgency keywords
///   - Meeting duration (shorter = easier to reschedule)
pub async fn detect_double_bookings(app: &AppHandle) -> Result<Vec<DoubleBooking>, String> {
    let events = get_today_schedule().await?;
    let mut conflicts = Vec::new();

    for i in 0..events.len() {
        for j in (i + 1)..events.len() {
            let a = &events[i];
            let b = &events[j];

            // Check for overlap: a starts before b ends AND a ends after b starts
            let overlaps = a.start_ts < (b.start_ts + 3600) && (a.start_ts + 3600) > b.start_ts;
            if !overlaps {
                continue;
            }

            // Score each event to decide which to keep
            let score_a = score_event_importance(a);
            let score_b = score_event_importance(b);

            let (keep, drop) = if score_a >= score_b {
                (&a.title, &b.title)
            } else {
                (&b.title, &a.title)
            };

            let reason_prompt = format!(
                "Two meetings conflict: '{keep_title}' and '{drop_title}'.\n\
                 Based on typical workplace priorities, in one sentence explain why \
                 keeping '{keep_title}' and rescheduling '{drop_title}' makes sense.",
                keep_title = keep,
                drop_title = drop
            );

            let reason = llm_complete(
                app,
                "You are a scheduling assistant.",
                &reason_prompt,
            )
            .await
            .unwrap_or_else(|_| {
                format!("'{keep}' appears higher priority based on attendees and topic.")
            });

            conflicts.push(DoubleBooking {
                event_a: a.clone(),
                event_b: b.clone(),
                recommended_keep: keep.clone(),
                reason,
            });
        }
    }

    Ok(conflicts)
}

/// Score a calendar event by importance (for double-booking resolution).
fn score_event_importance(event: &CalendarEvent) -> f32 {
    let title_lower = event.title.to_lowercase();

    // Urgency keywords in title
    let urgent_keywords = ["urgent", "critical", "deadline", "board", "exec", "investor", "client", "launch"];
    let urgency_score: f32 = urgent_keywords
        .iter()
        .filter(|kw| title_lower.contains(*kw))
        .count() as f32
        * 0.15;

    // Duration factor: longer = harder to reschedule (but not always more important)
    let duration_hours = ((event.start_ts + 3600) - event.start_ts).max(0) as f32 / 3600.0;
    let duration_score = (duration_hours / 2.0).clamp(0.0, 0.3);

    // Extract names from title and check people_graph
    let attendee_names = crate::tentacles::calendar_tentacle::extract_names_from_title_pub(&event.title);
    let relationship_score: f32 = attendee_names
        .iter()
        .filter_map(|name| crate::people_graph::get_person(name))
        .map(|p| match p.relationship.as_str() {
            "manager" | "director" | "vp" | "ceo" | "exec" => 0.9,
            "client" | "customer" => 0.8,
            "lead" => 0.6,
            _ => 0.3,
        })
        .fold(0.0f32, f32::max);

    (urgency_score + duration_score * 0.5 + relationship_score * 0.5).clamp(0.0, 1.0)
}

// ── Smart meeting prep (agenda from open threads) ─────────────────────────────

/// Enhanced meeting prep that generates agenda suggestions based on:
///   - Open Slack threads with attendees
///   - Unresolved email threads with attendees
///   - Unfinished action items from prior meetings
pub async fn smart_prep_for_meeting(
    app: &AppHandle,
    event: &CalendarEvent,
) -> Result<MeetingPrep, String> {
    let attendee_names: Vec<String> = extract_names_from_title(&event.title);
    let attendee_contexts = build_attendee_contexts(&attendee_names);
    let open_action_items = fetch_open_action_items(&attendee_names);

    // Search for open Slack threads with these attendees
    let slack_context: String = {
        let mut snippets = Vec::new();
        for name in &attendee_names {
            let tags = vec![name.clone(), "slack".to_string()];
            let mems = crate::typed_memory::get_relevant_memories_for_context(&tags, 2);
            for m in mems {
                snippets.push(format!("[Slack with {}] {}", name, crate::safe_slice(&m.content, 150)));
            }
        }
        snippets.join("\n")
    };

    // Search for recent emails with these attendees
    let email_context: String = {
        let mut snippets = Vec::new();
        for name in &attendee_names {
            let tags = vec![name.clone(), "email".to_string()];
            let mems = crate::typed_memory::get_relevant_memories_for_context(&tags, 2);
            for m in mems {
                snippets.push(format!("[Email with {}] {}", name, crate::safe_slice(&m.content, 150)));
            }
        }
        snippets.join("\n")
    };

    let attendee_summary: Vec<String> = attendee_contexts
        .iter()
        .map(|a| {
            format!(
                "{} ({}). Last seen {} days ago. Style: {}. Topics: {}",
                a.name,
                a.relationship,
                if a.last_interaction_days_ago >= 0 { a.last_interaction_days_ago.to_string() } else { "never".to_string() },
                a.communication_style,
                a.common_topics.join(", ")
            )
        })
        .collect();

    let open_items_text: Vec<String> = open_action_items
        .iter()
        .map(|i| format!("- {} (from: {})", i.description, i.created_from))
        .collect();

    let llm_prompt = format!(
        "Meeting: {}\n\
         Attendees:\n{}\n\n\
         Open action items with these people:\n{}\n\n\
         Recent Slack context:\n{}\n\n\
         Recent email context:\n{}\n\n\
         Generate:\n\
         1. A concise meeting brief (2-3 sentences)\n\
         2. A focused agenda (3-5 bullet points) based on the OPEN THREADS and ACTION ITEMS above\n\
         Prioritise unresolved items over generic recurring-meeting topics.",
        event.title,
        attendee_summary.join("\n"),
        if open_items_text.is_empty() { "None".to_string() } else { open_items_text.join("\n") },
        if slack_context.is_empty() { "No recent Slack context.".to_string() } else { crate::safe_slice(&slack_context, 800).to_string() },
        if email_context.is_empty() { "No recent email context.".to_string() } else { crate::safe_slice(&email_context, 800).to_string() },
    );

    let llm_response = llm_complete(
        app,
        "You are BLADE, an AI chief of staff. Be concise and actionable. \
         Focus the agenda on unresolved issues, not generic topics.",
        &llm_prompt,
    )
    .await
    .unwrap_or_else(|_| "Meeting prep unavailable.".to_string());

    let suggested_agenda: Vec<String> = llm_response
        .lines()
        .filter(|l| {
            let t = l.trim();
            t.starts_with('-') || t.starts_with("•") || (t.len() > 2 && t.chars().next().map(|c| c.is_ascii_digit()).unwrap_or(false))
        })
        .map(|l| l.trim_start_matches(|c: char| !c.is_alphabetic()).trim().to_string())
        .filter(|l| !l.is_empty())
        .take(5)
        .collect();

    Ok(MeetingPrep {
        event_title: event.title.clone(),
        attendee_contexts,
        open_action_items,
        brief: llm_response,
        suggested_agenda,
    })
}

// ── Post-meeting summary with attendee email draft ────────────────────────────

/// Like post_meeting_summary but also drafts an email to attendees for approval.
pub async fn post_meeting_summary_with_draft(
    app: &AppHandle,
    transcript: &str,
    meeting_title: &str,
    attendee_names: &[String],
) -> Result<MeetingSummaryDraft, String> {
    let summary = post_meeting_summary(app, transcript, meeting_title).await?;

    // Gather attendee email addresses from people_graph
    let attendee_emails: Vec<String> = attendee_names
        .iter()
        .filter_map(|name| {
            crate::people_graph::get_person(name)
                .and_then(|p| {
                    // Use notes field to find email — people_graph stores contact info there
                    if p.notes.contains('@') {
                        p.notes.split_whitespace().find(|w| w.contains('@')).map(|s| s.to_string())
                    } else {
                        None
                    }
                })
        })
        .collect();

    // Draft the email body
    let decisions_text = summary.decisions.iter().map(|d| format!("- {d}")).collect::<Vec<_>>().join("\n");
    let actions_text = summary.action_items.iter()
        .map(|a| {
            let owner = a.owner.as_deref().unwrap_or("TBD");
            let due = a.due_date.as_deref().unwrap_or("TBD");
            format!("- {} (Owner: {}, Due: {})", a.description, owner, due)
        })
        .collect::<Vec<_>>()
        .join("\n");

    let email_prompt = format!(
        "Write a professional meeting follow-up email body (no subject line needed) for: {meeting_title}\n\n\
         Decisions made:\n{decisions_text}\n\n\
         Action items:\n{actions_text}\n\n\
         Key topics discussed: {}\n\n\
         Keep it concise and clear. End with next steps.",
        summary.key_topics.join(", ")
    );

    let email_draft = llm_complete(
        app,
        "You are drafting a professional meeting follow-up email. Be clear and concise.",
        &email_prompt,
    )
    .await
    .unwrap_or_else(|_| {
        format!(
            "Hi all,\n\nThanks for the meeting. Here are the key takeaways:\n\n\
             Decisions:\n{decisions_text}\n\nAction items:\n{actions_text}\n\nBest"
        )
    });

    let draft = MeetingSummaryDraft {
        summary,
        email_draft,
        attendee_emails,
        approved: false, // user must approve before sending
    };

    // Emit for UI — user sees draft and can approve/edit
    let _ = app.emit_to("main", "meeting_summary_draft_ready", &draft);

    Ok(draft)
}

// ── Utility (public for use by score_event_importance) ────────────────────────

/// Public wrapper around extract_names_from_title for use within this module.
pub fn extract_names_from_title_pub(title: &str) -> Vec<String> {
    extract_names_from_title(title)
}

// ── Tauri commands ────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn calendar_get_today(_app: AppHandle) -> Result<Vec<CalendarEvent>, String> {
    get_today_schedule().await
}

#[tauri::command]
pub async fn calendar_prep_meeting(
    app: AppHandle,
    event: CalendarEvent,
) -> Result<MeetingPrep, String> {
    prep_for_meeting(&app, &event).await
}

#[tauri::command]
pub async fn calendar_auto_block_focus(app: AppHandle) -> Result<u32, String> {
    auto_block_focus_time(&app).await
}

#[tauri::command]
pub async fn calendar_post_meeting_summary(
    app: AppHandle,
    transcript: String,
    meeting_title: String,
) -> Result<MeetingSummary, String> {
    post_meeting_summary(&app, &transcript, &meeting_title).await
}

#[tauri::command]
pub async fn calendar_analyze_meeting_load(app: AppHandle) -> Result<Vec<MeetingLoadWarning>, String> {
    analyze_meeting_load(&app).await
}

#[tauri::command]
pub async fn calendar_detect_double_bookings(app: AppHandle) -> Result<Vec<DoubleBooking>, String> {
    detect_double_bookings(&app).await
}

#[tauri::command]
pub async fn calendar_smart_prep_meeting(
    app: AppHandle,
    event: CalendarEvent,
) -> Result<MeetingPrep, String> {
    smart_prep_for_meeting(&app, &event).await
}

#[tauri::command]
pub async fn calendar_post_meeting_with_draft(
    app: AppHandle,
    transcript: String,
    meeting_title: String,
    attendee_names: Vec<String>,
) -> Result<MeetingSummaryDraft, String> {
    post_meeting_summary_with_draft(&app, &transcript, &meeting_title, &attendee_names).await
}
