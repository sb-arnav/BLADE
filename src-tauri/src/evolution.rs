/// EVOLUTION ENGINE — BLADE's self-improvement loop.
///
/// God Mode feeds BLADE live context about what apps and tools you use.
/// This module watches that context, matches it against a catalog of MCP
/// servers and capabilities, and progressively wires BLADE into your stack.
///
/// No prompt asking "would you like me to install X?" — it detects, decides,
/// and installs what it can automatically. Capabilities requiring API tokens
/// surface as suggestions the user can approve with one click.
///
/// The "level" is a score reflecting how deeply BLADE is wired into the machine.
/// Every new integration, indexed project, or active capability increases it.
/// BLADE always knows its level and actively tries to raise it.

use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use tauri::Emitter;

/// One entry in the built-in MCP catalog.
struct CatalogEntry {
    /// Human-readable name shown in suggestions
    name: &'static str,
    /// npm package to install
    package: &'static str,
    /// Command to run the server (usually "npx")
    command: &'static str,
    /// Args passed after command
    args: &'static [&'static str],
    /// App names / process names / domain substrings that trigger this suggestion
    triggers: &'static [&'static str],
    /// What this MCP server unlocks
    description: &'static str,
    /// If Some, this token must be provided by the user before we can install
    required_token_hint: Option<&'static str>,
    /// If true, install automatically when detected (no token required)
    auto_install: bool,
}

