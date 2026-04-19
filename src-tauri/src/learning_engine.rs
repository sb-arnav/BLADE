/// BLADE Learning Engine — behavioral pattern detection and proactive prediction.
///
/// This module watches what the user does over time, builds internal models of
/// their patterns, and predicts what they'll need before they ask. It's the
/// system that makes BLADE feel like it "gets" you.
///
/// Pattern types detected:
///   - time_of_day: when the user is most active (hour, day-of-week clusters)
///   - topic_cluster: recurring subjects in conversation
///   - workflow: repeating tool-use sequences
///   - tool_combo: tools consistently used together
///
/// The engine runs every 30 minutes in the background. High-confidence
/// predictions are surfaced as "blade_suggestion" events (max 1 per 30 min).

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use tauri::Emitter;
use rusqlite::params;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BehaviorPattern {
    pub id: String,
    pub pattern_type: String,
    pub description: String,
    pub frequency: i64,
    pub last_seen: i64,
    pub first_seen: i64,
    pub confidence: f64,
    pub metadata: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserPrediction {
    pub id: String,
    pub prediction: String,
    pub context: String,
    pub confidence: f64,
    pub created_at: i64,
    pub fulfilled: bool,
}

// ---------------------------------------------------------------------------
// Common stop words for topic extraction (words to skip)
// ---------------------------------------------------------------------------

static STOP_WORDS: &[&str] = &[
    "about", "above", "after", "again", "against", "also", "because", "been",
    "before", "being", "below", "between", "both", "cannot", "could", "didn",
    "does", "doing", "don't", "down", "during", "each", "from", "further",
    "have", "having", "here", "how", "into", "itself", "just", "like", "make",
    "more", "most", "myself", "need", "other", "our", "over", "please", "same",
    "should", "since", "some", "such", "than", "that", "their", "them", "then",
    "there", "these", "they", "this", "those", "through", "under", "until",
    "very", "want", "was", "were", "what", "when", "where", "which", "while",
    "will", "with", "would", "your",
];

fn is_stop_word(word: &str) -> bool {
    STOP_WORDS.contains(&word)
}

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

fn open_db() -> Option<rusqlite::Connection> {
    let db_path = crate::config::blade_config_dir().join("blade.db");
    rusqlite::Connection::open(&db_path).ok()
}

/// Ensure the learning engine tables exist. Called once at startup.
fn ensure_tables(conn: &rusqlite::Connection) {
    let _ = conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS behavior_patterns (
            id TEXT PRIMARY KEY,
            pattern_type TEXT NOT NULL,
            description TEXT NOT NULL,
            frequency INTEGER DEFAULT 1,
            last_seen INTEGER NOT NULL,
            first_seen INTEGER NOT NULL,
            confidence REAL DEFAULT 0.5,
            metadata TEXT DEFAULT '{}'
        );
        CREATE TABLE IF NOT EXISTS user_predictions (
            id TEXT PRIMARY KEY,
            prediction TEXT NOT NULL,
            context TEXT NOT NULL,
            confidence REAL DEFAULT 0.5,
            created_at INTEGER NOT NULL,
            fulfilled INTEGER DEFAULT 0,
            fulfilled_at INTEGER
        );",
    );
}

// ---------------------------------------------------------------------------
// Pattern detection
// ---------------------------------------------------------------------------

