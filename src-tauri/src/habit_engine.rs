/// BLADE Habit Engine — Streak Tracking, Friction Analysis & Smart Reminders
///
/// BLADE helps the user build and sustain habits by tracking streaks,
/// identifying friction points, sending smart reminders at optimal times,
/// and learning which habits stick versus which fail.
///
/// All DB work is done synchronously before any `.await` points so no
/// rusqlite::Connection is held across an await boundary.
#[allow(dead_code)]

use chrono::{Datelike, Local, NaiveDate};
use rusqlite::params;
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{Emitter, Manager};
use uuid::Uuid;

// ── Structs ───────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Habit {
    pub id: String,
    pub name: String,
    pub description: String,
    pub frequency: String,       // "daily", "weekdays", "weekly", "3x_week"
    pub target_time: Option<String>, // "08:00" preferred time
    pub category: String,        // "health", "learning", "productivity", "social", "mindfulness"
    pub current_streak: i32,
    pub best_streak: i32,
    pub total_completions: i32,
    pub completion_rate: f32,    // 0.0–1.0 over last 30 days
    pub friction_score: f32,     // 0.0–1.0 how often user skips
    pub cue: String,             // trigger that precedes the habit
    pub reward: String,          // what user gets after completing
    pub created_at: i64,
    pub active: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HabitLog {
    pub id: String,
    pub habit_id: String,
    pub date: String,            // YYYY-MM-DD
    pub completed: bool,
    pub notes: Option<String>,
    pub mood_after: Option<i32>, // 1-10
    pub timestamp: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HabitInsight {
    pub habit_name: String,
    pub insight_type: String, // "streak_at_risk", "pattern_found", "friction_point", "achievement"
    pub description: String,
    pub suggestion: String,
}

// ── DB helpers ────────────────────────────────────────────────────────────────

fn db_path() -> std::path::PathBuf {
    crate::config::blade_config_dir().join("blade.db")
}

fn open_db() -> Result<rusqlite::Connection, String> {
    rusqlite::Connection::open(db_path()).map_err(|e| format!("DB open failed: {e}"))
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
            "CREATE TABLE IF NOT EXISTS habits (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                frequency TEXT NOT NULL DEFAULT 'daily',
                target_time TEXT,
                category TEXT NOT NULL DEFAULT 'productivity',
                current_streak INTEGER NOT NULL DEFAULT 0,
                best_streak INTEGER NOT NULL DEFAULT 0,
                total_completions INTEGER NOT NULL DEFAULT 0,
                completion_rate REAL NOT NULL DEFAULT 0.0,
                friction_score REAL NOT NULL DEFAULT 0.0,
                cue TEXT NOT NULL DEFAULT '',
                reward TEXT NOT NULL DEFAULT '',
                created_at INTEGER NOT NULL,
                active INTEGER NOT NULL DEFAULT 1
            );
            CREATE INDEX IF NOT EXISTS idx_habits_active ON habits (active);

            CREATE TABLE IF NOT EXISTS habit_logs (
                id TEXT PRIMARY KEY,
                habit_id TEXT NOT NULL,
                date TEXT NOT NULL,
                completed INTEGER NOT NULL DEFAULT 1,
                notes TEXT,
                mood_after INTEGER,
                timestamp INTEGER NOT NULL,
                FOREIGN KEY (habit_id) REFERENCES habits(id) ON DELETE CASCADE,
                UNIQUE(habit_id, date)
            );
            CREATE INDEX IF NOT EXISTS idx_habit_logs_habit_date ON habit_logs (habit_id, date DESC);
            CREATE INDEX IF NOT EXISTS idx_habit_logs_date ON habit_logs (date DESC);",
        );
    }
}

// ── Row deserialisers ─────────────────────────────────────────────────────────

