use crate::agents::{self, executor, planner, queue::SharedAgentQueue, Agent, AgentStatus};
use crate::automation;
use crate::browser_native;
use crate::clipboard;
use crate::commands::SharedMcpManager;
use crate::config::load_config;
use crate::context;
use crate::mcp::McpTool;
use crate::providers::{self, ChatMessage};
use crate::router::{self, TaskType};
use crate::screen;
use crate::ui_automation;

const PENDING_DESKTOP_ACTION_KEY: &str = "pending_desktop_action";
const DESKTOP_HISTORY_KEY: &str = "desktop_history";
const DESKTOP_LAST_ACTION_KEY: &str = "desktop_last_action";
const DESKTOP_REPEAT_COUNT_KEY: &str = "desktop_repeat_count";
const DESKTOP_TARGET_KEY: &str = "desktop_target";
const DESKTOP_UIA_TARGET_KEY: &str = "desktop_uia_target";
const DESKTOP_BROWSER_TARGET_KEY: &str = "desktop_browser_target";

#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
struct DesktopDecision {
    summary: String,
    action: DesktopAction,
}

#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
struct DesktopTargetMemory {
    center_x: i32,
    center_y: i32,
    width: u32,
    height: u32,
    app_name: String,
    window_title: String,
    source: String,
}

#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
struct DesktopUiaTargetMemory {
    selector: ui_automation::UiSelector,
    source: String,
}

#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
struct DesktopBrowserTargetMemory {
    selector: String,
    source: String,
}

#[derive(Debug, Clone, Copy)]
enum ControlSubstrate {
    BrowserNative,
    WindowsNative,
    VisualFallback,
}

