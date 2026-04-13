/// SELF-CRITIQUE ENGINE — BLADE's build-roast-rebuild cycle.
///
/// Every response BLADE gives is a candidate, not a final answer. This module
/// runs a brutal critic persona against every output, scores it 1-10, and
/// automatically rebuilds anything that scores below 7. Failures become
/// permanent learning through weekly meta-critique that writes preferences
/// directly into the brain.
///
/// The flow: critique_response → maybe rebuild → save to DB → return.
/// Called async in background so the user never waits. Only the rebuilt
/// response surfaces if the original wasn't good enough.

use rusqlite::params;
use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------------
// Structs
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CritiqueResult {
    pub score: i32,            // 1-10, 10 = perfect
    pub problems: Vec<String>,
    pub verdict: String,       // one-line assessment
    pub should_rebuild: bool,  // true if score < 7
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoastSession {
    pub id: String,
    pub user_request: String,
    pub original: String,
    pub critique: CritiqueResult,
    pub rebuilt: Option<String>,
    pub improvement_summary: String,
    pub created_at: i64,
}

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------

fn db_path() -> std::path::PathBuf {
    crate::config::blade_config_dir().join("blade.db")
}

pub fn ensure_tables() -> Result<(), String> {
    let conn = rusqlite::Connection::open(db_path())
        .map_err(|e| format!("DB open error: {}", e))?;

    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS self_critiques (
            id TEXT PRIMARY KEY,
            original_response TEXT NOT NULL,
            user_request TEXT NOT NULL,
            critique TEXT NOT NULL,
            critique_score INTEGER NOT NULL,
            rebuilt_response TEXT DEFAULT '',
            improvement_summary TEXT DEFAULT '',
            was_rebuilt INTEGER DEFAULT 0,
            created_at INTEGER NOT NULL
        );"
    ).map_err(|e| format!("DB schema error: {}", e))?;

    Ok(())
}

fn save_session(session: &RoastSession) -> Result<(), String> {
    let conn = rusqlite::Connection::open(db_path())
        .map_err(|e| format!("DB open error: {}", e))?;

    let critique_json = serde_json::to_string(&session.critique)
        .map_err(|e| format!("Serialize error: {}", e))?;

    let rebuilt = session.rebuilt.clone().unwrap_or_default();
    let was_rebuilt = if session.rebuilt.is_some() { 1i32 } else { 0i32 };

    conn.execute(
        "INSERT OR REPLACE INTO self_critiques
            (id, original_response, user_request, critique, critique_score,
             rebuilt_response, improvement_summary, was_rebuilt, created_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",
        params![
            session.id,
            session.original,
            session.user_request,
            critique_json,
            session.critique.score,
            rebuilt,
            session.improvement_summary,
            was_rebuilt,
            session.created_at,
        ],
    ).map_err(|e| format!("DB insert error: {}", e))?;

    Ok(())
}

// ---------------------------------------------------------------------------
// Model selection — cheapest available per provider for critique work
// ---------------------------------------------------------------------------

fn cheap_model_for_provider(provider: &str) -> &'static str {
    match provider {
        "anthropic" => "claude-haiku-4-5-20251001",
        "openai"    => "gpt-4o-mini",
        "gemini"    => "gemini-2.0-flash",
        "groq"      => "llama-3.1-8b-instant",
        _           => "gemini-2.0-flash", // safe fallback
    }
}

// ---------------------------------------------------------------------------
// LLM call helper
// ---------------------------------------------------------------------------

async fn llm_call(
    provider: &str,
    api_key: &str,
    model: &str,
    base_url: Option<&str>,
    system: &str,
    user_msg: &str,
) -> Result<String, String> {
    use crate::providers::{complete_turn, ConversationMessage};

    let messages = vec![
        ConversationMessage::System(system.to_string()),
        ConversationMessage::User(user_msg.to_string()),
    ];

    let turn = complete_turn(provider, api_key, model, &messages, &[], base_url).await?;
    Ok(turn.content)
}

// ---------------------------------------------------------------------------
// Core: critique_response
// ---------------------------------------------------------------------------

