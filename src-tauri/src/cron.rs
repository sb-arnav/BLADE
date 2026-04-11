/// BLADE CRON — Autonomous Scheduled Tasks
///
/// BLADE can now act while you are asleep.
/// "Every Monday 9am, check my GitHub notifications and summarize."
/// "Every day at 8pm, write a journal entry about what I worked on."
/// "Every Friday, generate a week summary and save to Obsidian."
///
/// Unlike system cron, BLADE tasks run inside the AI context:
///   - They can use all native tools (bash, file, web, indexer)
///   - They can spawn background agents for complex work
///   - They emit their output as pulse thoughts or notifications
///   - They remember what they did last time (execution memory)
///
/// Schedule format (human): "every day at 9am", "every Monday", "every 30 minutes"
/// Stored in SQLite. Background loop checks every 60 seconds.

use chrono::{Datelike, Timelike};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::Emitter;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CronTask {
    pub id: String,
    pub name: String,
    pub description: String,
    pub schedule: CronSchedule,
    pub action: CronAction,
    pub enabled: bool,
    pub last_run: Option<i64>,
    pub next_run: i64,
    pub run_count: i64,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CronSchedule {
    pub kind: String,         // "daily" | "weekly" | "interval" | "hourly"
    pub time_of_day: Option<u32>,   // minutes since midnight (e.g. 9*60 = 540 for 9am)
    pub day_of_week: Option<u32>,   // 0=Sun .. 6=Sat (for weekly)
    pub interval_secs: Option<i64>, // for interval kind
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CronAction {
    pub kind: String,       // "message" | "bash" | "spawn_agent"
    pub content: String,    // the message, command, or task description
    pub agent_type: Option<String>, // for spawn_agent: "claude" | "bash" etc
    pub cwd: Option<String>,
}

fn db_path() -> PathBuf {
    crate::config::blade_config_dir().join("cron.db")
}

fn open_db() -> Result<Connection, String> {
    let conn = Connection::open(db_path()).map_err(|e| e.to_string())?;
    conn.execute_batch("
        CREATE TABLE IF NOT EXISTS cron_tasks (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            schedule_json TEXT NOT NULL,
            action_json TEXT NOT NULL,
            enabled INTEGER NOT NULL DEFAULT 1,
            last_run INTEGER,
            next_run INTEGER NOT NULL,
            run_count INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL
        );
    ").map_err(|e| e.to_string())?;
    Ok(conn)
}

fn row_to_task(row: &rusqlite::Row) -> rusqlite::Result<CronTask> {
    let schedule_json: String = row.get(3)?;
    let action_json: String = row.get(4)?;
    let schedule: CronSchedule = serde_json::from_str(&schedule_json).unwrap_or(CronSchedule {
        kind: "daily".to_string(), time_of_day: Some(540), day_of_week: None, interval_secs: None
    });
    let action: CronAction = serde_json::from_str(&action_json).unwrap_or(CronAction {
        kind: "message".to_string(), content: "".to_string(), agent_type: None, cwd: None
    });
    Ok(CronTask {
        id: row.get(0)?,
        name: row.get(1)?,
        description: row.get(2)?,
        schedule,
        action,
        enabled: row.get::<_, i64>(5)? != 0,
        last_run: row.get(6)?,
        next_run: row.get(7)?,
        run_count: row.get(8)?,
        created_at: row.get(9)?,
    })
}

/// Compute next run time from a schedule
pub fn compute_next_run(schedule: &CronSchedule, after: i64) -> i64 {
    let now = chrono::DateTime::from_timestamp(after, 0)
        .unwrap_or_else(chrono::Utc::now);
    let local = now.with_timezone(&chrono::Local);

    match schedule.kind.as_str() {
        "interval" => {
            let secs = schedule.interval_secs.unwrap_or(3600);
            after + secs
        }
        "hourly" => {
            // Next top of the hour
            let mins = schedule.time_of_day.unwrap_or(0) % 60;
            let next = local
                .with_minute(mins).unwrap_or(local)
                .with_second(0).unwrap_or(local)
                .with_nanosecond(0).unwrap_or(local);
            let next = if next.timestamp() <= after {
                next + chrono::Duration::hours(1)
            } else {
                next
            };
            next.timestamp()
        }
        "daily" => {
            let tod = schedule.time_of_day.unwrap_or(540); // default 9am
            let hours = tod / 60;
            let mins = tod % 60;
            let today_run = local
                .date_naive()
                .and_hms_opt(hours, mins, 0)
                .and_then(|dt| dt.and_local_timezone(chrono::Local).single())
                .map(|dt| dt.timestamp())
                .unwrap_or(after);
            if today_run > after {
                today_run
            } else {
                today_run + 86400
            }
        }
        "weekly" => {
            let dow = schedule.day_of_week.unwrap_or(1); // default Monday
            let tod = schedule.time_of_day.unwrap_or(540);
            let hours = tod / 60;
            let mins = tod % 60;
            // Find next occurrence of this weekday
            let current_dow = local.weekday().num_days_from_sunday();
            let days_ahead = if dow >= current_dow {
                dow - current_dow
            } else {
                7 - (current_dow - dow)
            };
            let target = local.date_naive()
                + chrono::Duration::days(days_ahead as i64);
            let target_ts = target
                .and_hms_opt(hours, mins, 0)
                .and_then(|dt| dt.and_local_timezone(chrono::Local).single())
                .map(|dt| dt.timestamp())
                .unwrap_or(after + 7 * 86400);
            if target_ts > after {
                target_ts
            } else {
                target_ts + 7 * 86400
            }
        }
        _ => after + 86400,
    }
}

/// Parse a natural language schedule into CronSchedule
pub fn parse_schedule(text: &str) -> CronSchedule {
    let lower = text.to_lowercase();

    // Interval patterns
    if lower.contains("every 30 min") || lower.contains("every 30min") {
        return CronSchedule { kind: "interval".to_string(), time_of_day: None, day_of_week: None, interval_secs: Some(1800) };
    }
    if lower.contains("every hour") || lower.contains("hourly") {
        return CronSchedule { kind: "interval".to_string(), time_of_day: None, day_of_week: None, interval_secs: Some(3600) };
    }
    if lower.contains("every 6 hour") {
        return CronSchedule { kind: "interval".to_string(), time_of_day: None, day_of_week: None, interval_secs: Some(21600) };
    }
    if lower.contains("every 12 hour") {
        return CronSchedule { kind: "interval".to_string(), time_of_day: None, day_of_week: None, interval_secs: Some(43200) };
    }

    // Extract time of day (e.g. "9am", "9:30am", "21:00")
    let time_of_day = parse_time_of_day(&lower);

    // Weekly
    let dow = if lower.contains("monday") || lower.contains("mon") { Some(1) }
        else if lower.contains("tuesday") || lower.contains("tue") { Some(2) }
        else if lower.contains("wednesday") || lower.contains("wed") { Some(3) }
        else if lower.contains("thursday") || lower.contains("thu") { Some(4) }
        else if lower.contains("friday") || lower.contains("fri") { Some(5) }
        else if lower.contains("saturday") || lower.contains("sat") { Some(6) }
        else if lower.contains("sunday") || lower.contains("sun") { Some(0) }
        else { None };

    if dow.is_some() {
        return CronSchedule { kind: "weekly".to_string(), time_of_day, day_of_week: dow, interval_secs: None };
    }

    // Daily
    CronSchedule { kind: "daily".to_string(), time_of_day, day_of_week: None, interval_secs: None }
}

fn parse_time_of_day(text: &str) -> Option<u32> {
    // Match patterns like "9am", "9:30am", "21:00", "9 am"
    let patterns = [
        (r"(\d{1,2}):(\d{2})\s*am", true),
        (r"(\d{1,2}):(\d{2})\s*pm", false),
        (r"(\d{1,2})\s*am", true),
        (r"(\d{1,2})\s*pm", false),
    ];

    for (_, is_am) in &patterns {
        // Manual parsing — avoid regex dependency
        if let Some(hour) = extract_hour(text, *is_am) {
            return Some(hour * 60);
        }
    }
    None
}

fn extract_hour(text: &str, is_am: bool) -> Option<u32> {
    let suffix = if is_am { "am" } else { "pm" };
    if let Some(pos) = text.find(suffix) {
        let before = &text[..pos].trim_end();
        let words: Vec<&str> = before.split_whitespace().collect();
        if let Some(last) = words.last() {
            if let Ok(h) = last.trim_matches(':').parse::<u32>() {
                let hour = if !is_am && h < 12 { h + 12 } else if is_am && h == 12 { 0 } else { h };
                return Some(hour.min(23));
            }
        }
    }
    None
}

// ── Tauri commands ─────────────────────────────────────────────────────────────

#[tauri::command]
pub fn cron_add(
    name: String,
    description: String,
    schedule_text: String,
    action_kind: String,
    action_content: String,
    action_cwd: Option<String>,
    action_agent_type: Option<String>,
) -> Result<String, String> {
    let conn = open_db()?;
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().timestamp();

    let schedule = parse_schedule(&schedule_text);
    let next_run = compute_next_run(&schedule, now);

    let action = CronAction {
        kind: action_kind,
        content: action_content,
        agent_type: action_agent_type,
        cwd: action_cwd,
    };

    let schedule_json = serde_json::to_string(&schedule).map_err(|e| e.to_string())?;
    let action_json = serde_json::to_string(&action).map_err(|e| e.to_string())?;

    conn.execute(
        "INSERT INTO cron_tasks (id, name, description, schedule_json, action_json, enabled, next_run, run_count, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6, 0, ?7)",
        params![id, name, description, schedule_json, action_json, next_run, now],
    ).map_err(|e| e.to_string())?;

    Ok(id)
}

#[tauri::command]
pub fn cron_list() -> Vec<CronTask> {
    let Ok(conn) = open_db() else { return vec![] };
    let mut stmt = match conn.prepare(
        "SELECT id, name, description, schedule_json, action_json, enabled, last_run, next_run, run_count, created_at
         FROM cron_tasks ORDER BY next_run ASC"
    ) { Ok(s) => s, Err(_) => return vec![] };
    stmt.query_map([], row_to_task)
        .map(|rows| rows.flatten().collect())
        .unwrap_or_default()
}

#[tauri::command]
pub fn cron_delete(id: String) -> Result<(), String> {
    let conn = open_db()?;
    conn.execute("DELETE FROM cron_tasks WHERE id = ?1", params![id]).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn cron_toggle(id: String, enabled: bool) -> Result<(), String> {
    let conn = open_db()?;
    conn.execute("UPDATE cron_tasks SET enabled = ?1 WHERE id = ?2",
        params![enabled as i64, id]).map_err(|e| e.to_string())?;
    Ok(())
}

/// Check and fire due tasks. Called from the background loop.
async fn fire_due_tasks(app: &tauri::AppHandle) {
    let Ok(conn) = open_db() else { return };
    let now = chrono::Utc::now().timestamp();

    let due: Vec<CronTask> = (|| {
        let mut s = conn.prepare(
            "SELECT id, name, description, schedule_json, action_json, enabled, last_run, next_run, run_count, created_at
             FROM cron_tasks WHERE enabled = 1 AND next_run <= ?1"
        ).ok()?;
        let rows = s.query_map(params![now], row_to_task).ok()?;
        Some(rows.flatten().collect::<Vec<CronTask>>())
    })().unwrap_or_default();

    for task in due {
        execute_task(&task, app).await;

        let next = compute_next_run(&task.schedule, now);
        let _ = conn.execute(
            "UPDATE cron_tasks SET last_run = ?1, next_run = ?2, run_count = run_count + 1 WHERE id = ?3",
            params![now, next, task.id],
        );

        log::info!("[cron] Fired task '{}', next run in {}s", task.name, next - now);
    }
}

async fn execute_task(task: &CronTask, app: &tauri::AppHandle) {
    log::info!("[cron] Executing task: {}", task.name);

    match task.action.kind.as_str() {
        "bash" => {
            // Run a shell command
            let cmd = task.action.content.clone();
            let cwd = task.action.cwd.clone();
            let output = tokio::process::Command::new("sh")
                .args(["-c", &cmd])
                .current_dir(cwd.as_deref().unwrap_or("/tmp"))
                .output()
                .await;

            let result = match output {
                Ok(out) => {
                    let stdout = String::from_utf8_lossy(&out.stdout).to_string();
                    let stderr = String::from_utf8_lossy(&out.stderr).to_string();
                    format!("Cron task '{}' output:\n{}\n{}", task.name, stdout, stderr)
                        .chars().take(500).collect::<String>()
                }
                Err(e) => format!("Cron task '{}' failed: {}", task.name, e),
            };

            let _ = app.emit("proactive_nudge", serde_json::json!({
                "message": result,
                "type": "cron_result",
            }));
        }
        "spawn_agent" => {
            // Spawn a background coding agent
            let agent_type = task.action.agent_type.clone().unwrap_or_else(|| "claude".to_string());
            let task_desc = task.action.content.clone();
            let cwd = task.action.cwd.clone();
            let app_clone = app.clone();
            tauri::async_runtime::spawn(async move {
                let _ = crate::background_agent::agent_spawn(app_clone, agent_type, task_desc, cwd).await;
            });
        }
        "message" | _ => {
            // Emit as a proactive nudge — BLADE will process it as a thought
            let msg = format!("[Scheduled: {}] {}", task.name, task.action.content);
            let _ = app.emit("proactive_nudge", serde_json::json!({
                "message": msg,
                "type": "cron_message",
            }));
        }
    }
}

/// Background loop — check for due tasks every 60 seconds
pub fn start_cron_loop(app: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        loop {
            fire_due_tasks(&app).await;
            tokio::time::sleep(tokio::time::Duration::from_secs(60)).await;
        }
    });
}