#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum DesktopAction {
    MoveMouse {
        x: i32,
        y: i32,
    },
    MoveToTarget {
        dx: Option<i32>,
        dy: Option<i32>,
    },
    ClickRelative {
        dx: i32,
        dy: i32,
        button: Option<String>,
    },
    Click {
        x: i32,
        y: i32,
        button: Option<String>,
    },
    ClickTarget {
        dx: Option<i32>,
        dy: Option<i32>,
        button: Option<String>,
    },
    DoubleClick {
        x: i32,
        y: i32,
        button: Option<String>,
    },
    DoubleClickTarget {
        dx: Option<i32>,
        dy: Option<i32>,
        button: Option<String>,
    },
    Drag {
        from_x: i32,
        from_y: i32,
        to_x: i32,
        to_y: i32,
        button: Option<String>,
    },
    Type {
        text: String,
    },
    PressKey {
        key: String,
    },
    KeyCombo {
        modifiers: Vec<String>,
        key: String,
    },
    Scroll {
        dx: i32,
        dy: i32,
    },
    FocusWindow {
        title_contains: String,
    },
    FocusTargetWindow,
    WaitForWindow {
        title_contains: String,
        timeout_ms: Option<u64>,
    },
    WaitForScreenChange {
        timeout_ms: Option<u64>,
    },
    WaitForRegionChange {
        size: Option<u32>,
        timeout_ms: Option<u64>,
    },
    WaitForTargetRegionChange {
        timeout_ms: Option<u64>,
    },
    UiaClick {
        name: Option<String>,
        automation_id: Option<String>,
        class_name: Option<String>,
        control_type: Option<String>,
    },
    UiaClickRemembered,
    UiaInvoke {
        name: Option<String>,
        automation_id: Option<String>,
        class_name: Option<String>,
        control_type: Option<String>,
    },
    UiaInvokeRemembered,
    UiaFocus {
        name: Option<String>,
        automation_id: Option<String>,
        class_name: Option<String>,
        control_type: Option<String>,
    },
    UiaFocusRemembered,
    UiaSetValue {
        name: Option<String>,
        automation_id: Option<String>,
        class_name: Option<String>,
        control_type: Option<String>,
        value: String,
    },
    UiaSetValueRemembered {
        value: String,
    },
    UiaWaitForElement {
        name: Option<String>,
        automation_id: Option<String>,
        class_name: Option<String>,
        control_type: Option<String>,
        timeout_ms: Option<u64>,
    },
    UiaWaitForRemembered {
        timeout_ms: Option<u64>,
    },
    BrowserNavigate {
        url: String,
    },
    BrowserClick {
        selector: String,
    },
    BrowserClickRemembered,
    BrowserType {
        selector: String,
        text: String,
    },
    BrowserTypeRemembered {
        text: String,
    },
    BrowserScroll {
        mode: Option<String>,
    },
    BrowserWaitForSelector {
        selector: String,
        timeout_ms: Option<u64>,
    },
    BrowserWaitForRemembered {
        timeout_ms: Option<u64>,
    },
    BrowserExtract {
        selector: Option<String>,
        property: Option<String>,
    },
    SearchWeb {
        query: String,
    },
    OpenUrl {
        url: String,
    },
    OpenPath {
        path: String,
    },
    LaunchApp {
        command: String,
        args: Option<Vec<String>>,
    },
    CopyToClipboard {
        text: String,
    },
    PasteClipboard,
    Wait {
        ms: Option<u64>,
    },
    Done {
        summary: String,
    },
}

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

    // Stage 1: Plan steps with synthesis guidance
    let plan = planner::plan_full(
        &config.provider,
        &config.api_key,
        &config.model,
        config.base_url.as_deref(),
        &goal,
        &tools,
    )
    .await?;

    agent.steps = plan.steps;
    agent.synthesis_prompt = plan.synthesis_prompt;
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
    let base_url = config.base_url.clone();

    tokio::spawn(async move {
        run_agent_loop_internal(
            &agent_id,
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

    Ok(id)
}

#[tauri::command]
pub async fn agent_create_desktop(
    app: tauri::AppHandle,
    queue: tauri::State<'_, SharedAgentQueue>,
    goal: String,
    max_steps: Option<u32>,
    execution_mode: Option<String>,
) -> Result<String, String> {
    let mut config = load_config();
    if config.api_key.is_empty() && config.provider != "ollama" {
        return Err("No API key configured.".to_string());
    }

    if let Some(model) = router::suggest_model(&config.provider, &TaskType::Vision) {
        config.model = model;
    }

    let id = uuid::Uuid::new_v4().to_string();
    let mut agent = Agent::new(id.clone(), goal.clone());
    agent.status = AgentStatus::Executing;
    agent
        .context
        .insert("mode".to_string(), "desktop_control".to_string());
    agent
        .context
        .insert("operator_type".to_string(), "desktop_operator".to_string());
    let execution_mode = match execution_mode.as_deref() {
        Some("auto") => "auto",
        _ => "supervised",
    };
    agent
        .context
        .insert("execution_mode".to_string(), execution_mode.to_string());
    agent
        .context
        .insert("provider".to_string(), config.provider.clone());
    agent
        .context
        .insert("model".to_string(), config.model.clone());

    let steps_count = max_steps.unwrap_or(8).clamp(3, 20) as usize;
    agent.steps = (0..steps_count)
        .map(|index| agents::AgentStep {
            id: format!("desktop-step-{}", index + 1),
            description: format!("Desktop control iteration {}", index + 1),
            tool_name: Some("blade.desktop_control".to_string()),
            tool_args: Some(serde_json::json!({ "iteration": index + 1 })),
            status: agents::StepStatus::Pending,
            result: None,
            started_at: None,
            completed_at: None,
            dependencies: Vec::new(),
            reflections: Vec::new(),
        })
        .collect();

    let agent_id = {
        let mut q = queue.lock().await;
        q.add(agent)
    };

    let queue_clone = queue.inner().clone();
    let app_clone = app.clone();
    let provider = config.provider.clone();
    let api_key = config.api_key.clone();
    let model = config.model.clone();
    let base_url = config.base_url.clone();

    tokio::spawn(async move {
        run_desktop_agent_loop(
            &agent_id,
            &queue_clone,
            &app_clone,
            &provider,
            &api_key,
            &model,
            base_url,
        )
        .await;
    });

    Ok(id)
}

pub(crate) async fn run_agent_loop_internal(
    agent_id: &str,
    queue: &SharedAgentQueue,
    mcp: &SharedMcpManager,
    app: &tauri::AppHandle,
    provider: &str,
    api_key: &str,
    model: &str,
    base_url: Option<String>,
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
                if let Err(e) =
                    executor::execute_next_step(agent, mcp, app, provider, api_key, model, base_url.as_deref()).await
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

    let _ = app.emit(
        "agent_completed",
        serde_json::json!({
            "agent_id": agent_id,
            "status": format!("{:?}", status.unwrap_or(AgentStatus::Failed)),
        }),
    );

    // Stage 4: Synthesize a final response when the agent completed successfully
    let synthesis_data = {
        let q = queue.lock().await;
        q.get(agent_id).filter(|a| a.status == AgentStatus::Completed).map(|a| {
            (a.goal.clone(), a.steps.clone(), a.synthesis_prompt.clone())
        })
    };

    if let Some((goal, steps, synthesis_prompt)) = synthesis_data {
        match planner::synthesize_response(
            &goal,
            &steps,
            &synthesis_prompt,
            provider,
            api_key,
            model,
            base_url.as_deref(),
        )
        .await
        {
            Ok(result) => {
                // Store the synthesized result on the agent so the swarm coordinator
                // can read it instead of falling back to the last step's raw output.
                {
                    let mut q = queue.lock().await;
                    if let Some(agent) = q.get_mut(agent_id) {
                        agent.context.insert("synthesized_result".to_string(), result.clone());
                    }
                }
                let _ = app.emit(
                    "agent_synthesized",
                    serde_json::json!({
                        "agent_id": agent_id,
                        "result": result,
                    }),
                );
            }
            Err(e) => {
                log::warn!("Agent {} synthesis failed: {}", agent_id, e);
            }
        }
    }
}

async fn run_desktop_agent_loop(
    agent_id: &str,
    queue: &SharedAgentQueue,
    app: &tauri::AppHandle,
    provider: &str,
    api_key: &str,
    model: &str,
    base_url: Option<String>,
) {
    use tauri::Emitter;

    loop {
        let mut finished = false;

        {
            let mut q = queue.lock().await;
            let Some(agent) = q.get_mut(agent_id) else {
                break;
            };

            if agent.status != AgentStatus::Executing {
                break;
            }

            if agent.current_step >= agent.steps.len() {
                agent.status = AgentStatus::Completed;
                finished = true;
            } else {
                let idx = agent.current_step;
                let step_id = agent.steps[idx].id.clone();
                let step_desc = agent.steps[idx].description.clone();
                agent.steps[idx].status = agents::StepStatus::Running;
                agent.steps[idx].started_at = Some(chrono::Utc::now().timestamp_millis());

                let _ = app.emit(
                    "agent_step_started",
                    serde_json::json!({
                        "agent_id": agent_id,
                        "step_id": &step_id,
                        "description": &step_desc,
                    }),
                );
            }
        }

        if finished {
            break;
        }

        let result = execute_desktop_iteration(agent_id, queue, provider, api_key, model, base_url.as_deref()).await;

        let mut q = queue.lock().await;
        let Some(agent) = q.get_mut(agent_id) else {
            break;
        };

        let idx = agent.current_step;
        if idx >= agent.steps.len() {
            break;
        }
        let step_id = agent.steps[idx].id.clone();
        agent.steps[idx].completed_at = Some(chrono::Utc::now().timestamp_millis());

        match result {
            Ok(DesktopIterationResult::Continue(summary)) => {
                agent.steps[idx].status = agents::StepStatus::Completed;
                agent.steps[idx].result = Some(summary.clone());
                record_desktop_history(agent, &summary);
                let _ = app.emit(
                    "agent_step_completed",
                    serde_json::json!({
                        "agent_id": agent_id,
                        "step_id": &step_id,
                        "result": truncate(&summary, 500),
                    }),
                );
                agent.advance();
            }
            Ok(DesktopIterationResult::Done(summary)) => {
                agent.steps[idx].status = agents::StepStatus::Completed;
                agent.steps[idx].result = Some(summary.clone());
                record_desktop_history(agent, &summary);
                let _ = app.emit(
                    "agent_step_completed",
                    serde_json::json!({
                        "agent_id": agent_id,
                        "step_id": &step_id,
                        "result": truncate(&summary, 500),
                    }),
                );
                for later_step in agent.steps.iter_mut().skip(idx + 1) {
                    if later_step.status == agents::StepStatus::Pending {
                        later_step.status = agents::StepStatus::Skipped;
                        later_step.result = Some(
                            "Not needed after Blade marked the desktop task complete.".to_string(),
                        );
                    }
                }
                agent.current_step = agent.steps.len();
                agent.status = AgentStatus::Completed;
            }
            Ok(DesktopIterationResult::WaitingApproval { summary, action }) => {
                agent.status = AgentStatus::WaitingApproval;
                agent.context.insert(
                    PENDING_DESKTOP_ACTION_KEY.to_string(),
                    serde_json::to_string(&DesktopDecision {
                        summary: summary.clone(),
                        action: action.clone(),
                    })
                    .unwrap_or_else(|_| "{}".to_string()),
                );
                let _ = app.emit(
                    "agent_desktop_action_pending",
                    serde_json::json!({
                        "agent_id": agent_id,
                        "step_id": &step_id,
                        "summary": &summary,
                        "action": action,
                    }),
                );
            }
            Err(error) => {
                agent.steps[idx].status = agents::StepStatus::Failed;
                agent.steps[idx].result = Some(error.clone());
                let _ = app.emit(
                    "agent_step_failed",
                    serde_json::json!({
                        "agent_id": agent_id,
                        "step_id": &step_id,
                        "error": &error,
                    }),
                );
                agent.fail(error);
            }
        }

        if matches!(
            agent.status,
            AgentStatus::Completed
                | AgentStatus::Failed
                | AgentStatus::Paused
                | AgentStatus::WaitingApproval
        ) {
            break;
        }

        tokio::time::sleep(std::time::Duration::from_millis(700)).await;
    }

    let status = {
        let q = queue.lock().await;
        q.get(agent_id).map(|a| a.status.clone())
    };

    let _ = app.emit(
        "agent_completed",
        serde_json::json!({
            "agent_id": agent_id,
            "status": format!("{:?}", status.unwrap_or(AgentStatus::Failed)),
        }),
    );
}

enum DesktopIterationResult {
    Continue(String),
    Done(String),
    WaitingApproval {
        summary: String,
        action: DesktopAction,
    },
}

async fn execute_desktop_iteration(
    agent_id: &str,
    queue: &SharedAgentQueue,
    provider: &str,
    api_key: &str,
    model: &str,
    base_url: Option<&str>,
) -> Result<DesktopIterationResult, String> {
    let (
        goal,
        current_step,
        completed_summary,
        execution_mode,
        recent_history,
        repeat_count,
        remembered_target,
        remembered_uia_target,
        remembered_browser_target,
    ) = {
        let q = queue.lock().await;
        let agent = q.get(agent_id).ok_or("Agent not found".to_string())?;
        let summary = agent
            .steps
            .iter()
            .filter(|step| step.status == agents::StepStatus::Completed)
            .filter_map(|step| {
                step.result
                    .as_ref()
                    .map(|result| format!("- {}", truncate(result, 240)))
            })
            .collect::<Vec<_>>()
            .join("\n");
        (
            agent.goal.clone(),
            agent.current_step + 1,
            summary,
            agent
                .context
                .get("execution_mode")
                .cloned()
                .unwrap_or_else(|| "supervised".to_string()),
            agent
                .context
                .get(DESKTOP_HISTORY_KEY)
                .cloned()
                .unwrap_or_else(|| "[]".to_string()),
            agent
                .context
                .get(DESKTOP_REPEAT_COUNT_KEY)
                .and_then(|value| value.parse::<u32>().ok())
                .unwrap_or(0),
            agent
                .context
                .get(DESKTOP_TARGET_KEY)
                .cloned()
                .unwrap_or_else(|| "{}".to_string()),
            agent
                .context
                .get(DESKTOP_UIA_TARGET_KEY)
                .cloned()
                .unwrap_or_else(|| "{}".to_string()),
            agent
                .context
                .get(DESKTOP_BROWSER_TARGET_KEY)
                .cloned()
                .unwrap_or_else(|| "{}".to_string()),
        )
    };

    let full_snapshot = screen::capture_screen_snapshot_internal()?;
    let mouse_position =
        automation::auto_get_mouse_position().unwrap_or(automation::MousePosition { x: 0, y: 0 });
    let region_snapshot = capture_cursor_region_snapshot(mouse_position.x, mouse_position.y, 320)
        .unwrap_or_else(|_| screen::ScreenSnapshot {
            image_base64: String::new(),
            width: 0,
            height: 0,
            fingerprint: 0,
        });
    let target_memory = serde_json::from_str::<DesktopTargetMemory>(&remembered_target).ok();
    let target_snapshot = target_memory
        .as_ref()
        .and_then(|target| capture_target_region_snapshot(target).ok());
    let active_window = context::get_active_window().unwrap_or_default();
    let active_window_native = ui_automation::uia_get_active_window_snapshot(Some(1), Some(8)).ok();
    let snapshot = active_window_native
        .as_ref()
        .and_then(|window| capture_window_snapshot(window, &full_snapshot).ok())
        .unwrap_or_else(|| full_snapshot.clone());
    let user_activity =
        context::get_user_activity().unwrap_or_else(|_| "Unknown activity".to_string());
    let open_windows = context::list_open_windows_internal().unwrap_or_default();
    let open_windows_summary = format_open_windows(&open_windows);
    let substrate = choose_control_substrate(&goal, &active_window, active_window_native.is_some());
    let browser_page_summary = browser_native::browser_describe_page_internal(agent_id)
        .await
        .unwrap_or_else(|_| "Unavailable".to_string());
    let clipboard_preview = clipboard::get_clipboard()
        .map(|value| truncate(&value.replace('\n', " "), 220))
        .unwrap_or_else(|_| "Clipboard unavailable".to_string());
    let native_ui_summary =
        ui_automation::describe_active_window_ui_internal(Some(2), Some(10), Some(22))
            .unwrap_or_else(|_| "Unavailable".to_string());
    let prompt = format!(
        r#"You are Blade, a careful desktop control agent running on the user's computer.

Goal:
{}

Current iteration: {}
Active window:
- app: {}
- title: {}
Primary visual input:
- {}
Recommended control substrate:
- {}
Substrate policy:
{}
Inferred activity:
- {}
Screen size:
- width: {}
- height: {}
Current mouse position:
- x: {}
- y: {}
Current screen fingerprint:
- {}
Cursor region fingerprint:
- {}
Remembered target:
{}
Remembered native control:
{}
Remembered browser selector:
{}

Other open windows:
{}

Clipboard preview:
{}

Native UI Automation tree for the active window:
{}

Browser-native page summary:
{}

Recent desktop action history:
{}

Repeated identical action count:
{}

Completed so far:
{}

Choose the SINGLE best next desktop action to move toward the goal.

Rules:
- Be conservative and precise.
- Never chain multiple actions together.
- Prefer wait if the UI is still loading.
- Use absolute screen coordinates for click.
- Keep typed text under 280 characters.
- If the task is complete, return done.
- If the last action has repeated multiple times without visible progress, do not repeat it again without a strong reason.

Allowed actions:
- move_mouse
- click_relative
- click
- move_to_target
- click_target
- double_click
- double_click_target
- drag
- type
- press_key
- key_combo
- scroll
- focus_window
- focus_target_window
- wait_for_window
- wait_for_screen_change
- wait_for_region_change
- wait_for_target_region_change
- uia_click
- uia_click_remembered
- uia_invoke
- uia_invoke_remembered
- uia_focus
- uia_focus_remembered
- uia_set_value
- uia_set_value_remembered
- uia_wait_for_element
- uia_wait_for_remembered
- browser_navigate
- browser_click
- browser_click_remembered
- browser_type
- browser_type_remembered
- browser_scroll
- browser_wait_for_selector
- browser_wait_for_remembered
- browser_extract
- search_web
- open_url
- open_path
- launch_app
- copy_to_clipboard
- paste_clipboard
- wait
- done

Respond with ONLY valid JSON matching one of these shapes:
{{
  "summary": "what you observed and why this is the next move",
  "action": {{ "kind": "move_mouse", "x": 100, "y": 200 }}
}}
{{
  "summary": "what you observed and why this is the next move",
  "action": {{ "kind": "click_relative", "dx": 24, "dy": -10, "button": "left" }}
}}
{{
  "summary": "what you observed and why this is the next move",
  "action": {{ "kind": "move_to_target", "dx": 0, "dy": 0 }}
}}
{{
  "summary": "what you observed and why this is the next move",
  "action": {{ "kind": "click", "x": 100, "y": 200, "button": "left" }}
}}
{{
  "summary": "what you observed and why this is the next move",
  "action": {{ "kind": "click_target", "dx": 8, "dy": -6, "button": "left" }}
}}
{{
  "summary": "what you observed and why this is the next move",
  "action": {{ "kind": "double_click", "x": 100, "y": 200, "button": "left" }}
}}
{{
  "summary": "what you observed and why this is the next move",
  "action": {{ "kind": "double_click_target", "dx": 0, "dy": 0, "button": "left" }}
}}
{{
  "summary": "what you observed and why this is the next move",
  "action": {{ "kind": "drag", "from_x": 100, "from_y": 200, "to_x": 500, "to_y": 200, "button": "left" }}
}}
{{
  "summary": "what you observed and why this is the next move",
  "action": {{ "kind": "type", "text": "..." }}
}}
{{
  "summary": "what you observed and why this is the next move",
  "action": {{ "kind": "press_key", "key": "enter" }}
}}
{{
  "summary": "what you observed and why this is the next move",
  "action": {{ "kind": "key_combo", "modifiers": ["ctrl"], "key": "l" }}
}}
{{
  "summary": "what you observed and why this is the next move",
  "action": {{ "kind": "scroll", "dx": 0, "dy": -500 }}
}}
{{
  "summary": "what you observed and why this is the next move",
  "action": {{ "kind": "focus_window", "title_contains": "YouTube Studio" }}
}}
{{
  "summary": "what you observed and why this is the next move",
  "action": {{ "kind": "focus_target_window" }}
}}
{{
  "summary": "what you observed and why this is the next move",
  "action": {{ "kind": "wait_for_window", "title_contains": "YouTube Studio", "timeout_ms": 6000 }}
}}
{{
  "summary": "what you observed and why this is the next move",
  "action": {{ "kind": "wait_for_screen_change", "timeout_ms": 4000 }}
}}
{{
  "summary": "what you observed and why this is the next move",
  "action": {{ "kind": "wait_for_region_change", "size": 320, "timeout_ms": 3000 }}
}}
{{
  "summary": "what you observed and why this is the next move",
  "action": {{ "kind": "wait_for_target_region_change", "timeout_ms": 3000 }}
}}
{{
  "summary": "what you observed and why this is the next move",
  "action": {{ "kind": "uia_click", "name": "Upload", "automation_id": null, "class_name": null, "control_type": "button" }}
}}
{{
  "summary": "what you observed and why this is the next move",
  "action": {{ "kind": "uia_click_remembered" }}
}}
{{
  "summary": "what you observed and why this is the next move",
  "action": {{ "kind": "uia_invoke", "name": "Create", "automation_id": null, "class_name": null, "control_type": "button" }}
}}
{{
  "summary": "what you observed and why this is the next move",
  "action": {{ "kind": "uia_invoke_remembered" }}
}}
{{
  "summary": "what you observed and why this is the next move",
  "action": {{ "kind": "uia_focus", "name": "Title", "automation_id": null, "class_name": null, "control_type": "edit" }}
}}
{{
  "summary": "what you observed and why this is the next move",
  "action": {{ "kind": "uia_focus_remembered" }}
}}
{{
  "summary": "what you observed and why this is the next move",
  "action": {{ "kind": "uia_set_value", "name": "Title", "automation_id": null, "class_name": null, "control_type": "edit", "value": "My new video" }}
}}
{{
  "summary": "what you observed and why this is the next move",
  "action": {{ "kind": "uia_set_value_remembered", "value": "My new video" }}
}}
{{
  "summary": "what you observed and why this is the next move",
  "action": {{ "kind": "uia_wait_for_element", "name": "Upload", "automation_id": null, "class_name": null, "control_type": "button", "timeout_ms": 5000 }}
}}
{{
  "summary": "what you observed and why this is the next move",
  "action": {{ "kind": "uia_wait_for_remembered", "timeout_ms": 5000 }}
}}
{{
  "summary": "what you observed and why this is the next move",
  "action": {{ "kind": "browser_navigate", "url": "https://studio.youtube.com" }}
}}
{{
  "summary": "what you observed and why this is the next move",
  "action": {{ "kind": "browser_click", "selector": "button[aria-label='Create']" }}
}}
{{
  "summary": "what you observed and why this is the next move",
  "action": {{ "kind": "browser_click_remembered" }}
}}
{{
  "summary": "what you observed and why this is the next move",
  "action": {{ "kind": "browser_type", "selector": "input[type='text']", "text": "My new video" }}
}}
{{
  "summary": "what you observed and why this is the next move",
  "action": {{ "kind": "browser_type_remembered", "text": "My new video" }}
}}
{{
  "summary": "what you observed and why this is the next move",
  "action": {{ "kind": "browser_scroll", "mode": "bottom" }}
}}
{{
  "summary": "what you observed and why this is the next move",
  "action": {{ "kind": "browser_wait_for_selector", "selector": "input[type='file']", "timeout_ms": 5000 }}
}}
{{
  "summary": "what you observed and why this is the next move",
  "action": {{ "kind": "browser_wait_for_remembered", "timeout_ms": 5000 }}
}}
{{
  "summary": "what you observed and why this is the next move",
  "action": {{ "kind": "browser_extract", "selector": "body", "property": "textContent" }}
}}
{{
  "summary": "what you observed and why this is the next move",
  "action": {{ "kind": "search_web", "query": "youtube studio upload video" }}
}}
{{
  "summary": "what you observed and why this is the next move",
  "action": {{ "kind": "open_url", "url": "https://example.com" }}
}}
{{
  "summary": "what you observed and why this is the next move",
  "action": {{ "kind": "open_path", "path": "C:\\\\Users\\\\arnav\\\\Videos\\\\clip.mp4" }}
}}
{{
  "summary": "what you observed and why this is the next move",
  "action": {{ "kind": "launch_app", "command": "notepad", "args": [] }}
}}
{{
  "summary": "what you observed and why this is the next move",
  "action": {{ "kind": "copy_to_clipboard", "text": "Video title draft" }}
}}
{{
  "summary": "what you observed and why this is the next move",
  "action": {{ "kind": "paste_clipboard" }}
}}
{{
  "summary": "what you observed and why this is the next move",
  "action": {{ "kind": "wait", "ms": 1200 }}
}}
{{
  "summary": "why the task is complete",
  "action": {{ "kind": "done", "summary": "final outcome" }}
}}"#,
        goal,
        current_step,
        active_window.app_name,
        active_window.window_title,
        if active_window_native.is_some() {
            "active window crop"
        } else {
            "full screen"
        },
        substrate_label(substrate),
        substrate_guidance(substrate),
        user_activity,
        snapshot.width,
        snapshot.height,
        mouse_position.x,
        mouse_position.y,
        snapshot.fingerprint,
        region_snapshot.fingerprint,
        format_target_memory(&remembered_target),
        format_uia_target_memory(&remembered_uia_target),
        format_browser_target_memory(&remembered_browser_target),
        open_windows_summary,
        clipboard_preview,
        native_ui_summary,
        browser_page_summary,
        format_recent_history(&recent_history),
        repeat_count,
        if completed_summary.is_empty() {
            "None yet".to_string()
        } else {
            completed_summary
        }
    );

    let mut messages = vec![ChatMessage {
        role: "user".to_string(),
        content: prompt,
        image_base64: Some(snapshot.image_base64),
    }];
    if let Some(target_snapshot) = target_snapshot {
        messages.push(ChatMessage {
            role: "user".to_string(),
            content: "Remembered target close-up for the current desktop task.".to_string(),
            image_base64: Some(target_snapshot.image_base64),
        });
    }
    let conversation = providers::build_conversation(messages, None);
    let turn = providers::complete_turn(provider, api_key, model, &conversation, &crate::providers::no_tools(), base_url).await?;
    let decision = parse_desktop_decision(&turn.content)?;

    if let Some(summary) = detect_repeated_desktop_action(queue, agent_id, &decision.action).await?
    {
        return Ok(DesktopIterationResult::WaitingApproval {
            summary,
            action: decision.action,
        });
    }

    if let Some(reason) = risky_desktop_action_reason(&decision.action) {
        return Ok(DesktopIterationResult::WaitingApproval {
            summary: format!("{} {}", decision.summary, reason),
            action: decision.action,
        });
    }

    if execution_mode == "supervised" && should_supervise_desktop_action(&decision.action) {
        return Ok(DesktopIterationResult::WaitingApproval {
            summary: decision.summary,
            action: decision.action,
        });
    }

    perform_desktop_action(queue, agent_id, decision).await
}

fn parse_desktop_decision(raw: &str) -> Result<DesktopDecision, String> {
    let content = raw.trim();
    let json_str = if let Some(start) = content.find('{') {
        if let Some(end) = content.rfind('}') {
            &content[start..=end]
        } else {
            content
        }
    } else {
        content
    };

    serde_json::from_str(json_str)
        .map_err(|e| format!("Failed to parse desktop action JSON: {}", e))
}

async fn perform_desktop_action(
    queue: &SharedAgentQueue,
    agent_id: &str,
    decision: DesktopDecision,
) -> Result<DesktopIterationResult, String> {
    match decision.action {
        DesktopAction::MoveMouse { x, y } => {
            automation::auto_mouse_move(x, y)?;
            remember_desktop_target(
                queue,
                agent_id,
                build_target_memory(x, y, 160, 160, "move_mouse"),
            )
            .await?;
            Ok(DesktopIterationResult::Continue(format!(
                "{} Moved the mouse to ({}, {}).",
                decision.summary, x, y
            )))
        }
        DesktopAction::MoveToTarget { dx, dy } => {
            let target = load_desktop_target(queue, agent_id).await?;
            let move_x = target.center_x.saturating_add(dx.unwrap_or(0));
            let move_y = target.center_y.saturating_add(dy.unwrap_or(0));
            automation::auto_mouse_move(move_x, move_y)?;
            remember_desktop_target(
                queue,
                agent_id,
                build_target_memory(
                    move_x,
                    move_y,
                    target.width.max(120),
                    target.height.max(120),
                    "move_to_target",
                ),
            )
            .await?;
            Ok(DesktopIterationResult::Continue(format!(
                "{} Moved to the remembered target at ({}, {}).",
                decision.summary, move_x, move_y
            )))
        }
        DesktopAction::ClickRelative { dx, dy, button } => {
            let before = automation::auto_get_mouse_position()?;
            automation::auto_mouse_click_relative(dx, dy, button.clone())?;
            remember_desktop_target(
                queue,
                agent_id,
                build_target_memory(
                    before.x.saturating_add(dx),
                    before.y.saturating_add(dy),
                    180,
                    180,
                    "click_relative",
                ),
            )
            .await?;
            Ok(DesktopIterationResult::Continue(format!(
                "{} Clicked relative by ({}, {}){}.",
                decision.summary,
                dx,
                dy,
                button
                    .as_deref()
                    .map(|b| format!(" with {} button", b))
                    .unwrap_or_default()
            )))
        }
        DesktopAction::Click { x, y, button } => {
            automation::auto_mouse_click(Some(x), Some(y), button.clone())?;
            remember_desktop_target(
                queue,
                agent_id,
                build_target_memory(x, y, 180, 180, "click"),
            )
            .await?;
            Ok(DesktopIterationResult::Continue(format!(
                "{} Clicked at ({}, {}){}.",
                decision.summary,
                x,
                y,
                button
                    .as_deref()
                    .map(|b| format!(" with {} button", b))
                    .unwrap_or_default()
            )))
        }
        DesktopAction::ClickTarget { dx, dy, button } => {
            let target = load_desktop_target(queue, agent_id).await?;
            let offset_x = dx.unwrap_or(0);
            let offset_y = dy.unwrap_or(0);
            let click_x = target.center_x.saturating_add(offset_x);
            let click_y = target.center_y.saturating_add(offset_y);
            automation::auto_mouse_click(Some(click_x), Some(click_y), button.clone())?;
            remember_desktop_target(
                queue,
                agent_id,
                build_target_memory(
                    click_x,
                    click_y,
                    target.width.max(120),
                    target.height.max(120),
                    "click_target",
                ),
            )
            .await?;
            Ok(DesktopIterationResult::Continue(format!(
                "{} Clicked the remembered target at ({}, {}){}.",
                decision.summary,
                click_x,
                click_y,
                button
                    .as_deref()
                    .map(|b| format!(" with {} button", b))
                    .unwrap_or_default()
            )))
        }
        DesktopAction::DoubleClick { x, y, button } => {
            automation::auto_mouse_double_click(Some(x), Some(y), button.clone())?;
            remember_desktop_target(
                queue,
                agent_id,
                build_target_memory(x, y, 180, 180, "double_click"),
            )
            .await?;
            Ok(DesktopIterationResult::Continue(format!(
                "{} Double-clicked at ({}, {}){}.",
                decision.summary,
                x,
                y,
                button
                    .as_deref()
                    .map(|b| format!(" with {} button", b))
                    .unwrap_or_default()
            )))
        }
        DesktopAction::DoubleClickTarget { dx, dy, button } => {
            let target = load_desktop_target(queue, agent_id).await?;
            let click_x = target.center_x.saturating_add(dx.unwrap_or(0));
            let click_y = target.center_y.saturating_add(dy.unwrap_or(0));
            automation::auto_mouse_double_click(Some(click_x), Some(click_y), button.clone())?;
            remember_desktop_target(
                queue,
                agent_id,
                build_target_memory(
                    click_x,
                    click_y,
                    target.width.max(120),
                    target.height.max(120),
                    "double_click_target",
                ),
            )
            .await?;
            Ok(DesktopIterationResult::Continue(format!(
                "{} Double-clicked the remembered target at ({}, {}){}.",
                decision.summary,
                click_x,
                click_y,
                button
                    .as_deref()
                    .map(|b| format!(" with {} button", b))
                    .unwrap_or_default()
            )))
        }
        DesktopAction::Drag {
            from_x,
            from_y,
            to_x,
            to_y,
            button,
        } => {
            automation::auto_mouse_drag(from_x, from_y, to_x, to_y, button.clone())?;
            remember_desktop_target(
                queue,
                agent_id,
                build_target_memory(to_x, to_y, 220, 220, "drag"),
            )
            .await?;
            Ok(DesktopIterationResult::Continue(format!(
                "{} Dragged from ({}, {}) to ({}, {}){}.",
                decision.summary,
                from_x,
                from_y,
                to_x,
                to_y,
                button
                    .as_deref()
                    .map(|b| format!(" with {} button", b))
                    .unwrap_or_default()
            )))
        }
        DesktopAction::Type { text } => {
            let trimmed: String = text.chars().take(280).collect();
            automation::auto_type_text(trimmed.clone())?;
            Ok(DesktopIterationResult::Continue(format!(
                "{} Typed: {}",
                decision.summary,
                truncate(&trimmed, 120)
            )))
        }
        DesktopAction::PressKey { key } => {
            automation::auto_press_key(key.clone())?;
            Ok(DesktopIterationResult::Continue(format!(
                "{} Pressed key `{}`.",
                decision.summary, key
            )))
        }
        DesktopAction::KeyCombo { modifiers, key } => {
            automation::auto_key_combo(modifiers.clone(), key.clone())?;
            Ok(DesktopIterationResult::Continue(format!(
                "{} Pressed combo {}+{}.",
                decision.summary,
                modifiers.join("+"),
                key
            )))
        }
        DesktopAction::Scroll { dx, dy } => {
            automation::auto_scroll(dx, dy)?;
            Ok(DesktopIterationResult::Continue(format!(
                "{} Scrolled by ({}, {}).",
                decision.summary, dx, dy
            )))
        }
        DesktopAction::FocusWindow { title_contains } => {
            context::focus_window_internal(&title_contains)?;
            Ok(DesktopIterationResult::Continue(format!(
                "{} Focused a window matching `{}`.",
                decision.summary,
                truncate(&title_contains, 120)
            )))
        }
        DesktopAction::FocusTargetWindow => {
            let target = load_desktop_target(queue, agent_id).await?;
            let needle = if target.window_title.trim().is_empty() {
                target.app_name.clone()
            } else {
                target.window_title.clone()
            };
            context::focus_window_internal(&needle)?;
            Ok(DesktopIterationResult::Continue(format!(
                "{} Focused the remembered target window `{}`.",
                decision.summary,
                truncate(&needle, 120)
            )))
        }
        DesktopAction::WaitForWindow {
            title_contains,
            timeout_ms,
        } => {
            let timeout = timeout_ms.unwrap_or(5000).clamp(500, 15000);
            let started = std::time::Instant::now();
            let needle = title_contains.to_ascii_lowercase();

            loop {
                let windows = context::list_open_windows_internal().unwrap_or_default();
                let found = windows.iter().any(|window| {
                    window.window_title.to_ascii_lowercase().contains(&needle)
                        || window.app_name.to_ascii_lowercase().contains(&needle)
                });

                if found {
                    break;
                }

                if started.elapsed() >= std::time::Duration::from_millis(timeout) {
                    return Err(format!(
                        "Timed out waiting for a window matching `{}` after {}ms",
                        title_contains, timeout
                    ));
                }

                tokio::time::sleep(std::time::Duration::from_millis(250)).await;
            }

            Ok(DesktopIterationResult::Continue(format!(
                "{} Waited until a window matching `{}` appeared.",
                decision.summary,
                truncate(&title_contains, 120)
            )))
        }
        DesktopAction::WaitForScreenChange { timeout_ms } => {
            let timeout = timeout_ms.unwrap_or(4000).clamp(500, 15000);
            let initial_fingerprint = screen::capture_screen_snapshot_internal()?.fingerprint;
            let started = std::time::Instant::now();

            loop {
                tokio::time::sleep(std::time::Duration::from_millis(250)).await;
                let next_fingerprint = screen::capture_screen_snapshot_internal()?.fingerprint;
                if next_fingerprint != initial_fingerprint {
                    break;
                }

                if started.elapsed() >= std::time::Duration::from_millis(timeout) {
                    return Err(format!(
                        "Timed out waiting for screen change after {}ms",
                        timeout
                    ));
                }
            }

            Ok(DesktopIterationResult::Continue(format!(
                "{} Waited until the visible screen changed.",
                decision.summary
            )))
        }
        DesktopAction::WaitForRegionChange { size, timeout_ms } => {
            let timeout = timeout_ms.unwrap_or(3000).clamp(500, 15000);
            let region_size = size.unwrap_or(320).clamp(80, 800);
            let mouse_position = automation::auto_get_mouse_position()?;
            let initial_fingerprint =
                capture_cursor_region_snapshot(mouse_position.x, mouse_position.y, region_size)?
                    .fingerprint;
            let started = std::time::Instant::now();

            loop {
                tokio::time::sleep(std::time::Duration::from_millis(200)).await;
                let current_mouse = automation::auto_get_mouse_position()?;
                let next_fingerprint =
                    capture_cursor_region_snapshot(current_mouse.x, current_mouse.y, region_size)?
                        .fingerprint;
                if next_fingerprint != initial_fingerprint {
                    break;
                }

                if started.elapsed() >= std::time::Duration::from_millis(timeout) {
                    return Err(format!(
                        "Timed out waiting for region change after {}ms",
                        timeout
                    ));
                }
            }

            Ok(DesktopIterationResult::Continue(format!(
                "{} Waited until the cursor region changed.",
                decision.summary
            )))
        }
        DesktopAction::WaitForTargetRegionChange { timeout_ms } => {
            let timeout = timeout_ms.unwrap_or(3000).clamp(500, 15000);
            let target = load_desktop_target(queue, agent_id).await?;
            let initial_fingerprint = capture_target_region_snapshot(&target)?.fingerprint;
            let started = std::time::Instant::now();

            loop {
                tokio::time::sleep(std::time::Duration::from_millis(200)).await;
                let next_fingerprint = capture_target_region_snapshot(&target)?.fingerprint;
                if next_fingerprint != initial_fingerprint {
                    break;
                }

                if started.elapsed() >= std::time::Duration::from_millis(timeout) {
                    return Err(format!(
                        "Timed out waiting for remembered target region change after {}ms",
                        timeout
                    ));
                }
            }

            Ok(DesktopIterationResult::Continue(format!(
                "{} Waited until the remembered target region changed.",
                decision.summary
            )))
        }
        DesktopAction::UiaClick {
            name,
            automation_id,
            class_name,
            control_type,
        } => {
            let selector = ui_automation::UiSelector {
                name,
                automation_id,
                class_name,
                control_type,
            };
            remember_uia_target(queue, agent_id, selector.clone(), "uia_click").await?;
            let outcome = ui_automation::uia_click_internal(selector)?;
            Ok(DesktopIterationResult::Continue(format!(
                "{} {}.",
                decision.summary, outcome
            )))
        }
        DesktopAction::UiaClickRemembered => {
            let selector = load_uia_target(queue, agent_id).await?;
            let outcome = ui_automation::uia_click_internal(selector.clone())?;
            remember_uia_target(queue, agent_id, selector, "uia_click_remembered").await?;
            Ok(DesktopIterationResult::Continue(format!(
                "{} {}.",
                decision.summary, outcome
            )))
        }
        DesktopAction::UiaInvoke {
            name,
            automation_id,
            class_name,
            control_type,
        } => {
            let selector = ui_automation::UiSelector {
                name,
                automation_id,
                class_name,
                control_type,
            };
            remember_uia_target(queue, agent_id, selector.clone(), "uia_invoke").await?;
            let outcome = ui_automation::uia_invoke_internal(selector)?;
            Ok(DesktopIterationResult::Continue(format!(
                "{} {}.",
                decision.summary, outcome
            )))
        }
        DesktopAction::UiaInvokeRemembered => {
            let selector = load_uia_target(queue, agent_id).await?;
            let outcome = ui_automation::uia_invoke_internal(selector.clone())?;
            remember_uia_target(queue, agent_id, selector, "uia_invoke_remembered").await?;
            Ok(DesktopIterationResult::Continue(format!(
                "{} {}.",
                decision.summary, outcome
            )))
        }
        DesktopAction::UiaFocus {
            name,
            automation_id,
            class_name,
            control_type,
        } => {
            let selector = ui_automation::UiSelector {
                name,
                automation_id,
                class_name,
                control_type,
            };
            remember_uia_target(queue, agent_id, selector.clone(), "uia_focus").await?;
            let outcome = ui_automation::uia_focus_internal(selector)?;
            Ok(DesktopIterationResult::Continue(format!(
                "{} {}.",
                decision.summary, outcome
            )))
        }
        DesktopAction::UiaFocusRemembered => {
            let selector = load_uia_target(queue, agent_id).await?;
            let outcome = ui_automation::uia_focus_internal(selector.clone())?;
            remember_uia_target(queue, agent_id, selector, "uia_focus_remembered").await?;
            Ok(DesktopIterationResult::Continue(format!(
                "{} {}.",
                decision.summary, outcome
            )))
        }
        DesktopAction::UiaSetValue {
            name,
            automation_id,
            class_name,
            control_type,
            value,
        } => {
            let selector = ui_automation::UiSelector {
                name,
                automation_id,
                class_name,
                control_type,
            };
            remember_uia_target(queue, agent_id, selector.clone(), "uia_set_value").await?;
            let outcome = ui_automation::uia_set_value_internal(selector, value.clone())?;
            Ok(DesktopIterationResult::Continue(format!(
                "{} {}.",
                decision.summary, outcome
            )))
        }
        DesktopAction::UiaSetValueRemembered { value } => {
            let selector = load_uia_target(queue, agent_id).await?;
            let outcome = ui_automation::uia_set_value_internal(selector.clone(), value.clone())?;
            remember_uia_target(queue, agent_id, selector, "uia_set_value_remembered").await?;
            Ok(DesktopIterationResult::Continue(format!(
                "{} {}.",
                decision.summary, outcome
            )))
        }
        DesktopAction::UiaWaitForElement {
            name,
            automation_id,
            class_name,
            control_type,
            timeout_ms,
        } => {
            let selector = ui_automation::UiSelector {
                name,
                automation_id,
                class_name,
                control_type,
            };
            remember_uia_target(queue, agent_id, selector.clone(), "uia_wait_for_element").await?;
            let outcome =
                ui_automation::uia_wait_for_element_internal(selector, timeout_ms.unwrap_or(5000))?;
            Ok(DesktopIterationResult::Continue(format!(
                "{} {}.",
                decision.summary, outcome
            )))
        }
        DesktopAction::UiaWaitForRemembered { timeout_ms } => {
            let selector = load_uia_target(queue, agent_id).await?;
            let outcome = ui_automation::uia_wait_for_element_internal(
                selector.clone(),
                timeout_ms.unwrap_or(5000),
            )?;
            remember_uia_target(queue, agent_id, selector, "uia_wait_for_remembered").await?;
            Ok(DesktopIterationResult::Continue(format!(
                "{} {}.",
                decision.summary, outcome
            )))
        }
        DesktopAction::BrowserNavigate { url } => {
            let outcome =
                browser_native::web_action_internal(agent_id, "navigate", &url, "").await?;
            Ok(DesktopIterationResult::Continue(format!(
                "{} {}.",
                decision.summary, outcome
            )))
        }
        DesktopAction::BrowserClick { selector } => {
            remember_browser_target(queue, agent_id, selector.clone(), "browser_click").await?;
            let outcome =
                browser_native::web_action_internal(agent_id, "click", &selector, "").await?;
            Ok(DesktopIterationResult::Continue(format!(
                "{} {}.",
                decision.summary, outcome
            )))
        }
        DesktopAction::BrowserClickRemembered => {
            let selector = load_browser_target(queue, agent_id).await?;
            let outcome =
                browser_native::web_action_internal(agent_id, "click", &selector, "").await?;
            remember_browser_target(queue, agent_id, selector, "browser_click_remembered").await?;
            Ok(DesktopIterationResult::Continue(format!(
                "{} {}.",
                decision.summary, outcome
            )))
        }
        DesktopAction::BrowserType { selector, text } => {
            remember_browser_target(queue, agent_id, selector.clone(), "browser_type").await?;
            let outcome =
                browser_native::web_action_internal(agent_id, "type", &selector, &text).await?;
            Ok(DesktopIterationResult::Continue(format!(
                "{} {}.",
                decision.summary, outcome
            )))
        }
        DesktopAction::BrowserTypeRemembered { text } => {
            let selector = load_browser_target(queue, agent_id).await?;
            let outcome =
                browser_native::web_action_internal(agent_id, "type", &selector, &text).await?;
            remember_browser_target(queue, agent_id, selector, "browser_type_remembered").await?;
            Ok(DesktopIterationResult::Continue(format!(
                "{} {}.",
                decision.summary, outcome
            )))
        }
        DesktopAction::BrowserScroll { mode } => {
            let value = mode.unwrap_or_else(|| "bottom".to_string());
            let outcome =
                browser_native::web_action_internal(agent_id, "scroll", "", &value).await?;
            Ok(DesktopIterationResult::Continue(format!(
                "{} {}.",
                decision.summary, outcome
            )))
        }
        DesktopAction::BrowserWaitForSelector {
            selector,
            timeout_ms,
        } => {
            remember_browser_target(
                queue,
                agent_id,
                selector.clone(),
                "browser_wait_for_selector",
            )
            .await?;
            let timeout = timeout_ms.unwrap_or(5000).to_string();
            let outcome =
                browser_native::web_action_internal(agent_id, "wait", &selector, &timeout).await?;
            Ok(DesktopIterationResult::Continue(format!(
                "{} {}.",
                decision.summary, outcome
            )))
        }
        DesktopAction::BrowserWaitForRemembered { timeout_ms } => {
            let selector = load_browser_target(queue, agent_id).await?;
            let timeout = timeout_ms.unwrap_or(5000).to_string();
            let outcome =
                browser_native::web_action_internal(agent_id, "wait", &selector, &timeout).await?;
            remember_browser_target(queue, agent_id, selector, "browser_wait_for_remembered")
                .await?;
            Ok(DesktopIterationResult::Continue(format!(
                "{} {}.",
                decision.summary, outcome
            )))
        }
        DesktopAction::BrowserExtract { selector, property } => {
            let target = selector.unwrap_or_else(|| "body".to_string());
            let prop = property.unwrap_or_else(|| "textContent".to_string());
            remember_browser_target(queue, agent_id, target.clone(), "browser_extract").await?;
            let outcome =
                browser_native::web_action_internal(agent_id, "extract", &target, &prop).await?;
            Ok(DesktopIterationResult::Continue(format!(
                "{} Browser extract result: {}",
                decision.summary,
                truncate(&outcome.replace('\n', " "), 200)
            )))
        }
        DesktopAction::SearchWeb { query } => {
            let encoded = encode_query(&query);
            let url = format!("https://www.google.com/search?q={}", encoded);
            automation::auto_open_url(url)?;
            Ok(DesktopIterationResult::Continue(format!(
                "{} Searched the web for `{}`.",
                decision.summary,
                truncate(&query, 120)
            )))
        }
        DesktopAction::OpenUrl { url } => {
            automation::auto_open_url(url.clone())?;
            Ok(DesktopIterationResult::Continue(format!(
                "{} Opened URL `{}`.",
                decision.summary,
                truncate(&url, 120)
            )))
        }
        DesktopAction::OpenPath { path } => {
            automation::auto_open_path(path.clone())?;
            Ok(DesktopIterationResult::Continue(format!(
                "{} Opened path `{}`.",
                decision.summary,
                truncate(&path, 120)
            )))
        }
        DesktopAction::LaunchApp { command, args } => {
            let args_for_message = args.clone().unwrap_or_default();
            automation::auto_launch_app(command.clone(), args)?;
            let rendered_args = if args_for_message.is_empty() {
                String::new()
            } else {
                format!(" {}", args_for_message.join(" "))
            };
            Ok(DesktopIterationResult::Continue(format!(
                "{} Launched app `{}{}`.",
                decision.summary, command, rendered_args
            )))
        }
        DesktopAction::CopyToClipboard { text } => {
            let trimmed: String = text.chars().take(2000).collect();
            automation::auto_copy_to_clipboard(trimmed.clone())?;
            Ok(DesktopIterationResult::Continue(format!(
                "{} Copied to clipboard: {}",
                decision.summary,
                truncate(&trimmed, 120)
            )))
        }
        DesktopAction::PasteClipboard => {
            automation::auto_paste_clipboard()?;
            Ok(DesktopIterationResult::Continue(format!(
                "{} Pasted the current clipboard.",
                decision.summary
            )))
        }
        DesktopAction::Wait { ms } => {
            let duration = ms.unwrap_or(1000).clamp(250, 5000);
            tokio::time::sleep(std::time::Duration::from_millis(duration)).await;
            Ok(DesktopIterationResult::Continue(format!(
                "{} Waited {}ms.",
                decision.summary, duration
            )))
        }
        DesktopAction::Done { summary } => Ok(DesktopIterationResult::Done(format!(
            "{} {}",
            decision.summary, summary
        ))),
    }
}

async fn detect_repeated_desktop_action(
    queue: &SharedAgentQueue,
    agent_id: &str,
    action: &DesktopAction,
) -> Result<Option<String>, String> {
    let signature = desktop_action_signature(action);
    let mut q = queue.lock().await;
    let agent = q.get_mut(agent_id).ok_or("Agent not found".to_string())?;
    let last_signature = agent.context.get(DESKTOP_LAST_ACTION_KEY).cloned();
    let repeat_count = agent
        .context
        .get(DESKTOP_REPEAT_COUNT_KEY)
        .and_then(|value| value.parse::<u32>().ok())
        .unwrap_or(0);

    let next_repeat_count = if last_signature.as_deref() == Some(signature.as_str()) {
        repeat_count + 1
    } else {
        1
    };

    agent
        .context
        .insert(DESKTOP_LAST_ACTION_KEY.to_string(), signature.clone());
    agent.context.insert(
        DESKTOP_REPEAT_COUNT_KEY.to_string(),
        next_repeat_count.to_string(),
    );

    if next_repeat_count >= 3 {
        return Ok(Some(format!(
            "Blade proposed the same desktop action {} times in a row (`{}`). Approval is required to avoid getting stuck in a loop.",
            next_repeat_count, signature
        )));
    }

    Ok(None)
}

fn desktop_action_signature(action: &DesktopAction) -> String {
    match action {
        DesktopAction::MoveMouse { x, y } => format!("move_mouse:{}:{}", x, y),
        DesktopAction::MoveToTarget { dx, dy } => {
            format!("move_to_target:{}:{}", dx.unwrap_or(0), dy.unwrap_or(0))
        }
        DesktopAction::ClickRelative { dx, dy, button } => format!(
            "click_relative:{}:{}:{}",
            dx,
            dy,
            button.as_deref().unwrap_or("left")
        ),
        DesktopAction::Click { x, y, button } => {
            format!("click:{}:{}:{}", x, y, button.as_deref().unwrap_or("left"))
        }
        DesktopAction::ClickTarget { dx, dy, button } => format!(
            "click_target:{}:{}:{}",
            dx.unwrap_or(0),
            dy.unwrap_or(0),
            button.as_deref().unwrap_or("left")
        ),
        DesktopAction::DoubleClickTarget { dx, dy, button } => format!(
            "double_click_target:{}:{}:{}",
            dx.unwrap_or(0),
            dy.unwrap_or(0),
            button.as_deref().unwrap_or("left")
        ),
        DesktopAction::DoubleClick { x, y, button } => {
            format!(
                "double_click:{}:{}:{}",
                x,
                y,
                button.as_deref().unwrap_or("left")
            )
        }
        DesktopAction::Drag {
            from_x,
            from_y,
            to_x,
            to_y,
            button,
        } => format!(
            "drag:{}:{}:{}:{}:{}",
            from_x,
            from_y,
            to_x,
            to_y,
            button.as_deref().unwrap_or("left")
        ),
        DesktopAction::Type { text } => format!("type:{}", truncate(text, 80)),
        DesktopAction::PressKey { key } => format!("press_key:{}", key),
        DesktopAction::KeyCombo { modifiers, key } => {
            format!("key_combo:{}+{}", modifiers.join("+"), key)
        }
        DesktopAction::Scroll { dx, dy } => format!("scroll:{}:{}", dx, dy),
        DesktopAction::FocusWindow { title_contains } => {
            format!("focus_window:{}", truncate(title_contains, 120))
        }
        DesktopAction::FocusTargetWindow => "focus_target_window".to_string(),
        DesktopAction::WaitForWindow {
            title_contains,
            timeout_ms,
        } => format!(
            "wait_for_window:{}:{}",
            truncate(title_contains, 120),
            timeout_ms.unwrap_or(5000)
        ),
        DesktopAction::WaitForScreenChange { timeout_ms } => {
            format!("wait_for_screen_change:{}", timeout_ms.unwrap_or(4000))
        }
        DesktopAction::WaitForRegionChange { size, timeout_ms } => format!(
            "wait_for_region_change:{}:{}",
            size.unwrap_or(320),
            timeout_ms.unwrap_or(3000)
        ),
        DesktopAction::WaitForTargetRegionChange { timeout_ms } => {
            format!(
                "wait_for_target_region_change:{}",
                timeout_ms.unwrap_or(3000)
            )
        }
        DesktopAction::UiaClick {
            name,
            automation_id,
            class_name,
            control_type,
        } => format!(
            "uia_click:{}:{}:{}:{}",
            truncate(name.as_deref().unwrap_or(""), 80),
            truncate(automation_id.as_deref().unwrap_or(""), 80),
            truncate(class_name.as_deref().unwrap_or(""), 80),
            truncate(control_type.as_deref().unwrap_or(""), 40)
        ),
        DesktopAction::UiaClickRemembered => "uia_click_remembered".to_string(),
        DesktopAction::UiaInvoke {
            name,
            automation_id,
            class_name,
            control_type,
        } => format!(
            "uia_invoke:{}:{}:{}:{}",
            truncate(name.as_deref().unwrap_or(""), 80),
            truncate(automation_id.as_deref().unwrap_or(""), 80),
            truncate(class_name.as_deref().unwrap_or(""), 80),
            truncate(control_type.as_deref().unwrap_or(""), 40)
        ),
        DesktopAction::UiaInvokeRemembered => "uia_invoke_remembered".to_string(),
        DesktopAction::UiaFocus {
            name,
            automation_id,
            class_name,
            control_type,
        } => format!(
            "uia_focus:{}:{}:{}:{}",
            truncate(name.as_deref().unwrap_or(""), 80),
            truncate(automation_id.as_deref().unwrap_or(""), 80),
            truncate(class_name.as_deref().unwrap_or(""), 80),
            truncate(control_type.as_deref().unwrap_or(""), 40)
        ),
        DesktopAction::UiaFocusRemembered => "uia_focus_remembered".to_string(),
        DesktopAction::UiaSetValue {
            name,
            automation_id,
            class_name,
            control_type,
            value,
        } => format!(
            "uia_set_value:{}:{}:{}:{}:{}",
            truncate(name.as_deref().unwrap_or(""), 80),
            truncate(automation_id.as_deref().unwrap_or(""), 80),
            truncate(class_name.as_deref().unwrap_or(""), 80),
            truncate(control_type.as_deref().unwrap_or(""), 40),
            truncate(value, 80)
        ),
        DesktopAction::UiaSetValueRemembered { value } => {
            format!("uia_set_value_remembered:{}", truncate(value, 80))
        }
        DesktopAction::UiaWaitForElement {
            name,
            automation_id,
            class_name,
            control_type,
            timeout_ms,
        } => format!(
            "uia_wait_for_element:{}:{}:{}:{}:{}",
            truncate(name.as_deref().unwrap_or(""), 80),
            truncate(automation_id.as_deref().unwrap_or(""), 80),
            truncate(class_name.as_deref().unwrap_or(""), 80),
            truncate(control_type.as_deref().unwrap_or(""), 40),
            timeout_ms.unwrap_or(5000)
        ),
        DesktopAction::UiaWaitForRemembered { timeout_ms } => {
            format!("uia_wait_for_remembered:{}", timeout_ms.unwrap_or(5000))
        }
        DesktopAction::BrowserNavigate { url } => {
            format!("browser_navigate:{}", truncate(url, 120))
        }
        DesktopAction::BrowserClick { selector } => {
            format!("browser_click:{}", truncate(selector, 120))
        }
        DesktopAction::BrowserClickRemembered => "browser_click_remembered".to_string(),
        DesktopAction::BrowserType { selector, text } => {
            format!(
                "browser_type:{}:{}",
                truncate(selector, 120),
                truncate(text, 80)
            )
        }
        DesktopAction::BrowserTypeRemembered { text } => {
            format!("browser_type_remembered:{}", truncate(text, 80))
        }
        DesktopAction::BrowserScroll { mode } => {
            format!("browser_scroll:{}", mode.as_deref().unwrap_or("bottom"))
        }
        DesktopAction::BrowserWaitForSelector {
            selector,
            timeout_ms,
        } => format!(
            "browser_wait_for_selector:{}:{}",
            truncate(selector, 120),
            timeout_ms.unwrap_or(5000)
        ),
        DesktopAction::BrowserWaitForRemembered { timeout_ms } => {
            format!("browser_wait_for_remembered:{}", timeout_ms.unwrap_or(5000))
        }
        DesktopAction::BrowserExtract { selector, property } => format!(
            "browser_extract:{}:{}",
            truncate(selector.as_deref().unwrap_or("body"), 120),
            truncate(property.as_deref().unwrap_or("textContent"), 40)
        ),
        DesktopAction::SearchWeb { query } => format!("search_web:{}", truncate(query, 120)),
        DesktopAction::OpenUrl { url } => format!("open_url:{}", truncate(url, 120)),
        DesktopAction::OpenPath { path } => format!("open_path:{}", truncate(path, 120)),
        DesktopAction::LaunchApp { command, args } => format!(
            "launch_app:{}:{}",
            command,
            args.as_ref()
                .map(|value| value.join(" "))
                .unwrap_or_default()
        ),
        DesktopAction::CopyToClipboard { text } => {
            format!("copy_to_clipboard:{}", truncate(text, 120))
        }
        DesktopAction::PasteClipboard => "paste_clipboard".to_string(),
        DesktopAction::Wait { ms } => format!("wait:{}", ms.unwrap_or(1000)),
        DesktopAction::Done { summary } => format!("done:{}", truncate(summary, 80)),
    }
}

fn format_recent_history(raw: &str) -> String {
    let items: Vec<String> = serde_json::from_str(raw).unwrap_or_default();
    if items.is_empty() {
        "None yet".to_string()
    } else {
        items
            .into_iter()
            .map(|item| format!("- {}", item))
            .collect::<Vec<_>>()
            .join("\n")
    }
}

fn format_target_memory(raw: &str) -> String {
    let Ok(target) = serde_json::from_str::<DesktopTargetMemory>(raw) else {
        return "None yet".to_string();
    };

    format!(
        "- center: ({}, {})\n- size: {}x{}\n- app: {}\n- window: {}\n- learned from: {}",
        target.center_x,
        target.center_y,
        target.width,
        target.height,
        target.app_name,
        truncate(&target.window_title, 80),
        target.source
    )
}

fn format_uia_target_memory(raw: &str) -> String {
    let Ok(target) = serde_json::from_str::<DesktopUiaTargetMemory>(raw) else {
        return "None yet".to_string();
    };

    let selector = &target.selector;
    format!(
        "- name: {}\n- automation id: {}\n- class: {}\n- control type: {}\n- learned from: {}",
        blank_field(selector.name.as_deref()),
        blank_field(selector.automation_id.as_deref()),
        blank_field(selector.class_name.as_deref()),
        blank_field(selector.control_type.as_deref()),
        target.source
    )
}

fn format_browser_target_memory(raw: &str) -> String {
    let Ok(target) = serde_json::from_str::<DesktopBrowserTargetMemory>(raw) else {
        return "None yet".to_string();
    };

    format!(
        "- selector: {}\n- learned from: {}",
        target.selector, target.source
    )
}

fn blank_field(value: Option<&str>) -> String {
    match value {
        Some(text) if !text.trim().is_empty() => text.to_string(),
        _ => "unknown".to_string(),
    }
}

fn choose_control_substrate(
    goal: &str,
    active_window: &context::WindowContext,
    has_native_window_snapshot: bool,
) -> ControlSubstrate {
    let combined = format!(
        "{} {} {}",
        goal, active_window.app_name, active_window.window_title
    )
    .to_ascii_lowercase();

    let browser_like = [
        "chrome",
        "edge",
        "brave",
        "firefox",
        "browser",
        "youtube",
        "gmail",
        "docs.google",
    ]
    .iter()
    .any(|needle| combined.contains(needle));

    if browser_like {
        ControlSubstrate::BrowserNative
    } else if has_native_window_snapshot {
        ControlSubstrate::WindowsNative
    } else {
        ControlSubstrate::VisualFallback
    }
}

fn substrate_label(substrate: ControlSubstrate) -> &'static str {
    match substrate {
        ControlSubstrate::BrowserNative => "browser-native",
        ControlSubstrate::WindowsNative => "windows-native",
        ControlSubstrate::VisualFallback => "visual-fallback",
    }
}

fn substrate_guidance(substrate: ControlSubstrate) -> &'static str {
    match substrate {
        ControlSubstrate::BrowserNative => {
            "This looks like a browser task. Prefer browser-native control when available, otherwise prefer native UI Automation over screenshot actions. Use screenshot actions only as a last resort."
        }
        ControlSubstrate::WindowsNative => {
            "This looks like a normal desktop app. Prefer native UI Automation actions and remembered native controls before using coordinate-based or screenshot-driven actions."
        }
        ControlSubstrate::VisualFallback => {
            "Native structure is limited here. Prefer remembered targets, local region checks, and precise visual fallback actions."
        }
    }
}

