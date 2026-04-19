use super::{Agent, AgentStatus, StepStatus};
use crate::mcp::McpManager;
use crate::providers::{self, ChatMessage};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::Mutex;

/// Maximum number of retry attempts per step (including the first attempt).
const MAX_RETRIES: u32 = 3;

// ---------------------------------------------------------------------------
// Tool fallback map — when a tool errors, try this alternative
// ---------------------------------------------------------------------------

/// Return an alternative tool name to try if `failed_tool` errors out.
fn tool_fallback(failed_tool: &str) -> Option<&'static str> {
    match failed_tool {
        // If we can't read a file, try bash cat
        "blade_read_file" | "read_file" | "filesystem_read_file" => Some("blade_bash"),
        // If web fetch fails, try search
        "blade_fetch_url" | "fetch_url" | "web_fetch" => Some("blade_web_search"),
        // If write fails, try bash redirect
        "blade_write_file" | "write_file" | "filesystem_write_file" => Some("blade_bash"),
        // If bash fails, try a thinking step (no tool)
        "blade_bash" | "bash" => None,
        _ => None,
    }
}

/// Build alternative tool_args for a fallback tool based on the original intent.
fn build_fallback_args(
    original_tool: &str,
    original_args: &serde_json::Value,
    fallback_tool: &str,
    step_desc: &str,
) -> serde_json::Value {
    match (original_tool, fallback_tool) {
        ("blade_read_file" | "read_file" | "filesystem_read_file", "blade_bash") => {
            let path = original_args["path"]
                .as_str()
                .or_else(|| original_args["file_path"].as_str())
                .unwrap_or("unknown");
            serde_json::json!({ "command": format!("cat '{}'", path) })
        }
        ("blade_fetch_url" | "fetch_url" | "web_fetch", "blade_web_search") => {
            serde_json::json!({ "query": step_desc })
        }
        ("blade_write_file" | "write_file" | "filesystem_write_file", "blade_bash") => {
            let path = original_args["path"]
                .as_str()
                .or_else(|| original_args["file_path"].as_str())
                .unwrap_or("output.txt");
            let content = original_args["content"]
                .as_str()
                .unwrap_or("");
            // Write via heredoc — safe for multi-line
            serde_json::json!({
                "command": format!("cat > '{}' << 'BLADE_EOF'\n{}\nBLADE_EOF", path, content)
            })
        }
        _ => original_args.clone(),
    }
}

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
    let _ = app.emit_to("main", "agent_step_started",
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

    // --- Reflexion + error-recovery retry loop ---
    let mut last_error = String::new();
    let mut succeeded = false;
    let mut final_output = String::new();

    // Track the active tool for this attempt (may switch to fallback on tool error)
    let mut active_tool = tool_name.clone();
    let mut active_args = tool_args.clone();
    let mut tool_fallback_used = false;

    // Provider fallback chain for LLM errors
    let config = crate::config::load_config();
    let fallback_providers: Vec<(String, String)> = config
        .fallback_providers
        .iter()
        .filter_map(|p| {
            let key = crate::config::get_provider_key(p);
            if !key.is_empty() || p == "ollama" {
                Some((p.clone(), key))
            } else {
                None
            }
        })
        .collect();
    // provider_idx: 0 = primary, 1..=N = fallback_providers[0..N-1]
    let mut provider_idx: usize = 0;
    // Count only genuine retries (not tool/provider switches) to bound the loop.
    let mut real_attempts: u32 = 0;
    // Guard against degenerate infinite loops (e.g. provider chain longer than MAX_RETRIES).
    let max_total_iterations = MAX_RETRIES + fallback_providers.len() as u32 + 2;
    let mut total_iterations: u32 = 0;

    while real_attempts < MAX_RETRIES {
        total_iterations += 1;
        if total_iterations > max_total_iterations {
            // Safety valve: should never be hit in normal operation
            last_error = "Internal: executor loop exceeded maximum iteration guard.".to_string();
            break;
        }

        let (current_provider, current_api_key) = if provider_idx == 0 {
            (provider.to_string(), api_key.to_string())
        } else {
            // provider_idx is 1-based into fallback_providers
            fallback_providers
                .get(provider_idx - 1)
                .map(|(p, k)| (p.clone(), k.clone()))
                .unwrap_or_else(|| (provider.to_string(), api_key.to_string()))
        };

        // Emit a retry event on subsequent real attempts so the UI can show it.
        if real_attempts > 0 {
            let _ = app.emit_to("main", "agent_step_retrying",
                serde_json::json!({
                    "agent_id": &agent_id,
                    "step_id": &step_id,
                    "attempt": real_attempts,
                    "reflection": reflections.last().cloned().unwrap_or_default(),
                    "fallback_tool": if tool_fallback_used { active_tool.as_deref() } else { None },
                    "fallback_provider": if provider_idx > 0 { Some(&current_provider) } else { None },
                }),
            );
        }

        let result = attempt_step(
            &step_desc,
            &active_tool,
            &active_args,
            &goal,
            &prior_results,
            &reflections,
            mcp,
            &current_provider,
            &current_api_key,
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

                let is_tool_error = error.starts_with("Tool error:")
                    || error.contains("not found")
                    || error.contains("failed to call tool")
                    || error.contains("tool error");
                let is_llm_error = error.contains("429")
                    || error.contains("503")
                    || error.contains("rate limit")
                    || error.contains("overloaded")
                    || error.contains("timeout")
                    || error.contains("API error");

                // Tool error → switch to a fallback tool first.
                // This does NOT consume a real attempt — we want MAX_RETRIES genuine tries.
                if is_tool_error && !tool_fallback_used {
                    if let Some(orig_tool) = &tool_name {
                        if let Some(fb_tool) = tool_fallback(orig_tool) {
                            let fb_args = build_fallback_args(
                                orig_tool,
                                active_args.as_ref().unwrap_or(&serde_json::json!({})),
                                fb_tool,
                                &step_desc,
                            );
                            active_tool = Some(fb_tool.to_string());
                            active_args = Some(fb_args);
                            tool_fallback_used = true;
                            // Phase 3 WIRE-05 (Plan 03-01, D-64): the agent_step_* family
                            // (tool_fallback / provider_fallback / partial / completed / failed)
                            // uses emit_to("main", ...) per D-14 — verified by grep in Plan
                            // 03-01 Task 2c. Phase 5 wires the UI consumer. No raw broadcast
                            // emits exist in this file; executor.rs uses semantic event names.
                            let _ = app.emit_to("main", "agent_step_tool_fallback",
                                serde_json::json!({
                                    "agent_id": &agent_id,
                                    "step_id": &step_id,
                                    "original_tool": orig_tool,
                                    "fallback_tool": fb_tool,
                                }),
                            );
                            continue; // does not increment real_attempts
                        }
                    }
                    // No named fallback — degrade to a pure thinking step (no tool).
                    if active_tool.is_some() {
                        active_tool = None;
                        active_args = None;
                        tool_fallback_used = true;
                        continue; // does not increment real_attempts
                    }
                }

                // LLM / rate-limit error → advance to next provider in chain.
                // Also does NOT consume a real attempt.
                if is_llm_error && provider_idx < fallback_providers.len() {
                    provider_idx += 1;
                    let _ = app.emit_to("main", "agent_step_provider_fallback",
                        serde_json::json!({
                            "agent_id": &agent_id,
                            "step_id": &step_id,
                            "failed_provider": &current_provider,
                            "next_provider": fallback_providers.get(provider_idx - 1).map(|(p, _)| p),
                        }),
                    );
                    continue; // does not increment real_attempts
                }

                // Count this as a genuine failed attempt.
                real_attempts += 1;

                // Don't generate a reflection after the last real attempt — it would
                // never be used and wastes tokens.
                if real_attempts < MAX_RETRIES {
                    let reflection = generate_reflection(
                        &error,
                        &step_desc,
                        real_attempts,
                        &current_provider,
                        &current_api_key,
                        model,
                        base_url,
                    )
                    .await;
                    reflections.push(reflection);
                }
            }
        }
    }

    // If all 3 attempts failed but we have partial results from prior steps,
    // synthesize a graceful partial result rather than killing the whole agent.
    if !succeeded && !prior_results.is_empty() {
        let partial = synthesize_partial_result(
            &last_error,
            &step_desc,
            &prior_results,
            provider,
            api_key,
            model,
            base_url,
        )
        .await;
        // Emit a warning but treat as a soft success so dependent tasks can still run
        let _ = app.emit_to("main", "agent_step_partial",
            serde_json::json!({
                "agent_id": &agent_id,
                "step_id": &step_id,
                "error": &last_error,
                "partial_result": &partial,
            }),
        );
        final_output = format!("[PARTIAL — step failed, using best available: {}] {}", last_error.chars().take(100).collect::<String>(), partial);
        succeeded = true;
    }

    // Persist the (possibly extended) reflections back onto the step so they
    // survive if the agent is serialised/restored.
    agent.steps[idx].reflections = reflections;
    agent.steps[idx].completed_at = Some(chrono::Utc::now().timestamp_millis());

    if succeeded {
        agent.steps[idx].status = StepStatus::Completed;
        agent.steps[idx].result = Some(final_output.clone());

        let _ = app.emit_to("main", "agent_step_completed",
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

        let _ = app.emit_to("main", "agent_step_failed",
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

        match providers::complete_turn(provider, api_key, model, &conversation, &crate::providers::no_tools(), base_url).await {
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

    match providers::complete_turn(provider, api_key, &cheap_model, &conversation, &crate::providers::no_tools(), base_url).await {
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

/// When a step fails all retries but prior results exist, ask the LLM to
/// synthesize the best partial answer it can from what has been completed so far.
/// This prevents a single failed step from killing the entire swarm task.
async fn synthesize_partial_result(
    error: &str,
    step_desc: &str,
    prior_results: &str,
    provider: &str,
    api_key: &str,
    model: &str,
    base_url: Option<&str>,
) -> String {
    let cheap_model = crate::config::cheap_model_for_provider(provider, model);

    let prompt = format!(
        "I was trying to {} but it failed with error: {}\n\n\
         Here are the results from the steps I completed before this failure:\n{}\n\n\
         Based on what was successfully completed, provide the best partial answer you can. \
         Be explicit about what was not completed and why. Be concise.",
        step_desc, truncate(error, 200), truncate(prior_results, 600),
    );

    let messages = vec![ChatMessage {
        role: "user".to_string(),
        content: prompt,
        image_base64: None,
    }];
    let conversation = providers::build_conversation(messages, None);

    match providers::complete_turn(provider, api_key, &cheap_model, &conversation, &crate::providers::no_tools(), base_url).await {
        Ok(turn) => turn.content,
        Err(_) => format!(
            "Step '{}' failed: {}. Partial results from earlier steps are available above.",
            step_desc, truncate(error, 150)
        ),
    }
}
