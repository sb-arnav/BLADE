/// BRAIN PLANNER — BLADE's task decomposition layer.
///
/// When the user asks something complex ("post on X about what I'm working on",
/// "deploy and notify the team", "research competitors and write a report"),
/// the Brain planner makes a SEPARATE LLM call to produce a structured plan
/// BEFORE the main chat model runs.
///
/// The plan is injected into the system prompt so the chat model's tool loop
/// has clear directions instead of figuring it out ad-hoc.
///
/// Brain prompt is small (~2000-3000 tokens): identity + organ roster + user query.
/// No hallucination bait — just "here's what you have, here's what was asked, make a plan."
///
/// PLAN MEMORY: Successful plans are cached by request pattern. If a similar
/// request has been planned before and the plan worked, return it instantly
/// without an LLM call. Failed plans are remembered to avoid repeating mistakes.

use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};

/// Produce a structured plan for a complex user request.
///
/// Returns a markdown plan string to inject into the system prompt,
/// or empty string if planning fails or isn't needed.
pub async fn plan_task(
    user_query: &str,
    hive_digest: &str,
    dna_context: &str,
) -> String {
    let config = crate::config::load_config();
    if config.api_key.is_empty() && config.provider != "ollama" {
        return String::new();
    }

    // Model selection adapts to homeostasis energy_mode:
    // High energy (>0.7): use the quality model for better plans
    // Low energy (<0.3): use the cheapest available for speed/cost
    // Normal: use fast task routing
    let energy = crate::homeostasis::energy_mode();
    let (provider, api_key, model) = if energy > 0.7 {
        // High energy — use the configured model for quality planning
        (config.provider.clone(), config.api_key.clone(), config.model.clone())
    } else {
        // Normal/low energy — use fast routing or cheap model
        let (p, k, m) = crate::config::resolve_provider_for_task(&config, &crate::router::TaskType::Simple);
        if p != config.provider && !k.is_empty() {
            (p, k, m)
        } else {
            let cheap = crate::config::cheap_model_for_provider(&config.provider, &config.model);
            (config.provider.clone(), config.api_key.clone(), cheap)
        }
    };

    // Get the organ roster so Brain knows exactly what each organ can do
    let organ_roster = crate::organ::get_organ_roster_for_brain();

    // Persona context — so the plan respects user's personality and preferences
    let persona_ctx = crate::persona_engine::get_persona_context();
    let persona_section = if persona_ctx.is_empty() {
        String::new()
    } else {
        format!("\nUser personality:\n{}\n", crate::safe_slice(&persona_ctx, 300))
    };

    let system = format!(
        r#"You are BLADE's Brain — the planning layer of a distributed AI agent system.

Your job: given a user request, produce a CONCRETE execution plan.

You know the following about BLADE's body:

{organ_roster}

{hive_digest}

{dna_context}
{persona_section}
RULES:
- Produce 3-8 numbered steps, each one clear action
- Reference specific organs/tools when possible (e.g. "use GitHub organ to check PRs")
- If a step needs user approval before proceeding, mark it with [APPROVAL]
- If you don't have an organ for something, say "use browser to..." or "use bash to..."
- Be specific — "check recent commits" not "gather context"
- Think about what data you need BEFORE you act (gather first, then execute)
- End with what to show the user

Respond with ONLY the numbered plan. No preamble, no explanation, no markdown headers."#
    );

    // Check prefrontal working memory — if a task is already in progress,
    // tell the Brain so it can produce a continuation plan, not a fresh one.
    let wm = crate::prefrontal::get();
    let wm_context = if wm.active {
        format!(
            "\n\nIMPORTANT: A task is already in progress.\nOriginal request: {}\nSteps completed: {}\nTools used: {}\nLast result: {}\n\nThe user's new message may be a follow-up to this task. Adapt the plan accordingly.",
            wm.task_request, wm.steps_completed,
            wm.tools_used.join(", "),
            crate::safe_slice(&wm.last_result_preview, 100)
        )
    } else if !wm.progress_summary.is_empty() {
        let age = chrono::Utc::now().timestamp() - wm.started_at;
        if age < 300 {
            format!(
                "\n\nContext: User just completed a task: {} → {}",
                wm.task_request, crate::safe_slice(&wm.progress_summary, 100)
            )
        } else {
            String::new()
        }
    } else {
        String::new()
    };

    // ── Plan memory: check cache before calling LLM ────────────────────
    let request_hash = hash_request(user_query);
    if let Some(cached_plan) = recall_plan(&request_hash) {
        log::info!("[BrainPlanner] Cache hit — reusing learned plan for '{}'", crate::safe_slice(user_query, 40));
        crate::prefrontal::begin_task(user_query, &cached_plan);
        return format_plan(&cached_plan, true);
    }

    let user_msg = format!("User request: {}{}", user_query, wm_context);

    let messages = vec![
        crate::providers::ConversationMessage::System(system),
        crate::providers::ConversationMessage::User(user_msg),
    ];

    let result = crate::providers::complete_turn(
        &provider,
        &api_key,
        &model,
        &messages,
        &crate::providers::no_tools(),
        None,
    )
    .await;

    match result {
        Ok(turn) => {
            let plan = turn.content.trim().to_string();
            if plan.is_empty() || plan.len() < 20 {
                return String::new();
            }
            // Store in prefrontal working memory
            crate::prefrontal::begin_task(user_query, &plan);
            // Store in plan memory (pending — will be confirmed or rejected later)
            store_pending_plan(&request_hash, user_query, &plan);

            format_plan(&plan, false)
        }
        Err(e) => {
            log::warn!("[BrainPlanner] Planning failed: {}", e);
            String::new()
        }
    }
}