/// Detect time-of-day and day-of-week activity patterns from the last 30 days.
fn detect_time_patterns() -> Vec<BehaviorPattern> {
    let conn = match open_db() {
        Some(c) => c,
        None => return Vec::new(),
    };

    let cutoff = chrono::Local::now().timestamp() - 30 * 86400;

    // Count activity per hour-of-day
    let hour_counts: HashMap<i64, i64> = {
        let mut stmt = match conn.prepare(
            "SELECT (timestamp / 3600) % 24 AS hour, COUNT(*) as cnt
             FROM activity_timeline
             WHERE timestamp > ?1
             GROUP BY hour
             ORDER BY cnt DESC",
        ) {
            Ok(s) => s,
            Err(_) => return Vec::new(),
        };
        let x: HashMap<i64, i64> = stmt
            .query_map(params![cutoff], |row| {
                Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?))
            })
            .map(|mapped| mapped.filter_map(|r| r.ok()).collect::<HashMap<i64, i64>>())
            .unwrap_or_default();
        x
    };

    // Count activity per day-of-week (0=Sun … 6=Sat in SQLite strftime %w)
    let dow_counts: HashMap<i64, i64> = {
        let mut stmt = match conn.prepare(
            "SELECT CAST(strftime('%w', datetime(timestamp, 'unixepoch')) AS INTEGER) AS dow,
                    COUNT(*) as cnt
             FROM activity_timeline
             WHERE timestamp > ?1
             GROUP BY dow
             ORDER BY cnt DESC",
        ) {
            Ok(s) => s,
            Err(_) => return Vec::new(),
        };
        let x: HashMap<i64, i64> = stmt
            .query_map(params![cutoff], |row| {
                Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?))
            })
            .map(|mapped| mapped.filter_map(|r| r.ok()).collect::<HashMap<i64, i64>>())
            .unwrap_or_default();
        x
    };

    if hour_counts.is_empty() {
        return Vec::new();
    }

    // Find the peak 3-hour window
    let total_activity: i64 = hour_counts.values().sum();
    let mut hours: Vec<(i64, i64)> = hour_counts.into_iter().collect();
    hours.sort_by(|a, b| b.1.cmp(&a.1));

    let (peak_hour, peak_count) = hours[0];
    let peak_fraction = if total_activity > 0 {
        peak_count as f64 / total_activity as f64
    } else {
        0.0
    };

    // Format peak hours into a human readable range (±1 hour around peak)
    let start_h = (peak_hour + 24 - 1) % 24;
    let end_h = (peak_hour + 1) % 24;
    let fmt_hour = |h: i64| -> String {
        let suffix = if h < 12 { "am" } else { "pm" };
        let display = if h == 0 { 12 } else if h > 12 { h - 12 } else { h };
        format!("{}{}", display, suffix)
    };

    // Top active days
    let day_names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    let mut dow_vec: Vec<(i64, i64)> = dow_counts.into_iter().collect();
    dow_vec.sort_by(|a, b| b.1.cmp(&a.1));
    let top_days: Vec<&str> = dow_vec
        .iter()
        .take(3)
        .map(|(d, _)| day_names.get(*d as usize).copied().unwrap_or("?"))
        .collect();

    let description = format!(
        "Most active {}–{} (peak activity window), especially on {}",
        fmt_hour(start_h),
        fmt_hour(end_h),
        top_days.join(", ")
    );

    let confidence = (peak_fraction * 2.0).min(0.95);
    let now = chrono::Local::now().timestamp();
    let id = format!("time_pattern_{}", peak_hour);

    vec![BehaviorPattern {
        id,
        pattern_type: "time_of_day".to_string(),
        description,
        frequency: peak_count,
        last_seen: now,
        first_seen: now,
        confidence,
        metadata: serde_json::json!({
            "peak_hour": peak_hour,
            "top_days": top_days,
        }),
    }]
}

/// Extract recurring topics from recent user messages.
pub fn detect_topic_clusters(recent_exchanges: &[(String, String)]) -> Vec<BehaviorPattern> {
    if recent_exchanges.is_empty() {
        return Vec::new();
    }

    let mut word_counts: HashMap<String, usize> = HashMap::new();

    for (role, content) in recent_exchanges.iter().take(50) {
        // Only look at user messages
        if role != "user" {
            continue;
        }
        for word in content.split_whitespace() {
            // Strip non-alpha chars from edges
            let clean: String = word
                .chars()
                .filter(|c| c.is_alphabetic())
                .collect::<String>()
                .to_lowercase();

            // Only care about substantive words (>5 chars, not stop words)
            if clean.len() > 5 && !is_stop_word(&clean) {
                *word_counts.entry(clean).or_insert(0) += 1;
            }
        }
    }

    // Find words appearing at least 3 times
    let mut topics: Vec<(String, usize)> = word_counts
        .into_iter()
        .filter(|(_, count)| *count >= 3)
        .collect();

    if topics.is_empty() {
        return Vec::new();
    }

    topics.sort_by(|a, b| b.1.cmp(&a.1));
    topics.truncate(8);

    let topic_names: Vec<String> = topics.iter().map(|(w, _)| {
        // Capitalize first letter
        let mut chars = w.chars();
        match chars.next() {
            None => String::new(),
            Some(c) => c.to_uppercase().collect::<String>() + chars.as_str(),
        }
    }).collect();

    let total_mentions: usize = topics.iter().map(|(_, c)| c).sum();
    let max_mentions = topics[0].1;
    let confidence = ((max_mentions as f64 / 5.0) * 0.5).min(0.9) + 0.1;

    let description = format!("Frequently discusses: {}", topic_names.join(", "));
    let now = chrono::Local::now().timestamp();

    vec![BehaviorPattern {
        id: "topic_cluster_main".to_string(),
        pattern_type: "topic_cluster".to_string(),
        description,
        frequency: total_mentions as i64,
        last_seen: now,
        first_seen: now,
        confidence,
        metadata: serde_json::json!({
            "topics": topics.iter().map(|(w, c)| serde_json::json!({"word": w, "count": c})).collect::<Vec<_>>(),
        }),
    }]
}

