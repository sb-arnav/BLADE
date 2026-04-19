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
/// All tasks stored in blade.db (not cron.db). Background loop checks every 60 seconds.
/// The loop respects config.background_ai_enabled — all tasks are skipped when disabled.

use chrono::{Datelike, Timelike};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
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
    pub kind: String,              // "daily" | "weekly" | "interval" | "hourly"
    pub time_of_day: Option<u32>,  // minutes since midnight (e.g. 9*60 = 540 for 9am)
    pub day_of_week: Option<u32>,  // 0=Sun .. 6=Sat (for weekly)
    pub interval_secs: Option<i64>, // for interval kind
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CronAction {
    pub kind: String,              // "message" | "bash" | "spawn_agent" | "pulse" | "inbox_check"
    pub content: String,           // the message, command, or task description
    pub agent_type: Option<String>, // for spawn_agent: "claude" | "bash" etc
    pub cwd: Option<String>,
}

/// Open (or migrate) the cron_tasks table in blade.db.
fn open_db() -> Result<Connection, String> {
    let db_path = crate::config::blade_config_dir().join("blade.db");
    let conn = Connection::open(&db_path).map_err(|e| e.to_string())?;
    // Use blade.db so tasks persist with everything else.
    // IMPORTANT: no double-quotes in SQL strings — breaks execute_batch!
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
            created_at INTEGER NOT NULL,
            is_preset INTEGER NOT NULL DEFAULT 0
        );
    ").map_err(|e| e.to_string())?;
    // Migrate: add is_preset column if it does not yet exist (for existing databases)
    let _ = conn.execute_batch("ALTER TABLE cron_tasks ADD COLUMN is_preset INTEGER NOT NULL DEFAULT 0;");
    Ok(conn)
}

