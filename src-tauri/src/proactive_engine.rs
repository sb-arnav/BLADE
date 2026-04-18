/// PROACTIVE ENGINE — BLADE's autonomous initiative layer.
///
/// This is what separates a reactive chatbot from an actual AI agent. BLADE monitors
/// signals in the background and acts before being asked — diagnosing errors, warning
/// about deadlines, detecting when you're stuck, and nudging you to take a break.
///
/// Each detector is independently guarded by a cooldown rule so signals don't spam.
/// Every fired action is saved to DB, emitted as a Tauri event, and tracked for
/// feedback (accepted / dismissed). Dismissed actions incrementally raise the
/// rule threshold so BLADE learns what level of proactivity you actually want.

use rusqlite::params;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{Emitter, Manager};

// ── Static guard ──────────────────────────────────────────────────────────────

static ENGINE_RUNNING: AtomicBool = AtomicBool::new(false);

// ── Structs ───────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProactiveAction {
    pub id: String,
    pub action_type: String,
    pub trigger: String,
    pub content: String,
    pub confidence: f64,
    pub accepted: i32,  // -1 = pending, 0 = dismissed, 1 = accepted
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProactiveRule {
    pub id: String,
    pub rule_type: String,
    pub enabled: bool,
    pub threshold: f64,
    pub cooldown_minutes: i64,
    pub last_fired: Option<i64>,
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

fn open_conn() -> Option<rusqlite::Connection> {
    rusqlite::Connection::open(db_path()).ok()
}

/// Select the cheapest model available for the current provider — all
/// proactive checks run in background and cost should be near-zero.
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
    .await
    .map_err(|e| { crate::config::check_and_disable_on_402(&e); e })?;

    Ok(turn.content)
}

// ── Database schema ───────────────────────────────────────────────────────────

fn ensure_tables(conn: &rusqlite::Connection) {
    let _ = conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS proactive_actions (
            id TEXT PRIMARY KEY,
            action_type TEXT NOT NULL,
            trigger TEXT NOT NULL,
            content TEXT NOT NULL,
            confidence REAL NOT NULL,
            accepted INTEGER DEFAULT -1,
            created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS proactive_rules (
            id TEXT PRIMARY KEY,
            rule_type TEXT NOT NULL,
            enabled INTEGER DEFAULT 1,
            threshold REAL DEFAULT 0.7,
            cooldown_minutes INTEGER DEFAULT 30,
            last_fired INTEGER
        );",
    );
}

fn ensure_default_rules(conn: &rusqlite::Connection) {
    // (rule_type, enabled, threshold, cooldown_minutes)
    let defaults: Vec<(&str, bool, f64, i64)> = vec![
        ("stuck_detection", true, 0.8, 10),
        ("workflow_repetition", true, 0.75, 60),
        ("deadline_warning", true, 0.9, 360),
        ("context_switch", false, 0.6, 5), // off by default — too noisy
        ("energy_check", true, 0.7, 90),
        ("user_model_prediction", true, 0.7, 30), // UserModel-driven behavioral prediction
    ];

    for (rule_type, enabled, threshold, cooldown) in defaults {
        let id = format!("rule_{}", rule_type);
        let _ = conn.execute(
            "INSERT OR IGNORE INTO proactive_rules
             (id, rule_type, enabled, threshold, cooldown_minutes, last_fired)
             VALUES (?1, ?2, ?3, ?4, ?5, NULL)",
            params![id, rule_type, enabled as i64, threshold, cooldown],
        );
    }
}

// ── Rule helpers ──────────────────────────────────────────────────────────────

fn get_rule(conn: &rusqlite::Connection, rule_type: &str) -> Option<ProactiveRule> {
    let id = format!("rule_{}", rule_type);
    conn.query_row(
        "SELECT id, rule_type, enabled, threshold, cooldown_minutes, last_fired
         FROM proactive_rules WHERE id = ?1",
        params![id],
        |row| {
            Ok(ProactiveRule {
                id: row.get(0)?,
                rule_type: row.get(1)?,
                enabled: row.get::<_, i64>(2)? != 0,
                threshold: row.get(3)?,
                cooldown_minutes: row.get(4)?,
                last_fired: row.get(5)?,
            })
        },
    )
    .ok()
}

