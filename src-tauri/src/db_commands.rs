//! Tauri command wrappers for the SQLite database layer.
//! These bridge the frontend invoke() calls to db.rs functions.

use crate::db;
use rusqlite::Connection;
use std::sync::{Arc, Mutex};

pub type SharedDb = Arc<Mutex<Connection>>;

// ── Conversations ──────────────────────────────────────────────────────────────

#[tauri::command]
pub fn db_list_conversations(
    state: tauri::State<'_, SharedDb>,
) -> Result<Vec<db::ConversationRow>, String> {
    let conn = state.lock().map_err(|e| format!("Lock error: {}", e))?;
    db::list_conversations(&conn)
}

#[tauri::command]
pub fn db_get_conversation(
    state: tauri::State<'_, SharedDb>,
    id: String,
) -> Result<db::ConversationWithMessages, String> {
    let conn = state.lock().map_err(|e| format!("Lock error: {}", e))?;
    db::get_conversation(&conn, &id)
}

#[tauri::command]
pub fn db_save_conversation(
    state: tauri::State<'_, SharedDb>,
    id: String,
    title: String,
    messages: Vec<db::MessageRow>,
) -> Result<db::ConversationRow, String> {
    let conn = state.lock().map_err(|e| format!("Lock error: {}", e))?;
    db::save_conversation(&conn, &id, &title, &messages)
}

#[tauri::command]
pub fn db_delete_conversation(state: tauri::State<'_, SharedDb>, id: String) -> Result<(), String> {
    let conn = state.lock().map_err(|e| format!("Lock error: {}", e))?;
    db::delete_conversation(&conn, &id)
}

#[tauri::command]
pub fn db_search_messages(
    state: tauri::State<'_, SharedDb>,
    query: String,
) -> Result<Vec<db::SearchResult>, String> {
    let conn = state.lock().map_err(|e| format!("Lock error: {}", e))?;
    db::search_messages(&conn, &query)
}

#[tauri::command]
pub fn db_pin_conversation(
    state: tauri::State<'_, SharedDb>,
    id: String,
    pinned: bool,
) -> Result<(), String> {
    let conn = state.lock().map_err(|e| format!("Lock error: {}", e))?;
    conn.execute(
        "UPDATE conversations SET pinned = ?1 WHERE id = ?2",
        rusqlite::params![pinned as i32, id],
    )
    .map_err(|e| format!("DB error: {}", e))?;
    Ok(())
}

#[tauri::command]
pub fn db_rename_conversation(
    state: tauri::State<'_, SharedDb>,
    id: String,
    title: String,
) -> Result<(), String> {
    let conn = state.lock().map_err(|e| format!("Lock error: {}", e))?;
    conn.execute(
        "UPDATE conversations SET title = ?1 WHERE id = ?2",
        rusqlite::params![title, id],
    )
    .map_err(|e| format!("DB error: {}", e))?;
    Ok(())
}

#[tauri::command]
pub fn db_conversation_stats(
    state: tauri::State<'_, SharedDb>,
) -> Result<serde_json::Value, String> {
    let conn = state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let total: i64 = conn
        .query_row("SELECT COUNT(*) FROM conversations", [], |row| row.get(0))
        .unwrap_or(0);
    let total_messages: i64 = conn
        .query_row("SELECT COUNT(*) FROM messages", [], |row| row.get(0))
        .unwrap_or(0);
    let oldest: i64 = conn
        .query_row("SELECT MIN(created_at) FROM conversations", [], |row| {
            row.get(0)
        })
        .unwrap_or(0);

    Ok(serde_json::json!({
        "total": total,
        "totalMessages": total_messages,
        "oldestTimestamp": oldest,
    }))
}

// ── Knowledge ──────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn db_list_knowledge(
    state: tauri::State<'_, SharedDb>,
) -> Result<Vec<db::KnowledgeRow>, String> {
    let conn = state.lock().map_err(|e| format!("Lock error: {}", e))?;
    db::list_knowledge(&conn)
}

#[tauri::command]
pub fn db_get_knowledge(
    state: tauri::State<'_, SharedDb>,
    id: String,
) -> Result<db::KnowledgeRow, String> {
    let conn = state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let entries = db::list_knowledge(&conn)?;
    entries
        .into_iter()
        .find(|e| e.id == id)
        .ok_or_else(|| "Knowledge entry not found".to_string())
}

