/// BLADE Swarm Commands — Tauri commands + coordinator loop
///
/// The coordinator loop polls every 2 seconds:
///   1. Check running agents for completion
///   2. Mark done/failed tasks
///   3. Resolve newly ready tasks
///   4. Spawn agents for ready tasks (up to 5 concurrent)
///   5. When all done: synthesize final result

use crate::agents::{planner, Agent, AgentRole, AgentStatus, StepStatus};
use crate::commands::SharedMcpManager;
use crate::agents::queue::SharedAgentQueue;
use crate::swarm::{
    self, build_task_context, get_swarm_progress, resolve_ready_tasks,
    ScratchpadEntry, SwarmStatus, SwarmTaskStatus, SwarmTask, Swarm,
};
use tauri::Emitter;

// ---------------------------------------------------------------------------
// Internal: spawn one agent for a swarm task
// ---------------------------------------------------------------------------

async fn spawn_task_agent(
    task: &SwarmTask,
    swarm: &Swarm,
    queue: &SharedAgentQueue,
    mcp: &SharedMcpManager,
    app: &tauri::AppHandle,
) -> Result<String, String> {
    let config = crate::config::load_config();
    if config.api_key.is_empty() && config.provider != "ollama" {
        return Err("No API key configured".to_string());
    }

    // Build enriched goal with dependency context and typed scratchpad entries
    let enriched_goal = build_task_context(swarm, task);

    // Select provider/model based on task role and type
    let (provider, api_key, model) = select_provider_for_task(task, &config);

    // Get available tools
    let tools = {
        let manager = mcp.lock().await;
        manager.get_tools().to_vec()
    };

    // Build role-aware goal: prepend role system prompt snippet if assigned
    let goal_with_role = if let Some(role) = AgentRole::from_str(&task.role) {
        format!("{}\n\n{}", role.system_prompt_snippet(), enriched_goal)
    } else {
        enriched_goal.clone()
    };

    // Filter tools to role-preferred ones first if role is set
    let filtered_tools: Vec<crate::mcp::McpTool> = if let Some(role) = AgentRole::from_str(&task.role) {
        let patterns = role.preferred_tool_patterns();
        let preferred: Vec<_> = tools.iter()
            .filter(|t| patterns.iter().any(|p| t.qualified_name.to_lowercase().contains(p)))
            .cloned()
            .collect();
        // Use all tools if no preferred match, otherwise prefer role tools + rest
        if preferred.is_empty() {
            tools.clone()
        } else {
            let mut combined = preferred;
            for t in &tools {
                if !combined.iter().any(|c| c.qualified_name == t.qualified_name) {
                    combined.push(t.clone());
                }
            }
            combined
        }
    } else {
        tools.clone()
    };

    let plan = planner::plan_full(
        &provider,
        &api_key,
        &model,
        config.base_url.as_deref(),
        &goal_with_role,
        &filtered_tools,
    )
    .await
    .unwrap_or_else(|_| crate::agents::planner::TaskPlan {
        steps: Vec::new(),
        synthesis_prompt: String::new(),
    });

    let agent_id = uuid::Uuid::new_v4().to_string();
    let mut agent = Agent::new(agent_id.clone(), goal_with_role);
    agent.steps = plan.steps;
    agent.synthesis_prompt = plan.synthesis_prompt;
    agent.status = AgentStatus::Executing;

    {
        let mut q = queue.lock().await;
        q.add(agent);
    }

    // Run the agent in background
    let queue_clone = queue.clone();
    let mcp_clone = mcp.clone();
    let app_clone = app.clone();
    let base_url = config.base_url.clone();
    let aid = agent_id.clone();

    tokio::spawn(async move {
        crate::agent_commands::run_agent_loop_internal(
            &aid,
            &queue_clone,
            &mcp_clone,
            &app_clone,
            &provider,
            &api_key,
            &model,
            base_url,
        )
        .await;
    });

    Ok(agent_id)
}

// ---------------------------------------------------------------------------
// Provider routing for swarm tasks
// ---------------------------------------------------------------------------

