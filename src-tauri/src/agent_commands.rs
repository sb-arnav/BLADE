use crate::agents::{self, planner, executor, queue::SharedAgentQueue, Agent, AgentStatus};
use crate::commands::SharedMcpManager;
use crate::config::load_config;
use crate::mcp::McpTool;

/// Create a new agent with a goal, plan it, and start execution
#[tauri::command]
pub async fn agent_create(
    app: tauri::AppHandle,
    queue: tauri::State<'_, SharedAgentQueue>,
    mcp: tauri::State<'_, SharedMcpManager>,
    goal: String,
) -> Result<String, String> {
    let config = load_config();
    if config.api_key.is_empty() && config.provider != "ollama" {
        return Err("No API key configured.".to_string());
    }

    let id = uuid::Uuid::new_v4().to_string();
    let mut agent = Agent::new(id.clone(), goal.clone());

    // Get available tools
    let tools: Vec<McpTool> = {
        let manager = mcp.lock().await;
        manager.get_tools().to_vec()
    };

    // Plan steps
    let steps = planner::plan_steps(
        &config.provider,
        &config.api_key,
        &config.model,
        &goal,
        &tools,
    )
    .await?;

    agent.steps = steps;
    agent.status = AgentStatus::Executing;

    let agent_id = {
        let mut q = queue.lock().await;
        q.add(agent)
    };

    // Start execution in background
    let queue_clone = queue.inner().clone();
    let mcp_clone = mcp.inner().clone();
    let app_clone = app.clone();
    let provider = config.provider.clone();
    let api_key = config.api_key.clone();
    let model = config.model.clone();

    tokio::spawn(async move {
        run_agent_loop(
            &agent_id,
            &queue_clone,
            &mcp_clone,
            &app_clone,
            &provider,
            &api_key,
            &model,
        )
        .await;
    });

    Ok(id)
}

async fn run_agent_loop(
    agent_id: &str,
    queue: &SharedAgentQueue,
    mcp: &SharedMcpManager,
    app: &tauri::AppHandle,
    provider: &str,
    api_key: &str,
    model: &str,
) {
    use tauri::Emitter;

    loop {
        let should_continue = {
            let q = queue.lock().await;
            match q.get(agent_id) {
                Some(a) => a.status == AgentStatus::Executing,
                None => false,
            }
        };

        if !should_continue {
            break;
        }

        {
            let mut q = queue.lock().await;
            if let Some(agent) = q.get_mut(agent_id) {
                if let Err(e) = executor::execute_next_step(
                    agent, mcp, app, provider, api_key, model,
                )
                .await
                {
                    agent.fail(e);
                    break;
                }
            }
        }

        // Small delay between steps
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
    }

    // Emit completion
    let status = {
        let q = queue.lock().await;
        q.get(agent_id).map(|a| a.status.clone())
    };

    let _ = app.emit("agent_completed", serde_json::json!({
        "agent_id": agent_id,
        "status": format!("{:?}", status.unwrap_or(AgentStatus::Failed)),
    }));
}

#[tauri::command]
pub async fn agent_list(
    queue: tauri::State<'_, SharedAgentQueue>,
) -> Result<Vec<Agent>, String> {
    let q = queue.lock().await;
    Ok(q.list().into_iter().cloned().collect())
}

#[tauri::command]
pub async fn agent_get(
    queue: tauri::State<'_, SharedAgentQueue>,
    agent_id: String,
) -> Result<Agent, String> {
    let q = queue.lock().await;
    q.get(&agent_id).cloned().ok_or("Agent not found".to_string())
}

#[tauri::command]
pub async fn agent_pause(
    queue: tauri::State<'_, SharedAgentQueue>,
    agent_id: String,
) -> Result<(), String> {
    let mut q = queue.lock().await;
    q.pause(&agent_id);
    Ok(())
}

#[tauri::command]
pub async fn agent_resume(
    app: tauri::AppHandle,
    queue: tauri::State<'_, SharedAgentQueue>,
    mcp: tauri::State<'_, SharedMcpManager>,
    agent_id: String,
) -> Result<(), String> {
    let config = load_config();

    {
        let mut q = queue.lock().await;
        q.resume(&agent_id);
    }

    let queue_clone = queue.inner().clone();
    let mcp_clone = mcp.inner().clone();
    let app_clone = app.clone();
    let provider = config.provider.clone();
    let api_key = config.api_key.clone();
    let model = config.model.clone();

    tokio::spawn(async move {
        run_agent_loop(
            &agent_id,
            &queue_clone,
            &mcp_clone,
            &app_clone,
            &provider,
            &api_key,
            &model,
        )
        .await;
    });

    Ok(())
}

#[tauri::command]
pub async fn agent_cancel(
    queue: tauri::State<'_, SharedAgentQueue>,
    agent_id: String,
) -> Result<(), String> {
    let mut q = queue.lock().await;
    q.cancel(&agent_id);
    Ok(())
}
