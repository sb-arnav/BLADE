/// BLADE Meeting Intelligence
///
/// Captures meetings and calls — from pasted transcripts or recorded audio.
/// Extracts action items, decisions, follow-ups, and builds a searchable
/// meeting history with LLM-powered intelligence.
///
/// All DB work is done synchronously before any `.await` points so no
/// rusqlite::Connection is held across an await boundary.

use chrono::Local;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

// ── Structs ───────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActionItem {
    pub description: String,
    pub owner: String,           // person responsible (or "me")
    pub due_date: Option<String>,
    pub completed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Meeting {
    pub id: String,
    pub title: String,
    pub date: String,            // YYYY-MM-DD
    pub duration_minutes: Option<i32>,
    pub participants: Vec<String>,
    pub transcript: String,      // raw transcript or notes
    pub summary: String,         // LLM executive summary
    pub decisions: Vec<String>,
    pub action_items: Vec<ActionItem>,
    pub open_questions: Vec<String>,
    pub sentiment: String,       // "productive", "tense", "energetic", "inconclusive"
    pub meeting_type: String,    // "standup", "planning", "review", "1on1", "brainstorm", "client"
    pub created_at: i64,
}

// ── DB helpers ────────────────────────────────────────────────────────────────

fn open_db() -> Option<rusqlite::Connection> {
    let db_path = crate::config::blade_config_dir().join("blade.db");
    rusqlite::Connection::open(&db_path).ok()
}

fn strip_json_fences(s: &str) -> &str {
    let s = s.trim();
    if let Some(inner) = s.strip_prefix("```json") {
        if let Some(stripped) = inner.strip_suffix("```") {
            return stripped.trim();
        }
    }
    if let Some(inner) = s.strip_prefix("```") {
        if let Some(stripped) = inner.strip_suffix("```") {
            return stripped.trim();
        }
    }
    s
}

// ── Schema ────────────────────────────────────────────────────────────────────

pub fn ensure_tables() {
    let conn = match open_db() {
        Some(c) => c,
        None => return,
    };
    let _ = conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS meetings (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            date TEXT NOT NULL,
            duration_minutes INTEGER,
            participants TEXT NOT NULL DEFAULT '[]',
            transcript TEXT NOT NULL DEFAULT '',
            summary TEXT NOT NULL DEFAULT '',
            decisions TEXT NOT NULL DEFAULT '[]',
            action_items TEXT NOT NULL DEFAULT '[]',
            open_questions TEXT NOT NULL DEFAULT '[]',
            sentiment TEXT NOT NULL DEFAULT 'inconclusive',
            meeting_type TEXT NOT NULL DEFAULT 'brainstorm',
            created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_meetings_date ON meetings (date DESC);
        CREATE INDEX IF NOT EXISTS idx_meetings_created_at ON meetings (created_at DESC);",
    );
}

// ── Row deserialiser ──────────────────────────────────────────────────────────

fn row_to_meeting(row: &rusqlite::Row<'_>) -> rusqlite::Result<Meeting> {
    let participants_json: String = row.get(4)?;
    let decisions_json: String = row.get(7)?;
    let action_items_json: String = row.get(8)?;
    let open_questions_json: String = row.get(9)?;

    let participants: Vec<String> =
        serde_json::from_str(&participants_json).unwrap_or_default();
    let decisions: Vec<String> =
        serde_json::from_str(&decisions_json).unwrap_or_default();
    let action_items: Vec<ActionItem> =
        serde_json::from_str(&action_items_json).unwrap_or_default();
    let open_questions: Vec<String> =
        serde_json::from_str(&open_questions_json).unwrap_or_default();

    Ok(Meeting {
        id: row.get(0)?,
        title: row.get(1)?,
        date: row.get(2)?,
        duration_minutes: row.get(3)?,
        participants,
        transcript: row.get(5)?,
        summary: row.get(6)?,
        decisions,
        action_items,
        open_questions,
        sentiment: row.get(10)?,
        meeting_type: row.get(11)?,
        created_at: row.get(12)?,
    })
}

// ── LLM extraction ────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
struct MeetingExtraction {
    summary: String,
    decisions: Vec<String>,
    action_items: Vec<ActionItem>,
    open_questions: Vec<String>,
    sentiment: String,
    meeting_type: String,
}