pub async fn critique_response(
    user_request: &str,
    blade_response: &str,
) -> Result<CritiqueResult, String> {
    let cfg = crate::config::load_config();
    let provider = &cfg.provider;
    let api_key = &cfg.api_key;
    let model = cheap_model_for_provider(provider);
    let base_url = cfg.base_url.as_deref();

    let system = "You are a brutal, honest critic evaluating an AI assistant's response. \
                  Your job is to find every flaw without mercy. Soft critiques help no one.";

    let user_msg = format!(
        r#"You are a brutal, honest critic evaluating an AI assistant's response.

User asked: {user_request}

AI responded: {blade_response}

Score this response on these axes (be harsh):
1. Directness: did it actually answer what was asked, or hedge/deflect?
2. Completeness: did it cover the full request or leave things out?
3. Accuracy: is anything wrong or oversimplified?
4. Conciseness: is it bloated with filler, preamble, or unnecessary caveats?
5. Actionability: can the user immediately act on this, or is it vague?

Overall score: X/10 (7+ = acceptable, <7 = rebuild needed)

Respond ONLY as JSON:
{{"score": N, "problems": ["problem1", "problem2"], "verdict": "one sentence", "should_rebuild": true/false}}"#
    );

    let raw = llm_call(provider, api_key, model, base_url, system, &user_msg).await?;

    // Strip markdown fences if the model wraps output in ```json ... ```
    let json_str = extract_json(&raw);

    match serde_json::from_str::<serde_json::Value>(json_str) {
        Ok(v) => {
            let score = v["score"].as_i64().unwrap_or(8) as i32;
            let problems: Vec<String> = v["problems"]
                .as_array()
                .map(|arr| {
                    arr.iter()
                        .filter_map(|p| p.as_str().map(String::from))
                        .collect()
                })
                .unwrap_or_default();
            let verdict = v["verdict"]
                .as_str()
                .unwrap_or("No verdict provided.")
                .to_string();
            let should_rebuild = score < 7;

            Ok(CritiqueResult {
                score,
                problems,
                verdict,
                should_rebuild,
            })
        }
        Err(_) => {
            // Parse failed — don't rebuild on ambiguity, default to passing score
            Ok(CritiqueResult {
                score: 8,
                problems: vec![],
                verdict: "Critique parse failed; defaulting to acceptable.".to_string(),
                should_rebuild: false,
            })
        }
    }
}

// ---------------------------------------------------------------------------
// Core: rebuild_response
// ---------------------------------------------------------------------------

pub async fn rebuild_response(
    user_request: &str,
    original: &str,
    critique: &CritiqueResult,
) -> Result<String, String> {
    let cfg = crate::config::load_config();
    let provider = &cfg.provider;
    let api_key = &cfg.api_key;
    let model = &cfg.model; // Quality matters for rebuild — use the configured model
    let base_url = cfg.base_url.as_deref();

    let problems_text = if critique.problems.is_empty() {
        "No specific problems listed, but overall quality was poor.".to_string()
    } else {
        critique.problems.join("\n")
    };

    let system = "You are an expert AI assistant. You are given a flawed response and must \
                  produce a significantly better version that directly fixes every identified problem. \
                  Be direct, complete, accurate, concise, and immediately actionable.";

    let user_msg = format!(
        r#"Your previous response had these problems:
{problems_text}

Verdict: {verdict}

User's original request: {user_request}

Your flawed response:
{original}

Now write a BETTER response that fixes all the problems. Don't mention the critique process.
Just give the improved answer directly."#,
        verdict = critique.verdict
    );

    llm_call(provider, api_key, model, base_url, system, &user_msg).await
}

// ---------------------------------------------------------------------------
// Core: roast_and_rebuild — the full cycle
// ---------------------------------------------------------------------------

pub async fn roast_and_rebuild(
    user_request: &str,
    blade_response: &str,
) -> Result<RoastSession, String> {
    let _ = ensure_tables();

    let id = uuid::Uuid::new_v4().to_string();
    let created_at = chrono::Utc::now().timestamp_millis();

    // Step 1: Critique
    let critique = critique_response(user_request, blade_response).await?;

    // Step 2: Rebuild if score is too low
    let (rebuilt, improvement_summary) = if critique.should_rebuild {
        match rebuild_response(user_request, blade_response, &critique).await {
            Ok(better) => {
                let summary = format!(
                    "Rebuilt from score {}/10. Fixed: {}",
                    critique.score,
                    if critique.problems.is_empty() {
                        "general quality issues".to_string()
                    } else {
                        critique.problems.join(", ")
                    }
                );
                (Some(better), summary)
            }
            Err(e) => (None, format!("Rebuild failed: {}", e)),
        }
    } else {
        (None, format!("Score {}/10 — no rebuild needed.", critique.score))
    };

    let session = RoastSession {
        id,
        user_request: user_request.to_string(),
        original: blade_response.to_string(),
        critique,
        rebuilt,
        improvement_summary,
        created_at,
    };

    // Step 3: Persist
    let _ = save_session(&session);

    Ok(session)
}

// ---------------------------------------------------------------------------
// Lightweight entry point — called after every message
// ---------------------------------------------------------------------------