fn row_to_habit(row: &rusqlite::Row<'_>) -> rusqlite::Result<Habit> {
    Ok(Habit {
        id: row.get(0)?,
        name: row.get(1)?,
        description: row.get(2)?,
        frequency: row.get(3)?,
        target_time: row.get(4)?,
        category: row.get(5)?,
        current_streak: row.get(6)?,
        best_streak: row.get(7)?,
        total_completions: row.get(8)?,
        completion_rate: row.get(9)?,
        friction_score: row.get(10)?,
        cue: row.get(11)?,
        reward: row.get(12)?,
        created_at: row.get(13)?,
        active: row.get::<_, i64>(14)? != 0,
    })
}

fn row_to_log(row: &rusqlite::Row<'_>) -> rusqlite::Result<HabitLog> {
    Ok(HabitLog {
        id: row.get(0)?,
        habit_id: row.get(1)?,
        date: row.get(2)?,
        completed: row.get::<_, i64>(3)? != 0,
        notes: row.get(4)?,
        mood_after: row.get(5)?,
        timestamp: row.get(6)?,
    })
}

// ── Habit management ──────────────────────────────────────────────────────────

/// Create a new habit. Returns the new habit id.
pub fn create_habit(h: Habit) -> Result<String, String> {
    ensure_tables();
    let conn = open_db()?;
    let id = if h.id.is_empty() {
        Uuid::new_v4().to_string()
    } else {
        h.id.clone()
    };
    let now = Local::now().timestamp();
    conn.execute(
        "INSERT INTO habits
            (id, name, description, frequency, target_time, category,
             current_streak, best_streak, total_completions, completion_rate,
             friction_score, cue, reward, created_at, active)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
        params![
            id,
            h.name,
            h.description,
            h.frequency,
            h.target_time,
            h.category,
            h.current_streak,
            h.best_streak,
            h.total_completions,
            h.completion_rate,
            h.friction_score,
            h.cue,
            h.reward,
            if h.created_at == 0 { now } else { h.created_at },
            if h.active { 1i64 } else { 0i64 },
        ],
    )
    .map_err(|e| format!("Insert habit failed: {e}"))?;
    Ok(id)
}

/// Fetch a single habit by id.
pub fn get_habit(id: &str) -> Option<Habit> {
    ensure_tables();
    let conn = open_db().ok()?;
    conn.query_row(
        "SELECT id, name, description, frequency, target_time, category,
                current_streak, best_streak, total_completions, completion_rate,
                friction_score, cue, reward, created_at, active
         FROM habits WHERE id = ?1",
        params![id],
        row_to_habit,
    )
    .ok()
}

/// List habits. Pass `active_only = true` to filter archived ones.
pub fn list_habits(active_only: bool) -> Vec<Habit> {
    ensure_tables();
    let conn = match open_db() {
        Ok(c) => c,
        Err(_) => return vec![],
    };

    let sql = if active_only {
        "SELECT id, name, description, frequency, target_time, category,
                current_streak, best_streak, total_completions, completion_rate,
                friction_score, cue, reward, created_at, active
         FROM habits WHERE active = 1 ORDER BY name ASC"
    } else {
        "SELECT id, name, description, frequency, target_time, category,
                current_streak, best_streak, total_completions, completion_rate,
                friction_score, cue, reward, created_at, active
         FROM habits ORDER BY active DESC, name ASC"
    };

    let mut stmt = match conn.prepare(sql) {
        Ok(s) => s,
        Err(_) => return vec![],
    };

    stmt.query_map([], row_to_habit)
        .map(|rows| rows.flatten().collect())
        .unwrap_or_default()
}

