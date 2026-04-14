/// AUTOSKILLS — Automatic capability acquisition.
///
/// When BLADE fails at a task (tool not found, capability gap detected, MCP error),
/// this module fires: it analyzes what failed, searches the catalog for matching
/// servers, installs zero-token ones silently, and surfaces a one-click suggestion
/// for anything requiring credentials.
///
/// The goal: BLADE should never say "I can't do that" without first trying to
/// acquire the capability it needs. Fail → diagnose → install → retry.

use std::collections::HashMap;
use tauri::Emitter;

/// Minimal description of a capability gap.
pub struct GapContext<'a> {
    /// The user's original request
    pub user_request: &'a str,
    /// The tool name or error that triggered the gap (e.g. "browser", "puppeteer")
    pub missing_capability: &'a str,
    /// The raw error string from the provider
    pub error: &'a str,
}

/// Result of an autoskill attempt.
#[allow(dead_code)]
#[derive(Debug)]
pub enum AutoskillResult {
    /// Installed silently — caller should retry the original task
    InstalledSilently { name: String, tool_count: usize },
    /// Requires user approval — suggestion emitted, cannot retry yet
    SuggestionEmitted { name: String },
    /// No matching capability found in catalog
    NothingFound,
}

/// Map common error patterns / keywords to catalog server names.
/// Broader than evolution catalog triggers — covers tool call failures too.
fn keywords_to_catalog_name(capability: &str, error: &str) -> Vec<&'static str> {
    let combined = format!("{} {}", capability, error).to_lowercase();
    let mut matches = Vec::new();

    // Generic "tool not found" errors → browser automation is the most common gap
    if combined.contains("tool not found") || combined.contains("unknown tool")
        || combined.contains("no tool named") || combined.contains("function not found")
        || combined.contains("method not found") {
        matches.push("Browser Automation (Puppeteer)");
    }

    if combined.contains("browser") || combined.contains("puppeteer") || combined.contains("playwright")
        || combined.contains("scrape") || combined.contains("navigate") || combined.contains("click")
        || combined.contains("open url") || combined.contains("web page") || combined.contains("screenshot")
        || combined.contains("selenium") || combined.contains("headless") || combined.contains("automation") {
        matches.push("Browser Automation (Puppeteer)");
    }
    if combined.contains("github") || combined.contains("git hub") || combined.contains("pull request")
        || combined.contains("repository") || combined.contains("pr ") || combined.contains("issue")
        || combined.contains("commit") && combined.contains("push") {
        matches.push("GitHub");
    }
    if combined.contains("slack") || (combined.contains("message") && combined.contains("channel"))
        || combined.contains("dm ") || combined.contains("workspace") && combined.contains("chat") {
        matches.push("Slack");
    }
    if combined.contains("notion") || combined.contains("notion page") || combined.contains("notion database") {
        matches.push("Notion");
    }
    if combined.contains("linear") || (combined.contains("ticket") && !combined.contains("github"))
        || combined.contains("sprint") || combined.contains("backlog") {
        matches.push("Linear");
    }
    if combined.contains("figma") || (combined.contains("design") && combined.contains("token"))
        || combined.contains("figma file") {
        matches.push("Figma");
    }
    if combined.contains("jira") || combined.contains("confluence") || combined.contains("atlassian")
        || combined.contains("bitbucket") {
        matches.push("Jira / Confluence");
    }
    if combined.contains("postgres") || combined.contains("postgresql") || combined.contains("database")
        || (combined.contains("sql") && !combined.contains("sqlite") && !combined.contains("mysql")) {
        matches.push("PostgreSQL");
    }
    if combined.contains("supabase") || combined.contains("supabase_url") {
        matches.push("Supabase");
    }
    if combined.contains("vercel") || (combined.contains("deploy") && combined.contains("preview")) {
        matches.push("Vercel");
    }
    if combined.contains("obsidian") || (combined.contains("vault") && combined.contains("note")) {
        matches.push("Obsidian");
    }
    if combined.contains("spotify") || combined.contains("music") || combined.contains("playlist") {
        matches.push("Spotify");
    }
    if combined.contains("google calendar") || combined.contains("calendar event") || combined.contains("gcal") {
        matches.push("Google Calendar");
    }
    if combined.contains("gmail") || combined.contains("send email") || combined.contains("google mail") {
        matches.push("Gmail");
    }
    if combined.contains("filesystem") || combined.contains("file system")
        || (combined.contains("read file") && combined.contains("permission"))
        || combined.contains("fs.") {
        matches.push("Filesystem");
    }

    matches
}

