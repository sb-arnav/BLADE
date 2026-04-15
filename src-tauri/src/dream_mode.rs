// dream_mode.rs
// When the user is away for 20+ minutes, BLADE enters Dream Mode — processing,
// consolidating, and preparing rather than sitting idle.
// Like a brain consolidating memories during sleep.

use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};
use tauri::Emitter;

// ── Static state ──────────────────────────────────────────────────────────────

static DREAM_MONITOR_RUNNING: AtomicBool = AtomicBool::new(false);
static DREAMING: AtomicBool = AtomicBool::new(false);
static LAST_ACTIVITY: AtomicI64 = AtomicI64::new(0);

/// Record that the user is active right now (call on every user interaction).
pub fn record_user_activity() {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;
    LAST_ACTIVITY.store(now, Ordering::Relaxed);
    // Also propagate into autonomous_research so it pauses during activity.
    crate::autonomous_research::LAST_ACTIVITY_TS.store(now, Ordering::Relaxed);
}

pub fn is_dreaming() -> bool {
    DREAMING.load(Ordering::Relaxed)
}

// ── Structs ───────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DreamSession {
    pub id: String,
    pub started_at: i64,
    pub ended_at: Option<i64>,
    pub tasks_completed: Vec<String>,
    pub insights: Vec<String>,
    pub status: String, // "dreaming" | "completed" | "interrupted"
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn now_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

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

fn cheap_model(provider: &str) -> String {
    crate::config::cheap_model_for_provider(provider, "")
}

// ── Dream tasks ───────────────────────────────────────────────────────────────

/// Task 1 — Memory consolidation.
async fn task_memory_consolidation() -> String {
    let _ = crate::character::consolidate_character().await;
    "Consolidated character bible".to_string()
}

/// Task 2 — Autonomous research.
async fn task_autonomous_research(app: &tauri::AppHandle) -> String {
    match crate::autonomous_research::research_next_gap(app).await {
        Some(topic) => format!("Researched: {}", topic),
        None => "No pending research gaps".to_string(),
    }
}

/// Task 3 — Goal strategy review.
async fn task_goal_strategy_review() -> String {
    let goals = crate::goal_engine::get_active_goals();
    let stalled: Vec<_> = goals
        .into_iter()
        .filter(|g| g.attempts > 5 && g.status != "completed")
        .take(3) // limit to avoid runaway LLM costs
        .collect();

    if stalled.is_empty() {
        return "No stalled goals to review".to_string();
    }

    let db_path = crate::config::blade_config_dir().join("blade.db");
    let mut reviewed = 0usize;

    for goal in &stalled {
        let system = "You are a strategic advisor helping an autonomous AI agent unstick stalled goals.";
        let user_msg = format!(
            "Here is a stalled goal: {}\n\
             The last strategies tried were: {}\n\
             Attempts so far: {}\n\
             What completely different approach should be tried next? \
             Be specific and actionable. 2-4 sentences.",
            goal.title, goal.strategy, goal.attempts
        );

        if let Ok(new_strategy) = llm_call(system, &user_msg).await {
            if let Ok(conn) = rusqlite::Connection::open(&db_path) {
                conn.execute(
                    "UPDATE goals SET strategy = ?1 WHERE id = ?2",
                    rusqlite::params![new_strategy, goal.id],
                )
                .ok();
                reviewed += 1;
            }
        }
    }

    format!("Reviewed {} stalled goals with fresh strategies", reviewed)
}

/// Task 4 — Skill synthesis.
async fn task_skill_synthesis(app: tauri::AppHandle) -> String {
    crate::skill_engine::maybe_synthesize_skills(app).await;
    "Reviewed skill patterns".to_string()
}

