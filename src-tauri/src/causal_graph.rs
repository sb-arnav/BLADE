/// CAUSAL GRAPH — BLADE's temporal reasoning engine.
///
/// Tracks cause-effect relationships across the user's work over time.
/// Answers "why is this stuck?" and "what's the real blocker here?" by
/// building a causal chain from events (errors, commits, conversations,
/// file changes, test runs) and running LLM analysis over the timeline.
///
/// Every conversation turn is recorded as an event. Every 2 hours, BLADE
/// scans for blockers, regressions, and progress patterns — then injects
/// relevant insights into the system prompt so the next conversation is
/// already context-aware.

use rusqlite::params;
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::Emitter;

// ─── Structs ─────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CausalEvent {
    pub id: String,
    pub event_type: String,
    pub description: String,
    pub context: serde_json::Value,
    pub timestamp: i64,
    pub related_to: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CausalInsight {
    pub id: String,
    pub title: String,
    pub explanation: String,
    pub evidence: String,
    pub confidence: f64,
    pub category: String, // "blocker" | "pattern" | "progress" | "regression"
    pub created_at: i64,
    pub acknowledged: bool,
}

// ─── DB helpers ──────────────────────────────────────────────────────────────

fn db_path() -> std::path::PathBuf {
    crate::config::blade_config_dir().join("blade.db")
}

fn open_conn() -> Result<rusqlite::Connection, String> {
    rusqlite::Connection::open(db_path()).map_err(|e| e.to_string())
}

/// Ensure causal tables exist. Called lazily before every write so there is
/// no hard startup dependency — the module degrades gracefully if the DB is
/// unavailable.
fn ensure_tables(conn: &rusqlite::Connection) {
    let _ = conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS causal_events (
            id TEXT PRIMARY KEY,
            event_type TEXT NOT NULL,
            description TEXT NOT NULL,
            context TEXT DEFAULT '{}',
            timestamp INTEGER NOT NULL,
            related_to TEXT DEFAULT ''
        );
        CREATE TABLE IF NOT EXISTS causal_insights (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            explanation TEXT NOT NULL,
            evidence TEXT NOT NULL,
            confidence REAL DEFAULT 0.7,
            category TEXT DEFAULT 'general',
            created_at INTEGER NOT NULL,
            acknowledged INTEGER DEFAULT 0
        );",
    );
}

// ─── Timestamp formatting ─────────────────────────────────────────────────────

fn relative_time(ts: i64) -> String {
    let now = chrono::Utc::now().timestamp();
    let diff = now - ts;
    if diff < 0 {
        return "just now".to_string();
    }
    match diff {
        0..=59 => "just now".to_string(),
        60..=3599 => format!("{} min ago", diff / 60),
        3600..=86399 => {
            let h = diff / 3600;
            if h == 1 {
                "1 hour ago".to_string()
            } else {
                format!("{} hours ago", h)
            }
        }
        86400..=172799 => "yesterday".to_string(),
        _ => {
            let d = diff / 86400;
            format!("{} days ago", d)
        }
    }
}

// ─── Core: record_event ───────────────────────────────────────────────────────

/// Record a causal event and automatically link it to other recent events
/// within a 5-minute window, building the causal chain.
pub fn record_event(event_type: &str, description: &str, context: serde_json::Value) {
    let conn = match open_conn() {
        Ok(c) => c,
        Err(_) => return,
    };
    ensure_tables(&conn);

    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().timestamp();
    let ctx_str = context.to_string();

    // Find events in the last 5-minute window to auto-link
    let window_start = now - 300;
    let related: Vec<String> = conn
        .prepare(
            "SELECT id FROM causal_events WHERE timestamp >= ?1 AND timestamp < ?2 ORDER BY timestamp DESC LIMIT 10",
        )
        .and_then(|mut stmt| {
            stmt.query_map(params![window_start, now], |row| row.get::<_, String>(0))
                .map(|rows| rows.filter_map(|r| r.ok()).collect())
        })
        .unwrap_or_default();

    let related_str = related.join(",");

    let _ = conn.execute(
        "INSERT OR IGNORE INTO causal_events (id, event_type, description, context, timestamp, related_to)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![id, event_type, description, ctx_str, now, related_str],
    );
}