/// Try to acquire the missing capability.
/// - If a matching auto-installable server exists: install it, return InstalledSilently
/// - If a matching server requires credentials: emit suggestion event, return SuggestionEmitted
/// - Otherwise: return NothingFound
pub async fn try_acquire(
    app: &tauri::AppHandle,
    gap: GapContext<'_>,
    mcp_state: &crate::commands::SharedMcpManager,
) -> AutoskillResult {
    let candidates = keywords_to_catalog_name(gap.missing_capability, gap.error);
    if candidates.is_empty() {
        return AutoskillResult::NothingFound;
    }

    // Load evolution catalog entries to find matching ones
    let catalog = build_installable_catalog();

    for candidate_name in &candidates {
        if let Some(entry) = catalog.get(candidate_name) {
            let _ = app.emit(
                "autoskill_attempting",
                serde_json::json!({
                    "name": candidate_name,
                    "reason": gap.missing_capability,
                }),
            );

            if entry.auto_install {
                // Install silently
                let config = crate::mcp::McpServerConfig {
                    command: entry.command.to_string(),
                    args: entry.args.iter().map(|s| s.to_string()).collect(),
                    env: HashMap::new(),
                };

                // Persist to config
                let mut saved = crate::config::load_config();
                saved.mcp_servers.retain(|s| s.name != *candidate_name);
                saved.mcp_servers.push(crate::config::SavedMcpServerConfig {
                    name: candidate_name.to_string(),
                    command: entry.command.to_string(),
                    args: entry.args.iter().map(|s| s.to_string()).collect(),
                    env: HashMap::new(),
                });
                if crate::config::save_config(&saved).is_ok() {
                    let mut manager = mcp_state.lock().await;
                    manager.register_server(candidate_name.to_string(), config);
                    if let Ok(tools) = manager.discover_all_tools().await {
                        let tool_count = tools.len();
                        let _ = app.emit(
                            "autoskill_installed",
                            serde_json::json!({
                                "name": candidate_name,
                                "tool_count": tool_count,
                                "message": format!(
                                    "Automatically installed {} — {} tools now available. Retrying your request.",
                                    candidate_name, tool_count
                                ),
                            }),
                        );
                        return AutoskillResult::InstalledSilently {
                            name: candidate_name.to_string(),
                            tool_count,
                        };
                    }
                }
            } else {
                // Needs credentials — surface suggestion
                let _ = app.emit(
                    "autoskill_suggestion",
                    serde_json::json!({
                        "name": candidate_name,
                        "description": entry.description,
                        "credential_hint": entry.required_token_hint,
                        "user_request": gap.user_request,
                        "message": format!(
                            "To do this I need {}, but it requires credentials. Click to configure → {}",
                            candidate_name,
                            entry.required_token_hint.unwrap_or("check settings")
                        ),
                    }),
                );
                return AutoskillResult::SuggestionEmitted {
                    name: candidate_name.to_string(),
                };
            }
        }
    }

    AutoskillResult::NothingFound
}

struct InstallableEntry {
    command: &'static str,
    args: &'static [&'static str],
    description: &'static str,
    required_token_hint: Option<&'static str>,
    auto_install: bool,
}