/// Returns true if the rule's cooldown has elapsed (or it has never fired).
fn cooldown_elapsed(rule: &ProactiveRule) -> bool {
    match rule.last_fired {
        None => true,
        Some(ts) => {
            let elapsed_minutes = (now_secs() - ts) / 60;
            elapsed_minutes >= rule.cooldown_minutes
        }
    }
}

fn mark_rule_fired(conn: &rusqlite::Connection, rule_type: &str) {
    let id = format!("rule_{}", rule_type);
    let _ = conn.execute(
        "UPDATE proactive_rules SET last_fired = ?1 WHERE id = ?2",
        params![now_secs(), id],
    );
}

// ── Persist and emit ──────────────────────────────────────────────────────────

fn save_action(conn: &rusqlite::Connection, action: &ProactiveAction) -> Result<(), String> {
    conn.execute(
        "INSERT OR IGNORE INTO proactive_actions
         (id, action_type, trigger, content, confidence, accepted, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            action.id,
            action.action_type,
            action.trigger,
            action.content,
            action.confidence,
            action.accepted,
            action.created_at,
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

// ── Detector: stuck_detection ─────────────────────────────────────────────────

/// Checks if the same error hash appears 3+ times in the last 10 minutes.
/// If so, asks the LLM to diagnose it and offers a fix.
async fn detect_stuck_pattern() -> Option<ProactiveAction> {
    let events = crate::causal_graph::get_recent_events(1, Some("error"));

    // Only consider the last 10 minutes
    let window = now_secs() - 600;
    let recent_errors: Vec<_> = events.iter().filter(|e| e.timestamp >= window).collect();

    if recent_errors.is_empty() {
        return None;
    }

    // Build a frequency map by description hash (first 120 chars as proxy)
    let mut freq: HashMap<String, usize> = HashMap::new();
    for ev in &recent_errors {
        let key: String = ev.description.chars().take(120).collect();
        *freq.entry(key).or_insert(0) += 1;
    }

    // Find an error that's been seen 3+ times
    let repeated = freq.into_iter().find(|(_, count)| *count >= 3);
    let (error_text, count) = repeated?;

    let system = "You are BLADE, a local-first AI agent. The user is stuck on a repeating error. \
                  Diagnose the root cause in 2-3 sentences and suggest the single most likely fix. \
                  Be direct — no preamble, no markdown headers. Plain text only.";

    let user_msg = format!(
        "This error has appeared {} times in the last 10 minutes:\n\n{}\n\n\
         What is the root cause and the most likely fix?",
        count, error_text
    );

    let content = match llm_call(system, &user_msg).await {
        Ok(s) => s,
        Err(_) => return None,
    };

    Some(ProactiveAction {
        id: new_id(),
        action_type: "StuckDetection".to_string(),
        trigger: format!("Error appeared {} times in 10 min: {}", count, crate::safe_slice(&error_text, 80)),
        content,
        confidence: 0.85,
        accepted: -1,
        created_at: now_secs(),
    })
}

// ── Detector: workflow_repetition ─────────────────────────────────────────────

/// Queries behavior_patterns for workflow sequences seen 3+ times in the last 2 hours.
/// Offers to automate the pattern.
async fn detect_workflow_repetition() -> Option<ProactiveAction> {
    let conn = open_conn()?;
    ensure_tables(&conn);

    // Query the learning_engine behavior_patterns table directly
    let cutoff = now_secs() - 7200; // last 2 hours
    let pattern: Option<(String, i64)> = conn
        .query_row(
            "SELECT description, frequency FROM behavior_patterns
             WHERE pattern_type = 'workflow'
               AND last_seen >= ?1
               AND frequency >= 3
             ORDER BY frequency DESC
             LIMIT 1",
            params![cutoff],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)),
        )
        .ok();

    let (desc, freq) = pattern?;

    // Strip the "Repeating workflow: " prefix if present
    let sequence = desc
        .strip_prefix("Repeating workflow: ")
        .unwrap_or(&desc)
        .to_string();

    let content = format!(
        "I noticed you keep doing \"{sequence}\" — that's happened {freq} times recently. \
         Want me to automate this workflow so it runs with one command?"
    );

    Some(ProactiveAction {
        id: new_id(),
        action_type: "WorkflowSuggestion".to_string(),
        trigger: format!("Workflow repeated {} times: {}", freq, crate::safe_slice(&sequence, 80)),
        content,
        confidence: 0.75,
        accepted: -1,
        created_at: now_secs(),
    })
}

// ── Detector: deadline_warning ────────────────────────────────────────────────

/// Checks active goals for approaching deadlines or low-completion, stalled goals.
async fn detect_approaching_deadline() -> Option<ProactiveAction> {
    let goals = crate::goal_engine::get_active_goals();

    let now = now_secs();
    let three_days = 3 * 86400_i64;

    // Find goals that are stalled (many attempts, not completed) and have a
    // last_attempted_at within the last 3 days — meaning they're actively being
    // worked on but not progressing.
    let urgent: Vec<_> = goals
        .iter()
        .filter(|g| {
            if g.status == "completed" {
                return false;
            }
            // Stalled: 5+ attempts and still not done
            if g.attempts >= 5 {
                return true;
            }
            // Active goal that hasn't been touched in 3 days despite being "active"
            if let Some(last) = g.last_attempted_at {
                let age = now - last;
                if age >= three_days && g.status == "in_progress" {
                    return true;
                }
            }
            false
        })
        .take(3)
        .collect();

    if urgent.is_empty() {
        return None;
    }

    let goal_summary: String = urgent
        .iter()
        .map(|g| {
            format!(
                "- \"{}\" (status: {}, attempts: {})",
                g.title, g.status, g.attempts
            )
        })
        .collect::<Vec<_>>()
        .join("\n");

    let system = "You are BLADE, a local-first AI agent. Warn the user about stalled goals \
                  in a supportive, motivating way. 2-3 sentences. No markdown. No preamble.";

    let user_msg = format!(
        "These goals are stalling and may need attention:\n{}\n\n\
         Generate a warm, motivating warning message.",
        goal_summary
    );

    let content = match llm_call(system, &user_msg).await {
        Ok(s) => s,
        Err(_) => format!(
            "Heads up — {} goal(s) seem stalled and could use some attention:\n{}",
            urgent.len(),
            goal_summary
        ),
    };

    Some(ProactiveAction {
        id: new_id(),
        action_type: "DeadlineWarning".to_string(),
        trigger: format!("{} stalled goal(s) detected", urgent.len()),
        content,
        confidence: 0.9,
        accepted: -1,
        created_at: now_secs(),
    })
}

// ── Detector: context_switch ──────────────────────────────────────────────────

/// Detects a significant context switch between apps and offers to bookmark state.
async fn detect_context_switch(prev_window: &str, curr_window: &str) -> Option<ProactiveAction> {
    // Classify windows into broad categories
    fn category(title: &str) -> &'static str {
        let t = title.to_lowercase();
        if t.contains("code") || t.contains("vim") || t.contains("nvim")
            || t.contains("intellij") || t.contains("rider") || t.contains("vscode")
            || t.contains("sublime") || t.contains("cursor")
        {
            return "code editor";
        }
        if t.contains("chrome") || t.contains("firefox") || t.contains("safari")
            || t.contains("edge") || t.contains("brave") || t.contains("browser")
        {
            return "browser";
        }
        if t.contains("slack") || t.contains("teams") || t.contains("discord")
            || t.contains("telegram") || t.contains("whatsapp")
        {
            return "messaging";
        }
        if t.contains("terminal") || t.contains("iterm") || t.contains("cmd")
            || t.contains("powershell") || t.contains("bash") || t.contains("wsl")
        {
            return "terminal";
        }
        if t.contains("figma") || t.contains("photoshop") || t.contains("sketch")
            || t.contains("canva") || t.contains("illustrator")
        {
            return "design";
        }
        "other"
    }

    let prev_cat = category(prev_window);
    let curr_cat = category(curr_window);

    // Only fire if actually switching between known, different categories
    if prev_cat == curr_cat || prev_cat == "other" || curr_cat == "other" {
        return None;
    }

    let content = format!(
        "You're switching from {prev_cat} ({prev}) to {curr_cat} ({curr}). \
         Want me to bookmark where you are so you can jump back instantly?",
        prev = crate::safe_slice(prev_window, 40),
        curr = crate::safe_slice(curr_window, 40),
        prev_cat = prev_cat,
        curr_cat = curr_cat,
    );

    Some(ProactiveAction {
        id: new_id(),
        action_type: "ContextSwitch".to_string(),
        trigger: format!("Switched from {} to {}", prev_cat, curr_cat),
        content,
        confidence: 0.6,
        accepted: -1,
        created_at: now_secs(),
    })
}