/// Detect repeating tool-use sequences from the activity timeline (last 7 days).
fn detect_workflow_sequences() -> Vec<BehaviorPattern> {
    let conn = match open_db() {
        Some(c) => c,
        None => return Vec::new(),
    };

    let cutoff = chrono::Local::now().timestamp() - 7 * 86400;

    // Load tool-type events from the timeline in chronological order
    let tool_events: Vec<String> = {
        let mut stmt = match conn.prepare(
            "SELECT event_type FROM activity_timeline
             WHERE timestamp > ?1 AND event_type LIKE 'tool_%'
             ORDER BY timestamp ASC
             LIMIT 500",
        ) {
            Ok(s) => s,
            Err(_) => return Vec::new(),
        };

        let x: Vec<String> = stmt
            .query_map(params![cutoff], |row| row.get::<_, String>(0))
            .map(|mapped| mapped.filter_map(|r| r.ok()).collect::<Vec<_>>())
            .unwrap_or_default();
        x
    };

    if tool_events.len() < 6 {
        return Vec::new();
    }

    // Find 3-grams (3-event sequences) with repetitions
    let mut seq_counts: HashMap<String, usize> = HashMap::new();
    for window in tool_events.windows(3) {
        let key = window.join(" → ");
        *seq_counts.entry(key).or_insert(0) += 1;
    }

    let mut sequences: Vec<(String, usize)> = seq_counts
        .into_iter()
        .filter(|(_, count)| *count >= 2)
        .collect();

    if sequences.is_empty() {
        return Vec::new();
    }

    sequences.sort_by(|a, b| b.1.cmp(&a.1));
    sequences.truncate(3);

    let now = chrono::Local::now().timestamp();

    sequences
        .into_iter()
        .enumerate()
        .map(|(i, (seq, count))| {
            // Strip the tool_ prefix for readability
            let readable = seq.replace("tool_", "");
            let confidence = ((count as f64 / 5.0) * 0.5).min(0.85) + 0.1;

            BehaviorPattern {
                id: format!("workflow_seq_{}", i),
                pattern_type: "workflow".to_string(),
                description: format!("Repeating workflow: {}", readable),
                frequency: count as i64,
                last_seen: now,
                first_seen: now,
                confidence,
                metadata: serde_json::json!({ "sequence": seq, "count": count }),
            }
        })
        .collect()
}

