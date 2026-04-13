/// BLADE Swarm Commands — Tauri commands + coordinator loop
///
/// The coordinator loop polls every 2 seconds:
///   1. Check running agents for completion
///   2. Mark done/failed tasks
///   3. Resolve newly ready tasks
///   4. Spawn agents for ready tasks (up to 5 concurrent)
///   5. When all done: synthesize final result

use crate::agents::{planner, Agent, AgentStatus, StepStatus};
use crate::commands::SharedMcpManager;
use crate::agents::queue::SharedAgentQueue;
use crate::swarm::{
    self, build_task_context, resolve_ready_tasks, SwarmStatus, SwarmTaskStatus, SwarmTask, Swarm,
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

    // Build enriched goal with dependency context
    let enriched_goal = build_task_context(swarm, task);

    // Plan steps
    let tools = {
        let manager = mcp.lock().await;
        manager.get_tools().to_vec()
    };

    let steps = planner::plan_steps(
        &config.provider,
        &config.api_key,
        &config.model,
        config.base_url.as_deref(),
        &enriched_goal,
        &tools,
    )
    .await
    .unwrap_or_default();

    let agent_id = uuid::Uuid::new_v4().to_string();
    let mut agent = Agent::new(agent_id.clone(), enriched_goal);
    agent.steps = steps;
    agent.status = AgentStatus::Executing;

    {
        let mut q = queue.lock().await;
        q.add(agent);
    }

    // Run the agent in background
    let queue_clone = queue.clone();
    let mcp_clone = mcp.clone();
    let app_clone = app.clone();
    let provider = config.provider.clone();
    let api_key = config.api_key.clone();
    let model = config.model.clone();
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
        for task in swarm.tasks.iter().filter(|t| t.status == SwarmTaskStatus::Running) {
            if let Some(agent_id) = &task.agent_id {
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
                            &task.id,
                            &SwarmTaskStatus::Completed,
                            None,
                            Some(&result),
                            None,
                        );
                        // Write to scratchpad if task has a key
                        if let Some(key) = &task.scratchpad_key {
                            swarm.scratchpad.insert(key.clone(), result.clone());
                            swarm::update_swarm_scratchpad(swarm_id, &swarm.scratchpad);
                            let _ = app.emit("swarm_scratchpad_updated", serde_json::json!({
                                "swarm_id": swarm_id, "key": key
                            }));
                        }
                        let _ = app.emit("swarm_task_completed", serde_json::json!({
                            "swarm_id": swarm_id,
                            "task_id": &task.id,
                            "result_preview": &result[..result.len().min(200)],
                        }));
                    }
                    Some(AgentStatus::Failed) => {
                        let error = {
                            let q = queue.lock().await;
                            q.get(agent_id).and_then(|a| a.error.clone()).unwrap_or_else(|| "Agent failed".to_string())
                        };
                        swarm::update_task_status(
                            &task.id,
                            &SwarmTaskStatus::Failed,
                            None,
                            None,
                            Some(&error),
                        );

                        // evo-hq pattern: annotate failure to shared scratchpad so
                        // other agents avoid repeating the same mistake
                        let failure_key = format!("_failed:{}", &task.id[..task.id.len().min(8)]);
                        let failure_note = format!(
                            "Task '{}' failed: {}. Avoid this approach.",
                            task.title, &error[..error.len().min(200)]
                        );
                        swarm.scratchpad.insert(failure_key, failure_note);
                        swarm::update_swarm_scratchpad(swarm_id, &swarm.scratchpad);

                        let _ = app.emit("swarm_task_failed", serde_json::json!({
                            "swarm_id": swarm_id,
                            "task_id": &task.id,
                            "error": &error,
                        }));
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
            // Synthesize final result
            let final_result = crate::swarm_planner::synthesize_final_result(
                &config.provider,
                &config.api_key,
                &config.model,
                config.base_url.as_deref(),
                &swarm.goal,
                tasks,
            )
            .await;

            swarm::update_swarm_status(swarm_id, &SwarmStatus::Completed, Some(&final_result));
            let _ = app.emit("swarm_completed", serde_json::json!({
                "swarm_id": swarm_id,
                "final_result_preview": &final_result[..final_result.len().min(300)],
            }));
            break;
        }

        // 3. Resolve and launch ready tasks
        let ready_ids = resolve_ready_tasks(tasks);
        if ready_ids.is_empty() {
            // Emit progress
            let completed = tasks.iter().filter(|t| t.status == SwarmTaskStatus::Completed).count();
            let total = tasks.len();
            let _ = app.emit("swarm_progress", serde_json::json!({
                "swarm_id": swarm_id,
                "completed": completed,
                "total": total,
                "percent": (completed * 100) / total.max(1),
            }));
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

        // Emit updated progress
        let completed = tasks.iter().filter(|t| t.status == SwarmTaskStatus::Completed).count();
        let total = tasks.len();
        let _ = app.emit("swarm_progress", serde_json::json!({
            "swarm_id": swarm_id,
            "completed": completed,
            "total": total,
            "percent": (completed * 100) / total.max(1),
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

    // Decompose goal into tasks
    let tasks = crate::swarm_planner::decompose_goal_to_dag(
        &config.provider,
        &config.api_key,
        &config.model,
        config.base_url.as_deref(),
        &swarm_id,
        &goal,
    )
    .await?;

    let task_count = tasks.len();

    let swarm = Swarm {
        id: swarm_id.clone(),
        goal: goal.clone(),
        status: SwarmStatus::Running,
        scratchpad: Default::default(),
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
    swarm.scratchpad.insert(key, value);
    swarm::update_swarm_scratchpad(&swarm_id, &swarm.scratchpad);
    Ok(())
}

#[tauri::command]
pub fn swarm_read_scratchpad(swarm_id: String, key: String) -> Option<String> {
    swarm::load_swarm(&swarm_id)?.scratchpad.remove(&key)
}