// ── Detector: energy_check ────────────────────────────────────────────────────

/// If continuous activity ≥ 90 minutes, suggests a break and summarises today's work.
async fn check_energy_level() -> Option<ProactiveAction> {
    let conn = open_conn()?;
    let now = now_secs();

    // Find the most recent activity timestamp from activity_timeline
    let last_activity: Option<i64> = conn
        .query_row(
            "SELECT MAX(timestamp) FROM activity_timeline",
            [],
            |row| row.get(0),
        )
        .ok()
        .flatten();

    let last_ts = last_activity?;
    let mins_since_last = (now - last_ts) / 60;

    // User must be currently active (touched something in last 5 min)
    if mins_since_last > 5 {
        return None;
    }

    // Check the DB: find the earliest contiguous-session start by looking for the
    // last gap of 20+ minutes in activity_timeline
    let session_start: Option<i64> = conn
        .query_row(
            "SELECT MIN(timestamp) FROM activity_timeline
             WHERE timestamp > (
                 SELECT COALESCE(MAX(timestamp), 0)
                 FROM activity_timeline
                 WHERE timestamp < ?1
                   AND ?1 - timestamp > 1200
             )",
            params![now],
            |row| row.get(0),
        )
        .ok()
        .flatten();

    let session_start = session_start.unwrap_or(now); // if none, treat as just starting
    let session_minutes = (now - session_start) / 60;

    if session_minutes < 90 {
        return None;
    }

    // Tally what was done today for the motivating message
    let today_start = now - (now % 86400); // midnight UTC approximation
    let today_events: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM activity_timeline WHERE timestamp >= ?1",
            params![today_start],
            |row| row.get(0),
        )
        .unwrap_or(0);

    let system = "You are BLADE. The user has been working without a break for 90+ minutes. \
                  Write a single warm, encouraging message (2-3 sentences) suggesting a short \
                  break. Mention what a solid session they've had. No markdown. No preamble.";

    let user_msg = format!(
        "The user has been active for ~{} minutes straight today, with {} logged activity events. \
         Write the break suggestion.",
        session_minutes, today_events
    );

    let content = match llm_call(system, &user_msg).await {
        Ok(s) => s,
        Err(_) => format!(
            "You've been heads-down for {} minutes — incredible focus. Time for a 5-minute \
             break to let everything sink in before the next push.",
            session_minutes
        ),
    };

    Some(ProactiveAction {
        id: new_id(),
        action_type: "EnergyCheck".to_string(),
        trigger: format!("{} minutes of continuous activity", session_minutes),
        content,
        confidence: 0.7,
        accepted: -1,
        created_at: now_secs(),
    })
}

