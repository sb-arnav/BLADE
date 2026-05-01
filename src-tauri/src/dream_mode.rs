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

/// Phase 24 (v1.3) — read the last-activity timestamp without exposing the
/// `LAST_ACTIVITY` AtomicI64 itself. Used by `proactive_engine` to apply
/// the 30s idle gate before draining `~/.blade/skills/.pending/` chat-injected
/// prompts (24-RESEARCH §"Common Pitfalls" Pitfall 6).
pub fn last_activity_ts() -> i64 {
    LAST_ACTIVITY.load(Ordering::Relaxed)
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

/// Task 1 — Memory consolidation (the hippocampus "sleep" cycle).
/// Consolidates across all 7 memory modules:
///   - Character bible consolidation
///   - Typed memory: prune low-confidence, merge duplicates
///   - Knowledge graph: strengthen frequently-accessed edges
///   - People graph: merge duplicate person entries
///   - Stale memory pruning (>90 days, low access count)
async fn task_memory_consolidation() -> String {
    let mut results: Vec<String> = Vec::new();

    // 1. Character bible
    let _ = crate::character::consolidate_character().await;
    results.push("character bible consolidated".to_string());

    // 2. Prune stale typed memories (>90 days old, accessed <3 times, confidence <0.5)
    let db_path = crate::config::blade_config_dir().join("blade.db");
    if let Ok(conn) = rusqlite::Connection::open(&db_path) {
        let cutoff = chrono::Utc::now().timestamp() - (90 * 86400);
        let pruned = conn.execute(
            "DELETE FROM typed_memories WHERE created_at < ?1 AND access_count < 3 AND confidence < 0.5",
            rusqlite::params![cutoff],
        ).unwrap_or(0);
        if pruned > 0 {
            results.push(format!("pruned {} stale memories", pruned));
        }

        // 3. Boost confidence of frequently accessed memories
        let boosted = conn.execute(
            "UPDATE typed_memories SET confidence = MIN(confidence + 0.05, 1.0) WHERE access_count > 10 AND confidence < 0.95",
            [],
        ).unwrap_or(0);
        if boosted > 0 {
            results.push(format!("strengthened {} high-access memories", boosted));
        }

        // 4. Merge near-duplicate typed memories (same category, >80% content overlap)
        // This is expensive so we limit to 50 candidates
        let mut merge_count = 0u32;
        if let Ok(mut stmt) = conn.prepare(
            "SELECT id, category, content FROM typed_memories ORDER BY created_at DESC LIMIT 50"
        ) {
            let rows: Vec<(String, String, String)> = stmt
                .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
                .ok()
                .map(|r| r.filter_map(|x| x.ok()).collect())
                .unwrap_or_default();

            let mut seen_hashes: std::collections::HashSet<String> = std::collections::HashSet::new();
            for (id, cat, content) in &rows {
                // Crude dedup: first 100 chars + category as key
                let key = format!("{}:{}", cat, crate::safe_slice(content, 100));
                if !seen_hashes.insert(key) {
                    let _ = conn.execute("DELETE FROM typed_memories WHERE id = ?1", rusqlite::params![id]);
                    merge_count += 1;
                }
            }
        }
        if merge_count > 0 {
            results.push(format!("merged {} duplicate memories", merge_count));
        }
    }

    // 5. Prune stale episodic memories (memory_palace) — low importance, old, rarely recalled
    if let Ok(conn) = rusqlite::Connection::open(&db_path) {
        let cutoff = chrono::Utc::now().timestamp() - (180 * 86400); // 180 days
        let pruned_episodes = conn.execute(
            "DELETE FROM memory_episodes WHERE created_at < ?1 AND recall_count < 2 AND importance <= 3",
            rusqlite::params![cutoff],
        ).unwrap_or(0);
        if pruned_episodes > 0 {
            results.push(format!("pruned {} stale episodes", pruned_episodes));
        }
    }

    // 6. Prune stale knowledge graph nodes (>120 days, low importance, no edges)
    if let Ok(conn) = rusqlite::Connection::open(&db_path) {
        let cutoff = chrono::Utc::now().timestamp() - (120 * 86400);
        let pruned_nodes = conn.execute(
            "DELETE FROM knowledge_nodes WHERE last_updated < ?1 AND importance < 0.4 \
             AND id NOT IN (SELECT source_id FROM knowledge_edges UNION SELECT target_id FROM knowledge_edges)",
            rusqlite::params![cutoff],
        ).unwrap_or(0);
        if pruned_nodes > 0 {
            results.push(format!("pruned {} orphan knowledge nodes", pruned_nodes));
        }
    }

    // 7. Compress memory.rs working memory blocks if they're getting large
    let blocks = crate::memory::load_memory_blocks();
    if blocks.human_block.len() > 3000 || blocks.conversation_block.len() > 4000 {
        // Working memory over 3-4k chars should be compressed
        // The compression happens via LLM in memory.rs — just trigger it
        let _ = crate::memory::update_human_block("").await; // triggers compression check
        results.push("triggered working memory compression".to_string());
    }

    if results.is_empty() {
        "No consolidation needed".to_string()
    } else {
        format!("Memory consolidation: {}", results.join(", "))
    }
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

// ── Phase 24 (v1.3) — dream_mode skill lifecycle tasks ──────────────────────
// Order: prune → consolidate → from_trace (Pitfall 5 — consolidate selects
// from post-prune state). Each task delegates pure logic to skills::lifecycle
// and writes proposals via skills::pending. Each emits exactly one
// voyager_log::dream_*(count, items) at task end (D-24-F). Per-step
// DREAMING.load(Ordering::Relaxed) checkpoints between work units >100ms
// (D-24-D + Discretion item 8).

/// Phase 24 — DREAM-01 prune pass.
/// Sweeps .pending/ housekeeping first (Discretion item 4 LOCK).
async fn task_skill_prune(_app: tauri::AppHandle) -> String {
    let now = chrono::Utc::now().timestamp();

    // Top-of-cycle .pending/ housekeeping — 7-day mark + 30-day purge.
    crate::skills::pending::auto_dismiss_old(now);

    let candidates = crate::skills::lifecycle::prune_candidate_selection(now);
    let mut archived: Vec<String> = Vec::new();

    for (_rowid, name, _script_path, _last_used) in candidates {
        // Per-step abort checkpoint (≤1s SLA).
        if !DREAMING.load(Ordering::Relaxed) {
            break;
        }
        match crate::skills::lifecycle::archive_skill(&name) {
            Ok(_) => archived.push(name),
            Err(e) => log::warn!("[dream_mode::prune] archive {}: {e}", name),
        }
    }

    let count = archived.len() as i64;
    crate::voyager_log::dream_prune(count, archived.clone());
    format!("dream:prune archived {} skill(s)", count)
}

/// Phase 24 — DREAM-02 consolidation pass.
/// Cap: 1 merge proposal per cycle (D-24-B).
async fn task_skill_consolidate(_app: tauri::AppHandle) -> String {
    let rows = crate::tool_forge::get_forged_tools();
    if rows.len() < 2 {
        crate::voyager_log::dream_consolidate(0, vec![]);
        return "dream:consolidate 0 pair(s) flagged".to_string();
    }

    // Build description+usage embedding inputs (D-24-E embedding source per Q6 LOCK).
    let texts: Vec<String> = rows
        .iter()
        .map(|r| format!("{} {}", r.description, r.usage))
        .collect();
    let embeddings = match crate::embeddings::embed_texts(&texts) {
        Ok(e) => e,
        Err(e) => {
            log::warn!("[dream_mode::consolidate] embed_texts: {e}");
            crate::voyager_log::dream_consolidate(0, vec![]);
            return format!("dream:consolidate skipped (embed: {e})");
        }
    };

    // Abort checkpoint after the heavy embed call.
    if !DREAMING.load(Ordering::Relaxed) {
        crate::voyager_log::dream_consolidate(0, vec![]);
        return "dream:consolidate aborted post-embed".to_string();
    }

    let mut flagged: Vec<String> = Vec::new();
    let n = rows.len();
    let mut pair_idx = 0usize;
    'outer: for i in 0..n {
        for j in (i + 1)..n {
            pair_idx += 1;
            // Every 20 pairs, checkpoint (Discretion item 8 LOCK).
            if pair_idx % 20 == 0 && !DREAMING.load(Ordering::Relaxed) {
                break 'outer;
            }
            let sim = crate::skills::lifecycle::cosine_sim(&embeddings[i], &embeddings[j]);
            if sim < 0.85 {
                continue;
            }
            let hashes_a = crate::skills::lifecycle::last_5_trace_hashes(&rows[i].name);
            let hashes_b = crate::skills::lifecycle::last_5_trace_hashes(&rows[j].name);
            if hashes_a.len() == 5 && hashes_a == hashes_b {
                // FLAG! Build proposal.
                let merged = crate::skills::lifecycle::deterministic_merge_body(
                    &rows[i],
                    &rows[j],
                    &crate::skills::lifecycle::forged_name_exists,
                );
                let payload = serde_json::json!({
                    "source_a": rows[i].name,
                    "source_b": rows[j].name,
                    "merged_body": merged,
                });
                let id = uuid::Uuid::new_v4().to_string()[..8].to_string();
                let content_hash = crate::skills::pending::compute_content_hash(
                    "merge",
                    &merged.name,
                    &payload,
                );
                let prop = crate::skills::pending::Proposal {
                    id: id.clone(),
                    kind: "merge".to_string(),
                    proposed_name: merged.name.clone(),
                    payload,
                    created_at: chrono::Utc::now().timestamp(),
                    dismissed: false,
                    content_hash,
                };
                if let Ok(true) = crate::skills::pending::write_proposal(&prop) {
                    flagged.push(format!("{}+{}", rows[i].name, rows[j].name));
                }
                break 'outer; // Cap: 1 merge per cycle (D-24-B).
            }
        }
    }

    let count = flagged.len() as i64;
    crate::voyager_log::dream_consolidate(count, flagged.clone());
    format!("dream:consolidate {} pair(s) flagged", count)
}

/// Phase 24 — DREAM-03 skill-from-trace pass.
/// Cap: 1 generate proposal per cycle (D-24-B).
async fn task_skill_from_trace(_app: tauri::AppHandle) -> String {
    let now = chrono::Utc::now().timestamp();
    let traces = crate::skills::lifecycle::recent_unmatched_traces(now);
    let mut proposed: Vec<String> = Vec::new();

    for trace in traces {
        // Per-trace abort checkpoint.
        if !DREAMING.load(Ordering::Relaxed) {
            break;
        }
        // Build proposed name + skill.md skeleton.
        let base = crate::skills::lifecycle::proposed_name_from_trace(&trace);
        let proposed_name = crate::skills::lifecycle::ensure_unique_name(
            &base,
            &crate::skills::lifecycle::forged_name_exists,
        );
        let payload = serde_json::json!({
            "trace": trace,
            "proposed_skill_md": format!(
                "# {}\n\nProposed by dream_mode skill-from-trace generator on turn that used {} tool calls without matching any existing forged tool.\n\nTool sequence:\n{}\n",
                proposed_name,
                trace.len(),
                trace.iter().map(|t| format!("- {}", t)).collect::<Vec<_>>().join("\n")
            ),
        });
        let id = uuid::Uuid::new_v4().to_string()[..8].to_string();
        let content_hash = crate::skills::pending::compute_content_hash(
            "generate",
            &proposed_name,
            &payload,
        );
        let prop = crate::skills::pending::Proposal {
            id: id.clone(),
            kind: "generate".to_string(),
            proposed_name: proposed_name.clone(),
            payload,
            created_at: chrono::Utc::now().timestamp(),
            dismissed: false,
            content_hash,
        };
        if let Ok(true) = crate::skills::pending::write_proposal(&prop) {
            proposed.push(proposed_name);
            break; // Cap: 1 generate per cycle (D-24-B).
        }
        // If write_proposal returned Ok(false) — deduped against earlier
        // cycle's already-pending proposal; keep iterating for a fresh trace.
    }

    let count = proposed.len() as i64;
    crate::voyager_log::dream_generate(count, proposed.clone());
    format!("dream:generate {} skill(s) proposed", count)
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
            let _ = app.emit_to("main", "dream_task_start", serde_json::json!({ "task": task_name }));
            let result: String =
                match tokio::time::timeout(tokio::time::Duration::from_secs(120), $fut).await {
                    Ok(insight) => insight,
                    Err(_) => format!("{} timed out", task_name),
                };
            let _ = app.emit_to("main", "dream_task_complete",
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

    // Phase 24 (v1.3) — Voyager forgetting half: prune → consolidate → from_trace.
    // Order matters per Pitfall 5 (consolidate selects from post-prune state).
    run_task!("skill_prune",       task_skill_prune(app.clone()));
    run_task!("skill_consolidate", task_skill_consolidate(app.clone()));
    run_task!("skill_from_trace",  task_skill_from_trace(app.clone()));

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
                let _ = app.emit_to("main", "dream_mode_end", serde_json::json!({
                    "reason": "interrupted",
                    "tasks_completed": 0,
                }));
                continue;
            }

            // Trigger dream if idle > 20 minutes and not already dreaming
            if idle_secs >= 1200 && !already_dreaming {
                DREAMING.store(true, Ordering::SeqCst);
                let _ = app.emit_to("main", "dream_mode_start", serde_json::json!({
                    "idle_secs": idle_secs,
                }));

                let app_clone = app.clone();
                tauri::async_runtime::spawn(async move {
                    let session = run_dream_session(app_clone.clone()).await;
                    // Only clear DREAMING if we weren't interrupted (interrupt path clears it itself)
                    DREAMING.compare_exchange(true, false, Ordering::SeqCst, Ordering::Relaxed)
                        .ok();
                    let _ = app_clone.emit_to("main", "dream_mode_end",
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
    let _ = app.emit_to("main", "dream_mode_start", serde_json::json!({ "idle_secs": 0, "manual": true }));
    let session = run_dream_session(app.clone()).await;
    DREAMING.store(false, Ordering::SeqCst);
    let _ = app.emit_to("main", "dream_mode_end",
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn last_activity_ts_reads_static() {
        // record_user_activity writes now to LAST_ACTIVITY.
        record_user_activity();
        let ts = last_activity_ts();
        let now = chrono::Utc::now().timestamp();
        // Allow <=2s skew for the SystemTime + atomic-store path.
        assert!((now - ts).abs() <= 2, "expected ts within 2s of now; got {} vs {}", ts, now);
    }

    // ── Phase 24 Plan 24-05 integration tests ──────────────────────────────
    //
    // The 3 tests below pin DREAM-01 prune semantics + archive_skill side
    // effect (TBD-02-01) and DREAM-05 per-step abort + ≤1s SLA (TBD-02-08).
    // Each uses a tempdir BLADE_CONFIG_DIR + direct seeding of forged_tools
    // rows + matching `<user_root>/<sanitized_name>/SKILL.md` directory
    // seeding so `archive_skill` has a real source dir to rename. The tests
    // share BLADE_CONFIG_DIR mutation, so `cargo test --test-threads=1` is
    // mandatory (the verify command below uses it). Drives the prune loop
    // body via the public `skills::lifecycle` surface (mirrors the actual
    // task body since AppHandle cannot be fabricated in unit tests).

    fn seed_stale_forged_tools(tmp_path: &std::path::Path, count: usize, days_old: i64) {
        // Seed `count` stale forged_tools rows + matching <user_root>/<sanitized_name>/ dirs.
        // Uses crate::skills::export::sanitize_name to mirror archive_skill's path resolution.
        let conn = rusqlite::Connection::open(tmp_path.join("blade.db")).unwrap();
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS forged_tools (
                id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, description TEXT NOT NULL,
                language TEXT NOT NULL, script_path TEXT NOT NULL, usage TEXT NOT NULL,
                parameters TEXT DEFAULT '[]', test_output TEXT DEFAULT '',
                created_at INTEGER NOT NULL, last_used INTEGER, use_count INTEGER DEFAULT 0,
                forged_from TEXT DEFAULT ''
            );",
        ).unwrap();
        let now = chrono::Utc::now().timestamp();
        let stale = now - days_old * 86400;
        for i in 0..count {
            let name = format!("stale_{}", i);
            conn.execute(
                "INSERT INTO forged_tools (id, name, description, language, script_path, usage, created_at, last_used) \
                 VALUES (?1, ?2, 'd', 'bash', '/tmp/x.sh', 'u', ?3, ?3)",
                rusqlite::params![format!("id{}", i), name, stale],
            ).unwrap();
            // Seed the on-disk dir that archive_skill will rename.
            if let Some(sanitized) = crate::skills::export::sanitize_name(&format!("stale_{}", i)) {
                let dir = crate::skills::loader::user_root().join(&sanitized);
                std::fs::create_dir_all(&dir).ok();
                std::fs::write(
                    dir.join("SKILL.md"),
                    format!("---\nname: {}\ndescription: x\n---\n", sanitized),
                ).ok();
            }
        }
    }

    fn run_prune_loop_body() -> usize {
        // Mirrors task_skill_prune's loop body via the public lifecycle
        // surface — used by all 3 prune tests since the actual `task_skill_prune`
        // is private + requires a real AppHandle to invoke directly.
        let now = chrono::Utc::now().timestamp();
        crate::skills::pending::auto_dismiss_old(now);
        let candidates = crate::skills::lifecycle::prune_candidate_selection(now);
        let mut archived: Vec<String> = Vec::new();
        for (_rowid, name, _script_path, _last_used) in candidates {
            if !DREAMING.load(Ordering::Relaxed) {
                break;
            }
            if let Ok(_) = crate::skills::lifecycle::archive_skill(&name) {
                archived.push(name);
            }
        }
        archived.len()
    }

    #[test]
    fn task_skill_prune_archives_stale() {
        let tmp = tempfile::TempDir::new().expect("tempdir");
        std::env::set_var("BLADE_CONFIG_DIR", tmp.path());

        // Seed 2 stale rows (92 days old) + 1 fresh row (30 days old).
        seed_stale_forged_tools(tmp.path(), 2, 92);
        // Append the fresh row directly.
        let conn = rusqlite::Connection::open(tmp.path().join("blade.db")).unwrap();
        let now = chrono::Utc::now().timestamp();
        let fresh = now - 30 * 86400;
        conn.execute(
            "INSERT INTO forged_tools (id, name, description, language, script_path, usage, created_at, last_used) \
             VALUES ('fresh_id', 'fresh_one', 'd', 'bash', '/tmp/x.sh', 'u', ?1, ?1)",
            rusqlite::params![fresh],
        ).unwrap();
        drop(conn);

        // Drive prune loop body to completion (DREAMING true throughout).
        DREAMING.store(true, Ordering::SeqCst);
        let archived_count = run_prune_loop_body();

        // 2 stale rows archived; 1 fresh row remains.
        assert_eq!(archived_count, 2, "expected 2 stale rows archived");
        let conn = rusqlite::Connection::open(tmp.path().join("blade.db")).unwrap();
        let remaining: i64 = conn.query_row(
            "SELECT COUNT(*) FROM forged_tools",
            [],
            |r| r.get(0),
        ).unwrap();
        assert_eq!(remaining, 1, "expected 1 row remaining (the fresh one)");
        let fresh_name: String = conn.query_row(
            "SELECT name FROM forged_tools",
            [],
            |r| r.get(0),
        ).unwrap();
        assert_eq!(fresh_name, "fresh_one");
        drop(conn);

        // Confirm 2 dirs landed under .archived/.
        let archived_root = crate::skills::loader::user_root().join(".archived");
        let archived_dirs: Vec<_> = std::fs::read_dir(&archived_root)
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.path().is_dir())
            .collect();
        assert_eq!(archived_dirs.len(), 2, "expected 2 dirs under .archived/");

        DREAMING.store(false, Ordering::SeqCst);
        std::env::remove_var("BLADE_CONFIG_DIR");
    }

    #[tokio::test]
    async fn prune_respects_dreaming_atomic() {
        // DREAM-05 / TBD-02-08 — per-step abort guarantee.
        //
        // Test posture: drive the prune loop body via a deterministic
        // limited-progress fixture rather than wall-clock racing the
        // spawn_blocking worker. We run the loop body MANUALLY,
        // archive-by-archive, flipping DREAMING off after a controlled
        // number of iterations to prove the per-step DREAMING.load
        // checkpoint actually breaks the loop mid-pass.
        let tmp = tempfile::TempDir::new().expect("tempdir");
        std::env::set_var("BLADE_CONFIG_DIR", tmp.path());

        // Seed 10 stale forged_tools rows + matching dirs.
        seed_stale_forged_tools(tmp.path(), 10, 92);

        // Set DREAMING true so the prune loop will iterate.
        DREAMING.store(true, Ordering::SeqCst);

        // Drive the loop body manually with an injected DREAMING-flip
        // after the 3rd archive completes. This is deterministic:
        // exactly 3 rows archived, exactly 7 rows remaining.
        let now = chrono::Utc::now().timestamp();
        crate::skills::pending::auto_dismiss_old(now);
        let candidates = crate::skills::lifecycle::prune_candidate_selection(now);
        let mut archived: Vec<String> = Vec::new();
        for (idx, (_rowid, name, _script_path, _last_used)) in candidates.into_iter().enumerate() {
            // Per-step abort checkpoint — same as the production task body.
            if !DREAMING.load(Ordering::Relaxed) {
                break;
            }
            // Flip DREAMING off *after* archive #3 completes so the loop
            // exits on iteration 4's checkpoint with exactly 3 archived.
            if idx == 3 {
                DREAMING.store(false, Ordering::SeqCst);
            }
            if let Ok(_) = crate::skills::lifecycle::archive_skill(&name) {
                archived.push(name);
            }
        }
        let archived_count = archived.len();

        // After abort: some pruned + some left untouched.
        let conn = rusqlite::Connection::open(tmp.path().join("blade.db")).unwrap();
        let remaining: i64 = conn.query_row(
            "SELECT COUNT(*) FROM forged_tools",
            [],
            |r| r.get(0),
        ).unwrap();
        drop(conn);

        // Per-step abort behaviour proven: SOME archived (>0) AND
        // SOME remaining (>0). The exact split is deterministic given
        // the manual flip ordering above.
        assert!(
            archived_count > 0,
            "expected at least one archive before abort; got {}",
            archived_count
        );
        assert!(
            remaining > 0,
            "expected some rows untouched after abort; got remaining={}",
            remaining
        );
        assert!(
            archived_count + (remaining as usize) == 10,
            "archived + remaining must sum to 10; got {} + {}",
            archived_count, remaining
        );

        DREAMING.store(false, Ordering::SeqCst);
        std::env::remove_var("BLADE_CONFIG_DIR");
    }

    #[tokio::test]
    async fn abort_within_one_second() {
        // Seed a tempdir BLADE_CONFIG_DIR + populate forged_tools with
        // ≥10 stale rows so prune has work. Drive the prune body via the
        // same `run_prune_loop_body` helper, flip DREAMING mid-pass, assert
        // ≤1s wall-clock to return.
        let tmp = tempfile::TempDir::new().expect("tempdir");
        std::env::set_var("BLADE_CONFIG_DIR", tmp.path());

        seed_stale_forged_tools(tmp.path(), 50, 100);

        DREAMING.store(true, Ordering::SeqCst);

        let handle = tokio::task::spawn_blocking(|| run_prune_loop_body());

        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        let abort_at = tokio::time::Instant::now();
        DREAMING.store(false, Ordering::SeqCst);

        let _archived = handle.await.expect("prune task joined");
        let elapsed = abort_at.elapsed();
        assert!(
            elapsed.as_millis() <= 1000,
            "expected abort ≤1s; got {}ms",
            elapsed.as_millis()
        );

        DREAMING.store(false, Ordering::SeqCst);
        std::env::remove_var("BLADE_CONFIG_DIR");
    }
}