/// Called async in the background after every message. Only critiques responses
/// over 100 chars (skip trivial replies). Returns the rebuilt response if the
/// original scored below 7, otherwise returns None to keep the original.
pub async fn maybe_critique(
    user_request: &str,
    blade_response: &str,
) -> Option<String> {
    // Skip trivial responses
    if blade_response.len() <= 100 {
        return None;
    }

    let cfg = crate::config::load_config();
    let provider = &cfg.provider;
    let api_key = &cfg.api_key;
    let model = cheap_model_for_provider(provider);
    let base_url = cfg.base_url.as_deref();

    let system = "You are a brutal, honest critic evaluating an AI assistant's response. \
                  Your job is to find every flaw without mercy.";

    let user_msg = format!(
        r#"You are a brutal, honest critic evaluating an AI assistant's response.

User asked: {user_request}

AI responded: {blade_response}

Score this response on these axes (be harsh):
1. Directness: did it actually answer what was asked, or hedge/deflect?
2. Completeness: did it cover the full request or leave things out?
3. Accuracy: is anything wrong or oversimplified?
4. Conciseness: is it bloated with filler, preamble, or unnecessary caveats?
5. Actionability: can the user immediately act on this, or is it vague?

Overall score: X/10 (7+ = acceptable, <7 = rebuild needed)

Respond ONLY as JSON:
{{"score": N, "problems": ["problem1", "problem2"], "verdict": "one sentence", "should_rebuild": true/false}}"#
    );

    use crate::providers::{complete_turn, ConversationMessage};

    let messages = vec![
        ConversationMessage::System(system.to_string()),
        ConversationMessage::User(user_msg.clone()),
    ];

    let raw = match complete_turn(provider, api_key, model, &messages, &[], base_url).await {
        Ok(t) => t.content,
        Err(_) => return None,
    };

    let json_str = extract_json(&raw);
    let score = serde_json::from_str::<serde_json::Value>(json_str)
        .ok()
        .and_then(|v| v["score"].as_i64())
        .unwrap_or(8) as i32;

    if score < 7 {
        // Full roast in background to persist, but also return the rebuilt response
        match roast_and_rebuild(user_request, blade_response).await {
            Ok(session) => session.rebuilt,
            Err(_) => None,
        }
    } else {
        // Score is fine — persist a lightweight record and return None
        let _ = ensure_tables();
        let critique = CritiqueResult {
            score,
            problems: vec![],
            verdict: format!("Score {}/10 — acceptable.", score),
            should_rebuild: false,
        };
        let session = RoastSession {
            id: uuid::Uuid::new_v4().to_string(),
            user_request: user_request.to_string(),
            original: blade_response.to_string(),
            critique,
            rebuilt: None,
            improvement_summary: format!("Score {}/10 — no rebuild needed.", score),
            created_at: chrono::Utc::now().timestamp_millis(),
        };
        let _ = save_session(&session);
        None
    }
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

pub fn load_critique_history(limit: usize) -> Vec<RoastSession> {
    let conn = match rusqlite::Connection::open(db_path()) {
        Ok(c) => c,
        Err(_) => return vec![],
    };

    let sql = format!(
        "SELECT id, user_request, original_response, critique, rebuilt_response, \
         improvement_summary, created_at \
         FROM self_critiques ORDER BY created_at DESC LIMIT {}",
        limit
    );

    let mut stmt = match conn.prepare(&sql) {
        Ok(s) => s,
        Err(_) => return vec![],
    };

    stmt.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, String>(3)?,
            row.get::<_, String>(4)?,
            row.get::<_, String>(5)?,
            row.get::<_, i64>(6)?,
        ))
    })
    .ok()
    .map(|rows| {
        rows.filter_map(|r| r.ok())
            .filter_map(|(id, user_request, original, critique_json, rebuilt_str, improvement_summary, created_at)| {
                let critique: CritiqueResult = serde_json::from_str(&critique_json).ok()?;
                let rebuilt = if rebuilt_str.is_empty() {
                    None
                } else {
                    Some(rebuilt_str)
                };
                Some(RoastSession {
                    id,
                    user_request,
                    original,
                    critique,
                    rebuilt,
                    improvement_summary,
                    created_at,
                })
            })
            .collect()
    })
    .unwrap_or_default()
}

// ---------------------------------------------------------------------------
// Weekly meta-critique — patterns become permanent preferences
// ---------------------------------------------------------------------------

