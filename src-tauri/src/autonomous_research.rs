// autonomous_research.rs
// BLADE identifies its own knowledge gaps and proactively researches them.
// Self-directed learning: register a gap → research it → store the result → emit an event.

use rusqlite::params;
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};
use tauri::Emitter;

// ── Static guards ─────────────────────────────────────────────────────────────

static RESEARCH_RUNNING: AtomicBool = AtomicBool::new(false);
pub(crate) static LAST_ACTIVITY_TS: AtomicI64 = AtomicI64::new(0);

// ── Structs ───────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KnowledgeGap {
    pub id: String,
    pub topic: String,
    pub source: String,
    pub priority: i32,
    pub status: String,
    pub research_result: String,
    pub created_at: i64,
    pub researched_at: Option<i64>,
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn now_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

fn db_path() -> std::path::PathBuf {
    crate::config::blade_config_dir().join("blade.db")
}

fn open_db() -> Result<rusqlite::Connection, String> {
    rusqlite::Connection::open(db_path()).map_err(|e| format!("DB open error: {}", e))
}

fn cheap_model(provider: &str) -> String {
    crate::config::cheap_model_for_provider(provider, "")
}

async fn llm_call(system: &str, user_msg: &str) -> Result<String, String> {
    use crate::providers::{complete_turn, ConversationMessage};

    let cfg = crate::config::load_config();
    let provider = &cfg.provider;
    let api_key = &cfg.api_key;
    let model = cheap_model(provider);
    let base_url = cfg.base_url.as_deref();

    let messages = vec![
        ConversationMessage::System(system.to_string()),
        ConversationMessage::User(user_msg.to_string()),
    ];

    let turn = complete_turn(provider, api_key, &model, &messages, &crate::providers::no_tools(), base_url)
        .await
        .map_err(|e| { crate::config::check_and_disable_on_402(&e); e })?;
    Ok(turn.content)
}

// ── Database schema ───────────────────────────────────────────────────────────

pub fn ensure_tables() {
    let conn = match open_db() {
        Ok(c) => c,
        Err(_) => return,
    };
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS knowledge_gaps (
            id TEXT PRIMARY KEY,
            topic TEXT NOT NULL,
            source TEXT NOT NULL,
            priority INTEGER DEFAULT 5,
            status TEXT DEFAULT 'pending',
            research_result TEXT DEFAULT '',
            created_at INTEGER NOT NULL,
            researched_at INTEGER
        );",
    )
    .ok();
}

// ── Core public API ───────────────────────────────────────────────────────────

/// Upsert a gap by topic — if the topic already exists and is pending, just update priority.
pub fn register_gap(topic: &str, source: &str, priority: i32) {
    ensure_tables();
    let conn = match open_db() {
        Ok(c) => c,
        Err(_) => return,
    };
    let id = format!("gap_{}", uuid_v4());
    let now = now_secs();
    // Upsert: if topic already exists as pending, update priority; else insert fresh.
    conn.execute(
        "INSERT INTO knowledge_gaps (id, topic, source, priority, status, research_result, created_at)
         VALUES (?1, ?2, ?3, ?4, 'pending', '', ?5)
         ON CONFLICT(id) DO NOTHING",
        params![id, topic, source, priority, now],
    )
    .ok();
    // Try to raise priority of an existing pending gap for the same topic.
    conn.execute(
        "UPDATE knowledge_gaps SET priority = MAX(priority, ?1)
         WHERE topic = ?2 AND status = 'pending'",
        params![priority, topic],
    )
    .ok();
}

/// Returns pending gaps ordered by priority desc.
pub fn get_pending_gaps(limit: usize) -> Vec<KnowledgeGap> {
    ensure_tables();
    let conn = match open_db() {
        Ok(c) => c,
        Err(_) => return Vec::new(),
    };
    let mut stmt = match conn.prepare(
        "SELECT id, topic, source, priority, status, research_result, created_at, researched_at
         FROM knowledge_gaps WHERE status = 'pending'
         ORDER BY priority DESC LIMIT ?1",
    ) {
        Ok(s) => s,
        Err(_) => return Vec::new(),
    };
    stmt.query_map(params![limit as i64], |row| {
        Ok(KnowledgeGap {
            id: row.get(0)?,
            topic: row.get(1)?,
            source: row.get(2)?,
            priority: row.get(3)?,
            status: row.get(4)?,
            research_result: row.get(5)?,
            created_at: row.get(6)?,
            researched_at: row.get(7)?,
        })
    })
    .ok()
    .map(|rows| rows.filter_map(|r| r.ok()).collect())
    .unwrap_or_default()
}