fn format_open_windows(windows: &[context::WindowContext]) -> String {
    if windows.is_empty() {
        return "None detected".to_string();
    }

    windows
        .iter()
        .take(8)
        .map(|window| {
            let title = if window.window_title.trim().is_empty() {
                "Untitled".to_string()
            } else {
                truncate(&window.window_title, 100)
            };
            format!("- {}: {}", window.app_name, title)
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn capture_cursor_region_snapshot(
    mouse_x: i32,
    mouse_y: i32,
    size: u32,
) -> Result<screen::ScreenSnapshot, String> {
    let snapshot = screen::capture_screen_snapshot_internal()?;
    let clamped_size = size.clamp(80, 800);
    let half = (clamped_size / 2) as i32;

    let max_x = snapshot.width.saturating_sub(clamped_size);
    let max_y = snapshot.height.saturating_sub(clamped_size);

    let region_x = mouse_x.saturating_sub(half).clamp(0, max_x as i32) as u32;
    let region_y = mouse_y.saturating_sub(half).clamp(0, max_y as i32) as u32;

    screen::capture_screen_region_snapshot_internal(region_x, region_y, clamped_size, clamped_size)
}

fn capture_target_region_snapshot(
    target: &DesktopTargetMemory,
) -> Result<screen::ScreenSnapshot, String> {
    let snapshot = screen::capture_screen_snapshot_internal()?;
    let width = target.width.clamp(80, snapshot.width.max(80));
    let height = target.height.clamp(80, snapshot.height.max(80));
    let half_width = (width / 2) as i32;
    let half_height = (height / 2) as i32;
    let max_x = snapshot.width.saturating_sub(width);
    let max_y = snapshot.height.saturating_sub(height);
    let region_x = target
        .center_x
        .saturating_sub(half_width)
        .clamp(0, max_x as i32) as u32;
    let region_y = target
        .center_y
        .saturating_sub(half_height)
        .clamp(0, max_y as i32) as u32;

    screen::capture_screen_region_snapshot_internal(region_x, region_y, width, height)
}

fn capture_window_snapshot(
    window: &ui_automation::UiWindowSnapshot,
    full_snapshot: &screen::ScreenSnapshot,
) -> Result<screen::ScreenSnapshot, String> {
    let bounds = &window.bounds;
    if bounds.width < 120 || bounds.height < 120 {
        return Err("Active window bounds are too small for a useful crop.".to_string());
    }

    let max_width = full_snapshot.width as i32;
    let max_height = full_snapshot.height as i32;
    let left = bounds.left.clamp(0, max_width.saturating_sub(1));
    let top = bounds.top.clamp(0, max_height.saturating_sub(1));
    let right = bounds.right.clamp(left + 1, max_width);
    let bottom = bounds.bottom.clamp(top + 1, max_height);
    let width = (right - left).max(1) as u32;
    let height = (bottom - top).max(1) as u32;

    screen::capture_screen_region_snapshot_internal(left as u32, top as u32, width, height)
}

fn build_target_memory(
    center_x: i32,
    center_y: i32,
    width: u32,
    height: u32,
    source: &str,
) -> DesktopTargetMemory {
    let active_window = context::get_active_window().unwrap_or_default();
    DesktopTargetMemory {
        center_x,
        center_y,
        width,
        height,
        app_name: active_window.app_name,
        window_title: active_window.window_title,
        source: source.to_string(),
    }
}

fn encode_query(input: &str) -> String {
    let mut encoded = String::new();
    for byte in input.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                encoded.push(byte as char)
            }
            b' ' => encoded.push('+'),
            _ => encoded.push_str(&format!("%{:02X}", byte)),
        }
    }
    encoded
}

