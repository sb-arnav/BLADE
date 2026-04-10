use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::ffi::OsString;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct DiscoveryReport {
    pub user_identity: Option<UserIdentity>,
    pub ai_tools: Vec<AiTool>,
    pub projects: Vec<ProjectInfo>,
    pub dev_environment: DevEnvironment,
    pub installed_tools: Vec<String>,
    pub claude_memories: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserIdentity {
    pub name: Option<String>,
    pub email: Option<String>,
    pub github_username: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiTool {
    pub name: String,
    pub config_path: String,
    pub details: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectInfo {
    pub name: String,
    pub path: String,
    pub stack: Vec<String>,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct DevEnvironment {
    pub languages: Vec<String>,
    pub package_managers: Vec<String>,
    pub editors: Vec<String>,
    pub shell: Option<String>,
}

/// Run full discovery scan of the user's machine
#[tauri::command]
pub fn run_discovery() -> DiscoveryReport {
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    let mut report = DiscoveryReport::default();

    report.user_identity = discover_identity(&home);
    report.ai_tools = discover_ai_tools(&home);
    report.projects = discover_projects(&home);
    report.dev_environment = discover_dev_environment(&home);
    report.installed_tools = discover_installed_tools(&home);
    report.claude_memories = discover_claude_memories(&home);

    report
}

fn command_in_path(name: &str) -> bool {
    let Some(path_var) = std::env::var_os("PATH") else {
        return false;
    };
    for entry in std::env::split_paths(&path_var) {
        for candidate in executable_names(name) {
            if entry.join(candidate).exists() {
                return true;
            }
        }
    }
    false
}

fn executable_names(name: &str) -> Vec<OsString> {
    #[cfg(not(windows))]
    let names = vec![OsString::from(name)];
    #[cfg(windows)]
    {
        let mut names = vec![OsString::from(name)];
        names.push(OsString::from(format!("{name}.exe")));
        names.push(OsString::from(format!("{name}.cmd")));
        names.push(OsString::from(format!("{name}.bat")));
        return names;
    }
    #[cfg(not(windows))]
    names
}

fn read_dir_names(dir: &Path) -> Vec<String> {
    let Ok(entries) = fs::read_dir(dir) else {
        return Vec::new();
    };
    entries
        .flatten()
        .filter_map(|entry| entry.file_name().to_str().map(str::to_string))
        .collect()
}

fn discover_identity(home: &Path) -> Option<UserIdentity> {
    let mut identity = UserIdentity {
        name: None,
        email: None,
        github_username: None,
    };

    // Git config
    let gitconfig = home.join(".gitconfig");
    if let Ok(content) = fs::read_to_string(&gitconfig) {
        for line in content.lines() {
            let trimmed = line.trim();
            if let Some(name) = trimmed.strip_prefix("name = ") {
                identity.name = Some(name.to_string());
            }
            if let Some(email) = trimmed.strip_prefix("email = ") {
                identity.email = Some(email.to_string());
            }
        }
    }

    // GitHub CLI
    let gh_hosts = home.join(".config").join("gh").join("hosts.yml");
    if let Ok(content) = fs::read_to_string(&gh_hosts) {
        // Simple parse — look for "user:" line
        for line in content.lines() {
            let trimmed = line.trim();
            if let Some(user) = trimmed.strip_prefix("user: ") {
                identity.github_username = Some(user.to_string());
            }
        }
    }

    if identity.name.is_some() || identity.email.is_some() || identity.github_username.is_some() {
        Some(identity)
    } else {
        None
    }
}

fn discover_ai_tools(home: &Path) -> Vec<AiTool> {
    let mut tools = Vec::new();

    // Claude Code
    let claude_dir = home.join(".claude");
    if claude_dir.exists() {
        let mut details = HashMap::new();

        // Check for project memories
        let projects_dir = claude_dir.join("projects");
        if projects_dir.exists() {
            if let Ok(entries) = fs::read_dir(&projects_dir) {
                let project_count = entries.count();
                details.insert("project_count".into(), project_count.to_string());
            }
        }

        // Check for settings
        let settings = claude_dir.join("settings.json");
        if settings.exists() {
            details.insert("has_settings".into(), "true".into());
        }

        // Check for MCP servers in settings
        if let Ok(content) = fs::read_to_string(&settings) {
            if content.contains("mcpServers") {
                details.insert("has_mcp_servers".into(), "true".into());
            }
        }

        tools.push(AiTool {
            name: "Claude Code".into(),
            config_path: claude_dir.to_string_lossy().to_string(),
            details,
        });
    }

    // Codex CLI
    let codex_dir = home.join(".codex");
    if codex_dir.exists() {
        tools.push(AiTool {
            name: "OpenAI Codex CLI".into(),
            config_path: codex_dir.to_string_lossy().to_string(),
            details: HashMap::new(),
        });
    }

    // Cursor
    let cursor_dir = home.join(".cursor");
    if cursor_dir.exists() {
        tools.push(AiTool {
            name: "Cursor".into(),
            config_path: cursor_dir.to_string_lossy().to_string(),
            details: HashMap::new(),
        });
    }

    // Continue.dev
    let continue_dir = home.join(".continue");
    if continue_dir.exists() {
        tools.push(AiTool {
            name: "Continue.dev".into(),
            config_path: continue_dir.to_string_lossy().to_string(),
            details: HashMap::new(),
        });
    }

    // Ollama
    let ollama_dir = home.join(".ollama");
    if ollama_dir.exists() {
        let mut details = HashMap::new();
        let models_dir = ollama_dir.join("models");
        if models_dir.exists() {
            details.insert("has_local_models".into(), "true".into());
        }
        tools.push(AiTool {
            name: "Ollama".into(),
            config_path: ollama_dir.to_string_lossy().to_string(),
            details,
        });
    }

    // Open Interpreter
    let open_interpreter_config = home.join(".config").join("open-interpreter");
    let open_interpreter_pipx = home
        .join(".local")
        .join("share")
        .join("pipx")
        .join("venvs")
        .join("open-interpreter");
    if open_interpreter_config.exists()
        || open_interpreter_pipx.exists()
        || command_in_path("interpreter")
    {
        let mut details = HashMap::new();
        details.insert(
            "cli_available".into(),
            if command_in_path("interpreter") {
                "true"
            } else {
                "false"
            }
            .into(),
        );
        let profiles_dir = open_interpreter_config.join("profiles");
        if profiles_dir.exists() {
            let profiles = read_dir_names(&profiles_dir);
            if !profiles.is_empty() {
                details.insert("profile_count".into(), profiles.len().to_string());
                details.insert("profiles".into(), profiles.join(", "));
            }
        }
        if open_interpreter_pipx.exists() {
            details.insert("installed_via".into(), "pipx".into());
        }
        tools.push(AiTool {
            name: "Open Interpreter".into(),
            config_path: if open_interpreter_config.exists() {
                open_interpreter_config.to_string_lossy().to_string()
            } else {
                open_interpreter_pipx.to_string_lossy().to_string()
            },
            details,
        });
    }

    // Aider
    let aider_config = home.join(".aider.conf.yml");
    let aider_model_settings = home.join(".aider.model.settings.yml");
    if aider_config.exists() || aider_model_settings.exists() || command_in_path("aider") {
        let mut details = HashMap::new();
        details.insert(
            "cli_available".into(),
            if command_in_path("aider") {
                "true"
            } else {
                "false"
            }
            .into(),
        );
        if aider_config.exists() {
            details.insert("has_main_config".into(), "true".into());
        }
        if aider_model_settings.exists() {
            details.insert("has_model_settings".into(), "true".into());
        }
        tools.push(AiTool {
            name: "Aider".into(),
            config_path: if aider_config.exists() {
                aider_config.to_string_lossy().to_string()
            } else if aider_model_settings.exists() {
                aider_model_settings.to_string_lossy().to_string()
            } else {
                "aider".into()
            },
            details,
        });
    }

    // OpenHands
    let openhands_config = home.join(".config").join("openhands");
    if openhands_config.exists() || command_in_path("openhands") || command_in_path("uvx") {
        let mut details = HashMap::new();
        details.insert(
            "cli_available".into(),
            if command_in_path("openhands") {
                "true"
            } else {
                "false"
            }
            .into(),
        );
        details.insert(
            "uvx_available".into(),
            if command_in_path("uvx") {
                "true"
            } else {
                "false"
            }
            .into(),
        );
        if openhands_config.exists() {
            let files = read_dir_names(&openhands_config);
            if !files.is_empty() {
                details.insert("config_entries".into(), files.join(", "));
            }
        }
        tools.push(AiTool {
            name: "OpenHands".into(),
            config_path: if openhands_config.exists() {
                openhands_config.to_string_lossy().to_string()
            } else {
                "openhands".into()
            },
            details,
        });
    }

    // browser-use
    let browser_use_config = home.join(".config").join("browser-use");
    let browser_use_cache = home.join(".cache").join("browser-use");
    if browser_use_config.exists() || browser_use_cache.exists() || command_in_path("browser-use") {
        let mut details = HashMap::new();
        details.insert(
            "cli_available".into(),
            if command_in_path("browser-use") {
                "true"
            } else {
                "false"
            }
            .into(),
        );
        if browser_use_config.exists() {
            let files = read_dir_names(&browser_use_config);
            if !files.is_empty() {
                details.insert("config_entries".into(), files.join(", "));
            }
        }
        if browser_use_cache.exists() {
            details.insert("has_cache".into(), "true".into());
        }
        tools.push(AiTool {
            name: "browser-use".into(),
            config_path: if browser_use_config.exists() {
                browser_use_config.to_string_lossy().to_string()
            } else if browser_use_cache.exists() {
                browser_use_cache.to_string_lossy().to_string()
            } else {
                "browser-use".into()
            },
            details,
        });
    }

    // OpenCode
    let opencode_config = home.join(".config").join("opencode");
    let opencode_share = home.join(".local").join("share").join("opencode");
    if opencode_config.exists() || opencode_share.exists() || command_in_path("opencode") {
        let mut details = HashMap::new();
        details.insert(
            "cli_available".into(),
            if command_in_path("opencode") {
                "true"
            } else {
                "false"
            }
            .into(),
        );
        if opencode_config.exists() {
            let files = read_dir_names(&opencode_config);
            if !files.is_empty() {
                details.insert("config_entries".into(), files.join(", "));
            }
        }
        if opencode_share.exists() {
            let db = opencode_share.join("opencode.db");
            let log_dir = opencode_share.join("log");
            if db.exists() {
                details.insert("has_runtime_db".into(), "true".into());
            }
            if log_dir.exists() {
                details.insert("has_logs".into(), "true".into());
            }
        }
        tools.push(AiTool {
            name: "OpenCode".into(),
            config_path: if opencode_config.exists() {
                opencode_config.to_string_lossy().to_string()
            } else if opencode_share.exists() {
                opencode_share.to_string_lossy().to_string()
            } else {
                "opencode".into()
            },
            details,
        });
    }

    // Copilot (VS Code extension)
    let vscode_ext = home.join(".vscode").join("extensions");
    if vscode_ext.exists() {
        if let Ok(entries) = fs::read_dir(&vscode_ext) {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                if name.contains("copilot") {
                    tools.push(AiTool {
                        name: "GitHub Copilot".into(),
                        config_path: entry.path().to_string_lossy().to_string(),
                        details: HashMap::new(),
                    });
                    break;
                }
            }
        }
    }

    tools
}

fn discover_projects(home: &Path) -> Vec<ProjectInfo> {
    let mut projects = Vec::new();
    let search_dirs = vec![
        home.to_path_buf(),
        home.join("Documents"),
        home.join("projects"),
        home.join("repos"),
        home.join("dev"),
        home.join("code"),
        home.join("src"),
    ];

    for dir in search_dirs {
        if !dir.exists() {
            continue;
        }
        if let Ok(entries) = fs::read_dir(&dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if !path.is_dir() {
                    continue;
                }

                // Skip hidden dirs and node_modules
                let name = entry.file_name().to_string_lossy().to_string();
                if name.starts_with('.') || name == "node_modules" || name == "target" {
                    continue;
                }

                // Check if it's a project (has a project file)
                let mut stack = Vec::new();
                let mut is_project = false;

                if path.join("package.json").exists() {
                    stack.push("Node.js".to_string());
                    is_project = true;
                }
                if path.join("Cargo.toml").exists() {
                    stack.push("Rust".to_string());
                    is_project = true;
                }
                if path.join("requirements.txt").exists() || path.join("pyproject.toml").exists() {
                    stack.push("Python".to_string());
                    is_project = true;
                }
                if path.join("go.mod").exists() {
                    stack.push("Go".to_string());
                    is_project = true;
                }
                if path.join(".git").exists() {
                    is_project = true;
                }

                if !is_project {
                    continue;
                }

                // Try to get description from package.json
                let description = path
                    .join("package.json")
                    .exists()
                    .then(|| {
                        fs::read_to_string(path.join("package.json"))
                            .ok()
                            .and_then(|c| serde_json::from_str::<serde_json::Value>(&c).ok())
                            .and_then(|v| v["description"].as_str().map(|s| s.to_string()))
                    })
                    .flatten();

                projects.push(ProjectInfo {
                    name,
                    path: path.to_string_lossy().to_string(),
                    stack,
                    description,
                });
            }
        }
    }

    // Limit to 20 most relevant
    projects.truncate(20);
    projects
}

fn discover_dev_environment(home: &Path) -> DevEnvironment {
    let mut env = DevEnvironment::default();

    // Check for language runtimes via common config files
    if home.join(".nvm").exists() || home.join(".node_repl_history").exists() {
        env.languages.push("JavaScript/TypeScript".into());
    }
    if home.join(".rustup").exists() || home.join(".cargo").exists() {
        env.languages.push("Rust".into());
    }
    if home.join(".pyenv").exists() || home.join(".python_history").exists() {
        env.languages.push("Python".into());
    }
    if home.join("go").exists() {
        env.languages.push("Go".into());
    }

    // Package managers
    if home.join(".npm").exists() {
        env.package_managers.push("npm".into());
    }
    if home.join(".yarn").exists() {
        env.package_managers.push("yarn".into());
    }
    if home.join(".pnpm-store").exists() {
        env.package_managers.push("pnpm".into());
    }

    // Editors
    if home.join(".vscode").exists() {
        env.editors.push("VS Code".into());
    }
    if home.join(".cursor").exists() {
        env.editors.push("Cursor".into());
    }
    if home.join(".config").join("JetBrains").exists() {
        env.editors.push("JetBrains IDE".into());
    }
    if home.join("AppData").join("Local").join("nvim").exists() {
        env.editors.push("Neovim".into());
    }

    env
}

fn discover_installed_tools(home: &Path) -> Vec<String> {
    let mut tools = Vec::new();

    let checks: Vec<(&str, PathBuf)> = vec![
        ("Docker", home.join(".docker")),
        ("Git", home.join(".gitconfig")),
        ("GitHub CLI", home.join(".config").join("gh")),
        ("SSH", home.join(".ssh")),
        ("AWS CLI", home.join(".aws")),
        ("Vercel CLI", home.join(".vercel")),
        ("Supabase CLI", home.join(".supabase")),
        ("Firebase CLI", home.join(".config").join("firebase")),
        ("Terraform", home.join(".terraform.d")),
    ];

    for (name, path) in checks {
        if path.exists() {
            tools.push(name.to_string());
        }
    }

    if home.join(".ollama").exists() {
        tools.push("Ollama".into());
    }
    if home.join(".config").join("open-interpreter").exists() || command_in_path("interpreter") {
        tools.push("Open Interpreter".into());
    }
    if home.join(".aider.conf.yml").exists() || command_in_path("aider") {
        tools.push("Aider".into());
    }
    if home.join(".config").join("openhands").exists()
        || command_in_path("openhands")
        || command_in_path("uvx")
    {
        tools.push("OpenHands".into());
    }
    if home.join(".config").join("browser-use").exists() || command_in_path("browser-use") {
        tools.push("browser-use".into());
    }
    if home.join(".config").join("opencode").exists()
        || home.join(".local").join("share").join("opencode").exists()
        || command_in_path("opencode")
    {
        tools.push("OpenCode".into());
    }

    tools
}

/// Read Claude Code memory files — these contain rich context about the user
fn discover_claude_memories(home: &Path) -> Vec<String> {
    let mut memories = Vec::new();
    let projects_dir = home.join(".claude").join("projects");

    if !projects_dir.exists() {
        return memories;
    }

    if let Ok(project_dirs) = fs::read_dir(&projects_dir) {
        for project_entry in project_dirs.flatten() {
            let memory_dir = project_entry.path().join("memory");
            if !memory_dir.exists() {
                continue;
            }

            if let Ok(memory_files) = fs::read_dir(&memory_dir) {
                for file_entry in memory_files.flatten() {
                    let path = file_entry.path();

                    // Skip MEMORY.md (it's just an index) and non-md files
                    let name = path
                        .file_name()
                        .unwrap_or_default()
                        .to_string_lossy()
                        .to_string();
                    if name == "MEMORY.md" || !name.ends_with(".md") {
                        continue;
                    }

                    if let Ok(content) = fs::read_to_string(&path) {
                        // Strip frontmatter, keep the actual content
                        let cleaned = strip_frontmatter(&content);
                        if !cleaned.trim().is_empty() && cleaned.len() < 2000 {
                            memories.push(cleaned);
                        }
                    }
                }
            }
        }
    }

    // Cap at 20 memories to avoid token explosion
    memories.truncate(20);
    memories
}

/// Import MCP server configs from Claude Code settings
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportedMcpServer {
    pub name: String,
    pub command: String,
    pub args: Vec<String>,
    pub env: HashMap<String, String>,
    pub source: String,
}

#[tauri::command]
pub fn discover_mcp_servers() -> Vec<ImportedMcpServer> {
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    let mut servers = Vec::new();

    // Claude Code settings locations
    let settings_paths = vec![
        home.join(".claude").join("settings.json"),
        home.join(".claude.json"),
    ];

    // Also check project-level configs
    let claude_projects = home.join(".claude").join("projects");
    if claude_projects.exists() {
        if let Ok(entries) = fs::read_dir(&claude_projects) {
            for entry in entries.flatten() {
                let project_settings = entry.path().join("settings.json");
                if project_settings.exists() {
                    parse_claude_mcp_config(&project_settings, "claude-code-project", &mut servers);
                }
            }
        }
    }

    for path in settings_paths {
        if path.exists() {
            parse_claude_mcp_config(&path, "claude-code", &mut servers);
        }
    }

    // Codex CLI config
    let codex_config = home.join(".codex").join("config.json");
    if codex_config.exists() {
        parse_codex_mcp_config(&codex_config, &mut servers);
    }

    // Deduplicate by name
    let mut seen = std::collections::HashSet::new();
    servers.retain(|s| seen.insert(s.name.clone()));

    servers
}

fn parse_claude_mcp_config(path: &Path, source: &str, servers: &mut Vec<ImportedMcpServer>) {
    let content = match fs::read_to_string(path) {
        Ok(c) => c,
        Err(_) => return,
    };

    let json: serde_json::Value = match serde_json::from_str(&content) {
        Ok(v) => v,
        Err(_) => return,
    };

    let mcp_servers = match json.get("mcpServers").and_then(|v| v.as_object()) {
        Some(obj) => obj,
        None => return,
    };

    for (name, config) in mcp_servers {
        let command = config["command"].as_str().unwrap_or_default().to_string();
        if command.is_empty() {
            continue;
        }

        let args: Vec<String> = config["args"]
            .as_array()
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str().map(|s| s.to_string()))
                    .collect()
            })
            .unwrap_or_default();

        let env: HashMap<String, String> = config["env"]
            .as_object()
            .map(|obj| {
                obj.iter()
                    .filter_map(|(k, v)| v.as_str().map(|s| (k.clone(), s.to_string())))
                    .collect()
            })
            .unwrap_or_default();

        servers.push(ImportedMcpServer {
            name: name.clone(),
            command,
            args,
            env,
            source: source.to_string(),
        });
    }
}