/// Detect tool combinations — tools consistently used in the same session.
fn detect_tool_combos() -> Vec<BehaviorPattern> {
    let conn = match open_db() {
        Some(c) => c,
        None => return Vec::new(),
    };

    let cutoff = chrono::Local::now().timestamp() - 14 * 86400;

    // Load tool events grouped by conversation/session (using 1-hour windows as session proxy)
    let tool_events: Vec<(i64, String)> = {
        let mut stmt = match conn.prepare(
            "SELECT timestamp, event_type FROM activity_timeline
             WHERE timestamp > ?1 AND event_type LIKE 'tool_%'
             ORDER BY timestamp ASC
             LIMIT 1000",
        ) {
            Ok(s) => s,
            Err(_) => return Vec::new(),
        };

        let x: Vec<(i64, String)> = stmt
            .query_map(params![cutoff], |row| {
                Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
            })
            .map(|mapped| mapped.filter_map(|r| r.ok()).collect::<Vec<_>>())
            .unwrap_or_default();
        x
    };

    if tool_events.len() < 4 {
        return Vec::new();
    }

    // Group into 1-hour sessions
    let mut sessions: Vec<Vec<String>> = Vec::new();
    let mut current_session: Vec<String> = Vec::new();
    let mut session_start = tool_events[0].0;

    for (ts, event_type) in &tool_events {
        if ts - session_start > 3600 {
            if !current_session.is_empty() {
                sessions.push(current_session.clone());
                current_session.clear();
            }
            session_start = *ts;
        }
        current_session.push(event_type.clone());
    }
    if !current_session.is_empty() {
        sessions.push(current_session);
    }

    // Count tool pair co-occurrences across sessions
    let mut pair_counts: HashMap<String, usize> = HashMap::new();
    for session in &sessions {
        let unique_tools: std::collections::HashSet<&str> =
            session.iter().map(|s| s.as_str()).collect();
        let mut tools: Vec<&str> = unique_tools.into_iter().collect();
        tools.sort_unstable();

        for i in 0..tools.len() {
            for j in (i + 1)..tools.len() {
                let key = format!("{} + {}", tools[i], tools[j]);
                *pair_counts.entry(key).or_insert(0) += 1;
            }
        }
    }

    let mut pairs: Vec<(String, usize)> = pair_counts
        .into_iter()
        .filter(|(_, count)| *count >= 2)
        .collect();

    if pairs.is_empty() {
        return Vec::new();
    }

    pairs.sort_by(|a, b| b.1.cmp(&a.1));
    pairs.truncate(3);

    let now = chrono::Local::now().timestamp();

    pairs
        .into_iter()
        .enumerate()
        .map(|(i, (pair, count))| {
            let readable = pair.replace("tool_", "");
            let confidence = ((count as f64 / 4.0) * 0.4).min(0.85) + 0.1;

            BehaviorPattern {
                id: format!("tool_combo_{}", i),
                pattern_type: "tool_combo".to_string(),
                description: format!("Often uses together: {}", readable),
                frequency: count as i64,
                last_seen: now,
                first_seen: now,
                confidence,
                metadata: serde_json::json!({ "pair": pair, "session_count": count }),
            }
        })
        .collect()
}

// ---------------------------------------------------------------------------
// Upsert pattern to DB
// ---------------------------------------------------------------------------

fn upsert_pattern(conn: &rusqlite::Connection, pattern: &BehaviorPattern) -> Result<(), String> {
    let metadata_str = serde_json::to_string(&pattern.metadata).unwrap_or_else(|_| "{}".to_string());

    let existing: Option<(i64, f64)> = conn
        .query_row(
            "SELECT frequency, confidence FROM behavior_patterns WHERE id = ?1",
            params![pattern.id],
            |row| Ok((row.get::<_, i64>(0)?, row.get::<_, f64>(1)?)),
        )
        .ok();

    if let Some((old_freq, old_conf)) = existing {
        // Increment frequency, bump confidence slightly for repeating patterns
        let new_freq = old_freq + 1;
        let new_conf = (old_conf + 0.05).min(0.97_f64).max(pattern.confidence);

        conn.execute(
            "UPDATE behavior_patterns
             SET frequency = ?1, last_seen = ?2, confidence = ?3, description = ?4, metadata = ?5
             WHERE id = ?6",
            params![
                new_freq,
                pattern.last_seen,
                new_conf,
                pattern.description,
                metadata_str,
                pattern.id,
            ],
        )
        .map_err(|e| e.to_string())?;
    } else {
        conn.execute(
            "INSERT INTO behavior_patterns
             (id, pattern_type, description, frequency, last_seen, first_seen, confidence, metadata)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                pattern.id,
                pattern.pattern_type,
                pattern.description,
                pattern.frequency,
                pattern.last_seen,
                pattern.first_seen,
                pattern.confidence,
                metadata_str,
            ],
        )
        .map_err(|e| e.to_string())?;
    }

    Ok(())
}

// ---------------------------------------------------------------------------
// Public engine functions
// ---------------------------------------------------------------------------

/// Run all detection passes and upsert patterns to the database.
/// Returns the total count of patterns found/updated.
pub async fn analyze_and_store_patterns() -> usize {
    let conn = match open_db() {
        Some(c) => c,
        None => return 0,
    };
    ensure_tables(&conn);

    let mut all_patterns: Vec<BehaviorPattern> = Vec::new();

    // Time patterns
    let time_pats = detect_time_patterns();
    all_patterns.extend(time_pats);

    // Topic clusters — load recent messages from DB
    let recent_exchanges: Vec<(String, String)> = match conn.prepare(
        "SELECT role, content FROM messages ORDER BY timestamp DESC LIMIT 100",
    ) {
        Ok(mut stmt) => match stmt.query_map([], |row| {
            Ok((
                row.get::<_, String>(0).unwrap_or_default(),
                row.get::<_, String>(1).unwrap_or_default(),
            ))
        }) {
            Ok(mapped) => mapped.filter_map(|r| r.ok()).collect(),
            Err(_) => Vec::new(),
        },
        Err(_) => Vec::new(),
    };

    let topic_pats = detect_topic_clusters(&recent_exchanges);
    all_patterns.extend(topic_pats);

    // Workflow sequences
    let workflow_pats = detect_workflow_sequences();
    all_patterns.extend(workflow_pats);

    // Tool combos
    let combo_pats = detect_tool_combos();
    all_patterns.extend(combo_pats);

    let count = all_patterns.len();

    for pattern in &all_patterns {
        if let Err(e) = upsert_pattern(&conn, pattern) {
            log::warn!("learning_engine: failed to upsert pattern {}: {}", pattern.id, e);
        }
    }

    count
}

