use super::{thought_tree, AgentStep, StepStatus};
use crate::config::load_config;
use crate::mcp::McpTool;
use crate::providers::{self, ChatMessage};

// ---------------------------------------------------------------------------
// Stage 1 output
// ---------------------------------------------------------------------------

/// The full task plan produced by Stage 1 (Task Planning).
/// Carries the step list plus synthesis guidance for Stage 4.
pub struct TaskPlan {
    pub steps: Vec<AgentStep>,
    /// Injected into the Stage-4 synthesizer prompt so it knows how to combine results.
    pub synthesis_prompt: String,
}

// ---------------------------------------------------------------------------
// Stage 1: Task Planning
// ---------------------------------------------------------------------------

/// Ask the LLM to decompose a goal into executable subtasks with dependencies.
/// Also asks the LLM to describe how the results should be synthesized.
#[allow(dead_code)]
pub async fn plan_steps(
    provider: &str,
    api_key: &str,
    model: &str,
    base_url: Option<&str>,
    goal: &str,
    available_tools: &[McpTool],
) -> Result<Vec<AgentStep>, String> {
    let plan = plan_full(provider, api_key, model, base_url, goal, available_tools).await?;
    Ok(plan.steps)
}

/// Full Stage-1 planner that returns a `TaskPlan` with synthesis guidance.
pub async fn plan_full(
    provider: &str,
    api_key: &str,
    model: &str,
    base_url: Option<&str>,
    goal: &str,
    available_tools: &[McpTool],
) -> Result<TaskPlan, String> {
    // If this looks like a complex reasoning task, use Tree-of-Thoughts to find
    // the best approach before generating the step-by-step plan.
    let enhanced_goal: String = if thought_tree::is_complex_task(goal) {
        match thought_tree::tot_plan(goal, provider, api_key, model, base_url, 3).await {
            Ok(best_path) => format!(
                "{}\n\nBest approach identified via multi-path reasoning:\n{}",
                goal, best_path
            ),
            Err(_) => goal.to_string(), // Fall back to original goal on any failure
        }
    } else {
        goal.to_string()
    };
    let effective_goal: &str = &enhanced_goal;

    let tool_list = if available_tools.is_empty() {
        "No MCP tools available. Plan steps that involve thinking, writing, and providing information.".to_string()
    } else {
        let tools: Vec<String> = available_tools
            .iter()
            .map(|t| format!("- {}: {}", t.qualified_name, t.description))
            .collect();
        format!("Available tools:\n{}", tools.join("\n"))
    };

    let prompt = format!(
        r#"You are BLADE's task planner. Break this goal into concrete, executable subtasks.

Goal: {}

{}

Respond with a JSON object with two keys:
1. "steps": array of step objects, each with:
   - "id": unique step ID like "step-1", "step-2", etc.
   - "description": what to do (one sentence)
   - "tool_name": which tool to use (null if no tool needed)
   - "tool_args": arguments for the tool as a JSON object (null if no tool)
   - "dependencies": array of step IDs that must complete before this step ([] if none)

2. "synthesis_prompt": a single sentence describing how to combine all step results into a final answer (e.g. "Combine the research findings and code output into a clear explanation with working code.")

Keep it to 3-8 steps. Be specific and actionable. Use dependency IDs to express sequencing only when truly necessary — prefer parallel steps where possible.

Respond ONLY with the JSON object, no other text."#,
        effective_goal, tool_list
    );

    let messages = vec![ChatMessage {
        role: "user".to_string(),
        content: prompt,
        image_base64: None,
    }];
    let conversation = providers::build_conversation(messages, None);

    let no_tools: &[providers::ToolDefinition] = &[];
    let turn = providers::complete_turn(provider, api_key, model, &conversation, no_tools, base_url).await?;

    // Use the structured output guardrail — repairs markdown fences, trailing commas, etc.
    let parsed: serde_json::Value = crate::providers::extract_and_repair_json(&turn.content)
        .map_err(|e| format!("Failed to parse plan: {}", e))?;

    // Parse synthesis_prompt (fall back to generic if absent)
    let synthesis_prompt = parsed["synthesis_prompt"]
        .as_str()
        .unwrap_or("Combine all step results into a clear, complete final response.")
        .to_string();

    // Parse steps array
    let raw_steps = parsed["steps"]
        .as_array()
        .ok_or_else(|| "Plan JSON missing 'steps' array".to_string())?;

    let steps: Vec<AgentStep> = raw_steps
        .iter()
        .enumerate()
        .map(|(i, s)| {
            // Accept the LLM-generated ID if it's a non-empty string; otherwise synthesize one.
            let id = s["id"]
                .as_str()
                .filter(|v| !v.is_empty())
                .map(|v| v.to_string())
                .unwrap_or_else(|| format!("step-{}", i + 1));

            let dependencies: Vec<String> = s["dependencies"]
                .as_array()
                .map(|arr| {
                    arr.iter()
                        .filter_map(|v| v.as_str().map(|s| s.to_string()))
                        .collect()
                })
                .unwrap_or_default();

            AgentStep {
                id,
                description: s["description"]
                    .as_str()
                    .unwrap_or("Unknown step")
                    .to_string(),
                tool_name: s["tool_name"].as_str().map(|s| s.to_string()),
                tool_args: s.get("tool_args").cloned().filter(|v| !v.is_null()),
                status: StepStatus::Pending,
                result: None,
                started_at: None,
                completed_at: None,
                dependencies,
                reflections: Vec::new(),
            }
        })
        .collect();

    Ok(TaskPlan {
        steps,
        synthesis_prompt,
    })
}

