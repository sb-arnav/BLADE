/// BLADE PREDICTION ENGINE — Anticipatory intelligence.
///
/// BLADE learns your patterns and predicts what you'll need before you ask.
/// "It's Monday morning — you usually review your goals. Want me to pull up your OKR dashboard?"
/// "You've been coding for 3 hours with no break — time to rest."
///
/// This engine is purely a reader: it analyzes data already in the DB from other modules
/// (execution_memory, messages, habits, etc.) — it never creates new data collection.
/// Pattern detection → context check → prediction generation → Tauri events.
///
/// Architecture:
///   detect_time_routines()      — hour-of-day + day-of-week patterns in conversation history
///   detect_sequential_patterns() — "after X you usually do Y within 30 min" (LLM analysis)
///   detect_frequency_patterns()  — "you check research queue every 2 days"
///   generate_predictions()      — combines detectors, produces 3-5 actionable predictions
///   contextual_prediction()     — immediate follow-up predictions after each user message
///
/// NOTE: No independent loop. `learning_engine::start_learning_engine` drives
/// `generate_predictions()` in its 30-min tick. Do not create a separate loop.

use chrono::{Datelike, Local, Timelike, Weekday};
use rusqlite::params;
use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{Emitter, Manager};

// Note: No independent loop. `learning_engine::start_learning_engine` drives
// `generate_predictions()` directly in its 30-min tick. Do NOT start a separate loop.