fn record_desktop_history(agent: &mut Agent, summary: &str) {
    let mut items: Vec<String> = agent
        .context
        .get(DESKTOP_HISTORY_KEY)
        .and_then(|raw| serde_json::from_str(raw).ok())
        .unwrap_or_default();

    items.push(truncate(summary, 240));
    if items.len() > 6 {
        let drain_count = items.len().saturating_sub(6);
        items.drain(0..drain_count);
    }

    if let Ok(serialized) = serde_json::to_string(&items) {
        agent
            .context
            .insert(DESKTOP_HISTORY_KEY.to_string(), serialized);
    }
}

async fn remember_desktop_target(
    queue: &SharedAgentQueue,
    agent_id: &str,
    target: DesktopTargetMemory,
) -> Result<(), String> {
    let mut q = queue.lock().await;
    let agent = q.get_mut(agent_id).ok_or("Agent not found".to_string())?;
    let serialized = serde_json::to_string(&target)
        .map_err(|error| format!("Failed to store desktop target memory: {}", error))?;
    agent
        .context
        .insert(DESKTOP_TARGET_KEY.to_string(), serialized);
    Ok(())
}

async fn remember_uia_target(
    queue: &SharedAgentQueue,
    agent_id: &str,
    selector: ui_automation::UiSelector,
    source: &str,
) -> Result<(), String> {
    let mut q = queue.lock().await;
    let agent = q.get_mut(agent_id).ok_or("Agent not found".to_string())?;
    let serialized = serde_json::to_string(&DesktopUiaTargetMemory {
        selector,
        source: source.to_string(),
    })
    .map_err(|error| format!("Failed to store native UI target memory: {}", error))?;
    agent
        .context
        .insert(DESKTOP_UIA_TARGET_KEY.to_string(), serialized);
    Ok(())
}

