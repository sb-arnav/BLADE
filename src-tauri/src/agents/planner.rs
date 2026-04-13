use super::{AgentStep, StepStatus};
use crate::mcp::McpTool;
use crate::providers::{self, ChatMessage};

/// Ask the AI to break a goal into executable steps
pub async fn plan_steps(
    provider: &str,
    api_key: &str,
    model: &str,
    base_url: Option<&str>,
    goal: &str,
    available_tools: &[McpTool],
) -> Result<Vec<AgentStep>, String> {
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
        r#"You are a task planner. Break this goal into concrete, executable steps.

Goal: {}

{}

Respond with a JSON array of steps. Each step has:
- "description": what to do (one sentence)
- "tool_name": which tool to use (null if no tool needed, just thinking/writing)
- "tool_args": arguments for the tool as a JSON object (null if no tool)

Keep it to 3-8 steps. Be specific and actionable.

Respond ONLY with the JSON array, no other text."#,
        goal, tool_list
    );

    let messages = vec![ChatMessage {
        role: "user".to_string(),
        content: prompt,
        image_base64: None,
    }];
    let conversation = providers::build_conversation(messages, None);

    let turn = providers::complete_turn(provider, api_key, model, &conversation, &[], base_url).await?;

    // Parse the JSON response
    let content = turn.content.trim();
    // Find the JSON array in the response (handle markdown code blocks)
    let json_str = if let Some(start) = content.find('[') {
        if let Some(end) = content.rfind(']') {
            &content[start..=end]
        } else {
            content
        }
    } else {
        content
    };

    let raw_steps: Vec<serde_json::Value> =
        serde_json::from_str(json_str).map_err(|e| format!("Failed to parse plan: {}", e))?;

    let steps = raw_steps
        .iter()
        .enumerate()
        .map(|(i, s)| AgentStep {
            id: format!("step-{}", i + 1),
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
        })
        .collect();

    Ok(steps)
}
