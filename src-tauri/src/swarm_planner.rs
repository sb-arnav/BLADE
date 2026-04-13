/// BLADE Swarm Planner — LLM-based DAG decomposition
///
/// Takes a high-level goal and returns a validated DAG of 3-8 SwarmTasks.
/// Uses Reciprocal Rank Fusion principles: generates multiple specialized tasks
/// with explicit dependency edges so parallel execution is safe.

use crate::swarm::{SwarmTask, SwarmTaskStatus, SwarmTaskType};

const DECOMPOSE_PROMPT: &str = r#"You are a swarm task planner for an AI agent system.

Break this goal into 3-8 parallel sub-tasks. Tasks can run simultaneously unless they depend on each other's output.

Goal: {GOAL}

Rules:
- Maximize parallelism: independent tasks should have empty depends_on
- Only add depends_on when a task genuinely needs another's output
- Keep each task goal clear and specific enough for a single agent to execute
- Use type "research" for web search/analysis, "code" for writing/coding, "desktop" for GUI tasks

Respond ONLY with a JSON array (no markdown):
[
  {
    "id": "t1",
    "title": "Short task title",
    "goal": "Specific goal for this task — what exactly to do and produce",
    "type": "research|code|desktop",
    "depends_on": []
  }
]"#;

pub async fn decompose_goal_to_dag(
    provider: &str,
    api_key: &str,
    model: &str,
    swarm_id: &str,
    goal: &str,
) -> Result<Vec<SwarmTask>, String> {
    use crate::providers::{ChatMessage, build_conversation, complete_turn};

    let prompt = DECOMPOSE_PROMPT.replace("{GOAL}", goal);

    let messages = vec![ChatMessage {
        role: "user".to_string(),
        content: prompt,
        image_base64: None,
    }];
    let conversation = build_conversation(messages, None);

    let turn = complete_turn(provider, api_key, model, &conversation, &[], None).await?;

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
        .map_err(|e| format!("Failed to parse task DAG: {} — raw: {}", e, &json_str[..json_str.len().min(200)]))?;

    if raw.is_empty() {
        return Err("Planner returned no tasks".to_string());
    }

    let now = chrono::Utc::now().timestamp();

    let tasks: Vec<SwarmTask> = raw
        .iter()
        .enumerate()
        .map(|(i, v)| {
            let id = v["id"].as_str().unwrap_or(&format!("t{}", i + 1)).to_string();
            let depends_on: Vec<String> = v["depends_on"]
                .as_array()
                .map(|a| a.iter().filter_map(|d| d.as_str().map(str::to_string)).collect())
                .unwrap_or_default();

            SwarmTask {
                id,
                swarm_id: swarm_id.to_string(),
                title: v["title"].as_str().unwrap_or("Untitled").to_string(),
                goal: v["goal"].as_str().unwrap_or("").to_string(),
                task_type: SwarmTaskType::from_str(v["type"].as_str().unwrap_or("code")),
                depends_on,
                agent_id: None,
                status: SwarmTaskStatus::Pending,
                result: None,
                scratchpad_key: None,
                created_at: now + i as i64,  // stagger slightly for ordering
                started_at: None,
                completed_at: None,
                error: None,
            }
        })
        .collect();

    // Validate the DAG
    crate::swarm::validate_dag(&tasks)?;

    if tasks.len() > 10 {
        return Err("Too many tasks (max 10)".to_string());
    }

    Ok(tasks)
}

/// Synthesize a final result from all completed task results.
pub async fn synthesize_final_result(
    provider: &str,
    api_key: &str,
    model: &str,
    goal: &str,
    tasks: &[crate::swarm::SwarmTask],
) -> String {
    use crate::providers::{ChatMessage, build_conversation, complete_turn};

    let task_results: Vec<String> = tasks
        .iter()
        .filter(|t| t.status == crate::swarm::SwarmTaskStatus::Completed)
        .map(|t| {
            let result = t.result.as_deref().unwrap_or("(no result)");
            format!("## {}\n{}", t.title, &result[..result.len().min(1000)])
        })
        .collect();

    if task_results.is_empty() {
        return "No tasks completed successfully.".to_string();
    }

    let prompt = format!(
        "You are synthesizing results from a parallel agent swarm that worked on this goal:\n\n\
         **Goal:** {}\n\n\
         **Agent Results:**\n{}\n\n\
         Write a coherent, comprehensive summary that integrates all findings. \
         Be specific and actionable. Do not repeat yourself.",
        goal,
        task_results.join("\n\n")
    );

    let messages = vec![ChatMessage {
        role: "user".to_string(),
        content: prompt,
        image_base64: None,
    }];
    let conversation = build_conversation(messages, None);

    match complete_turn(provider, api_key, model, &conversation, &[], None).await {
        Ok(turn) => turn.content.trim().to_string(),
        Err(e) => format!("Synthesis failed: {}", e),
    }
}
