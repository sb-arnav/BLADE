use serde::Deserialize;
use std::path::PathBuf;
use tauri::Emitter;
use tokio::io::{AsyncBufReadExt, BufReader};

#[derive(Debug, Deserialize)]
struct RunnerEnvelope {
    #[serde(rename = "type")]
    event_type: String,
    payload: serde_json::Value,
}

fn runner_script_path() -> Result<PathBuf, String> {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let repo_root = manifest_dir
        .parent()
        .ok_or("Blade could not resolve the repository root for managed agents.".to_string())?;
    Ok(repo_root
        .join("scripts")
        .join("claude_managed_agent_runner.mjs"))
}

#[tauri::command]
pub async fn run_managed_agent(
    app: tauri::AppHandle,
    run_id: String,
    prompt: String,
    tools: Vec<String>,
    mcp_servers: Option<String>,
    permission_mode: String,
    max_turns: u32,
    session_id: Option<String>,
    working_directory: Option<String>,
    subagents: Option<String>,
) -> Result<String, String> {
    let script_path = runner_script_path()?;
    if !script_path.exists() {
        return Err(format!(
            "Blade could not find the Claude managed agent runner at `{}`.",
            script_path.display()
        ));
    }

    let payload = serde_json::json!({
        "runId": run_id,
        "prompt": prompt,
        "tools": tools,
        "mcpServers": mcp_servers,
        "permissionMode": permission_mode,
        "maxTurns": max_turns,
        "sessionId": session_id,
        "workingDirectory": working_directory,
        "subagents": subagents,
    });
    let payload_b64 = {
        use base64::engine::general_purpose::STANDARD;
        use base64::Engine;
        STANDARD.encode(
            serde_json::to_vec(&payload)
                .map_err(|error| format!("Failed to encode managed agent payload: {}", error))?,
        )
    };

    let cwd = payload
        .get("workingDirectory")
        .and_then(|value| value.as_str())
        .filter(|value| !value.trim().is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            script_path
                .parent()
                .and_then(|path| path.parent())
                .map(PathBuf::from)
                .unwrap_or_else(|| PathBuf::from("."))
        });

    let mut child = crate::cmd_util::silent_tokio_cmd("node")
        .arg(&script_path)
        .arg(payload_b64)
        .current_dir(cwd)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|error| format!("Failed to launch Claude managed agent runner: {}", error))?;

    let stdout = child
        .stdout
        .take()
        .ok_or("Managed agent runner stdout was unavailable.".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or("Managed agent runner stderr was unavailable.".to_string())?;

    let app_stdout = app.clone();
    let run_id_stdout = run_id.clone();
    tokio::spawn(async move {
        let mut lines = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let envelope = match serde_json::from_str::<RunnerEnvelope>(&line) {
                Ok(value) => value,
                Err(_) => {
                    let _ = app_stdout.emit_to("main", "agent_message",
                        serde_json::json!({
                            "id": format!("{}-parse", run_id_stdout),
                            "type": "error",
                            "content": format!("Blade could not parse Claude agent output: {}", line),
                            "timestamp": chrono::Utc::now().timestamp_millis(),
                            "metadata": { "runId": run_id_stdout, "subtype": "parse_error" }
                        }),
                    );
                    continue;
                }
            };

            match envelope.event_type.as_str() {
                "message" => {
                    let mut payload = envelope.payload;
                    if let Some(object) = payload.as_object_mut() {
                        object.insert("runId".to_string(), serde_json::json!(run_id_stdout));
                    }
                    let _ = app_stdout.emit_to("main", "agent_message", payload);
                }
                "done" => {
                    let mut payload = envelope.payload;
                    if let Some(object) = payload.as_object_mut() {
                        object.insert("runId".to_string(), serde_json::json!(run_id_stdout));
                    }
                    let _ = app_stdout.emit_to("main", "agent_done", payload);
                }
                "error" => {
                    let message = envelope
                        .payload
                        .get("message")
                        .and_then(|value| value.as_str())
                        .unwrap_or("Claude managed agent runner failed.");
                    let _ = app_stdout.emit_to("main", "agent_message",
                        serde_json::json!({
                            "id": format!("{}-error", run_id_stdout),
                            "type": "error",
                            "content": message,
                            "timestamp": chrono::Utc::now().timestamp_millis(),
                            "metadata": { "runId": run_id_stdout, "subtype": "runner_error" }
                        }),
                    );
                }
                _ => {}
            }
        }
    });

    let app_stderr = app.clone();
    let run_id_stderr = run_id.clone();
    tokio::spawn(async move {
        let mut lines = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            if line.trim().is_empty() {
                continue;
            }
            let _ = app_stderr.emit_to("main", "agent_message",
                serde_json::json!({
                    "id": format!("{}-stderr", run_id_stderr),
                    "type": "system",
                    "content": line,
                    "timestamp": chrono::Utc::now().timestamp_millis(),
                    "metadata": { "runId": run_id_stderr, "subtype": "stderr" }
                }),
            );
        }
    });

    let app_exit = app.clone();
    let run_id_exit = run_id.clone();
    tokio::spawn(async move {
        match child.wait().await {
            Ok(status) if status.success() => {}
            Ok(status) => {
                let _ = app_exit.emit_to("main", "agent_done",
                    serde_json::json!({
                        "runId": run_id_exit,
                        "sessionId": serde_json::Value::Null,
                        "costUsd": 0.0,
                        "isError": true,
                        "exitCode": status.code(),
                    }),
                );
            }
            Err(error) => {
                let _ = app_exit.emit_to("main", "agent_message",
                    serde_json::json!({
                        "id": format!("{}-wait-error", run_id_exit),
                        "type": "error",
                        "content": format!("Blade lost the Claude managed agent process: {}", error),
                        "timestamp": chrono::Utc::now().timestamp_millis(),
                        "metadata": { "runId": run_id_exit, "subtype": "process_wait_error" }
                    }),
                );
                let _ = app_exit.emit_to("main", "agent_done",
                    serde_json::json!({
                        "runId": run_id_exit,
                        "sessionId": serde_json::Value::Null,
                        "costUsd": 0.0,
                        "isError": true,
                    }),
                );
            }
        }
    });

    Ok("started".to_string())
}