#[tauri::command]
pub fn db_add_knowledge(
    state: tauri::State<'_, SharedDb>,
    entry: db::KnowledgeRow,
) -> Result<db::KnowledgeRow, String> {
    let conn = state.lock().map_err(|e| format!("Lock error: {}", e))?;
    db::add_knowledge(&conn, &entry)?;
    Ok(entry)
}

#[tauri::command]
pub fn db_update_knowledge(
    state: tauri::State<'_, SharedDb>,
    entry: db::KnowledgeRow,
) -> Result<(), String> {
    let conn = state.lock().map_err(|e| format!("Lock error: {}", e))?;
    db::update_knowledge(&conn, &entry)
}

#[tauri::command]
pub fn db_delete_knowledge(state: tauri::State<'_, SharedDb>, id: String) -> Result<(), String> {
    let conn = state.lock().map_err(|e| format!("Lock error: {}", e))?;
    db::delete_knowledge(&conn, &id)
}

#[tauri::command]
pub fn db_search_knowledge(
    state: tauri::State<'_, SharedDb>,
    query: String,
) -> Result<Vec<db::KnowledgeRow>, String> {
    let conn = state.lock().map_err(|e| format!("Lock error: {}", e))?;
    db::search_knowledge(&conn, &query)
}

#[tauri::command]
pub fn db_knowledge_by_tag(
    state: tauri::State<'_, SharedDb>,
    tag: String,
) -> Result<Vec<db::KnowledgeRow>, String> {
    let conn = state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let all = db::list_knowledge(&conn)?;
    let lower_tag = tag.to_lowercase();
    Ok(all
        .into_iter()
        .filter(|e| e.tags.to_lowercase().contains(&lower_tag))
        .collect())
}

#[tauri::command]
pub fn db_knowledge_tags(
    state: tauri::State<'_, SharedDb>,
) -> Result<Vec<serde_json::Value>, String> {
    let conn = state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let entries = db::list_knowledge(&conn)?;
    let mut tag_counts: std::collections::HashMap<String, usize> = std::collections::HashMap::new();

    for entry in &entries {
        if let Ok(tags) = serde_json::from_str::<Vec<String>>(&entry.tags) {
            for tag in tags {
                *tag_counts.entry(tag).or_insert(0) += 1;
            }
        }
    }

    let mut result: Vec<serde_json::Value> = tag_counts
        .into_iter()
        .map(|(tag, count)| serde_json::json!({"tag": tag, "count": count}))
        .collect();
    result.sort_by(|a, b| {
        b["count"]
            .as_u64()
            .unwrap_or(0)
            .cmp(&a["count"].as_u64().unwrap_or(0))
    });
    Ok(result)
}

#[tauri::command]
pub fn db_knowledge_stats(state: tauri::State<'_, SharedDb>) -> Result<serde_json::Value, String> {
    let conn = state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let entries = db::list_knowledge(&conn)?;
    let total = entries.len();

    let mut all_tags: std::collections::HashSet<String> = std::collections::HashSet::new();
    for entry in &entries {
        if let Ok(tags) = serde_json::from_str::<Vec<String>>(&entry.tags) {
            for tag in tags {
                all_tags.insert(tag);
            }
        }
    }

    let week_ago = chrono::Utc::now().timestamp_millis() - (7 * 24 * 60 * 60 * 1000);
    let recent = entries.iter().filter(|e| e.created_at > week_ago).count();

    Ok(serde_json::json!({
        "total": total,
        "totalTags": all_tags.len(),
        "recentCount": recent,
    }))
}

// ── Analytics ──────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn db_track_event(
    state: tauri::State<'_, SharedDb>,
    event_type: String,
    metadata: Option<String>,
) -> Result<(), String> {
    let conn = state.lock().map_err(|e| format!("Lock error: {}", e))?;
    db::track_event(&conn, &event_type, metadata.as_deref())
}

#[tauri::command]
pub fn db_events_since(
    state: tauri::State<'_, SharedDb>,
    since: i64,
) -> Result<Vec<db::AnalyticsEvent>, String> {
    let conn = state.lock().map_err(|e| format!("Lock error: {}", e))?;
    db::get_events_since(&conn, since)
}

#[tauri::command]
pub fn db_prune_analytics(
    state: tauri::State<'_, SharedDb>,
    older_than_days: i64,
) -> Result<usize, String> {
    let conn = state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let cutoff = chrono::Utc::now().timestamp_millis() - (older_than_days * 24 * 60 * 60 * 1000);
    let deleted = conn
        .execute(
            "DELETE FROM analytics_events WHERE timestamp < ?1",
            rusqlite::params![cutoff],
        )
        .map_err(|e| format!("DB error: {}", e))?;
    Ok(deleted)
}