/// Partially update a habit with JSON field values.
#[allow(dead_code)]
pub fn update_habit(id: &str, updates: serde_json::Value) -> Result<(), String> {
    let conn = open_db()?;
    let obj = updates.as_object().ok_or("updates must be a JSON object")?;

    for (key, val) in obj {
        let sql = match key.as_str() {
            "name"           => "UPDATE habits SET name = ?1 WHERE id = ?2",
            "description"    => "UPDATE habits SET description = ?1 WHERE id = ?2",
            "frequency"      => "UPDATE habits SET frequency = ?1 WHERE id = ?2",
            "target_time"    => "UPDATE habits SET target_time = ?1 WHERE id = ?2",
            "category"       => "UPDATE habits SET category = ?1 WHERE id = ?2",
            "cue"            => "UPDATE habits SET cue = ?1 WHERE id = ?2",
            "reward"         => "UPDATE habits SET reward = ?1 WHERE id = ?2",
            "current_streak" => "UPDATE habits SET current_streak = ?1 WHERE id = ?2",
            "best_streak"    => "UPDATE habits SET best_streak = ?1 WHERE id = ?2",
            "total_completions" => "UPDATE habits SET total_completions = ?1 WHERE id = ?2",
            "completion_rate"   => "UPDATE habits SET completion_rate = ?1 WHERE id = ?2",
            "friction_score"    => "UPDATE habits SET friction_score = ?1 WHERE id = ?2",
            _ => continue,
        };

        if val.is_string() {
            conn.execute(sql, params![val.as_str().unwrap_or(""), id])
                .map_err(|e| format!("Update {key} failed: {e}"))?;
        } else if val.is_null() {
            let null_sql = sql.replace("?1", "NULL");
            conn.execute(&null_sql, params![id])
                .map_err(|e| format!("Null update {key} failed: {e}"))?;
        } else if let Some(n) = val.as_f64() {
            conn.execute(sql, params![n, id])
                .map_err(|e| format!("Update {key} failed: {e}"))?;
        }
    }

    Ok(())
}

/// Archive (soft-delete) a habit so it no longer appears in the active list.
#[allow(dead_code)]
pub fn archive_habit(id: &str) -> Result<(), String> {
    let conn = open_db()?;
    conn.execute("UPDATE habits SET active = 0 WHERE id = ?1", params![id])
        .map_err(|e| format!("Archive failed: {e}"))?;
    Ok(())
}

// ── Logging ───────────────────────────────────────────────────────────────────

/// Recompute completion_rate (last 30 days) and update it in the DB.
fn refresh_completion_rate(conn: &rusqlite::Connection, habit_id: &str) {
    let cutoff = {
        let d = Local::now()
            .date_naive()
            .checked_sub_days(chrono::Days::new(30))
            .unwrap_or_else(|| Local::now().date_naive());
        d.format("%Y-%m-%d").to_string()
    };

    let total: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM habit_logs WHERE habit_id = ?1 AND date >= ?2",
            params![habit_id, cutoff],
            |r| r.get(0),
        )
        .unwrap_or(0);

    let completed: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM habit_logs WHERE habit_id = ?1 AND date >= ?2 AND completed = 1",
            params![habit_id, cutoff],
            |r| r.get(0),
        )
        .unwrap_or(0);

    let rate = if total == 0 {
        0.0_f64
    } else {
        completed as f64 / total as f64
    };

    let _ = conn.execute(
        "UPDATE habits SET completion_rate = ?1 WHERE id = ?2",
        params![rate, habit_id],
    );
}

/// Log a habit completion. Updates streak, completion_rate, and total_completions atomically.
pub fn complete_habit(
    habit_id: &str,
    date: &str,
    notes: Option<String>,
    mood_after: Option<i32>,
) -> Result<(), String> {
    ensure_tables();
    let conn = open_db()?;

    let log_id = Uuid::new_v4().to_string();
    let now = Local::now().timestamp();

    conn.execute(
        "INSERT INTO habit_logs (id, habit_id, date, completed, notes, mood_after, timestamp)
         VALUES (?1, ?2, ?3, 1, ?4, ?5, ?6)
         ON CONFLICT(habit_id, date) DO UPDATE SET
            completed = 1, notes = excluded.notes, mood_after = excluded.mood_after, timestamp = excluded.timestamp",
        params![log_id, habit_id, date, notes, mood_after, now],
    )
    .map_err(|e| format!("Log completion failed: {e}"))?;

    // Recalculate streak
    let streak = calculate_streak_inner(&conn, habit_id);

    // Fetch current best
    let best: i32 = conn
        .query_row(
            "SELECT best_streak FROM habits WHERE id = ?1",
            params![habit_id],
            |r| r.get(0),
        )
        .unwrap_or(0);

    let new_best = best.max(streak);

    conn.execute(
        "UPDATE habits SET current_streak = ?1, best_streak = ?2,
         total_completions = total_completions + 1 WHERE id = ?3",
        params![streak, new_best, habit_id],
    )
    .map_err(|e| format!("Update streak failed: {e}"))?;

    refresh_completion_rate(&conn, habit_id);

    Ok(())
}

