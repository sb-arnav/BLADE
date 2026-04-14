use super::{Agent, AgentStatus, StepStatus};
use crate::mcp::McpManager;
use crate::providers::{self, ChatMessage};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex;

/// Maximum number of retry attempts per step (including the first attempt).
const MAX_RETRIES: u32 = 3;

/// Execute the next pending step of an agent.
/// Public signature is unchanged — callers pass the same arguments as before.
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

    // Build a summary of already-completed steps to use as context.
    let prior_results: String = agent
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

    // Reflections are read from the step (persisted across calls) and extended
    // during this execution.  We clone the existing vec so we can hand mutable
    // ownership to the retry loop while still being able to write back later.
    let mut reflections: Vec<String> = agent.steps[idx].reflections.clone();

    // --- Reflexion retry loop ---
    let mut last_error = String::new();
    let mut succeeded = false;
    let mut final_output = String::new();

    for attempt in 0..MAX_RETRIES {
        // Emit a retry event on subsequent attempts so the UI can show it.
        if attempt > 0 {
            let _ = app.emit(
                "agent_step_retrying",
                serde_json::json!({
                    "agent_id": &agent_id,
                    "step_id": &step_id,
                    "attempt": attempt,
                    "reflection": reflections.last().cloned().unwrap_or_default(),
                }),
            );
        }

        let result = attempt_step(
            &step_desc,
            &tool_name,
            &tool_args,
            &goal,
            &prior_results,
            &reflections,
            mcp,
            provider,
            api_key,
            model,
            base_url,
        )
        .await;

        match result {
            Ok(output) => {
                final_output = output;
                succeeded = true;
                break;
            }
            Err(error) => {
                last_error = error.clone();

                // Don't generate a reflection after the last attempt — it would
                // never be used and wastes tokens.
                if attempt + 1 < MAX_RETRIES {
                    let reflection = generate_reflection(
                        &error,
                        &step_desc,
                        attempt + 1,
                        provider,
                        api_key,
                        model,
                        base_url,
                    )
                    .await;
                    reflections.push(reflection);
                }
            }
        }
    }

    // Persist the (possibly extended) reflections back onto the step so they
    // survive if the agent is serialised/restored.
    agent.steps[idx].reflections = reflections;
    agent.steps[idx].completed_at = Some(chrono::Utc::now().timestamp_millis());

    if succeeded {
        agent.steps[idx].status = StepStatus::Completed;
        agent.steps[idx].result = Some(final_output.clone());

        let _ = app.emit(
            "agent_step_completed",
            serde_json::json!({
                "agent_id": &agent_id,
                "step_id": &step_id,
                "result": truncate(&final_output, 500),
            }),
        );

        agent.advance();
    } else {
        agent.steps[idx].status = StepStatus::Failed;
        agent.steps[idx].result = Some(last_error.clone());

        let _ = app.emit(
            "agent_step_failed",
            serde_json::json!({
                "agent_id": &agent_id,
                "step_id": &step_id,
                "error": &last_error,
                "attempts": MAX_RETRIES,
            }),
        );

        agent.fail(last_error);
    }

    Ok(())
}

/// One attempt at executing a step, with reflections from prior attempts
/// injected into the thinking-step prompt.
async fn attempt_step(
    step_desc: &str,
    tool_name: &Option<String>,
    tool_args: &Option<serde_json::Value>,
    goal: &str,
    prior_results: &str,
    reflections: &[String],
    mcp: &Arc<Mutex<McpManager>>,
    provider: &str,
    api_key: &str,
    model: &str,
    base_url: Option<&str>,
) -> Result<String, String> {
    if let Some(tool) = tool_name {
        // Tool execution — reflections are not injected here because the args
        // are pre-determined. Future work could re-plan args using reflections.
        let args = tool_args.clone().unwrap_or(serde_json::json!({}));
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
        // Thinking step — build a prompt that includes any prior reflections
        // so the model learns from previous failures (the Reflexion scratchpad).
        let reflection_block = if reflections.is_empty() {
            String::new()
        } else {
            let entries = reflections
                .iter()
                .enumerate()
                .map(|(i, r)| format!("Attempt {}: {}", i + 1, r))
                .collect::<Vec<_>>()
                .join("\n");
            format!("\n\nPrevious attempts and what I learned:\n{}", entries)
        };

        let prompt = format!(
            "Goal: {}\n\nCompleted so far:\n{}\n\nCurrent step: {}{}\n\nExecute this step. Be concise.",
            goal,
            if prior_results.is_empty() { "None yet" } else { prior_results },
            step_desc,
            reflection_block,
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
    }
}

/// Ask the LLM what went wrong and what to try differently.
/// Uses the cheapest available model since this is background/ambient work.
/// Returns a generic fallback string if the LLM call itself fails.
async fn generate_reflection(
    error: &str,
    step_desc: &str,
    attempt: u32,
    provider: &str,
    api_key: &str,
    model: &str,
    base_url: Option<&str>,
) -> String {
    let cheap_model = crate::config::cheap_model_for_provider(provider, model);

    let prompt = format!(
        "I tried to {} but got this error on attempt {}: {}\n\nWhat went wrong? What should I try differently next time? Be brief (2-3 sentences).",
        step_desc, attempt, error,
    );

    let messages = vec![ChatMessage {
        role: "user".to_string(),
        content: prompt,
        image_base64: None,
    }];
    let conversation = providers::build_conversation(messages, None);

    match providers::complete_turn(provider, api_key, &cheap_model, &conversation, &[], base_url).await {
        Ok(turn) => turn.content,
        Err(_) => format!(
            "Attempt {} failed with: {}. Will try a different approach.",
            attempt, truncate(error, 100)
        ),
    }
}

fn truncate(s: &str, max: usize) -> String {
    if s.len() > max {
        let end = s.char_indices().nth(max).map(|(i, _)| i).unwrap_or(s.len());
        format!("{}...", &s[..end])
    } else {
        s.to_string()
    }
}