async fn remember_browser_target(
    queue: &SharedAgentQueue,
    agent_id: &str,
    selector: String,
    source: &str,
) -> Result<(), String> {
    let mut q = queue.lock().await;
    let agent = q.get_mut(agent_id).ok_or("Agent not found".to_string())?;
    let serialized = serde_json::to_string(&DesktopBrowserTargetMemory {
        selector,
        source: source.to_string(),
    })
    .map_err(|error| format!("Failed to store browser target memory: {}", error))?;
    agent
        .context
        .insert(DESKTOP_BROWSER_TARGET_KEY.to_string(), serialized);
    Ok(())
}

async fn load_desktop_target(
    queue: &SharedAgentQueue,
    agent_id: &str,
) -> Result<DesktopTargetMemory, String> {
    let q = queue.lock().await;
    let agent = q.get(agent_id).ok_or("Agent not found".to_string())?;
    let raw = agent
        .context
        .get(DESKTOP_TARGET_KEY)
        .ok_or("Blade does not have a remembered target yet.".to_string())?;
    serde_json::from_str(raw).map_err(|error| {
        format!(
            "Blade could not read its remembered desktop target: {}",
            error
        )
    })
}

async fn load_uia_target(
    queue: &SharedAgentQueue,
    agent_id: &str,
) -> Result<ui_automation::UiSelector, String> {
    let q = queue.lock().await;
    let agent = q.get(agent_id).ok_or("Agent not found".to_string())?;
    let raw = agent
        .context
        .get(DESKTOP_UIA_TARGET_KEY)
        .ok_or("Blade does not have a remembered native control yet.".to_string())?;
    let parsed = serde_json::from_str::<DesktopUiaTargetMemory>(raw).map_err(|error| {
        format!(
            "Blade could not read its remembered native control: {}",
            error
        )
    })?;
    Ok(parsed.selector)
}