/// Log a skipped habit. Increments friction_score slightly.
pub fn skip_habit(habit_id: &str, date: &str, reason: Option<String>) -> Result<(), String> {
    ensure_tables();
    let conn = open_db()?;

    let log_id = Uuid::new_v4().to_string();
    let now = Local::now().timestamp();

    conn.execute(
        "INSERT INTO habit_logs (id, habit_id, date, completed, notes, mood_after, timestamp)
         VALUES (?1, ?2, ?3, 0, ?4, NULL, ?5)
         ON CONFLICT(habit_id, date) DO UPDATE SET
            completed = 0, notes = excluded.notes, timestamp = excluded.timestamp",
        params![log_id, habit_id, date, reason, now],
    )
    .map_err(|e| format!("Log skip failed: {e}"))?;

    // Nudge friction_score upward (cap at 1.0)
    conn.execute(
        "UPDATE habits SET
            friction_score = MIN(1.0, friction_score + 0.05),
            current_streak = 0
         WHERE id = ?1",
        params![habit_id],
    )
    .map_err(|e| format!("Update friction failed: {e}"))?;

    refresh_completion_rate(&conn, habit_id);

    Ok(())
}

/// Return logs for a habit going back N days (most recent first).
pub fn get_logs(habit_id: &str, days_back: i32) -> Vec<HabitLog> {
    ensure_tables();
    let conn = match open_db() {
        Ok(c) => c,
        Err(_) => return vec![],
    };

    let cutoff = {
        let d = Local::now()
            .date_naive()
            .checked_sub_days(chrono::Days::new(days_back as u64))
            .unwrap_or_else(|| Local::now().date_naive());
        d.format("%Y-%m-%d").to_string()
    };

    let mut stmt = match conn.prepare(
        "SELECT id, habit_id, date, completed, notes, mood_after, timestamp
         FROM habit_logs WHERE habit_id = ?1 AND date >= ?2 ORDER BY date DESC",
    ) {
        Ok(s) => s,
        Err(_) => return vec![],
    };

    stmt.query_map(params![habit_id, cutoff], row_to_log)
        .map(|rows| rows.flatten().collect())
        .unwrap_or_default()
}

/// Return all active habits and whether each was completed today.
pub fn get_today_status() -> Vec<(Habit, bool)> {
    ensure_tables();
    let today = Local::now().format("%Y-%m-%d").to_string();
    let habits = list_habits(true);
    let conn = match open_db() {
        Ok(c) => c,
        Err(_) => return habits.into_iter().map(|h| (h, false)).collect(),
    };

    habits
        .into_iter()
        .map(|h| {
            let done: bool = conn
                .query_row(
                    "SELECT completed FROM habit_logs WHERE habit_id = ?1 AND date = ?2",
                    params![h.id, today],
                    |r| r.get::<_, i64>(0),
                )
                .map(|v| v != 0)
                .unwrap_or(false);
            (h, done)
        })
        .collect()
}

// ── Analytics ─────────────────────────────────────────────────────────────────

/// Count consecutive days a habit was completed, going backward from today.
#[allow(dead_code)]
pub fn calculate_streak(habit_id: &str) -> i32 {
    let conn = match open_db() {
        Ok(c) => c,
        Err(_) => return 0,
    };
    calculate_streak_inner(&conn, habit_id)
}