fn row_to_task(row: &rusqlite::Row) -> rusqlite::Result<CronTask> {
    let schedule_json: String = row.get(3)?;
    let action_json: String = row.get(4)?;
    let schedule: CronSchedule = serde_json::from_str(&schedule_json).unwrap_or(CronSchedule {
        kind: "daily".to_string(),
        time_of_day: Some(540),
        day_of_week: None,
        interval_secs: None,
    });
    let action: CronAction = serde_json::from_str(&action_json).unwrap_or(CronAction {
        kind: "message".to_string(),
        content: String::new(),
        agent_type: None,
        cwd: None,
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
    if lower.contains("every 2 hour") || lower.contains("every two hour") {
        return CronSchedule { kind: "interval".to_string(), time_of_day: None, day_of_week: None, interval_secs: Some(7200) };
    }
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
    for is_am in &[true, false] {
        if let Some(hour) = extract_hour(text, *is_am) {
            return Some(hour * 60);
        }
    }
    None
}

fn extract_hour(text: &str, is_am: bool) -> Option<u32> {
    let suffix = if is_am { "am" } else { "pm" };
    if let Some(pos) = text.find(suffix) {
        let before = &text[..pos];
        let trimmed = before.trim_end();
        let words: Vec<&str> = trimmed.split_whitespace().collect();
        if let Some(last) = words.last() {
            if let Ok(h) = last.trim_matches(':').parse::<u32>() {
                let hour = if !is_am && h < 12 { h + 12 } else if is_am && h == 12 { 0 } else { h };
                return Some(hour.min(23));
            }
        }
    }
    None
}

// ── Preset tasks ────────────────────────────────────────────────────────────────

/// Seed the three built-in preset tasks into blade.db (only once — INSERT OR IGNORE).
/// Presets start disabled so the user must opt in.
fn seed_preset_tasks(conn: &Connection) {
    let now = chrono::Utc::now().timestamp();

    // (id, name, description, schedule_json, action_json)
    let presets: &[(&str, &str, &str, &str, &str)] = &[
        (
            "preset:morning_briefing",
            "Morning Briefing",
            "Daily 9am morning summary: calendar, email, git, weather, and temporal patterns.",
            r#"{"kind":"daily","time_of_day":540,"day_of_week":null,"interval_secs":null}"#,
            r#"{"kind":"pulse","content":"morning_briefing","agent_type":null,"cwd":null}"#,
        ),
        (
            "preset:weekly_review",
            "Weekly Review",
            "Monday 10am: summarise the week's work, commits, and patterns.",
            r#"{"kind":"weekly","time_of_day":600,"day_of_week":1,"interval_secs":null}"#,
            r#"{"kind":"pulse","content":"weekly_review","agent_type":null,"cwd":null}"#,
        ),
        (
            "preset:inbox_check",
            "Inbox Check",
            "Every 2 hours: check integration state (email, calendar, Slack, GitHub) and alert if urgent.",
            r#"{"kind":"interval","time_of_day":null,"day_of_week":null,"interval_secs":7200}"#,
            r#"{"kind":"inbox_check","content":"inbox_check","agent_type":null,"cwd":null}"#,
        ),
        (
            "preset:memory_consolidation",
            "Weekly Memory Consolidation",
            "Sunday midnight: merge duplicate KG nodes, promote core knowledge, prune stale facts, generate memory diff.",
            r#"{"kind":"weekly","time_of_day":0,"day_of_week":0,"interval_secs":null}"#,
            r#"{"kind":"memory_consolidation","content":"memory_consolidation","agent_type":null,"cwd":null}"#,
        ),
    ];

    for (id, name, desc, sched_json, action_json) in presets {
        let next = {
            let sched: CronSchedule = serde_json::from_str(sched_json)
                .unwrap_or(CronSchedule { kind: "daily".to_string(), time_of_day: Some(540), day_of_week: None, interval_secs: None });
            compute_next_run(&sched, now)
        };
        // is_preset = 1, enabled = 0 (user must opt in)
        let _ = conn.execute(
            "INSERT OR IGNORE INTO cron_tasks (id, name, description, schedule_json, action_json, enabled, next_run, run_count, created_at, is_preset)
             VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6, 0, ?7, 1)",
            params![id, name, desc, sched_json, action_json, next, now],
        );
    }
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
        "INSERT INTO cron_tasks (id, name, description, schedule_json, action_json, enabled, next_run, run_count, created_at, is_preset)
         VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6, 0, ?7, 0)",
        params![id, name, description, schedule_json, action_json, next_run, now],
    ).map_err(|e| e.to_string())?;

    Ok(id)
}

