/// PROACTIVE VISION — Omi-style assistants that analyze screen on context switch.
///
/// When the user switches apps or windows, the screen capture loop emits
/// `screen_context_switch`. This module catches it and runs lightweight
/// analysis to extract tasks, detect focus/distraction, and surface insights.
///
/// Unlike the main chat pipeline, these assistants use CHEAP models and
/// produce SHORT structured outputs — not full conversations.
///
/// Inspired by Omi's ProactiveAssistants architecture:
///   TaskAssistant   — extract tasks/todos visible on screen
///   FocusAssistant  — detect if user is distracted or focused
///   InsightAssistant — surface contextual insights/connections

use serde::{Deserialize, Serialize};
use tauri::Emitter;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProactiveCard {
    pub card_type: String, // "task" | "focus" | "insight" | "memory"
    pub title: String,
    pub body: String,
    pub source_app: String,
    pub confidence: f32,
    pub timestamp: i64,
    pub dismissed: bool,
}

/// Called from the screen_context_switch event listener.
/// Runs lightweight analysis on the current screen state.
pub async fn on_context_switch(
    app: &tauri::AppHandle,
    from_app: &str,
    to_app: &str,
    to_title: &str,
) {
    // Skip analysis if homeostasis says we're in conservation mode
    let energy = crate::homeostasis::energy_mode();
    if energy < 0.3 {
        return; // deep night / conservation — skip proactive analysis
    }

    // Get latest screen description for analysis
    let screen_desc = crate::perception_fusion::get_latest()
        .map(|p| p.screen_ocr_text.clone())
        .unwrap_or_default();

    // Skip if no screen data
    if screen_desc.is_empty() && to_title.is_empty() {
        return;
    }

    let context = format!(
        "User switched from '{}' to '{}' (window: '{}')\nScreen content: {}",
        from_app,
        to_app,
        crate::safe_slice(to_title, 80),
        crate::safe_slice(&screen_desc, 500),
    );

    // Run assistants in parallel
    let app1 = app.clone();
    let ctx1 = context.clone();
    let to_app_owned = to_app.to_string();

    // Task extraction
    let app2 = app.clone();
    let ctx2 = context.clone();
    let to_app2 = to_app.to_string();
    tokio::spawn(async move {
        if let Some(card) = extract_tasks(&ctx2, &to_app2).await {
            let _ = app2.emit("proactive_card", &card);
            store_card(&card);
        }
    });

    // Focus detection
    let app3 = app.clone();
    let from_owned = from_app.to_string();
    let to_app3 = to_app.to_string();
    tokio::spawn(async move {
        if let Some(card) = detect_focus(&from_owned, &to_app3).await {
            let _ = app3.emit("proactive_card", &card);
        }
    });

    // Insight surfacing — connect what's on screen to what BLADE knows
    tokio::spawn(async move {
        if let Some(card) = surface_insight(&ctx1, &to_app_owned).await {
            let _ = app1.emit("proactive_card", &card);
            store_card(&card);
        }
    });
}

/// Extract tasks/todos visible on screen (meetings, action items, deadlines).
async fn extract_tasks(context: &str, source_app: &str) -> Option<ProactiveCard> {
    let config = crate::config::load_config();
    if config.api_key.is_empty() && config.provider != "ollama" {
        return None;
    }

    let model = crate::config::cheap_model_for_provider(&config.provider, &config.model);

    let prompt = format!(
        "Look at this screen context and extract any visible tasks, todos, action items, or deadlines. \
         If you see none, respond with exactly: NONE\n\
         If you see tasks, respond with a single line summary (max 100 chars).\n\n\
         Context:\n{}",
        crate::safe_slice(context, 600)
    );

    let messages = vec![
        crate::providers::ConversationMessage::User(prompt),
    ];

    let result = crate::providers::complete_turn(
        &config.provider, &config.api_key, &model,
        &messages, &crate::providers::no_tools(),
        config.base_url.as_deref(),
    ).await.ok()?;

    let text = result.content.trim().to_string();
    if text.is_empty() || text.to_uppercase().starts_with("NONE") {
        return None;
    }

    Some(ProactiveCard {
        card_type: "task".to_string(),
        title: "Task detected".to_string(),
        body: crate::safe_slice(&text, 150).to_string(),
        source_app: source_app.to_string(),
        confidence: 0.7,
        timestamp: chrono::Utc::now().timestamp(),
        dismissed: false,
    })
}