// ── Main loop ─────────────────────────────────────────────────────────────────

async fn proactive_loop(app: tauri::AppHandle) {
    // Track the last known window for context-switch detection
    let mut last_window = String::new();

    loop {
        tokio::time::sleep(Duration::from_secs(300)).await; // every 5 minutes

        let config = crate::config::load_config();
        if !config.background_ai_enabled {
            continue;
        }

        // Vagus nerve: skip LLM-heavy stuck detection in conservation mode
        if crate::homeostasis::energy_mode() < 0.25 {
            continue;
        }

        let conn = match open_conn() {
            Some(c) => c,
            None => continue,
        };
        ensure_tables(&conn);
        ensure_default_rules(&conn);

        // Gather current window title (best-effort, fail gracefully)
        let curr_window = crate::context::get_active_window()
            .map(|w| w.window_title)
            .unwrap_or_default();

        let mut fired = 0usize;

        // Get the latest perception state for decision gate context
        let perception = crate::perception_fusion::get_latest()
            .unwrap_or_default();

        // Helper: run one detector through the decision gate before emitting
        macro_rules! run_detector {
            ($rule_type:expr, $detector_expr:expr) => {{
                if let Some(rule) = get_rule(&conn, $rule_type) {
                    if rule.enabled && cooldown_elapsed(&rule) {
                        if let Some(action) = $detector_expr.await {
                            if action.confidence >= rule.threshold {
                                // Route through decision gate
                                let signal = crate::decision_gate::Signal {
                                    source: format!("proactive_{}", $rule_type),
                                    description: action.content.clone(),
                                    confidence: action.confidence,
                                    reversible: true,
                                    time_sensitive: action.action_type == "StuckDetection"
                                        || action.action_type == "DeadlineWarning",
                                };
                                let (_, outcome) = crate::decision_gate::evaluate_and_record(
                                    signal,
                                    &perception,
                                )
                                .await;

                                // Only surface if decision gate approves
                                let should_emit = matches!(
                                    &outcome,
                                    crate::decision_gate::DecisionOutcome::ActAutonomously { .. }
                                    | crate::decision_gate::DecisionOutcome::AskUser { .. }
                                );

                                if should_emit {
                                    if save_action(&conn, &action).is_ok() {
                                        let _ = app.emit_to("main", "proactive_action", &action);
                                        mark_rule_fired(&conn, $rule_type);
                                        fired += 1;
                                    }
                                }
                            }
                        }
                    }
                }
            }};
        }

        run_detector!("stuck_detection",      detect_stuck_pattern());
        run_detector!("workflow_repetition",  detect_workflow_repetition());
        run_detector!("deadline_warning",     detect_approaching_deadline());
        run_detector!("energy_check",         check_energy_level());
        run_detector!("user_model_prediction", detect_user_model_prediction());

        // Context-switch detector (separate: needs prev/curr window)
        if !curr_window.is_empty() && !last_window.is_empty() && curr_window != last_window {
            if let Some(rule) = get_rule(&conn, "context_switch") {
                if rule.enabled && cooldown_elapsed(&rule) {
                    if let Some(action) =
                        detect_context_switch(&last_window, &curr_window).await
                    {
                        if action.confidence >= rule.threshold {
                            let signal = crate::decision_gate::Signal {
                                source: "proactive_context_switch".to_string(),
                                description: action.content.clone(),
                                confidence: action.confidence,
                                reversible: true,
                                time_sensitive: false,
                            };
                            let (_, outcome) = crate::decision_gate::evaluate_and_record(
                                signal,
                                &perception,
                            )
                            .await;
                            let should_emit = matches!(
                                &outcome,
                                crate::decision_gate::DecisionOutcome::ActAutonomously { .. }
                                | crate::decision_gate::DecisionOutcome::AskUser { .. }
                            );
                            if should_emit {
                                if save_action(&conn, &action).is_ok() {
                                    let _ = app.emit_to("main", "proactive_action", &action);
                                    mark_rule_fired(&conn, "context_switch");
                                    fired += 1;
                                }
                            }
                        }
                    }
                }
            }
        }

        if !curr_window.is_empty() {
            last_window = curr_window;
        }

        let _ = fired; // suppress unused warning
    }
}