// ─── Core: get_recent_events ──────────────────────────────────────────────────

/// Return events from the last N hours, optionally filtered by type.
/// Sorted by timestamp descending (newest first).
pub fn get_recent_events(hours: u32, event_type: Option<&str>) -> Vec<CausalEvent> {
    let conn = match open_conn() {
        Ok(c) => c,
        Err(_) => return vec![],
    };
    ensure_tables(&conn);

    let cutoff = chrono::Utc::now().timestamp() - (hours as i64 * 3600);

    let rows: Vec<(String, String, String, String, i64, String)> = if let Some(et) = event_type {
        conn.prepare(
            "SELECT id, event_type, description, context, timestamp, related_to
             FROM causal_events
             WHERE timestamp >= ?1 AND event_type = ?2
             ORDER BY timestamp DESC",
        )
        .and_then(|mut stmt| {
            stmt.query_map(params![cutoff, et], |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                ))
            })
            .map(|rows| rows.filter_map(|r| r.ok()).collect())
        })
        .unwrap_or_default()
    } else {
        conn.prepare(
            "SELECT id, event_type, description, context, timestamp, related_to
             FROM causal_events
             WHERE timestamp >= ?1
             ORDER BY timestamp DESC",
        )
        .and_then(|mut stmt| {
            stmt.query_map(params![cutoff], |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                ))
            })
            .map(|rows| rows.filter_map(|r| r.ok()).collect())
        })
        .unwrap_or_default()
    };

    rows.into_iter()
        .map(|(id, event_type, description, ctx_str, timestamp, related_str)| {
            let context = serde_json::from_str(&ctx_str).unwrap_or(serde_json::json!({}));
            let related_to = if related_str.is_empty() {
                vec![]
            } else {
                related_str
                    .split(',')
                    .filter(|s| !s.is_empty())
                    .map(|s| s.to_string())
                    .collect()
            };
            CausalEvent {
                id,
                event_type,
                description,
                context,
                timestamp,
                related_to,
            }
        })
        .collect()
}

// ─── LLM helper ──────────────────────────────────────────────────────────────

/// Call the cheapest available provider with a one-shot prompt.
/// Tries fast task routing first, falls back to whatever is configured.
async fn llm_complete(prompt: &str) -> Result<String, String> {
    let config = crate::config::load_config();

    // Prefer fast/cheap model for causal analysis
    let (provider, api_key, model) = {
        // Check task routing for a cheap model
        if let Some(fast_provider) = config.task_routing.fast.clone() {
            let key = crate::config::get_provider_key(&fast_provider);
            if !key.is_empty() {
                let model = cheap_model_for(&fast_provider);
                (fast_provider, key, model)
            } else {
                default_llm_triple(&config)
            }
        } else {
            default_llm_triple(&config)
        }
    };

    if api_key.is_empty() && provider != "ollama" {
        return Err("No API key configured".to_string());
    }

    let messages = vec![crate::providers::ConversationMessage::User(prompt.to_string())];
    let turn = crate::providers::complete_turn(&provider, &api_key, &model, &messages, &[], None).await?;
    Ok(turn.content)
}

fn cheap_model_for(provider: &str) -> String {
    match provider {
        "anthropic" => "claude-haiku-4-5".to_string(),
        "openai" => "gpt-4o-mini".to_string(),
        "gemini" => "gemini-2.0-flash".to_string(),
        "groq" => "llama-3.1-8b-instant".to_string(),
        "openrouter" => "google/gemini-2.0-flash".to_string(),
        _ => "llama3".to_string(),
    }
}

fn default_llm_triple(config: &crate::config::BladeConfig) -> (String, String, String) {
    let provider = config.provider.clone();
    let key = config.api_key.clone();
    let model = cheap_model_for(&provider);
    (provider, key, model)
}

// ─── Insight persistence ──────────────────────────────────────────────────────

