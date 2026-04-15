/// BLADE Swarm Planner — LLM-based DAG decomposition
///
/// Takes a high-level goal and returns a validated DAG of 3-8 SwarmTasks.
/// Uses Reciprocal Rank Fusion principles: generates multiple specialized tasks
/// with explicit dependency edges so parallel execution is safe.

use crate::swarm::{SwarmTask, SwarmTaskStatus, SwarmTaskType};

const DECOMPOSE_PROMPT: &str = r#"You are a swarm task planner for an AI agent system.

Break this goal into 3-8 parallel sub-tasks. Tasks can run simultaneously unless they depend on each other's output.

Goal: {GOAL}

Available tools:
{TOOLS}

Provider preferences:
- Code tasks (generating, debugging, refactoring): prefer provider "{CODE_PROVIDER}"
- Research/search tasks (fast lookups, web queries): prefer provider "{FAST_PROVIDER}"

Rules:
- Maximize parallelism: independent tasks should have empty depends_on
- Only add depends_on when a task genuinely needs another's output
- Order by estimated duration: fast queries first (seconds), slow operations last (minutes)
- Only plan steps that use tools from the available tools list; if a needed tool is unavailable, add a prerequisite step to install it first
- Keep each task goal clear and specific enough for a single agent to execute
- Use type "research" for web search/analysis, "code" for writing/coding, "desktop" for GUI tasks
- Estimate duration: "fast" (< 30s), "medium" (30s-2min), "slow" (> 2min)
- Assign a role: "researcher", "coder", "analyst", "writer", or "reviewer"

Respond ONLY with a JSON array (no markdown):
[
  {
    "id": "t1",
    "title": "Short task title",
    "goal": "Specific goal for this task — what exactly to do and produce",
    "type": "research|code|desktop",
    "depends_on": [],
    "estimated_duration": "fast|medium|slow",
    "role": "researcher|coder|analyst|writer|reviewer",
    "required_tools": ["tool_name_or_null"]
  }
]"#;

/// Validate that each task's required_tools are available; returns suggestions for missing tools.
fn validate_task_tools(tasks: &[SwarmTask], available_tool_names: &[String]) -> Vec<String> {
    let mut missing: Vec<String> = Vec::new();
    for task in tasks {
        for tool in &task.required_tools {
            if !available_tool_names.iter().any(|t| t == tool) {
                missing.push(format!("Task '{}' needs tool '{}' which is not available", task.title, tool));
            }
        }
    }
    missing
}

pub async fn decompose_goal_to_dag(
    provider: &str,
    api_key: &str,
    model: &str,
    base_url: Option<&str>,
    swarm_id: &str,
    goal: &str,
) -> Result<Vec<SwarmTask>, String> {
    decompose_goal_to_dag_with_tools(provider, api_key, model, base_url, swarm_id, goal, &[]).await
}

