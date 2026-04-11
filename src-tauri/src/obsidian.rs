// src-tauri/src/obsidian.rs
// BLADE × Obsidian — writes into your vault so everything BLADE knows
// ends up in your second brain.
//
// Auto-creates a daily note on startup (once per day).
// Appends pulse thoughts and morning briefings to today's note.
// Lets you save any conversation summary to the vault.
//
// Notes are written in standard Obsidian Markdown with YAML frontmatter.
// File paths follow the YYYY/MM/YYYY-MM-DD.md convention by default,
// but BLADE will create files directly in the vault root if that fails.

use chrono::Local;
use std::fs;
use std::path::{Path, PathBuf};

// ── Helpers ───────────────────────────────────────────────────────────────────

fn vault_path() -> Option<PathBuf> {
    let config = crate::config::load_config();
    if config.obsidian_vault_path.is_empty() {
        return None;
    }
    let p = PathBuf::from(&config.obsidian_vault_path);
    if p.is_dir() { Some(p) } else { None }
}

fn today_note_path(vault: &Path) -> PathBuf {
    let now = Local::now();
    let year = now.format("%Y").to_string();
    let month = now.format("%m").to_string();
    let filename = now.format("%Y-%m-%d.md").to_string();

    // Try YYYY/MM/filename first
    let dir = vault.join(&year).join(&month);
    if fs::create_dir_all(&dir).is_ok() {
        return dir.join(&filename);
    }
    // Fallback: vault root
    vault.join(&filename)
}

fn now_str() -> String {
    Local::now().format("%H:%M").to_string()
}

fn today_str() -> String {
    Local::now().format("%Y-%m-%d").to_string()
}

// ── Daily note creation ───────────────────────────────────────────────────────

/// Create today's daily note if it doesn't exist. Called at startup.
pub fn ensure_daily_note() {
    let Some(vault) = vault_path() else { return };
    let path = today_note_path(&vault);
    if path.exists() {
        return;
    }

    let config = crate::config::load_config();
    let user = if !config.user_name.is_empty() { &config.user_name } else { "You" };
    let date = today_str();

    let content = format!(
        "---\ndate: {date}\ntags: [daily, blade]\ncreated_by: BLADE\n---\n\n# {date}\n\n## Morning\n\n_BLADE created this note. Add your thoughts below._\n\n## BLADE Pulse\n\n## Conversations\n\n## Tasks\n\n## Notes\n\n"
    );

    if let Err(e) = fs::write(&path, &content) {
        log::warn!("[obsidian] could not create daily note: {}", e);
    } else {
        log::info!("[obsidian] created daily note: {}", path.display());
    }
}

/// Append a section to today's daily note. Creates the note if needed.
fn append_to_daily(section_header: &str, content: &str) {
    let Some(vault) = vault_path() else { return };
    ensure_daily_note();
    let path = today_note_path(&vault);

    let existing = fs::read_to_string(&path).unwrap_or_default();

    // Find the section header and insert after it
    let target = format!("## {}", section_header);
    let appended = if let Some(pos) = existing.find(&target) {
        let after = pos + target.len();
        // Find end of the line after the header
        let line_end = existing[after..].find('\n').map(|i| after + i + 1).unwrap_or(after);
        let entry = format!("\n- **{}** {}\n", now_str(), content);
        format!("{}{}{}", &existing[..line_end], entry, &existing[line_end..])
    } else {
        // Section not found — append to end
        format!("{}\n## {}\n\n- **{}** {}\n", existing, section_header, now_str(), content)
    };

    let _ = fs::write(&path, appended);
}

// ── Public API ────────────────────────────────────────────────────────────────

/// Append a pulse thought to today's note under "## BLADE Pulse".
pub fn log_pulse_thought(thought: &str) {
    let short = &thought[..thought.len().min(200)];
    append_to_daily("BLADE Pulse", short);
}