async fn load_browser_target(queue: &SharedAgentQueue, agent_id: &str) -> Result<String, String> {
    let q = queue.lock().await;
    let agent = q.get(agent_id).ok_or("Agent not found".to_string())?;
    let raw = agent
        .context
        .get(DESKTOP_BROWSER_TARGET_KEY)
        .ok_or("Blade does not have a remembered browser selector yet.".to_string())?;
    let parsed = serde_json::from_str::<DesktopBrowserTargetMemory>(raw).map_err(|error| {
        format!(
            "Blade could not read its remembered browser selector: {}",
            error
        )
    })?;
    Ok(parsed.selector)
}

fn should_supervise_desktop_action(action: &DesktopAction) -> bool {
    matches!(
        action,
        DesktopAction::MoveMouse { .. }
            | DesktopAction::MoveToTarget { .. }
            | DesktopAction::ClickRelative { .. }
            | DesktopAction::DoubleClick { .. }
            | DesktopAction::DoubleClickTarget { .. }
            | DesktopAction::Drag { .. }
            | DesktopAction::Click { .. }
            | DesktopAction::ClickTarget { .. }
            | DesktopAction::Type { .. }
            | DesktopAction::PressKey { .. }
            | DesktopAction::KeyCombo { .. }
            | DesktopAction::Scroll { .. }
            | DesktopAction::FocusWindow { .. }
            | DesktopAction::FocusTargetWindow
            | DesktopAction::WaitForWindow { .. }
            | DesktopAction::WaitForScreenChange { .. }
            | DesktopAction::WaitForRegionChange { .. }
            | DesktopAction::WaitForTargetRegionChange { .. }
            | DesktopAction::UiaClick { .. }
            | DesktopAction::UiaClickRemembered
            | DesktopAction::UiaInvoke { .. }
            | DesktopAction::UiaInvokeRemembered
            | DesktopAction::UiaFocus { .. }
            | DesktopAction::UiaFocusRemembered
            | DesktopAction::UiaSetValue { .. }
            | DesktopAction::UiaSetValueRemembered { .. }
            | DesktopAction::UiaWaitForElement { .. }
            | DesktopAction::UiaWaitForRemembered { .. }
            | DesktopAction::BrowserNavigate { .. }
            | DesktopAction::BrowserClick { .. }
            | DesktopAction::BrowserClickRemembered
            | DesktopAction::BrowserType { .. }
            | DesktopAction::BrowserTypeRemembered { .. }
            | DesktopAction::BrowserScroll { .. }
            | DesktopAction::BrowserWaitForSelector { .. }
            | DesktopAction::BrowserWaitForRemembered { .. }
            | DesktopAction::SearchWeb { .. }
            | DesktopAction::OpenPath { .. }
            | DesktopAction::CopyToClipboard { .. }
            | DesktopAction::PasteClipboard
    )
}

