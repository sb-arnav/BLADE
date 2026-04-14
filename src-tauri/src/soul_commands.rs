/// BLADE Soul — weekly character snapshot, diff, and transparency UI
///
/// Every week, BLADE takes a snapshot of everything it has learned:
///   - Character Bible (who you are, how you work, what you're building)
///   - BLADE's self-characterization (who BLADE is becoming from working with you)
///   - Learned preferences (derived from your feedback reactions)
///
/// The diff shows you exactly what changed since last week:
///   "This week BLADE learned you prefer bullet points over prose"
///   "BLADE noticed you've shifted focus from Staq to BLADE"
///
/// You can review, edit, or delete any entry BLADE has about you.
/// Nothing is hidden. Nothing is assumed. Everything is yours to correct.

use crate::config::{blade_config_dir, load_config};
use crate::db::{soul_get_latest_snapshot, soul_get_snapshots, soul_save_snapshot, SoulSnapshot};
use crate::providers::{self, ConversationMessage};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SoulState {
    pub character_bible: crate::character::CharacterBible,
    pub blade_soul: String,
    pub preferences: Vec<crate::db::BrainPreferenceRow>,
    pub snapshots: Vec<SoulSnapshot>,
    pub latest_diff: Option<String>,
    pub last_snapshot_at: Option<i64>,
}

/// Get the full current soul state for display in the UI.
#[tauri::command]
pub fn soul_get_state() -> Result<SoulState, String> {
    let db_path = blade_config_dir().join("blade.db");
    let conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;

    let bible = crate::character::load_bible();
    let blade_soul = crate::character::load_soul();
    let preferences = crate::db::brain_get_preferences(&conn)?;
    let snapshots = soul_get_snapshots(&conn, 8)?; // last 8 weeks
    let latest_diff = snapshots.first().map(|s| s.diff_summary.clone()).filter(|s| !s.is_empty());
    let last_snapshot_at = snapshots.first().map(|s| s.created_at);

    Ok(SoulState {
        character_bible: bible,
        blade_soul,
        preferences,
        snapshots,
        latest_diff,
        last_snapshot_at,
    })
}

/// Take a snapshot of the current soul state and generate a diff summary.
/// Called weekly by the evolution engine, or manually from the UI.
#[tauri::command]
pub async fn soul_take_snapshot() -> Result<String, String> {
    let config = load_config();
    let db_path = blade_config_dir().join("blade.db");
    let conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;

    let bible = crate::character::load_bible();
    let blade_soul = crate::character::load_soul();
    let preferences = crate::db::brain_get_preferences(&conn)?;

    let bible_json = serde_json::to_string(&bible).unwrap_or_default();
    let prefs_json = serde_json::to_string(&preferences).unwrap_or_default();

    // Generate diff summary vs last snapshot
    let diff_summary = if config.api_key.is_empty() && config.provider != "ollama" {
        String::new()
    } else {
        let prev = soul_get_latest_snapshot(&conn);
        generate_diff_summary(&config, &prev, &bible_json, &blade_soul, &prefs_json).await
    };

    soul_save_snapshot(&conn, &bible_json, &blade_soul, &prefs_json, &diff_summary)
        .map_err(|e| e.to_string())?;

    Ok(diff_summary)
}

/// Check if a new weekly snapshot is due and take one if so.
/// Called by the evolution loop on startup and periodically.
pub async fn maybe_take_weekly_snapshot() {
    let db_path = blade_config_dir().join("blade.db");
    let conn = match rusqlite::Connection::open(&db_path) {
        Ok(c) => c,
        Err(_) => return,
    };

    // Check if a snapshot was taken in the last 7 days
    let seven_days_ago = chrono::Utc::now().timestamp() - (7 * 86400);
    let latest = soul_get_latest_snapshot(&conn);
    if let Some(snap) = latest {
        if snap.created_at > seven_days_ago {
            return; // not due yet
        }
    }

    // Due — take snapshot in the background
    let _ = soul_take_snapshot().await;
}