async fn llm_extract_meeting(
    title: &str,
    date: &str,
    transcript: &str,
    participants: &[String],
) -> Result<MeetingExtraction, String> {
    let participants_str = if participants.is_empty() {
        "unknown".to_string()
    } else {
        participants.join(", ")
    };

    let transcript_preview = crate::safe_slice(transcript, 12_000);

    let prompt = format!(
        "You are BLADE, an AI meeting analyst. Analyze the following meeting transcript and extract structured intelligence.\n\n\
         Meeting Title: {title}\n\
         Date: {date}\n\
         Participants: {participants_str}\n\n\
         Transcript:\n{transcript_preview}\n\n\
         Extract the following and return ONLY valid JSON (no markdown fences, no extra text):\n\
         {{\n\
           \"summary\": \"Executive summary in 3-5 sentences. What was decided, what matters most.\",\n\
           \"decisions\": [\"Decision 1\", \"Decision 2\"],\n\
           \"action_items\": [\n\
             {{\n\
               \"description\": \"What needs to be done\",\n\
               \"owner\": \"Person responsible or 'me' if unclear\",\n\
               \"due_date\": \"YYYY-MM-DD or null\",\n\
               \"completed\": false\n\
             }}\n\
           ],\n\
           \"open_questions\": [\"Question that was raised but not resolved\"],\n\
           \"sentiment\": \"productive|tense|energetic|inconclusive\",\n\
           \"meeting_type\": \"standup|planning|review|1on1|brainstorm|client\"\n\
         }}"
    );

    let config = crate::config::load_config();
    let (provider, api_key, model) =
        crate::config::resolve_provider_for_task(&config, &crate::router::TaskType::Complex);

    let messages = vec![crate::providers::ConversationMessage::User(prompt)];
    let turn =
        crate::providers::complete_turn(&provider, &api_key, &model, &messages, &[], None)
            .await
            .map_err(|e| format!("LLM error: {e}"))?;

    let raw = strip_json_fences(&turn.content);
    serde_json::from_str::<MeetingExtraction>(raw).map_err(|e| {
        format!(
            "Failed to parse meeting extraction JSON: {e}\nRaw: {}",
            crate::safe_slice(raw, 300)
        )
    })
}

// ── Meeting management ────────────────────────────────────────────────────────