/// Given the current context string, generate 2-3 predictions of what the
/// user will need in the next 30 minutes. Stores results and returns them.
pub async fn generate_predictions(current_context: &str) -> Vec<UserPrediction> {
    let conn = match open_db() {
        Some(c) => c,
        None => return Vec::new(),
    };
    ensure_tables(&conn);

    // Load top patterns (by confidence × frequency)
    let patterns: Vec<BehaviorPattern> = {
        let mut stmt = match conn.prepare(
            "SELECT id, pattern_type, description, frequency, last_seen, first_seen, confidence, metadata
             FROM behavior_patterns
             ORDER BY confidence DESC, frequency DESC
             LIMIT 10",
        ) {
            Ok(s) => s,
            Err(_) => return Vec::new(),
        };

        let rows = stmt.query_map([], |row| {
            Ok(BehaviorPattern {
                id: row.get(0)?,
                pattern_type: row.get(1)?,
                description: row.get(2)?,
                frequency: row.get(3)?,
                last_seen: row.get(4)?,
                first_seen: row.get(5)?,
                confidence: row.get(6)?,
                metadata: serde_json::from_str(
                    &row.get::<_, String>(7).unwrap_or_else(|_| "{}".to_string()),
                )
                .unwrap_or(serde_json::Value::Object(Default::default())),
            })
        });

        match rows {
            Ok(mapped) => mapped.filter_map(|r| r.ok()).collect(),
            Err(_) => return Vec::new(),
        }
    };

    if patterns.is_empty() {
        return Vec::new();
    }

    let config = crate::config::load_config();
    if config.api_key.is_empty() && config.provider != "ollama" {
        return Vec::new();
    }

    // Format patterns for the prompt
    let patterns_text: String = patterns
        .iter()
        .map(|p| {
            format!(
                "- [{}] {} (seen {} times, confidence {:.0}%)",
                p.pattern_type,
                p.description,
                p.frequency,
                p.confidence * 100.0
            )
        })
        .collect::<Vec<_>>()
        .join("\n");

    let now = chrono::Local::now();
    let time_str = now.format("%H:%M").to_string();
    let day_str = now.format("%A").to_string();

    let prompt = format!(
        r#"Based on these behavioral patterns for this user:
{patterns_text}

Current context: {context}
Current time: {time} ({day})

What are the 2-3 most likely things this user will need in the next 30 minutes?
Be specific and actionable.

Respond as JSON only, no other text:
[{{"prediction": "...", "confidence": 0.8}}]"#,
        patterns_text = patterns_text,
        context = current_context,
        time = time_str,
        day = day_str,
    );

    // Use cheapest model
    let model = cheapest_model_for_provider(&config.provider, &config.model);

    let messages = vec![crate::providers::ConversationMessage::User(prompt)];
    let turn = match crate::providers::complete_turn(
        &config.provider,
        &config.api_key,
        &model,
        &messages,
        &[],
        config.base_url.as_deref(),
    )
    .await
    {
        Ok(t) => t,
        Err(e) => {
            crate::config::check_and_disable_on_402(&e);
            log::warn!("learning_engine: prediction LLM call failed: {}", e);
            return Vec::new();
        }
    };

    // Parse JSON response
    let raw = turn.content.trim().to_string();
    // Extract the JSON array even if wrapped in markdown fences
    let json_str = if let Some(start) = raw.find('[') {
        if let Some(end) = raw.rfind(']') {
            &raw[start..=end]
        } else {
            &raw
        }
    } else {
        &raw
    };

    #[derive(Deserialize)]
    struct PredItem {
        prediction: String,
        confidence: f64,
    }

    let items: Vec<PredItem> = match serde_json::from_str(json_str) {
        Ok(v) => v,
        Err(e) => {
            log::warn!("learning_engine: failed to parse prediction JSON: {} — raw: {}", e, crate::safe_slice(json_str, 200));
            return Vec::new();
        }
    };

    let created_at = chrono::Local::now().timestamp();
    let mut predictions = Vec::new();

    for item in items.iter().take(3) {
        let id = format!(
            "pred_{}_{}",
            created_at,
            uuid_fragment(&item.prediction)
        );
        let pred = UserPrediction {
            id: id.clone(),
            prediction: item.prediction.clone(),
            context: current_context.to_string(),
            confidence: item.confidence.clamp(0.0, 1.0),
            created_at,
            fulfilled: false,
        };

        let _ = conn.execute(
            "INSERT OR IGNORE INTO user_predictions
             (id, prediction, context, confidence, created_at, fulfilled)
             VALUES (?1, ?2, ?3, ?4, ?5, 0)",
            params![pred.id, pred.prediction, pred.context, pred.confidence, pred.created_at],
        );

        predictions.push(pred);
    }

    predictions
}