async fn generate_diff_summary(
    config: &crate::config::BladeConfig,
    prev: &Option<SoulSnapshot>,
    new_bible_json: &str,
    new_soul: &str,
    new_prefs_json: &str,
) -> String {
    let (prev_bible, prev_soul, prev_prefs) = match prev {
        Some(s) => (s.character_bible.clone(), s.blade_soul.clone(), s.preferences.clone()),
        None => return "This is BLADE's first snapshot — nothing to compare yet.".to_string(),
    };

    let prompt = format!(
        r#"You are generating a weekly "what BLADE learned" summary for a user.

Compare last week vs this week and write a SHORT, honest summary of what changed.
Be specific. Be concrete. No fluff.

LAST WEEK — Character Bible:
{}

THIS WEEK — Character Bible:
{}

LAST WEEK — BLADE's self-perception:
{}

THIS WEEK — BLADE's self-perception:
{}

LAST WEEK — Learned preferences:
{}

THIS WEEK — Learned preferences:
{}

Write a summary of what changed in 3-6 bullet points. Format:
• [what changed or what was newly learned]

If very little changed, say so honestly ("Not much changed this week — patterns are consistent").
Focus on what's genuinely new or different, not what's the same."#,
        prev_bible,
        new_bible_json,
        if prev_soul.is_empty() { "Nothing yet." } else { &prev_soul },
        if new_soul.is_empty() { "Nothing yet." } else { new_soul },
        prev_prefs,
        new_prefs_json,
    );

    let model = crate::config::cheap_model_for_provider(&config.provider, &config.model);

    let messages = vec![ConversationMessage::User(prompt)];
    match providers::complete_turn(
        &config.provider,
        &config.api_key,
        &model,
        &messages,
        &[],
        config.base_url.as_deref(),
    ).await {
        Ok(turn) => turn.content.trim().to_string(),
        Err(_) => String::new(),
    }
}

/// Delete a learned preference by ID.
#[tauri::command]
pub fn soul_delete_preference(id: String) -> Result<(), String> {
    let db_path = blade_config_dir().join("blade.db");
    let conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;
    crate::db::brain_delete_preference(&conn, &id)
}

/// Update a section of the Character Bible directly.
#[tauri::command]
pub fn soul_update_bible_section(section: String, content: String) -> Result<(), String> {
    crate::character::update_character_section(section, content)
}

/// Force-refresh the Character Bible by consolidating raw context.
#[tauri::command]
pub async fn soul_refresh_bible() -> Result<String, String> {
    crate::character::consolidate_character().await
}

/// Full user profile — everything BLADE has learned about the user.
/// Used by the SoulView "Profile" tab to give the user full transparency.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserProfile {
    pub user_name: String,
    pub onboarding_complete: bool,
    pub traits: Vec<crate::persona_engine::PersonaTrait>,
    pub relationship: crate::persona_engine::RelationshipState,
    pub persona_md: String,
    pub activity_context: String,
    pub knowledge_nodes: Vec<KnowledgeNode>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KnowledgeNode {
    pub id: String,
    pub label: String,
    pub node_type: String,
    pub description: String,
}

#[tauri::command]
pub fn get_user_profile() -> Result<UserProfile, String> {
    let config = load_config();

    // Persona traits
    let traits = crate::persona_engine::get_all_traits();
    let relationship = crate::persona_engine::get_relationship_state();

    // persona.md raw content
    let persona_md = std::fs::read_to_string(blade_config_dir().join("persona.md"))
        .unwrap_or_default();

    // Activity context (reads from SQLite, no PowerShell)
    let activity_context = crate::activity_monitor::get_activity_context();

    // Knowledge graph nodes (user's known projects, tools, concepts)
    let db_path = blade_config_dir().join("blade.db");
    let knowledge_nodes = rusqlite::Connection::open(&db_path)
        .ok()
        .and_then(|conn| {
            conn.prepare(
                "SELECT id, label, kind, COALESCE(summary, '') FROM brain_nodes ORDER BY mention_count DESC LIMIT 50"
            ).ok().and_then(|mut stmt| {
                stmt.query_map([], |row| {
                    Ok(KnowledgeNode {
                        id: row.get(0)?,
                        label: row.get(1)?,
                        node_type: row.get(2)?,
                        description: row.get(3)?,
                    })
                }).ok().map(|rows| rows.filter_map(|r| r.ok()).collect::<Vec<_>>())
            })
        })
        .unwrap_or_default();

    Ok(UserProfile {
        user_name: config.user_name,
        onboarding_complete: config.persona_onboarding_complete,
        traits,
        relationship,
        persona_md,
        activity_context,
        knowledge_nodes,
    })
}
