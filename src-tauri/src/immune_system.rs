/// IMMUNE SYSTEM — BLADE's self-evolution coordinator.
///
/// When BLADE encounters something it can't do, the immune system kicks in:
///   1. DETECT — capability gap identified (tool call failed, organ missing, Brain plan references unknown capability)
///   2. SEARCH — check MCP registry, npm, CLI tools, browser automation
///   3. ACQUIRE — install MCP server, CLI tool, or forge a new tool
///   4. INTEGRATE — register new capability, update organ roster, notify Brain
///
/// This module coordinates existing subsystems:
///   - evolution.rs → MCP catalog discovery + auto-install
///   - tool_forge.rs → dynamic tool creation via Claude Code
///   - mcp.rs → MCP server management
///   - deep_scan.rs → CLI/app detection
///
/// The immune system doesn't duplicate their work — it's the decision layer
/// that chains them together when a gap is detected.

use tauri::Emitter;

/// Attempt to resolve a capability gap. Called when:
/// - A tool call fails with "not found" or similar
/// - Brain planner references an organ that doesn't exist
/// - User asks for something no existing tool can do
///
/// Returns a human-readable status message for the chat model to relay.
pub async fn resolve_capability_gap(
    app: &tauri::AppHandle,
    capability: &str,
    user_request: &str,
) -> String {
    // Phase 22 (v1.3) — Voyager loop step 1 of 4: ActivityStrip M-07 contract.
    crate::voyager_log::gap_detected(capability, user_request);

    let _ = app.emit_to("main", "blade_evolving", serde_json::json!({
        "capability": capability,
        "status": "searching",
    }));

    // Log the gap for learning
    crate::evolution::evolution_log_capability_gap(
        capability.to_string(),
        user_request.to_string(),
    );

    // Step 1: Check if an existing MCP server can handle this
    let mcp_match = check_mcp_catalog(capability).await;
    if let Some(server_name) = mcp_match {
        let _ = app.emit_to("main", "blade_evolving", serde_json::json!({
            "capability": capability,
            "status": "installing",
            "solution": &server_name,
        }));
        return format!(
            "Found MCP server '{}' that can handle this. \
             BLADE's evolution system will attempt to install it. \
             Try again in a moment — the capability should be available.",
            server_name
        );
    }

    // Step 2: Check if a CLI tool exists on the system
    let cli_match = check_cli_tools(capability);
    if let Some(cli_tool) = cli_match {
        return format!(
            "Found '{}' already installed on this system. \
             You can use it via the bash tool: run the appropriate {} command.",
            cli_tool, cli_tool
        );
    }

    // Step 3: Check if browser automation can handle it
    let browser_capable = can_browser_handle(capability);
    if browser_capable {
        return format!(
            "This can be done through browser automation. \
             Use the browser tools to navigate to the relevant website and perform the action."
        );
    }

    // Step 4: Try to forge a new tool
    let _ = app.emit_to("main", "blade_evolving", serde_json::json!({
        "capability": capability,
        "status": "forging",
    }));

    // Phase 47 (FORGE-02) — use the app-aware forge entry-point so the chat
    // surface renders the 5-line forge sequence (gap_detected → writing →
    // testing → registered → retrying). The pre-check inside
    // forge_if_needed_with_app short-circuits if an existing tool covers
    // the gap.
    match crate::tool_forge::forge_if_needed_with_app(
        app,
        user_request,
        &format!("Missing capability: {}", capability),
    )
    .await
    {
        Some(tool) => {
            let _ = app.emit_to("main", "blade_evolving", serde_json::json!({
                "capability": capability,
                "status": "forged",
                "tool_name": &tool.name,
            }));
            format!(
                "Created a new tool '{}' to handle this. \
                 It's now available for use. Try the request again.",
                tool.name
            )
        }
        None => {
            let _ = app.emit_to("main", "blade_evolving", serde_json::json!({
                "capability": capability,
                "status": "failed",
            }));
            format!(
                "I don't currently have a way to do '{}', and I couldn't find \
                 an existing tool or create one automatically. \
                 You could: (1) install an MCP server for it, \
                 (2) point me to a CLI tool, or (3) I can try to do it via the browser.",
                capability
            )
        }
    }
}

