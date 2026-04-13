// goal_engine.rs
// Autonomous AGI goal pursuit. Goals never fail — they change strategy.
// Runs in background. Decomposes goals → executes subtasks → verifies → repeats.

use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::Emitter;

static ENGINE_RUNNING: AtomicBool = AtomicBool::new(false);

// ── Helpers ───────────────────────────────────────────────────────────────────

fn now_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

// ── Structs ───────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GoalSubtask {
    pub id: String,
    pub description: String,
    pub status: String, // "pending" | "done" | "retrying"
    pub attempts: i32,
    pub last_error: String,
    pub result: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Goal {
    pub id: String,
    pub title: String,
    pub description: String,
    pub priority: i32,
    pub status: String, // "active" | "in_progress" | "blocked" | "completed" — NEVER "failed"
    pub strategy: String,
    pub attempts: i32,
    pub last_error: String,
    pub subtasks: Vec<GoalSubtask>,
    pub tags: Vec<String>,
    pub result: String,
    pub created_at: i64,
    pub last_attempted_at: Option<i64>,
    pub completed_at: Option<i64>,
}

// ── Event payloads ────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
struct GoalProgressPayload {
    id: String,
    title: String,
    status: String,
    attempts: i32,
    subtasks_done: usize,
    subtasks_total: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct GoalSubtaskUpdatePayload {
    goal_id: String,
    subtask_description: String,
    result: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct GoalCompletedPayload {
    id: String,
    title: String,
    result: String,
}

// ── Database ──────────────────────────────────────────────────────────────────

pub fn open_goals_db() -> Result<rusqlite::Connection, String> {
    let db_path = crate::config::blade_config_dir().join("blade.db");
    let conn = rusqlite::Connection::open(&db_path)
        .map_err(|e| format!("Failed to open goals DB: {}", e))?;
    ensure_tables(&conn);
    Ok(conn)
}

fn ensure_tables(conn: &rusqlite::Connection) {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS goals (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            description TEXT NOT NULL,
            priority INTEGER DEFAULT 5,
            status TEXT DEFAULT 'active',
            strategy TEXT DEFAULT '',
            attempts INTEGER DEFAULT 0,
            last_error TEXT DEFAULT '',
            subtasks_json TEXT DEFAULT '[]',
            tags_json TEXT DEFAULT '[]',
            result TEXT DEFAULT '',
            created_at INTEGER NOT NULL,
            last_attempted_at INTEGER,
            completed_at INTEGER
        );"
    ).ok();
}

fn row_to_goal(row: &rusqlite::Row) -> rusqlite::Result<Goal> {
    let subtasks_json: String = row.get(8)?;
    let tags_json: String = row.get(9)?;

    let subtasks: Vec<GoalSubtask> =
        serde_json::from_str(&subtasks_json).unwrap_or_default();
    let tags: Vec<String> =
        serde_json::from_str(&tags_json).unwrap_or_default();

    Ok(Goal {
        id: row.get(0)?,
        title: row.get(1)?,
        description: row.get(2)?,
        priority: row.get(3)?,
        status: row.get(4)?,
        strategy: row.get(5)?,
        attempts: row.get(6)?,
        last_error: row.get(7)?,
        subtasks,
        tags,
        result: row.get(10)?,
        created_at: row.get(11)?,
        last_attempted_at: row.get(12)?,
        completed_at: row.get(13)?,
    })
}

pub fn get_active_goals() -> Vec<Goal> {
    let conn = match open_goals_db() {
        Ok(c) => c,
        Err(_) => return Vec::new(),
    };

    let mut stmt = match conn.prepare(
        "SELECT id, title, description, priority, status, strategy, attempts,
                last_error, subtasks_json, tags_json, result, created_at,
                last_attempted_at, completed_at
         FROM goals
         WHERE status IN ('active', 'in_progress', 'blocked')
         ORDER BY priority DESC, created_at DESC",
    ) {
        Ok(s) => s,
        Err(_) => return Vec::new(),
    };

    stmt.query_map([], row_to_goal)
        .map(|rows| rows.filter_map(|r| r.ok()).collect())
        .unwrap_or_default()
}

pub fn save_goal(goal: &Goal) {
    let conn = match open_goals_db() {
        Ok(c) => c,
        Err(e) => {
            eprintln!("[goal_engine] save_goal error: {}", e);
            return;
        }
    };

    let subtasks_json = serde_json::to_string(&goal.subtasks).unwrap_or_else(|_| "[]".into());
    let tags_json = serde_json::to_string(&goal.tags).unwrap_or_else(|_| "[]".into());

    conn.execute(
        "INSERT INTO goals
            (id, title, description, priority, status, strategy, attempts,
             last_error, subtasks_json, tags_json, result, created_at,
             last_attempted_at, completed_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14)
         ON CONFLICT(id) DO UPDATE SET
            title            = excluded.title,
            description      = excluded.description,
            priority         = excluded.priority,
            status           = excluded.status,
            strategy         = excluded.strategy,
            attempts         = excluded.attempts,
            last_error       = excluded.last_error,
            subtasks_json    = excluded.subtasks_json,
            tags_json        = excluded.tags_json,
            result           = excluded.result,
            last_attempted_at = excluded.last_attempted_at,
            completed_at     = excluded.completed_at",
        rusqlite::params![
            goal.id,
            goal.title,
            goal.description,
            goal.priority,
            goal.status,
            goal.strategy,
            goal.attempts,
            goal.last_error,
            subtasks_json,
            tags_json,
            goal.result,
            goal.created_at,
            goal.last_attempted_at,
            goal.completed_at,
        ],
    )
    .ok();
}

pub fn load_goal(id: &str) -> Option<Goal> {
    let conn = open_goals_db().ok()?;
    let mut stmt = conn
        .prepare(
            "SELECT id, title, description, priority, status, strategy, attempts,
                    last_error, subtasks_json, tags_json, result, created_at,
                    last_attempted_at, completed_at
             FROM goals WHERE id = ?1",
        )
        .ok()?;

    stmt.query_row(rusqlite::params![id], row_to_goal).ok()
}

// ── Provider helpers ──────────────────────────────────────────────────────────

/// Pick the cheapest fast model for a given provider.
fn cheap_model(provider: &str) -> &'static str {
    match provider {
        "anthropic" => "claude-haiku-4-5-20251001",
        "openai" => "gpt-4o-mini",
        "gemini" => "gemini-2.0-flash",
        "groq" => "llama-3.1-8b-instant",
        "openrouter" => "google/gemini-2.0-flash-lite",
        _ => "gemini-2.0-flash",
    }
}