// ── UserModel prediction detector ────────────────────────────────────────────

/// Uses the UserModel + current perception to predict what the user needs next.
/// Returns a ProactiveAction if a confident prediction can be made.
async fn detect_user_model_prediction() -> Option<ProactiveAction> {
    let model = crate::persona_engine::build_user_model();
    let perception = crate::perception_fusion::get_latest().unwrap_or_default();

    let prediction = crate::persona_engine::predict_next_need(&model, &perception).await?;

    Some(ProactiveAction {
        id: new_id(),
        action_type: "UserModelPrediction".to_string(),
        trigger: format!("UserModel: mood={}, streak context", model.mood_today),
        content: prediction,
        confidence: 0.75,
        accepted: -1,
        created_at: now_secs(),
    })
}

// ── Public entry point ────────────────────────────────────────────────────────

pub fn start_proactive_engine(app: tauri::AppHandle) {
    if ENGINE_RUNNING.swap(true, Ordering::SeqCst) {
        return; // already running
    }

    // Ensure tables and default rules exist at startup
    if let Some(conn) = open_conn() {
        ensure_tables(&conn);
        ensure_default_rules(&conn);
    }

    tauri::async_runtime::spawn(async move {
        proactive_loop(app).await;
    });
}

// ── Feedback loop ─────────────────────────────────────────────────────────────

