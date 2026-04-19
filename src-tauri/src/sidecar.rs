// sidecar.rs — Cross-device coordination for BLADE
//
// Main BLADE acts as a hub: it registers sidecar devices (work laptop, home desktop,
// server) and dispatches commands to them over HTTP.  Each sidecar is a lightweight
// HTTP server that runs bash commands and reports its system state back to the hub.
//
// Wire-protocol is intentionally dead-simple:
//   GET  /ping  → SidecarPing  (auth via Bearer token)
//   POST /run   → SidecarRequest → SidecarResponse
//
// No WebSockets, no TLS (keep it on your LAN), no external HTTP framework.

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::Emitter;

// ---------------------------------------------------------------------------
// Public data types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SidecarDevice {
    pub id: String,
    pub name: String,
    pub address: String,  // e.g. "http://192.168.1.5:7878"
    pub secret: String,
    pub status: String,   // "online" | "offline" | "unknown"
    pub last_seen: Option<i64>,
    pub capabilities: Vec<String>,
    pub os: String,
    pub hostname: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[allow(dead_code)]
pub struct SidecarTask {
    pub id: String,
    pub device_id: String,
    pub command: String,
    pub status: String,   // "pending" | "running" | "done" | "error"
    pub result: String,
    pub error: String,
    pub created_at: i64,
    pub completed_at: Option<i64>,
}

/// Sent from hub → sidecar
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SidecarRequest {
    pub task_id: String,
    pub command: String,
    pub secret: String,
}

/// Returned by sidecar → hub
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SidecarResponse {
    pub task_id: String,
    pub result: String,
    pub error: String,
    pub exit_code: i32,
}

/// Returned by GET /ping
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SidecarPing {
    pub hostname: String,
    pub os: String,
    pub capabilities: Vec<String>,
    pub version: String,
}

// ---------------------------------------------------------------------------
// Database helpers
// ---------------------------------------------------------------------------

fn db_path() -> std::path::PathBuf {
    crate::config::blade_config_dir().join("blade.db")
}

fn open_db() -> Result<Connection, String> {
    let conn = Connection::open(db_path()).map_err(|e| e.to_string())?;
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS sidecar_devices (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            address TEXT NOT NULL,
            secret TEXT NOT NULL,
            status TEXT DEFAULT 'unknown',
            last_seen INTEGER,
            capabilities TEXT DEFAULT '[]',
            os TEXT DEFAULT '',
            hostname TEXT DEFAULT ''
        );
        CREATE TABLE IF NOT EXISTS sidecar_tasks (
            id TEXT PRIMARY KEY,
            device_id TEXT NOT NULL,
            command TEXT NOT NULL,
            status TEXT DEFAULT 'pending',
            result TEXT DEFAULT '',
            error TEXT DEFAULT '',
            created_at INTEGER NOT NULL,
            completed_at INTEGER
        );"
    ).map_err(|e| e.to_string())?;
    Ok(conn)
}

fn row_to_device(row: &rusqlite::Row) -> rusqlite::Result<SidecarDevice> {
    let caps_json: String = row.get(6)?;
    let capabilities: Vec<String> = serde_json::from_str(&caps_json).unwrap_or_default();
    Ok(SidecarDevice {
        id: row.get(0)?,
        name: row.get(1)?,
        address: row.get(2)?,
        secret: row.get(3)?,
        status: row.get(4)?,
        last_seen: row.get(5)?,
        capabilities,
        os: row.get(7)?,
        hostname: row.get(8)?,
    })
}

// ---------------------------------------------------------------------------
// Core logic — synchronous (DB)
// ---------------------------------------------------------------------------

/// Register a new sidecar device.  Returns the generated device ID.
pub fn register_device(name: &str, address: &str, secret: &str) -> Result<String, String> {
    let conn = open_db()?;
    let id = uuid::Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO sidecar_devices (id, name, address, secret) VALUES (?1, ?2, ?3, ?4)",
        params![id, name, address, secret],
    ).map_err(|e| e.to_string())?;
    Ok(id)
}