/// Call the LLM with a single user message and return the text response.
async fn llm_call(prompt: &str, config: &crate::config::BladeConfig) -> Result<String, String> {
    use crate::providers::{complete_turn, ConversationMessage};

    let model = cheap_model(&config.provider);
    let messages = vec![ConversationMessage::User(prompt.to_string())];

    let turn = complete_turn(
        &config.provider,
        &config.api_key,
        model,
        &messages,
        &[],
        config.base_url.as_deref(),
    )
    .await?;

    Ok(turn.content)
}

// ── Core async functions ──────────────────────────────────────────────────────

async fn decompose_goal(
    goal: &Goal,
    config: &crate::config::BladeConfig,
) -> Vec<GoalSubtask> {
    let prompt = format!(
        "You are planning how to accomplish this goal autonomously using available tools \
(bash, web search, file read/write, AI calls).\n\n\
Goal: {}\nDescription: {}\n\n\
Break this into 3-7 concrete subtasks. Each subtask must be specific and executable.\n\n\
Respond ONLY with a JSON array:\n\
[{{\"id\": \"1\", \"description\": \"...\", \"status\": \"pending\", \"attempts\": 0, \"last_error\": \"\", \"result\": \"\"}}]",
        goal.title, goal.description
    );

    match llm_call(&prompt, config).await {
        Ok(text) => {
            // Extract JSON array from the response (LLMs sometimes wrap it in ```json blocks)
            let cleaned = extract_json_array(&text);
            match serde_json::from_str::<Vec<GoalSubtask>>(&cleaned) {
                Ok(mut tasks) => {
                    // Ensure each subtask has a unique id
                    for (i, t) in tasks.iter_mut().enumerate() {
                        if t.id.is_empty() {
                            t.id = (i + 1).to_string();
                        }
                        t.status = "pending".to_string();
                    }
                    tasks
                }
                Err(e) => {
                    eprintln!("[goal_engine] decompose parse error: {} — raw: {}", e, cleaned);
                    fallback_subtask(goal)
                }
            }
        }
        Err(e) => {
            eprintln!("[goal_engine] decompose LLM error: {}", e);
            fallback_subtask(goal)
        }
    }
}