/// Append a morning briefing to today's note.
pub fn log_briefing(briefing: &str) {
    let Some(vault) = vault_path() else { return };
    ensure_daily_note();
    let path = today_note_path(&vault);

    let existing = fs::read_to_string(&path).unwrap_or_default();
    let header = "## Morning";
    let entry = format!("\n> **BLADE Briefing — {}**\n> {}\n", now_str(), briefing.replace('\n', "\n> "));

    let updated = if let Some(pos) = existing.find(header) {
        let after = pos + header.len();
        let line_end = existing[after..].find('\n').map(|i| after + i + 1).unwrap_or(after);
        format!("{}{}{}", &existing[..line_end], entry, &existing[line_end..])
    } else {
        format!("{}\n{}\n{}", existing, header, entry)
    };

    let _ = fs::write(&path, updated);
}

/// Save a conversation summary to a new note in BLADE/Conversations/.
pub fn save_conversation(title: &str, summary: &str, conversation_id: &str) {
    let Some(vault) = vault_path() else { return };

    let conv_dir = vault.join("BLADE").join("Conversations");
    if fs::create_dir_all(&conv_dir).is_err() {
        return;
    }

    let date = today_str();
    let safe_title: String = title.chars()
        .map(|c| if c.is_alphanumeric() || c == ' ' || c == '-' { c } else { '_' })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join("-");
    let safe_title = &safe_title[..safe_title.len().min(60)];
    let filename = format!("{}-{}.md", date, safe_title);
    let path = conv_dir.join(&filename);

    let config = crate::config::load_config();
    let content = format!(
        "---\ndate: {date}\ntags: [conversation, blade]\nconversation_id: {conversation_id}\n---\n\n# {title}\n\n{summary}\n",
        date = date,
        conversation_id = conversation_id,
        title = title,
        summary = summary,
    );

    if let Err(e) = fs::write(&path, &content) {
        log::warn!("[obsidian] could not save conversation: {}", e);
    } else {
        log::info!("[obsidian] saved conversation: {}", path.display());
    }

    // Also append a link to today's note
    append_to_daily("Conversations", &format!("[[BLADE/Conversations/{}|{}]]", filename.trim_end_matches(".md"), title));
}

// ── Tauri commands ────────────────────────────────────────────────────────────

#[tauri::command]
pub fn obsidian_ensure_daily_note() -> Result<String, String> {
    let Some(vault) = vault_path() else {
        return Err("No Obsidian vault path configured in Settings.".to_string());
    };
    ensure_daily_note();
    let path = today_note_path(&vault);
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn obsidian_save_conversation(
    title: String,
    summary: String,
    conversation_id: String,
) -> Result<(), String> {
    vault_path().ok_or("No Obsidian vault configured".to_string())?;
    save_conversation(&title, &summary, &conversation_id);
    Ok(())
}

#[tauri::command]
pub fn obsidian_append_note(note_path: String, content: String) -> Result<(), String> {
    let Some(vault) = vault_path() else {
        return Err("No vault configured".to_string());
    };
    let full_path = vault.join(&note_path);
    // Safety: must stay within the vault
    let canonical_vault = fs::canonicalize(&vault).map_err(|e| e.to_string())?;
    let parent = full_path.parent().ok_or("Invalid path")?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let canonical_parent = fs::canonicalize(parent).unwrap_or_else(|_| full_path.parent().unwrap().to_path_buf());
    if !canonical_parent.starts_with(&canonical_vault) {
        return Err("Path escapes vault directory".to_string());
    }

    let mut existing = fs::read_to_string(&full_path).unwrap_or_default();
    existing.push('\n');
    existing.push_str(&content);
    fs::write(&full_path, existing).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn obsidian_today_note() -> Result<String, String> {
    let Some(vault) = vault_path() else {
        return Err("No vault configured".to_string());
    };
    let path = today_note_path(&vault);
    fs::read_to_string(&path).map_err(|e| format!("Note not found: {}", e))
}

#[tauri::command]
pub fn obsidian_vault_configured() -> bool {
    vault_path().is_some()
}
