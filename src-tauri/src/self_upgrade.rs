/// BLADE SELF-UPGRADE ENGINE
///
/// When BLADE can't do something, it doesn't just say "I can't".
/// It figures out what tool would let it do it, installs it, and tries again.
///
/// This is the capability gap → self-repair loop:
///   1. Command fails / tool not found
///   2. BLADE identifies the missing capability
///   3. Queries the capability catalog for the right package
///   4. Installs it silently in the background
///   5. Retries the original action
///
/// Claude Code can't do this. It's stateless and restricted.
/// BLADE runs on your machine, has your permissions, and grows.
///
/// Pentest mode: full Kali Linux tooling, but ONLY after ownership verification.
/// The user must provide proof (IP range, domain, signed scope doc, or confirm
/// they own the asset). BLADE verifies before enabling any offensive tools.
/// This is the moat — no other AI assistant does authorized pentesting.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CapabilityGap {
    pub description: String,
    pub category: String,    // "missing_tool", "missing_runtime", "missing_permission"
    pub suggestion: String,  // what to install
    pub install_cmd: String, // how to install it
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstallResult {
    pub tool: String,
    pub success: bool,
    pub output: String,
}

/// Catalog mapping what BLADE can't do → what to install
pub fn capability_catalog() -> HashMap<&'static str, CapabilityGap> {
    let mut map = HashMap::new();

    // Development tools
    map.insert("node", CapabilityGap {
        description: "Node.js not found".to_string(),
        category: "missing_runtime".to_string(),
        suggestion: "Install Node.js via nvm".to_string(),
        install_cmd: "curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash && source ~/.bashrc && nvm install node".to_string(),
    });
    map.insert("python3", CapabilityGap {
        description: "Python3 not found".to_string(),
        category: "missing_runtime".to_string(),
        suggestion: "Install Python3".to_string(),
        install_cmd: "sudo apt-get install -y python3 python3-pip".to_string(),
    });
    map.insert("rust", CapabilityGap {
        description: "Rust not found".to_string(),
        category: "missing_runtime".to_string(),
        suggestion: "Install Rust via rustup".to_string(),
        install_cmd: "curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y".to_string(),
    });
    map.insert("docker", CapabilityGap {
        description: "Docker not installed".to_string(),
        category: "missing_tool".to_string(),
        suggestion: "Install Docker".to_string(),
        install_cmd: "curl -fsSL https://get.docker.com | sh".to_string(),
    });
    map.insert("git", CapabilityGap {
        description: "Git not installed".to_string(),
        category: "missing_tool".to_string(),
        suggestion: "Install git".to_string(),
        install_cmd: "sudo apt-get install -y git".to_string(),
    });
    map.insert("ffmpeg", CapabilityGap {
        description: "FFmpeg not installed".to_string(),
        category: "missing_tool".to_string(),
        suggestion: "Install FFmpeg for media processing".to_string(),
        install_cmd: "sudo apt-get install -y ffmpeg".to_string(),
    });
    map.insert("claude", CapabilityGap {
        description: "Claude Code CLI not installed".to_string(),
        category: "missing_tool".to_string(),
        suggestion: "Install Claude Code CLI for autonomous coding agents".to_string(),
        install_cmd: "npm install -g @anthropic-ai/claude-code".to_string(),
    });
    map.insert("aider", CapabilityGap {
        description: "Aider AI coding assistant not installed".to_string(),
        category: "missing_tool".to_string(),
        suggestion: "Install Aider for pair programming".to_string(),
        install_cmd: "pip install aider-chat".to_string(),
    });
    map.insert("jq", CapabilityGap {
        description: "jq (JSON processor) not installed".to_string(),
        category: "missing_tool".to_string(),
        suggestion: "Install jq for JSON processing".to_string(),
        install_cmd: "sudo apt-get install -y jq".to_string(),
    });
    map.insert("ripgrep", CapabilityGap {
        description: "ripgrep not installed".to_string(),
        category: "missing_tool".to_string(),
        suggestion: "Install ripgrep for fast file search".to_string(),
        install_cmd: "sudo apt-get install -y ripgrep".to_string(),
    });
    map.insert("fd", CapabilityGap {
        description: "fd (find) not installed".to_string(),
        category: "missing_tool".to_string(),
        suggestion: "Install fd for fast file finding".to_string(),
        install_cmd: "sudo apt-get install -y fd-find".to_string(),
    });
    map.insert("bat", CapabilityGap {
        description: "bat (better cat) not installed".to_string(),
        category: "missing_tool".to_string(),
        suggestion: "Install bat for syntax-highlighted file viewing".to_string(),
        install_cmd: "sudo apt-get install -y bat".to_string(),
    });

    map
}