fn fallback_subtask(goal: &Goal) -> Vec<GoalSubtask> {
    vec![GoalSubtask {
        id: "1".to_string(),
        description: goal.description.clone(),
        status: "pending".to_string(),
        attempts: 0,
        last_error: String::new(),
        result: String::new(),
    }]
}

fn extract_json_array(text: &str) -> String {
    // Strip ```json ... ``` fences if present
    let trimmed = text.trim();
    if let Some(start) = trimmed.find('[') {
        if let Some(end) = trimmed.rfind(']') {
            if end >= start {
                return trimmed[start..=end].to_string();
            }
        }
    }
    trimmed.to_string()
}

/// Build a summary of all completed subtask results for context.
fn build_prior_results_context(goal: &Goal) -> String {
    let done: Vec<String> = goal
        .subtasks
        .iter()
        .filter(|s| s.status == "done" && !s.result.is_empty())
        .map(|s| format!("- [{}]: {}", s.description, s.result))
        .collect();

    if done.is_empty() {
        String::new()
    } else {
        format!("\n\nPrevious subtask results:\n{}", done.join("\n"))
    }
}

async fn execute_subtask(
    goal: &mut Goal,
    subtask_idx: usize,
    config: &crate::config::BladeConfig,
    app: &tauri::AppHandle,
) -> bool {
    let subtask_desc = goal.subtasks[subtask_idx].description.clone();
    let last_err = goal.subtasks[subtask_idx].last_error.clone();
    let prior_ctx = build_prior_results_context(goal);

    let retry_hint = if !last_err.is_empty() {
        format!("\n\nPrevious attempt failed with error: {}\nTry a different approach.", last_err)
    } else {
        String::new()
    };

    let prompt = format!(
        "You are an autonomous AI agent executing a subtask as part of a larger goal.\n\n\
Goal: {} — {}\n{}\n\n\
Current subtask: {}{}\n\n\
Execute this subtask. You have access to tools:\n\
- Shell commands: respond with ACTION:bash:your_command_here\n\
- Web search: respond with ACTION:search:your_query_here\n\
- Direct answer/computation: respond with ACTION:answer:your_result_here\n\n\
Pick the most appropriate action and respond with EXACTLY ONE line starting with ACTION:.",
        goal.title, goal.description, prior_ctx, subtask_desc, retry_hint
    );

    let response = match llm_call(&prompt, config).await {
        Ok(r) => r,
        Err(e) => {
            let idx = subtask_idx;
            goal.subtasks[idx].attempts += 1;
            goal.subtasks[idx].last_error = format!("LLM call failed: {}", e);
            goal.subtasks[idx].status = "retrying".to_string();
            return false;
        }
    };

    // Find the ACTION line
    let action_line = response
        .lines()
        .find(|l| l.trim_start().starts_with("ACTION:"))
        .unwrap_or(response.lines().next().unwrap_or(""))
        .trim()
        .to_string();

    let (output, is_error) = dispatch_action(&action_line, config).await;

    let idx = subtask_idx;
    if is_error {
        goal.subtasks[idx].attempts += 1;
        goal.subtasks[idx].last_error = output.clone();
        goal.subtasks[idx].status = "retrying".to_string();

        let _ = app.emit(
            "goal_subtask_update",
            GoalSubtaskUpdatePayload {
                goal_id: goal.id.clone(),
                subtask_description: subtask_desc,
                result: format!("ERROR: {}", output),
            },
        );

        false
    } else {
        goal.subtasks[idx].status = "done".to_string();
        goal.subtasks[idx].result = output.clone();
        goal.subtasks[idx].last_error = String::new();

        let _ = app.emit(
            "goal_subtask_update",
            GoalSubtaskUpdatePayload {
                goal_id: goal.id.clone(),
                subtask_description: subtask_desc,
                result: output,
            },
        );

        true
    }
}