fn format_plan(plan: &str, from_cache: bool) -> String {
    let source = if from_cache { " (learned pattern)" } else { "" };
    format!(
        "## BLADE Brain Plan{}\n\n\
         The Brain analyzed this request and produced this execution plan. \
         Follow it step by step, adapting if a step fails:\n\n\
         {}\n\n\
         Execute this plan now using your available tools. \
         If a step is marked [APPROVAL], show the result and wait for user confirmation before continuing.",
        source, plan
    )
}

// ── Plan Memory ──────────────────────────────────────────────────────────────
//
// Stores successful plans by request pattern hash. When a similar request
// comes in, returns the cached plan instantly (no LLM call).
// Failed plans are remembered to avoid repeating mistakes.

fn hash_request(query: &str) -> String {
    // Normalize: lowercase, strip punctuation, take first 80 chars
    let normalized: String = query
        .to_lowercase()
        .chars()
        .filter(|c| c.is_alphanumeric() || c.is_whitespace())
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<&str>>()
        .join(" ");
    let key = crate::safe_slice(&normalized, 80);
    let mut hasher = DefaultHasher::new();
    key.hash(&mut hasher);
    format!("{:x}", hasher.finish())
}

fn plan_db() -> Option<rusqlite::Connection> {
    let db_path = crate::config::blade_config_dir().join("blade.db");
    let conn = rusqlite::Connection::open(&db_path).ok()?;
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS plan_memory (
            request_hash TEXT PRIMARY KEY,
            request_text TEXT NOT NULL,
            plan TEXT NOT NULL,
            success_count INTEGER DEFAULT 0,
            failure_count INTEGER DEFAULT 0,
            status TEXT DEFAULT 'pending',
            created_at INTEGER NOT NULL,
            last_used INTEGER NOT NULL
        );"
    ).ok()?;
    Some(conn)
}

fn store_pending_plan(hash: &str, request: &str, plan: &str) {
    if let Some(conn) = plan_db() {
        let now = chrono::Utc::now().timestamp();
        let _ = conn.execute(
            "INSERT INTO plan_memory (request_hash, request_text, plan, status, created_at, last_used)
             VALUES (?1, ?2, ?3, 'pending', ?4, ?4)
             ON CONFLICT(request_hash) DO UPDATE SET
                plan = ?3, status = 'pending', last_used = ?4",
            rusqlite::params![hash, crate::safe_slice(request, 200), crate::safe_slice(plan, 2000), now],
        );
    }
}

fn recall_plan(hash: &str) -> Option<String> {
    let conn = plan_db()?;
    // Only return plans that have succeeded at least twice and never failed
    conn.query_row(
        "SELECT plan FROM plan_memory
         WHERE request_hash = ?1 AND status = 'confirmed' AND success_count >= 2 AND failure_count = 0",
        rusqlite::params![hash],
        |row| row.get::<_, String>(0),
    ).ok()
}

/// Called when a brain-planned task completes successfully.
/// Marks the plan as confirmed and increments success count.
pub fn confirm_plan(request: &str) {
    let hash = hash_request(request);
    if let Some(conn) = plan_db() {
        let now = chrono::Utc::now().timestamp();
        let _ = conn.execute(
            "UPDATE plan_memory SET status = 'confirmed', success_count = success_count + 1, last_used = ?1
             WHERE request_hash = ?2",
            rusqlite::params![now, hash],
        );
    }
}

/// Called when a brain-planned task fails or the user rejects it.
/// Increments failure count. Plans with failures are never cached.
pub fn reject_plan(request: &str) {
    let hash = hash_request(request);
    if let Some(conn) = plan_db() {
        let _ = conn.execute(
            "UPDATE plan_memory SET failure_count = failure_count + 1
             WHERE request_hash = ?1",
            rusqlite::params![hash],
        );
    }
}