fn risky_desktop_action_reason(action: &DesktopAction) -> Option<String> {
    match action {
        DesktopAction::Type { text } if looks_sensitive_text(text) => Some(
            "Blade wants to type something that looks sensitive or account-related, so approval is required.".to_string(),
        ),
        DesktopAction::UiaSetValue { value, .. } if looks_sensitive_text(value) => Some(
            "Blade wants to fill a native UI field with something that looks sensitive or account-related, so approval is required.".to_string(),
        ),
        DesktopAction::UiaSetValueRemembered { value } if looks_sensitive_text(value) => Some(
            "Blade wants to fill the remembered native UI field with something that looks sensitive or account-related, so approval is required.".to_string(),
        ),
        DesktopAction::Type { text } if text.len() > 120 => Some(
            "Blade wants to type a long block of text, so approval is required.".to_string(),
        ),
        DesktopAction::UiaSetValue { value, .. } if value.len() > 240 => Some(
            "Blade wants to set a long native UI field value, so approval is required.".to_string(),
        ),
        DesktopAction::UiaSetValueRemembered { value } if value.len() > 240 => Some(
            "Blade wants to set a long remembered native UI field value, so approval is required.".to_string(),
        ),
        DesktopAction::BrowserType { text, .. } if looks_sensitive_text(text) => Some(
            "Blade wants to fill a browser field with something that looks sensitive or account-related, so approval is required.".to_string(),
        ),
        DesktopAction::BrowserTypeRemembered { text } if looks_sensitive_text(text) => Some(
            "Blade wants to fill the remembered browser field with something that looks sensitive or account-related, so approval is required.".to_string(),
        ),
        DesktopAction::BrowserType { text, .. } if text.len() > 240 => Some(
            "Blade wants to type a long browser field value, so approval is required.".to_string(),
        ),
        DesktopAction::BrowserTypeRemembered { text } if text.len() > 240 => Some(
            "Blade wants to type a long remembered browser field value, so approval is required.".to_string(),
        ),
        DesktopAction::PressKey { key } if is_risky_key(key) => Some(
            format!("Blade wants to press `{}`, which can dismiss, submit, or close UI unexpectedly, so approval is required.", key),
        ),
        DesktopAction::KeyCombo { modifiers, key } if is_risky_key_combo(modifiers, key) => Some(
            format!(
                "Blade wants to press the key combo {}+{}, which can trigger a destructive or system-level shortcut, so approval is required.",
                modifiers.join("+"),
                key
            ),
        ),
        DesktopAction::OpenUrl { url } if !looks_safe_url(url) => Some(
            "Blade wants to open a non-http URL or a suspicious target, so approval is required.".to_string(),
        ),
        DesktopAction::BrowserNavigate { url } if !looks_safe_url(url) => Some(
            "Blade wants to navigate the browser to a non-http URL or suspicious target, so approval is required.".to_string(),
        ),
        DesktopAction::OpenPath { path } if looks_sensitive_path(path) => Some(
            "Blade wants to open a system or shell-related path, so approval is required.".to_string(),
        ),
        DesktopAction::SearchWeb { query } if looks_sensitive_text(query) => Some(
            "Blade wants to search the web for something that looks account-related or sensitive, so approval is required.".to_string(),
        ),
        DesktopAction::LaunchApp { command, .. } if looks_sensitive_command(command) => Some(
            format!(
                "Blade wants to launch `{}`, which looks like a shell or system-level command, so approval is required.",
                command
            ),
        ),
        DesktopAction::CopyToClipboard { text } if looks_sensitive_text(text) => Some(
            "Blade wants to copy something that looks sensitive or account-related to the clipboard, so approval is required.".to_string(),
        ),
        _ => None,
    }
}