/// Dispatch an ACTION line to the appropriate tool and return (output, is_error).
async fn dispatch_action(
    action_line: &str,
    config: &crate::config::BladeConfig,
) -> (String, bool) {
    // Strip leading "ACTION:" prefix
    let body = action_line
        .strip_prefix("ACTION:")
        .unwrap_or(action_line)
        .trim();

    if let Some(cmd) = body.strip_prefix("bash:") {
        // Execute shell command
        let result = run_bash(cmd.trim()).await;
        result
    } else if let Some(query) = body.strip_prefix("search:") {
        // Web search — fall back to curl/wget if no native search
        web_search(query.trim(), config).await
    } else if let Some(answer) = body.strip_prefix("answer:") {
        (answer.trim().to_string(), false)
    } else {
        // Treat unrecognized action as a bash command (best-effort)
        if !body.is_empty() {
            run_bash(body).await
        } else {
            (format!("Could not parse action from: {}", action_line), true)
        }
    }
}

async fn run_bash(cmd: &str) -> (String, bool) {
    // Use the native_tools bash implementation via the same approach
    let home = dirs::home_dir().unwrap_or_default();
    let home_str = home.to_string_lossy().to_string();
    let cwd = home_str.as_str();

    // Inline a simple bash execution to avoid visibility issues with native_tools::bash (private fn)
    #[cfg(target_os = "windows")]
    let spawn_result = {
        #[allow(unused_imports)]
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        tokio::process::Command::new("cmd")
            .args(["/C", cmd])
            .current_dir(cwd)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
    };

    #[cfg(not(target_os = "windows"))]
    let spawn_result = tokio::process::Command::new("sh")
        .args(["-c", cmd])
        .current_dir(cwd)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn();

    let child = match spawn_result {
        Ok(c) => c,
        Err(e) => return (format!("Failed to spawn: {}", e), true),
    };

    match tokio::time::timeout(
        Duration::from_millis(30_000),
        child.wait_with_output(),
    )
    .await
    {
        Ok(Ok(output)) => {
            let stdout = String::from_utf8_lossy(&output.stdout).into_owned();
            let stderr = String::from_utf8_lossy(&output.stderr).into_owned();
            let is_error = !output.status.success();
            let combined = if stderr.is_empty() {
                stdout
            } else if stdout.is_empty() {
                stderr
            } else {
                format!("{}\n{}", stdout, stderr)
            };
            let truncated = if combined.len() > 8000 {
                format!("{}...[truncated]", &combined[..8000])
            } else {
                combined
            };
            (truncated, is_error)
        }
        Ok(Err(e)) => (format!("Process error: {}", e), true),
        Err(_) => ("Command timed out after 30 seconds".to_string(), true),
    }
}

