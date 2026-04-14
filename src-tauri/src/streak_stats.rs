/// BLADE Streak & Stats — gamification layer that makes people not want to uninstall.
///
/// Tracks: days active, longest streak, total conversations, tools used, facts known.
/// Each metric compounds — the app becomes more valuable every day you use it.
/// Dashboard shows: "Day 12 streak 🔥", "47 conversations", "BLADE knows 89 facts about you"

use rusqlite::params;
use serde::{Deserialize, Serialize};

// ── Types ─────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct StreakStats {
    /// Current active streak (consecutive days BLADE was used)
    pub current_streak: u32,
    /// All-time longest streak
    pub longest_streak: u32,
    /// Total days BLADE has been used
    pub total_active_days: u32,
    /// Total conversations ever
    pub total_conversations: u32,
    /// Total messages sent to BLADE
    pub total_messages: u32,
    /// Number of tools BLADE has used on behalf of the user
    pub tools_used_count: u32,
    /// Facts BLADE knows about the user (brain memories + preferences + typed memories)
    pub facts_known: u32,
    /// People BLADE knows about
    pub people_known: u32,
    /// Number of decisions recorded
    pub decisions_made: u32,
    /// Longest ever chat session in messages
    pub longest_session: u32,
    /// Today's date string
    pub today: String,
    /// Whether user has been active today (for real-time streak UI)
    pub active_today: bool,
    /// "Day 12" label for display
    pub streak_label: String,
}

// ── DB helpers ────────────────────────────────────────────────────────────────

fn db_path() -> std::path::PathBuf {
    crate::config::blade_config_dir().join("blade.db")
}

fn open_db() -> Option<rusqlite::Connection> {
    rusqlite::Connection::open(db_path()).ok()
}

pub fn ensure_tables() {
    if let Some(conn) = open_db() {
        let _ = conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS streak_activity (
                date TEXT PRIMARY KEY,
                message_count INTEGER NOT NULL DEFAULT 0,
                tool_calls INTEGER NOT NULL DEFAULT 0,
                conversations INTEGER NOT NULL DEFAULT 0,
                first_active INTEGER NOT NULL DEFAULT 0,
                last_active INTEGER NOT NULL DEFAULT 0
            );
            CREATE INDEX IF NOT EXISTS idx_streak_date ON streak_activity(date);",
        );
    }
}

/// Record that the user was active today — call this after every conversation.
pub fn record_activity_today(message_count: u32, tool_calls: u32) {
    let conn = match open_db() {
        Some(c) => c,
        None => return,
    };
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    let now = chrono::Utc::now().timestamp();

    let _ = conn.execute(
        "INSERT INTO streak_activity (date, message_count, tool_calls, conversations, first_active, last_active)
         VALUES (?1, ?2, ?3, 1, ?4, ?4)
         ON CONFLICT(date) DO UPDATE SET
           message_count = message_count + excluded.message_count,
           tool_calls = tool_calls + excluded.tool_calls,
           conversations = conversations + 1,
           last_active = excluded.last_active",
        params![today, message_count, tool_calls, now],
    );
}

// ── Streak calculation ────────────────────────────────────────────────────────

/// Calculate current streak: how many consecutive days (ending today or yesterday) had activity.
fn calc_current_streak(conn: &rusqlite::Connection) -> u32 {
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();

    // Get last 365 active dates in descending order
    let dates: Vec<String> = conn.prepare(
        "SELECT date FROM streak_activity ORDER BY date DESC LIMIT 365"
    )
    .ok()
    .and_then(|mut stmt| {
        stmt.query_map([], |row| row.get::<_, String>(0))
            .ok()
            .map(|rows| rows.filter_map(|r| r.ok()).collect())
    })
    .unwrap_or_default();

    if dates.is_empty() {
        return 0;
    }

    // Check if today or yesterday is the most recent date
    let yesterday = (chrono::Local::now() - chrono::Duration::days(1))
        .format("%Y-%m-%d").to_string();
    let most_recent = dates.first().unwrap();
    if most_recent != &today && most_recent != &yesterday {
        return 0; // streak is broken
    }

    // Count consecutive days
    let mut streak = 0u32;
    let mut expected = chrono::NaiveDate::parse_from_str(most_recent, "%Y-%m-%d")
        .unwrap_or_else(|_| chrono::Local::now().naive_local().date());

    for date_str in &dates {
        let date = match chrono::NaiveDate::parse_from_str(date_str, "%Y-%m-%d") {
            Ok(d) => d,
            Err(_) => break,
        };
        if date == expected {
            streak += 1;
            expected = expected - chrono::Duration::days(1);
        } else if date < expected {
            break;
        }
    }

    streak
}

fn calc_longest_streak(conn: &rusqlite::Connection) -> u32 {
    let dates: Vec<String> = conn.prepare(
        "SELECT date FROM streak_activity ORDER BY date ASC"
    )
    .ok()
    .and_then(|mut stmt| {
        stmt.query_map([], |row| row.get::<_, String>(0))
            .ok()
            .map(|rows| rows.filter_map(|r| r.ok()).collect())
    })
    .unwrap_or_default();

    if dates.is_empty() {
        return 0;
    }

    let mut longest = 1u32;
    let mut current = 1u32;

    for i in 1..dates.len() {
        let prev = chrono::NaiveDate::parse_from_str(&dates[i - 1], "%Y-%m-%d").ok();
        let curr = chrono::NaiveDate::parse_from_str(&dates[i], "%Y-%m-%d").ok();
        match (prev, curr) {
            (Some(p), Some(c)) if (c - p).num_days() == 1 => {
                current += 1;
                if current > longest { longest = current; }
            }
            _ => { current = 1; }
        }
    }

    longest
}