/// Choose the right provider/model for a task based on its role and type.
fn select_provider_for_task(
    task: &SwarmTask,
    config: &crate::config::BladeConfig,
) -> (String, String, String) {
    use crate::swarm::SwarmTaskType;

    let routing = &config.task_routing;

    // Code tasks → code provider
    let preferred_provider = match task.task_type {
        SwarmTaskType::Code => routing.code.as_deref(),
        SwarmTaskType::Research => routing.fast.as_deref(),
        SwarmTaskType::Desktop => None,
    };

    // Also respect role overrides
    let role_provider = match task.role.as_str() {
        "coder" => routing.code.as_deref(),
        "researcher" | "analyst" => routing.fast.as_deref(),
        "writer" | "reviewer" => routing.creative.as_deref().or(routing.code.as_deref()),
        // Security roles: use the configured code/fast provider (prefer depth over speed)
        "securityrecon" | "security_recon" | "recon" => routing.fast.as_deref(),
        "securityanalyst" | "security_analyst" => routing.code.as_deref().or(routing.fast.as_deref()),
        "securityauditor" | "security_auditor" | "auditor" => routing.code.as_deref(),
        _ => None,
    };

    let chosen_provider = role_provider
        .or(preferred_provider)
        .unwrap_or(&config.provider);

    let key = crate::config::get_provider_key(chosen_provider);
    let (provider, api_key) = if key.is_empty() && chosen_provider != "ollama" {
        // Fallback to active provider
        (config.provider.clone(), config.api_key.clone())
    } else {
        (chosen_provider.to_string(), key)
    };

    let model = crate::router::suggest_model(
        &provider,
        &crate::router::TaskType::Code,
    )
    .unwrap_or_else(|| config.model.clone());

    (provider, api_key, model)
}

// ---------------------------------------------------------------------------
// Coordinator loop
// ---------------------------------------------------------------------------

pub fn start_swarm_coordinator(
    swarm_id: String,
    queue: SharedAgentQueue,
    mcp: SharedMcpManager,
    app: tauri::AppHandle,
) {
    tokio::spawn(async move {
        coordinator_loop(&swarm_id, &queue, &mcp, &app).await;
    });
}