async fn web_search(query: &str, _config: &crate::config::BladeConfig) -> (String, bool) {
    // Use curl to DuckDuckGo HTML as a lightweight fallback search
    let encoded = query.replace(' ', "+");
    let url = format!("https://html.duckduckgo.com/html/?q={}", encoded);
    let cmd = format!(
        "curl -sL --max-time 15 -A 'Mozilla/5.0' '{}'",
        url
    );
    let (raw, is_err) = run_bash(&cmd).await;
    if is_err {
        return (raw, true);
    }
    // Strip HTML tags for readable output
    let text = strip_html_tags(&raw);
    let trimmed = if text.len() > 4000 {
        format!("{}...[truncated]", &text[..4000])
    } else {
        text
    };
    (trimmed, false)
}

fn strip_html_tags(html: &str) -> String {
    let mut out = String::with_capacity(html.len());
    let mut in_tag = false;
    for ch in html.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => in_tag = false,
            c if !in_tag => out.push(c),
            _ => {}
        }
    }
    // Collapse multiple whitespace
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

async fn attempt_strategy_change(
    goal: &mut Goal,
    subtask_idx: usize,
    config: &crate::config::BladeConfig,
) {
    let subtask_desc = goal.subtasks[subtask_idx].description.clone();
    let last_err = goal.subtasks[subtask_idx].last_error.clone();
    let prior_ctx = build_prior_results_context(goal);

    let prompt = format!(
        "An autonomous AI agent is stuck on a subtask and needs a completely different approach.\n\n\
Goal: {} — {}\n{}\n\n\
Stuck subtask: {}\nRepeated error: {}\n\n\
Suggest a COMPLETELY DIFFERENT approach to accomplish the same objective. \
Be creative — try a different tool, method, or decomposition.\n\n\
Respond with just the new subtask description (one sentence, action-oriented).",
        goal.title, goal.description, prior_ctx, subtask_desc, last_err
    );

    match llm_call(&prompt, config).await {
        Ok(new_approach) => {
            let new_desc = new_approach.trim().to_string();
            eprintln!(
                "[goal_engine] Strategy change for subtask '{}' → '{}'",
                subtask_desc, new_desc
            );
            goal.subtasks[subtask_idx].description = new_desc;
            goal.subtasks[subtask_idx].status = "pending".to_string();
            goal.subtasks[subtask_idx].attempts = 0;
            goal.subtasks[subtask_idx].last_error = String::new();
        }
        Err(e) => {
            eprintln!("[goal_engine] Strategy change LLM error: {}", e);
            // Even if LLM fails, reset and try the original again
            goal.subtasks[subtask_idx].status = "pending".to_string();
            goal.subtasks[subtask_idx].attempts = 0;
        }
    }
}

async fn verify_goal_completion(
    goal: &mut Goal,
    config: &crate::config::BladeConfig,
    app: &tauri::AppHandle,
) {
    let results_summary: Vec<String> = goal
        .subtasks
        .iter()
        .map(|s| format!("- {}: {}", s.description, s.result))
        .collect();

    let prompt = format!(
        "An autonomous AI agent completed all subtasks for a goal. \
Evaluate whether the goal is truly achieved.\n\n\
Goal: {}\nDescription: {}\n\n\
Subtask results:\n{}\n\n\
Is the goal fully achieved? Respond with YES or NO followed by brief reasoning.\n\
If NO, list what is still missing (be specific).",
        goal.title,
        goal.description,
        results_summary.join("\n")
    );

    match llm_call(&prompt, config).await {
        Ok(verdict) => {
            let verdict_upper = verdict.trim().to_uppercase();
            if verdict_upper.starts_with("YES") {
                // Goal truly complete
                goal.status = "completed".to_string();
                goal.completed_at = Some(now_secs());
                goal.result = goal
                    .subtasks
                    .iter()
                    .filter(|s| !s.result.is_empty())
                    .map(|s| s.result.clone())
                    .collect::<Vec<_>>()
                    .join("\n");

                let _ = app.emit(
                    "goal_completed",
                    GoalCompletedPayload {
                        id: goal.id.clone(),
                        title: goal.title.clone(),
                        result: goal.result.clone(),
                    },
                );

                eprintln!("[goal_engine] Goal '{}' COMPLETED.", goal.title);
            } else {
                // Not done — extract missing pieces and add more subtasks
                eprintln!(
                    "[goal_engine] Goal '{}' not yet complete. Adding gap subtasks.",
                    goal.title
                );
                add_gap_subtasks(goal, &verdict, config).await;
            }
        }
        Err(e) => {
            eprintln!("[goal_engine] verify_goal_completion LLM error: {}", e);
            // Be optimistic — if we can't verify, add a catch-all check subtask
            let check_subtask = GoalSubtask {
                id: uuid::Uuid::new_v4().to_string(),
                description: format!(
                    "Verify and confirm that the goal '{}' is fully accomplished",
                    goal.title
                ),
                status: "pending".to_string(),
                attempts: 0,
                last_error: String::new(),
                result: String::new(),
            };
            goal.subtasks.push(check_subtask);
        }
    }
}

