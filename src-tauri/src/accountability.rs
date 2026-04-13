// accountability.rs — BLADE's personal accountability partner engine
//
// Tracks objectives, key results, and daily actions. BLADE doesn't just store
// data — it actively nudges, plans, and holds the user to what they said matters.

use chrono::Local;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::Emitter;
use uuid::Uuid;

// ── Structs ───────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KeyResult {
    pub id: String,
    pub objective_id: String,
    pub title: String,
    pub metric: String,        // "percentage" | "number" | "boolean"
    pub target_value: f64,
    pub current_value: f64,
    pub unit: String,          // "%" | "commits" | "users" | "$" etc
    pub status: String,        // "on_track" | "at_risk" | "behind" | "completed"
    pub last_updated: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Objective {
    pub id: String,
    pub title: String,
    pub description: String,
    pub timeframe: String,     // "weekly" | "monthly" | "quarterly" | "yearly"
    pub start_date: i64,
    pub end_date: i64,
    pub status: String,        // "active" | "completed" | "abandoned"
    pub progress_pct: i64,
    pub created_at: i64,
    pub key_results: Vec<KeyResult>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DailyAction {
    pub id: String,
    pub date: String,          // "YYYY-MM-DD"
    pub title: String,
    pub objective_id: Option<String>,
    pub completed: bool,
    pub completed_at: Option<i64>,
    pub energy_level: String,  // "high" | "medium" | "low"
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccountabilityCheckin {
    pub id: String,
    pub date: String,
    pub mood: i32,             // 1-10
    pub energy: i32,           // 1-10
    pub biggest_win: String,
    pub biggest_blocker: String,
    pub tomorrow_priority: String,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DailyPlan {
    pub date: String,
    pub actions: Vec<DailyAction>,
    pub focus_objective: Option<Objective>,
    pub energy_recommendation: String,
    pub blade_message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProgressReport {
    pub period: String,
    pub objectives_summary: Vec<serde_json::Value>,
    pub wins: Vec<String>,
    pub blockers: Vec<String>,
    pub recommendations: Vec<String>,
    pub score: f64,            // 0-100 accountability score
}

// ── Internal LLM plan/report response shapes ─────────────────────────────────

#[derive(Debug, Deserialize)]
struct LlmPlanResponse {
    focus_objective_id: Option<String>,
    actions: Vec<LlmAction>,
    energy_recommendation: String,
    blade_message: String,
}

#[derive(Debug, Deserialize)]
struct LlmAction {
    title: String,
    energy_level: String,
}

#[derive(Debug, Deserialize)]
struct LlmReportResponse {
    wins: Vec<String>,
    blockers: Vec<String>,
    recommendations: Vec<String>,
    score: f64,
}

// ── DB path helper ────────────────────────────────────────────────────────────

fn db_path() -> std::path::PathBuf {
    crate::config::blade_config_dir().join("blade.db")
}

fn open_db() -> Result<Connection, String> {
    Connection::open(db_path()).map_err(|e| format!("DB open failed: {e}"))
}

// ── Schema initialisation ─────────────────────────────────────────────────────

pub fn init_accountability_tables() {
    if let Ok(conn) = open_db() {
        let _ = conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS objectives (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                description TEXT NOT NULL,
                timeframe TEXT NOT NULL,
                start_date INTEGER NOT NULL,
                end_date INTEGER NOT NULL,
                status TEXT DEFAULT 'active',
                progress_pct INTEGER DEFAULT 0,
                created_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS key_results (
                id TEXT PRIMARY KEY,
                objective_id TEXT NOT NULL,
                title TEXT NOT NULL,
                metric TEXT NOT NULL,
                target_value REAL NOT NULL,
                current_value REAL DEFAULT 0,
                unit TEXT DEFAULT '',
                status TEXT DEFAULT 'on_track',
                last_updated INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS daily_actions (
                id TEXT PRIMARY KEY,
                date TEXT NOT NULL,
                title TEXT NOT NULL,
                objective_id TEXT,
                completed INTEGER DEFAULT 0,
                completed_at INTEGER,
                energy_level TEXT DEFAULT 'medium',
                created_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS accountability_checkins (
                id TEXT PRIMARY KEY,
                date TEXT NOT NULL,
                mood INTEGER NOT NULL,
                energy INTEGER NOT NULL,
                biggest_win TEXT DEFAULT '',
                biggest_blocker TEXT DEFAULT '',
                tomorrow_priority TEXT DEFAULT '',
                created_at INTEGER NOT NULL
            );"
        );
    }
}

// ── Core functions ────────────────────────────────────────────────────────────

/// Create a new objective. Returns the new objective's id.
pub fn create_objective(
    title: &str,
    description: &str,
    timeframe: &str,
    duration_days: i64,
) -> Result<String, String> {
    let conn = open_db()?;
    let id = Uuid::new_v4().to_string();
    let now = Local::now().timestamp();
    let end = now + duration_days * 86_400;

    conn.execute(
        "INSERT INTO objectives (id, title, description, timeframe, start_date, end_date, status, progress_pct, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'active', 0, ?7)",
        params![id, title, description, timeframe, now, end, now],
    )
    .map_err(|e| format!("Failed to insert objective: {e}"))?;

    Ok(id)
}

/// Update a key result's current value and recalculate status + parent progress.
pub fn update_key_result(kr_id: &str, current_value: f64) -> Result<(), String> {
    let conn = open_db()?;

    // Fetch target value and objective id
    let (target_value, objective_id): (f64, String) = conn
        .query_row(
            "SELECT target_value, objective_id FROM key_results WHERE id = ?1",
            params![kr_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|e| format!("KR not found: {e}"))?;

    let progress_ratio = if target_value > 0.0 {
        (current_value / target_value).min(1.0)
    } else {
        0.0
    };

    let status = if progress_ratio >= 1.0 {
        "completed"
    } else if progress_ratio >= 0.7 {
        "on_track"
    } else if progress_ratio >= 0.4 {
        "at_risk"
    } else {
        "behind"
    };

    let now = Local::now().timestamp();
    conn.execute(
        "UPDATE key_results SET current_value = ?1, status = ?2, last_updated = ?3 WHERE id = ?4",
        params![current_value, status, now, kr_id],
    )
    .map_err(|e| format!("Failed to update KR: {e}"))?;

    // Recalculate parent objective progress as average of all KRs
    let avg_progress: f64 = conn
        .query_row(
            "SELECT AVG(CASE WHEN target_value > 0 THEN MIN(current_value / target_value, 1.0) ELSE 0 END)
             FROM key_results WHERE objective_id = ?1",
            params![objective_id],
            |row| row.get::<_, Option<f64>>(0),
        )
        .unwrap_or(None)
        .unwrap_or(0.0);

    let progress_pct = (avg_progress * 100.0).round() as i64;
    conn.execute(
        "UPDATE objectives SET progress_pct = ?1 WHERE id = ?2",
        params![progress_pct, objective_id],
    )
    .map_err(|e| format!("Failed to update objective progress: {e}"))?;

    Ok(())
}

/// Return all objectives with nested key results, active ones first.
pub fn get_objectives_with_krs() -> Vec<Objective> {
    let conn = match open_db() {
        Ok(c) => c,
        Err(_) => return vec![],
    };

    // Load objectives (active first)
    let mut stmt = match conn.prepare(
        "SELECT id, title, description, timeframe, start_date, end_date, status, progress_pct, created_at
         FROM objectives ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END, created_at DESC",
    ) {
        Ok(s) => s,
        Err(_) => return vec![],
    };

    let objectives: Vec<Objective> = stmt
        .query_map([], |row| {
            Ok(Objective {
                id: row.get(0)?,
                title: row.get(1)?,
                description: row.get(2)?,
                timeframe: row.get(3)?,
                start_date: row.get(4)?,
                end_date: row.get(5)?,
                status: row.get(6)?,
                progress_pct: row.get(7)?,
                created_at: row.get(8)?,
                key_results: vec![],
            })
        })
        .map(|rows| rows.flatten().collect::<Vec<_>>())
        .unwrap_or_default();

    // Attach key results
    objectives
        .into_iter()
        .map(|mut obj| {
            if let Ok(mut kr_stmt) = conn.prepare(
                "SELECT id, objective_id, title, metric, target_value, current_value, unit, status, last_updated
                 FROM key_results WHERE objective_id = ?1",
            ) {
                obj.key_results = kr_stmt
                    .query_map(params![obj.id], |row| {
                        Ok(KeyResult {
                            id: row.get(0)?,
                            objective_id: row.get(1)?,
                            title: row.get(2)?,
                            metric: row.get(3)?,
                            target_value: row.get(4)?,
                            current_value: row.get(5)?,
                            unit: row.get(6)?,
                            status: row.get(7)?,
                            last_updated: row.get(8)?,
                        })
                    })
                    .map(|rows| rows.flatten().collect::<Vec<_>>())
                    .unwrap_or_default();
            }
            obj
        })
        .collect()
}

/// Load daily actions for a given date (YYYY-MM-DD).
pub fn get_daily_actions_for_date(date: &str) -> Vec<DailyAction> {
    let conn = match open_db() {
        Ok(c) => c,
        Err(_) => return vec![],
    };

    let mut stmt = match conn.prepare(
        "SELECT id, date, title, objective_id, completed, completed_at, energy_level, created_at
         FROM daily_actions WHERE date = ?1 ORDER BY created_at ASC",
    ) {
        Ok(s) => s,
        Err(_) => return vec![],
    };

    stmt.query_map(params![date], |row| {
        Ok(DailyAction {
            id: row.get(0)?,
            date: row.get(1)?,
            title: row.get(2)?,
            objective_id: row.get(3)?,
            completed: row.get::<_, i64>(4)? != 0,
            completed_at: row.get(5)?,
            energy_level: row.get(6)?,
            created_at: row.get(7)?,
        })
    })
    .map(|rows| rows.flatten().collect::<Vec<_>>())
    .unwrap_or_default()
}

/// Mark an action as completed.
pub fn complete_action(action_id: &str) -> Result<(), String> {
    let conn = open_db()?;
    let now = Local::now().timestamp();
    conn.execute(
        "UPDATE daily_actions SET completed = 1, completed_at = ?1 WHERE id = ?2",
        params![now, action_id],
    )
    .map_err(|e| format!("Failed to complete action: {e}"))?;
    Ok(())
}

/// Insert today's check-in. Returns the new checkin id.
pub fn add_checkin(
    mood: i32,
    energy: i32,
    win: &str,
    blocker: &str,
    tomorrow: &str,
) -> Result<String, String> {
    let conn = open_db()?;
    let id = Uuid::new_v4().to_string();
    let today = Local::now().format("%Y-%m-%d").to_string();
    let now = Local::now().timestamp();

    conn.execute(
        "INSERT INTO accountability_checkins (id, date, mood, energy, biggest_win, biggest_blocker, tomorrow_priority, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![id, today, mood, energy, win, blocker, tomorrow, now],
    )
    .map_err(|e| format!("Failed to insert check-in: {e}"))?;

    Ok(id)
}

// ── LLM helpers ───────────────────────────────────────────────────────────────

/// Get provider/key/model — uses task routing when available, falls back to active provider.
fn get_provider_for_task(task: &str) -> (String, String, String) {
    let config = crate::config::load_config();
    let task_type = match task {
        "fast" => crate::router::TaskType::Simple,
        "quality" => crate::router::TaskType::Complex,
        _ => crate::router::TaskType::Complex,
    };
    crate::config::resolve_provider_for_task(&config, &task_type)
}

/// Call the LLM for a one-shot JSON response (no streaming).
async fn llm_json(provider: &str, api_key: &str, model: &str, prompt: &str) -> Result<String, String> {
    use crate::providers::{complete_turn, ConversationMessage};

    let messages = vec![ConversationMessage::User(prompt.to_string())];
    let turn = complete_turn(provider, api_key, model, &messages, &[], None).await?;
    Ok(turn.content)
}

/// Strip markdown code fences that some models wrap JSON in.
fn strip_json_fences(s: &str) -> &str {
    let s = s.trim();
    // Strip ```json ... ``` or ``` ... ```
    if s.starts_with("```") {
        let after_fence = s.trim_start_matches('`');
        let after_lang = after_fence.trim_start_matches("json").trim_start_matches('\n');
        if let Some(end) = after_lang.rfind("```") {
            return after_lang[..end].trim();
        }
        return after_lang.trim();
    }
    s
}

// ── LLM-powered daily plan ────────────────────────────────────────────────────

pub async fn generate_daily_plan(
    date: &str,
    checkin: Option<&AccountabilityCheckin>,
) -> Result<DailyPlan, String> {
    let objectives = get_objectives_with_krs();
    let active_objectives: Vec<&Objective> = objectives
        .iter()
        .filter(|o| o.status == "active")
        .collect();

    // Format objectives for prompt
    let objectives_text = if active_objectives.is_empty() {
        "No active objectives.".to_string()
    } else {
        active_objectives
            .iter()
            .map(|o| {
                let krs: Vec<String> = o
                    .key_results
                    .iter()
                    .map(|kr| {
                        format!(
                            "  - {} [{}/{}{}] ({})",
                            kr.title, kr.current_value, kr.target_value, kr.unit, kr.status
                        )
                    })
                    .collect();
                format!(
                    "Objective: {} ({}% complete, {})\nKey Results:\n{}",
                    o.title,
                    o.progress_pct,
                    o.timeframe,
                    if krs.is_empty() { "  (no key results)".to_string() } else { krs.join("\n") }
                )
            })
            .collect::<Vec<_>>()
            .join("\n\n")
    };

    // Yesterday's incomplete actions
    let yesterday = chrono::Local::now()
        .checked_sub_signed(chrono::Duration::days(1))
        .map(|d| d.format("%Y-%m-%d").to_string())
        .unwrap_or_default();

    let yesterday_incomplete: Vec<String> = get_daily_actions_for_date(&yesterday)
        .into_iter()
        .filter(|a| !a.completed)
        .map(|a| format!("- {}", a.title))
        .collect();

    let incomplete_text = if yesterday_incomplete.is_empty() {
        "None — clean slate!".to_string()
    } else {
        yesterday_incomplete.join("\n")
    };

    let energy_level = checkin
        .map(|c| match c.energy {
            8..=10 => "high",
            4..=7 => "medium",
            _ => "low",
        })
        .unwrap_or("medium");

    let day_of_week = chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d")
        .map(|d| {
            use chrono::Datelike;
            format!("{:?}", d.weekday())
        })
        .unwrap_or_default();

    let prompt = format!(
        r#"You are BLADE, acting as a personal accountability partner.

The user's active objectives:
{objectives_text}

Yesterday's incomplete tasks:
{incomplete_text}

Today's energy level: {energy_level}
Date: {date} ({day_of_week})

Generate a focused daily plan:
1. ONE primary focus objective (most important right now)
2. 3-5 specific actions that move the needle
3. Energy recommendation for the day
4. A motivating but honest message

Respond as JSON only (no markdown fences, no explanation):
{{"focus_objective_id": "...", "actions": [{{"title": "...", "energy_level": "high/medium/low"}}], "energy_recommendation": "...", "blade_message": "..."}}"#
    );

    let (provider, api_key, model) = get_provider_for_task("quality");
    let raw = llm_json(&provider, &api_key, &model, &prompt).await?;
    let clean = strip_json_fences(&raw);

    let plan_resp: LlmPlanResponse = serde_json::from_str(clean)
        .map_err(|e| format!("Failed to parse LLM plan JSON: {e}\nRaw: {raw}"))?;

    // Insert generated actions into DB
    let conn = open_db()?;
    let now = Local::now().timestamp();
    let mut inserted_actions = Vec::new();

    for llm_action in &plan_resp.actions {
        let action_id = Uuid::new_v4().to_string();
        let energy = match llm_action.energy_level.as_str() {
            "high" | "low" => llm_action.energy_level.as_str(),
            _ => "medium",
        };
        conn.execute(
            "INSERT INTO daily_actions (id, date, title, objective_id, completed, completed_at, energy_level, created_at)
             VALUES (?1, ?2, ?3, ?4, 0, NULL, ?5, ?6)",
            params![action_id, date, llm_action.title, plan_resp.focus_objective_id, energy, now],
        )
        .map_err(|e| format!("Failed to insert action: {e}"))?;

        inserted_actions.push(DailyAction {
            id: action_id,
            date: date.to_string(),
            title: llm_action.title.clone(),
            objective_id: plan_resp.focus_objective_id.clone(),
            completed: false,
            completed_at: None,
            energy_level: energy.to_string(),
            created_at: now,
        });
    }

    // Resolve focus objective struct
    let focus_objective = plan_resp
        .focus_objective_id
        .as_deref()
        .and_then(|fid| objectives.iter().find(|o| o.id == fid))
        .cloned();

    Ok(DailyPlan {
        date: date.to_string(),
        actions: inserted_actions,
        focus_objective,
        energy_recommendation: plan_resp.energy_recommendation,
        blade_message: plan_resp.blade_message,
    })
}

// ── LLM-powered progress report ───────────────────────────────────────────────

pub async fn generate_progress_report(period: &str) -> Result<ProgressReport, String> {
    let objectives = get_objectives_with_krs();

    // Date range for the period
    let now = Local::now();
    let days_back: i64 = match period {
        "week" => 7,
        "month" => 30,
        "quarter" => 90,
        _ => 7,
    };
    let start_ts = (now.timestamp()) - days_back * 86_400;
    let start_date = chrono::DateTime::from_timestamp(start_ts, 0)
        .map(|d| d.with_timezone(&Local).format("%Y-%m-%d").to_string())
        .unwrap_or_default();

    // Completed actions in the period — collect before any .await
    let (completed_actions, checkin_lines) = {
        let conn = open_db()?;
        let mut stmt = conn
            .prepare(
                "SELECT title, date FROM daily_actions
                 WHERE completed = 1 AND completed_at >= ?1
                 ORDER BY completed_at DESC LIMIT 50",
            )
            .map_err(|e| format!("Query failed: {e}"))?;

        let completed_actions: Vec<String> = stmt
            .query_map(params![start_ts], |row| {
                Ok(format!("- {} ({})", row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .map(|rows| rows.flatten().collect::<Vec<_>>())
            .unwrap_or_default();

        // Checkins in period
        let mut ci_stmt = conn
            .prepare(
                "SELECT mood, energy, biggest_win, biggest_blocker FROM accountability_checkins
                 WHERE date >= ?1 ORDER BY date DESC LIMIT 14",
            )
            .map_err(|e| format!("Checkin query failed: {e}"))?;

        let checkin_lines: Vec<String> = ci_stmt
            .query_map(params![start_date], |row| {
                Ok(format!(
                    "mood={}/10 energy={}/10 win={} blocker={}",
                    row.get::<_, i32>(0)?,
                    row.get::<_, i32>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?
                ))
            })
            .map(|rows| rows.flatten().collect::<Vec<_>>())
            .unwrap_or_default();
        (completed_actions, checkin_lines)
        // conn dropped here — no longer held across .await
    };

    let obj_text = objectives
        .iter()
        .map(|o| {
            let kr_lines: Vec<String> = o
                .key_results
                .iter()
                .map(|kr| {
                    format!(
                        "  KR: {} → {}/{}{} [{}]",
                        kr.title, kr.current_value, kr.target_value, kr.unit, kr.status
                    )
                })
                .collect();
            format!(
                "{} ({}% — {})\n{}",
                o.title,
                o.progress_pct,
                o.status,
                kr_lines.join("\n")
            )
        })
        .collect::<Vec<_>>()
        .join("\n\n");

    let prompt = format!(
        r#"You are BLADE, the user's accountability partner. Generate an honest, useful progress report for the past {period}.

Objectives and Key Results:
{obj_text}

Completed actions this period ({} total):
{}

Check-ins this period:
{}

Produce a JSON report with:
- wins: list of genuine wins (strings)
- blockers: list of real obstacles identified
- recommendations: 3-5 specific, actionable recommendations
- score: overall accountability score 0-100 (be honest — 50 is average, 70 is good, 90+ is exceptional)

JSON only:
{{"wins": [...], "blockers": [...], "recommendations": [...], "score": 75}}"#,
        completed_actions.len(),
        if completed_actions.is_empty() {
            "  (none)".to_string()
        } else {
            completed_actions.join("\n")
        },
        if checkin_lines.is_empty() {
            "  (none)".to_string()
        } else {
            checkin_lines.join("\n")
        }
    );

    let (provider, api_key, model) = get_provider_for_task("quality");
    let raw = llm_json(&provider, &api_key, &model, &prompt).await?;
    let clean = strip_json_fences(&raw);

    let report_resp: LlmReportResponse = serde_json::from_str(clean)
        .map_err(|e| format!("Failed to parse report JSON: {e}\nRaw: {raw}"))?;

    // Build objectives summary as JSON values (for frontend flexibility)
    let objectives_summary: Vec<serde_json::Value> = objectives
        .iter()
        .map(|o| {
            serde_json::json!({
                "id": o.id,
                "title": o.title,
                "progress_pct": o.progress_pct,
                "status": o.status,
                "timeframe": o.timeframe,
                "key_results": o.key_results.iter().map(|kr| serde_json::json!({
                    "title": kr.title,
                    "current": kr.current_value,
                    "target": kr.target_value,
                    "unit": kr.unit,
                    "status": kr.status
                })).collect::<Vec<_>>()
            })
        })
        .collect();

    Ok(ProgressReport {
        period: period.to_string(),
        objectives_summary,
        wins: report_resp.wins,
        blockers: report_resp.blockers,
        recommendations: report_resp.recommendations,
        score: report_resp.score.clamp(0.0, 100.0),
    })
}

// ── Nudge ─────────────────────────────────────────────────────────────────────

pub async fn accountability_nudge(app: &tauri::AppHandle) {
    let conn = match open_db() {
        Ok(c) => c,
        Err(_) => return,
    };

    // Check last check-in date
    let last_checkin: Option<String> = conn
        .query_row(
            "SELECT date FROM accountability_checkins ORDER BY created_at DESC LIMIT 1",
            [],
            |row| row.get(0),
        )
        .ok();

    let today = Local::now().format("%Y-%m-%d").to_string();
    let should_nudge_checkin = match &last_checkin {
        None => true,
        Some(last_date) => {
            // Parse both dates and check difference
            let last = chrono::NaiveDate::parse_from_str(last_date, "%Y-%m-%d");
            let now_date = chrono::NaiveDate::parse_from_str(&today, "%Y-%m-%d");
            if let (Ok(l), Ok(n)) = (last, now_date) {
                (n - l).num_days() > 2
            } else {
                false
            }
        }
    };

    if should_nudge_checkin {
        let _ = app.emit(
            "accountability_nudge",
            serde_json::json!({
                "type": "checkin",
                "message": "You haven't checked in for a couple of days. Take 2 minutes — how are things actually going?"
            }),
        );
    }

    // Check for objectives with 'behind' KRs
    let objectives = get_objectives_with_krs();
    for obj in &objectives {
        if obj.status != "active" {
            continue;
        }
        let behind_krs: Vec<&KeyResult> = obj
            .key_results
            .iter()
            .filter(|kr| kr.status == "behind")
            .collect();

        if !behind_krs.is_empty() {
            let kr_names: Vec<&str> = behind_krs.iter().map(|kr| kr.title.as_str()).collect();
            let _ = app.emit(
                "accountability_nudge",
                serde_json::json!({
                    "type": "objective_behind",
                    "objective_id": obj.id,
                    "objective_title": obj.title,
                    "message": format!(
                        "'{}' is falling behind. Specifically: {}. What's blocking you?",
                        obj.title,
                        kr_names.join(", ")
                    )
                }),
            );
        }
    }
}

// ── Accountability loop ───────────────────────────────────────────────────────

static ACCOUNTABILITY_ACTIVE: AtomicBool = AtomicBool::new(false);

pub fn start_accountability_loop(app: tauri::AppHandle) {
    if ACCOUNTABILITY_ACTIVE.swap(true, Ordering::SeqCst) {
        return; // already running
    }

    // Ensure tables exist
    init_accountability_tables();

    tauri::async_runtime::spawn(async move {
        loop {
            accountability_nudge(&app).await;
            // Check every 6 hours
            tokio::time::sleep(tokio::time::Duration::from_secs(6 * 3600)).await;
        }
    });
}

// ── Context injection for brain.rs ───────────────────────────────────────────

/// Returns a formatted summary of active objectives and today's planned actions.
/// Injected into the system prompt so BLADE always knows what the user is working toward.
pub fn get_accountability_context() -> String {
    let objectives = get_objectives_with_krs();
    let active: Vec<&Objective> = objectives.iter().filter(|o| o.status == "active").collect();

    if active.is_empty() {
        return String::new();
    }

    let today = Local::now().format("%Y-%m-%d").to_string();
    let today_actions = get_daily_actions_for_date(&today);

    let mut lines = vec!["## Accountability — Active Objectives".to_string()];

    for obj in &active {
        let progress_bar = {
            let filled = (obj.progress_pct / 10) as usize;
            let empty = 10usize.saturating_sub(filled);
            format!("[{}{}] {}%", "█".repeat(filled), "░".repeat(empty), obj.progress_pct)
        };
        lines.push(format!("\n**{}** {} ({})", obj.title, progress_bar, obj.timeframe));

        for kr in &obj.key_results {
            let icon = match kr.status.as_str() {
                "on_track" | "completed" => "✓",
                "at_risk" => "~",
                _ => "✗",
            };
            lines.push(format!(
                "  {} {} → {}/{}{}",
                icon, kr.title, kr.current_value, kr.target_value, kr.unit
            ));
        }
    }

    if !today_actions.is_empty() {
        lines.push(String::new());
        lines.push("**Today's planned actions:**".to_string());
        for action in &today_actions {
            let check = if action.completed { "✓" } else { "○" };
            lines.push(format!("  {} {}", check, action.title));
        }
    }

    lines.join("\n")
}

// ── Tauri commands ────────────────────────────────────────────────────────────

#[tauri::command]
pub fn accountability_get_objectives() -> Vec<serde_json::Value> {
    get_objectives_with_krs()
        .into_iter()
        .map(|o| serde_json::to_value(o).unwrap_or(serde_json::Value::Null))
        .collect()
}

#[tauri::command]
pub fn accountability_create_objective(
    title: String,
    description: String,
    timeframe: String,
    duration_days: i64,
) -> Result<String, String> {
    create_objective(&title, &description, &timeframe, duration_days)
}

#[tauri::command]
pub fn accountability_update_kr(kr_id: String, current_value: f64) -> Result<(), String> {
    update_key_result(&kr_id, current_value)
}

#[tauri::command]
pub async fn accountability_daily_plan(date: Option<String>) -> Result<DailyPlan, String> {
    let date = date.unwrap_or_else(|| Local::now().format("%Y-%m-%d").to_string());
    generate_daily_plan(&date, None).await
}

#[tauri::command]
pub fn accountability_complete_action(action_id: String) -> Result<(), String> {
    complete_action(&action_id)
}

#[tauri::command]
pub fn accountability_checkin(
    mood: i32,
    energy: i32,
    win: String,
    blocker: String,
    tomorrow: String,
) -> Result<String, String> {
    add_checkin(mood, energy, &win, &blocker, &tomorrow)
}

#[tauri::command]
pub async fn accountability_progress_report(period: String) -> Result<ProgressReport, String> {
    generate_progress_report(&period).await
}

#[tauri::command]
pub fn accountability_get_daily_actions(date: Option<String>) -> Vec<DailyAction> {
    let date = date.unwrap_or_else(|| Local::now().format("%Y-%m-%d").to_string());
    get_daily_actions_for_date(&date)
}