/// Load all registered devices.
pub fn list_devices() -> Vec<SidecarDevice> {
    let conn = match open_db() {
        Ok(c) => c,
        Err(_) => return vec![],
    };
    let mut stmt = match conn.prepare(
        "SELECT id, name, address, secret, status, last_seen, capabilities, os, hostname
         FROM sidecar_devices ORDER BY name"
    ) {
        Ok(s) => s,
        Err(_) => return vec![],
    };
    stmt.query_map([], row_to_device)
        .map(|rows| rows.filter_map(|r| r.ok()).collect())
        .unwrap_or_default()
}

/// Remove a device and its tasks from the DB.
pub fn remove_device(id: &str) -> Result<(), String> {
    let conn = open_db()?;
    conn.execute("DELETE FROM sidecar_tasks WHERE device_id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM sidecar_devices WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn get_device(conn: &Connection, device_id: &str) -> Result<SidecarDevice, String> {
    let mut stmt = conn.prepare(
        "SELECT id, name, address, secret, status, last_seen, capabilities, os, hostname
         FROM sidecar_devices WHERE id = ?1"
    ).map_err(|e| e.to_string())?;
    stmt.query_row(params![device_id], row_to_device)
        .map_err(|_| format!("device '{}' not found", device_id))
}

fn update_device_status(conn: &Connection, device_id: &str, status: &str, ping: Option<&SidecarPing>) {
    let now = chrono::Utc::now().timestamp();
    if let Some(p) = ping {
        let caps = serde_json::to_string(&p.capabilities).unwrap_or_else(|_| "[]".into());
        let _ = conn.execute(
            "UPDATE sidecar_devices
             SET status = ?1, last_seen = ?2, os = ?3, hostname = ?4, capabilities = ?5
             WHERE id = ?6",
            params![status, now, p.os, p.hostname, caps, device_id],
        );
    } else {
        let _ = conn.execute(
            "UPDATE sidecar_devices SET status = ?1 WHERE id = ?2",
            params![status, device_id],
        );
    }
}

fn create_task(conn: &Connection, device_id: &str, command: &str) -> Result<String, String> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().timestamp();
    conn.execute(
        "INSERT INTO sidecar_tasks (id, device_id, command, status, created_at)
         VALUES (?1, ?2, ?3, 'pending', ?4)",
        params![id, device_id, command, now],
    ).map_err(|e| e.to_string())?;
    Ok(id)
}

fn finish_task(conn: &Connection, task_id: &str, result: &str, error: &str, status: &str) {
    let now = chrono::Utc::now().timestamp();
    let _ = conn.execute(
        "UPDATE sidecar_tasks
         SET status = ?1, result = ?2, error = ?3, completed_at = ?4
         WHERE id = ?5",
        params![status, result, error, now, task_id],
    );
}

// ---------------------------------------------------------------------------
// Core logic — async (HTTP)
// ---------------------------------------------------------------------------

/// Ping a device — update its status and return the SidecarPing.
pub async fn ping_device(device_id: &str) -> Result<SidecarPing, String> {
    let conn = open_db()?;
    let device = get_device(&conn, device_id)?;

    let url = format!("{}/ping", device.address.trim_end_matches('/'));
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client
        .get(&url)
        .header("Authorization", format!("Bearer {}", device.secret))
        .send()
        .await
        .map_err(|e| {
            update_device_status(&conn, device_id, "offline", None);
            format!("ping failed: {}", e)
        })?;

    if !resp.status().is_success() {
        update_device_status(&conn, device_id, "offline", None);
        return Err(format!("ping returned HTTP {}", resp.status()));
    }

    let ping: SidecarPing = resp.json().await.map_err(|e| e.to_string())?;
    update_device_status(&conn, device_id, "online", Some(&ping));
    Ok(ping)
}

