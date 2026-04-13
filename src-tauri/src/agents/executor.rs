use super::{Agent, AgentStatus, StepStatus};
use crate::mcp::McpManager;
use crate::providers::{self, ChatMessage};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex;

/// Execute the next pending step of an agent
pub async fn execute_next_step(
    agent: &mut Agent,
    mcp: &Arc<Mutex<McpManager>>,
    app: &AppHandle,
    provider: &str,
    api_key: &str,
    model: &str,
    base_url: Option<&str>,
) -> Result<(), String> {
    let idx = agent.current_step;
    if idx >= agent.steps.len() {
        agent.status = AgentStatus::Completed;
        return Ok(());
    }

    if agent.steps[idx].status != StepStatus::Pending {
        return Ok(());
    }

    // Mark running
    agent.steps[idx].status = StepStatus::Running;
    agent.steps[idx].started_at = Some(chrono::Utc::now().timestamp_millis());
    agent.status = AgentStatus::Executing;

    let step_id = agent.steps[idx].id.clone();
    let step_desc = agent.steps[idx].description.clone();
    let tool_name = agent.steps[idx].tool_name.clone();
    let tool_args = agent.steps[idx].tool_args.clone();
    let agent_id = agent.id.clone();
    let goal = agent.goal.clone();

    // Emit progress
    let _ = app.emit(
        "agent_step_started",
        serde_json::json!({
            "agent_id": &agent_id,
            "step_id": &step_id,
            "description": &step_desc,
        }),
    );

    // Execute
    let result = if let Some(tool) = &tool_name {
        let args = tool_args.unwrap_or(serde_json::json!({}));
        let mut manager = mcp.lock().await;
        match manager.call_tool(tool, args).await {
            Ok(tool_result) => {
                let text: String = tool_result
                    .content
                    .iter()
                    .filter_map(|c| c.text.clone())
                    .collect::<Vec<_>>()
                    .join("\n");
                if tool_result.is_error {
                    Err(format!("Tool error: {}", text))
                } else {
                    Ok(text)
                }
            }
            Err(e) => Err(e),
        }
    } else {
        // Thinking step
        let context_summary: String = agent
            .steps
            .iter()
            .filter(|s| s.status == StepStatus::Completed)
            .filter_map(|s| {
                s.result
                    .as_ref()
                    .map(|r| format!("- {}: {}", s.description, truncate(r, 200)))
            })
            .collect::<Vec<_>>()
            .join("\n");

        let prompt = format!(
            "Goal: {}\n\nCompleted so far:\n{}\n\nCurrent step: {}\n\nExecute this step. Be concise.",
            goal,
            if context_summary.is_empty() { "None yet".to_string() } else { context_summary },
            step_desc,
        );

        let messages = vec![ChatMessage {
            role: "user".to_string(),
            content: prompt,
            image_base64: None,
        }];
        let conversation = providers::build_conversation(messages, None);

        match providers::complete_turn(provider, api_key, model, &conversation, &[], base_url).await {
            Ok(turn) => Ok(turn.content),
            Err(e) => Err(e),
        }
    };

    // Update step
    agent.steps[idx].completed_at = Some(chrono::Utc::now().timestamp_millis());

    match result {
        Ok(output) => {
            agent.steps[idx].status = StepStatus::Completed;
            agent.steps[idx].result = Some(output.clone());

            let _ = app.emit(
                "agent_step_completed",
                serde_json::json!({
                    "agent_id": &agent_id,
                    "step_id": &step_id,
                    "result": truncate(&output, 500),
                }),
            );

            agent.advance();
        }
        Err(error) => {
            agent.steps[idx].status = StepStatus::Failed;
            agent.steps[idx].result = Some(error.clone());

            let _ = app.emit(
                "agent_step_failed",
                serde_json::json!({
                    "agent_id": &agent_id,
                    "step_id": &step_id,
                    "error": &error,
                }),
            );

            agent.fail(error);
        }
    }

    Ok(())
}

fn truncate(s: &str, max: usize) -> String {
    if s.len() > max {
        let end = s.char_indices().nth(max).map(|(i, _)| i).unwrap_or(s.len());
        format!("{}...", &s[..end])
    } else {
        s.to_string()
    }
}