#[tauri::command]
pub fn db_analytics_summary(
    state: tauri::State<'_, SharedDb>,
) -> Result<serde_json::Value, String> {
    let conn = state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let thirty_days_ago = chrono::Utc::now().timestamp_millis() - (30 * 24 * 60 * 60 * 1000);
    let events = db::get_events_since(&conn, thirty_days_ago)?;

    let total_sent = events
        .iter()
        .filter(|e| e.event_type == "message_sent")
        .count();
    let total_received = events
        .iter()
        .filter(|e| e.event_type == "message_received")
        .count();

    Ok(serde_json::json!({
        "totalMessages": total_sent + total_received,
        "totalConversations": 0,
        "avgResponseTime": 0,
        "currentStreak": 0,
        "longestStreak": 0,
        "mostActiveHour": 0,
        "topProvider": "",
    }))
}

// ── Settings ───────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn db_get_setting(
    state: tauri::State<'_, SharedDb>,
    key: String,
) -> Result<Option<String>, String> {
    let conn = state.lock().map_err(|e| format!("Lock error: {}", e))?;
    db::get_setting(&conn, &key)
}

#[tauri::command]
pub fn db_set_setting(
    state: tauri::State<'_, SharedDb>,
    key: String,
    value: String,
) -> Result<(), String> {
    let conn = state.lock().map_err(|e| format!("Lock error: {}", e))?;
    db::set_setting(&conn, &key, &value)
}

#[tauri::command]
pub fn db_get_all_settings(
    state: tauri::State<'_, SharedDb>,
) -> Result<std::collections::HashMap<String, String>, String> {
    let conn = state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let mut stmt = conn
        .prepare("SELECT key, value FROM settings")
        .map_err(|e| format!("DB error: {}", e))?;
    let rows = stmt
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|e| format!("DB error: {}", e))?;

    let mut map = std::collections::HashMap::new();
    for row in rows {
        if let Ok((k, v)) = row {
            map.insert(k, v);
        }
    }
    Ok(map)
}

#[tauri::command]
pub fn db_delete_setting(state: tauri::State<'_, SharedDb>, key: String) -> Result<(), String> {
    let conn = state.lock().map_err(|e| format!("Lock error: {}", e))?;
    conn.execute(
        "DELETE FROM settings WHERE key = ?1",
        rusqlite::params![key],
    )
    .map_err(|e| format!("DB error: {}", e))?;
    Ok(())
}

// ── Templates ──────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn db_list_templates(
    state: tauri::State<'_, SharedDb>,
) -> Result<Vec<serde_json::Value>, String> {
    let conn = state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let mut stmt = conn
        .prepare("SELECT id, name, content, variables, category, icon, created_at, updated_at, usage_count, is_builtin FROM templates ORDER BY usage_count DESC")
        .map_err(|e| format!("DB error: {}", e))?;
    let rows = stmt
        .query_map([], |row| {
            Ok(serde_json::json!({
                "id": row.get::<_, String>(0)?,
                "name": row.get::<_, String>(1)?,
                "content": row.get::<_, String>(2)?,
                "variables": row.get::<_, String>(3)?,
                "category": row.get::<_, String>(4)?,
                "icon": row.get::<_, String>(5)?,
                "created_at": row.get::<_, i64>(6)?,
                "updated_at": row.get::<_, i64>(7)?,
                "usage_count": row.get::<_, i64>(8)?,
                "is_builtin": row.get::<_, bool>(9)?,
            }))
        })
        .map_err(|e| format!("DB error: {}", e))?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("DB error: {}", e))
}

#[tauri::command]
pub fn db_add_template(
    state: tauri::State<'_, SharedDb>,
    template: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let conn = state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().timestamp_millis();
    conn.execute(
        "INSERT INTO templates (id, name, content, variables, category, icon, created_at, updated_at, usage_count, is_builtin) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 0, 0)",
        rusqlite::params![
            id,
            template["name"].as_str().unwrap_or(""),
            template["content"].as_str().unwrap_or(""),
            template["variables"].to_string(),
            template["category"].as_str().unwrap_or("custom"),
            template["icon"].as_str().unwrap_or("📝"),
            now,
            now,
        ],
    ).map_err(|e| format!("DB error: {}", e))?;

    Ok(serde_json::json!({"id": id}))
}