/// Process a meeting transcript: LLM extracts intelligence, saves to DB,
/// returns the full Meeting struct.
pub async fn process_meeting(
    title: &str,
    date: &str,
    transcript: &str,
    participants: Vec<String>,
) -> Result<Meeting, String> {
    ensure_tables();

    // LLM extraction (no DB connection held during await)
    let extraction = llm_extract_meeting(title, date, transcript, &participants).await?;

    let id = Uuid::new_v4().to_string();
    let created_at = Local::now().timestamp();

    let participants_json =
        serde_json::to_string(&participants).unwrap_or_else(|_| "[]".to_string());
    let decisions_json =
        serde_json::to_string(&extraction.decisions).unwrap_or_else(|_| "[]".to_string());
    let action_items_json =
        serde_json::to_string(&extraction.action_items).unwrap_or_else(|_| "[]".to_string());
    let open_questions_json =
        serde_json::to_string(&extraction.open_questions).unwrap_or_else(|_| "[]".to_string());

    // Now open DB and save
    let conn = open_db().ok_or("Failed to open database")?;
    conn.execute(
        "INSERT INTO meetings
            (id, title, date, duration_minutes, participants, transcript, summary,
             decisions, action_items, open_questions, sentiment, meeting_type, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
        params![
            id,
            title,
            date,
            Option::<i32>::None,
            participants_json,
            transcript,
            extraction.summary,
            decisions_json,
            action_items_json,
            open_questions_json,
            extraction.sentiment,
            extraction.meeting_type,
            created_at,
        ],
    )
    .map_err(|e| format!("Failed to save meeting: {e}"))?;

    Ok(Meeting {
        id,
        title: title.to_string(),
        date: date.to_string(),
        duration_minutes: None,
        participants,
        transcript: transcript.to_string(),
        summary: extraction.summary,
        decisions: extraction.decisions,
        action_items: extraction.action_items,
        open_questions: extraction.open_questions,
        sentiment: extraction.sentiment,
        meeting_type: extraction.meeting_type,
        created_at,
    })
}

pub fn get_meeting(id: &str) -> Option<Meeting> {
    let conn = open_db()?;
    conn.query_row(
        "SELECT id, title, date, duration_minutes, participants, transcript, summary,
                decisions, action_items, open_questions, sentiment, meeting_type, created_at
         FROM meetings WHERE id = ?1",
        params![id],
        row_to_meeting,
    )
    .ok()
}

pub fn list_meetings(limit: usize) -> Vec<Meeting> {
    let conn = match open_db() {
        Some(c) => c,
        None => return vec![],
    };
    let mut stmt = match conn.prepare(
        "SELECT id, title, date, duration_minutes, participants, transcript, summary,
                decisions, action_items, open_questions, sentiment, meeting_type, created_at
         FROM meetings
         ORDER BY date DESC, created_at DESC
         LIMIT ?1",
    ) {
        Ok(s) => s,
        Err(_) => return vec![],
    };

    stmt.query_map(params![limit as i64], row_to_meeting)
        .map(|rows| rows.flatten().collect())
        .unwrap_or_default()
}

pub fn search_meetings(query: &str) -> Vec<Meeting> {
    let conn = match open_db() {
        Some(c) => c,
        None => return vec![],
    };
    let pattern = format!("%{}%", query);
    let mut stmt = match conn.prepare(
        "SELECT id, title, date, duration_minutes, participants, transcript, summary,
                decisions, action_items, open_questions, sentiment, meeting_type, created_at
         FROM meetings
         WHERE title LIKE ?1
            OR summary LIKE ?1
            OR transcript LIKE ?1
            OR decisions LIKE ?1
            OR action_items LIKE ?1
         ORDER BY date DESC
         LIMIT 50",
    ) {
        Ok(s) => s,
        Err(_) => return vec![],
    };

    stmt.query_map(params![pattern], row_to_meeting)
        .map(|rows| rows.flatten().collect())
        .unwrap_or_default()
}

pub fn delete_meeting(id: &str) -> Result<(), String> {
    let conn = open_db().ok_or("Failed to open database")?;
    conn.execute("DELETE FROM meetings WHERE id = ?1", params![id])
        .map_err(|e| format!("Failed to delete meeting: {e}"))?;
    Ok(())
}

// ── Action items ──────────────────────────────────────────────────────────────

/// Returns all open (incomplete) action items across all meetings,
/// paired with the meeting title for context.
pub fn get_open_action_items() -> Vec<(String, ActionItem)> {
    let meetings = list_meetings(200);
    let mut result = Vec::new();
    for meeting in meetings {
        for item in meeting.action_items {
            if !item.completed {
                result.push((meeting.title.clone(), item));
            }
        }
    }
    result
}

/// Mark an action item as completed by its index within the meeting's action_items list.
pub fn complete_action_item(meeting_id: &str, item_index: usize) -> Result<(), String> {
    let conn = open_db().ok_or("Failed to open database")?;

    // Load current action items JSON
    let action_items_json: String = conn
        .query_row(
            "SELECT action_items FROM meetings WHERE id = ?1",
            params![meeting_id],
            |r| r.get(0),
        )
        .map_err(|e| format!("Meeting not found: {e}"))?;

    let mut action_items: Vec<ActionItem> =
        serde_json::from_str(&action_items_json).unwrap_or_default();

    if item_index >= action_items.len() {
        return Err(format!(
            "Action item index {} out of range (len {})",
            item_index,
            action_items.len()
        ));
    }

    action_items[item_index].completed = true;

    let updated_json =
        serde_json::to_string(&action_items).map_err(|e| format!("JSON error: {e}"))?;

    conn.execute(
        "UPDATE meetings SET action_items = ?1 WHERE id = ?2",
        params![updated_json, meeting_id],
    )
    .map_err(|e| format!("Failed to update action items: {e}"))?;

    Ok(())
}

// ── Intelligence ──────────────────────────────────────────────────────────────

/// Generate a professional follow-up email for a meeting.
pub async fn generate_follow_up_email(meeting_id: &str, recipient: &str) -> String {
    // Load meeting data before any await
    let meeting = match get_meeting(meeting_id) {
        Some(m) => m,
        None => return format!("Meeting {meeting_id} not found."),
    };

    let decisions_str = if meeting.decisions.is_empty() {
        "None recorded.".to_string()
    } else {
        meeting
            .decisions
            .iter()
            .map(|d| format!("- {d}"))
            .collect::<Vec<_>>()
            .join("\n")
    };

    let open_items: Vec<&ActionItem> = meeting
        .action_items
        .iter()
        .filter(|a| !a.completed)
        .collect();

    let action_str = if open_items.is_empty() {
        "No open action items.".to_string()
    } else {
        open_items
            .iter()
            .map(|a| {
                let due = a
                    .due_date
                    .as_deref()
                    .map(|d| format!(" (due {d})"))
                    .unwrap_or_default();
                format!("- {} [{}]{}", a.description, a.owner, due)
            })
            .collect::<Vec<_>>()
            .join("\n")
    };

    let questions_str = if meeting.open_questions.is_empty() {
        "None.".to_string()
    } else {
        meeting
            .open_questions
            .iter()
            .map(|q| format!("- {q}"))
            .collect::<Vec<_>>()
            .join("\n")
    };

    let prompt = format!(
        "You are BLADE, writing a professional follow-up email on behalf of the user.\n\n\
         Meeting: {title}\n\
         Date: {date}\n\
         Participants: {participants}\n\
         Recipient: {recipient}\n\n\
         Summary:\n{summary}\n\n\
         Key Decisions:\n{decisions_str}\n\n\
         Open Action Items:\n{action_str}\n\n\
         Open Questions:\n{questions_str}\n\n\
         Write a concise, professional follow-up email. Include:\n\
         1. A brief thanks for the meeting\n\
         2. The key decisions made\n\
         3. Action items with owners and due dates\n\
         4. Any open questions needing resolution\n\
         5. A clear next step or call to action\n\n\
         Use a professional but warm tone. No fluff. Keep it under 300 words.",
        title = meeting.title,
        date = meeting.date,
        participants = meeting.participants.join(", "),
        summary = meeting.summary,
    );

    let config = crate::config::load_config();
    let (provider, api_key, model) =
        crate::config::resolve_provider_for_task(&config, &crate::router::TaskType::Complex);

    let messages = vec![crate::providers::ConversationMessage::User(prompt)];
    match crate::providers::complete_turn(&provider, &api_key, &model, &messages, &[], None).await {
        Ok(t) => t.content,
        Err(e) => format!("Failed to generate follow-up email: {e}"),
    }
}

/// Compare a set of meetings and surface how a topic has evolved across them.
pub async fn compare_meetings(ids: Vec<String>) -> String {
    if ids.is_empty() {
        return "No meeting IDs provided.".to_string();
    }

    // Load all meetings before any await
    let meetings: Vec<Meeting> = ids.iter().filter_map(|id| get_meeting(id)).collect();

    if meetings.is_empty() {
        return "None of the provided meeting IDs were found.".to_string();
    }

    let summaries: Vec<String> = meetings
        .iter()
        .map(|m| {
            format!(
                "--- {} ({}) ---\nType: {}\nSentiment: {}\nSummary: {}\nDecisions: {}\nOpen questions: {}",
                m.title,
                m.date,
                m.meeting_type,
                m.sentiment,
                m.summary,
                m.decisions.join("; "),
                m.open_questions.join("; ")
            )
        })
        .collect();

    let prompt = format!(
        "You are BLADE analyzing evolution across multiple meetings.\n\n\
         Meetings to compare:\n\n{}\n\n\
         Analyze:\n\
         1. How has the main topic/project evolved across these meetings?\n\
         2. What decisions have been revisited or reversed?\n\
         3. What action items carried over without resolution?\n\
         4. Is the sentiment trend improving or worsening?\n\
         5. What key open questions remain unresolved?\n\n\
         Be specific and reference meeting titles and dates. Write in clear paragraphs.",
        summaries.join("\n\n")
    );

    let config = crate::config::load_config();
    let (provider, api_key, model) =
        crate::config::resolve_provider_for_task(&config, &crate::router::TaskType::Complex);

    let messages = vec![crate::providers::ConversationMessage::User(prompt)];
    match crate::providers::complete_turn(&provider, &api_key, &model, &messages, &[], None).await {
        Ok(t) => t.content,
        Err(e) => format!("Failed to compare meetings: {e}"),
    }
}

/// Find topics that come up repeatedly across recent meetings.
pub async fn extract_recurring_themes(days_back: i32) -> Vec<String> {
    // Load meetings before any await — entire DB work in its own scope
    let cutoff = {
        let dt = Local::now()
            .date_naive()
            .checked_sub_days(chrono::Days::new(days_back as u64))
            .unwrap_or_else(|| Local::now().date_naive());
        dt.format("%Y-%m-%d").to_string()
    };

    let meetings: Vec<Meeting> = {
        let conn = match open_db() {
            Some(c) => c,
            None => return vec![],
        };
        let mut stmt = match conn.prepare(
            "SELECT id, title, date, duration_minutes, participants, transcript, summary,
                    decisions, action_items, open_questions, sentiment, meeting_type, created_at
             FROM meetings
             WHERE date >= ?1
             ORDER BY date DESC",
        ) {
            Ok(s) => s,
            Err(_) => return vec![],
        };
        stmt.query_map(params![cutoff], row_to_meeting)
            .map(|rows| rows.flatten().collect())
            .unwrap_or_default()
        // conn and stmt dropped here
    };

    if meetings.is_empty() {
        return vec!["No meetings in the specified period.".to_string()];
    }

    let combined: Vec<String> = meetings
        .iter()
        .map(|m| {
            format!(
                "[{} - {}]: {}\nDecisions: {}\nQuestions: {}",
                m.title,
                m.date,
                m.summary,
                m.decisions.join("; "),
                m.open_questions.join("; ")
            )
        })
        .collect();

    let prompt = format!(
        "You are BLADE analyzing {count} meetings from the last {days_back} days.\n\n\
         Meeting summaries:\n{content}\n\n\
         Identify recurring themes, topics, and patterns that appear across multiple meetings.\n\
         Return ONLY a JSON array of strings — each string is a concise theme description (one sentence).\n\
         Example: [\"Budget concerns are raised in every planning meeting\", \"Team velocity is consistently discussed\"]\n\
         Return 5-10 themes maximum. No markdown fences, no extra text.",
        count = meetings.len(),
        days_back = days_back,
        content = combined.join("\n\n")
    );

    let config = crate::config::load_config();
    let (provider, api_key, model) =
        crate::config::resolve_provider_for_task(&config, &crate::router::TaskType::Complex);

    let messages = vec![crate::providers::ConversationMessage::User(prompt)];
    let turn = match crate::providers::complete_turn(&provider, &api_key, &model, &messages, &[], None).await {
        Ok(t) => t,
        Err(e) => {
            eprintln!("[meeting_intelligence] LLM error: {e}");
            return vec![];
        }
    };

    let raw = strip_json_fences(&turn.content);
    serde_json::from_str::<Vec<String>>(raw).unwrap_or_else(|_| {
        // Fallback: return the raw content as a single item
        vec![turn.content.trim().to_string()]
    })
}

// ── Context injection ─────────────────────────────────────────────────────────

/// Brief meeting context for the system prompt — recent meetings and follow-ups needed.
#[allow(dead_code)]
pub fn get_meeting_context() -> String {
    let recent = list_meetings(5);
    if recent.is_empty() {
        return String::new();
    }

    let today = Local::now().date_naive();
    let mut lines = Vec::new();

    for meeting in &recent {
        // Count open action items assigned to "me"
        let my_open: usize = meeting
            .action_items
            .iter()
            .filter(|a| !a.completed && (a.owner.to_lowercase() == "me" || a.owner.is_empty()))
            .count();

        // Check for overdue action items with due dates
        let overdue: Vec<&ActionItem> = meeting
            .action_items
            .iter()
            .filter(|a| {
                !a.completed
                    && a.due_date
                        .as_deref()
                        .and_then(|d| chrono::NaiveDate::parse_from_str(d, "%Y-%m-%d").ok())
                        .map(|due| due < today)
                        .unwrap_or(false)
            })
            .collect();

        let meeting_date = chrono::NaiveDate::parse_from_str(&meeting.date, "%Y-%m-%d").ok();
        let days_ago = meeting_date
            .map(|d| (today - d).num_days())
            .unwrap_or(0);

        let age_str = match days_ago {
            0 => "today".to_string(),
            1 => "yesterday".to_string(),
            n => format!("{n} days ago"),
        };

        let mut line = format!(
            "- '{}' ({}, {})",
            meeting.title, age_str, meeting.meeting_type
        );

        if my_open > 0 {
            line.push_str(&format!(" — {my_open} open action item(s) on you"));
        }

        if !overdue.is_empty() {
            let first = &overdue[0];
            line.push_str(&format!(
                " — OVERDUE: '{}'",
                crate::safe_slice(&first.description, 60)
            ));
        }

        lines.push(line);
    }

    // Surface meetings where follow-up emails haven't been sent (simple heuristic: client meetings)
    let follow_up_needed: Vec<&Meeting> = recent
        .iter()
        .filter(|m| {
            m.meeting_type == "client"
                && chrono::NaiveDate::parse_from_str(&m.date, "%Y-%m-%d")
                    .ok()
                    .map(|d| (today - d).num_days() <= 2)
                    .unwrap_or(false)
        })
        .collect();

    for m in follow_up_needed {
        lines.push(format!(
            "- Follow-up email needed for client meeting '{}' ({})",
            m.title, m.date
        ));
    }

    if lines.is_empty() {
        return String::new();
    }

    format!("## Recent Meetings\n\n{}", lines.join("\n"))
}

/// Returns open action items formatted for system prompt injection.
pub fn get_action_item_context() -> String {
    let open_items = get_open_action_items();
    if open_items.is_empty() {
        return String::new();
    }

    let today = Local::now().date_naive();

    let mut lines = Vec::new();
    for (meeting_title, item) in &open_items {
        let due_str = item
            .due_date
            .as_deref()
            .and_then(|d| chrono::NaiveDate::parse_from_str(d, "%Y-%m-%d").ok())
            .map(|due| {
                let diff = (due - today).num_days();
                match diff {
                    d if d < 0 => format!(" [OVERDUE by {} days]", -d),
                    0 => " [due TODAY]".to_string(),
                    1 => " [due tomorrow]".to_string(),
                    n => format!(" [due in {n} days]"),
                }
            })
            .unwrap_or_default();

        lines.push(format!(
            "- [{}] {} (owner: {}{})",
            meeting_title,
            crate::safe_slice(&item.description, 80),
            item.owner,
            due_str
        ));
    }

    // Limit to 15 most relevant items to avoid bloating the prompt
    let display = if lines.len() > 15 {
        let mut truncated = lines[..15].to_vec();
        truncated.push(format!("  ...and {} more open action items", lines.len() - 15));
        truncated
    } else {
        lines
    };

    format!(
        "## Open Action Items (from meetings)\n\n{}\n\nUse `meeting_complete_action` to mark items done.",
        display.join("\n")
    )
}

// ── Tauri commands ────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn meeting_process(
    title: String,
    date: String,
    transcript: String,
    participants: Vec<String>,
) -> Result<Meeting, String> {
    ensure_tables();
    process_meeting(&title, &date, &transcript, participants).await
}