async fn add_gap_subtasks(
    goal: &mut Goal,
    verdict: &str,
    config: &crate::config::BladeConfig,
) {
    let existing_descs: Vec<String> = goal.subtasks.iter().map(|s| s.description.clone()).collect();
    let prior_ctx = build_prior_results_context(goal);

    let prompt = format!(
        "A goal is not yet complete. Based on what's missing, generate 1-3 new subtasks to close the gap.\n\n\
Goal: {} — {}\n{}\n\nVerification result: {}\nExisting subtasks: {}\n\n\
Respond ONLY with a JSON array of new subtasks:\n\
[{{\"id\": \"gap1\", \"description\": \"...\", \"status\": \"pending\", \"attempts\": 0, \"last_error\": \"\", \"result\": \"\"}}]",
        goal.title,
        goal.description,
        prior_ctx,
        verdict,
        existing_descs.join("; ")
    );

    match llm_call(&prompt, config).await {
        Ok(text) => {
            let cleaned = extract_json_array(&text);
            match serde_json::from_str::<Vec<GoalSubtask>>(&cleaned) {
                Ok(mut new_tasks) => {
                    for t in &mut new_tasks {
                        t.id = uuid::Uuid::new_v4().to_string();
                        t.status = "pending".to_string();
                    }
                    eprintln!(
                        "[goal_engine] Added {} gap subtask(s) to goal '{}'",
                        new_tasks.len(),
                        goal.title
                    );
                    goal.subtasks.extend(new_tasks);
                }
                Err(e) => {
                    eprintln!("[goal_engine] gap subtask parse error: {}", e);
                    // Fallback: add a generic gap-closing subtask
                    goal.subtasks.push(GoalSubtask {
                        id: uuid::Uuid::new_v4().to_string(),
                        description: format!(
                            "Address remaining gaps: {}",
                            verdict.chars().take(200).collect::<String>()
                        ),
                        status: "pending".to_string(),
                        attempts: 0,
                        last_error: String::new(),
                        result: String::new(),
                    });
                }
            }
        }
        Err(e) => {
            eprintln!("[goal_engine] add_gap_subtasks LLM error: {}", e);
            goal.subtasks.push(GoalSubtask {
                id: uuid::Uuid::new_v4().to_string(),
                description: "Re-evaluate and complete any remaining parts of the goal".to_string(),
                status: "pending".to_string(),
                attempts: 0,
                last_error: String::new(),
                result: String::new(),
            });
        }
    }
}

// ── Pursuit loop ──────────────────────────────────────────────────────────────