// ── Structs ───────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Prediction {
    pub id: String,
    pub prediction_type: String, // "resource_needed", "task_due", "pattern_alert", "suggestion", "reminder"
    pub title: String,
    pub description: String,
    pub action: Option<String>,      // suggested action / command to run
    pub confidence: f32,             // 0.0–1.0
    pub time_window: String,         // "now", "next_hour", "today", "this_week"
    pub was_helpful: Option<bool>,   // user feedback
    pub created_at: i64,
    pub shown_at: Option<i64>,
    pub accepted: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BehaviorPattern {
    pub pattern_type: String,    // "time_routine", "sequence", "frequency", "context_trigger"
    pub description: String,
    pub trigger: String,         // what triggers this pattern
    pub expected_action: String, // what usually follows
    pub confidence: f32,
    pub occurrences: i32,
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn now_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

fn db_path() -> std::path::PathBuf {
    crate::config::blade_config_dir().join("blade.db")
}

fn open_db() -> Result<rusqlite::Connection, String> {
    rusqlite::Connection::open(db_path()).map_err(|e| format!("Prediction DB open failed: {e}"))
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

fn cheap_model(provider: &str) -> String {
    crate::config::cheap_model_for_provider(provider, "")
}

async fn llm_call(system: &str, user_msg: &str) -> Result<String, String> {
    use crate::providers::{complete_turn, ConversationMessage};

    let cfg = crate::config::load_config();
    let provider = cfg.provider.clone();
    let api_key = cfg.api_key.clone();
    let model = cheap_model(&provider);
    let base_url = cfg.base_url.as_deref().map(|s| s.to_string());

    let messages = vec![
        ConversationMessage::System(system.to_string()),
        ConversationMessage::User(user_msg.to_string()),
    ];

    let turn = complete_turn(
        &provider,
        &api_key,
        &model,
        &messages,
        &[],
        base_url.as_deref(),
    )
    .await?;

    Ok(turn.content)
}

// ── DB schema ─────────────────────────────────────────────────────────────────

pub fn ensure_tables() {
    if let Ok(conn) = open_db() {
        let _ = conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS predictions (
                id TEXT PRIMARY KEY,
                prediction_type TEXT NOT NULL DEFAULT 'suggestion',
                title TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                action TEXT,
                confidence REAL NOT NULL DEFAULT 0.5,
                time_window TEXT NOT NULL DEFAULT 'today',
                was_helpful INTEGER,
                created_at INTEGER NOT NULL,
                shown_at INTEGER,
                accepted INTEGER NOT NULL DEFAULT 0
            );

            CREATE INDEX IF NOT EXISTS idx_pred_created ON predictions(created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_pred_accepted ON predictions(accepted);
            CREATE INDEX IF NOT EXISTS idx_pred_confidence ON predictions(confidence DESC);
            ",
        );
    }
}

// ── Pattern detection ─────────────────────────────────────────────────────────

/// Analyze conversation messages by hour-of-day and day-of-week to find time routines.
/// "Every Monday 9am you ask about goals" → routine pattern with high confidence.
/// Reads from the messages table — no new data collection.
pub async fn detect_time_routines() -> Vec<BehaviorPattern> {
    // Collect raw message data before any await
    let rows: Vec<(String, i64)> = {
        match open_db() {
            Ok(conn) => {
                let cutoff = now_secs() - 30 * 24 * 3600; // last 30 days
                let mut stmt = match conn.prepare(
                    "SELECT content, timestamp FROM messages
                     WHERE timestamp > ?1 AND role = 'user'
                     ORDER BY timestamp DESC
                     LIMIT 500",
                ) {
                    Ok(s) => s,
                    Err(_) => return vec![],
                };
                let collected: Vec<(String, i64)> = stmt
                    .query_map(params![cutoff], |row| {
                        Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
                    })
                    .ok()
                    .map(|rows| rows.filter_map(|r| r.ok()).collect())
                    .unwrap_or_default();
                collected
            }
            Err(_) => return vec![],
        }
    };

    if rows.len() < 5 {
        return vec![];
    }

    // Build hour × weekday buckets
    use std::collections::HashMap;
    let mut buckets: HashMap<(u32, u32), Vec<String>> = HashMap::new(); // (hour, weekday) → messages

    for (content, ts) in &rows {
        if let Some(dt) = chrono::DateTime::from_timestamp(*ts, 0) {
            let local = dt.with_timezone(&chrono::Local);
            let hour = local.hour();
            let weekday = local.weekday().num_days_from_monday();
            buckets
                .entry((hour, weekday))
                .or_default()
                .push(crate::safe_slice(content, 120).to_string());
        }
    }

    // Find buckets with 3+ occurrences — these are real routines
    let strong_buckets: Vec<((u32, u32), Vec<String>)> = buckets
        .into_iter()
        .filter(|(_, msgs)| msgs.len() >= 3)
        .collect();

    if strong_buckets.is_empty() {
        return vec![];
    }

    // Build a summary for LLM analysis
    let mut bucket_summary = String::new();
    for ((hour, weekday), msgs) in &strong_buckets {
        let day_name = match weekday {
            0 => "Monday",
            1 => "Tuesday",
            2 => "Wednesday",
            3 => "Thursday",
            4 => "Friday",
            5 => "Saturday",
            _ => "Sunday",
        };
        let sample: Vec<&str> = msgs
            .iter()
            .take(3)
            .map(|s| s.as_str())
            .collect();
        bucket_summary.push_str(&format!(
            "{} at {}:00 ({} occurrences): {}\n",
            day_name,
            hour,
            msgs.len(),
            sample.join(" | ")
        ));
    }

    let system = "You are a behavioral pattern analyst. Analyze the user's recurring conversation patterns by time slot. Return a JSON array of patterns. Each pattern: {\"description\": string, \"trigger\": string, \"expected_action\": string, \"confidence\": float 0-1, \"occurrences\": int}. Be specific and actionable. Max 5 patterns.";
    let user_msg = format!("Identify time-based routines from these conversation clusters:\n{}", bucket_summary);

    let raw = match llm_call(system, &user_msg).await {
        Ok(r) => r,
        Err(_) => return vec![],
    };

    let clean = strip_json_fences(&raw);
    let parsed: Vec<serde_json::Value> = match serde_json::from_str(clean) {
        Ok(v) => v,
        Err(_) => return vec![],
    };

    parsed
        .into_iter()
        .filter_map(|v| {
            Some(BehaviorPattern {
                pattern_type: "time_routine".to_string(),
                description: v["description"].as_str()?.to_string(),
                trigger: v["trigger"].as_str()?.to_string(),
                expected_action: v["expected_action"].as_str()?.to_string(),
                confidence: v["confidence"].as_f64().unwrap_or(0.5) as f32,
                occurrences: v["occurrences"].as_i64().unwrap_or(3) as i32,
            })
        })
        .collect()
}

/// Detect sequential patterns: "after you ask about X, you usually ask about Y within 30min".
/// Uses LLM to analyze conversation history for temporal dependencies.
pub async fn detect_sequential_patterns() -> Vec<BehaviorPattern> {
    // Pull recent conversation pairs before any await
    let history: Vec<String> = {
        match open_db() {
            Ok(conn) => {
                let cutoff = now_secs() - 14 * 24 * 3600; // last 14 days
                let mut stmt = match conn.prepare(
                    "SELECT content FROM messages
                     WHERE timestamp > ?1 AND role = 'user'
                     ORDER BY timestamp ASC
                     LIMIT 200",
                ) {
                    Ok(s) => s,
                    Err(_) => return vec![],
                };
                stmt.query_map(params![cutoff], |row| row.get::<_, String>(0))
                    .ok()
                    .map(|rows| {
                        rows.filter_map(|r| r.ok())
                            .map(|s| crate::safe_slice(&s, 100).to_string())
                            .collect()
                    })
                    .unwrap_or_default()
            }
            Err(_) => return vec![],
        }
    };

    if history.len() < 10 {
        return vec![];
    }

    let conversation_text = history.join("\n---\n");
    let preview = crate::safe_slice(&conversation_text, 4000);

    let system = "You are a behavioral sequence analyst. Find patterns where one type of question/request is often followed by another within the same session. Return JSON array: [{\"description\": string, \"trigger\": string, \"expected_action\": string, \"confidence\": float 0-1, \"occurrences\": int}]. Focus on actionable sequential dependencies. Max 4 patterns.";
    let user_msg = format!("Find sequential conversation patterns (A → B within same session):\n{}", preview);

    let raw = match llm_call(system, &user_msg).await {
        Ok(r) => r,
        Err(_) => return vec![],
    };

    let clean = strip_json_fences(&raw);
    let parsed: Vec<serde_json::Value> = match serde_json::from_str(clean) {
        Ok(v) => v,
        Err(_) => return vec![],
    };

    parsed
        .into_iter()
        .filter_map(|v| {
            Some(BehaviorPattern {
                pattern_type: "sequence".to_string(),
                description: v["description"].as_str()?.to_string(),
                trigger: v["trigger"].as_str()?.to_string(),
                expected_action: v["expected_action"].as_str()?.to_string(),
                confidence: v["confidence"].as_f64().unwrap_or(0.4) as f32,
                occurrences: v["occurrences"].as_i64().unwrap_or(2) as i32,
            })
        })
        .collect()
}

/// Detect frequency patterns: "you check your research queue every 2 days".
/// Analyzes message timestamps to find periodic behaviors.
pub async fn detect_frequency_patterns() -> Vec<BehaviorPattern> {
    // Gather topic-timestamp data before any await
    let rows: Vec<(String, i64)> = {
        match open_db() {
            Ok(conn) => {
                let cutoff = now_secs() - 60 * 24 * 3600; // last 60 days
                let mut stmt = match conn.prepare(
                    "SELECT content, timestamp FROM messages
                     WHERE timestamp > ?1 AND role = 'user'
                     ORDER BY timestamp ASC
                     LIMIT 600",
                ) {
                    Ok(s) => s,
                    Err(_) => return vec![],
                };
                stmt.query_map(params![cutoff], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
                })
                .ok()
                .map(|rows| {
                    rows.filter_map(|r| r.ok())
                        .map(|(s, ts)| (crate::safe_slice(&s, 80).to_string(), ts))
                        .collect()
                })
                .unwrap_or_default()
            }
            Err(_) => return vec![],
        }
    };

    if rows.len() < 10 {
        return vec![];
    }

    // Summarize: group into day-level buckets and describe activity density
    use std::collections::HashMap;
    let mut day_topics: HashMap<i64, Vec<String>> = HashMap::new();
    for (content, ts) in &rows {
        let day = ts / 86400;
        day_topics.entry(day).or_default().push(content.clone());
    }

    let mut day_summary = String::new();
    let mut days: Vec<i64> = day_topics.keys().copied().collect();
    days.sort();
    for day in days.iter().take(30) {
        let msgs = &day_topics[day];
        let dt = chrono::DateTime::from_timestamp(day * 86400, 0)
            .map(|d| d.with_timezone(&chrono::Local).format("%Y-%m-%d (%a)").to_string())
            .unwrap_or_default();
        let preview: Vec<&str> = msgs.iter().take(2).map(|s| s.as_str()).collect();
        day_summary.push_str(&format!("{}: {}\n", dt, preview.join(" | ")));
    }

    let system = "You are a behavioral frequency analyst. Identify how often the user engages with specific topics or tasks across days. Return JSON array: [{\"description\": string, \"trigger\": string, \"expected_action\": string, \"confidence\": float 0-1, \"occurrences\": int}]. Focus on frequency patterns like 'every 2 days', 'weekly', 'every Monday'. Max 4 patterns.";
    let user_msg = format!("Find frequency patterns in this daily activity log:\n{}", day_summary);

    let raw = match llm_call(system, &user_msg).await {
        Ok(r) => r,
        Err(_) => return vec![],
    };

    let clean = strip_json_fences(&raw);
    let parsed: Vec<serde_json::Value> = match serde_json::from_str(clean) {
        Ok(v) => v,
        Err(_) => return vec![],
    };

    parsed
        .into_iter()
        .filter_map(|v| {
            Some(BehaviorPattern {
                pattern_type: "frequency".to_string(),
                description: v["description"].as_str()?.to_string(),
                trigger: v["trigger"].as_str()?.to_string(),
                expected_action: v["expected_action"].as_str()?.to_string(),
                confidence: v["confidence"].as_f64().unwrap_or(0.4) as f32,
                occurrences: v["occurrences"].as_i64().unwrap_or(2) as i32,
            })
        })
        .collect()
}

// ── Prediction generation ─────────────────────────────────────────────────────

/// Core prediction engine.
/// 1. Runs all 3 detectors
/// 2. Checks current time/context
/// 3. Generates 3-5 actionable predictions
/// 4. Saves to DB
/// 5. Emits blade_prediction events for high-confidence predictions (>0.75)
pub async fn generate_predictions(app: tauri::AppHandle) -> Vec<Prediction> {
    ensure_tables();

    // Run all three detectors concurrently
    let (time_routines, seq_patterns, freq_patterns) = tokio::join!(
        detect_time_routines(),
        detect_sequential_patterns(),
        detect_frequency_patterns(),
    );

    let all_patterns: Vec<BehaviorPattern> = time_routines
        .into_iter()
        .chain(seq_patterns.into_iter())
        .chain(freq_patterns.into_iter())
        .collect();

    if all_patterns.is_empty() {
        return vec![];
    }

    // Current context
    let now = Local::now();
    let hour = now.hour();
    let weekday = match now.weekday() {
        Weekday::Mon => "Monday",
        Weekday::Tue => "Tuesday",
        Weekday::Wed => "Wednesday",
        Weekday::Thu => "Thursday",
        Weekday::Fri => "Friday",
        Weekday::Sat => "Saturday",
        Weekday::Sun => "Sunday",
    };

    // Session length — how long has this session been running (from last messages)
    let session_minutes: i64 = {
        match open_db() {
            Ok(conn) => {
                let first_ts: Option<i64> = conn
                    .query_row(
                        "SELECT MIN(timestamp) FROM messages WHERE timestamp > ?1",
                        params![now_secs() - 4 * 3600],
                        |row| row.get(0),
                    )
                    .ok()
                    .flatten();
                first_ts.map(|ts| (now_secs() - ts) / 60).unwrap_or(0)
            }
            Err(_) => 0,
        }
    };

    // Build pattern summary for LLM
    let pattern_text: Vec<String> = all_patterns
        .iter()
        .map(|p| {
            format!(
                "[{}] {} | Trigger: {} | Expected: {} | Confidence: {:.0}% | Occurrences: {}",
                p.pattern_type,
                p.description,
                p.trigger,
                p.expected_action,
                p.confidence * 100.0,
                p.occurrences
            )
        })
        .collect();

    let context = format!(
        "Current time: {}:00 on {} | Session running: {} minutes | Patterns detected:\n{}",
        hour,
        weekday,
        session_minutes,
        pattern_text.join("\n")
    );

    let system = r#"You are BLADE's prediction engine. Given behavioral patterns and current context, generate 3-5 specific, actionable predictions about what the user needs RIGHT NOW or very soon.

Return a JSON array of predictions:
[{
  "prediction_type": "resource_needed|task_due|pattern_alert|suggestion|reminder",
  "title": "short title (max 8 words)",
  "description": "1-2 sentence explanation referencing the specific pattern",
  "action": "specific command or action string, or null",
  "confidence": 0.0-1.0,
  "time_window": "now|next_hour|today|this_week"
}]

Rules:
- Only generate predictions that are RELEVANT to the current time/context
- Higher confidence = pattern matches current moment precisely
- action should be a BLADE-executable suggestion when possible
- Be specific: mention exact topics, times, or patterns observed"#;

    let raw = match llm_call(system, &context).await {
        Ok(r) => r,
        Err(_) => return vec![],
    };

    let clean = strip_json_fences(&raw);
    let parsed: Vec<serde_json::Value> = match serde_json::from_str(clean) {
        Ok(v) => v,
        Err(_) => return vec![],
    };

    let ts = now_secs();
    let mut predictions: Vec<Prediction> = parsed
        .into_iter()
        .filter_map(|v| {
            let confidence = v["confidence"].as_f64().unwrap_or(0.5) as f32;
            Some(Prediction {
                id: new_id(),
                prediction_type: v["prediction_type"]
                    .as_str()
                    .unwrap_or("suggestion")
                    .to_string(),
                title: v["title"].as_str()?.to_string(),
                description: v["description"].as_str().unwrap_or("").to_string(),
                action: v["action"].as_str().map(|s| s.to_string()),
                confidence,
                time_window: v["time_window"]
                    .as_str()
                    .unwrap_or("today")
                    .to_string(),
                was_helpful: None,
                created_at: ts,
                shown_at: None,
                accepted: false,
            })
        })
        .collect();

    // Sort by confidence descending
    predictions.sort_by(|a, b| b.confidence.partial_cmp(&a.confidence).unwrap_or(std::cmp::Ordering::Equal));
    let predictions: Vec<Prediction> = predictions.into_iter().take(5).collect();

    // Save to DB (all DB ops before any further await)
    {
        if let Ok(conn) = open_db() {
            for pred in &predictions {
                let _ = conn.execute(
                    "INSERT OR IGNORE INTO predictions
                     (id, prediction_type, title, description, action, confidence, time_window, was_helpful, created_at, shown_at, accepted)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, NULL, ?8, NULL, 0)",
                    params![
                        pred.id,
                        pred.prediction_type,
                        pred.title,
                        pred.description,
                        pred.action,
                        pred.confidence as f64,
                        pred.time_window,
                        pred.created_at,
                    ],
                );
            }
        }
    }

    // Emit high-confidence predictions as Tauri events
    for pred in &predictions {
        if pred.confidence > 0.75 {
            let _ = app.emit_to("main", "blade_prediction", pred.clone());
        }
    }

    predictions
}