fn save_insight(conn: &rusqlite::Connection, insight: &CausalInsight) {
    ensure_tables(conn);
    let _ = conn.execute(
        "INSERT OR IGNORE INTO causal_insights
            (id, title, explanation, evidence, confidence, category, created_at, acknowledged)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0)",
        params![
            insight.id,
            insight.title,
            insight.explanation,
            insight.evidence,
            insight.confidence,
            insight.category,
            insight.created_at,
        ],
    );
}

fn parse_insights_from_llm(raw: &str) -> Vec<CausalInsight> {
    // Strip markdown fences if present
    let cleaned = raw
        .trim()
        .trim_start_matches("```json")
        .trim_start_matches("```")
        .trim_end_matches("```")
        .trim();

    let now = chrono::Utc::now().timestamp();

    // Try to find a JSON array in the response
    let json_start = cleaned.find('[').unwrap_or(0);
    let json_end = cleaned.rfind(']').map(|i| i + 1).unwrap_or(cleaned.len());
    let json_slice = &cleaned[json_start..json_end];

    let arr: Vec<serde_json::Value> = match serde_json::from_str(json_slice) {
        Ok(v) => v,
        Err(_) => return vec![],
    };

    arr.into_iter()
        .filter_map(|v| {
            let title = v.get("title")?.as_str()?.to_string();
            let explanation = v.get("explanation")?.as_str()?.to_string();
            let evidence = v
                .get("evidence")
                .and_then(|e| e.as_str())
                .unwrap_or("")
                .to_string();
            let confidence = v
                .get("confidence")
                .and_then(|c| c.as_f64())
                .unwrap_or(0.7);
            let category = v
                .get("category")
                .and_then(|c| c.as_str())
                .unwrap_or("general")
                .to_string();
            Some(CausalInsight {
                id: uuid::Uuid::new_v4().to_string(),
                title,
                explanation,
                evidence,
                confidence,
                category,
                created_at: now,
                acknowledged: false,
            })
        })
        .collect()
}

// ─── analyze_blockers ────────────────────────────────────────────────────────

/// Main intelligence function: given a topic, scan the last 7 days of events,
/// build a timeline narrative, and ask the LLM what's blocking the user.
pub async fn analyze_blockers(topic: &str) -> Vec<CausalInsight> {
    let events = get_recent_events(7 * 24, None);

    // Filter to events that mention the topic (case-insensitive)
    let topic_lower = topic.to_lowercase();
    let relevant: Vec<&CausalEvent> = events
        .iter()
        .filter(|e| e.description.to_lowercase().contains(&topic_lower))
        .take(40) // cap to avoid monster prompts
        .collect();

    if relevant.is_empty() {
        return vec![];
    }

    // Build timeline narrative (most recent first)
    let timeline: Vec<String> = relevant
        .iter()
        .map(|e| {
            format!(
                "[{}] {}: {}",
                relative_time(e.timestamp),
                e.event_type,
                crate::safe_slice(&e.description, 200)
            )
        })
        .collect();

    let timeline_str = timeline.join("\n");

    let prompt = format!(
        "You are analyzing why a user is blocked on a specific topic.\n\n\
         Topic: {topic}\n\n\
         Timeline of relevant events (most recent first):\n{timeline_str}\n\n\
         Analyze the causal chain:\n\
         1. What is the root cause of the blockage?\n\
         2. What pattern do you see repeating?\n\
         3. What specific action would break the deadlock?\n\n\
         Respond as a JSON array with NO other text:\n\
         [{{\"title\": \"...\", \"explanation\": \"...\", \"evidence\": \"...\", \"confidence\": 0.8, \"category\": \"blocker\"}}]",
    );

    let raw = match llm_complete(&prompt).await {
        Ok(r) => r,
        Err(_) => return vec![],
    };

    let insights = parse_insights_from_llm(&raw);

    // Persist to DB
    if let Ok(conn) = open_conn() {
        ensure_tables(&conn);
        for insight in &insights {
            save_insight(&conn, insight);
        }
    }

    insights
}

// ─── detect_regressions ───────────────────────────────────────────────────────