async fn pursuit_loop(app: tauri::AppHandle) {
    eprintln!("[goal_engine] Pursuit loop started.");

    loop {
        tokio::time::sleep(Duration::from_secs(45)).await;

        let config = crate::config::load_config();

        // Skip if no API key configured
        if config.api_key.is_empty() {
            continue;
        }

        let mut goals = get_active_goals();
        if goals.is_empty() {
            continue;
        }

        // Pick highest-priority active/in_progress goal first,
        // preferring in_progress over active (already started)
        goals.sort_by(|a, b| {
            let a_score = if a.status == "in_progress" { 1 } else { 0 };
            let b_score = if b.status == "in_progress" { 1 } else { 0 };
            b_score
                .cmp(&a_score)
                .then(b.priority.cmp(&a.priority))
                .then(b.created_at.cmp(&a.created_at))
        });

        let mut goal = goals.remove(0);

        // Decompose if we have no subtasks yet
        if goal.subtasks.is_empty() {
            eprintln!("[goal_engine] Decomposing goal: '{}'", goal.title);
            goal.subtasks = decompose_goal(&goal, &config).await;
            goal.status = "in_progress".to_string();
            save_goal(&goal);
        }

        // Find next pending/retrying subtask
        let next_idx = goal
            .subtasks
            .iter()
            .position(|s| s.status == "pending" || s.status == "retrying");

        if let Some(idx) = next_idx {
            eprintln!(
                "[goal_engine] Executing subtask {}/{}: '{}'",
                idx + 1,
                goal.subtasks.len(),
                goal.subtasks[idx].description
            );

            let success = execute_subtask(&mut goal, idx, &config, &app).await;

            if !success && goal.subtasks[idx].attempts >= 3 {
                eprintln!(
                    "[goal_engine] Subtask '{}' failed {} times — changing strategy.",
                    goal.subtasks[idx].description, goal.subtasks[idx].attempts
                );
                attempt_strategy_change(&mut goal, idx, &config).await;
            }

            goal.status = "in_progress".to_string();
            goal.attempts += 1;
            goal.last_attempted_at = Some(now_secs());
            save_goal(&goal);
        } else {
            // All subtasks are done — verify completion
            eprintln!(
                "[goal_engine] All subtasks done for '{}' — verifying...",
                goal.title
            );
            verify_goal_completion(&mut goal, &config, &app).await;
            goal.last_attempted_at = Some(now_secs());
            save_goal(&goal);
        }

        // Emit progress event
        let done_count = goal.subtasks.iter().filter(|s| s.status == "done").count();
        let total_count = goal.subtasks.len();
        let _ = app.emit(
            "goal_progress",
            GoalProgressPayload {
                id: goal.id.clone(),
                title: goal.title.clone(),
                status: goal.status.clone(),
                attempts: goal.attempts,
                subtasks_done: done_count,
                subtasks_total: total_count,
            },
        );
    }
}

// ── Public entrypoint ─────────────────────────────────────────────────────────

pub fn start_goal_engine(app: tauri::AppHandle) {
    if ENGINE_RUNNING.swap(true, Ordering::SeqCst) {
        // Already running — do not start a second loop
        return;
    }

    tauri::async_runtime::spawn(async move {
        pursuit_loop(app).await;
    });
}

// ── Tauri commands ────────────────────────────────────────────────────────────

#[tauri::command]
pub fn goal_add(
    title: String,
    description: String,
    priority: Option<i32>,
    tags: Option<Vec<String>>,
) -> Result<String, String> {
    let id = uuid::Uuid::new_v4().to_string();
    let goal = Goal {
        id: id.clone(),
        title,
        description,
        priority: priority.unwrap_or(5),
        status: "active".to_string(),
        strategy: String::new(),
        attempts: 0,
        last_error: String::new(),
        subtasks: Vec::new(),
        tags: tags.unwrap_or_default(),
        result: String::new(),
        created_at: now_secs(),
        last_attempted_at: None,
        completed_at: None,
    };

    save_goal(&goal);
    eprintln!("[goal_engine] Added goal '{}' (id={})", goal.title, id);
    Ok(id)
}