#[tauri::command]
pub async fn meeting_get(id: String) -> Option<Meeting> {
    ensure_tables();
    get_meeting(&id)
}

#[tauri::command]
pub async fn meeting_list(limit: Option<usize>) -> Vec<Meeting> {
    ensure_tables();
    list_meetings(limit.unwrap_or(50))
}

#[tauri::command]
pub async fn meeting_search(query: String) -> Vec<Meeting> {
    ensure_tables();
    search_meetings(&query)
}

#[tauri::command]
pub async fn meeting_delete(id: String) -> Result<(), String> {
    delete_meeting(&id)
}

#[tauri::command]
pub async fn meeting_get_action_items() -> Vec<serde_json::Value> {
    ensure_tables();
    get_open_action_items()
        .into_iter()
        .map(|(title, item)| {
            serde_json::json!({
                "meeting_title": title,
                "description": item.description,
                "owner": item.owner,
                "due_date": item.due_date,
                "completed": item.completed
            })
        })
        .collect()
}

#[tauri::command]
pub async fn meeting_complete_action(meeting_id: String, item_index: usize) -> Result<(), String> {
    complete_action_item(&meeting_id, item_index)
}

#[tauri::command]
pub async fn meeting_follow_up_email(meeting_id: String, recipient: String) -> String {
    generate_follow_up_email(&meeting_id, &recipient).await
}

#[tauri::command]
pub async fn meeting_compare(ids: Vec<String>) -> String {
    compare_meetings(ids).await
}

#[tauri::command]
pub async fn meeting_recurring_themes(days_back: Option<i32>) -> Vec<String> {
    ensure_tables();
    extract_recurring_themes(days_back.unwrap_or(30)).await
}