/// Mark an action as accepted (accepted=1). In future iterations this could
/// be used to lower the rule threshold (more proactive).
pub fn accept_action(id: &str) {
    let conn = match open_conn() {
        Some(c) => c,
        None => return,
    };
    ensure_tables(&conn);
    let _ = conn.execute(
        "UPDATE proactive_actions SET accepted = 1 WHERE id = ?1",
        params![id],
    );
}

/// Mark an action as dismissed (accepted=0) and raise the rule threshold by 0.05
/// so BLADE learns to be less triggerhappy for this type.
pub fn dismiss_action(id: &str) {
    let conn = match open_conn() {
        Some(c) => c,
        None => return,
    };
    ensure_tables(&conn);

    // Get the action's type so we can find its rule
    let action_type: Option<String> = conn
        .query_row(
            "SELECT action_type FROM proactive_actions WHERE id = ?1",
            params![id],
            |row| row.get(0),
        )
        .ok();

    let _ = conn.execute(
        "UPDATE proactive_actions SET accepted = 0 WHERE id = ?1",
        params![id],
    );

    if let Some(atype) = action_type {
        // Map action_type back to rule_type
        let rule_type = action_type_to_rule_type(&atype);
        if let Some(rt) = rule_type {
            let rule_id = format!("rule_{}", rt);
            let _ = conn.execute(
                "UPDATE proactive_rules
                 SET threshold = MIN(0.99, threshold + 0.05)
                 WHERE id = ?1",
                params![rule_id],
            );
        }
    }
}

fn action_type_to_rule_type(action_type: &str) -> Option<&'static str> {
    match action_type {
        "StuckDetection" => Some("stuck_detection"),
        "WorkflowSuggestion" => Some("workflow_repetition"),
        "DeadlineWarning" => Some("deadline_warning"),
        "ContextSwitch" => Some("context_switch"),
        "EnergyCheck" => Some("energy_check"),
        _ => None,
    }
}

// ── Tauri commands ────────────────────────────────────────────────────────────

/// Returns all pending (accepted=-1) actions from the last 24 hours.
#[tauri::command]
pub fn proactive_get_pending() -> Vec<ProactiveAction> {
    let conn = match open_conn() {
        Some(c) => c,
        None => return Vec::new(),
    };
    ensure_tables(&conn);

    let cutoff = now_secs() - 86400;

    let mut stmt = match conn.prepare(
        "SELECT id, action_type, trigger, content, confidence, accepted, created_at
         FROM proactive_actions
         WHERE accepted = -1 AND created_at >= ?1
         ORDER BY created_at DESC",
    ) {
        Ok(s) => s,
        Err(_) => return Vec::new(),
    };

    stmt.query_map(params![cutoff], |row| {
        Ok(ProactiveAction {
            id: row.get(0)?,
            action_type: row.get(1)?,
            trigger: row.get(2)?,
            content: row.get(3)?,
            confidence: row.get(4)?,
            accepted: row.get(5)?,
            created_at: row.get(6)?,
        })
    })
    .map(|mapped| mapped.filter_map(|r| r.ok()).collect())
    .unwrap_or_default()
}