// ── Pending / feedback ────────────────────────────────────────────────────────

/// Return all predictions that have not been dismissed (accepted = false, was_helpful = null).
pub fn get_pending_predictions() -> Vec<Prediction> {
    ensure_tables();
    match open_db() {
        Ok(conn) => {
            // Only return predictions from the last 24 hours that haven't been acted on
            let cutoff = now_secs() - 24 * 3600;
            let mut stmt = match conn.prepare(
                "SELECT id, prediction_type, title, description, action, confidence, time_window,
                        was_helpful, created_at, shown_at, accepted
                 FROM predictions
                 WHERE accepted = 0 AND was_helpful IS NULL AND created_at > ?1
                 ORDER BY confidence DESC, created_at DESC
                 LIMIT 10",
            ) {
                Ok(s) => s,
                Err(_) => return vec![],
            };
            stmt.query_map(params![cutoff], |row| {
                Ok(Prediction {
                    id: row.get(0)?,
                    prediction_type: row.get(1)?,
                    title: row.get(2)?,
                    description: row.get(3)?,
                    action: row.get(4)?,
                    confidence: row.get::<_, f64>(5)? as f32,
                    time_window: row.get(6)?,
                    was_helpful: row.get::<_, Option<i32>>(7)?.map(|v| v != 0),
                    created_at: row.get(8)?,
                    shown_at: row.get(9)?,
                    accepted: row.get::<_, i32>(10)? != 0,
                })
            })
            .ok()
            .map(|rows| rows.filter_map(|r| r.ok()).collect())
            .unwrap_or_default()
        }
        Err(_) => vec![],
    }
}