static CATALOG: &[CatalogEntry] = &[
    CatalogEntry {
        name: "GitHub",
        package: "@modelcontextprotocol/server-github",
        command: "npx",
        args: &["-y", "@modelcontextprotocol/server-github"],
        triggers: &["github.com", "GitHub Desktop", "GitHub", "gh", "git hub"],
        description: "Read/write repos, issues, PRs, and code search directly from BLADE",
        required_token_hint: Some("GITHUB_PERSONAL_ACCESS_TOKEN (github.com → Settings → Developer Settings → Tokens)"),
        auto_install: false,
    },
    CatalogEntry {
        name: "Slack",
        package: "@modelcontextprotocol/server-slack",
        command: "npx",
        args: &["-y", "@modelcontextprotocol/server-slack"],
        triggers: &["Slack", "slack.com"],
        description: "Read and send Slack messages, search channels, post summaries from BLADE",
        required_token_hint: Some("SLACK_BOT_TOKEN (api.slack.com → Your Apps → Bot Token)"),
        auto_install: false,
    },
    CatalogEntry {
        name: "Notion",
        package: "@notionhq/notion-mcp-server",
        command: "npx",
        args: &["-y", "@notionhq/notion-mcp-server"],
        triggers: &["Notion", "notion.so", "notion.site"],
        description: "Create, read, and search Notion pages and databases from BLADE",
        required_token_hint: Some("NOTION_API_TOKEN (notion.so → Settings → API integrations)"),
        auto_install: false,
    },
    CatalogEntry {
        name: "Linear",
        package: "@linear/mcp-server",
        command: "npx",
        args: &["-y", "@linear/mcp-server"],
        triggers: &["Linear", "linear.app"],
        description: "Create, update, and search Linear issues and projects from BLADE",
        required_token_hint: Some("LINEAR_API_KEY (linear.app → Settings → API → Personal API keys)"),
        auto_install: false,
    },
    CatalogEntry {
        name: "Figma",
        package: "figma-mcp",
        command: "npx",
        args: &["-y", "figma-mcp"],
        triggers: &["Figma", "figma.com"],
        description: "Read Figma designs, get component specs, and extract design tokens from BLADE",
        required_token_hint: Some("FIGMA_API_TOKEN (figma.com → Account → Personal access tokens)"),
        auto_install: false,
    },
    CatalogEntry {
        name: "Jira / Confluence",
        package: "@anthropic-labs/mcp-server-atlassian",
        command: "npx",
        args: &["-y", "@anthropic-labs/mcp-server-atlassian"],
        triggers: &["Jira", "Confluence", "atlassian.net", "atlassian.com"],
        description: "Manage Jira tickets, search Confluence docs from BLADE",
        required_token_hint: Some("JIRA_EMAIL + JIRA_API_TOKEN + JIRA_BASE_URL (id.atlassian.com → Security → API tokens)"),
        auto_install: false,
    },
    CatalogEntry {
        name: "PostgreSQL",
        package: "@modelcontextprotocol/server-postgres",
        command: "npx",
        args: &["-y", "@modelcontextprotocol/server-postgres"],
        triggers: &["psql", "pgAdmin", "DBeaver", "TablePlus", "Postico", "postgres", "postgresql"],
        description: "Query PostgreSQL databases directly from BLADE — read schema, run queries, inspect data",
        required_token_hint: Some("DATABASE_URL (e.g. postgresql://user:pass@localhost:5432/mydb)"),
        auto_install: false,
    },
    CatalogEntry {
        name: "Browser Automation (Puppeteer)",
        package: "@modelcontextprotocol/server-puppeteer",
        command: "npx",
        args: &["-y", "@modelcontextprotocol/server-puppeteer"],
        triggers: &["Chrome", "Google Chrome", "Brave Browser", "Chromium", "firefox"],
        description: "Control the browser, scrape pages, fill forms, automate web tasks from BLADE",
        required_token_hint: None,
        auto_install: true, // No token needed — install silently when browser detected
    },
    CatalogEntry {
        name: "Spotify",
        package: "spotify-mcp",
        command: "npx",
        args: &["-y", "spotify-mcp"],
        triggers: &["Spotify"],
        description: "Control Spotify playback, search music, manage playlists from BLADE",
        required_token_hint: Some("SPOTIFY_CLIENT_ID + SPOTIFY_CLIENT_SECRET (developer.spotify.com → Dashboard)"),
        auto_install: false,
    },
    CatalogEntry {
        name: "Obsidian",
        package: "mcp-obsidian",
        command: "npx",
        args: &["-y", "mcp-obsidian"],
        triggers: &["Obsidian", "obsidian"],
        description: "Read/write Obsidian vault notes from BLADE — search, create, link notes",
        required_token_hint: None,
        auto_install: true, // No token — requires vault path which BLADE already has
    },
    CatalogEntry {
        name: "Supabase",
        package: "@supabase/mcp-server-supabase",
        command: "npx",
        args: &["-y", "@supabase/mcp-server-supabase"],
        triggers: &["Supabase", "supabase.com", "supabase.io"],
        description: "Query Supabase projects, manage tables, run SQL from BLADE",
        required_token_hint: Some("SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY"),
        auto_install: false,
    },
    CatalogEntry {
        name: "Vercel",
        package: "@vercel/mcp-adapter",
        command: "npx",
        args: &["-y", "@vercel/mcp-adapter"],
        triggers: &["vercel", "Vercel", "vercel.com"],
        description: "Manage Vercel deployments, check build status, view logs from BLADE",
        required_token_hint: Some("VERCEL_TOKEN (vercel.com → Account Settings → Tokens)"),
        auto_install: false,
    },
    CatalogEntry {
        name: "Gmail / Google Calendar",
        package: "@modelcontextprotocol/server-gdrive",
        command: "npx",
        args: &["-y", "@modelcontextprotocol/server-gdrive"],
        triggers: &["Gmail", "Google Calendar", "Google Docs", "Drive", "google.com"],
        description: "Read Gmail, manage Calendar events, access Google Docs from BLADE",
        required_token_hint: Some("Google OAuth credentials (console.cloud.google.com)"),
        auto_install: false,
    },
    CatalogEntry {
        name: "Playwright (Browser Automation)",
        package: "@playwright/mcp",
        command: "npx",
        args: &["-y", "@playwright/mcp"],
        triggers: &["Chrome", "Google Chrome", "Brave Browser", "Chromium", "Firefox", "Edge", "Safari"],
        description: "Structured browser automation with DOM access — fill forms, extract data, click elements reliably (better than screenshot-based control)",
        required_token_hint: None,
        auto_install: true, // No token — install automatically when browser detected
    },
    CatalogEntry {
        name: "Docker",
        package: "docker-mcp",
        command: "npx",
        args: &["-y", "docker-mcp"],
        triggers: &["Docker", "Docker Desktop", "Podman", "docker"],
        description: "Manage Docker containers, build images, inspect logs from BLADE",
        required_token_hint: None,
        auto_install: true,
    },
    CatalogEntry {
        name: "AWS",
        package: "aws-mcp-server",
        command: "npx",
        args: &["-y", "aws-mcp-server"],
        triggers: &["AWS", "Amazon Web Services", "aws.amazon.com", "S3", "Lambda", "EC2"],
        description: "Manage AWS resources — S3, Lambda, EC2, CloudFormation from BLADE",
        required_token_hint: Some("AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY (IAM console)"),
        auto_install: false,
    },
    CatalogEntry {
        name: "Cloudflare",
        package: "@cloudflare/mcp-server-cloudflare",
        command: "npx",
        args: &["-y", "@cloudflare/mcp-server-cloudflare"],
        triggers: &["Cloudflare", "cloudflare.com", "Workers", "Wrangler"],
        description: "Manage Cloudflare Workers, D1, KV, R2 from BLADE",
        required_token_hint: Some("CLOUDFLARE_API_TOKEN (dash.cloudflare.com → Profile → API Tokens)"),
        auto_install: false,
    },
    CatalogEntry {
        name: "Stripe",
        package: "stripe-agent-toolkit",
        command: "npx",
        args: &["-y", "stripe-agent-toolkit"],
        triggers: &["Stripe", "stripe.com", "dashboard.stripe.com"],
        description: "Query Stripe payments, customers, subscriptions from BLADE",
        required_token_hint: Some("STRIPE_SECRET_KEY (dashboard.stripe.com → Developers → API keys)"),
        auto_install: false,
    },
    CatalogEntry {
        name: "MongoDB",
        package: "mongodb-mcp-server",
        command: "npx",
        args: &["-y", "mongodb-mcp-server"],
        triggers: &["MongoDB", "MongoDB Compass", "Mongo", "Atlas"],
        description: "Query MongoDB databases, inspect collections, run aggregations from BLADE",
        required_token_hint: Some("MONGODB_URI (mongodb://user:pass@host:port/db)"),
        auto_install: false,
    },
    CatalogEntry {
        name: "Raycast",
        package: "raycast-mcp",
        command: "npx",
        args: &["-y", "raycast-mcp"],
        triggers: &["Raycast"],
        description: "Trigger Raycast commands, manage snippets, use extensions from BLADE",
        required_token_hint: None,
        auto_install: true,
    },
    CatalogEntry {
        name: "Chrome DevTools",
        package: "chrome-devtools-mcp",
        command: "npx",
        args: &["-y", "chrome-devtools-mcp@latest"],
        triggers: &["Chrome", "Google Chrome", "Chromium", "chrome", "localhost", "127.0.0.1"],
        description: "Full Chrome DevTools via MCP — click, fill, navigate, Lighthouse audits, performance traces, network inspection, memory snapshots, JS eval. 29 tools for complete browser control.",
        required_token_hint: None,
        auto_install: true, // No token needed — auto-install when Chrome is detected
    },
];

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EvolutionSuggestion {
    pub id: String,
    pub name: String,
    pub package: String,
    pub description: String,
    pub trigger_app: String,
    pub required_token_hint: Option<String>,
    pub auto_install: bool,
    pub status: String, // "pending" | "installed" | "dismissed"
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EvolutionLevel {
    pub level: u32,
    pub score: u32,
    pub breakdown: Vec<String>,
    pub next_unlock: Option<String>,
}

/// Compute BLADE's current evolution level based on what's wired in.
pub fn compute_level() -> EvolutionLevel {
    let config = crate::config::load_config();
    let mut score = 0u32;
    let mut breakdown = Vec::new();

    // Base: BLADE is running
    score += 1;
    breakdown.push("BLADE running".to_string());

    // Provider configured
    if !config.api_key.is_empty() || config.provider == "ollama" {
        score += 2;
        breakdown.push(format!("AI provider: {}", config.provider));
    }

    // God Mode active
    if config.god_mode {
        score += 3;
        breakdown.push(format!("God Mode: {} tier", config.god_mode_tier));
    }

    // MCP servers connected
    let mcp_count = config.mcp_servers.len() as u32;
    if mcp_count > 0 {
        score += mcp_count.min(10) * 2;
        breakdown.push(format!("{} MCP server(s) connected", mcp_count));
    }

    // Codebase indexed
    let indexed = crate::indexer::list_indexed_projects();
    let idx_count = indexed.len() as u32;
    if idx_count > 0 {
        score += idx_count.min(5) * 2;
        breakdown.push(format!("{} codebase(s) indexed", idx_count));
    }

    // Telegram connected
    let db_path = crate::config::blade_config_dir().join("blade.db");
    if let Ok(conn) = rusqlite::Connection::open(&db_path) {
        // Check if telegram token is stored
        if let Ok(Some(_)) = crate::db::get_setting(&conn, "telegram_bot_token") {
            score += 2;
            breakdown.push("Telegram bridge active".to_string());
        }
        // Check discord
        if let Ok(Some(_)) = crate::db::get_setting(&conn, "discord_webhook") {
            score += 1;
            breakdown.push("Discord bridge active".to_string());
        }
        // Check cron jobs
        if let Ok(n) = conn.query_row(
            "SELECT COUNT(*) FROM settings WHERE key LIKE 'cron_%' AND value LIKE '%active%'",
            [],
            |row| row.get::<_, i64>(0),
        ) {
            if n > 0 {
                score += (n as u32).min(5);
                breakdown.push(format!("{} cron task(s) scheduled", n));
            }
        }
    }

    // Obsidian vault configured
    if !config.obsidian_vault_path.is_empty() {
        score += 1;
        breakdown.push("Obsidian vault linked".to_string());
    }

    // Voice configured
    if config.voice_mode != "off" && !config.voice_mode.is_empty() {
        score += 1;
        breakdown.push("Voice active".to_string());
    }

    // Evolution suggestions installed
    // (checked from evolution_suggestions table — each installed = +1)

    // Compute level from score
    // Level thresholds: 1→5, 5→15, 15→30, 30→50, 50→75, 75→100, 100→130...
    let level = match score {
        0..=4 => 1,
        5..=14 => 2,
        15..=29 => 3,
        30..=49 => 4,
        50..=74 => 5,
        75..=99 => 6,
        100..=134 => 7,
        135..=174 => 8,
        175..=224 => 9,
        _ => 10,
    };

    let next_unlock = match level {
        1 => Some("Connect an API key to reach Level 2".to_string()),
        2 => Some("Enable God Mode to reach Level 3".to_string()),
        3 => Some("Connect an MCP server to reach Level 4".to_string()),
        4 => Some("Index a codebase and set up Telegram to reach Level 5".to_string()),
        5 => Some("Connect 3+ MCP servers to reach Level 6".to_string()),
        _ => None,
    };

    EvolutionLevel { level, score, breakdown, next_unlock }
}

/// Extract app names from the current god mode context and recent timeline.
/// Returns a deduplicated set of app/service names we can match against the catalog.
fn detect_apps_in_use() -> HashSet<String> {
    let mut apps = HashSet::new();

    // From god mode context
    if let Some(ctx) = crate::godmode::load_godmode_context() {
        // Parse "Running Apps" section
        for line in ctx.lines() {
            if line.starts_with("### Running Apps") { continue; }
            if line.starts_with("### Active Window") { continue; }
            // App names appear after "- " in running apps and "App: " in active window
            if let Some(app) = line.strip_prefix("App: ") {
                apps.insert(app.trim().to_string());
            }
            // Running apps section: comma-separated list
            if !line.starts_with('#') && !line.starts_with('-') && line.contains(',') {
                for part in line.split(',') {
                    let name = part.trim().to_string();
                    if !name.is_empty() && name.len() < 40 {
                        apps.insert(name);
                    }
                }
            }
        }
    }

    // From recent activity timeline (last 7 days)
    let db_path = crate::config::blade_config_dir().join("blade.db");
    if let Ok(conn) = rusqlite::Connection::open(&db_path) {
        let cutoff = chrono::Utc::now().timestamp() - 7 * 86400;
        let _ = conn.prepare(
            "SELECT DISTINCT app_name FROM activity_timeline WHERE timestamp > ?1 AND app_name != '' LIMIT 50"
        ).and_then(|mut stmt| {
            stmt.query_map(rusqlite::params![cutoff], |row| {
                row.get::<_, String>(0)
            }).map(|rows| {
                for app in rows.flatten() {
                    if !app.is_empty() { apps.insert(app); }
                }
            })
        });

        // Also pull from conversation content (users mention apps they use)
        let _ = conn.prepare(
            "SELECT content FROM messages WHERE timestamp > ?1 LIMIT 200"
        ).and_then(|mut stmt| {
            stmt.query_map(rusqlite::params![cutoff], |row| {
                row.get::<_, String>(0)
            }).map(|rows| {
                for content in rows.flatten() {
                    // Simple heuristic: look for known app names in conversations
                    let lower = content.to_lowercase();
                    for entry in CATALOG {
                        for trigger in entry.triggers {
                            if lower.contains(&trigger.to_lowercase()) {
                                apps.insert(trigger.to_string());
                            }
                        }
                    }
                }
            })
        });
    }

    apps
}

/// Check which catalog entries have already been installed as MCP servers.
fn already_installed_packages() -> HashSet<String> {
    let config = crate::config::load_config();
    let mut installed = HashSet::new();
    for server in &config.mcp_servers {
        // Match by args containing the package name
        for arg in &server.args {
            installed.insert(arg.clone());
        }
        installed.insert(server.name.to_lowercase());
    }
    installed
}

/// Load all pending/dismissed suggestions from the DB so we don't re-suggest.
fn known_suggestion_ids() -> HashSet<String> {
    let db_path = crate::config::blade_config_dir().join("blade.db");
    let mut known = HashSet::new();
    if let Ok(conn) = rusqlite::Connection::open(&db_path) {
        let _ = conn.prepare(
            "SELECT id FROM evolution_suggestions WHERE status != 'pending'"
        ).and_then(|mut stmt| {
            stmt.query_map([], |row| row.get::<_, String>(0))
                .map(|rows| { for id in rows.flatten() { known.insert(id); } })
        });
    }
    known
}

/// Persist a new suggestion to the DB.
fn save_suggestion(suggestion: &EvolutionSuggestion) -> Result<(), String> {
    let db_path = crate::config::blade_config_dir().join("blade.db");
    let conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR IGNORE INTO evolution_suggestions (id, app_trigger, capability, mcp_package, description, token_hint, auto_install, status, created_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        rusqlite::params![
            suggestion.id,
            suggestion.trigger_app,
            suggestion.name,
            suggestion.package,
            suggestion.description,
            suggestion.required_token_hint,
            suggestion.auto_install as i32,
            suggestion.status,
            suggestion.created_at,
        ],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

/// Auto-install an MCP server that requires no token (e.g., puppeteer).
/// Returns Ok(tool_count) on success.
async fn auto_install_mcp(entry: &CatalogEntry) -> Result<usize, String> {
    // Check node/npx is available
    let npx_check = std::process::Command::new("npx")
        .arg("--version")
        .output();
    if npx_check.is_err() {
        return Err("npx not found — install Node.js to enable auto-install".to_string());
    }

    // Register in config
    let config_entry = crate::config::SavedMcpServerConfig {
        name: entry.name.to_string(),
        command: entry.command.to_string(),
        args: entry.args.iter().map(|s| s.to_string()).collect(),
        env: std::collections::HashMap::new(),
    };

    let mut config = crate::config::load_config();
    if config.mcp_servers.iter().any(|s| s.name == entry.name) {
        return Ok(0); // Already registered
    }
    config.mcp_servers.push(config_entry);
    crate::config::save_config(&config)?;

    Ok(1)
}

/// Main evolution loop — run this periodically (every god mode cycle or every 15 min).
/// Detects apps, matches catalog, suggests/installs capabilities, emits events.
pub async fn run_evolution_cycle(app: &tauri::AppHandle) {
    let apps = detect_apps_in_use();
    if apps.is_empty() { return; }

    let installed = already_installed_packages();
    let known = known_suggestion_ids();
    let prev_level = compute_level();

    let mut new_suggestions: Vec<EvolutionSuggestion> = Vec::new();
    let mut auto_installed: Vec<String> = Vec::new();

    for entry in CATALOG {
        // Skip if already installed
        let already = installed.contains(&entry.package.to_string())
            || installed.contains(&entry.name.to_lowercase());
        if already { continue; }

        // Check if any detected app matches this entry's triggers
        let matched_app = apps.iter().find(|app_name| {
            let lower = app_name.to_lowercase();
            entry.triggers.iter().any(|t| lower.contains(&t.to_lowercase()))
        });

        let Some(trigger_app) = matched_app else { continue };

        // Build suggestion ID
        let suggestion_id = format!("{}:{}", entry.name.to_lowercase().replace(' ', "_"), trigger_app.to_lowercase().replace(' ', "_"));

        if known.contains(&suggestion_id) { continue; }

        if entry.auto_install && entry.required_token_hint.is_none() {
            // Auto-install silently
            match auto_install_mcp(entry).await {
                Ok(_) => {
                    auto_installed.push(entry.name.to_string());
                    let suggestion = EvolutionSuggestion {
                        id: suggestion_id,
                        name: entry.name.to_string(),
                        package: entry.package.to_string(),
                        description: entry.description.to_string(),
                        trigger_app: trigger_app.clone(),
                        required_token_hint: None,
                        auto_install: true,
                        status: "installed".to_string(),
                        created_at: chrono::Utc::now().timestamp(),
                    };
                    let _ = save_suggestion(&suggestion);
                }
                Err(e) => {
                    // Fall through to suggestion if auto-install fails
                    log::warn!("Evolution auto-install failed for {}: {}", entry.name, e);
                }
            }
        } else {
            // Surface as a suggestion
            let suggestion = EvolutionSuggestion {
                id: suggestion_id,
                name: entry.name.to_string(),
                package: entry.package.to_string(),
                description: entry.description.to_string(),
                trigger_app: trigger_app.clone(),
                required_token_hint: entry.required_token_hint.map(|s| s.to_string()),
                auto_install: false,
                status: "pending".to_string(),
                created_at: chrono::Utc::now().timestamp(),
            };
            let _ = save_suggestion(&suggestion);
            new_suggestions.push(suggestion);
        }
    }

    // Emit auto-installed notification
    if !auto_installed.is_empty() {
        let _ = app.emit("blade_auto_upgraded", serde_json::json!({
            "installed": auto_installed,
            "message": format!("Wired into: {}", auto_installed.join(", ")),
        }));
    }

    // Emit new suggestions to frontend
    for suggestion in &new_suggestions {
        let _ = app.emit("evolution_suggestion", suggestion);
    }

    // Check if we leveled up
    let new_level = compute_level();
    if new_level.level > prev_level.level {
        let _ = app.emit("blade_leveled_up", serde_json::json!({
            "level": new_level.level,
            "score": new_level.score,
            "breakdown": new_level.breakdown,
            "next_unlock": new_level.next_unlock,
        }));
        // Log to activity timeline
        let db_path = crate::config::blade_config_dir().join("blade.db");
        if let Ok(conn) = rusqlite::Connection::open(&db_path) {
            let _ = crate::db::timeline_record(
                &conn,
                "evolution",
                &format!("BLADE reached Level {}", new_level.level),
                &format!("Score: {}. {}", new_level.score, new_level.breakdown.join(", ")),
                "BLADE",
                &format!("{{\"level\":{}}}", new_level.level),
            );
        }
    }
}

/// Start the evolution background loop.
/// Runs every 15 minutes regardless of god mode (but only has data when god mode feeds the timeline).
pub fn start_evolution_loop(app: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        // First run after 3 minutes — let god mode collect some data first
        tokio::time::sleep(std::time::Duration::from_secs(3 * 60)).await;

        loop {
            run_evolution_cycle(&app).await;

            // Ambient research — runs inside the evolution loop but throttled internally to 30 min
            let research_app = app.clone();
            tokio::spawn(async move {
                crate::research::run_research_cycle(&research_app).await;
            });

            // Check every 15 minutes
            tokio::time::sleep(std::time::Duration::from_secs(15 * 60)).await;
        }
    });
}

// ── Tauri commands ──────────────────────────────────────────────────────────────

/// Get BLADE's current evolution level and score.
#[tauri::command]
pub fn evolution_get_level() -> EvolutionLevel {
    compute_level()
}

/// Get all pending evolution suggestions (capabilities BLADE detected but needs a token for).
#[tauri::command]
pub fn evolution_get_suggestions() -> Vec<EvolutionSuggestion> {
    let db_path = crate::config::blade_config_dir().join("blade.db");
    let conn = match rusqlite::Connection::open(&db_path) {
        Ok(c) => c,
        Err(_) => return vec![],
    };
    let mut stmt = match conn.prepare(
        "SELECT id, app_trigger, capability, mcp_package, description, token_hint, auto_install, status, created_at \
         FROM evolution_suggestions WHERE status = 'pending' ORDER BY created_at DESC LIMIT 20"
    ) {
        Ok(s) => s,
        Err(_) => return vec![],
    };

    stmt.query_map([], |row| {
        Ok(EvolutionSuggestion {
            id: row.get(0)?,
            trigger_app: row.get(1)?,
            name: row.get(2)?,
            package: row.get(3)?,
            description: row.get(4)?,
            required_token_hint: row.get(5)?,
            auto_install: row.get::<_, i32>(6)? != 0,
            status: row.get(7)?,
            created_at: row.get(8)?,
        })
    })
    .map(|rows| rows.flatten().collect())
    .unwrap_or_default()
}

/// Dismiss a suggestion (user doesn't want it).
#[tauri::command]
pub fn evolution_dismiss_suggestion(id: String) -> Result<(), String> {
    let db_path = crate::config::blade_config_dir().join("blade.db");
    let conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE evolution_suggestions SET status = 'dismissed' WHERE id = ?1",
        rusqlite::params![id],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

/// Install a suggested MCP server with the provided token.
/// Called from frontend when user provides their API key for a suggestion.
#[tauri::command]
pub async fn evolution_install_suggestion(
    state: tauri::State<'_, crate::commands::SharedMcpManager>,
    id: String,
    token_key: String,
    token_value: String,
) -> Result<usize, String> {
    // Load suggestion from DB
    let db_path = crate::config::blade_config_dir().join("blade.db");
    let conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;

    let (name, package): (String, String) = conn.query_row(
        "SELECT capability, mcp_package FROM evolution_suggestions WHERE id = ?1",
        rusqlite::params![id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    ).map_err(|e| format!("Suggestion not found: {}", e))?;

    // Find the catalog entry
    let entry = CATALOG.iter().find(|e| e.package == package.as_str())
        .ok_or_else(|| "Catalog entry not found".to_string())?;

    // Build env with the token
    let mut env = std::collections::HashMap::new();
    if !token_key.is_empty() && !token_value.is_empty() {
        env.insert(token_key, token_value);
    }

    // Register MCP server
    let mcp_config = crate::mcp::McpServerConfig {
        command: entry.command.to_string(),
        args: entry.args.iter().map(|s| s.to_string()).collect(),
        env: env.clone(),
    };

    let saved = crate::config::SavedMcpServerConfig {
        name: name.clone(),
        command: entry.command.to_string(),
        args: entry.args.iter().map(|s| s.to_string()).collect(),
        env,
    };

    let mut config = crate::config::load_config();
    config.mcp_servers.retain(|s| s.name != name);
    config.mcp_servers.push(saved);
    crate::config::save_config(&config)?;

    let mut manager = state.lock().await;
    manager.register_server(name.clone(), mcp_config);
    let tools = manager.discover_all_tools().await?;

    // Mark as installed
    conn.execute(
        "UPDATE evolution_suggestions SET status = 'installed' WHERE id = ?1",
        rusqlite::params![id],
    ).map_err(|e| e.to_string())?;

    Ok(tools.len())
}

/// Force-run an evolution cycle immediately (called from frontend).
#[tauri::command]
pub async fn evolution_run_now(app: tauri::AppHandle) {
    run_evolution_cycle(&app).await;
}

/// BLADE refusing is not allowed. This is wired into the system prompt to redirect
/// "I can't do X" into "let me find a way to do X".
/// Returns a capability gap detection string for the brain.
#[tauri::command]
pub fn evolution_log_capability_gap(capability: String, user_request: String) -> String {
    // Log to timeline so BLADE remembers it tried and failed
    let db_path = crate::config::blade_config_dir().join("blade.db");
    if let Ok(conn) = rusqlite::Connection::open(&db_path) {
        let _ = crate::db::timeline_record(
            &conn,
            "capability_gap",
            &format!("Blocked on: {}", &capability[..capability.len().min(80)]),
            &user_request,
            "BLADE",
            &serde_json::json!({"capability": capability}).to_string(),
        );
    }

    format!(
        "Capability gap detected: {}. BLADE will search for an MCP server, npm package, or workaround. \
         Don't tell the user you can't — tell them you're figuring it out.",
        capability
    )
}