// ---------------------------------------------------------------------------
// Stage 2: Model Selection / Routing
// ---------------------------------------------------------------------------

/// Choose the best (model, optional_tool_override) for a given step.
///
/// Routing rules (keyword-based, matching JARVIS model-selection heuristic):
/// - "code" / "write" / "implement" / "build" / "debug"  → code-routing provider (full capability)
/// - "search" / "research" / "find" / "browse" / "lookup" → fast/cheap provider (speed > quality)
/// - "analyze" / "summarize" / "review" / "compare"       → fast/cheap provider
/// - default                                               → configured provider
///
/// Returns `(model_name, optional_tool_override)`. The tool override is reserved for future
/// cases where a step should be redirected to a specific MCP tool regardless of what the
/// planner wrote (e.g., force a web-search tool for research steps).
#[allow(dead_code)]
pub fn select_model_for_step(
    step: &AgentStep,
    _available_tools: &[McpTool],
) -> (String, Option<String>) {
    let config = load_config();
    let desc = step.description.to_lowercase();

    // Decide which task category this step falls into
    let is_code = desc.contains("code")
        || desc.contains("write")
        || desc.contains("implement")
        || desc.contains("build")
        || desc.contains("debug")
        || desc.contains("refactor");

    let is_fast = desc.contains("search")
        || desc.contains("research")
        || desc.contains("find")
        || desc.contains("lookup")
        || desc.contains("browse")
        || desc.contains("analyze")
        || desc.contains("summarize")
        || desc.contains("review")
        || desc.contains("compare");

    if is_code {
        // Prefer the code-routing provider if configured and has a key
        if let Some(code_provider) = &config.task_routing.code {
            let key = crate::config::get_provider_key(code_provider);
            if !key.is_empty() || code_provider == "ollama" {
                let model = crate::router::suggest_model(code_provider, &crate::router::TaskType::Code)
                    .unwrap_or_else(|| config.model.clone());
                return (model, None);
            }
        }
        // Fall back: use task-appropriate model on active provider
        let model =
            crate::router::suggest_model(&config.provider, &crate::router::TaskType::Code)
                .unwrap_or_else(|| config.model.clone());
        return (model, None);
    }

    if is_fast {
        // Prefer the fast/cheap provider if configured and has a key
        if let Some(fast_provider) = &config.task_routing.fast {
            let key = crate::config::get_provider_key(fast_provider);
            if !key.is_empty() || fast_provider == "ollama" {
                let model = crate::router::suggest_model(fast_provider, &crate::router::TaskType::Simple)
                    .unwrap_or_else(|| crate::config::cheap_model_for_provider(fast_provider, &config.model));
                return (model, None);
            }
        }
        // Fall back: cheap model on active provider
        let model = crate::config::cheap_model_for_provider(&config.provider, &config.model);
        return (model, None);
    }

    // Default: use configured model
    (config.model, None)
}

// ---------------------------------------------------------------------------
// Stage 4: Response Synthesis
// ---------------------------------------------------------------------------

/// Combine all completed step results into a single coherent response.
///
/// Called after all steps of an agent finish. Uses the synthesis_prompt that
/// the Stage-1 planner generated to give context-aware guidance.
pub async fn synthesize_response(
    goal: &str,
    steps: &[AgentStep],
    synthesis_prompt: &str,
    provider: &str,
    api_key: &str,
    model: &str,
    base_url: Option<&str>,
) -> Result<String, String> {
    // Build a structured summary of what each step produced
    let step_summaries: Vec<String> = steps
        .iter()
        .filter(|s| s.status == StepStatus::Completed)
        .map(|s| {
            let result = s
                .result
                .as_deref()
                .unwrap_or("(no output)")
                .chars()
                .take(800)
                .collect::<String>();
            format!("**{}**: {}", s.description, result)
        })
        .collect();

    let failed_steps: Vec<String> = steps
        .iter()
        .filter(|s| s.status == StepStatus::Failed)
        .map(|s| {
            let err = s.result.as_deref().unwrap_or("unknown error");
            format!("- {} (failed: {})", s.description, &err[..err.len().min(200)])
        })
        .collect();

    let summaries_text = if step_summaries.is_empty() {
        "No steps completed successfully.".to_string()
    } else {
        step_summaries.join("\n\n")
    };

    let failures_section = if failed_steps.is_empty() {
        String::new()
    } else {
        format!("\n\nThe following steps failed:\n{}", failed_steps.join("\n"))
    };

    let prompt = format!(
        r#"You completed a multi-step task to achieve the following goal:

Goal: {}

Here are the results of each step:

{}{}

Synthesis guidance: {}

Now synthesize a clear, complete, and well-structured final response that directly addresses the original goal. Incorporate all relevant results. Be concise but thorough."#,
        goal, summaries_text, failures_section, synthesis_prompt
    );

    let messages = vec![ChatMessage {
        role: "user".to_string(),
        content: prompt,
        image_base64: None,
    }];
    let conversation = providers::build_conversation(messages, None);

    let no_tools: &[providers::ToolDefinition] = &[];
    let turn =
        providers::complete_turn(provider, api_key, model, &conversation, no_tools, base_url).await?;
    Ok(turn.content)
}