/// Accept a prediction. Marks it as accepted and increments confidence calibration.
pub fn accept_prediction(id: &str) -> Result<(), String> {
    ensure_tables();
    let conn = open_db()?;
    let ts = now_secs();
    conn.execute(
        "UPDATE predictions SET accepted = 1, shown_at = ?2, was_helpful = 1 WHERE id = ?1",
        params![id, ts],
    )
    .map_err(|e| format!("Accept prediction failed: {e}"))?;
    Ok(())
}

/// Dismiss a prediction with helpfulness feedback.
/// When helpful=false, future predictions of the same type get lower base confidence.
pub fn dismiss_prediction(id: &str, helpful: bool) -> Result<(), String> {
    ensure_tables();
    let conn = open_db()?;
    let ts = now_secs();
    let helpful_int: i32 = if helpful { 1 } else { 0 };
    conn.execute(
        "UPDATE predictions SET was_helpful = ?2, shown_at = ?3 WHERE id = ?1",
        params![id, helpful_int, ts],
    )
    .map_err(|e| format!("Dismiss prediction failed: {e}"))?;

    // Calibration: if marked not helpful, slightly penalize similar future predictions
    // by storing a negative calibration entry in db settings
    if !helpful {
        // Get the prediction_type for this id to record calibration signal
        let pred_type: Option<String> = conn
            .query_row(
                "SELECT prediction_type FROM predictions WHERE id = ?1",
                params![id],
                |row| row.get(0),
            )
            .ok();

        if let Some(pred_type) = pred_type {
            let key = format!("prediction_calibration_{}", pred_type);
            // Read existing penalty count
            let existing: i64 = conn
                .query_row(
                    "SELECT CAST(value AS INTEGER) FROM settings WHERE key = ?1",
                    params![key],
                    |row| row.get(0),
                )
                .unwrap_or(0);
            let new_val = existing + 1;
            let _ = conn.execute(
                "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
                params![key, new_val.to_string()],
            );
        }
    }

    Ok(())
}