#[tauri::command]
pub fn db_delete_template(state: tauri::State<'_, SharedDb>, id: String) -> Result<(), String> {
    let conn = state.lock().map_err(|e| format!("Lock error: {}", e))?;
    conn.execute(
        "DELETE FROM templates WHERE id = ?1 AND is_builtin = 0",
        rusqlite::params![id],
    )
    .map_err(|e| format!("DB error: {}", e))?;
    Ok(())
}

#[tauri::command]
pub fn db_increment_template_usage(
    state: tauri::State<'_, SharedDb>,
    id: String,
) -> Result<(), String> {
    let conn = state.lock().map_err(|e| format!("Lock error: {}", e))?;
    conn.execute(
        "UPDATE templates SET usage_count = usage_count + 1 WHERE id = ?1",
        rusqlite::params![id],
    )
    .map_err(|e| format!("DB error: {}", e))?;
    Ok(())
}

// ── Brain (Character Bible) ────────────────────────────────────────────────────

#[tauri::command]
pub fn brain_get_identity(state: tauri::State<'_, SharedDb>) -> Result<std::collections::HashMap<String, String>, String> {
    let conn = state.lock().map_err(|e| format!("Lock error: {}", e))?;
    db::brain_get_identity(&conn)
}

#[tauri::command]
pub fn brain_set_identity(state: tauri::State<'_, SharedDb>, key: String, value: String) -> Result<(), String> {
    let conn = state.lock().map_err(|e| format!("Lock error: {}", e))?;
    db::brain_set_identity(&conn, &key, &value)
}

#[tauri::command]
pub fn brain_get_style_tags(state: tauri::State<'_, SharedDb>) -> Result<Vec<String>, String> {
    let conn = state.lock().map_err(|e| format!("Lock error: {}", e))?;
    db::brain_get_style_tags(&conn)
}

#[tauri::command]
pub fn brain_get_style_tag_entries(state: tauri::State<'_, SharedDb>) -> Result<Vec<db::BrainStyleTagRow>, String> {
    let conn = state.lock().map_err(|e| format!("Lock error: {}", e))?;
    db::brain_get_style_tag_entries(&conn)
}

#[tauri::command]
pub fn brain_add_style_tag(state: tauri::State<'_, SharedDb>, id: String, tag: String) -> Result<(), String> {
    let conn = state.lock().map_err(|e| format!("Lock error: {}", e))?;
    db::brain_add_style_tag(&conn, &id, &tag)
}

#[tauri::command]
pub fn brain_remove_style_tag(state: tauri::State<'_, SharedDb>, id: String) -> Result<(), String> {
    let conn = state.lock().map_err(|e| format!("Lock error: {}", e))?;
    db::brain_remove_style_tag(&conn, &id)
}

#[tauri::command]
pub fn brain_get_preferences(state: tauri::State<'_, SharedDb>) -> Result<Vec<db::BrainPreferenceRow>, String> {
    let conn = state.lock().map_err(|e| format!("Lock error: {}", e))?;
    db::brain_get_preferences(&conn)
}

#[tauri::command]
pub fn brain_upsert_preference(state: tauri::State<'_, SharedDb>, id: String, text: String, confidence: f64, source: String) -> Result<(), String> {
    let conn = state.lock().map_err(|e| format!("Lock error: {}", e))?;
    db::brain_upsert_preference(&conn, &id, &text, confidence, &source)
}

#[tauri::command]
pub fn brain_delete_preference(state: tauri::State<'_, SharedDb>, id: String) -> Result<(), String> {
    let conn = state.lock().map_err(|e| format!("Lock error: {}", e))?;
    db::brain_delete_preference(&conn, &id)
}

#[tauri::command]
pub fn brain_get_memories(state: tauri::State<'_, SharedDb>, limit: Option<i64>) -> Result<Vec<db::BrainMemoryRow>, String> {
    let conn = state.lock().map_err(|e| format!("Lock error: {}", e))?;
    db::brain_get_memories(&conn, limit.unwrap_or(50))
}

#[tauri::command]
pub fn brain_add_memory(state: tauri::State<'_, SharedDb>, id: String, text: String, source_conversation_id: String, entities_json: String, confidence: f64, expires_at: Option<i64>) -> Result<(), String> {
    let conn = state.lock().map_err(|e| format!("Lock error: {}", e))?;
    db::brain_add_memory(&conn, &id, &text, &source_conversation_id, &entities_json, confidence, expires_at)
}

