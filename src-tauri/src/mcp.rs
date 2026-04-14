use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io;
use std::sync::atomic::{AtomicU64, Ordering};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::process::Child;
use tokio::time::{timeout, Duration};

static REQUEST_ID: AtomicU64 = AtomicU64::new(1);
const MCP_INIT_TIMEOUT: Duration = Duration::from_secs(10);
const MCP_DISCOVERY_TIMEOUT: Duration = Duration::from_secs(15);
const MCP_TOOL_CALL_TIMEOUT: Duration = Duration::from_secs(30);

// --- JSON-RPC Types ---

#[derive(Serialize)]
struct JsonRpcRequest<T: Serialize> {
    jsonrpc: &'static str,
    id: u64,
    method: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    params: Option<T>,
}

#[derive(Deserialize, Debug)]
struct JsonRpcResponse {
    #[allow(dead_code)]
    jsonrpc: String,
    #[allow(dead_code)]
    id: Option<serde_json::Value>,
    result: Option<serde_json::Value>,
    error: Option<JsonRpcError>,
}

#[derive(Deserialize, Debug)]
struct JsonRpcError {
    #[allow(dead_code)]
    code: i64,
    message: String,
}

// --- MCP Types ---

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpTool {
    pub name: String,
    pub qualified_name: String,
    pub description: String,
    pub input_schema: serde_json::Value,
    pub server_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpToolResult {
    pub content: Vec<McpContent>,
    pub is_error: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpContent {
    #[serde(rename = "type")]
    pub content_type: String,
    pub text: Option<String>,
}

// --- MCP Server Process ---

struct McpProcess {
    child: Child,
    stdin: tokio::process::ChildStdin,
    reader: BufReader<tokio::process::ChildStdout>,
}

impl McpProcess {
    async fn spawn(
        command: &str,
        args: &[String],
        env: &HashMap<String, String>,
    ) -> io::Result<Self> {
        let mut cmd = crate::cmd_util::silent_tokio_cmd(command);
        cmd.args(args)
            .envs(env)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null());

        let mut child = cmd.spawn()?;
        let stdin = child.stdin.take().ok_or(io::Error::new(
            io::ErrorKind::Other,
            "Failed to capture stdin",
        ))?;
        let stdout = child.stdout.take().ok_or(io::Error::new(
            io::ErrorKind::Other,
            "Failed to capture stdout",
        ))?;

        Ok(Self {
            child,
            stdin,
            reader: BufReader::new(stdout),
        })
    }

    async fn send_request<T: Serialize>(
        &mut self,
        method: &str,
        params: Option<T>,
    ) -> Result<serde_json::Value, String> {
        let id = REQUEST_ID.fetch_add(1, Ordering::SeqCst);

        let request = JsonRpcRequest {
            jsonrpc: "2.0",
            id,
            method: method.to_string(),
            params,
        };

        let payload = serde_json::to_vec(&request).map_err(|e| e.to_string())?;

        // Write with Content-Length framing
        let header = format!("Content-Length: {}\r\n\r\n", payload.len());
        self.stdin
            .write_all(header.as_bytes())
            .await
            .map_err(|e| format!("Write header failed: {}", e))?;
        self.stdin
            .write_all(&payload)
            .await
            .map_err(|e| format!("Write payload failed: {}", e))?;
        self.stdin
            .flush()
            .await
            .map_err(|e| format!("Flush failed: {}", e))?;

        // Read response with Content-Length framing
        let mut content_length: usize = 0;
        let mut header_line = String::new();

        loop {
            header_line.clear();
            self.reader
                .read_line(&mut header_line)
                .await
                .map_err(|e| format!("Read header failed: {}", e))?;

            let trimmed = header_line.trim();
            if trimmed.is_empty() {
                break; // End of headers
            }
            if let Some(len_str) = trimmed.strip_prefix("Content-Length: ") {
                content_length = len_str
                    .parse()
                    .map_err(|e| format!("Invalid Content-Length: {}", e))?;
            }
        }

        if content_length == 0 {
            return Err("No Content-Length in response".to_string());
        }

        let mut body = vec![0u8; content_length];
        self.reader
            .read_exact(&mut body)
            .await
            .map_err(|e| format!("Read body failed: {}", e))?;

        let response: JsonRpcResponse =
            serde_json::from_slice(&body).map_err(|e| format!("Parse response failed: {}", e))?;

        if let Some(err) = response.error {
            return Err(format!("MCP error: {}", err.message));
        }

        response.result.ok_or("Empty result".to_string())
    }

    async fn kill(&mut self) {
        let _ = self.child.kill().await;
    }
}

// --- MCP Server Manager ---

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpServerConfig {
    pub command: String,
    pub args: Vec<String>,
    #[serde(default)]
    pub env: HashMap<String, String>,
}

pub struct McpManager {
    servers: HashMap<String, McpServerConfig>,
    processes: HashMap<String, McpProcess>,
    tools: Vec<McpTool>,
}

impl Default for McpManager {
    fn default() -> Self {
        Self::new()
    }
}

impl McpManager {
    pub fn new() -> Self {
        Self {
            servers: HashMap::new(),
            processes: HashMap::new(),
            tools: Vec::new(),
        }
    }

    pub fn register_server(&mut self, name: String, config: McpServerConfig) {
        self.servers.insert(name, config);
    }

    pub async fn remove_server(&mut self, name: &str) {
        self.servers.remove(name);
        self.tools.retain(|tool| tool.server_name != name);
        if let Some(mut process) = self.processes.remove(name) {
            process.kill().await;
        }
    }

    pub fn get_tools(&self) -> &[McpTool] {
        &self.tools
    }

    /// Format tools as JSON schema for AI providers
    #[allow(dead_code)]
    pub fn tools_as_json(&self) -> Vec<serde_json::Value> {
        self.tools
            .iter()
            .map(|t| {
                serde_json::json!({
                    "name": &t.qualified_name,
                    "description": &t.description,
                    "parameters": &t.input_schema,
                })
            })
            .collect()
    }

    /// Check if a server process is still alive, remove it if dead
    async fn check_health(&mut self, server_name: &str) {
        if let Some(process) = self.processes.get_mut(server_name) {
            if let Ok(Some(_)) = process.child.try_wait() {
                // Process exited — remove it so ensure_running will respawn
                self.processes.remove(server_name);
            }
        }
    }

    /// Get server status for UI
    pub fn server_status(&self) -> Vec<(String, bool)> {
        self.servers
            .keys()
            .map(|name| {
                let running = self.processes.contains_key(name);
                (name.clone(), running)
            })
            .collect()
    }

    async fn ensure_running(&mut self, server_name: &str) -> Result<(), String> {
        // Check if existing process died
        self.check_health(server_name).await;

        if self.processes.contains_key(server_name) {
            return Ok(());
        }

        let config = self
            .servers
            .get(server_name)
            .ok_or(format!("Unknown server: {}", server_name))?
            .clone();

        let mut process = McpProcess::spawn(&config.command, &config.args, &config.env)
            .await
            .map_err(|e| format!("Failed to spawn {}: {}", server_name, e))?;

        // Initialize
        let init_params = serde_json::json!({
            "protocolVersion": "2024-11-05",
            "capabilities": {},
            "clientInfo": {
                "name": "blade",
                "version": "0.1.0"
            }
        });

        let _result = timeout(
            MCP_INIT_TIMEOUT,
            process.send_request("initialize", Some(init_params)),
        )
        .await
        .map_err(|_| format!("Timed out initializing MCP server: {}", server_name))??;

        // Send initialized notification (no response expected for notifications)
        let notif = serde_json::json!({
            "jsonrpc": "2.0",
            "method": "notifications/initialized"
        });
        let payload = serde_json::to_vec(&notif).map_err(|e| e.to_string())?;
        let header = format!("Content-Length: {}\r\n\r\n", payload.len());
        process
            .stdin
            .write_all(header.as_bytes())
            .await
            .map_err(|e| e.to_string())?;
        process
            .stdin
            .write_all(&payload)
            .await
            .map_err(|e| e.to_string())?;
        process.stdin.flush().await.map_err(|e| e.to_string())?;

        self.processes.insert(server_name.to_string(), process);
        Ok(())
    }

    /// Discover all tools from all registered servers
    pub async fn discover_all_tools(&mut self) -> Result<Vec<McpTool>, String> {
        let server_names: Vec<String> = self.servers.keys().cloned().collect();
        let mut all_tools = Vec::new();

        for name in server_names {
            self.ensure_running(&name).await?;

            let process = self.processes.get_mut(&name).unwrap();
            let mut cursor: Option<String> = None;

            loop {
                let params = match &cursor {
                    Some(c) => Some(serde_json::json!({"cursor": c})),
                    None => Some(serde_json::json!({})),
                };

                let result = timeout(
                    MCP_DISCOVERY_TIMEOUT,
                    process.send_request("tools/list", params),
                )
                .await
                .map_err(|_| format!("Timed out discovering tools for MCP server: {}", name))??;

                if let Some(tools) = result["tools"].as_array() {
                    for tool in tools {
                        let raw_name = tool["name"].as_str().unwrap_or("unknown");
                        let description = tool["description"].as_str().unwrap_or("");
                        let schema = tool
                            .get("inputSchema")
                            .cloned()
                            .unwrap_or(serde_json::json!({}));

                        all_tools.push(McpTool {
                            name: raw_name.to_string(),
                            qualified_name: format!("mcp__{}_{}", name, raw_name),
                            description: description.to_string(),
                            input_schema: schema,
                            server_name: name.clone(),
                        });
                    }
                }

                cursor = result["nextCursor"].as_str().map(|s| s.to_string());
                if cursor.is_none() {
                    break;
                }
            }
        }

        // Preserve built-in in-process tools (those not backed by a child process)
        let built_in: Vec<McpTool> = self
            .tools
            .iter()
            .filter(|t| t.server_name == crate::mcp_memory_server::SERVER_NAME)
            .cloned()
            .collect();
        all_tools.extend(built_in);

        self.tools = all_tools.clone();
        Ok(all_tools)
    }

    /// Register the built-in in-process servers (e.g. blade.memory).
    /// Call once at startup after McpManager is created.
    pub fn register_built_in_servers(&mut self) {
        let memory_tools = crate::mcp_memory_server::register_built_in_tools();
        self.tools.extend(memory_tools);
    }

    /// Call a tool by its qualified name
    pub async fn call_tool(
        &mut self,
        qualified_name: &str,
        arguments: serde_json::Value,
    ) -> Result<McpToolResult, String> {
        // Find which server owns this tool
        let tool = self
            .tools
            .iter()
            .find(|t| t.qualified_name == qualified_name)
            .ok_or(format!("Unknown tool: {}", qualified_name))?
            .clone();

        // Dispatch to built-in in-process servers
        if tool.server_name == crate::mcp_memory_server::SERVER_NAME {
            return crate::mcp_memory_server::handle_tool_call(&tool.name, arguments).await;
        }

        self.ensure_running(&tool.server_name).await?;

        let process = self.processes.get_mut(&tool.server_name).unwrap();

        let params = serde_json::json!({
            "name": tool.name,
            "arguments": arguments,
        });

        let result = timeout(
            MCP_TOOL_CALL_TIMEOUT,
            process.send_request("tools/call", Some(params)),
        )
        .await
        .map_err(|_| format!("Timed out calling MCP tool: {}", qualified_name))??;

        let is_error = result["isError"].as_bool().unwrap_or(false);
        let content = if let Some(arr) = result["content"].as_array() {
            arr.iter()
                .map(|c| McpContent {
                    content_type: c["type"].as_str().unwrap_or("text").to_string(),
                    text: c["text"].as_str().map(|s| s.to_string()),
                })
                .collect()
        } else {
            vec![McpContent {
                content_type: "text".to_string(),
                text: Some(result.to_string()),
            }]
        };

        Ok(McpToolResult { content, is_error })
    }

    /// Shutdown all servers
    #[allow(dead_code)]
    pub async fn shutdown(&mut self) {
        for (_, mut process) in self.processes.drain() {
            process.kill().await;
        }
    }
}