/// Look for errors that increased after a recent git commit — the classic
/// regression signal. Generates an insight if a correlation is found.
pub async fn detect_regressions() -> Vec<CausalInsight> {
    let git_events = get_recent_events(48, Some("git_commit"));
    let error_events = get_recent_events(48, Some("error"));

    if git_events.is_empty() || error_events.is_empty() {
        return vec![];
    }

    // For each commit, check if errors spiked in the 4 hours after it
    let mut insights = Vec::new();

    for commit in &git_events {
        let window_start = commit.timestamp;
        let window_end = commit.timestamp + 4 * 3600;

        let errors_after: Vec<&CausalEvent> = error_events
            .iter()
            .filter(|e| e.timestamp >= window_start && e.timestamp < window_end)
            .collect();

        if errors_after.is_empty() {
            continue;
        }

        // Count errors before this commit in same 4h window (for baseline)
        let pre_start = commit.timestamp - 4 * 3600;
        let errors_before: Vec<&CausalEvent> = error_events
            .iter()
            .filter(|e| e.timestamp >= pre_start && e.timestamp < commit.timestamp)
            .collect();

        // Only flag if errors clearly increased (at least 2 new errors and more than before)
        if errors_after.len() < 2 || errors_after.len() <= errors_before.len() {
            continue;
        }

        let commit_desc = crate::safe_slice(&commit.description, 100);
        let error_types: Vec<String> = errors_after
            .iter()
            .take(3)
            .map(|e| crate::safe_slice(&e.description, 60).to_string())
            .collect();
        let error_summary = error_types.join("; ");

        let evidence = format!(
            "{} errors after commit vs {} before. Errors: {}",
            errors_after.len(),
            errors_before.len(),
            error_summary
        );

        let insight = CausalInsight {
            id: uuid::Uuid::new_v4().to_string(),
            title: format!("Regression detected after commit: {}", commit_desc),
            explanation: format!(
                "The commit '{}' may have introduced a regression. {} new errors appeared within 4 hours of the commit, compared to {} in the same window before. This pattern strongly suggests the commit broke something. Consider reverting or bisecting.",
                commit_desc,
                errors_after.len(),
                errors_before.len()
            ),
            evidence,
            confidence: 0.75,
            category: "regression".to_string(),
            created_at: chrono::Utc::now().timestamp(),
            acknowledged: false,
        };

        if let Ok(conn) = open_conn() {
            ensure_tables(&conn);
            save_insight(&conn, &insight);
        }
        insights.push(insight);
    }

    insights
}

// ─── find_progress_patterns ───────────────────────────────────────────────────

/// Look for what's working — goals completed, tasks succeeded.
/// Find common factors and generate positive reinforcement insight.
pub async fn find_progress_patterns() -> Vec<CausalInsight> {
    let events = get_recent_events(7 * 24, None);

    // Collect "success" signals: git commits, completed goals, successful test runs
    let successes: Vec<&CausalEvent> = events
        .iter()
        .filter(|e| {
            matches!(e.event_type.as_str(), "git_commit" | "goal_attempt" | "test_run")
                && !e.description.to_lowercase().contains("fail")
                && !e.description.to_lowercase().contains("error")
        })
        .take(30)
        .collect();

    if successes.len() < 3 {
        return vec![];
    }

    // Build summary for LLM
    let success_lines: Vec<String> = successes
        .iter()
        .map(|e| {
            format!(
                "[{}] {}: {}",
                relative_time(e.timestamp),
                e.event_type,
                crate::safe_slice(&e.description, 120)
            )
        })
        .collect();

    let prompt = format!(
        "You are analyzing what has been working well for a user.\n\n\
         Successful events from the last 7 days:\n{}\n\n\
         Identify:\n\
         1. What common patterns led to these successes?\n\
         2. What time of day or workflow seems most productive?\n\
         3. What should the user keep doing?\n\n\
         Respond as a JSON array with NO other text:\n\
         [{{\"title\": \"...\", \"explanation\": \"...\", \"evidence\": \"...\", \"confidence\": 0.8, \"category\": \"progress\"}}]",
        success_lines.join("\n")
    );

    let raw = match llm_complete(&prompt).await {
        Ok(r) => r,
        Err(_) => return vec![],
    };

    let insights = parse_insights_from_llm(&raw);

    if let Ok(conn) = open_conn() {
        ensure_tables(&conn);
        for insight in &insights {
            save_insight(&conn, insight);
        }
    }

    insights
}