#[tauri::command]
pub fn goal_list() -> Vec<Goal> {
    let conn = match open_goals_db() {
        Ok(c) => c,
        Err(_) => return Vec::new(),
    };

    let mut stmt = match conn.prepare(
        "SELECT id, title, description, priority, status, strategy, attempts,
                last_error, subtasks_json, tags_json, result, created_at,
                last_attempted_at, completed_at
         FROM goals
         ORDER BY priority DESC, created_at DESC",
    ) {
        Ok(s) => s,
        Err(_) => return Vec::new(),
    };

    stmt.query_map([], row_to_goal)
        .map(|rows| rows.filter_map(|r| r.ok()).collect())
        .unwrap_or_default()
}

#[tauri::command]
pub fn goal_complete(id: String) -> Result<(), String> {
    let mut goal = load_goal(&id).ok_or_else(|| format!("Goal '{}' not found", id))?;
    goal.status = "completed".to_string();
    goal.completed_at = Some(now_secs());
    save_goal(&goal);
    eprintln!("[goal_engine] Goal '{}' manually marked completed.", id);
    Ok(())
}

#[tauri::command]
pub fn goal_delete(id: String) -> Result<(), String> {
    let conn = open_goals_db()?;
    conn.execute("DELETE FROM goals WHERE id = ?1", rusqlite::params![id])
        .map_err(|e| format!("Failed to delete goal: {}", e))?;
    eprintln!("[goal_engine] Goal '{}' deleted.", id);
    Ok(())
}

#[tauri::command]
pub fn goal_update_priority(id: String, priority: i32) -> Result<(), String> {
    let mut goal = load_goal(&id).ok_or_else(|| format!("Goal '{}' not found", id))?;
    goal.priority = priority;
    save_goal(&goal);
    Ok(())
}

#[tauri::command]
pub async fn goal_pursue_now(id: String, app: tauri::AppHandle) -> Result<String, String> {
    let mut goal = load_goal(&id).ok_or_else(|| format!("Goal '{}' not found", id))?;

    if goal.status == "completed" {
        return Ok("Goal is already completed.".to_string());
    }

    let config = crate::config::load_config();

    if config.api_key.is_empty() {
        return Err("No API key configured. Set up an AI provider in Settings.".to_string());
    }

    // Decompose if needed
    if goal.subtasks.is_empty() {
        goal.subtasks = decompose_goal(&goal, &config).await;
        goal.status = "in_progress".to_string();
        save_goal(&goal);
    }

    // Find next pending subtask
    let next_idx = goal
        .subtasks
        .iter()
        .position(|s| s.status == "pending" || s.status == "retrying");

    let status_msg = if let Some(idx) = next_idx {
        let success = execute_subtask(&mut goal, idx, &config, &app).await;

        if !success && goal.subtasks[idx].attempts >= 3 {
            attempt_strategy_change(&mut goal, idx, &config).await;
        }

        goal.status = "in_progress".to_string();
        goal.attempts += 1;
        goal.last_attempted_at = Some(now_secs());
        save_goal(&goal);

        let done = goal.subtasks.iter().filter(|s| s.status == "done").count();
        format!(
            "Executed subtask {}/{}: '{}'. Result: {}",
            done,
            goal.subtasks.len(),
            goal.subtasks[idx].description,
            if success { "success" } else { "retrying" }
        )
    } else {
        // All subtasks done — verify
        verify_goal_completion(&mut goal, &config, &app).await;
        goal.last_attempted_at = Some(now_secs());
        save_goal(&goal);
        format!("Verification complete. Goal status: {}", goal.status)
    };

    // Emit progress
    let done_count = goal.subtasks.iter().filter(|s| s.status == "done").count();
    let _ = app.emit(
        "goal_progress",
        GoalProgressPayload {
            id: goal.id.clone(),
            title: goal.title.clone(),
            status: goal.status.clone(),
            attempts: goal.attempts,
            subtasks_done: done_count,
            subtasks_total: goal.subtasks.len(),
        },
    );

    Ok(status_msg)
}