/// Send a command to a single device and wait for the result.
pub async fn run_on_device(device_id: &str, command: &str) -> Result<String, String> {
    let conn = open_db()?;
    let device = get_device(&conn, device_id)?;
    let task_id = create_task(&conn, device_id, command)?;

    let url = format!("{}/run", device.address.trim_end_matches('/'));
    let payload = SidecarRequest {
        task_id: task_id.clone(),
        command: command.to_string(),
        secret: device.secret.clone(),
    };

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", device.secret))
        .json(&payload)
        .send()
        .await
        .map_err(|e| {
            update_device_status(&conn, device_id, "offline", None);
            finish_task(&conn, &task_id, "", &e.to_string(), "error");
            format!("request failed: {}", e)
        })?;

    if !resp.status().is_success() {
        let msg = format!("sidecar returned HTTP {}", resp.status());
        finish_task(&conn, &task_id, "", &msg, "error");
        return Err(msg);
    }

    let sidecar_resp: SidecarResponse = resp.json().await.map_err(|e| e.to_string())?;

    if !sidecar_resp.error.is_empty() {
        finish_task(&conn, &task_id, &sidecar_resp.result, &sidecar_resp.error, "error");
        return Err(sidecar_resp.error);
    }

    finish_task(&conn, &task_id, &sidecar_resp.result, "", "done");
    Ok(sidecar_resp.result)
}

/// Broadcast a command to all currently-online devices in parallel.
/// Returns `(device_name, Ok(output) | Err(message))` for each.
pub async fn run_on_all_devices(command: &str) -> Vec<(String, Result<String, String>)> {
    let devices: Vec<SidecarDevice> = list_devices()
        .into_iter()
        .filter(|d| d.status == "online")
        .collect();

    let mut handles = vec![];
    for device in devices {
        let cmd = command.to_string();
        let id = device.id.clone();
        let name = device.name.clone();
        handles.push(tokio::spawn(async move {
            let result = run_on_device(&id, &cmd).await;
            (name, result)
        }));
    }

    let mut results = vec![];
    for handle in handles {
        match handle.await {
            Ok(pair) => results.push(pair),
            Err(e) => results.push(("unknown".into(), Err(e.to_string()))),
        }
    }
    results
}

/// Ping every registered device, update their statuses, and emit a Tauri event.
pub async fn check_all_devices(app: &tauri::AppHandle) {
    let devices = list_devices();
    let mut statuses: Vec<serde_json::Value> = vec![];

    for device in devices {
        let id = device.id.clone();
        let name = device.name.clone();
        match ping_device(&id).await {
            Ok(ping) => {
                statuses.push(serde_json::json!({
                    "id": id,
                    "name": name,
                    "status": "online",
                    "os": ping.os,
                    "hostname": ping.hostname,
                    "capabilities": ping.capabilities,
                    "version": ping.version,
                }));
            }
            Err(err) => {
                statuses.push(serde_json::json!({
                    "id": id,
                    "name": name,
                    "status": "offline",
                    "error": err,
                }));
            }
        }
    }

    let _ = app.emit_to("main", "sidecar_status_update", &statuses);
}

// ---------------------------------------------------------------------------
// Background monitor (runs every 5 minutes)
// ---------------------------------------------------------------------------

static MONITOR_RUNNING: AtomicBool = AtomicBool::new(false);

pub fn start_sidecar_monitor(app: tauri::AppHandle) {
    if MONITOR_RUNNING.swap(true, Ordering::SeqCst) {
        return; // already running
    }
    tauri::async_runtime::spawn(async move {
        loop {
            check_all_devices(&app).await;
            tokio::time::sleep(tokio::time::Duration::from_secs(300)).await;
        }
    });
}

// ---------------------------------------------------------------------------
// Sidecar server — run this BLADE instance as a sidecar on another machine
// ---------------------------------------------------------------------------

static SERVER_RUNNING: AtomicBool = AtomicBool::new(false);

/// Start a minimal HTTP server that handles /ping and /run.
/// Runs in a background tokio task; returns immediately with the bound address.
pub async fn start_sidecar_server(port: u16, secret: String) -> Result<String, String> {
    if SERVER_RUNNING.swap(true, Ordering::SeqCst) {
        return Err("sidecar server is already running".into());
    }

    let addr = format!("0.0.0.0:{}", port);
    let listener = tokio::net::TcpListener::bind(&addr)
        .await
        .map_err(|e| {
            SERVER_RUNNING.store(false, Ordering::SeqCst);
            format!("bind failed: {}", e)
        })?;

    let bound = listener.local_addr().map(|a| a.to_string()).unwrap_or(addr);
    let secret = Arc::new(secret);

    tokio::spawn(async move {
        loop {
            match listener.accept().await {
                Ok((stream, _peer)) => {
                    let secret = secret.clone();
                    tokio::spawn(async move {
                        if let Err(e) = handle_connection(stream, &secret).await {
                            log::warn!("[sidecar] connection error: {}", e);
                        }
                    });
                }
                Err(e) => {
                    log::error!("[sidecar] accept error: {}", e);
                    break;
                }
            }
        }
        SERVER_RUNNING.store(false, Ordering::SeqCst);
    });

    Ok(format!("sidecar listening on {}", bound))
}