async fn coordinator_loop(
    swarm_id: &str,
    queue: &SharedAgentQueue,
    mcp: &SharedMcpManager,
    app: &tauri::AppHandle,
) {
    let config = crate::config::load_config();

    loop {
        tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;

        // Load swarm state
        let mut swarm = match swarm::load_swarm(swarm_id) {
            Some(s) => s,
            None => break,
        };

        // Stop if swarm was paused/cancelled
        if matches!(swarm.status, SwarmStatus::Paused | SwarmStatus::Completed | SwarmStatus::Failed) {
            break;
        }

        // 1. Check running agents — did they finish?
        // Collect tasks to avoid borrow issues inside loop
        let running_tasks: Vec<(String, Option<String>)> = swarm.tasks
            .iter()
            .filter(|t| t.status == SwarmTaskStatus::Running)
            .map(|t| (t.id.clone(), t.agent_id.clone()))
            .collect();

        for (task_id, agent_id_opt) in &running_tasks {
            let task_title = swarm.tasks.iter().find(|t| &t.id == task_id)
                .map(|t| t.title.clone())
                .unwrap_or_default();
            let task_scratchpad_key = swarm.tasks.iter().find(|t| &t.id == task_id)
                .and_then(|t| t.scratchpad_key.clone());

            if let Some(agent_id) = agent_id_opt {
                let (agent_status, agent_result) = {
                    let q = queue.lock().await;
                    let status = q.get(agent_id).map(|a| a.status.clone());
                    let result = q.get(agent_id).and_then(|a| {
                        a.steps.iter()
                            .filter(|s| s.status == StepStatus::Completed)
                            .last()
                            .and_then(|s| s.result.clone())
                    });
                    (status, result)
                };

                match agent_status {
                    Some(AgentStatus::Completed) => {
                        let result = agent_result.unwrap_or_else(|| "Task completed.".to_string());
                        swarm::update_task_status(
                            task_id,
                            &SwarmTaskStatus::Completed,
                            None,
                            Some(&result),
                            None,
                        );

                        // Write typed ScratchpadEntry so downstream tasks have provenance
                        if let Some(key) = &task_scratchpad_key {
                            let entry = ScratchpadEntry {
                                key: key.clone(),
                                value: result.clone(),
                                source_task: task_id.clone(),
                                timestamp: chrono::Utc::now().timestamp(),
                            };
                            swarm::write_scratchpad_entry(swarm_id, entry);
                            let _ = app.emit("swarm_scratchpad_updated", serde_json::json!({
                                "swarm_id": swarm_id, "key": key, "source_task": task_id
                            }));
                        }

                        let result_end = result.char_indices().nth(200).map(|(i, _)| i).unwrap_or(result.len());
                        let _ = app.emit("swarm_task_completed", serde_json::json!({
                            "swarm_id": swarm_id,
                            "task_id": task_id,
                            "result_preview": &result[..result_end],
                        }));

                        // Emit progress after each completion
                        emit_progress(swarm_id, app);
                    }
                    Some(AgentStatus::Failed) => {
                        let error = {
                            let q = queue.lock().await;
                            q.get(agent_id).and_then(|a| a.error.clone()).unwrap_or_else(|| "Agent failed".to_string())
                        };
                        swarm::update_task_status(
                            task_id,
                            &SwarmTaskStatus::Failed,
                            None,
                            None,
                            Some(&error),
                        );

                        // evo-hq pattern: annotate failure to shared scratchpad so
                        // other agents avoid repeating the same mistake
                        let failure_key = format!("_failed:{}", crate::safe_slice(task_id, 8));
                        let error_end = error.char_indices().nth(200).map(|(i, _)| i).unwrap_or(error.len());
                        let failure_note = format!(
                            "Task '{}' failed: {}. Avoid this approach.",
                            task_title, &error[..error_end]
                        );
                        swarm.scratchpad.insert(failure_key, failure_note);
                        swarm::update_swarm_scratchpad(swarm_id, &swarm.scratchpad);

                        let _ = app.emit("swarm_task_failed", serde_json::json!({
                            "swarm_id": swarm_id,
                            "task_id": task_id,
                            "error": &error,
                        }));

                        // Emit progress after failure too
                        emit_progress(swarm_id, app);
                    }
                    _ => {} // still running
                }
            }
        }

        // Reload to get updated statuses
        swarm = match swarm::load_swarm(swarm_id) {
            Some(s) => s,
            None => break,
        };

        let tasks = &swarm.tasks;

        // 2. Check if all tasks are done
        let all_done = tasks.iter().all(|t| matches!(t.status, SwarmTaskStatus::Completed | SwarmTaskStatus::Failed));
        if all_done {
            // Pass all typed scratchpad entries to synthesis so the final result is richer
            let final_result = crate::swarm_planner::synthesize_final_result_with_scratchpad(
                &config.provider,
                &config.api_key,
                &config.model,
                config.base_url.as_deref(),
                &swarm.goal,
                tasks,
                &swarm.scratchpad_entries,
            )
            .await;

            swarm::update_swarm_status(swarm_id, &SwarmStatus::Completed, Some(&final_result));
            let preview_end = final_result.char_indices().nth(300).map(|(i, _)| i).unwrap_or(final_result.len());
            let _ = app.emit("swarm_completed", serde_json::json!({
                "swarm_id": swarm_id,
                "final_result_preview": &final_result[..preview_end],
            }));
            emit_progress(swarm_id, app);
            break;
        }

        // 3. Resolve and launch ready tasks
        let ready_ids = resolve_ready_tasks(tasks);
        if ready_ids.is_empty() {
            emit_progress(swarm_id, app);
            continue;
        }

        for task_id in ready_ids {
            if let Some(task) = tasks.iter().find(|t| t.id == task_id) {
                match spawn_task_agent(task, &swarm, queue, mcp, app).await {
                    Ok(agent_id) => {
                        swarm::update_task_status(
                            &task_id,
                            &SwarmTaskStatus::Running,
                            Some(&agent_id),
                            None,
                            None,
                        );
                        let _ = app.emit("swarm_task_started", serde_json::json!({
                            "swarm_id": swarm_id,
                            "task_id": &task_id,
                            "agent_id": &agent_id,
                            "role": task.role.clone(),
                        }));
                    }
                    Err(e) => {
                        swarm::update_task_status(
                            &task_id,
                            &SwarmTaskStatus::Failed,
                            None,
                            None,
                            Some(&e),
                        );
                        let _ = app.emit("swarm_task_failed", serde_json::json!({
                            "swarm_id": swarm_id,
                            "task_id": &task_id,
                            "error": &e,
                        }));
                    }
                }
            }
        }

        emit_progress(swarm_id, app);
    }
}

// ---------------------------------------------------------------------------
// Progress helper
// ---------------------------------------------------------------------------

