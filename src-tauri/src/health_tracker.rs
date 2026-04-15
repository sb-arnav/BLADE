/// BLADE Health Tracker — Wellbeing Intelligence Engine
///
/// BLADE tracks sleep, exercise, mood, energy, and nutrition notes.
/// It correlates these with productivity patterns so it can adjust its
/// communication style and task expectations based on how the user is doing.
///
/// When you sleep badly, BLADE knows — and treats you accordingly.
///
/// All DB work is done synchronously before any `.await` points so no
/// rusqlite::Connection is held across an await boundary.
#[allow(dead_code)]

use chrono::{Local, Timelike};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::Emitter;
use uuid::Uuid;

// ── Structs ───────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HealthLog {
    pub id: String,
    pub date: String,                    // YYYY-MM-DD
    pub sleep_hours: Option<f32>,
    pub sleep_quality: Option<i32>,      // 1-10
    pub energy_level: Option<i32>,       // 1-10
    pub mood: Option<i32>,               // 1-10
    pub exercise_minutes: Option<i32>,
    pub exercise_type: Option<String>,   // "run", "gym", "walk", "yoga", etc.
    pub water_glasses: Option<i32>,
    pub notes: Option<String>,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HealthInsight {
    pub insight_type: String,  // "sleep_debt", "exercise_streak", "mood_pattern", "correlation"
    pub title: String,
    pub description: String,
    pub recommendation: String,
    pub urgency: String,       // "low", "medium", "high"
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HealthStats {
    pub avg_sleep: f32,
    pub avg_energy: f32,
    pub avg_mood: f32,
    pub exercise_days: i32,
    pub total_exercise_minutes: i32,
    pub sleep_debt: f32,              // hours below 8 * days
    pub best_day_pattern: String,     // what conditions correlate with high energy/mood
    pub period_days: i32,
}

// ── DB helpers ────────────────────────────────────────────────────────────────

fn db_path() -> std::path::PathBuf {
    crate::config::blade_config_dir().join("blade.db")
}

fn open_db() -> Result<Connection, String> {
    Connection::open(db_path()).map_err(|e| format!("DB open failed: {e}"))
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
    if let Ok(conn) = open_db() {
        let _ = conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS health_logs (
                id TEXT PRIMARY KEY,
                date TEXT NOT NULL UNIQUE,
                sleep_hours REAL,
                sleep_quality INTEGER,
                energy_level INTEGER,
                mood INTEGER,
                exercise_minutes INTEGER,
                exercise_type TEXT,
                water_glasses INTEGER,
                notes TEXT,
                created_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_health_logs_date ON health_logs (date DESC);",
        );
    }
}

// ── Row deserialiser ──────────────────────────────────────────────────────────

fn row_to_health_log(row: &rusqlite::Row<'_>) -> rusqlite::Result<HealthLog> {
    Ok(HealthLog {
        id: row.get(0)?,
        date: row.get(1)?,
        sleep_hours: row.get(2)?,
        sleep_quality: row.get(3)?,
        energy_level: row.get(4)?,
        mood: row.get(5)?,
        exercise_minutes: row.get(6)?,
        exercise_type: row.get(7)?,
        water_glasses: row.get(8)?,
        notes: row.get(9)?,
        created_at: row.get(10)?,
    })
}

// ── Logging ───────────────────────────────────────────────────────────────────

/// Insert or replace today's health log. Returns the log id.
pub fn log_health(log: HealthLog) -> Result<String, String> {
    let conn = open_db()?;
    conn.execute(
        "INSERT INTO health_logs
            (id, date, sleep_hours, sleep_quality, energy_level, mood,
             exercise_minutes, exercise_type, water_glasses, notes, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
         ON CONFLICT(date) DO UPDATE SET
            sleep_hours = excluded.sleep_hours,
            sleep_quality = excluded.sleep_quality,
            energy_level = excluded.energy_level,
            mood = excluded.mood,
            exercise_minutes = excluded.exercise_minutes,
            exercise_type = excluded.exercise_type,
            water_glasses = excluded.water_glasses,
            notes = excluded.notes",
        params![
            log.id,
            log.date,
            log.sleep_hours,
            log.sleep_quality,
            log.energy_level,
            log.mood,
            log.exercise_minutes,
            log.exercise_type,
            log.water_glasses,
            log.notes,
            log.created_at,
        ],
    )
    .map_err(|e| format!("Insert failed: {e}"))?;

    Ok(log.id)
}

/// Return the health log for today, if any.
pub fn get_today_log() -> Option<HealthLog> {
    let conn = open_db().ok()?;
    let today = Local::now().format("%Y-%m-%d").to_string();
    conn.query_row(
        "SELECT id, date, sleep_hours, sleep_quality, energy_level, mood,
                exercise_minutes, exercise_type, water_glasses, notes, created_at
         FROM health_logs WHERE date = ?1",
        params![today],
        row_to_health_log,
    )
    .ok()
}

/// Partially update today's log with the given JSON fields.
pub fn update_today_log(updates: serde_json::Value) -> Result<(), String> {
    let today = Local::now().format("%Y-%m-%d").to_string();
    let conn = open_db()?;

    // Ensure a row exists for today
    let exists: bool = conn
        .query_row(
            "SELECT COUNT(*) FROM health_logs WHERE date = ?1",
            params![today],
            |r| r.get::<_, i64>(0),
        )
        .unwrap_or(0)
        > 0;

    if !exists {
        let id = Uuid::new_v4().to_string();
        let now = Local::now().timestamp();
        conn.execute(
            "INSERT INTO health_logs (id, date, created_at) VALUES (?1, ?2, ?3)",
            params![id, today, now],
        )
        .map_err(|e| format!("Failed to create today row: {e}"))?;
    }

    // Apply each field present in the updates object
    let obj = updates.as_object().ok_or("updates must be a JSON object")?;
    for (key, val) in obj {
        let sql = match key.as_str() {
            "sleep_hours"      => "UPDATE health_logs SET sleep_hours = ?1 WHERE date = ?2",
            "sleep_quality"    => "UPDATE health_logs SET sleep_quality = ?1 WHERE date = ?2",
            "energy_level"     => "UPDATE health_logs SET energy_level = ?1 WHERE date = ?2",
            "mood"             => "UPDATE health_logs SET mood = ?1 WHERE date = ?2",
            "exercise_minutes" => "UPDATE health_logs SET exercise_minutes = ?1 WHERE date = ?2",
            "exercise_type"    => "UPDATE health_logs SET exercise_type = ?1 WHERE date = ?2",
            "water_glasses"    => "UPDATE health_logs SET water_glasses = ?1 WHERE date = ?2",
            "notes"            => "UPDATE health_logs SET notes = ?1 WHERE date = ?2",
            _                  => continue,
        };

        // Convert serde_json::Value to rusqlite-friendly types
        if val.is_string() {
            conn.execute(sql, params![val.as_str().unwrap_or(""), today])
                .map_err(|e| format!("Update {key} failed: {e}"))?;
        } else if let Some(n) = val.as_f64() {
            conn.execute(sql, params![n, today])
                .map_err(|e| format!("Update {key} failed: {e}"))?;
        } else if val.is_null() {
            let null_sql = sql.replace("?1", "NULL");
            conn.execute(&null_sql, params![today])
                .map_err(|e| format!("Update {key} to null failed: {e}"))?;
        }
    }

    Ok(())
}

/// Return health logs for the last N days (most recent first).
pub fn get_health_logs(days_back: i32) -> Vec<HealthLog> {
    let conn = match open_db() {
        Ok(c) => c,
        Err(_) => return vec![],
    };

    let cutoff = {
        let dt = Local::now()
            .date_naive()
            .checked_sub_days(chrono::Days::new(days_back as u64))
            .unwrap_or_else(|| Local::now().date_naive());
        dt.format("%Y-%m-%d").to_string()
    };

    let mut stmt = match conn.prepare(
        "SELECT id, date, sleep_hours, sleep_quality, energy_level, mood,
                exercise_minutes, exercise_type, water_glasses, notes, created_at
         FROM health_logs
         WHERE date >= ?1
         ORDER BY date DESC",
    ) {
        Ok(s) => s,
        Err(_) => return vec![],
    };

    stmt.query_map(params![cutoff], row_to_health_log)
        .map(|rows| rows.flatten().collect())
        .unwrap_or_default()
}

// ── Statistics ────────────────────────────────────────────────────────────────

pub fn get_stats(days_back: i32) -> HealthStats {
    let logs = get_health_logs(days_back);
    if logs.is_empty() {
        return HealthStats {
            avg_sleep: 0.0,
            avg_energy: 0.0,
            avg_mood: 0.0,
            exercise_days: 0,
            total_exercise_minutes: 0,
            sleep_debt: 0.0,
            best_day_pattern: "Not enough data yet".to_string(),
            period_days: days_back,
        };
    }

    let sleep_vals: Vec<f32> = logs.iter().filter_map(|l| l.sleep_hours).collect();
    let energy_vals: Vec<i32> = logs.iter().filter_map(|l| l.energy_level).collect();
    let mood_vals: Vec<i32> = logs.iter().filter_map(|l| l.mood).collect();

    let avg_sleep = if sleep_vals.is_empty() {
        0.0
    } else {
        sleep_vals.iter().sum::<f32>() / sleep_vals.len() as f32
    };

    let avg_energy = if energy_vals.is_empty() {
        0.0
    } else {
        energy_vals.iter().sum::<i32>() as f32 / energy_vals.len() as f32
    };

    let avg_mood = if mood_vals.is_empty() {
        0.0
    } else {
        mood_vals.iter().sum::<i32>() as f32 / mood_vals.len() as f32
    };

    let exercise_days = logs.iter().filter(|l| l.exercise_minutes.unwrap_or(0) > 0).count() as i32;
    let total_exercise_minutes = logs.iter().map(|l| l.exercise_minutes.unwrap_or(0)).sum::<i32>();

    // Sleep debt: how many hours below 8h per logged night
    let sleep_debt: f32 = sleep_vals.iter().map(|&h| (8.0 - h).max(0.0)).sum();

    // Best day pattern: find days with energy >= 8 and describe what they have in common
    let best_days: Vec<&HealthLog> = logs
        .iter()
        .filter(|l| l.energy_level.unwrap_or(0) >= 8 || l.mood.unwrap_or(0) >= 8)
        .collect();

    let best_day_pattern = if best_days.is_empty() {
        "No high-energy days in this period yet".to_string()
    } else {
        let had_exercise = best_days.iter().filter(|l| l.exercise_minutes.unwrap_or(0) > 0).count();
        let avg_best_sleep = {
            let vs: Vec<f32> = best_days.iter().filter_map(|l| l.sleep_hours).collect();
            if vs.is_empty() {
                0.0
            } else {
                vs.iter().sum::<f32>() / vs.len() as f32
            }
        };
        format!(
            "On your best days: avg sleep {:.1}h, exercise {}/{} days",
            avg_best_sleep, had_exercise, best_days.len()
        )
    };

    HealthStats {
        avg_sleep,
        avg_energy,
        avg_mood,
        exercise_days,
        total_exercise_minutes,
        sleep_debt,
        best_day_pattern,
        period_days: days_back,
    }
}

// ── LLM-powered insights ──────────────────────────────────────────────────────

pub async fn generate_health_insights(days_back: i32) -> Vec<HealthInsight> {
    // Collect data before any await
    let logs = get_health_logs(days_back);
    let stats = get_stats(days_back);

    if logs.is_empty() {
        return vec![HealthInsight {
            insight_type: "sleep_debt".to_string(),
            title: "Start tracking your health".to_string(),
            description: "Log your first health entry to unlock BLADE's wellbeing intelligence.".to_string(),
            recommendation: "Log today's sleep, energy, and mood using the Health panel.".to_string(),
            urgency: "low".to_string(),
        }];
    }

    let logs_json = serde_json::to_string_pretty(&logs).unwrap_or_default();
    let stats_json = serde_json::to_string_pretty(&stats).unwrap_or_default();

    let prompt = format!(
        "You are a health and productivity coach analyzing a user's wellbeing data.\n\n\
         Health logs (last {} days):\n{}\n\n\
         Summary stats:\n{}\n\n\
         Analyze patterns: sleep vs mood, exercise vs energy, sleep debt trends, \
         mood volatility, exercise consistency. Produce 3-5 specific, actionable insights.\n\n\
         Return ONLY a JSON array (no markdown, no extra text):\n\
         [\n  {{\n    \
           \"insight_type\": \"sleep_debt|exercise_streak|mood_pattern|correlation\",\n    \
           \"title\": \"short title\",\n    \
           \"description\": \"2-3 sentences with specific observations from the data\",\n    \
           \"recommendation\": \"one concrete, actionable recommendation\",\n    \
           \"urgency\": \"low|medium|high\"\n  \
         }}\n]",
        days_back, logs_json, stats_json
    );

    let config = crate::config::load_config();
    let (provider, api_key, model) =
        crate::config::resolve_provider_for_task(&config, &crate::router::TaskType::Complex);

    let messages = vec![crate::providers::ConversationMessage::User(prompt)];
    let turn = match crate::providers::complete_turn(&provider, &api_key, &model, &messages, &crate::providers::no_tools(), None).await {
        Ok(t) => t,
        Err(e) => {
            eprintln!("[health_tracker] LLM error: {e}");
            return vec![];
        }
    };

    let raw = strip_json_fences(&turn.content);
    serde_json::from_str::<Vec<HealthInsight>>(raw).unwrap_or_else(|e| {
        eprintln!(
            "[health_tracker] Failed to parse insights JSON: {e}\nRaw: {}",
            crate::safe_slice(raw, 200)
        );
        vec![]
    })
}

// ── Daily health nudge ────────────────────────────────────────────────────────

static NUDGE_ACTIVE: AtomicBool = AtomicBool::new(false);

pub async fn daily_health_nudge(app: tauri::AppHandle) {
    let hour = Local::now().hour();
    // Check if we already have today's log
    let today_log = get_today_log();

    // Past 9pm and no log yet — remind the user to log
    if hour >= 21 && today_log.is_none() {
        let _ = app.emit(
            "blade_health_nudge",
            serde_json::json!({
                "type": "missing_log",
                "message": "Hey — you haven't logged your health today. Takes 30 seconds. How did you sleep, how's your energy?"
            }),
        );
    }

    // Morning: check yesterday's sleep
    if hour >= 7 && hour <= 10 {
        let yesterday = {
            let dt = Local::now()
                .date_naive()
                .checked_sub_days(chrono::Days::new(1))
                .unwrap_or_else(|| Local::now().date_naive());
            dt.format("%Y-%m-%d").to_string()
        };

        let conn = match open_db() {
            Ok(c) => c,
            Err(_) => return,
        };

        let yesterday_sleep: Option<f32> = conn
            .query_row(
                "SELECT sleep_hours FROM health_logs WHERE date = ?1",
                params![yesterday],
                |r| r.get(0),
            )
            .ok()
            .flatten();

        if let Some(sleep_h) = yesterday_sleep {
            if sleep_h < 6.0 {
                let _ = app.emit(
                    "blade_health_nudge",
                    serde_json::json!({
                        "type": "poor_sleep_alert",
                        "sleep_hours": sleep_h,
                        "message": format!(
                            "You only slept {:.1}h last night. I'll keep today's tasks lighter and expectations reasonable. Take it easy.",
                            sleep_h
                        )
                    }),
                );
            }
        }
    }

    // If today we have a log with low energy or mood — surface a gentle note
    if let Some(ref log) = today_log {
        let low_energy = log.energy_level.map(|e| e <= 4).unwrap_or(false);
        let low_mood = log.mood.map(|m| m <= 4).unwrap_or(false);
        if low_energy || low_mood {
            let _ = app.emit(
                "blade_health_nudge",
                serde_json::json!({
                    "type": "low_energy_day",
                    "energy": log.energy_level,
                    "mood": log.mood,
                    "message": "You're running low today. I'll prioritize clarity over volume. What's the one thing worth doing right now?"
                }),
            );
        }
    }
}

pub fn start_health_nudge_loop(app: tauri::AppHandle) {
    if NUDGE_ACTIVE.swap(true, Ordering::SeqCst) {
        return; // already running
    }

    ensure_tables();

    tauri::async_runtime::spawn(async move {
        loop {
            daily_health_nudge(app.clone()).await;
            // Check every 2 hours
            tokio::time::sleep(tokio::time::Duration::from_secs(2 * 3600)).await;
        }
    });
}

// ── Context injection for brain.rs ───────────────────────────────────────────

/// Returns a formatted string describing the user's current health state.
/// Injected into the system prompt so BLADE can adapt its communication style.
pub fn get_health_context() -> String {
    let today_log = get_today_log();
    let stats_7 = get_stats(7);

    let mut lines: Vec<String> = Vec::new();

    // Today's snapshot
    if let Some(ref log) = today_log {
        let mut today_parts: Vec<String> = Vec::new();

        if let Some(h) = log.sleep_hours {
            let q_str = log
                .sleep_quality
                .map(|q| format!(" (quality {}/10)", q))
                .unwrap_or_default();
            today_parts.push(format!("sleep {:.1}h{}", h, q_str));
        }
        if let Some(e) = log.energy_level {
            today_parts.push(format!("energy {}/10", e));
        }
        if let Some(m) = log.mood {
            today_parts.push(format!("mood {}/10", m));
        }
        if let (Some(min), Some(et)) = (log.exercise_minutes, &log.exercise_type) {
            today_parts.push(format!("{} {}min", et, min));
        } else if let Some(min) = log.exercise_minutes {
            if min > 0 {
                today_parts.push(format!("exercise {}min", min));
            }
        }

        if !today_parts.is_empty() {
            lines.push(format!("Today: {}", today_parts.join(", ")));
        }
    }

    // Weekly averages (only if we have enough data)
    if stats_7.period_days > 0 && (stats_7.avg_sleep > 0.0 || stats_7.avg_energy > 0.0) {
        let mut week_parts: Vec<String> = Vec::new();

        if stats_7.avg_sleep > 0.0 {
            week_parts.push(format!("sleep {:.1}h", stats_7.avg_sleep));
        }
        if stats_7.avg_energy > 0.0 {
            week_parts.push(format!("energy {:.1}/10", stats_7.avg_energy));
        }
        if stats_7.exercise_days > 0 {
            week_parts.push(format!("exercise {}/{} days", stats_7.exercise_days, 7));
        }

        if !week_parts.is_empty() {
            lines.push(format!("This week avg: {}", week_parts.join(", ")));
        }
    }

    // Fatigue / sleep-debt advisory
    if stats_7.sleep_debt >= 6.0 {
        lines.push(format!(
            "Sleep debt: {:.0}h over the week — user is likely fatigued. Keep tasks concise.",
            stats_7.sleep_debt
        ));
    }

    // Low energy today advisory for BLADE
    if let Some(ref log) = today_log {
        if log.energy_level.map(|e| e <= 4).unwrap_or(false) {
            lines.push("Energy is low today — adjust expectations, keep tone supportive, avoid overwhelming task lists.".to_string());
        }
        if log.sleep_hours.map(|h| h < 6.0).unwrap_or(false) {
            lines.push("Poor sleep last night — be patient, avoid complex multi-step asks without explicit breaks.".to_string());
        }
    }

    if lines.is_empty() {
        return String::new();
    }

    format!("## User Wellbeing\n\n{}", lines.join("\n"))
}

// ── Productivity correlation ──────────────────────────────────────────────────

pub async fn correlate_with_productivity(days_back: i32) -> String {
    // Gather health logs and execution memory events before any await
    let health_logs = get_health_logs(days_back);

    if health_logs.is_empty() {
        return "No health data available for correlation analysis.".to_string();
    }

    // Pull recent execution memory events for date-based correlation
    let exec_events: Vec<serde_json::Value> = {
        let conn = match open_db() {
            Ok(c) => c,
            Err(_) => return "DB error when reading execution events.".to_string(),
        };

        let cutoff = Local::now().timestamp() - (days_back as i64) * 86_400;

        let mut stmt = match conn.prepare(
            "SELECT outcome, timestamp, command FROM execution_memory
             WHERE timestamp >= ?1
             ORDER BY timestamp DESC
             LIMIT 200",
        ) {
            Ok(s) => s,
            Err(_) => return "No execution memory table found.".to_string(),
        };

        stmt.query_map(params![cutoff], |row| {
            let outcome: String = row.get(0)?;
            let ts: i64 = row.get(1)?;
            let cmd: String = row.get(2).unwrap_or_default();
            Ok(serde_json::json!({
                "outcome": outcome,
                "date": chrono::DateTime::from_timestamp(ts, 0)
                    .map(|d| d.with_timezone(&Local).format("%Y-%m-%d").to_string())
                    .unwrap_or_else(|| "unknown".to_string()),
                "command_preview": crate::safe_slice(&cmd, 60)
            }))
        })
        .map(|rows| rows.flatten().collect::<Vec<_>>())
        .unwrap_or_default()
    };

    let health_json = serde_json::to_string_pretty(&health_logs).unwrap_or_default();
    let exec_json = serde_json::to_string_pretty(&exec_events).unwrap_or_default();

    let prompt = format!(
        "You are BLADE, analyzing correlation between health data and productivity for the user.\n\n\
         Health logs (last {} days):\n{}\n\n\
         Execution memory events (commands, outcomes by date):\n{}\n\n\
         Find patterns: Does sleep duration correlate with successful command outcomes? \
         Do exercise days show more productive sessions? Is mood predictive of output quality?\n\n\
         Write 3-5 specific, data-grounded findings in plain English. Be direct and concrete — \
         'You are 40%% more productive on days when you sleep 7+ hours' style. \
         End with one actionable recommendation.",
        days_back, health_json, exec_json
    );

    let config = crate::config::load_config();
    let (provider, api_key, model) =
        crate::config::resolve_provider_for_task(&config, &crate::router::TaskType::Complex);

    let messages = vec![crate::providers::ConversationMessage::User(prompt)];
    match crate::providers::complete_turn(&provider, &api_key, &model, &messages, &crate::providers::no_tools(), None).await {
        Ok(t) => t.content,
        Err(e) => format!("Could not generate correlation analysis: {e}"),
    }
}

// ── Streak info ───────────────────────────────────────────────────────────────

pub fn streak_info() -> serde_json::Value {
    let conn = match open_db() {
        Ok(c) => c,
        Err(_) => {
            return serde_json::json!({
                "exercise_streak": 0,
                "best_exercise_streak": 0,
                "days_since_last_log": null,
                "total_logs": 0
            })
        }
    };

    // All logged dates ordered desc
    let dates: Vec<String> = {
        let mut stmt = match conn.prepare(
            "SELECT date FROM health_logs ORDER BY date DESC",
        ) {
            Ok(s) => s,
            Err(_) => {
                return serde_json::json!({
                    "exercise_streak": 0,
                    "best_exercise_streak": 0,
                    "days_since_last_log": null,
                    "total_logs": 0
                })
            }
        };
        stmt.query_map([], |r| r.get(0))
            .map(|rows| rows.flatten().collect::<Vec<String>>())
            .unwrap_or_default()
    };

    let total_logs = dates.len() as i32;

    // Days since last log
    let days_since_last_log: Option<i64> = dates.first().and_then(|d| {
        chrono::NaiveDate::parse_from_str(d, "%Y-%m-%d").ok().map(|logged| {
            let today = Local::now().date_naive();
            (today - logged).num_days()
        })
    });

    // Exercise streak: consecutive days (from today going back) with exercise_minutes > 0
    let exercise_dates: std::collections::HashSet<String> = {
        let mut stmt = match conn.prepare(
            "SELECT date FROM health_logs WHERE exercise_minutes > 0 ORDER BY date DESC",
        ) {
            Ok(s) => s,
            Err(_) => {
                return serde_json::json!({
                    "exercise_streak": 0,
                    "best_exercise_streak": 0,
                    "days_since_last_log": days_since_last_log,
                    "total_logs": total_logs
                })
            }
        };
        stmt.query_map([], |r| r.get(0))
            .map(|rows| rows.flatten().collect())
            .unwrap_or_default()
    };

    let today = Local::now().date_naive();
    let mut exercise_streak = 0i32;
    let mut check_day = today;
    loop {
        let ds = check_day.format("%Y-%m-%d").to_string();
        if exercise_dates.contains(&ds) {
            exercise_streak += 1;
            check_day = match check_day.checked_sub_days(chrono::Days::new(1)) {
                Some(d) => d,
                None => break,
            };
        } else {
            break;
        }
    }

    // Best exercise streak ever — scan all exercise dates
    let mut all_exercise_dates: Vec<chrono::NaiveDate> = exercise_dates
        .iter()
        .filter_map(|d| chrono::NaiveDate::parse_from_str(d, "%Y-%m-%d").ok())
        .collect();
    all_exercise_dates.sort();

    let best_exercise_streak = if all_exercise_dates.is_empty() {
        0
    } else {
        let mut best = 1i32;
        let mut current = 1i32;
        for i in 1..all_exercise_dates.len() {
            let diff = (all_exercise_dates[i] - all_exercise_dates[i - 1]).num_days();
            if diff == 1 {
                current += 1;
                if current > best {
                    best = current;
                }
            } else {
                current = 1;
            }
        }
        best
    };

    serde_json::json!({
        "exercise_streak": exercise_streak,
        "best_exercise_streak": best_exercise_streak,
        "days_since_last_log": days_since_last_log,
        "total_logs": total_logs
    })
}

// ── Tauri commands ────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn health_log(log: HealthLog) -> Result<String, String> {
    // Ensure tables exist (idempotent)
    ensure_tables();
    log_health(log)
}

#[tauri::command]
pub async fn health_get_today() -> Option<HealthLog> {
    get_today_log()
}

#[tauri::command]
pub async fn health_update_today(updates: serde_json::Value) -> Result<(), String> {
    update_today_log(updates)
}

#[tauri::command]
pub async fn health_get_logs(days_back: i32) -> Vec<HealthLog> {
    get_health_logs(days_back)
}

#[tauri::command]
pub async fn health_get_stats(days_back: i32) -> HealthStats {
    get_stats(days_back)
}

#[tauri::command]
pub async fn health_get_insights(days_back: i32) -> Vec<HealthInsight> {
    generate_health_insights(days_back).await
}

#[tauri::command]
pub async fn health_get_context() -> String {
    get_health_context()
}

#[tauri::command]
pub async fn health_correlate_productivity(days_back: i32) -> String {
    correlate_with_productivity(days_back).await
}

#[tauri::command]
pub async fn health_streak_info() -> serde_json::Value {
    streak_info()
}