pub async fn decompose_goal_to_dag_with_tools(
    provider: &str,
    api_key: &str,
    model: &str,
    base_url: Option<&str>,
    swarm_id: &str,
    goal: &str,
    available_tools: &[crate::mcp::McpTool],
) -> Result<Vec<SwarmTask>, String> {
    use crate::providers::{ChatMessage, build_conversation, complete_turn};

    let config = crate::config::load_config();
    let code_provider = config.task_routing.code.as_deref().unwrap_or(provider);
    let fast_provider = config.task_routing.fast.as_deref().unwrap_or(provider);

    let tool_list = if available_tools.is_empty() {
        "No MCP tools available — plan steps using thinking, writing, and built-in capabilities only.".to_string()
    } else {
        available_tools
            .iter()
            .map(|t| format!("- {}: {}", t.qualified_name, t.description))
            .collect::<Vec<_>>()
            .join("\n")
    };

    let available_tool_names: Vec<String> = available_tools
        .iter()
        .map(|t| t.qualified_name.clone())
        .collect();

    let prompt = DECOMPOSE_PROMPT
        .replace("{GOAL}", goal)
        .replace("{TOOLS}", &tool_list)
        .replace("{CODE_PROVIDER}", code_provider)
        .replace("{FAST_PROVIDER}", fast_provider);

    let messages = vec![ChatMessage {
        role: "user".to_string(),
        content: prompt,
        image_base64: None,
    }];
    let conversation = build_conversation(messages, None);

    let turn = complete_turn(provider, api_key, model, &conversation, &crate::providers::no_tools(), base_url).await?;

    let content = turn.content.trim();

    // Strip markdown fences if present
    let json_str = {
        let stripped = content
            .trim_start_matches("```json")
            .trim_start_matches("```")
            .trim_end_matches("```")
            .trim();
        // Find JSON array bounds
        if let (Some(start), Some(end)) = (stripped.find('['), stripped.rfind(']')) {
            &stripped[start..=end]
        } else {
            stripped
        }
    };

    let raw: Vec<serde_json::Value> = serde_json::from_str(json_str)
        .map_err(|e| format!("Failed to parse task DAG: {} — raw: {}", e, crate::safe_slice(json_str, 200)))?;

    if raw.is_empty() {
        return Err("Planner returned no tasks".to_string());
    }

    let now = chrono::Utc::now().timestamp();

    // Parse and assign ordering: fast tasks come first (lower index = runs earlier)
    let mut task_entries: Vec<(i64, SwarmTask)> = raw
        .iter()
        .enumerate()
        .map(|(i, v)| {
            let id = v["id"].as_str().unwrap_or(&format!("t{}", i + 1)).to_string();
            let depends_on: Vec<String> = v["depends_on"]
                .as_array()
                .map(|a| a.iter().filter_map(|d| d.as_str().map(str::to_string)).collect())
                .unwrap_or_default();

            let duration_order: i64 = match v["estimated_duration"].as_str().unwrap_or("medium") {
                "fast" => 0,
                "medium" => 1,
                "slow" => 2,
                _ => 1,
            };

            let role_str = v["role"].as_str().unwrap_or("").to_string();
            let required_tools: Vec<String> = v["required_tools"]
                .as_array()
                .map(|a| {
                    a.iter()
                        .filter_map(|t| t.as_str())
                        .filter(|t| !t.is_empty() && *t != "null")
                        .map(str::to_string)
                        .collect()
                })
                .unwrap_or_default();

            let scratchpad_key = Some(format!("task_{}", id));

            let task = SwarmTask {
                id: id.clone(),
                swarm_id: swarm_id.to_string(),
                title: v["title"].as_str().unwrap_or("Untitled").to_string(),
                goal: v["goal"].as_str().unwrap_or("").to_string(),
                task_type: SwarmTaskType::from_str(v["type"].as_str().unwrap_or("code")),
                depends_on,
                agent_id: None,
                status: SwarmTaskStatus::Pending,
                result: None,
                scratchpad_key,
                created_at: now + i as i64,
                started_at: None,
                completed_at: None,
                error: None,
                role: role_str,
                required_tools,
                estimated_duration: v["estimated_duration"].as_str().unwrap_or("medium").to_string(),
            };

            (duration_order, task)
        })
        .collect();

    // Sort by estimated duration so fast tasks get scheduled first (preserve original order within same tier)
    task_entries.sort_by_key(|(dur, _)| *dur);
    let mut tasks: Vec<SwarmTask> = task_entries.into_iter().map(|(_, t)| t).collect();

    // Validate the DAG
    crate::swarm::validate_dag(&tasks)?;

    if tasks.len() > 10 {
        return Err("Too many tasks (max 10)".to_string());
    }

    // Tool validation: for tasks that require tools not available, insert an
    // "install MCP server" prerequisite step or simplify the task
    if !available_tool_names.is_empty() {
        let missing_warnings = validate_task_tools(&tasks, &available_tool_names);
        if !missing_warnings.is_empty() {
            // Insert a prerequisite task to handle missing tools
            let missing_tools_note = missing_warnings.join("; ");
            let install_task = SwarmTask {
                id: "t_install_tools".to_string(),
                swarm_id: swarm_id.to_string(),
                title: "Resolve missing tools".to_string(),
                goal: format!(
                    "Some planned tasks need tools that are not installed. Try to use built-in alternatives or simplify. Missing: {}",
                    missing_tools_note
                ),
                task_type: SwarmTaskType::Code,
                depends_on: vec![],
                agent_id: None,
                status: SwarmTaskStatus::Pending,
                result: None,
                scratchpad_key: Some("task_t_install_tools".to_string()),
                created_at: now - 1, // runs before others
                started_at: None,
                completed_at: None,
                error: None,
                role: "analyst".to_string(),
                required_tools: vec![],
                estimated_duration: "fast".to_string(),
            };
            tasks.insert(0, install_task);
        }
    }

    Ok(tasks)
}