// ── Web research ──────────────────────────────────────────────────────────────

/// URL-encode a query: replace spaces with + and strip unsafe chars.
fn url_encode_query(topic: &str) -> String {
    topic
        .chars()
        .map(|c| match c {
            'A'..='Z' | 'a'..='z' | '0'..='9' | '-' | '_' | '.' | '~' => c.to_string(),
            ' ' => "+".to_string(),
            _ => format!("%{:02X}", c as u32),
        })
        .collect()
}

/// Strip HTML tags from a string — crude but sufficient for search snippets.
fn strip_html(html: &str) -> String {
    let mut out = String::with_capacity(html.len());
    let mut in_tag = false;
    for c in html.chars() {
        match c {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => out.push(c),
            _ => {}
        }
    }
    // Collapse whitespace
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

async fn research_topic(topic: &str) -> Result<String, String> {
    let encoded = url_encode_query(topic);

    // Step 1: DuckDuckGo Lite search
    let ddg_cmd = format!(
        r#"curl -sL --max-time 20 -A "Mozilla/5.0" "https://lite.duckduckgo.com/lite/?q={encoded}""#
    );
    let ddg_html = crate::native_tools::run_shell(ddg_cmd, None)
        .await
        .unwrap_or_default();
    let ddg_text = {
        let stripped = strip_html(&ddg_html);
        // Take first 2000 chars to stay concise
        crate::safe_slice(&stripped, 2000).to_string()
    };

    // Step 2: GitHub search for relevant repos
    let gh_cmd = format!(
        r#"curl -s --max-time 15 "https://api.github.com/search/repositories?q={encoded}&sort=stars&per_page=3""#
    );
    let gh_raw = crate::native_tools::run_shell(gh_cmd, None)
        .await
        .unwrap_or_default();
    let gh_summary = match serde_json::from_str::<serde_json::Value>(&gh_raw) {
        Ok(v) => {
            let items = v["items"].as_array().cloned().unwrap_or_default();
            items
                .iter()
                .filter_map(|item| {
                    let name = item["full_name"].as_str()?;
                    let desc = item["description"].as_str().unwrap_or("no description");
                    Some(format!("- {}: {}", name, desc))
                })
                .collect::<Vec<_>>()
                .join("\n")
        }
        Err(_) => String::new(),
    };

    // Step 3: Synthesize with LLM
    let system = "You are a researcher writing knowledge summaries for an expert AI assistant.";
    let user_msg = format!(
        "Based on these search results, write a clear, practical summary of '{topic}' \
         that an expert AI assistant should know. Be technical and specific. 200-300 words.\n\n\
         --- DuckDuckGo results ---\n{ddg_text}\n\n\
         --- GitHub repos ---\n{gh_summary}"
    );

    let synthesis = llm_call(system, &user_msg).await.unwrap_or_else(|_| {
        format!("Research for '{}' could not be synthesized (LLM unavailable).", topic)
    });

    Ok(synthesis)
}

// ── Autonomous research loop ──────────────────────────────────────────────────

pub async fn research_next_gap(app: &tauri::AppHandle) -> Option<String> {
    let gaps = get_pending_gaps(1);
    let gap = gaps.into_iter().next()?;

    // Mark as researching
    {
        let conn = open_db().ok()?;
        conn.execute(
            "UPDATE knowledge_gaps SET status = 'researching' WHERE id = ?1",
            params![gap.id],
        )
        .ok();
    }

    let topic = gap.topic.clone();
    let result = research_topic(&topic).await;

    let (status, result_text) = match result {
        Ok(text) => ("learned", text),
        Err(e) => ("failed", format!("Research failed: {}", e)),
    };

    // Store result
    {
        let conn = open_db().ok()?;
        let now = now_secs();
        conn.execute(
            "UPDATE knowledge_gaps SET status = ?1, research_result = ?2, researched_at = ?3
             WHERE id = ?4",
            params![status, result_text, now, gap.id],
        )
        .ok();
    }

    if status == "learned" {
        // Store in brain preferences so it feeds into future system prompts
        let brief = crate::safe_slice(&result_text, 300).to_string();
        let pref_text = format!("[Researched: {}] {}", topic, brief);
        let db_path = db_path();
        if let Ok(conn) = rusqlite::Connection::open(&db_path) {
            let id = format!("research_{}", uuid_v4());
            let now = now_secs();
            conn.execute(
                "INSERT OR REPLACE INTO brain_preferences (id, text, confidence, source, updated_at)
                 VALUES (?1, ?2, 0.8, 'autonomous_research', ?3)",
                params![id, pref_text, now],
            )
            .ok();
        }

        let _ = app.emit(
            "blade_learned",
            serde_json::json!({
                "topic": topic,
                "summary": crate::safe_slice(&result_text, 200),
            }),
        );
    }

    Some(topic)
}

/// Detect gaps from a completed conversation turn using LLM classification.
pub async fn detect_gaps_from_conversation(user_text: &str, assistant_text: &str) {
    let system = "You are a gap detector for an AI assistant. Answer with a single topic string or 'none'.";
    let user_msg = format!(
        "Did the AI response below indicate any knowledge gaps, uncertainty, or inability to help? \
         If yes, what specific topic should be researched? \
         Respond ONLY with a topic string (5-50 chars), or 'none' if no gap.\n\n\
         User: {user_text}\n\nAssistant: {assistant_text}"
    );

    let topic = match llm_call(system, &user_msg).await {
        Ok(t) => t.trim().to_string(),
        Err(_) => return,
    };

    let topic = topic.lines().next().unwrap_or("").trim().to_string();
    if topic.is_empty() || topic.to_lowercase() == "none" {
        return;
    }
    // Sanity: reject suspiciously long "topics"
    if topic.len() > 120 {
        return;
    }

    register_gap(&topic, "conversation", 6);
}

/// Start the autonomous research background loop.
/// Runs every 5 minutes, but only when the user has been idle.
pub fn start_autonomous_research(app: tauri::AppHandle) {
    if RESEARCH_RUNNING.swap(true, Ordering::SeqCst) {
        return; // already running
    }

    ensure_tables();

    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(tokio::time::Duration::from_secs(300)).await;

            let config = crate::config::load_config();
            if !config.background_ai_enabled {
                continue;
            }

            // Pituitary GH: skip research when growth hormone is low
            let gh = crate::homeostasis::growth_hormone();
            if gh < 0.3 {
                continue; // body is conserving — not the time for research
            }

            // Leptin: skip research when knowledge-satiated (learned a lot recently)
            let leptin = crate::homeostasis::get_hormones().leptin;
            if leptin > 0.7 {
                continue; // satiated — don't overfeed on knowledge
            }

            // Only research when idle (no activity in last 5 minutes)
            let last = LAST_ACTIVITY_TS.load(Ordering::Relaxed);
            let now = now_secs();
            let idle_secs = now - last;
            if idle_secs < 300 && last != 0 {
                continue;
            }

            let _ = research_next_gap(&app).await;
        }
    });
}