#[tauri::command]
pub fn proactive_accept(id: String) -> Result<(), String> {
    accept_action(&id);
    Ok(())
}

#[tauri::command]
pub fn proactive_dismiss(id: String) -> Result<(), String> {
    dismiss_action(&id);
    Ok(())
}

#[tauri::command]
pub fn proactive_get_rules() -> Vec<ProactiveRule> {
    let conn = match open_conn() {
        Some(c) => c,
        None => return Vec::new(),
    };
    ensure_tables(&conn);
    ensure_default_rules(&conn);

    let mut stmt = match conn.prepare(
        "SELECT id, rule_type, enabled, threshold, cooldown_minutes, last_fired
         FROM proactive_rules
         ORDER BY rule_type",
    ) {
        Ok(s) => s,
        Err(_) => return Vec::new(),
    };

    stmt.query_map([], |row| {
        Ok(ProactiveRule {
            id: row.get(0)?,
            rule_type: row.get(1)?,
            enabled: row.get::<_, i64>(2)? != 0,
            threshold: row.get(3)?,
            cooldown_minutes: row.get(4)?,
            last_fired: row.get(5)?,
        })
    })
    .map(|mapped| mapped.filter_map(|r| r.ok()).collect())
    .unwrap_or_default()
}

#[tauri::command]
pub fn proactive_toggle_rule(rule_type: String, enabled: bool) -> Result<(), String> {
    let conn = open_conn().ok_or("Cannot open database")?;
    ensure_tables(&conn);

    let rule_id = format!("rule_{}", rule_type);
    conn.execute(
        "UPDATE proactive_rules SET enabled = ?1 WHERE id = ?2",
        params![enabled as i64, rule_id],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

/// Manually trigger all detectors. Returns the number of actions fired.
/// Useful for testing or for a "check now" UI button.
#[tauri::command]
pub async fn proactive_trigger_check(app: tauri::AppHandle) -> Result<usize, String> {
    let conn = open_conn().ok_or("Cannot open database")?;
    ensure_tables(&conn);
    ensure_default_rules(&conn);

    let mut fired = 0usize;

    // Run each detector ignoring cooldowns (manual trigger)
    let rule_types = ["stuck_detection", "workflow_repetition", "deadline_warning", "energy_check", "user_model_prediction"];

    let results: Vec<Option<ProactiveAction>> = vec![
        detect_stuck_pattern().await,
        detect_workflow_repetition().await,
        detect_approaching_deadline().await,
        check_energy_level().await,
        detect_user_model_prediction().await,
    ];

    let perception = crate::perception_fusion::get_latest().unwrap_or_default();

    for (rule_type, maybe_action) in rule_types.iter().zip(results.into_iter()) {
        let action = match maybe_action {
            Some(a) => a,
            None => continue,
        };

        let rule = match get_rule(&conn, rule_type) {
            Some(r) => r,
            None => continue,
        };

        // On manual trigger we respect the threshold but ignore cooldown
        if action.confidence < rule.threshold {
            continue;
        }

        // Route through decision gate
        let signal = crate::decision_gate::Signal {
            source: format!("proactive_{}", rule_type),
            description: action.content.clone(),
            confidence: action.confidence,
            reversible: true,
            time_sensitive: action.action_type == "StuckDetection"
                || action.action_type == "DeadlineWarning"
                || action.action_type == "UserModelPrediction",
        };
        let (_, outcome) = crate::decision_gate::evaluate_and_record(
            signal,
            &perception,
        )
        .await;
        let should_emit = matches!(
            &outcome,
            crate::decision_gate::DecisionOutcome::ActAutonomously { .. }
            | crate::decision_gate::DecisionOutcome::AskUser { .. }
        );

        if should_emit && save_action(&conn, &action).is_ok() {
            let _ = app.emit_to("main", "proactive_action", &action);
            mark_rule_fired(&conn, rule_type);
            fired += 1;
        }
    }

    Ok(fired)
}