/// Emit a "blade_suggestion" event if any prediction exceeds 0.75 confidence.
/// Throttled to at most 1 suggestion per 30 minutes (via atomic timestamp).
pub async fn proactive_suggestion(app: &tauri::AppHandle) {
    static LAST_SUGGESTION_TS: std::sync::atomic::AtomicI64 =
        std::sync::atomic::AtomicI64::new(0);

    let now = chrono::Local::now().timestamp();
    let last = LAST_SUGGESTION_TS.load(Ordering::SeqCst);

    // Throttle: max 1 suggestion per 30 minutes
    if now - last < 30 * 60 {
        return;
    }

    // Build a short context string from recent activity
    let context = build_current_context();

    let predictions = generate_predictions(&context).await;

    for pred in &predictions {
        if pred.confidence > 0.75 {
            // Cerebellum reflex: if this prediction has been fulfilled 3+ times before,
            // it's a learned routine — route through decision_gate for autonomous execution
            // instead of just suggesting.
            let fulfilled_count = count_fulfilled_similar(&pred.prediction);
            if fulfilled_count >= 3 && pred.confidence > 0.85 {
                // This is a reflex — route through decision_gate
                let signal = crate::decision_gate::Signal {
                    source: "cerebellum".to_string(),
                    description: format!("Learned reflex (confirmed {}x): {}", fulfilled_count, pred.prediction),
                    confidence: pred.confidence as f64,
                    reversible: true,
                    time_sensitive: false,
                };
                let perception = crate::perception_fusion::get_latest()
                    .unwrap_or_default();
                let outcome = crate::decision_gate::evaluate(&signal, &perception).await;

                match outcome {
                    crate::decision_gate::DecisionOutcome::ActAutonomously { action, .. } => {
                        let _ = app.emit_to("main", "blade_reflex", serde_json::json!({
                            "prediction": pred.prediction,
                            "action": action,
                            "confidence": pred.confidence,
                            "fulfilled_count": fulfilled_count,
                        }));
                    }
                    _ => {
                        // Decision gate said don't act autonomously — fall back to suggestion
                        let _ = app.emit_to("main", "blade_suggestion", serde_json::json!({
                            "prediction": pred.prediction,
                            "confidence": pred.confidence,
                            "context": pred.context,
                            "id": pred.id,
                            "learned_reflex": true,
                        }));
                    }
                }
            } else {
                let _ = app.emit_to("main", "blade_suggestion",
                    serde_json::json!({
                        "prediction": pred.prediction,
                        "confidence": pred.confidence,
                        "context": pred.context,
                        "id": pred.id,
                    }),
                );
            }
            LAST_SUGGESTION_TS.store(now, Ordering::SeqCst);
            break;
        }
    }
}

/// Count how many times a similar prediction was previously fulfilled.
/// Used by the cerebellum to decide if a pattern is a learned reflex.
fn count_fulfilled_similar(prediction_text: &str) -> i64 {
    let conn = match open_db() {
        Some(c) => c,
        None => return 0,
    };
    let search = format!("%{}%", crate::safe_slice(prediction_text, 50));
    conn.query_row(
        "SELECT COUNT(*) FROM user_predictions WHERE fulfilled = 1 AND prediction LIKE ?1",
        params![search],
        |row| row.get::<_, i64>(0),
    ).unwrap_or(0)
}