pub async fn weekly_meta_critique() -> Result<String, String> {
    let history = load_critique_history(50);

    if history.is_empty() {
        return Ok("No critique history to reflect on yet.".to_string());
    }

    // Build a compact summary of recent failures
    let failures: Vec<String> = history
        .iter()
        .filter(|s| s.critique.score < 7)
        .map(|s| {
            format!(
                "Score {}/10 | Request: {} | Problems: {}",
                s.critique.score,
                &s.user_request.chars().take(80).collect::<String>(),
                s.critique.problems.join("; ")
            )
        })
        .collect();

    let all_verdicts: Vec<String> = history
        .iter()
        .map(|s| format!("[{}] {}", s.critique.score, s.critique.verdict))
        .collect();

    let cfg = crate::config::load_config();
    let provider = &cfg.provider;
    let api_key = &cfg.api_key;
    let model = &cfg.model;
    let base_url = cfg.base_url.as_deref();

    let system = "You are a meta-analyst reviewing an AI assistant's failure patterns. \
                  Your job is to identify systematic weaknesses and prescribe concrete, \
                  actionable improvements that the assistant should permanently adopt.";

    let user_msg = format!(
        r#"Here are BLADE's recent critique scores and verdicts:

All recent verdicts (score / assessment):
{}

Specific failure sessions (score < 7):
{}

Based on these patterns:
1. What systematic mistakes does BLADE keep making?
2. What concrete rules should BLADE permanently follow to avoid these patterns?
3. State each rule as a clear, actionable preference (e.g., "Always X when Y", "Never Z").

Respond with a numbered list of 3-7 concrete rules BLADE should internalize."#,
        all_verdicts.join("\n"),
        if failures.is_empty() {
            "No failures this period — all responses scored 7+.".to_string()
        } else {
            failures.join("\n")
        }
    );

    let insight = llm_call(provider, api_key, model, base_url, system, &user_msg).await?;

    // Save insight as a brain preference
    let conn = rusqlite::Connection::open(db_path())
        .map_err(|e| format!("DB open error: {}", e))?;

    let pref_id = format!("meta_critique_{}", chrono::Utc::now().timestamp());
    crate::db::brain_upsert_preference(
        &conn,
        &pref_id,
        &format!("Meta-critique insight ({}): {}", chrono::Utc::now().format("%Y-%m-%d"), insight),
        0.9,
        "self_critique_meta",
    )?;

    Ok(insight)
}

// ---------------------------------------------------------------------------
// Deep roast — multi-round, explicitly user-triggered
// ---------------------------------------------------------------------------

pub async fn deep_roast(
    user_request: &str,
    blade_response: &str,
) -> Result<String, String> {
    // Round 1: Critique the original
    let critique1 = critique_response(user_request, blade_response).await?;

    // Round 2: Rebuild regardless (deep roast always improves)
    let rebuilt = rebuild_response(user_request, blade_response, &critique1).await?;

    // Round 3: Critique the rebuild
    let critique2 = critique_response(user_request, &rebuilt).await?;

    // Round 4: Final polish if round 3 still scores below 8
    let final_response = if critique2.score < 8 {
        match rebuild_response(user_request, &rebuilt, &critique2).await {
            Ok(polished) => polished,
            Err(_) => rebuilt, // Fall back to round-2 result if polish fails
        }
    } else {
        rebuilt
    };

    // Persist the full deep roast session
    let _ = ensure_tables();
    let session = RoastSession {
        id: uuid::Uuid::new_v4().to_string(),
        user_request: user_request.to_string(),
        original: blade_response.to_string(),
        critique: critique1,
        rebuilt: Some(final_response.clone()),
        improvement_summary: format!(
            "Deep roast: {} rounds. Final score estimate: {}/10.",
            if critique2.score < 8 { 4 } else { 3 },
            critique2.score
        ),
        created_at: chrono::Utc::now().timestamp_millis(),
    };
    let _ = save_session(&session);

    Ok(final_response)
}

// ---------------------------------------------------------------------------
// Utility: strip markdown fences from LLM JSON output
// ---------------------------------------------------------------------------

fn extract_json(raw: &str) -> &str {
    let trimmed = raw.trim();

    // Handle ```json ... ``` and ``` ... ```
    if let Some(inner) = trimmed
        .strip_prefix("```json")
        .or_else(|| trimmed.strip_prefix("```"))
    {
        if let Some(end) = inner.rfind("```") {
            return inner[..end].trim();
        }
    }

    trimmed
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

/// Full roast-and-rebuild cycle, explicitly triggered by the user.
#[tauri::command]
pub async fn self_critique_response(
    user_request: String,
    blade_response: String,
) -> Result<RoastSession, String> {
    roast_and_rebuild(&user_request, &blade_response).await
}

/// Returns recent critique sessions.
#[tauri::command]
pub fn self_critique_history(limit: Option<usize>) -> Vec<RoastSession> {
    let _ = ensure_tables();
    load_critique_history(limit.unwrap_or(20))
}

/// Multi-round deep roast for explicit user-triggered self-improvement.
#[tauri::command]
pub async fn self_critique_deep_roast(
    user_request: String,
    blade_response: String,
) -> Result<String, String> {
    deep_roast(&user_request, &blade_response).await
}

/// Trigger the weekly meta-critique manually.
#[tauri::command]
pub async fn self_critique_weekly_meta() -> Result<String, String> {
    weekly_meta_critique().await
}