#[tauri::command]
pub fn brain_delete_memory(state: tauri::State<'_, SharedDb>, id: String) -> Result<(), String> {
    let conn = state.lock().map_err(|e| format!("Lock error: {}", e))?;
    db::brain_delete_memory(&conn, &id)
}

#[tauri::command]
pub fn brain_clear_memories(state: tauri::State<'_, SharedDb>) -> Result<(), String> {
    let conn = state.lock().map_err(|e| format!("Lock error: {}", e))?;
    db::brain_clear_memories(&conn)
}

#[tauri::command]
pub fn brain_get_nodes(state: tauri::State<'_, SharedDb>) -> Result<Vec<db::BrainNodeRow>, String> {
    let conn = state.lock().map_err(|e| format!("Lock error: {}", e))?;
    db::brain_get_nodes(&conn)
}

#[tauri::command]
pub fn brain_upsert_node(state: tauri::State<'_, SharedDb>, id: String, label: String, kind: String, summary: String) -> Result<(), String> {
    let conn = state.lock().map_err(|e| format!("Lock error: {}", e))?;
    db::brain_upsert_node(&conn, &id, &label, &kind, &summary)
}

#[tauri::command]
pub fn brain_delete_node(state: tauri::State<'_, SharedDb>, id: String) -> Result<(), String> {
    let conn = state.lock().map_err(|e| format!("Lock error: {}", e))?;
    db::brain_delete_node(&conn, &id)
}

#[tauri::command]
pub fn brain_get_edges(state: tauri::State<'_, SharedDb>) -> Result<Vec<db::BrainEdgeRow>, String> {
    let conn = state.lock().map_err(|e| format!("Lock error: {}", e))?;
    db::brain_get_edges(&conn)
}

#[tauri::command]
pub fn brain_upsert_edge(state: tauri::State<'_, SharedDb>, id: String, from_id: String, to_id: String, label: String) -> Result<(), String> {
    let conn = state.lock().map_err(|e| format!("Lock error: {}", e))?;
    db::brain_upsert_edge(&conn, &id, &from_id, &to_id, &label)
}

#[tauri::command]
pub fn brain_get_skills(state: tauri::State<'_, SharedDb>) -> Result<Vec<db::BrainSkillRow>, String> {
    let conn = state.lock().map_err(|e| format!("Lock error: {}", e))?;
    db::brain_get_skills(&conn)
}

#[tauri::command]
pub fn brain_upsert_skill(state: tauri::State<'_, SharedDb>, id: String, name: String, trigger_pattern: String, prompt_modifier: String, tools_json: String) -> Result<(), String> {
    let conn = state.lock().map_err(|e| format!("Lock error: {}", e))?;
    db::brain_upsert_skill(&conn, &id, &name, &trigger_pattern, &prompt_modifier, &tools_json)
}

#[tauri::command]
pub fn brain_delete_skill(state: tauri::State<'_, SharedDb>, id: String) -> Result<(), String> {
    let conn = state.lock().map_err(|e| format!("Lock error: {}", e))?;
    db::brain_delete_skill(&conn, &id)
}

#[tauri::command]
pub fn brain_set_skill_active(state: tauri::State<'_, SharedDb>, id: String, active: bool) -> Result<(), String> {
    let conn = state.lock().map_err(|e| format!("Lock error: {}", e))?;
    db::brain_set_skill_active(&conn, &id, active)
}

#[tauri::command]
pub fn brain_add_reaction(state: tauri::State<'_, SharedDb>, id: String, message_id: String, polarity: i64, content: String, context_json: String) -> Result<(), String> {
    let conn = state.lock().map_err(|e| format!("Lock error: {}", e))?;
    db::brain_add_reaction(&conn, &id, &message_id, polarity, &content, &context_json)
}

#[tauri::command]
pub fn brain_get_reactions(state: tauri::State<'_, SharedDb>, limit: Option<i64>) -> Result<Vec<db::BrainReactionRow>, String> {
    let conn = state.lock().map_err(|e| format!("Lock error: {}", e))?;
    db::brain_get_reactions(&conn, limit.unwrap_or(100))
}

#[tauri::command]
pub fn brain_get_context(state: tauri::State<'_, SharedDb>, budget_tokens: Option<usize>) -> Result<String, String> {
    let conn = state.lock().map_err(|e| format!("Lock error: {}", e))?;
    Ok(db::brain_build_context(&conn, budget_tokens.unwrap_or(700)))
}