// ─── run_causal_analysis ─────────────────────────────────────────────────────

/// Full analysis cycle: regressions, progress patterns, blocker analysis on
/// the most-mentioned topic. Emits a "causal_insights" event with the count.
pub async fn run_causal_analysis(app: &tauri::AppHandle) {
    let mut total = 0usize;

    // 1. Regression detection
    let regressions = detect_regressions().await;
    total += regressions.len();

    // 2. Progress patterns
    let progress = find_progress_patterns().await;
    total += progress.len();

    // 3. Find hottest topic in last 24h of conversation events
    let conv_events = get_recent_events(24, Some("conversation"));
    if !conv_events.is_empty() {
        // Simple frequency count on words appearing in descriptions
        let mut word_freq: std::collections::HashMap<String, usize> =
            std::collections::HashMap::new();

        let stopwords = &[
            "the", "a", "an", "is", "it", "in", "on", "at", "to", "for", "of", "and", "or",
            "but", "this", "that", "was", "are", "with", "have", "had", "has", "be", "been",
            "been", "not", "do", "did", "does", "can", "will", "would", "could", "should", "how",
            "what", "why", "when", "where", "who", "my", "i", "me", "we", "you", "he", "she",
            "they", "if", "so", "as", "from", "by", "just", "about", "also", "than",
        ];

        for event in &conv_events {
            for word in event.description.split_whitespace() {
                let w = word
                    .to_lowercase()
                    .trim_matches(|c: char| !c.is_alphanumeric())
                    .to_string();
                if w.len() >= 4 && !stopwords.contains(&w.as_str()) {
                    *word_freq.entry(w).or_insert(0) += 1;
                }
            }
        }

        // Find topic mentioned 3+ times
        if let Some((topic, count)) = word_freq.iter().max_by_key(|(_, c)| *c) {
            if *count >= 3 {
                let blocker_insights = analyze_blockers(topic).await;
                total += blocker_insights.len();
            }
        }
    }

    // Emit count to frontend
    let _ = app.emit("causal_insights", serde_json::json!({ "count": total }));
}

// ─── start_causal_engine ──────────────────────────────────────────────────────

static CAUSAL_ENGINE_RUNNING: AtomicBool = AtomicBool::new(false);

/// Start the background causal analysis loop. Runs every 2 hours.
/// Safe to call multiple times — AtomicBool guard prevents double-start.
pub fn start_causal_engine(app: tauri::AppHandle) {
    if CAUSAL_ENGINE_RUNNING.swap(true, Ordering::SeqCst) {
        return; // already running
    }

    tauri::async_runtime::spawn(async move {
        // Initial delay — let the app settle before first analysis
        tokio::time::sleep(tokio::time::Duration::from_secs(60)).await;

        loop {
            run_causal_analysis(&app).await;
            tokio::time::sleep(tokio::time::Duration::from_secs(2 * 3600)).await;
        }
    });
}

// ─── get_unacknowledged_insights ──────────────────────────────────────────────

/// Return all insights the user has not yet acknowledged.
/// Used to drive proactive nudges.
pub fn get_unacknowledged_insights() -> Vec<CausalInsight> {
    let conn = match open_conn() {
        Ok(c) => c,
        Err(_) => return vec![],
    };
    ensure_tables(&conn);

    conn.prepare(
        "SELECT id, title, explanation, evidence, confidence, category, created_at, acknowledged
         FROM causal_insights
         WHERE acknowledged = 0
         ORDER BY created_at DESC",
    )
    .and_then(|mut stmt| {
        stmt.query_map(params![], |row| {
            Ok(CausalInsight {
                id: row.get(0)?,
                title: row.get(1)?,
                explanation: row.get(2)?,
                evidence: row.get(3)?,
                confidence: row.get(4)?,
                category: row.get(5)?,
                created_at: row.get(6)?,
                acknowledged: row.get::<_, i64>(7)? != 0,
            })
        })
        .map(|rows| rows.filter_map(|r| r.ok()).collect())
    })
    .unwrap_or_default()
}