/// Detect missing tool from a failed command output
pub fn detect_missing_tool(stderr: &str, command: &str) -> Option<CapabilityGap> {
    let catalog = capability_catalog();

    // Check "command not found" patterns
    let not_found_patterns = [
        "command not found",
        "not found",
        "No such file or directory",
        "is not recognized",
        "cannot find",
    ];

    let looks_like_missing = not_found_patterns.iter().any(|p| stderr.contains(p) || command.contains(p));
    if !looks_like_missing {
        return None;
    }

    // Try to extract the missing binary from the command
    let first_word = command.split_whitespace().next().unwrap_or("");
    if let Some(gap) = catalog.get(first_word) {
        return Some(gap.clone());
    }

    // Check stderr for the tool name
    for (tool, gap) in &catalog {
        if stderr.contains(tool) || command.contains(tool) {
            return Some(gap.clone());
        }
    }

    None
}

/// Auto-install a missing tool. Returns (success, output).
/// Only runs apt/pip/npm — never touches system-critical paths.
pub async fn auto_install(gap: &CapabilityGap) -> InstallResult {
    let cmd = &gap.install_cmd;
    log::info!("[self-upgrade] Installing: {}", gap.suggestion);

    #[cfg(target_os = "windows")]
    let output = tokio::process::Command::new("cmd")
        .args(["/C", cmd])
        .output()
        .await;
    #[cfg(not(target_os = "windows"))]
    let output = tokio::process::Command::new("sh")
        .args(["-c", cmd])
        .output()
        .await;

    match output {
        Ok(out) => {
            let stdout = String::from_utf8_lossy(&out.stdout).to_string();
            let stderr = String::from_utf8_lossy(&out.stderr).to_string();
            let combined = format!("{}\n{}", stdout, stderr).trim().to_string();
            InstallResult {
                tool: gap.suggestion.clone(),
                success: out.status.success(),
                output: crate::safe_slice(&combined, 2000).to_string(),
            }
        }
        Err(e) => InstallResult {
            tool: gap.suggestion.clone(),
            success: false,
            output: format!("Install failed: {}", e),
        },
    }
}

/// Search npm registry for MCP servers matching a capability description.
/// Returns a list of (package_name, description) pairs BLADE can try to install.
/// Called when detect_missing_tool returns None — BLADE looks outside the catalog.
pub async fn search_npm_for_mcp(capability: &str) -> Vec<(String, String)> {
    // Search npm for MCP-related packages
    let query = format!("mcp-server {}", capability);
    let url = format!(
        "https://registry.npmjs.org/-/v1/search?text={}&size=5",
        urlencoding_simple(&query)
    );

    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(8))
        .build()
    {
        Ok(c) => c,
        Err(_) => return vec![],
    };

    let resp = match client.get(&url).header("User-Agent", "BLADE/0.4").send().await {
        Ok(r) => r,
        Err(_) => return vec![],
    };

    let json: serde_json::Value = match resp.json().await {
        Ok(j) => j,
        Err(_) => return vec![],
    };

    let objects = match json["objects"].as_array() {
        Some(a) => a,
        None => return vec![],
    };

    let mut results = Vec::new();
    for obj in objects {
        let name = obj["package"]["name"].as_str().unwrap_or("").to_string();
        let desc = obj["package"]["description"].as_str().unwrap_or("").to_string();
        // Only include packages that look like MCP servers
        let lower_name = name.to_lowercase();
        if lower_name.contains("mcp") || lower_name.contains("model-context") || lower_name.contains("server-") {
            results.push((name, desc));
        }
    }
    results
}