#[tauri::command]
pub fn cron_list() -> Vec<CronTask> {
    let Ok(conn) = open_db() else { return vec![] };
    // Seed presets on first list (no-op if already seeded)
    seed_preset_tasks(&conn);
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
    conn.execute("DELETE FROM cron_tasks WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn cron_toggle(id: String, enabled: bool) -> Result<(), String> {
    let conn = open_db()?;
    // When enabling a task, also bump its next_run so it doesn't fire immediately
    // if it was last-run long ago.
    let now = chrono::Utc::now().timestamp();
    if enabled {
        // Recalculate next_run from now
        let task: Option<CronTask> = conn.query_row(
            "SELECT id, name, description, schedule_json, action_json, enabled, last_run, next_run, run_count, created_at
             FROM cron_tasks WHERE id = ?1",
            params![id],
            row_to_task,
        ).ok();
        if let Some(t) = task {
            let next = compute_next_run(&t.schedule, now);
            conn.execute(
                "UPDATE cron_tasks SET enabled = 1, next_run = ?1 WHERE id = ?2",
                params![next, id],
            ).map_err(|e| e.to_string())?;
            return Ok(());
        }
    }
    conn.execute(
        "UPDATE cron_tasks SET enabled = ?1 WHERE id = ?2",
        params![enabled as i64, id],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

/// Manually trigger a task by ID right now, regardless of its schedule.
#[tauri::command]
pub async fn cron_run_now(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let task = {
        let conn = open_db()?;
        conn.query_row(
            "SELECT id, name, description, schedule_json, action_json, enabled, last_run, next_run, run_count, created_at
             FROM cron_tasks WHERE id = ?1",
            params![id],
            row_to_task,
        ).map_err(|e| format!("Task not found: {}", e))?
    };

    execute_task(&task, &app).await;

    // Update last_run and advance next_run
    let conn = open_db()?;
    let now = chrono::Utc::now().timestamp();
    let next = compute_next_run(&task.schedule, now);
    let _ = conn.execute(
        "UPDATE cron_tasks SET last_run = ?1, next_run = ?2, run_count = run_count + 1 WHERE id = ?3",
        params![now, next, task.id],
    );

    Ok(())
}

/// Check and fire due tasks. Called from the background loop.
async fn fire_due_tasks(app: &tauri::AppHandle) {
    // Respect background_ai_enabled — skip all tasks when disabled
    let config = crate::config::load_config();
    if !config.background_ai_enabled {
        return;
    }

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
    log::info!("[cron] Executing task: {} (kind={})", task.name, task.action.kind);

    match task.action.kind.as_str() {
        "bash" => {
            execute_bash_task(task, app).await;
        }
        "spawn_agent" => {
            let agent_type = task.action.agent_type.clone().unwrap_or_else(|| "claude".to_string());
            let task_desc = task.action.content.clone();
            let cwd = task.action.cwd.clone();
            let app_clone = app.clone();
            tauri::async_runtime::spawn(async move {
                match crate::background_agent::agent_spawn(app_clone.clone(), agent_type, task_desc, cwd).await {
                    Ok(_) => {}
                    Err(e) => {
                        log::warn!("[cron] spawn_agent failed: {}", e);
                        let _ = app_clone.emit("proactive_nudge", serde_json::json!({
                            "message": format!("Cron task agent failed: {}", e),
                            "type": "cron_error",
                        }));
                    }
                }
            });
        }
        "pulse" => {
            execute_pulse_task(task, app).await;
        }
        "inbox_check" => {
            execute_inbox_check(task, app).await;
        }
        "memory_consolidation" => {
            execute_memory_consolidation(app).await;
        }
        // "message" and anything else
        _ => {
            let msg = format!("[Scheduled: {}] {}", task.name, task.action.content);
            let _ = app.emit("proactive_nudge", serde_json::json!({
                "message": msg,
                "type": "cron_message",
            }));
        }
    }
}

async fn execute_bash_task(task: &CronTask, app: &tauri::AppHandle) {
    let cmd = task.action.content.clone();
    let cwd = task.action.cwd.clone();
    #[cfg(target_os = "windows")]
    let default_cwd = std::env::var("TEMP").unwrap_or_else(|_| "C:\\Temp".to_string());
    #[cfg(not(target_os = "windows"))]
    let default_cwd = "/tmp".to_string();

    #[cfg(target_os = "windows")]
    let mut proc = crate::cmd_util::silent_tokio_cmd("cmd");
    #[cfg(target_os = "windows")]
    let proc = proc.args(["/C", &cmd]);
    #[cfg(not(target_os = "windows"))]
    let mut proc = crate::cmd_util::silent_tokio_cmd("sh");
    #[cfg(not(target_os = "windows"))]
    let proc = proc.args(["-c", &cmd]);

    let output = proc
        .current_dir(cwd.as_deref().unwrap_or(&default_cwd))
        .output()
        .await;

    let result = match output {
        Ok(out) => {
            let stdout = String::from_utf8_lossy(&out.stdout).to_string();
            let stderr = String::from_utf8_lossy(&out.stderr).to_string();
            let combined = format!("Cron task '{}' output:\n{}\n{}", task.name, stdout, stderr);
            combined.chars().take(500).collect::<String>()
        }
        Err(e) => format!("Cron task '{}' failed: {}", task.name, e),
    };

    let _ = app.emit("proactive_nudge", serde_json::json!({
        "message": result,
        "type": "cron_result",
    }));
}

/// Execute a pulse-type task: calls the appropriate briefing function.
async fn execute_pulse_task(task: &CronTask, app: &tauri::AppHandle) {
    let config = crate::config::load_config();
    if config.api_key.is_empty() && config.provider != "ollama" {
        log::warn!("[cron] Skipping pulse task '{}' — no API key", task.name);
        return;
    }

    match task.action.content.as_str() {
        "morning_briefing" => {
            // Force a fresh morning briefing regardless of the once-per-day guard
            crate::pulse::run_morning_briefing(app.clone()).await;
        }
        "weekly_review" => {
            run_weekly_review(app, &config).await;
        }
        _ => {
            // Generic: trigger pulse_now
            match crate::pulse::pulse_now(app.clone()).await {
                Ok(thought) => {
                    log::info!("[cron] Pulse task '{}' fired: {}", task.name, crate::safe_slice(&thought, 60));
                }
                Err(e) => {
                    log::warn!("[cron] Pulse task '{}' failed: {}", task.name, e);
                }
            }
        }
    }
}

/// Execute the inbox_check task: poll integration state and alert on urgent items.
async fn execute_inbox_check(_task: &CronTask, app: &tauri::AppHandle) {
    let state = crate::integration_bridge::get_integration_state();

    let mut alerts: Vec<String> = Vec::new();

    if state.unread_emails > 10 {
        alerts.push(format!("{} unread emails", state.unread_emails));
    }

    // Flag calendar events starting within the next 30 minutes
    let now = chrono::Utc::now().timestamp();
    for event in &state.upcoming_events {
        let mins_until = (event.start_ts - now) / 60;
        if mins_until >= 0 && mins_until <= 30 {
            alerts.push(format!("\"{}\" starts in {}min", event.title, mins_until));
        }
    }

    if state.slack_mentions > 5 {
        alerts.push(format!("{} unread Slack mentions", state.slack_mentions));
    }

    if state.github_notifications > 10 {
        alerts.push(format!("{} GitHub notifications", state.github_notifications));
    }

    if alerts.is_empty() {
        log::debug!("[cron] inbox_check: nothing urgent");
        return;
    }

    let msg = format!("[Inbox Check] Urgent items: {}", alerts.join(", "));

    // Emit a proactive nudge so the frontend surfaces it
    let _ = app.emit("proactive_nudge", serde_json::json!({
        "message": msg,
        "type": "inbox_alert",
        "alerts": alerts,
    }));

    // Also emit blade_briefing with the integration state so the frontend can display it
    let _ = app.emit_to("main", "blade_briefing", serde_json::json!({
        "briefing": msg,
        "date": chrono::Local::now().format("%Y-%m-%d").to_string(),
        "source": "inbox_check",
        "integration_state": state,
    }));

    log::info!("[cron] inbox_check: fired alert — {}", msg);
}

/// Generate a weekly review briefing via the AI.
async fn run_weekly_review(app: &tauri::AppHandle, config: &crate::config::BladeConfig) {
    let now = chrono::Local::now();
    let week_start = now.timestamp() - 7 * 86400;

    let db_path = crate::config::blade_config_dir().join("blade.db");
    let recent_events = rusqlite::Connection::open(&db_path)
        .ok()
        .and_then(|conn| {
            let mut stmt = conn.prepare(
                "SELECT event_type, title, timestamp FROM activity_timeline WHERE timestamp > ?1 ORDER BY timestamp ASC LIMIT 50"
            ).ok()?;
            let rows = stmt.query_map(rusqlite::params![week_start], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)?,
                ))
            }).ok()?;
            Some(
                rows.flatten()
                    .map(|(typ, title, ts)| {
                        let dt = chrono::DateTime::from_timestamp(ts, 0)
                            .map(|d| d.format("%a %-H:%M").to_string())
                            .unwrap_or_else(|| "?".to_string());
                        format!("[{}] {}: {}", dt, typ, crate::safe_slice(&title, 60))
                    })
                    .collect::<Vec<_>>()
                    .join("\n"),
            )
        })
        .unwrap_or_default();

    let memory = {
        rusqlite::Connection::open(&db_path)
            .map(|conn| crate::db::brain_build_context(&conn, 300))
            .unwrap_or_default()
    };

    let integration_ctx = crate::integration_bridge::get_integration_context();

    let name_line = if !config.user_name.is_empty() {
        format!("The person is {}.", config.user_name)
    } else {
        String::new()
    };

    let prompt = format!(
        r#"You are BLADE. It is Monday morning. {name_line}

Summarise the past week in 3-4 sentences. Be specific. What did they actually work on? What patterns do you see? What didn't get done? What should they carry forward into this week?

Week events:
{events}

Memory context:
{memory}

{integration}

Voice: Direct, honest. No headers. No bullets. Start in the middle."#,
        name_line = name_line,
        events = if recent_events.is_empty() { "No recorded events.".to_string() } else { recent_events },
        memory = if memory.is_empty() { "No memory context.".to_string() } else { memory },
        integration = if integration_ctx.is_empty() { String::new() } else { integration_ctx },
    );

    let model = crate::config::cheap_model_for_provider(&config.provider, &config.model);
    match crate::pulse::call_provider_simple(config, &model, &prompt).await {
        Ok(review) if review.len() > 20 => {
            let date_str = now.format("%Y-%m-%d").to_string();
            let _ = app.emit_to("main", "blade_briefing", serde_json::json!({
                "briefing": review,
                "date": date_str,
                "source": "weekly_review",
            }));
            // Persist to activity timeline
            if let Ok(conn) = rusqlite::Connection::open(&db_path) {
                let _ = crate::db::timeline_record(
                    &conn,
                    "briefing",
                    &format!("Weekly review {}", date_str),
                    &review,
                    "BLADE",
                    "{}",
                );
            }
            // Speak if TTS enabled
            crate::tts::speak(&review);
            log::info!("[cron] Weekly review generated ({} chars)", review.len());
        }
        Ok(_) => log::warn!("[cron] Weekly review returned empty response"),
        Err(e) => {
            crate::config::check_and_disable_on_402(&e);
            log::warn!("[cron] Weekly review failed: {}", e);
        }
    }
}