/// Synthesize a final result from all completed task results.
/// Kept for backward compat — delegates to the richer version.
pub async fn synthesize_final_result(
    provider: &str,
    api_key: &str,
    model: &str,
    base_url: Option<&str>,
    goal: &str,
    tasks: &[crate::swarm::SwarmTask],
) -> String {
    synthesize_final_result_with_scratchpad(provider, api_key, model, base_url, goal, tasks, &[]).await
}

/// Synthesize a final result including all typed scratchpad entries from every agent.
/// The scratchpad gives the synthesizer richer, labelled context beyond just task results.
pub async fn synthesize_final_result_with_scratchpad(
    provider: &str,
    api_key: &str,
    model: &str,
    base_url: Option<&str>,
    goal: &str,
    tasks: &[crate::swarm::SwarmTask],
    scratchpad_entries: &[crate::swarm::ScratchpadEntry],
) -> String {
    use crate::providers::{ChatMessage, build_conversation, complete_turn};

    let task_results: Vec<String> = tasks
        .iter()
        .filter(|t| t.status == crate::swarm::SwarmTaskStatus::Completed)
        .map(|t| {
            let result = t.result.as_deref().unwrap_or("(no result)");
            let role_label = if !t.role.is_empty() { format!(" ({})", t.role) } else { String::new() };
            format!("## {}{}\n{}", t.title, role_label, crate::safe_slice(result, 1000))
        })
        .collect();

    let failed_tasks: Vec<String> = tasks
        .iter()
        .filter(|t| t.status == crate::swarm::SwarmTaskStatus::Failed)
        .map(|t| format!("- {} (failed: {})", t.title, t.error.as_deref().unwrap_or("unknown")))
        .collect();

    if task_results.is_empty() && failed_tasks.is_empty() {
        return "No tasks completed successfully.".to_string();
    }

    // Include additional scratchpad entries not already in task results
    let extra_entries: Vec<String> = scratchpad_entries
        .iter()
        .filter(|e| !e.key.starts_with("task_") || !tasks.iter().any(|t| {
            t.scratchpad_key.as_deref() == Some(&e.key)
        }))
        .map(|e| format!("### Scratchpad [{}] from {}\n{}", e.key, e.source_task, crate::safe_slice(&e.value, 400)))
        .collect();

    let mut prompt_parts = vec![
        format!(
            "You are synthesizing results from a parallel agent swarm that worked on this goal:\n\n**Goal:** {}",
            goal
        ),
        format!("**Agent Results:**\n{}", task_results.join("\n\n")),
    ];

    if !extra_entries.is_empty() {
        prompt_parts.push(format!("**Additional shared findings:**\n{}", extra_entries.join("\n\n")));
    }

    if !failed_tasks.is_empty() {
        prompt_parts.push(format!(
            "**Note:** The following tasks failed and could not be completed:\n{}",
            failed_tasks.join("\n")
        ));
    }

    prompt_parts.push(
        "Write a coherent, comprehensive summary that integrates all findings. \
         Be specific and actionable. Note any gaps from failed tasks. Do not repeat yourself."
            .to_string(),
    );

    let prompt = prompt_parts.join("\n\n");

    let messages = vec![ChatMessage {
        role: "user".to_string(),
        content: prompt,
        image_base64: None,
    }];
    let conversation = build_conversation(messages, None);

    match complete_turn(provider, api_key, model, &conversation, &crate::providers::no_tools(), base_url).await {
        Ok(turn) => turn.content.trim().to_string(),
        Err(e) => format!("Synthesis failed: {}", e),
    }
}