fn looks_sensitive_text(text: &str) -> bool {
    let normalized = text.to_ascii_lowercase();
    [
        "password",
        "passcode",
        "api key",
        "token",
        "secret",
        "@gmail.com",
        "@outlook.com",
        "@yahoo.com",
        "login",
        "sign in",
        "youtube.com",
        "publish",
    ]
    .iter()
    .any(|needle| normalized.contains(needle))
}

fn is_risky_key(key: &str) -> bool {
    matches!(
        key.to_ascii_lowercase().as_str(),
        "enter" | "delete" | "backspace" | "escape" | "tab"
    )
}

fn is_risky_key_combo(modifiers: &[String], key: &str) -> bool {
    let normalized_modifiers = modifiers
        .iter()
        .map(|modifier| modifier.to_ascii_lowercase())
        .collect::<Vec<_>>();
    let normalized_key = key.to_ascii_lowercase();

    (normalized_modifiers
        .iter()
        .any(|modifier| modifier == "alt")
        && normalized_key == "f4")
        || (normalized_modifiers
            .iter()
            .any(|modifier| modifier == "ctrl")
            && matches!(normalized_key.as_str(), "w" | "q" | "l" | "enter"))
        || (normalized_modifiers
            .iter()
            .any(|modifier| modifier == "meta" || modifier == "super")
            && matches!(normalized_key.as_str(), "q" | "w"))
}

fn looks_safe_url(url: &str) -> bool {
    let normalized = url.to_ascii_lowercase();
    normalized.starts_with("https://") || normalized.starts_with("http://")
}

fn looks_sensitive_command(command: &str) -> bool {
    matches!(
        command.to_ascii_lowercase().as_str(),
        "cmd" | "powershell" | "pwsh" | "bash" | "sh" | "zsh" | "regedit" | "taskkill"
    )
}

fn looks_sensitive_path(path: &str) -> bool {
    let normalized = path.to_ascii_lowercase();
    normalized.contains("system32")
        || normalized.contains("powershell")
        || normalized.contains("cmd.exe")
        || normalized.contains("/bin/")
        || normalized.contains("/etc/")
}

fn truncate(s: &str, max: usize) -> String {
    if s.len() > max {
        let end = s.char_indices().nth(max).map(|(i, _)| i).unwrap_or(s.len());
        format!("{}...", &s[..end])
    } else {
        s.to_string()
    }
}

#[tauri::command]
pub async fn agent_list(queue: tauri::State<'_, SharedAgentQueue>) -> Result<Vec<Agent>, String> {
    let q = queue.lock().await;
    Ok(q.list().into_iter().cloned().collect())
}

#[tauri::command]
pub async fn agent_get(
    queue: tauri::State<'_, SharedAgentQueue>,
    agent_id: String,
) -> Result<Agent, String> {
    let q = queue.lock().await;
    q.get(&agent_id)
        .cloned()
        .ok_or("Agent not found".to_string())
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
    {
        let mut q = queue.lock().await;
        q.resume(&agent_id);
    }

    let (is_desktop_agent, provider, api_key, model, base_url) = {
        let config = load_config();
        let q = queue.lock().await;
        let agent = q.get(&agent_id);
        let is_desktop_agent = agent
            .map(|agent| {
                agent
                    .context
                    .get("mode")
                    .map(|mode| mode == "desktop_control")
                    .unwrap_or(false)
            })
            .unwrap_or(false);
        let provider = agent
            .and_then(|agent| agent.context.get("provider").cloned())
            .unwrap_or_else(|| config.provider.clone());
        let model = agent
            .and_then(|agent| agent.context.get("model").cloned())
            .unwrap_or_else(|| config.model.clone());
        (is_desktop_agent, provider, config.api_key.clone(), model, config.base_url.clone())
    };

    let queue_clone = queue.inner().clone();
    let app_clone = app.clone();

    if is_desktop_agent {
        tokio::spawn(async move {
            run_desktop_agent_loop(
                &agent_id,
                &queue_clone,
                &app_clone,
                &provider,
                &api_key,
                &model,
                base_url,
            )
            .await;
        });
    } else {
        let mcp_clone = mcp.inner().clone();
        tokio::spawn(async move {
            run_agent_loop_internal(
                &agent_id,
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
    }

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

#[tauri::command]
pub async fn agent_respond_desktop_action(
    app: tauri::AppHandle,
    queue: tauri::State<'_, SharedAgentQueue>,
    agent_id: String,
    approved: bool,
) -> Result<(), String> {
    use tauri::Emitter;

    let (step_id, pending_json, provider, api_key, model, base_url) = {
        let config = load_config();
        let mut q = queue.lock().await;
        let agent = q.get_mut(&agent_id).ok_or("Agent not found".to_string())?;

        if agent.context.get("mode").map(String::as_str) != Some("desktop_control") {
            return Err("Agent is not a desktop control agent".to_string());
        }

        if agent.status != AgentStatus::WaitingApproval {
            return Err("Agent is not waiting for desktop action approval".to_string());
        }

        let step = agent
            .steps
            .get(agent.current_step)
            .ok_or("Desktop agent step not found".to_string())?;

        let pending_json = agent
            .context
            .remove(PENDING_DESKTOP_ACTION_KEY)
            .ok_or("No pending desktop action found".to_string())?;

        let provider = agent
            .context
            .get("provider")
            .cloned()
            .unwrap_or_else(|| config.provider.clone());
        let model = agent
            .context
            .get("model")
            .cloned()
            .unwrap_or_else(|| config.model.clone());

        (
            step.id.clone(),
            pending_json,
            provider,
            config.api_key.clone(),
            model,
            config.base_url.clone(),
        )
    };

    let decision: DesktopDecision = serde_json::from_str(&pending_json)
        .map_err(|err| format!("Failed to decode pending desktop action: {}", err))?;

    if !approved {
        let mut q = queue.lock().await;
        let agent = q.get_mut(&agent_id).ok_or("Agent not found".to_string())?;
        let idx = agent.current_step;
        if let Some(step) = agent.steps.get_mut(idx) {
            step.status = agents::StepStatus::Failed;
            step.result = Some(format!(
                "Desktop action denied by user. {}",
                decision.summary
            ));
            step.completed_at = Some(chrono::Utc::now().timestamp_millis());
        }
        let error = "Desktop action denied by user".to_string();
        agent.fail(error.clone());

        let _ = app.emit(
            "agent_step_failed",
            serde_json::json!({
                "agent_id": &agent_id,
                "step_id": &step_id,
                "error": &error,
            }),
        );
        let _ = app.emit(
            "agent_completed",
            serde_json::json!({
                "agent_id": &agent_id,
                "status": format!("{:?}", AgentStatus::Failed),
            }),
        );

        return Ok(());
    }

    let outcome = perform_desktop_action(&queue, &agent_id, decision).await?;

    {
        let mut q = queue.lock().await;
        let agent = q.get_mut(&agent_id).ok_or("Agent not found".to_string())?;
        let idx = agent.current_step;
        let step = agent
            .steps
            .get_mut(idx)
            .ok_or("Desktop agent step not found".to_string())?;

        step.completed_at = Some(chrono::Utc::now().timestamp_millis());

        match outcome {
            DesktopIterationResult::Continue(summary) => {
                step.status = agents::StepStatus::Completed;
                step.result = Some(summary.clone());
                record_desktop_history(agent, &summary);
                let _ = app.emit(
                    "agent_step_completed",
                    serde_json::json!({
                        "agent_id": &agent_id,
                        "step_id": &step_id,
                        "result": truncate(&summary, 500),
                    }),
                );
                agent.status = AgentStatus::Executing;
                agent.advance();
            }
            DesktopIterationResult::Done(summary) => {
                step.status = agents::StepStatus::Completed;
                step.result = Some(summary.clone());
                record_desktop_history(agent, &summary);
                let _ = app.emit(
                    "agent_step_completed",
                    serde_json::json!({
                        "agent_id": &agent_id,
                        "step_id": &step_id,
                        "result": truncate(&summary, 500),
                    }),
                );
                for later_step in agent.steps.iter_mut().skip(idx + 1) {
                    if later_step.status == agents::StepStatus::Pending {
                        later_step.status = agents::StepStatus::Skipped;
                        later_step.result = Some(
                            "Not needed after Blade marked the desktop task complete.".to_string(),
                        );
                    }
                }
                agent.current_step = agent.steps.len();
                agent.status = AgentStatus::Completed;
            }
            DesktopIterationResult::WaitingApproval { .. } => {
                return Err("Pending desktop action required approval twice".to_string());
            }
        }
    }

    let queue_clone = queue.inner().clone();
    let app_clone = app.clone();
    tokio::spawn(async move {
        run_desktop_agent_loop(
            &agent_id,
            &queue_clone,
            &app_clone,
            &provider,
            &api_key,
            &model,
            base_url,
        )
        .await;
    });

    Ok(())
}