/// Execute the weekly memory consolidation task.
async fn execute_memory_consolidation(app: &tauri::AppHandle) {
    log::info!("[cron] Running weekly memory consolidation");

    let diff = crate::memory::weekly_memory_consolidation().await;

    if diff.is_empty() {
        log::info!("[cron] Memory consolidation: no changes");
        return;
    }

    let short_summary = diff.lines().take(3).collect::<Vec<_>>().join(" | ");
    log::info!("[cron] Memory consolidation complete: {}", short_summary);

    let _ = app.emit("proactive_nudge", serde_json::json!({
        "message": format!("[Memory Consolidation]\n{}", diff),
        "type": "memory_consolidation",
    }));

    // Also record in timeline
    let db_path = crate::config::blade_config_dir().join("blade.db");
    if let Ok(conn) = rusqlite::Connection::open(&db_path) {
        let date_str = chrono::Local::now().format("%Y-%m-%d").to_string();
        let _ = crate::db::timeline_record(
            &conn,
            "memory",
            &format!("Weekly memory consolidation {}", date_str),
            &diff,
            "BLADE",
            "{}",
        );
    }
}

/// Background loop — check for due tasks every 60 seconds.
/// Respects config.background_ai_enabled (checked inside fire_due_tasks).
pub fn start_cron_loop(app: tauri::AppHandle) {
    // Seed preset tasks on startup
    if let Ok(conn) = open_db() {
        seed_preset_tasks(&conn);
    }

    tauri::async_runtime::spawn(async move {
        loop {
            fire_due_tasks(&app).await;
            tokio::time::sleep(tokio::time::Duration::from_secs(60)).await;
        }
    });
}