/// Emit a rich swarm_progress event to the frontend.
fn emit_progress(swarm_id: &str, app: &tauri::AppHandle) {
    if let Some(progress) = get_swarm_progress(swarm_id) {
        let _ = app.emit("swarm_progress", serde_json::json!({
            "swarm_id": swarm_id,
            "total": progress.total,
            "completed": progress.completed,
            "running": progress.running,
            "failed": progress.failed,
            "pending": progress.pending,
            "percent": progress.percent,
            "estimated_seconds_remaining": progress.estimated_seconds_remaining,
        }));
    }
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

/// Create and start a new swarm for a goal.
#[tauri::command]
pub async fn swarm_create(
    app: tauri::AppHandle,
    queue: tauri::State<'_, SharedAgentQueue>,
    mcp: tauri::State<'_, SharedMcpManager>,
    goal: String,
) -> Result<Swarm, String> {
    let config = crate::config::load_config();
    if config.api_key.is_empty() && config.provider != "ollama" {
        return Err("No API key configured. Set one in Settings.".to_string());
    }

    let swarm_id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().timestamp();

    // Get available tools so the planner can reason about them
    let available_tools = {
        let manager = mcp.lock().await;
        manager.get_tools().to_vec()
    };

    // Decompose goal into tasks — smarter planner with tool awareness
    let tasks = crate::swarm_planner::decompose_goal_to_dag_with_tools(
        &config.provider,
        &config.api_key,
        &config.model,
        config.base_url.as_deref(),
        &swarm_id,
        &goal,
        &available_tools,
    )
    .await?;

    let task_count = tasks.len();

    let swarm = Swarm {
        id: swarm_id.clone(),
        goal: goal.clone(),
        status: SwarmStatus::Running,
        scratchpad: Default::default(),
        scratchpad_entries: Vec::new(),
        final_result: None,
        tasks: tasks.clone(),
        created_at: now,
        updated_at: now,
    };

    // Persist swarm + tasks
    swarm::save_swarm(&swarm);
    for task in &tasks {
        swarm::save_swarm_task(task);
    }

    // Emit created event
    let _ = app.emit("swarm_created", serde_json::json!({
        "swarm_id": &swarm_id,
        "goal": &goal,
        "task_count": task_count,
    }));

    // Start coordinator
    start_swarm_coordinator(
        swarm_id,
        queue.inner().clone(),
        mcp.inner().clone(),
        app,
    );

    Ok(swarm)
}

#[tauri::command]
pub fn swarm_list(limit: Option<usize>) -> Vec<Swarm> {
    swarm::list_swarms(limit.unwrap_or(20))
}

#[tauri::command]
pub fn swarm_get(swarm_id: String) -> Option<Swarm> {
    swarm::load_swarm(&swarm_id)
}

#[tauri::command]
pub fn swarm_pause(swarm_id: String) -> Result<(), String> {
    swarm::update_swarm_status(&swarm_id, &SwarmStatus::Paused, None);
    Ok(())
}

#[tauri::command]
pub async fn swarm_resume(
    app: tauri::AppHandle,
    queue: tauri::State<'_, SharedAgentQueue>,
    mcp: tauri::State<'_, SharedMcpManager>,
    swarm_id: String,
) -> Result<(), String> {
    swarm::update_swarm_status(&swarm_id, &SwarmStatus::Running, None);
    start_swarm_coordinator(
        swarm_id,
        queue.inner().clone(),
        mcp.inner().clone(),
        app,
    );
    Ok(())
}

#[tauri::command]
pub fn swarm_cancel(swarm_id: String) -> Result<(), String> {
    swarm::update_swarm_status(&swarm_id, &SwarmStatus::Failed, Some("Cancelled by user"));
    Ok(())
}

#[tauri::command]
pub fn swarm_write_scratchpad(swarm_id: String, key: String, value: String) -> Result<(), String> {
    let mut swarm = swarm::load_swarm(&swarm_id).ok_or("Swarm not found")?;
    swarm.scratchpad.insert(key.clone(), value.clone());
    swarm::update_swarm_scratchpad(&swarm_id, &swarm.scratchpad);
    Ok(())
}

/// Write a typed scratchpad entry with provenance (source_task, timestamp).
#[tauri::command]
pub fn swarm_write_scratchpad_entry(
    swarm_id: String,
    key: String,
    value: String,
    source_task: String,
) -> Result<(), String> {
    let entry = ScratchpadEntry {
        key,
        value,
        source_task,
        timestamp: chrono::Utc::now().timestamp(),
    };
    if swarm::write_scratchpad_entry(&swarm_id, entry) {
        Ok(())
    } else {
        Err("Failed to write scratchpad entry".to_string())
    }
}

#[tauri::command]
pub fn swarm_read_scratchpad(swarm_id: String, key: String) -> Option<String> {
    swarm::load_swarm(&swarm_id)?.scratchpad.remove(&key)
}

/// Get real-time progress snapshot for a swarm — rich data for the frontend.
#[tauri::command]
pub fn swarm_get_progress(swarm_id: String) -> Option<swarm::SwarmProgress> {
    swarm::get_swarm_progress(&swarm_id)
}