fn parse_codex_mcp_config(path: &Path, servers: &mut Vec<ImportedMcpServer>) {
    let content = match fs::read_to_string(path) {
        Ok(c) => c,
        Err(_) => return,
    };

    let json: serde_json::Value = match serde_json::from_str(&content) {
        Ok(v) => v,
        Err(_) => return,
    };

    // Codex uses "mcp_servers" or "mcpServers"
    let mcp_key = if json.get("mcp_servers").is_some() {
        "mcp_servers"
    } else {
        "mcpServers"
    };

    if let Some(obj) = json.get(mcp_key).and_then(|v| v.as_object()) {
        for (name, config) in obj {
            let command = config["command"].as_str().unwrap_or_default().to_string();
            if command.is_empty() {
                continue;
            }

            let args: Vec<String> = config["args"]
                .as_array()
                .map(|arr| {
                    arr.iter()
                        .filter_map(|v| v.as_str().map(|s| s.to_string()))
                        .collect()
                })
                .unwrap_or_default();

            servers.push(ImportedMcpServer {
                name: name.clone(),
                command,
                args,
                env: HashMap::new(),
                source: "codex-cli".to_string(),
            });
        }
    }
}

fn strip_frontmatter(content: &str) -> String {
    let trimmed = content.trim();
    if trimmed.starts_with("---") {
        if let Some(end) = trimmed[3..].find("---") {
            return trimmed[end + 6..].trim().to_string();
        }
    }
    trimmed.to_string()
}