/// Mark a prediction as fulfilled when the user actually asks for it.
/// Fulfilled predictions reinforce the system's confidence in the underlying patterns.
#[allow(dead_code)]
pub fn mark_prediction_fulfilled(prediction_text: &str) {
    let conn = match open_db() {
        Some(c) => c,
        None => return,
    };
    ensure_tables(&conn);

    let now = chrono::Local::now().timestamp();
    let search = format!("%{}%", &prediction_text[..prediction_text.len().min(50)]);

    let _ = conn.execute(
        "UPDATE user_predictions
         SET fulfilled = 1, fulfilled_at = ?1
         WHERE fulfilled = 0 AND prediction LIKE ?2",
        params![now, search],
    );
}

/// Generate a weekly markdown summary of what BLADE has learned about the user.
pub async fn weekly_learning_summary() -> String {
    let conn = match open_db() {
        Some(c) => c,
        None => return "No data yet.".to_string(),
    };
    ensure_tables(&conn);

    let patterns: Vec<BehaviorPattern> = {
        let mut stmt = match conn.prepare(
            "SELECT id, pattern_type, description, frequency, last_seen, first_seen, confidence, metadata
             FROM behavior_patterns
             WHERE confidence > 0.6
             ORDER BY confidence DESC, frequency DESC",
        ) {
            Ok(s) => s,
            Err(_) => return "Unable to load patterns.".to_string(),
        };

        let rows = stmt.query_map([], |row| {
            Ok(BehaviorPattern {
                id: row.get(0)?,
                pattern_type: row.get(1)?,
                description: row.get(2)?,
                frequency: row.get(3)?,
                last_seen: row.get(4)?,
                first_seen: row.get(5)?,
                confidence: row.get(6)?,
                metadata: serde_json::from_str(
                    &row.get::<_, String>(7).unwrap_or_else(|_| "{}".to_string()),
                )
                .unwrap_or(serde_json::Value::Object(Default::default())),
            })
        });

        match rows {
            Ok(mapped) => mapped.filter_map(|r| r.ok()).collect(),
            Err(_) => return "Unable to load patterns.".to_string(),
        }
    };

    if patterns.is_empty() {
        return "# What BLADE Has Learned\n\nNot enough data yet. Keep using BLADE and check back in a few days.".to_string();
    }

    // Separate by type
    let mut by_type: HashMap<String, Vec<&BehaviorPattern>> = HashMap::new();
    for p in &patterns {
        by_type.entry(p.pattern_type.clone()).or_default().push(p);
    }

    let mut summary = String::from("# What BLADE Has Learned About You\n\n");

    if let Some(time_pats) = by_type.get("time_of_day") {
        summary.push_str("## Work Rhythm\n");
        for p in time_pats {
            summary.push_str(&format!(
                "- {} *(confidence: {:.0}%)*\n",
                p.description,
                p.confidence * 100.0
            ));
        }
        summary.push('\n');
    }

    if let Some(topics) = by_type.get("topic_cluster") {
        summary.push_str("## Recurring Interests\n");
        for p in topics {
            summary.push_str(&format!(
                "- {} *(mentioned {} times)*\n",
                p.description, p.frequency
            ));
        }
        summary.push('\n');
    }

    if let Some(workflows) = by_type.get("workflow") {
        summary.push_str("## Workflow Patterns\n");
        for p in workflows {
            summary.push_str(&format!(
                "- {} *(repeated {} times)*\n",
                p.description, p.frequency
            ));
        }
        summary.push('\n');
    }

    if let Some(combos) = by_type.get("tool_combo") {
        summary.push_str("## Tool Preferences\n");
        for p in combos {
            summary.push_str(&format!("- {}\n", p.description));
        }
        summary.push('\n');
    }

    // Prediction accuracy stats
    let (total_preds, fulfilled_preds): (i64, i64) = conn
        .query_row(
            "SELECT COUNT(*), SUM(fulfilled) FROM user_predictions",
            [],
            |row| Ok((row.get(0)?, row.get::<_, Option<i64>>(1)?.unwrap_or(0))),
        )
        .unwrap_or((0, 0));

    if total_preds > 0 {
        let accuracy = fulfilled_preds as f64 / total_preds as f64 * 100.0;
        summary.push_str("## Prediction Accuracy\n");
        summary.push_str(&format!(
            "- {}/{} predictions confirmed ({:.0}% accurate)\n\n",
            fulfilled_preds, total_preds, accuracy
        ));
    }

    summary
}

// ---------------------------------------------------------------------------
// Background loop
// ---------------------------------------------------------------------------