// ── Contextual prediction ─────────────────────────────────────────────────────

/// Given what the user just asked/did, predict what they'll need next.
/// Called from commands.rs after each message (fire-and-forget).
pub async fn contextual_prediction(current_context: &str) -> Vec<Prediction> {
    ensure_tables();

    if current_context.trim().is_empty() {
        return vec![];
    }

    // Get recent context: last few messages for follow-up prediction
    let recent_msgs: Vec<String> = {
        match open_db() {
            Ok(conn) => {
                let cutoff = now_secs() - 2 * 3600;
                let mut stmt = match conn.prepare(
                    "SELECT content FROM messages
                     WHERE timestamp > ?1 AND role = 'user'
                     ORDER BY timestamp DESC
                     LIMIT 5",
                ) {
                    Ok(s) => s,
                    Err(_) => return vec![],
                };
                stmt.query_map(params![cutoff], |row| row.get::<_, String>(0))
                    .ok()
                    .map(|rows| {
                        rows.filter_map(|r| r.ok())
                            .map(|s| crate::safe_slice(&s, 100).to_string())
                            .collect()
                    })
                    .unwrap_or_default()
            }
            Err(_) => return vec![],
        }
    };

    let now = Local::now();
    let context_block = format!(
        "Current user message: {}\n\nRecent session context:\n{}\n\nTime: {}:00 {}",
        crate::safe_slice(current_context, 300),
        recent_msgs.join("\n"),
        now.hour(),
        match now.weekday() {
            Weekday::Mon => "Monday",
            Weekday::Tue => "Tuesday",
            Weekday::Wed => "Wednesday",
            Weekday::Thu => "Thursday",
            Weekday::Fri => "Friday",
            Weekday::Sat => "Saturday",
            Weekday::Sun => "Sunday",
        }
    );

    let system = r#"You are BLADE's contextual predictor. Based on what the user just did, predict 1-3 things they'll likely need next within the next 30 minutes.

Return JSON array:
[{
  "prediction_type": "resource_needed|task_due|pattern_alert|suggestion|reminder",
  "title": "short title (max 8 words)",
  "description": "1 sentence prediction with reasoning",
  "action": "specific BLADE command or action, or null",
  "confidence": 0.0-1.0,
  "time_window": "now|next_hour|today|this_week"
}]

Only return high-confidence predictions (>0.6). Return [] if nothing relevant."#;

    let raw = match llm_call(system, &context_block).await {
        Ok(r) => r,
        Err(_) => return vec![],
    };

    let clean = strip_json_fences(&raw);
    let parsed: Vec<serde_json::Value> = match serde_json::from_str(clean) {
        Ok(v) => v,
        Err(_) => return vec![],
    };

    let ts = now_secs();
    let predictions: Vec<Prediction> = parsed
        .into_iter()
        .filter_map(|v| {
            let confidence = v["confidence"].as_f64().unwrap_or(0.5) as f32;
            if confidence < 0.6 {
                return None;
            }
            Some(Prediction {
                id: new_id(),
                prediction_type: v["prediction_type"]
                    .as_str()
                    .unwrap_or("suggestion")
                    .to_string(),
                title: v["title"].as_str()?.to_string(),
                description: v["description"].as_str().unwrap_or("").to_string(),
                action: v["action"].as_str().map(|s| s.to_string()),
                confidence,
                time_window: v["time_window"].as_str().unwrap_or("next_hour").to_string(),
                was_helpful: None,
                created_at: ts,
                shown_at: None,
                accepted: false,
            })
        })
        .collect();

    // Save to DB
    {
        if let Ok(conn) = open_db() {
            for pred in &predictions {
                let _ = conn.execute(
                    "INSERT OR IGNORE INTO predictions
                     (id, prediction_type, title, description, action, confidence, time_window, was_helpful, created_at, shown_at, accepted)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, NULL, ?8, NULL, 0)",
                    params![
                        pred.id,
                        pred.prediction_type,
                        pred.title,
                        pred.description,
                        pred.action,
                        pred.confidence as f64,
                        pred.time_window,
                        pred.created_at,
                    ],
                );
            }
        }
    }

    predictions
}