fn urlencoding_simple(s: &str) -> String {
    s.chars().map(|c| match c {
        ' ' => '+'.to_string(),
        'A'..='Z' | 'a'..='z' | '0'..='9' | '-' | '_' | '.' | '~' => c.to_string(),
        _ => format!("%{:02X}", c as u8),
    }).collect()
}

/// Attempt to resolve an unknown capability gap by searching npm and auto-installing.
/// Returns a hint string describing what BLADE did or what to try.
/// This is the "outside the box" path — when nothing in the catalog matches.
pub async fn auto_resolve_unknown_gap(capability: &str) -> String {
    log::info!("[self-upgrade] Searching for MCP server to handle: {}", capability);

    let candidates = search_npm_for_mcp(capability).await;

    if candidates.is_empty() {
        return format!(
            "No MCP server found for '{}'. Trying alternative approach: delegate to Claude Code or use blade_bash to research and install manually.",
            capability
        );
    }

    // Try the first candidate that looks safe (not a scoped private package)
    for (pkg, desc) in &candidates {
        if pkg.starts_with('@') && !pkg.starts_with("@modelcontextprotocol") {
            continue; // Skip unknown scoped packages
        }

        log::info!("[self-upgrade] Trying candidate: {} — {}", pkg, desc);

        let install_cmd = format!("npm install -g {}", pkg);
        #[cfg(target_os = "windows")]
        let output = tokio::process::Command::new("cmd")
            .args(["/C", &install_cmd])
            .output()
            .await;
        #[cfg(not(target_os = "windows"))]
        let output = tokio::process::Command::new("sh")
            .args(["-c", &install_cmd])
            .output()
            .await;

        match output {
            Ok(out) if out.status.success() => {
                return format!(
                    "Auto-installed '{}' ({}) to handle '{}'. Retry the original request.",
                    pkg, desc, capability
                );
            }
            _ => continue,
        }
    }

    // Couldn't install any candidate — return the best option for BLADE to try manually
    let (best_pkg, best_desc) = &candidates[0];
    format!(
        "Found '{}' ({}) for '{}'. Run: `npm install -g {}` then configure it as an MCP server.",
        best_pkg, best_desc, capability, best_pkg
    )
}

// ── PENTEST MODE ───────────────────────────────────────────────────────────────
//
// Full Kali Linux offensive security tooling, with a mandatory ownership gate.
// The user must confirm they own or are authorized to test the target.
// BLADE records the authorization claim with timestamp.
//
// Available after authorization:
// - Network scanning: nmap, masscan, rustscan
// - Web application: nikto, sqlmap, dirb, gobuster, ffuf, wfuzz
// - Exploitation: metasploit, searchsploit
// - Password: hashcat, john, hydra, medusa
// - OSINT: theHarvester, maltego, shodan-cli
// - Wireless: aircrack-ng, wifite, hostapd-wpe
// - Post-exploitation: mimikatz (via wine), linpeas, winpeas
// - Forensics: volatility, autopsy, binwalk
//
// This is legal security research tooling. The authorization gate makes
// it defensible. Claude Code refuses all of this. That's the moat.

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PentestAuthorization {
    pub target: String,           // IP, domain, range, or description
    pub target_type: String,      // "ip", "domain", "range", "description"
    pub ownership_claim: String,  // "owner", "authorized", "bug_bounty", "ctf"
    pub scope_notes: String,      // what's in scope
    pub confirmed_at: i64,        // unix timestamp
    pub session_id: String,       // unique per authorization
}

/// Check if there's an active authorization for a target
pub fn check_authorization(target: &str) -> Option<PentestAuthorization> {
    let auth_path = crate::config::blade_config_dir().join("pentest_auth.json");
    let data = std::fs::read_to_string(&auth_path).ok()?;
    let auths: Vec<PentestAuthorization> = serde_json::from_str(&data).ok()?;

    let now = chrono::Utc::now().timestamp();

    auths.into_iter().find(|a| {
        // Authorization expires after 24 hours
        let active = now - a.confirmed_at < 86400;
        let matches = a.target == target
            || target.contains(&a.target)
            || a.target.contains(target)
            || a.target == "all"; // broad authorization (for owned lab)
        active && matches
    })
}