fn calculate_streak_inner(conn: &rusqlite::Connection, habit_id: &str) -> i32 {
    // Fetch last 365 completed dates sorted descending
    let mut stmt = match conn.prepare(
        "SELECT date FROM habit_logs WHERE habit_id = ?1 AND completed = 1
         ORDER BY date DESC LIMIT 365",
    ) {
        Ok(s) => s,
        Err(_) => return 0,
    };

    let dates: Vec<String> = stmt
        .query_map(params![habit_id], |r| r.get(0))
        .map(|rows| rows.flatten().collect())
        .unwrap_or_default();

    if dates.is_empty() {
        return 0;
    }

    let today = Local::now().date_naive();
    let mut streak = 0i32;
    let mut expected = today;

    for date_str in &dates {
        let Ok(d) = NaiveDate::parse_from_str(date_str, "%Y-%m-%d") else {
            continue;
        };
        if d == expected {
            streak += 1;
            expected = expected.pred_opt().unwrap_or(expected);
        } else if d == today && streak == 0 {
            // Completed yesterday but not yet today — still active streak from yesterday
            expected = today.pred_opt().unwrap_or(today);
            if d == expected {
                streak += 1;
                expected = expected.pred_opt().unwrap_or(expected);
            } else {
                break;
            }
        } else {
            break;
        }
    }

    streak
}

/// LLM analysis: time-of-day success rates, streak risks, friction points.
pub async fn generate_habit_insights() -> Vec<HabitInsight> {
    // Collect all data before any await
    let habits = list_habits(false);
    if habits.is_empty() {
        return vec![];
    }

    let mut habit_summaries: Vec<serde_json::Value> = Vec::new();
    for h in &habits {
        let logs = get_logs(&h.id, 30);
        let recent_completions = logs.iter().filter(|l| l.completed).count();
        let recent_skips = logs.iter().filter(|l| !l.completed).count();
        let mood_vals: Vec<i32> = logs.iter().filter_map(|l| l.mood_after).collect();
        let avg_mood: serde_json::Value = if mood_vals.is_empty() {
            serde_json::Value::Null
        } else {
            serde_json::json!(mood_vals.iter().sum::<i32>() as f32 / mood_vals.len() as f32)
        };
        habit_summaries.push(serde_json::json!({
            "name": h.name,
            "category": h.category,
            "frequency": h.frequency,
            "current_streak": h.current_streak,
            "best_streak": h.best_streak,
            "completion_rate_30d": h.completion_rate,
            "friction_score": h.friction_score,
            "cue": h.cue,
            "reward": h.reward,
            "recent_completions": recent_completions,
            "recent_skips": recent_skips,
            "avg_mood_after": avg_mood
        }));
    }

    let data_json = serde_json::to_string_pretty(&habit_summaries).unwrap_or_default();

    let prompt = format!(
        "You are a habit coach analyzing a user's habit data from the last 30 days.\n\n\
         Habit data:\n{}\n\n\
         Identify: streaks at risk (high friction, low completion), \
         patterns (what's working and why), friction points (habits that keep failing), \
         and achievements worth celebrating.\n\n\
         Return ONLY a JSON array (no markdown):\n\
         [\n  {{\n    \
           \"habit_name\": \"name of the habit\",\n    \
           \"insight_type\": \"streak_at_risk|pattern_found|friction_point|achievement\",\n    \
           \"description\": \"2-3 sentences with specific observations\",\n    \
           \"suggestion\": \"one concrete, actionable suggestion\"\n  \
         }}\n]",
        data_json
    );

    let config = crate::config::load_config();
    let (provider, api_key, model) =
        crate::config::resolve_provider_for_task(&config, &crate::router::TaskType::Complex);

    let messages = vec![crate::providers::ConversationMessage::User(prompt)];
    let turn = match crate::providers::complete_turn(&provider, &api_key, &model, &messages, &crate::providers::no_tools(), None).await {
        Ok(t) => t,
        Err(e) => {
            eprintln!("[habit_engine] LLM error: {e}");
            return vec![];
        }
    };

    let raw = strip_json_fences(&turn.content);
    serde_json::from_str::<Vec<HabitInsight>>(raw).unwrap_or_else(|e| {
        eprintln!(
            "[habit_engine] Failed to parse insights: {e}\nRaw: {}",
            crate::safe_slice(raw, 300)
        );
        vec![]
    })
}