// ── Simple UUID v4 (random hex) ───────────────────────────────────────────────

fn uuid_v4() -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut h = DefaultHasher::new();
    now_secs().hash(&mut h);
    std::thread::current().id().hash(&mut h);
    let r1 = h.finish();
    std::time::Duration::from_nanos(r1).hash(&mut h);
    let r2 = h.finish();
    format!("{:016x}{:016x}", r1, r2)
}

// ── Tauri commands ────────────────────────────────────────────────────────────

#[tauri::command]
pub fn research_list_gaps() -> Vec<KnowledgeGap> {
    ensure_tables();
    let conn = match open_db() {
        Ok(c) => c,
        Err(_) => return Vec::new(),
    };
    let mut stmt = match conn.prepare(
        "SELECT id, topic, source, priority, status, research_result, created_at, researched_at
         FROM knowledge_gaps ORDER BY priority DESC, created_at DESC LIMIT 200",
    ) {
        Ok(s) => s,
        Err(_) => return Vec::new(),
    };
    stmt.query_map([], |row| {
        Ok(KnowledgeGap {
            id: row.get(0)?,
            topic: row.get(1)?,
            source: row.get(2)?,
            priority: row.get(3)?,
            status: row.get(4)?,
            research_result: row.get(5)?,
            created_at: row.get(6)?,
            researched_at: row.get(7)?,
        })
    })
    .ok()
    .map(|rows| rows.filter_map(|r| r.ok()).collect())
    .unwrap_or_default()
}

#[tauri::command]
pub fn research_add_gap(topic: String, priority: Option<i32>) -> Result<(), String> {
    register_gap(&topic, "manual", priority.unwrap_or(5));
    Ok(())
}

#[tauri::command]
pub async fn research_trigger_now(app: tauri::AppHandle) -> Result<String, String> {
    research_next_gap(&app)
        .await
        .ok_or_else(|| "No pending gaps to research".to_string())
}