fn build_installable_catalog() -> HashMap<&'static str, InstallableEntry> {
    let mut m = HashMap::new();
    m.insert("Browser Automation (Puppeteer)", InstallableEntry {
        command: "npx",
        args: &["-y", "@modelcontextprotocol/server-puppeteer"],
        description: "Control the browser, scrape pages, fill forms from BLADE",
        required_token_hint: None,
        auto_install: true,
    });
    m.insert("GitHub", InstallableEntry {
        command: "npx",
        args: &["-y", "@modelcontextprotocol/server-github"],
        description: "Read/write repos, issues, PRs from BLADE",
        required_token_hint: Some("GITHUB_PERSONAL_ACCESS_TOKEN"),
        auto_install: false,
    });
    m.insert("Slack", InstallableEntry {
        command: "npx",
        args: &["-y", "@modelcontextprotocol/server-slack"],
        description: "Read and send Slack messages from BLADE",
        required_token_hint: Some("SLACK_BOT_TOKEN"),
        auto_install: false,
    });
    m.insert("Notion", InstallableEntry {
        command: "npx",
        args: &["-y", "@notionhq/notion-mcp-server"],
        description: "Create and search Notion pages from BLADE",
        required_token_hint: Some("NOTION_API_TOKEN"),
        auto_install: false,
    });
    m.insert("Linear", InstallableEntry {
        command: "npx",
        args: &["-y", "@linear/mcp-server"],
        description: "Create and update Linear issues from BLADE",
        required_token_hint: Some("LINEAR_API_KEY"),
        auto_install: false,
    });
    m.insert("Figma", InstallableEntry {
        command: "npx",
        args: &["-y", "figma-mcp"],
        description: "Read Figma designs and tokens from BLADE",
        required_token_hint: Some("FIGMA_API_TOKEN"),
        auto_install: false,
    });
    m.insert("Jira / Confluence", InstallableEntry {
        command: "npx",
        args: &["-y", "@anthropic-labs/mcp-server-atlassian"],
        description: "Manage Jira tickets and Confluence docs from BLADE",
        required_token_hint: Some("JIRA_EMAIL + JIRA_API_TOKEN + JIRA_BASE_URL"),
        auto_install: false,
    });
    m.insert("PostgreSQL", InstallableEntry {
        command: "npx",
        args: &["-y", "@modelcontextprotocol/server-postgres"],
        description: "Query PostgreSQL from BLADE",
        required_token_hint: Some("DATABASE_URL"),
        auto_install: false,
    });
    m.insert("Supabase", InstallableEntry {
        command: "npx",
        args: &["-y", "@supabase/mcp-server-supabase"],
        description: "Query Supabase from BLADE",
        required_token_hint: Some("SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY"),
        auto_install: false,
    });
    m.insert("Vercel", InstallableEntry {
        command: "npx",
        args: &["-y", "@vercel/mcp-adapter"],
        description: "Manage Vercel deployments from BLADE",
        required_token_hint: Some("VERCEL_TOKEN"),
        auto_install: false,
    });
    m.insert("Obsidian", InstallableEntry {
        command: "npx",
        args: &["-y", "mcp-obsidian"],
        description: "Read/write Obsidian vault notes from BLADE",
        required_token_hint: None,
        auto_install: true,
    });
    m.insert("Spotify", InstallableEntry {
        command: "npx",
        args: &["-y", "spotify-mcp"],
        description: "Control Spotify from BLADE",
        required_token_hint: Some("SPOTIFY_CLIENT_ID + SPOTIFY_CLIENT_SECRET"),
        auto_install: false,
    });
    m.insert("Google Calendar", InstallableEntry {
        command: "npx",
        args: &["-y", "@google/calendar-mcp"],
        description: "Create and read Google Calendar events from BLADE",
        required_token_hint: Some("GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET (OAuth)"),
        auto_install: false,
    });
    m.insert("Gmail", InstallableEntry {
        command: "npx",
        args: &["-y", "@google/gmail-mcp"],
        description: "Read and send Gmail from BLADE",
        required_token_hint: Some("GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET (OAuth)"),
        auto_install: false,
    });
    m.insert("Filesystem", InstallableEntry {
        command: "npx",
        args: &["-y", "@modelcontextprotocol/server-filesystem", "--allowed-directories", "."],
        description: "Extended filesystem access via MCP",
        required_token_hint: None,
        auto_install: true,
    });
    m
}