/// LLM habit design assistant: given a user goal, suggest cue/routine/reward + best time.
pub async fn suggest_habit_design(goal: &str) -> String {
    let prompt = format!(
        "You are a habit design expert. The user wants to: \"{}\"\n\n\
         Using the Habit Loop framework (Cue → Routine → Reward), design a realistic habit for them.\n\n\
         Provide:\n\
         1. A specific habit routine (the actual behavior)\n\
         2. A concrete cue (what triggers it — time, location, preceding action)\n\
         3. A meaningful reward (intrinsic or extrinsic)\n\
         4. Recommended time of day and frequency\n\
         5. How to start tiny (minimum viable habit to build the chain first)\n\
         6. One common friction point and how to design around it\n\n\
         Be specific and practical. Keep the response under 400 words.",
        goal
    );

    let config = crate::config::load_config();
    let (provider, api_key, model) =
        crate::config::resolve_provider_for_task(&config, &crate::router::TaskType::Complex);

    let messages = vec![crate::providers::ConversationMessage::User(prompt)];
    match crate::providers::complete_turn(&provider, &api_key, &model, &messages, &crate::providers::no_tools(), None).await {
        Ok(t) => t.content,
        Err(e) => format!("Could not generate habit design: {e}"),
    }
}

/// Build a compact context string for injection into BLADE's system prompt.
pub fn get_habits_context() -> String {
    let status = get_today_status();
    if status.is_empty() {
        return String::new();
    }

    let today = Local::now().format("%Y-%m-%d").to_string();
    let mut lines = Vec::new();

    for (habit, done) in &status {
        let icon = if *done { "✅" } else { "⏳" };
        let streak_note = if habit.current_streak > 1 {
            format!(" ({}d streak)", habit.current_streak)
        } else if !done && habit.friction_score > 0.5 {
            format!(" (⚠️ {} skips recently)", (habit.friction_score * 20.0) as i32)
        } else {
            String::new()
        };
        let time_note = habit
            .target_time
            .as_deref()
            .map(|t| format!(" due {}", t))
            .unwrap_or_default();

        lines.push(format!("{} {}{}{}", icon, habit.name, time_note, streak_note));
    }

    // Surface any streaks at risk (active, not yet done today, had recent skips)
    let at_risk: Vec<String> = status
        .iter()
        .filter(|(h, done)| !done && h.current_streak >= 3 && h.active)
        .map(|(h, _)| format!("❌ {} ({}-day streak at risk!)", h.name, h.current_streak))
        .collect();

    let mut out = format!("## Today's Habits ({})\n\n{}", today, lines.join("\n"));
    if !at_risk.is_empty() {
        out.push_str(&format!("\n\n**Streak alerts:**\n{}", at_risk.join("\n")));
    }
    out
}

// ── Smart reminders ───────────────────────────────────────────────────────────

/// Returns habits due now: active habits whose target_time falls within the current
/// 15-minute window and have not yet been completed today.
pub fn check_due_habits() -> Vec<Habit> {
    let now = Local::now();
    let today = now.format("%Y-%m-%d").to_string();
    let current_hm = now.format("%H:%M").to_string();

    // Build a time window: [current_hm - 15min, current_hm]
    let window_start = {
        let minus15 = now - chrono::Duration::minutes(15);
        minus15.format("%H:%M").to_string()
    };

    let habits = list_habits(true);
    let conn = match open_db() {
        Ok(c) => c,
        Err(_) => return vec![],
    };

    habits
        .into_iter()
        .filter(|h| {
            // Only habits that have a target time in the window
            let Some(ref t) = h.target_time else { return false };
            if t.as_str() < window_start.as_str() || t.as_str() > current_hm.as_str() {
                return false;
            }

            // Frequency gate
            let weekday = now.weekday();
            let passes_freq = match h.frequency.as_str() {
                "daily" => true,
                "weekdays" => {
                    use chrono::Weekday;
                    !matches!(weekday, Weekday::Sat | Weekday::Sun)
                }
                "weekly" => weekday == chrono::Weekday::Mon, // arbitrary: Monday
                "3x_week" => matches!(
                    weekday,
                    chrono::Weekday::Mon | chrono::Weekday::Wed | chrono::Weekday::Fri
                ),
                _ => true,
            };
            if !passes_freq { return false; }

            // Not yet completed today
            let done: bool = conn
                .query_row(
                    "SELECT completed FROM habit_logs WHERE habit_id = ?1 AND date = ?2",
                    params![h.id, today],
                    |r| r.get::<_, i64>(0),
                )
                .map(|v| v != 0)
                .unwrap_or(false);

            !done
        })
        .collect()
}