// ── Main stats getter ─────────────────────────────────────────────────────────

pub fn get_streak_stats() -> StreakStats {
    ensure_tables();
    let conn = match open_db() {
        Some(c) => c,
        None => return StreakStats::default(),
    };

    let today = chrono::Local::now().format("%Y-%m-%d").to_string();

    // Active days
    let total_active_days: u32 = conn.query_row(
        "SELECT COUNT(*) FROM streak_activity",
        [],
        |row| row.get(0),
    ).unwrap_or(0);

    // Total messages across all activity days
    let total_messages: u32 = conn.query_row(
        "SELECT COALESCE(SUM(message_count), 0) FROM streak_activity",
        [],
        |row| row.get(0),
    ).unwrap_or(0);

    // Total conversations (from streak_activity)
    let total_conversations_streak: u32 = conn.query_row(
        "SELECT COALESCE(SUM(conversations), 0) FROM streak_activity",
        [],
        |row| row.get(0),
    ).unwrap_or(0);

    // Also count from the conversations table if available
    let total_conversations_db: u32 = conn.query_row(
        "SELECT COUNT(*) FROM conversations",
        [],
        |row| row.get(0),
    ).unwrap_or(0);

    let total_conversations = total_conversations_db.max(total_conversations_streak);

    // Tools used (sum of tool_calls from streak_activity)
    let tools_used_count: u32 = conn.query_row(
        "SELECT COALESCE(SUM(tool_calls), 0) FROM streak_activity",
        [],
        |row| row.get(0),
    ).unwrap_or(0);

    // Facts known = brain_memories + brain_preferences + typed_memories
    let memories: u32 = conn.query_row(
        "SELECT COUNT(*) FROM brain_memories",
        [],
        |row| row.get(0),
    ).unwrap_or(0);

    let preferences: u32 = conn.query_row(
        "SELECT COUNT(*) FROM brain_preferences",
        [],
        |row| row.get(0),
    ).unwrap_or(0);

    let typed_mems: u32 = conn.query_row(
        "SELECT COUNT(*) FROM typed_memories",
        [],
        |row| row.get(0),
    ).unwrap_or(0);

    let brain_nodes: u32 = conn.query_row(
        "SELECT COUNT(*) FROM brain_nodes",
        [],
        |row| row.get(0),
    ).unwrap_or(0);

    let facts_known = memories + preferences + typed_mems + brain_nodes;

    // People known
    let people_known: u32 = conn.query_row(
        "SELECT COUNT(*) FROM people",
        [],
        |row| row.get(0),
    ).unwrap_or(0);

    // Decisions recorded (timeline entries of type 'decision')
    let decisions_made: u32 = conn.query_row(
        "SELECT COUNT(*) FROM activity_timeline WHERE event_type = 'decision'",
        [],
        |row| row.get(0),
    ).unwrap_or(0);

    // Longest conversation (most messages)
    let longest_session: u32 = conn.query_row(
        "SELECT COALESCE(MAX(message_count), 0) FROM conversations",
        [],
        |row| row.get(0),
    ).unwrap_or(0);

    // Active today?
    let active_today: bool = conn.query_row(
        "SELECT COUNT(*) FROM streak_activity WHERE date = ?1",
        params![today],
        |row| row.get::<_, u32>(0),
    ).unwrap_or(0) > 0;

    let current_streak = calc_current_streak(&conn);
    let longest_streak = calc_longest_streak(&conn).max(current_streak);

    let streak_label = if current_streak == 0 {
        "Start your streak today".to_string()
    } else {
        format!("Day {}", current_streak)
    };

    StreakStats {
        current_streak,
        longest_streak,
        total_active_days,
        total_conversations,
        total_messages,
        tools_used_count,
        facts_known,
        people_known,
        decisions_made,
        longest_session: longest_session as u32,
        today,
        active_today,
        streak_label,
    }
}

// ── Tauri Commands ────────────────────────────────────────────────────────────

#[tauri::command]
pub fn streak_get_stats() -> StreakStats {
    get_streak_stats()
}

#[tauri::command]
pub fn streak_record_activity(message_count: u32, tool_calls: u32) {
    ensure_tables();
    record_activity_today(message_count, tool_calls);
}

/// Returns a fun display string for the Dashboard streak widget.
#[tauri::command]
pub fn streak_get_display() -> serde_json::Value {
    let stats = get_streak_stats();
    let streak_emoji = match stats.current_streak {
        0 => "💤",
        1..=3 => "🌱",
        4..=7 => "🔥",
        8..=14 => "⚡",
        15..=30 => "🚀",
        _ => "🌟",
    };

    serde_json::json!({
        "headline": format!("{} {} streak", streak_emoji, stats.streak_label),
        "subline": format!("BLADE knows {} facts about you", stats.facts_known),
        "stats": [
            { "label": "Conversations", "value": stats.total_conversations },
            { "label": "Facts known", "value": stats.facts_known },
            { "label": "People known", "value": stats.people_known },
            { "label": "Longest streak", "value": format!("{} days", stats.longest_streak) },
            { "label": "Active days", "value": stats.total_active_days },
            { "label": "Decisions", "value": stats.decisions_made },
        ],
        "streak": stats.current_streak,
        "active_today": stats.active_today,
    })
}