/// Task 5 — Code health scan.
async fn task_code_health_scan() -> String {
    // Find recently changed Rust and TypeScript files in the cwd.
    let cmd = r#"find . -maxdepth 6 \( -name "*.rs" -o -name "*.ts" -o -name "*.tsx" \) -newer . -not -path "*/node_modules/*" -not -path "*/target/*" 2>/dev/null | head -20"#;
    let files_raw = crate::native_tools::run_shell(cmd.to_string(), None)
        .await
        .unwrap_or_default();

    let files: Vec<&str> = files_raw.lines().filter(|l: &&str| !l.is_empty()).collect();
    if files.is_empty() {
        return "No recently changed files found for health scan".to_string();
    }

    let mut issues: Vec<String> = Vec::new();

    for file in files.iter().take(10) {
        let read_cmd = format!("cat {}", file);
        let contents = crate::native_tools::run_shell(read_cmd, None)
            .await
            .unwrap_or_default();

        // Check for common antipatterns
        if contents.contains(".unwrap()") && !contents.contains("// safe:") {
            let count = contents.matches(".unwrap()").count();
            if count > 3 {
                issues.push(format!("{}: {} bare .unwrap() calls", file, count));
            }
        }
        if contents.contains("TODO") && !contents.contains("TODO(") {
            issues.push(format!("{}: TODO without owner", file));
        }
        // Detect hardcoded credential patterns
        let lower = contents.to_lowercase();
        if (lower.contains("password") || lower.contains("api_key") || lower.contains("secret"))
            && (lower.contains("= \"") || lower.contains("= '"))
        {
            issues.push(format!("{}: possible hardcoded credential", file));
        }
    }

    if issues.is_empty() {
        format!("Scanned {} files — no obvious issues", files.len())
    } else {
        format!(
            "Code scan found {} issue(s): {}",
            issues.len(),
            issues.join("; ")
        )
    }
}

/// Task 6 — Pre-generate tomorrow's briefing context.
async fn task_prebuild_briefing(app: tauri::AppHandle) -> String {
    // Trigger pulse to pre-warm/cache the next briefing.
    // pulse::pulse_now is a tauri command, so we call the underlying async logic directly.
    // We call pulse_get_digest as a cheap pre-generate.
    let _ = app; // keep handle if needed for future direct calls
    let system = "You are BLADE's morning briefing generator.";
    let user_msg = "Generate a concise morning briefing template for tomorrow. \
                    Include: top focus areas, potential tasks, and one motivational thought. \
                    Keep it under 150 words.";

    match llm_call(system, user_msg).await {
        Ok(briefing) => {
            // Cache in DB settings
            let db_path = crate::config::blade_config_dir().join("blade.db");
            if let Ok(conn) = rusqlite::Connection::open(&db_path) {
                let now = now_secs().to_string();
                conn.execute(
                    "INSERT OR REPLACE INTO settings (key, value) VALUES ('dream_prebriefing', ?1)",
                    rusqlite::params![briefing],
                )
                .ok();
                conn.execute(
                    "INSERT OR REPLACE INTO settings (key, value) VALUES ('dream_prebriefing_at', ?1)",
                    rusqlite::params![now],
                )
                .ok();
            }
            "Pre-generated tomorrow's briefing".to_string()
        }
        Err(_) => "Briefing pre-generation skipped (LLM unavailable)".to_string(),
    }
}

/// Task 7 — Self-improvement: weekly meta-critique.
async fn task_weekly_meta_critique() -> String {
    // Only run if it's been ≥ 7 days since last meta-critique.
    let db_path = crate::config::blade_config_dir().join("blade.db");
    let last_run: i64 = if let Ok(conn) = rusqlite::Connection::open(&db_path) {
        conn.query_row(
            "SELECT value FROM settings WHERE key = 'dream_last_meta_critique'",
            [],
            |row| row.get::<_, String>(0),
        )
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(0)
    } else {
        0
    };

    let seven_days = 7 * 24 * 3600;
    if now_secs() - last_run < seven_days {
        return "Weekly meta-critique not due yet".to_string();
    }

    match crate::self_critique::weekly_meta_critique().await {
        Ok(summary) => {
            // Record the run time
            if let Ok(conn) = rusqlite::Connection::open(&db_path) {
                let now = now_secs().to_string();
                conn.execute(
                    "INSERT OR REPLACE INTO settings (key, value) VALUES ('dream_last_meta_critique', ?1)",
                    rusqlite::params![now],
                )
                .ok();
            }
            format!("Weekly meta-critique complete: {}", crate::safe_slice(&summary, 100))
        }
        Err(e) => format!("Meta-critique failed: {}", e),
    }
}

// ── Dream session runner ──────────────────────────────────────────────────────