// ── Background reminder loop ──────────────────────────────────────────────────

static HABIT_REMINDER_ACTIVE: AtomicBool = AtomicBool::new(false);

/// Spawns a background loop that checks every 15 minutes for due habits
/// and emits `blade_habit_reminder` events to the frontend.
pub fn start_habit_reminder_loop(app: tauri::AppHandle) {
    if HABIT_REMINDER_ACTIVE.swap(true, Ordering::SeqCst) {
        return; // already running
    }

    ensure_tables();

    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(900)).await; // 15 min

            let due = check_due_habits();
            for habit in due {
                let payload = serde_json::json!({
                    "id": habit.id,
                    "name": habit.name,
                    "category": habit.category,
                    "streak": habit.current_streak,
                    "target_time": habit.target_time,
                    "cue": habit.cue,
                    "reward": habit.reward,
                });
                let _ = app.emit("blade_habit_reminder", payload);
            }
        }
    });
}

// ── Tauri commands ────────────────────────────────────────────────────────────

#[tauri::command]
pub fn habit_create(
    name: String,
    description: Option<String>,
    frequency: Option<String>,
    target_time: Option<String>,
    category: Option<String>,
    cue: Option<String>,
    reward: Option<String>,
) -> Result<String, String> {
    let h = Habit {
        id: Uuid::new_v4().to_string(),
        name,
        description: description.unwrap_or_default(),
        frequency: frequency.unwrap_or_else(|| "daily".to_string()),
        target_time,
        category: category.unwrap_or_else(|| "productivity".to_string()),
        current_streak: 0,
        best_streak: 0,
        total_completions: 0,
        completion_rate: 0.0,
        friction_score: 0.0,
        cue: cue.unwrap_or_default(),
        reward: reward.unwrap_or_default(),
        created_at: Local::now().timestamp(),
        active: true,
    };
    create_habit(h)
}

#[tauri::command]
pub fn habit_list(active_only: Option<bool>) -> Vec<Habit> {
    list_habits(active_only.unwrap_or(true))
}

#[tauri::command]
pub fn habit_get(id: String) -> Option<Habit> {
    get_habit(&id)
}

#[tauri::command]
pub fn habit_complete(
    habit_id: String,
    date: Option<String>,
    notes: Option<String>,
    mood_after: Option<i32>,
) -> Result<(), String> {
    let d = date.unwrap_or_else(|| Local::now().format("%Y-%m-%d").to_string());
    complete_habit(&habit_id, &d, notes, mood_after)
}

#[tauri::command]
pub fn habit_skip(
    habit_id: String,
    date: Option<String>,
    reason: Option<String>,
) -> Result<(), String> {
    let d = date.unwrap_or_else(|| Local::now().format("%Y-%m-%d").to_string());
    skip_habit(&habit_id, &d, reason)
}

#[tauri::command]
pub fn habit_get_logs(habit_id: String, days_back: Option<i32>) -> Vec<HabitLog> {
    get_logs(&habit_id, days_back.unwrap_or(30))
}

#[tauri::command]
pub fn habit_get_today() -> Vec<(Habit, bool)> {
    get_today_status()
}

#[tauri::command]
pub async fn habit_insights() -> Vec<HabitInsight> {
    generate_habit_insights().await
}

#[tauri::command]
pub async fn habit_suggest_design(goal: String) -> String {
    suggest_habit_design(&goal).await
}

#[tauri::command]
pub fn habit_get_context() -> String {
    get_habits_context()
}