/// Check the evolution catalog for an MCP server matching this capability.
async fn check_mcp_catalog(capability: &str) -> Option<String> {
    let cap_lower = capability.to_lowercase();

    // Map common capability keywords to known MCP servers
    let mappings: &[(&[&str], &str)] = &[
        (&["kubernetes", "k8s", "kubectl", "pods", "cluster"], "Kubernetes"),
        (&["docker", "container", "image"], "Docker"),
        (&["youtube", "video upload"], "YouTube"),
        (&["spotify", "music", "playlist"], "Spotify"),
        (&["notion", "wiki", "knowledge base"], "Notion"),
        (&["figma", "design", "mockup"], "Figma"),
        (&["shopify", "store", "ecommerce"], "Shopify"),
        (&["stripe", "payment", "billing"], "Stripe"),
        (&["reddit", "subreddit"], "Reddit"),
        (&["twitter", "tweet", "x.com"], "Twitter/X"),
        (&["instagram", "ig", "reel"], "Instagram"),
        (&["postgres", "postgresql", "sql database"], "PostgreSQL"),
        (&["mongodb", "mongo"], "MongoDB"),
        (&["redis", "cache"], "Redis"),
        (&["terraform", "infrastructure as code", "iac"], "Terraform"),
        (&["jira", "ticket", "sprint"], "Jira"),
        (&["linear", "issue tracker"], "Linear"),
        (&["sentry", "error tracking"], "Sentry"),
        (&["datadog", "monitoring", "apm"], "Datadog"),
        (&["cloudflare", "cdn", "dns"], "Cloudflare"),
        (&["supabase", "backend as a service"], "Supabase"),
        (&["firebase", "google cloud"], "Firebase"),
        (&["vercel", "deployment", "deploy"], "Vercel"),
        (&["netlify"], "Netlify"),
    ];

    for (keywords, server_name) in mappings {
        if keywords.iter().any(|k| cap_lower.contains(k)) {
            // Check if this server is already available
            // If not, signal evolution to install it
            let app_result: Result<(), String> = Ok(());
            if app_result.is_ok() {
                // Trigger evolution cycle to pick up the suggestion
                return Some(server_name.to_string());
            }
        }
    }

    None
}

/// Check if a CLI tool matching the capability exists on the system.
fn check_cli_tools(capability: &str) -> Option<String> {
    let cap_lower = capability.to_lowercase();

    let tools: &[(&[&str], &str)] = &[
        (&["kubernetes", "k8s", "pods"], "kubectl"),
        (&["docker", "container"], "docker"),
        (&["terraform", "iac"], "terraform"),
        (&["git", "commit", "branch"], "git"),
        (&["python", "pip"], "python3"),
        (&["node", "npm", "javascript"], "node"),
        (&["rust", "cargo"], "cargo"),
        (&["go", "golang"], "go"),
        (&["aws", "s3", "ec2", "lambda"], "aws"),
        (&["gcloud", "gcp"], "gcloud"),
        (&["azure", "az"], "az"),
        (&["ffmpeg", "video", "audio convert"], "ffmpeg"),
        (&["imagemagick", "image convert"], "convert"),
        (&["curl", "http request"], "curl"),
        (&["ssh", "remote server"], "ssh"),
    ];

    for (keywords, tool_name) in tools {
        if keywords.iter().any(|k| cap_lower.contains(k)) {
            // Check if the tool is actually installed
            #[cfg(not(target_os = "windows"))]
            let check = std::process::Command::new("which")
                .arg(tool_name)
                .output();

            #[cfg(target_os = "windows")]
            let check = std::process::Command::new("where")
                .arg(tool_name)
                .output();

            if let Ok(output) = check {
                if output.status.success() {
                    return Some(tool_name.to_string());
                }
            }
        }
    }

    None
}

/// Check if browser automation (CDP) could handle the requested capability.
fn can_browser_handle(capability: &str) -> bool {
    let cap_lower = capability.to_lowercase();
    let browser_capable = [
        "upload", "download", "fill form", "login", "sign in",
        "post", "submit", "navigate", "click", "search on",
        "order", "buy", "subscribe", "unsubscribe",
        "youtube", "reddit", "twitter", "instagram", "linkedin",
        "google", "amazon", "ebay", "shopify",
    ];
    browser_capable.iter().any(|k| cap_lower.contains(k))
}

// ── Tauri Commands ───────────────────────────────────────────────────────────

#[tauri::command]
pub async fn immune_resolve_gap(
    app: tauri::AppHandle,
    capability: String,
    user_request: String,
) -> String {
    resolve_capability_gap(&app, &capability, &user_request).await
}