/// Handle a single TCP connection with hand-rolled HTTP/1.1 parsing.
async fn handle_connection(
    mut stream: tokio::net::TcpStream,
    secret: &str,
) -> Result<(), String> {
    use tokio::io::{AsyncBufReadExt, AsyncReadExt, BufReader};

    let (reader, mut writer) = stream.split();
    let mut buf_reader = BufReader::new(reader);

    // --- Read request line ---
    let mut request_line = String::new();
    buf_reader.read_line(&mut request_line).await.map_err(|e| e.to_string())?;
    let request_line = request_line.trim().to_string();

    // --- Read headers until blank line ---
    let mut content_length: usize = 0;
    let mut auth_header = String::new();
    loop {
        let mut line = String::new();
        buf_reader.read_line(&mut line).await.map_err(|e| e.to_string())?;
        let trimmed = line.trim();
        if trimmed.is_empty() {
            break;
        }
        let lower = trimmed.to_lowercase();
        if lower.starts_with("content-length:") {
            content_length = trimmed[15..].trim().parse().unwrap_or(0);
        }
        if lower.starts_with("authorization:") {
            auth_header = trimmed[14..].trim().to_string();
        }
    }

    // --- Auth check (constant-time == is fine for this use-case) ---
    let expected = format!("Bearer {}", secret);
    if auth_header != expected {
        write_response(&mut writer, 401, "Unauthorized", b"unauthorized").await?;
        return Ok(());
    }

    // --- Read body ---
    let mut body = vec![0u8; content_length];
    if content_length > 0 {
        buf_reader.read_exact(&mut body).await.map_err(|e| e.to_string())?;
    }

    // --- Route ---
    let parts: Vec<&str> = request_line.splitn(3, ' ').collect();
    if parts.len() < 2 {
        write_response(&mut writer, 400, "Bad Request", b"bad request line").await?;
        return Ok(());
    }
    let method = parts[0];
    let path = parts[1];

    match (method, path) {
        ("GET", "/ping") => {
            let pong = build_ping();
            let json = serde_json::to_vec(&pong).unwrap_or_default();
            write_json_response(&mut writer, 200, "OK", &json).await?;
        }
        ("POST", "/run") => {
            match serde_json::from_slice::<SidecarRequest>(&body) {
                Ok(req) => {
                    // Double-check secret inside the body too (belt and suspenders)
                    if req.secret != secret {
                        write_response(&mut writer, 401, "Unauthorized", b"bad secret").await?;
                        return Ok(());
                    }
                    let resp = execute_command(&req).await;
                    let json = serde_json::to_vec(&resp).unwrap_or_default();
                    write_json_response(&mut writer, 200, "OK", &json).await?;
                }
                Err(e) => {
                    let msg = format!("bad JSON: {}", e);
                    write_response(&mut writer, 400, "Bad Request", msg.as_bytes()).await?;
                }
            }
        }
        _ => {
            write_response(&mut writer, 404, "Not Found", b"not found").await?;
        }
    }

    Ok(())
}

async fn write_response(
    writer: &mut (impl tokio::io::AsyncWriteExt + Unpin),
    status: u16,
    reason: &str,
    body: &[u8],
) -> Result<(), String> {
    let response = format!(
        "HTTP/1.1 {} {}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        status, reason, body.len()
    );
    writer.write_all(response.as_bytes()).await.map_err(|e| e.to_string())?;
    writer.write_all(body).await.map_err(|e| e.to_string())?;
    Ok(())
}

async fn write_json_response(
    writer: &mut (impl tokio::io::AsyncWriteExt + Unpin),
    status: u16,
    reason: &str,
    body: &[u8],
) -> Result<(), String> {
    let response = format!(
        "HTTP/1.1 {} {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        status, reason, body.len()
    );
    writer.write_all(response.as_bytes()).await.map_err(|e| e.to_string())?;
    writer.write_all(body).await.map_err(|e| e.to_string())?;
    Ok(())
}