// ── Context string for system prompt ─────────────────────────────────────────

/// Returns a compact string for injection into the system prompt.
/// "BLADE predictions: You usually check news at this time. Deadline approaching: project X due Friday."
pub fn get_prediction_context() -> String {
    ensure_tables();
    let pending = get_pending_predictions();
    if pending.is_empty() {
        return String::new();
    }

    let lines: Vec<String> = pending
        .iter()
        .take(3)
        .map(|p| {
            format!(
                "• {} ({}% confidence, {}): {}",
                p.title,
                (p.confidence * 100.0) as i32,
                p.time_window,
                crate::safe_slice(&p.description, 120)
            )
        })
        .collect();

    format!("## BLADE Predictions\n\nBased on your patterns:\n{}", lines.join("\n"))
}

// ── Tauri commands ────────────────────────────────────────────────────────────

#[tauri::command]
pub fn prediction_get_pending() -> Vec<Prediction> {
    get_pending_predictions()
}

#[tauri::command]
pub fn prediction_accept(id: String) -> Result<(), String> {
    accept_prediction(&id)
}

#[tauri::command]
pub fn prediction_dismiss(id: String, helpful: bool) -> Result<(), String> {
    dismiss_prediction(&id, helpful)
}

#[tauri::command]
pub async fn prediction_generate_now(app: tauri::AppHandle) -> Vec<Prediction> {
    generate_predictions(app).await
}

#[tauri::command]
pub async fn prediction_contextual(current_context: String) -> Vec<Prediction> {
    contextual_prediction(&current_context).await
}

#[tauri::command]
pub async fn prediction_get_patterns() -> Vec<BehaviorPattern> {
    // Run all three detectors and return combined patterns
    let (time_routines, seq_patterns, freq_patterns) = tokio::join!(
        detect_time_routines(),
        detect_sequential_patterns(),
        detect_frequency_patterns(),
    );

    time_routines
        .into_iter()
        .chain(seq_patterns.into_iter())
        .chain(freq_patterns.into_iter())
        .collect()
}