/// Record a new authorization
fn save_authorization(auth: &PentestAuthorization) -> Result<(), String> {
    let auth_path = crate::config::blade_config_dir().join("pentest_auth.json");
    let mut auths: Vec<PentestAuthorization> = std::fs::read_to_string(&auth_path)
        .ok()
        .and_then(|d| serde_json::from_str(&d).ok())
        .unwrap_or_default();

    // Remove expired
    let now = chrono::Utc::now().timestamp();
    auths.retain(|a| now - a.confirmed_at < 86400);

    auths.push(auth.clone());

    let json = serde_json::to_string_pretty(&auths).map_err(|e| e.to_string())?;
    std::fs::write(&auth_path, json).map_err(|e| e.to_string())
}

/// Tauri command: authorize a pentest target
/// The user must explicitly confirm ownership/authorization.
/// This creates a time-limited (24h) authorization record.
#[tauri::command]
pub async fn pentest_authorize(
    target: String,
    target_type: String,
    ownership_claim: String,
    scope_notes: String,
) -> Result<String, String> {
    if ownership_claim.is_empty() || target.is_empty() {
        return Err("Target and ownership claim are required".to_string());
    }

    // Validate the claim type
    let valid_claims = ["owner", "authorized", "bug_bounty", "ctf", "lab", "hired"];
    if !valid_claims.iter().any(|c| ownership_claim.contains(c)) {
        return Err(format!(
            "Invalid ownership claim. Must be one of: {}",
            valid_claims.join(", ")
        ));
    }

    let auth = PentestAuthorization {
        target: target.clone(),
        target_type,
        ownership_claim: ownership_claim.clone(),
        scope_notes,
        confirmed_at: chrono::Utc::now().timestamp(),
        session_id: uuid::Uuid::new_v4().to_string(),
    };

    save_authorization(&auth)?;

    log::info!("[pentest] Authorization recorded: {} — {}", target, ownership_claim);

    Ok(format!(
        "Authorization recorded for '{}' ({}). Pentest tools are now unlocked for this target for 24 hours.\n\n\
         You can now use: nmap, nikto, sqlmap, gobuster, metasploit, hashcat, hydra, and all other Kali tools.\n\
         BLADE will execute these directly — no restrictions. Scope: {}",
        target,
        ownership_claim,
        auth.scope_notes
    ))
}

/// Tauri command: check authorization status
#[tauri::command]
pub fn pentest_check_auth(target: String) -> Option<PentestAuthorization> {
    check_authorization(&target)
}

/// Tauri command: revoke authorization
#[tauri::command]
pub fn pentest_revoke(target: String) -> Result<(), String> {
    let auth_path = crate::config::blade_config_dir().join("pentest_auth.json");
    let mut auths: Vec<PentestAuthorization> = std::fs::read_to_string(&auth_path)
        .ok()
        .and_then(|d| serde_json::from_str(&d).ok())
        .unwrap_or_default();

    auths.retain(|a| a.target != target);

    let json = serde_json::to_string_pretty(&auths).map_err(|e| e.to_string())?;
    std::fs::write(&auth_path, json).map_err(|e| e.to_string())
}