/// Build the ping payload that describes this machine.
fn build_ping() -> SidecarPing {
    // Retrieve hostname portably via `hostname` env var (set on Windows) or
    // reading /etc/hostname on Linux, falling back to "unknown".
    let hostname = std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .unwrap_or_else(|_| {
            std::fs::read_to_string("/etc/hostname")
                .map(|s| s.trim().to_string())
                .unwrap_or_else(|_| "unknown".into())
        });

    let os_name = std::env::consts::OS.to_string();

    // Detect capabilities based on what's available in PATH
    let mut capabilities = vec!["bash".into(), "shell".into()];
    for tool in &["git", "python3", "python", "node", "cargo", "docker"] {
        if which_exists(tool) {
            capabilities.push(tool.to_string());
        }
    }

    SidecarPing {
        hostname,
        os: os_name,
        capabilities,
        version: env!("CARGO_PKG_VERSION").to_string(),
    }
}

/// Check if a command exists in PATH without running it.
fn which_exists(cmd: &str) -> bool {
    std::env::var_os("PATH")
        .map(|paths| {
            std::env::split_paths(&paths).any(|dir| {
                let p = dir.join(cmd);
                p.exists()
                    || {
                        #[cfg(windows)]
                        { dir.join(format!("{}.exe", cmd)).exists() }
                        #[cfg(not(windows))]
                        { false }
                    }
            })
        })
        .unwrap_or(false)
}

/// Run the command in a subprocess and return a SidecarResponse.
async fn execute_command(req: &SidecarRequest) -> SidecarResponse {
    #[cfg(unix)]
    let output = crate::cmd_util::silent_cmd("bash")
        .arg("-c")
        .arg(&req.command)
        .output();

    #[cfg(windows)]
    let output = crate::cmd_util::silent_cmd("cmd")
        .args(["/C", &req.command])
        .output();

    match output {
        Ok(out) => {
            let stdout = String::from_utf8_lossy(&out.stdout).to_string();
            let stderr = String::from_utf8_lossy(&out.stderr).to_string();
            let exit_code = out.status.code().unwrap_or(-1);

            let (result, error) = if out.status.success() {
                (stdout, stderr)
            } else {
                (stdout, if stderr.is_empty() {
                    format!("exited with code {}", exit_code)
                } else {
                    stderr
                })
            };

            SidecarResponse {
                task_id: req.task_id.clone(),
                result,
                error,
                exit_code,
            }
        }
        Err(e) => SidecarResponse {
            task_id: req.task_id.clone(),
            result: String::new(),
            error: e.to_string(),
            exit_code: -1,
        },
    }
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn sidecar_list_devices() -> Vec<SidecarDevice> {
    list_devices()
}

#[tauri::command]
pub fn sidecar_register_device(
    name: String,
    address: String,
    secret: String,
) -> Result<String, String> {
    register_device(&name, &address, &secret)
}

#[tauri::command]
pub fn sidecar_remove_device(id: String) -> Result<(), String> {
    remove_device(&id)
}

#[tauri::command]
pub async fn sidecar_ping_device(id: String) -> Result<SidecarPing, String> {
    ping_device(&id).await
}

#[tauri::command]
pub async fn sidecar_run_command(
    device_id: String,
    command: String,
) -> Result<String, String> {
    run_on_device(&device_id, &command).await
}

/// Run command on all online devices.
/// Returns array of `{ device, result, error }` objects.
#[tauri::command]
pub async fn sidecar_run_all(command: String) -> Vec<serde_json::Value> {
    run_on_all_devices(&command)
        .await
        .into_iter()
        .map(|(name, outcome)| match outcome {
            Ok(output) => serde_json::json!({ "device": name, "result": output, "error": "" }),
            Err(err) => serde_json::json!({ "device": name, "result": "", "error": err }),
        })
        .collect()
}

/// Start this BLADE instance as a sidecar server on the given port.
#[tauri::command]
pub async fn sidecar_start_server(port: u16, secret: String) -> Result<String, String> {
    start_sidecar_server(port, secret).await
}