/// Detect if the user is distracted (switching apps rapidly, opening social media).
async fn detect_focus(from_app: &str, to_app: &str) -> Option<ProactiveCard> {
    let to_lower = to_app.to_lowercase();
    let distractors = [
        "twitter", "x.com", "reddit", "instagram", "facebook",
        "youtube", "tiktok", "netflix", "twitch", "discord",
    ];

    // Check if the user switched TO a distraction app
    let is_distraction = distractors.iter().any(|d| to_lower.contains(d));

    if !is_distraction {
        return None;
    }

    // Only flag if they were in a productive app before
    let from_lower = from_app.to_lowercase();
    let productive_apps = [
        "code", "cursor", "vim", "terminal", "powershell",
        "figma", "notion", "linear", "jira", "slack",
    ];
    let was_productive = productive_apps.iter().any(|p| from_lower.contains(p));

    if !was_productive {
        return None; // they weren't working, no need to nag
    }

    Some(ProactiveCard {
        card_type: "focus".to_string(),
        title: "Focus check".to_string(),
        body: format!("You switched from {} to {}. Quick break or getting distracted?", from_app, to_app),
        source_app: to_app.to_string(),
        confidence: 0.6,
        timestamp: chrono::Utc::now().timestamp(),
        dismissed: false,
    })
}

/// Surface insights by connecting screen content to BLADE's knowledge.
async fn surface_insight(context: &str, source_app: &str) -> Option<ProactiveCard> {
    // Only run insights occasionally — check homeostasis exploration level
    let exploration = crate::homeostasis::exploration();
    if exploration < 0.3 {
        return None; // not in exploration mode
    }

    let config = crate::config::load_config();
    if config.api_key.is_empty() && config.provider != "ollama" {
        return None;
    }

    // Get relevant DNA context for what's on screen
    let dna = crate::dna::query_for_brain(context);
    if dna.is_empty() {
        return None;
    }

    let model = crate::config::cheap_model_for_provider(&config.provider, &config.model);

    let prompt = format!(
        "You see the user's screen and you know these things about them:\n\n{}\n\n\
         Screen context:\n{}\n\n\
         Is there a useful connection or insight? Something they should know, a reminder, \
         or a relevant fact from their history? If nothing useful, respond with: NONE\n\
         If yes, respond with ONE sentence (max 100 chars).",
        crate::safe_slice(&dna, 500),
        crate::safe_slice(context, 400),
    );

    let messages = vec![
        crate::providers::ConversationMessage::User(prompt),
    ];

    let result = crate::providers::complete_turn(
        &config.provider, &config.api_key, &model,
        &messages, &crate::providers::no_tools(),
        config.base_url.as_deref(),
    ).await.ok()?;

    let text = result.content.trim().to_string();
    if text.is_empty() || text.to_uppercase().starts_with("NONE") {
        return None;
    }

    Some(ProactiveCard {
        card_type: "insight".to_string(),
        title: "Insight".to_string(),
        body: crate::safe_slice(&text, 150).to_string(),
        source_app: source_app.to_string(),
        confidence: 0.5,
        timestamp: chrono::Utc::now().timestamp(),
        dismissed: false,
    })
}

fn store_card(card: &ProactiveCard) {
    let db_path = crate::config::blade_config_dir().join("blade.db");
    if let Ok(conn) = rusqlite::Connection::open(&db_path) {
        let _ = conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS proactive_cards (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                card_type TEXT NOT NULL,
                title TEXT NOT NULL,
                body TEXT NOT NULL,
                source_app TEXT NOT NULL,
                confidence REAL NOT NULL,
                timestamp INTEGER NOT NULL,
                dismissed INTEGER DEFAULT 0
            );"
        );
        let _ = conn.execute(
            "INSERT INTO proactive_cards (card_type, title, body, source_app, confidence, timestamp, dismissed)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0)",
            rusqlite::params![card.card_type, card.title, card.body, card.source_app, card.confidence, card.timestamp],
        );
    }
}

// ── Tauri Commands ───────────────────────────────────────────────────────────

#[tauri::command]
pub fn proactive_get_cards(limit: Option<usize>) -> Vec<ProactiveCard> {
    let db_path = crate::config::blade_config_dir().join("blade.db");
    let conn = match rusqlite::Connection::open(&db_path) {
        Ok(c) => c,
        Err(_) => return vec![],
    };
    let lim = limit.unwrap_or(10) as i64;
    let mut stmt = match conn.prepare(
        "SELECT card_type, title, body, source_app, confidence, timestamp, dismissed
         FROM proactive_cards WHERE dismissed = 0
         ORDER BY timestamp DESC LIMIT ?1"
    ) {
        Ok(s) => s,
        Err(_) => return vec![],
    };
    stmt.query_map(rusqlite::params![lim], |row| {
        Ok(ProactiveCard {
            card_type: row.get(0)?,
            title: row.get(1)?,
            body: row.get(2)?,
            source_app: row.get(3)?,
            confidence: row.get(4)?,
            timestamp: row.get(5)?,
            dismissed: row.get::<_, i32>(6)? != 0,
        })
    })
    .ok()
    .map(|rows| rows.filter_map(|r| r.ok()).collect())
    .unwrap_or_default()
}

#[tauri::command]
pub fn proactive_dismiss_card(id: i64) {
    let db_path = crate::config::blade_config_dir().join("blade.db");
    if let Ok(conn) = rusqlite::Connection::open(&db_path) {
        let _ = conn.execute(
            "UPDATE proactive_cards SET dismissed = 1 WHERE id = ?1",
            rusqlite::params![id],
        );
    }
}
