/// Computer Use — Blade's ability to operate the computer autonomously.
///
/// Given a high-level goal, Blade will:
///   1. Screenshot the current screen state
///   2. Send screenshot + goal + history to a vision-capable model
///   3. Receive a structured action (click, type, scroll, open, done, etc.)
///   4. Execute the action via native automation
///   5. Repeat until goal is achieved or max steps reached
///
/// Safety model:
///   - Each step emits `computer_use_step` for UI preview
///   - Destructive actions (form submit, file delete, payment) require
///     explicit user approval via the existing tool_approval_needed flow
///   - Max 20 steps per task to prevent runaway loops
///   - User can interrupt at any step via `computer_use_stop`

use serde::{Deserialize, Serialize};
use tauri::Emitter;

const MAX_STEPS: usize = 20;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ComputerAction {
    Click { x: i32, y: i32, description: String },
    Type { text: String },
    Key { key: String },
    Scroll { x: i32, y: i32, direction: String, amount: i32 },
    OpenUrl { url: String },
    OpenApp { name: String },
    Wait { ms: u64, reason: String },
    Done { result: String },
    Failed { reason: String },
    NeedApproval { description: String, action_json: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ComputerUseStep {
    pub step: usize,
    pub action: ComputerAction,
    pub screenshot_b64: Option<String>,
    pub status: String, // "planned" | "executing" | "done" | "error" | "waiting_approval"
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ComputerUseResult {
    pub success: bool,
    pub steps_taken: usize,
    pub result: String,
}

/// Run a computer use task. Emits step-by-step events on the app handle.
/// Returns a summary of what was accomplished.
#[tauri::command]
pub async fn computer_use_task(
    app: tauri::AppHandle,
    goal: String,
    max_steps: Option<usize>,
) -> Result<ComputerUseResult, String> {
    let config = crate::config::load_config();
    if config.api_key.is_empty() && config.provider != "ollama" {
        return Err("No API key configured".to_string());
    }

    // Reset stop signal at task start
    STOP_SIGNAL.store(false, std::sync::atomic::Ordering::Relaxed);

    // Vision support check — computer use requires a vision-capable model
    let vision_model = best_vision_model(&config.provider, &config.model);
    let limit = max_steps.unwrap_or(MAX_STEPS).min(MAX_STEPS);

    let mut history: Vec<String> = Vec::new();
    let mut steps_taken = 0;

    for step in 0..limit {
        // Check if task was stopped by user
        if is_stopped(&goal) {
            return Ok(ComputerUseResult {
                success: false,
                steps_taken,
                result: "Task stopped by user.".to_string(),
            });
        }

        // Screenshot the current screen
        let screenshot_b64 = match crate::screen::capture_screen() {
            Ok(b64) => b64,
            Err(e) => return Err(format!("Screenshot failed: {}", e)),
        };

        // Build the prompt for the vision model
        let prompt = build_computer_use_prompt(&goal, &history, step, limit);

        // Call the vision model with the screenshot
        let action = match call_vision_model(
            &config,
            &vision_model,
            &prompt,
            &screenshot_b64,
        ).await {
            Ok(a) => a,
            Err(e) => return Err(format!("Vision model error: {}", e)),
        };

        steps_taken += 1;

        // Emit the planned step for UI preview
        let _ = app.emit("computer_use_step", serde_json::json!({
            "step": step + 1,
            "action": &action,
            "status": "executing",
        }));

        history.push(format!("Step {}: {:?}", step + 1, action));

        match action {
            ComputerAction::Done { result } => {
                let _ = app.emit("computer_use_complete", serde_json::json!({
                    "success": true,
                    "result": &result,
                    "steps": steps_taken,
                }));
                return Ok(ComputerUseResult {
                    success: true,
                    steps_taken,
                    result,
                });
            }
            ComputerAction::Failed { reason } => {
                let _ = app.emit("computer_use_complete", serde_json::json!({
                    "success": false,
                    "result": &reason,
                    "steps": steps_taken,
                }));
                return Ok(ComputerUseResult {
                    success: false,
                    steps_taken,
                    result: reason,
                });
            }
            ComputerAction::NeedApproval { description, action_json } => {
                // Emit approval request — frontend handles this via existing mechanism
                let approval_id = uuid::Uuid::new_v4().to_string();
                let _ = app.emit("computer_use_approval_needed", serde_json::json!({
                    "approval_id": &approval_id,
                    "step": step + 1,
                    "description": &description,
                    "action": &action_json,
                }));
                // For now, pause and let the user decide in the next message
                return Ok(ComputerUseResult {
                    success: false,
                    steps_taken,
                    result: format!("Paused: approval needed. {}", description),
                });
            }
            action => {
                if let Err(e) = execute_action(&action).await {
                    let _ = app.emit("computer_use_step", serde_json::json!({
                        "step": step + 1,
                        "action": &action,
                        "status": "error",
                        "error": &e,
                    }));
                    history.push(format!("  → ERROR: {}", e));
                } else {
                    // Small delay between actions to let the screen settle
                    tokio::time::sleep(std::time::Duration::from_millis(800)).await;
                }
            }
        }
    }

    Ok(ComputerUseResult {
        success: false,
        steps_taken,
        result: format!("Reached maximum {} steps without completing goal.", limit),
    })
}

fn best_vision_model(provider: &str, current_model: &str) -> String {
    match provider {
        "anthropic" => "claude-sonnet-4-6".to_string(),
        "openai" => "gpt-4o".to_string(),
        "gemini" => "gemini-2.0-flash".to_string(),
        _ => current_model.to_string(),
    }
}

fn build_computer_use_prompt(goal: &str, history: &[String], step: usize, max: usize) -> String {
    let history_section = if history.is_empty() {
        "No actions taken yet.".to_string()
    } else {
        history.join("\n")
    };

    format!(
        r#"You are controlling a computer to complete this goal: "{goal}"

Step {current}/{max}.

Actions taken so far:
{history}

Look at the screenshot and decide the single best next action.

Respond ONLY with valid JSON matching one of these schemas:
- Click: {{"kind":"click","x":N,"y":N,"description":"what I'm clicking"}}
- Type: {{"kind":"type","text":"text to type"}}
- Key: {{"kind":"key","key":"Enter"}} (or "Tab", "Escape", "Ctrl+C", etc.)
- Scroll: {{"kind":"scroll","x":N,"y":N,"direction":"up|down","amount":3}}
- Open URL: {{"kind":"open_url","url":"https://..."}}
- Open App: {{"kind":"open_app","name":"app name"}}
- Wait: {{"kind":"wait","ms":1000,"reason":"waiting for page to load"}}
- Done: {{"kind":"done","result":"what was accomplished"}}
- Failed: {{"kind":"failed","reason":"why this can't be done"}}
- Approval needed: {{"kind":"need_approval","description":"what requires approval","action_json":"the action I want to take"}}

Rules:
- Click exact coordinates visible in the screenshot
- Use "done" when the goal is achieved
- Use "need_approval" for any form submission, payment, or irreversible action
- If you're unsure, use "wait" to observe the screen
- Never guess coordinates — only use what you can see

Respond with ONLY the JSON. No explanation."#,
        goal = goal,
        current = step + 1,
        max = max,
        history = history_section,
    )
}

async fn call_vision_model(
    config: &crate::config::BladeConfig,
    model: &str,
    prompt: &str,
    screenshot_b64: &str,
) -> Result<ComputerAction, String> {
    use crate::providers::ConversationMessage;

    // Use vision message variant
    let messages = vec![ConversationMessage::UserWithImage {
        text: prompt.to_string(),
        image_b64: screenshot_b64.to_string(),
        media_type: "image/png".to_string(),
    }];

    let turn = crate::providers::complete_turn(
        &config.provider,
        &config.api_key,
        model,
        &messages,
        &[],
        config.base_url.as_deref(),
    )
    .await?;

    let raw = turn.content.trim();
    // Strip markdown code fences if present
    let json_str = if raw.starts_with("```") {
        raw.lines()
            .skip(1)
            .take_while(|l| !l.starts_with("```"))
            .collect::<Vec<_>>()
            .join("\n")
    } else {
        raw.to_string()
    };

    serde_json::from_str::<ComputerAction>(&json_str)
        .map_err(|e| format!("Failed to parse action JSON: {} — raw: {}", e, &json_str[..json_str.len().min(200)]))
}

async fn execute_action(action: &ComputerAction) -> Result<(), String> {
    match action {
        ComputerAction::Click { x, y, .. } => {
            crate::automation::auto_mouse_click(Some(*x), Some(*y), Some("left".to_string()))?;
            Ok(())
        }
        ComputerAction::Type { text } => {
            crate::automation::auto_type_text(text.clone())?;
            Ok(())
        }
        ComputerAction::Key { key } => {
            // Handle combo keys like "Ctrl+C" vs simple keys
            if key.contains('+') {
                let parts: Vec<&str> = key.split('+').collect();
                let (modifiers, k) = parts.split_at(parts.len() - 1);
                let mods: Vec<String> = modifiers.iter().map(|s| s.to_string()).collect();
                crate::automation::auto_key_combo(mods, k[0].to_string())?;
            } else {
                crate::automation::auto_press_key(key.clone())?;
            }
            Ok(())
        }
        ComputerAction::Scroll { direction, amount, .. } => {
            let dy = if direction == "down" { *amount } else { -amount };
            crate::automation::auto_scroll(0, dy)?;
            Ok(())
        }
        ComputerAction::OpenUrl { url } => {
            crate::automation::auto_open_url(url.clone())?;
            Ok(())
        }
        ComputerAction::OpenApp { name } => {
            crate::automation::auto_launch_app(name.clone(), None)?;
            Ok(())
        }
        ComputerAction::Wait { ms, .. } => {
            tokio::time::sleep(std::time::Duration::from_millis(*ms)).await;
            Ok(())
        }
        _ => Ok(()), // Done/Failed/NeedApproval handled in main loop
    }
}

/// Global stop signal — set when user cancels a task
static STOP_SIGNAL: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);

fn is_stopped(_goal: &str) -> bool {
    STOP_SIGNAL.load(std::sync::atomic::Ordering::Relaxed)
}

#[tauri::command]
pub fn computer_use_stop() {
    STOP_SIGNAL.store(true, std::sync::atomic::Ordering::Relaxed);
}

/// Get current screen as base64 PNG for the AI to look at (also useful standalone)
#[tauri::command]
pub async fn computer_use_screenshot() -> Result<String, String> {
    crate::screen::capture_screen()
}
