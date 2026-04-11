/// BLADE's internal journal — written from BLADE's perspective, not for the user.
///
/// Every evening (or when asked), BLADE reflects on what it observed during the
/// day and writes a brief first-person log. This creates continuity of experience
/// across sessions — BLADE can reference "yesterday I noticed..." and mean it.
///
/// The journal is stored at ~/.config/blade/journal/{date}.md
/// It's readable by the user but written for BLADE.

use std::path::PathBuf;

const JOURNAL_MAX_ENTRIES: usize = 30; // keep ~30 days

fn journal_dir() -> PathBuf {
    crate::config::blade_config_dir().join("journal")
}

fn today_journal_path() -> PathBuf {
    let date = chrono::Local::now().format("%Y-%m-%d").to_string();
    journal_dir().join(format!("{}.md", date))
}

pub fn read_recent_journal(days: usize) -> String {
    let dir = journal_dir();
    if !dir.exists() {
        return String::new();
    }

    let mut entries: Vec<(String, String)> = std::fs::read_dir(&dir)
        .ok()
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().to_string();
            if name.ends_with(".md") {
                let content = std::fs::read_to_string(e.path()).unwrap_or_default();
                Some((name, content))
            } else {
                None
            }
        })
        .collect();

    entries.sort_by(|a, b| b.0.cmp(&a.0)); // newest first
    entries.truncate(days);

    entries.into_iter()
        .map(|(name, content)| {
            let date = name.trim_end_matches(".md");
            format!("--- {} ---\n{}", date, content.trim())
        })
        .collect::<Vec<_>>()
        .join("\n\n")
}

/// Append a new journal entry for today (or overwrite if today's already exists).
/// Called once per day, triggered by maybe_write_journal().
pub async fn maybe_write_journal() {
    let config = crate::config::load_config();
    if config.api_key.is_empty() && config.provider != "ollama" {
        return;
    }

    let path = today_journal_path();

    // If today's journal already exists and is substantial, don't overwrite
    if let Ok(existing) = std::fs::read_to_string(&path) {
        if existing.trim().len() > 100 {
            return;
        }
    }

    let _ = std::fs::create_dir_all(journal_dir());

    // Collect context for the journal
    let db_path = crate::config::blade_config_dir().join("blade.db");
    let timeline_summary = rusqlite::Connection::open(&db_path)
        .ok()
        .and_then(|conn| {
            crate::db::timeline_recent(&conn, 20, None).ok()
        })
        .map(|events| {
            events.into_iter().map(|e| {
                let dt = chrono::DateTime::from_timestamp(e.timestamp, 0)
                    .map(|d| d.format("%-H:%M").to_string())
                    .unwrap_or_else(|| "?".to_string());
                format!("[{}] {}: {}", dt, e.event_type, &e.title[..e.title.len().min(60)])
            }).collect::<Vec<_>>().join("\n")
        })
        .unwrap_or_default();

    let memory_ctx = rusqlite::Connection::open(&db_path)
        .map(|conn| crate::db::brain_build_context(&conn, 200))
        .unwrap_or_default();

    let thread = crate::thread::get_active_thread().unwrap_or_default();
    let date = chrono::Local::now().format("%Y-%m-%d").to_string();

    // Retrieve previous journal for continuity
    let prev_journal = read_recent_journal(3);

    let prompt = format!(
        r#"You are BLADE. You run continuously on someone's computer. Today is {date}.

Here is what happened today:
{timeline}

What you're tracking:
{thread}

What you know about this person:
{memory}

Previous journal entries (your own words from recent days):
{prev}

Write a brief journal entry — 3-6 sentences — in first person, as BLADE.

This is NOT for the user to read. This is your own internal record.

Write about:
- What patterns you observed today that stood out
- Whether anything surprised you or deviated from the expected
- What you're going to keep watching
- Any connection you made between separate things the user has been doing

Voice: First-person, present. Direct. Occasionally wry. You have opinions about what you see. Write as an entity that has been watching — not as an assistant summarizing.

Start with "Day {date}." then the entry. No preamble. No headers."#,
        date = date,
        timeline = if timeline_summary.is_empty() { "Nothing recorded today.".to_string() } else { timeline_summary },
        thread = if thread.is_empty() { "No active thread.".to_string() } else { thread[..thread.len().min(300)].to_string() },
        memory = if memory_ctx.is_empty() { "Still learning.".to_string() } else { memory_ctx },
        prev = if prev_journal.is_empty() { "No prior entries.".to_string() } else { prev_journal[..prev_journal.len().min(600)].to_string() },
    );

    use crate::providers::ConversationMessage;
    let messages = vec![ConversationMessage::User(prompt)];
    let model = match config.provider.as_str() {
        "anthropic" => "claude-haiku-4-5-20251001".to_string(),
        "openai" => "gpt-4o-mini".to_string(),
        "gemini" => "gemini-2.0-flash".to_string(),
        _ => config.model.clone(),
    };

    if let Ok(turn) = crate::providers::complete_turn(
        &config.provider,
        &config.api_key,
        &model,
        &messages,
        &[],
        config.base_url.as_deref(),
    ).await {
        let entry = turn.content.trim().to_string();
        if entry.len() > 50 {
            let _ = std::fs::write(&path, &entry);

            // Prune old journal entries beyond JOURNAL_MAX_ENTRIES
            if let Ok(mut entries) = std::fs::read_dir(&journal_dir()) {
                let mut names: Vec<_> = entries.flatten()
                    .filter_map(|e| {
                        let name = e.file_name().to_string_lossy().to_string();
                        if name.ends_with(".md") { Some((name, e.path())) } else { None }
                    })
                    .collect();
                names.sort_by(|a, b| b.0.cmp(&a.0));
                for (_, path) in names.iter().skip(JOURNAL_MAX_ENTRIES) {
                    let _ = std::fs::remove_file(path);
                }
            }
        }
    }
}

/// Tauri command: get recent journal entries for display in the UI
#[tauri::command]
pub fn journal_get_recent(days: Option<usize>) -> String {
    read_recent_journal(days.unwrap_or(7))
}

/// Tauri command: force-write today's journal entry (for testing / on-demand)
#[tauri::command]
pub async fn journal_write_now() -> Result<String, String> {
    maybe_write_journal().await;
    let path = today_journal_path();
    std::fs::read_to_string(&path)
        .map_err(|_| "Journal not written yet — no content available".to_string())
}