// ─── acknowledge_insight ──────────────────────────────────────────────────────

/// Mark an insight as acknowledged — removes it from the proactive nudge queue.
pub fn acknowledge_insight(id: &str) {
    let conn = match open_conn() {
        Ok(c) => c,
        Err(_) => return,
    };
    ensure_tables(&conn);
    let _ = conn.execute(
        "UPDATE causal_insights SET acknowledged = 1 WHERE id = ?1",
        params![id],
    );
}

// ─── get_causal_context ───────────────────────────────────────────────────────

/// Return a formatted string for system prompt injection.
/// Finds unacknowledged insights relevant to the current query topic.
pub fn get_causal_context(query: &str) -> String {
    if query.is_empty() {
        return String::new();
    }

    let insights = get_unacknowledged_insights();
    if insights.is_empty() {
        return String::new();
    }

    let query_lower = query.to_lowercase();
    let relevant: Vec<&CausalInsight> = insights
        .iter()
        .filter(|i| {
            i.title.to_lowercase().contains(&query_lower)
                || i.explanation.to_lowercase().contains(&query_lower)
                || i.evidence.to_lowercase().contains(&query_lower)
        })
        .take(3)
        .collect();

    if relevant.is_empty() {
        return String::new();
    }

    let lines: Vec<String> = relevant
        .iter()
        .map(|i| {
            format!(
                "**{}** ({}% confidence, {})\n{}\n_Evidence: {}_",
                i.title,
                (i.confidence * 100.0) as u32,
                i.category,
                i.explanation,
                crate::safe_slice(&i.evidence, 200),
            )
        })
        .collect();

    format!("## Causal Analysis\n\n{}", lines.join("\n\n"))
}

// ─── Tauri commands ───────────────────────────────────────────────────────────

/// Return the most recent causal insights (acknowledged or not).
#[tauri::command]
pub fn causal_get_insights(limit: Option<usize>) -> Vec<CausalInsight> {
    let conn = match open_conn() {
        Ok(c) => c,
        Err(_) => return vec![],
    };
    ensure_tables(&conn);

    let lim = limit.unwrap_or(50) as i64;

    conn.prepare(
        "SELECT id, title, explanation, evidence, confidence, category, created_at, acknowledged
         FROM causal_insights
         ORDER BY created_at DESC
         LIMIT ?1",
    )
    .and_then(|mut stmt| {
        stmt.query_map(params![lim], |row| {
            Ok(CausalInsight {
                id: row.get(0)?,
                title: row.get(1)?,
                explanation: row.get(2)?,
                evidence: row.get(3)?,
                confidence: row.get(4)?,
                category: row.get(5)?,
                created_at: row.get(6)?,
                acknowledged: row.get::<_, i64>(7)? != 0,
            })
        })
        .map(|rows| rows.filter_map(|r| r.ok()).collect())
    })
    .unwrap_or_default()
}

/// Acknowledge a causal insight by ID.
#[tauri::command]
pub fn causal_acknowledge(id: String) -> Result<(), String> {
    acknowledge_insight(&id);
    Ok(())
}

/// Run blocker analysis for a specific topic on demand.
#[tauri::command]
pub async fn causal_analyze(topic: String) -> Result<Vec<CausalInsight>, String> {
    let insights = analyze_blockers(&topic).await;
    Ok(insights)
}

/// Manually record a causal event from the frontend.
#[tauri::command]
pub fn causal_record_event(event_type: String, description: String) -> Result<(), String> {
    record_event(&event_type, &description, serde_json::json!({}));
    Ok(())
}

/// Run the full analysis cycle now and return the count of new insights.
#[tauri::command]
pub async fn causal_run_full_analysis(app: tauri::AppHandle) -> Result<usize, String> {
    let before_count = causal_get_insights(Some(10000)).len();
    run_causal_analysis(&app).await;
    let after_count = causal_get_insights(Some(10000)).len();
    Ok(after_count.saturating_sub(before_count))
}
