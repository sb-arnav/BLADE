/// THREAD — Blade's working memory layer.
///
/// THREAD is a living document that persists what Blade is actively tracking:
/// current project, recent decisions, open loops, what comes next.
///
/// Unlike the vector store (episodic, searchable, passive) — THREAD is:
/// - Present-tense and active ("is debugging auth flow" not "debugged auth flow")
/// - Mutable: updated after every conversation turn
/// - Injected at the TOP of every system prompt — highest priority context
/// - Writable by Blade MID-CONVERSATION via the `blade_update_thread` native tool
///
/// This is Blade's equivalent of MemGPT's core memory: explicit, agent-controlled,
/// always visible, limited in size so it forces prioritization.
#[allow(dead_code)]

use tauri::Emitter;
use crate::providers::ConversationMessage;

const THREAD_MAX_WORDS: usize = 200;

/// Get current working thread content from DB. Called by brain.rs for injection.
pub fn get_active_thread() -> Option<String> {
    let db_path = crate::config::blade_config_dir().join("blade.db");
    let conn = rusqlite::Connection::open(&db_path).ok()?;
    crate::db::thread_get(&conn)
}

/// Get full thread metadata (title, content, project).
pub fn get_active_thread_full() -> Option<(String, String, String)> {
    let db_path = crate::config::blade_config_dir().join("blade.db");
    let conn = rusqlite::Connection::open(&db_path).ok()?;
    crate::db::thread_get_full(&conn)
}

/// Write to the thread from within Rust code (used by native tool handler).
pub fn write_thread(title: &str, content: &str, project: &str) -> Result<(), String> {
    let db_path = crate::config::blade_config_dir().join("blade.db");
    let conn = rusqlite::Connection::open(&db_path).map_err(|e| format!("DB error: {}", e))?;
    crate::db::thread_upsert(&conn, title, content, project)
}

/// Spawn a background task that auto-updates the working thread after a conversation exchange.
/// This is the core feedback loop: Blade always knows where it left off.
pub fn auto_update_thread(app: tauri::AppHandle, user_msg: String, assistant_msg: String) {
    // Only update if there's meaningful assistant content
    if assistant_msg.trim().len() < 40 {
        return;
    }

    tauri::async_runtime::spawn(async move {
        let config = crate::config::load_config();
        if config.api_key.is_empty() && config.provider != "ollama" {
            return;
        }

        let current = get_active_thread().unwrap_or_default();
        let prompt = build_thread_update_prompt(&current, &user_msg, &assistant_msg);

        let messages = vec![ConversationMessage::User(prompt)];

        let model = cheapest_model(&config.provider, &config.model);
        match crate::providers::complete_turn(
            &config.provider,
            &config.api_key,
            &model,
            &messages,
            &[],
            config.base_url.as_deref(),
        )
        .await
        {
            Ok(turn) => {
                let raw = turn.content.trim().to_string();
                if raw.is_empty() {
                    return;
                }

                // Expect JSON: {"title": "...", "content": "...", "project": "..."}
                // Fall back to raw text if JSON parse fails
                let (title, content, project) = if let Ok(v) = serde_json::from_str::<serde_json::Value>(&raw) {
                    (
                        v["title"].as_str().unwrap_or("Active Context").to_string(),
                        v["content"].as_str().unwrap_or(&raw).to_string(),
                        v["project"].as_str().unwrap_or("general").to_string(),
                    )
                } else {
                    ("Active Context".to_string(), raw, "general".to_string())
                };

                if !content.trim().is_empty() {
                    if let Ok(()) = write_thread(&title, &content, &project) {
                        let _ = app.emit_to("main", "thread_updated", serde_json::json!({
                            "title": title,
                            "project": project,
                        }));
                    }
                }
            }
            Err(e) => {
                eprintln!("[thread] auto-update failed: {}", e);
            }
        }
    });
}

fn build_thread_update_prompt(current: &str, user_msg: &str, assistant_msg: &str) -> String {
    let current_display = if current.is_empty() {
        "(empty — this is the first exchange)".to_string()
    } else {
        current.to_string()
    };

    format!(
        r#"You are Blade's working memory system. Your job: maintain a dense, present-tense context document.

CURRENT THREAD:
{current}

NEW EXCHANGE:
User: {user}
Blade: {assistant}

Update the THREAD to reflect what Blade is actively tracking. Include:
- What the user is working on RIGHT NOW
- Key decisions, discoveries, or patterns from this exchange
- Open loops or next steps (if clear)
- Critical entities: file paths, project names, error messages, tech stack

Rules:
- Max {max_words} words. Be brutal about what to drop.
- Present tense ("working on X", "needs Y") not past ("worked on X")
- Drop anything from > 3 turns ago unless it's load-bearing context
- Extract project from conversation — use "general" only if nothing else fits

Respond ONLY with valid JSON (no markdown, no explanation):
{{"title": "one-line summary of active context", "content": "the thread doc", "project": "project name"}}"#,
        current = current_display,
        user = crate::safe_slice(&user_msg, 500),
        assistant = crate::safe_slice(&assistant_msg, 500),
        max_words = THREAD_MAX_WORDS,
    )
}

fn cheapest_model(provider: &str, current: &str) -> String {
    crate::config::cheap_model_for_provider(provider, current)
}

// ── Tauri Commands ──────────────────────────────────────────────────────────

/// Manual thread update — called by native tool `blade_update_thread`
/// or directly from the frontend.
#[tauri::command]
pub fn blade_thread_update(
    content: String,
    title: Option<String>,
    project: Option<String>,
) -> Result<(), String> {
    write_thread(
        &title.unwrap_or_else(|| "Active Context".to_string()),
        &content,
        &project.unwrap_or_else(|| "general".to_string()),
    )
}

/// Called by the frontend after streaming completes with the full assembled response.
/// Triggers auto-update of the working thread — covers the streaming path that
/// doesn't have assistant text available on the Rust side.
#[tauri::command]
pub fn blade_thread_auto_update(
    app: tauri::AppHandle,
    user_text: String,
    assistant_text: String,
) {
    auto_update_thread(app, user_text, assistant_text);
}

/// Read current thread — used by frontend to display working memory indicator.
#[tauri::command]
pub fn blade_thread_get() -> Option<serde_json::Value> {
    let (title, content, project) = get_active_thread_full()?;
    Some(serde_json::json!({
        "title": title,
        "content": content,
        "project": project,
    }))
}