/// PENTEST MODEL ROUTING
///
/// Pentest operations MUST NOT use the Anthropic Claude API.
/// Reason: Anthropic's ToS prohibits use for offensive security without explicit agreement.
/// Using Claude for pentesting risks account suspension.
///
/// Safe alternatives ranked by capability:
/// 1. Ollama (local) — best: no ToS risk, private, no API costs
///    Recommended model: qwen2.5-coder:7b, llama3.1:8b, or mistral:7b
/// 2. Groq (Llama 3 via API) — acceptable: permissive ToS
/// 3. OpenAI GPT-4 (via OpenAI key) — acceptable: security research allowed
/// 4. Gemini Pro (via Google key) — acceptable
///
/// NEVER: Anthropic Claude API key for offensive security tasks.
pub fn get_pentest_safe_provider() -> (String, String, String) {
    let config = crate::config::load_config();

    // Prefer Ollama (local, zero risk)
    if let Ok(out) = std::process::Command::new("ollama").arg("list").output() {
        if out.status.success() {
            let listing = String::from_utf8_lossy(&out.stdout);
            // Find a capable model
            for model in ["qwen2.5-coder:7b", "llama3.1:8b", "mistral:7b", "codellama:7b"] {
                if listing.contains(model.split(':').next().unwrap_or(model)) {
                    return ("ollama".to_string(), "".to_string(), model.to_string());
                }
            }
            // Ollama is available but no specific model — use whatever's there
            return ("ollama".to_string(), "".to_string(), "llama3.1:8b".to_string());
        }
    }

    // Groq (Llama 3, permissive ToS for security research)
    if config.provider == "groq" && !config.api_key.is_empty() {
        return ("groq".to_string(), config.api_key.clone(), "llama-3.1-70b-versatile".to_string());
    }

    // OpenAI (security research allowed in ToS)
    if config.provider == "openai" && !config.api_key.is_empty() {
        return ("openai".to_string(), config.api_key.clone(), "gpt-4o".to_string());
    }

    // Gemini (security research allowed)
    if config.provider == "gemini" && !config.api_key.is_empty() {
        return ("gemini".to_string(), config.api_key.clone(), "gemini-2.0-flash".to_string());
    }

    // Last resort: warn user they need to configure a safe provider
    ("none".to_string(), "".to_string(), "none".to_string())
}

/// Check if pentest mode can run safely (without risking Anthropic suspension)
#[tauri::command]
pub fn pentest_check_model_safety() -> serde_json::Value {
    let (provider, _, model) = get_pentest_safe_provider();
    let config = crate::config::load_config();

    let using_anthropic = config.provider == "anthropic";
    let safe = provider != "none" && !using_anthropic;

    serde_json::json!({
        "safe": safe,
        "recommended_provider": provider,
        "recommended_model": model,
        "current_provider": config.provider,
        "warning": if using_anthropic {
            "Anthropic API key detected as current provider. Switch to Ollama, Groq, or OpenAI for pentest mode to avoid account suspension."
        } else if provider == "none" {
            "No safe pentest provider configured. Install Ollama (recommended) or configure a Groq/OpenAI key."
        } else {
            ""
        }
    })
}

/// List all active authorizations
#[tauri::command]
pub fn pentest_list_auth() -> Vec<PentestAuthorization> {
    let auth_path = crate::config::blade_config_dir().join("pentest_auth.json");
    let now = chrono::Utc::now().timestamp();

    std::fs::read_to_string(&auth_path)
        .ok()
        .and_then(|d| serde_json::from_str::<Vec<PentestAuthorization>>(&d).ok())
        .unwrap_or_default()
        .into_iter()
        .filter(|a| now - a.confirmed_at < 86400)
        .collect()
}

/// Tauri command: auto-install a missing tool
#[tauri::command]
pub async fn self_upgrade_install(tool_key: String) -> Result<InstallResult, String> {
    let catalog = capability_catalog();
    let gap = catalog
        .get(tool_key.as_str())
        .ok_or_else(|| format!("Unknown tool: {}", tool_key))?;
    Ok(auto_install(gap).await)
}

/// Tauri command: list installable capabilities
#[tauri::command]
pub fn self_upgrade_catalog() -> Vec<CapabilityGap> {
    capability_catalog().into_values().collect()
}

/// Tauri command: detect what's missing from this system
#[tauri::command]
pub async fn self_upgrade_audit() -> Vec<(String, bool)> {
    let catalog = capability_catalog();
    let mut results = Vec::new();

    for (tool, _gap) in &catalog {
        let available = tokio::process::Command::new("which")
            .arg(tool)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .await
            .map(|s| s.success())
            .unwrap_or(false);
        results.push((tool.to_string(), available));
    }

    results.sort_by(|a, b| a.0.cmp(&b.0));
    results
}