pub async fn run_dream_session(app: tauri::AppHandle) -> DreamSession {
    let config = crate::config::load_config();
    if !config.background_ai_enabled {
        return DreamSession {
            id: uuid_v4(),
            started_at: now_secs(),
            ended_at: Some(now_secs()),
            tasks_completed: Vec::new(),
            insights: Vec::new(),
            status: "skipped".to_string(),
        };
    }

    let id = uuid_v4();
    let started_at = now_secs();
    let mut tasks_completed: Vec<String> = Vec::new();
    let mut insights: Vec<String> = Vec::new();

    // Helper: emit start/complete events and run with 2-min timeout
    macro_rules! run_task {
        ($name:expr, $fut:expr) => {{
            let task_name = $name;
            let _ = app.emit("dream_task_start", serde_json::json!({ "task": task_name }));
            let result: String =
                match tokio::time::timeout(tokio::time::Duration::from_secs(120), $fut).await {
                    Ok(insight) => insight,
                    Err(_) => format!("{} timed out", task_name),
                };
            let _ = app.emit(
                "dream_task_complete",
                serde_json::json!({ "task": task_name, "insight": result }),
            );
            tasks_completed.push(task_name.to_string());
            insights.push(result);

            // Bail early if user became active during a task
            if !DREAMING.load(Ordering::Relaxed) {
                return DreamSession {
                    id,
                    started_at,
                    ended_at: Some(now_secs()),
                    tasks_completed,
                    insights,
                    status: "interrupted".to_string(),
                };
            }
        }};
    }

    // Task 1 — Memory consolidation
    run_task!("memory_consolidation", task_memory_consolidation());

    // Task 2 — Autonomous research
    run_task!("autonomous_research", task_autonomous_research(&app));

    // Task 3 — Goal strategy review
    run_task!("goal_strategy_review", task_goal_strategy_review());

    // Task 4 — Skill synthesis
    run_task!("skill_synthesis", task_skill_synthesis(app.clone()));

    // Task 5 — Code health scan
    run_task!("code_health_scan", task_code_health_scan());

    // Task 6 — Pre-generate briefing
    run_task!("prebuild_briefing", task_prebuild_briefing(app.clone()));

    // Task 7 — Weekly meta-critique (skips itself if not due)
    run_task!("weekly_meta_critique", task_weekly_meta_critique());

    DreamSession {
        id,
        started_at,
        ended_at: Some(now_secs()),
        tasks_completed,
        insights,
        status: "completed".to_string(),
    }
}

// ── Dream monitor loop ────────────────────────────────────────────────────────

pub fn start_dream_monitor(app: tauri::AppHandle) {
    if DREAM_MONITOR_RUNNING.swap(true, Ordering::SeqCst) {
        return; // already running
    }

    // Initialise LAST_ACTIVITY to now so we don't dream immediately on launch.
    record_user_activity();

    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(tokio::time::Duration::from_secs(60)).await;

            let last = LAST_ACTIVITY.load(Ordering::Relaxed);
            let idle_secs = now_secs() - last;
            let already_dreaming = DREAMING.load(Ordering::Relaxed);

            // If user became active while dreaming, interrupt
            if already_dreaming && idle_secs < 60 {
                DREAMING.store(false, Ordering::SeqCst);
                let _ = app.emit("dream_mode_end", serde_json::json!({
                    "reason": "interrupted",
                    "tasks_completed": 0,
                }));
                continue;
            }

            // Trigger dream if idle > 20 minutes and not already dreaming
            if idle_secs >= 1200 && !already_dreaming {
                DREAMING.store(true, Ordering::SeqCst);
                let _ = app.emit("dream_mode_start", serde_json::json!({
                    "idle_secs": idle_secs,
                }));

                let app_clone = app.clone();
                tauri::async_runtime::spawn(async move {
                    let session = run_dream_session(app_clone.clone()).await;
                    // Only clear DREAMING if we weren't interrupted (interrupt path clears it itself)
                    DREAMING.compare_exchange(true, false, Ordering::SeqCst, Ordering::Relaxed)
                        .ok();
                    let _ = app_clone.emit(
                        "dream_mode_end",
                        serde_json::json!({
                            "status": session.status,
                            "tasks_completed": session.tasks_completed.len(),
                            "insights": session.insights,
                            "duration_secs": session.ended_at.unwrap_or(0) - session.started_at,
                        }),
                    );
                });
            }
        }
    });
}

// ── Tauri commands ────────────────────────────────────────────────────────────

#[tauri::command]
pub fn dream_is_active() -> bool {
    is_dreaming()
}

#[tauri::command]
pub async fn dream_trigger_now(app: tauri::AppHandle) -> Result<DreamSession, String> {
    if DREAMING.swap(true, Ordering::SeqCst) {
        return Err("Dream session already in progress".to_string());
    }
    let _ = app.emit("dream_mode_start", serde_json::json!({ "idle_secs": 0, "manual": true }));
    let session = run_dream_session(app.clone()).await;
    DREAMING.store(false, Ordering::SeqCst);
    let _ = app.emit(
        "dream_mode_end",
        serde_json::json!({
            "status": session.status,
            "tasks_completed": session.tasks_completed.len(),
            "insights": session.insights,
        }),
    );
    Ok(session)
}

#[tauri::command]
pub fn dream_record_activity() {
    record_user_activity();
}