/// Start the learning engine background loop.
/// Runs every 30 minutes: detects patterns, then emits proactive suggestions.
pub fn start_learning_engine(app: tauri::AppHandle) {
    static LEARNING_ACTIVE: AtomicBool = AtomicBool::new(false);

    if LEARNING_ACTIVE
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return; // already running
    }

    tauri::async_runtime::spawn(async move {
        // Initial delay — let everything else settle first
        tokio::time::sleep(Duration::from_secs(5 * 60)).await;

        loop {
            let config = crate::config::load_config();
            if !config.background_ai_enabled {
                tokio::time::sleep(Duration::from_secs(30 * 60)).await;
                continue;
            }

            // Vagus nerve: skip LLM pattern analysis in conservation mode
            if crate::homeostasis::energy_mode() < 0.25 {
                tokio::time::sleep(Duration::from_secs(30 * 60)).await;
                continue;
            }

            crate::supervisor::heartbeat("learning_engine");
            let count = analyze_and_store_patterns().await;
            log::info!("learning_engine: analyzed {} patterns", count);

            proactive_suggestion(&app).await;

            // Run prediction engine in the same tick — no need for a separate 30-min loop
            let _ = crate::prediction_engine::generate_predictions(app.clone()).await;

            tokio::time::sleep(Duration::from_secs(30 * 60)).await;
        }
    });
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn learning_get_patterns() -> Vec<BehaviorPattern> {
    let conn = match open_db() {
        Some(c) => c,
        None => return Vec::new(),
    };
    ensure_tables(&conn);

    let mut stmt = match conn.prepare(
        "SELECT id, pattern_type, description, frequency, last_seen, first_seen, confidence, metadata
         FROM behavior_patterns
         ORDER BY confidence DESC, frequency DESC",
    ) {
        Ok(s) => s,
        Err(_) => return Vec::new(),
    };

    let rows = stmt.query_map([], |row| {
        Ok(BehaviorPattern {
            id: row.get(0)?,
            pattern_type: row.get(1)?,
            description: row.get(2)?,
            frequency: row.get(3)?,
            last_seen: row.get(4)?,
            first_seen: row.get(5)?,
            confidence: row.get(6)?,
            metadata: serde_json::from_str(
                &row.get::<_, String>(7).unwrap_or_else(|_| "{}".to_string()),
            )
            .unwrap_or(serde_json::Value::Object(Default::default())),
        })
    });

    match rows {
        Ok(mapped) => mapped.filter_map(|r| r.ok()).collect(),
        Err(_) => Vec::new(),
    }
}

#[tauri::command]
pub async fn learning_get_predictions(context: String) -> Vec<UserPrediction> {
    generate_predictions(&context).await
}

#[tauri::command]
pub async fn learning_run_analysis() -> Result<usize, String> {
    Ok(analyze_and_store_patterns().await)
}

#[tauri::command]
pub async fn learning_weekly_summary() -> String {
    weekly_learning_summary().await
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Build a short context string from recent DB activity for use in proactive suggestions.
fn build_current_context() -> String {
    let conn = match open_db() {
        Some(c) => c,
        None => return "general usage".to_string(),
    };

    // Most recent user message
    let last_msg: Option<String> = conn
        .query_row(
            "SELECT content FROM messages WHERE role = 'user' ORDER BY timestamp DESC LIMIT 1",
            [],
            |row| row.get(0),
        )
        .ok();

    // Active window from context module (best-effort)
    let active_window = crate::context::get_active_window()
        .ok()
        .map(|w| {
            if w.window_title.is_empty() {
                w.app_name
            } else {
                format!("{} — {}", w.app_name, w.window_title)
            }
        })
        .unwrap_or_default();

    match (last_msg, active_window.as_str()) {
        (Some(msg), "") => crate::safe_slice(&msg, 150).to_string(),
        (Some(msg), win) => format!(
            "Working in: {}. Last asked: {}",
            win,
            crate::safe_slice(&msg, 100)
        ),
        (None, win) if !win.is_empty() => format!("Working in: {}", win),
        _ => "general usage".to_string(),
    }
}

fn cheapest_model_for_provider(provider: &str, current_model: &str) -> String {
    crate::config::cheap_model_for_provider(provider, current_model)
}

/// Stable short hash of a string for use as a UUID fragment.
fn uuid_fragment(s: &str) -> String {
    let mut h: u64 = 0xcbf29ce484222325;
    for b in s.bytes() {
        h ^= b as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    format!("{:x}", h)
}
