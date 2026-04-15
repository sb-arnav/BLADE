/// BLADE Agent Factory — NosShip-inspired "describe it, deploy it" agent generator.
///
/// User says: "Monitor #support on Slack, auto-reply using our wiki."
/// BLADE parses that into a structured AgentBlueprint, shows a preview,
/// then deploys it as a persistent Hive tentacle that polls and acts.
///
/// Blueprints are stored in blade.db `agent_blueprints` table and reloaded
/// on startup so agents survive restarts.

use rusqlite::params;
use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};

// ── Helpers ───────────────────────────────────────────────────────────────────

fn now_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn new_id() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.subsec_nanos())
        .unwrap_or(0);
    format!("agent-{:x}-{:x}", now_secs(), nanos)
}

fn open_db() -> Result<rusqlite::Connection, String> {
    let db_path = crate::config::blade_config_dir().join("blade.db");
    rusqlite::Connection::open(&db_path).map_err(|e| format!("DB open error: {e}"))
}

fn ensure_table(conn: &rusqlite::Connection) -> Result<(), String> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS agent_blueprints (
            id             TEXT PRIMARY KEY,
            name           TEXT NOT NULL,
            description    TEXT NOT NULL DEFAULT '',
            tentacle_type  TEXT NOT NULL DEFAULT 'custom',
            triggers_json  TEXT NOT NULL DEFAULT '[]',
            actions_json   TEXT NOT NULL DEFAULT '[]',
            knowledge_json TEXT NOT NULL DEFAULT '[]',
            personality    TEXT NOT NULL DEFAULT '',
            autonomy       REAL NOT NULL DEFAULT 0.5,
            active         INTEGER NOT NULL DEFAULT 0,
            created_at     INTEGER NOT NULL,
            deployed_at    INTEGER
        );",
    )
    .map_err(|e| format!("DB schema error: {e}"))
}

// ── Core types ────────────────────────────────────────────────────────────────

/// What activates this agent.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Trigger {
    Message {
        platform: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        contains: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        from: Option<String>,
    },
    Schedule {
        cron: String,
    },
    Event {
        event_type: String,
    },
    Condition {
        /// Natural-language condition; LLM evaluates it at runtime.
        check: String,
    },
}

/// What the agent does when triggered.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Action {
    Reply {
        /// true = draft for review; false = send automatically
        draft: bool,
    },
    CreateTicket {
        project: String,
    },
    NotifyUser {
        channel: String,
    },
    RunCommand {
        command: String,
    },
    CallApi {
        url: String,
        method: String,
    },
    Custom {
        /// LLM figures out the implementation from this description.
        description: String,
    },
}

/// A fully specified agent ready to deploy.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentBlueprint {
    pub id: String,
    pub name: String,
    /// User's original natural-language description.
    pub description: String,
    /// Platform category: "slack" | "discord" | "email" | "github" | "custom" | …
    pub tentacle_type: String,
    pub triggers: Vec<Trigger>,
    pub actions: Vec<Action>,
    /// Files, URLs, or memory tags the agent should consult when acting.
    pub knowledge_sources: Vec<String>,
    /// How the agent communicates (tone, style).
    pub personality: String,
    /// 0.0 = always ask for approval; 1.0 = fully autonomous.
    pub autonomy: f32,
    pub active: bool,
    pub created_at: i64,
    pub deployed_at: Option<i64>,
}

// ── LLM parse response ────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
struct LlmBlueprintSpec {
    name: String,
    tentacle_type: String,
    triggers: Vec<serde_json::Value>,
    actions: Vec<serde_json::Value>,
    knowledge_sources: Vec<String>,
    personality: String,
    autonomy: f32,
}

// ── Core logic ────────────────────────────────────────────────────────────────

/// Parse a natural-language agent description into a structured `AgentBlueprint`.
/// The LLM returns a JSON object which we validate and store.
pub async fn create_agent_from_description(description: &str) -> Result<AgentBlueprint, String> {
    let config = crate::config::load_config();
    if config.api_key.is_empty() {
        return Err("No API key configured — cannot generate agent blueprint".to_string());
    }

    let system = "You are an expert agent designer. Parse the user's description into a \
                  structured JSON agent specification. Be concise; infer sensible defaults. \
                  Respond ONLY with valid JSON — no markdown fences, no explanation.";

    let prompt = format!(
        "Parse this agent description into a JSON blueprint:\n\n\
         \"{description}\"\n\n\
         Respond ONLY with a JSON object matching this schema:\n\
         {{\n\
           \"name\": \"short agent name\",\n\
           \"tentacle_type\": \"slack|discord|email|github|custom\",\n\
           \"triggers\": [\n\
             {{\"type\":\"message\",\"platform\":\"slack\",\"contains\":\"?\",\"from\":null}}\n\
             // or {{\"type\":\"schedule\",\"cron\":\"0 9 * * *\"}}\n\
             // or {{\"type\":\"event\",\"event_type\":\"...\"}}\n\
             // or {{\"type\":\"condition\",\"check\":\"natural language\"}}\n\
           ],\n\
           \"actions\": [\n\
             {{\"type\":\"reply\",\"draft\":true}}\n\
             // or {{\"type\":\"create_ticket\",\"project\":\"...\"}}\n\
             // or {{\"type\":\"notify_user\",\"channel\":\"...\"}}\n\
             // or {{\"type\":\"run_command\",\"command\":\"...\"}}\n\
             // or {{\"type\":\"call_api\",\"url\":\"...\",\"method\":\"POST\"}}\n\
             // or {{\"type\":\"custom\",\"description\":\"...\"}}\n\
           ],\n\
           \"knowledge_sources\": [\"path/to/wiki\", \"https://...\"],\n\
           \"personality\": \"concise, friendly, professional\",\n\
           \"autonomy\": 0.5\n\
         }}"
    );

    let messages = vec![
        crate::providers::ConversationMessage::System(system.to_string()),
        crate::providers::ConversationMessage::User(prompt),
    ];
    let no_tools: Vec<crate::providers::ToolDefinition> = vec![];
    let turn = crate::providers::complete_turn(
        &config.provider,
        &config.api_key,
        &config.model,
        &messages,
        &no_tools,
        config.base_url.as_deref(),
    )
    .await
    .map_err(|e| format!("LLM call failed: {e}"))?;

    let raw = turn.content.trim().to_string();
    let json_str = extract_json(&raw)?;

    let spec: LlmBlueprintSpec = serde_json::from_str(json_str)
        .map_err(|e| format!("Failed to parse LLM blueprint JSON: {e} — raw: {}", crate::safe_slice(&raw, 400)))?;

    // Convert raw JSON trigger/action values into our enums
    let triggers = parse_triggers(&spec.triggers)?;
    let actions = parse_actions(&spec.actions)?;

    let blueprint = AgentBlueprint {
        id: new_id(),
        name: spec.name,
        description: description.to_string(),
        tentacle_type: spec.tentacle_type,
        triggers,
        actions,
        knowledge_sources: spec.knowledge_sources,
        personality: spec.personality,
        autonomy: spec.autonomy.clamp(0.0, 1.0),
        active: false,
        created_at: now_secs(),
        deployed_at: None,
    };

    // Persist (inactive) blueprint so it survives cancellation
    save_blueprint_to_db(&blueprint)?;

    Ok(blueprint)
}

/// Activate a blueprint: mark it `active`, record `deployed_at`.
/// In a real deployment this would wire up a polling loop via the Hive;
/// here we commit the active state and return the agent ID for the frontend.
pub async fn deploy_agent(blueprint: &AgentBlueprint) -> Result<String, String> {
    let conn = open_db()?;
    ensure_table(&conn)?;

    let deployed_at = now_secs();
    conn.execute(
        "UPDATE agent_blueprints SET active = 1, deployed_at = ?1 WHERE id = ?2",
        params![deployed_at, blueprint.id],
    )
    .map_err(|e| format!("DB update error: {e}"))?;

    log::info!("[AgentFactory] Deployed agent '{}' ({})", blueprint.name, blueprint.id);
    Ok(blueprint.id.clone())
}

/// Return all stored blueprints (active and inactive).
pub fn list_deployed_agents() -> Vec<AgentBlueprint> {
    match open_db() {
        Ok(conn) => {
            let _ = ensure_table(&conn);
            load_all_blueprints(&conn)
        }
        Err(e) => {
            log::warn!("[AgentFactory] Could not open DB to list agents: {e}");
            vec![]
        }
    }
}

/// Pause (deactivate) an agent without deleting its blueprint.
pub fn pause_agent(agent_id: &str) -> Result<(), String> {
    let conn = open_db()?;
    ensure_table(&conn)?;
    conn.execute(
        "UPDATE agent_blueprints SET active = 0 WHERE id = ?1",
        params![agent_id],
    )
    .map_err(|e| format!("DB update error: {e}"))?;
    log::info!("[AgentFactory] Paused agent {agent_id}");
    Ok(())
}

/// Permanently delete a blueprint.
pub fn delete_agent(agent_id: &str) -> Result<(), String> {
    let conn = open_db()?;
    ensure_table(&conn)?;
    conn.execute(
        "DELETE FROM agent_blueprints WHERE id = ?1",
        params![agent_id],
    )
    .map_err(|e| format!("DB delete error: {e}"))?;
    log::info!("[AgentFactory] Deleted agent {agent_id}");
    Ok(())
}

// ── DB helpers ────────────────────────────────────────────────────────────────

fn save_blueprint_to_db(bp: &AgentBlueprint) -> Result<(), String> {
    let conn = open_db()?;
    ensure_table(&conn)?;

    let triggers_json =
        serde_json::to_string(&bp.triggers).unwrap_or_else(|_| "[]".to_string());
    let actions_json =
        serde_json::to_string(&bp.actions).unwrap_or_else(|_| "[]".to_string());
    let knowledge_json =
        serde_json::to_string(&bp.knowledge_sources).unwrap_or_else(|_| "[]".to_string());

    conn.execute(
        "INSERT OR REPLACE INTO agent_blueprints
            (id, name, description, tentacle_type, triggers_json, actions_json,
             knowledge_json, personality, autonomy, active, created_at, deployed_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)",
        params![
            bp.id,
            bp.name,
            bp.description,
            bp.tentacle_type,
            triggers_json,
            actions_json,
            knowledge_json,
            bp.personality,
            bp.autonomy as f64,
            bp.active as i32,
            bp.created_at,
            bp.deployed_at,
        ],
    )
    .map_err(|e| format!("DB insert error: {e}"))?;

    Ok(())
}

fn load_all_blueprints(conn: &rusqlite::Connection) -> Vec<AgentBlueprint> {
    let mut stmt = match conn.prepare(
        "SELECT id, name, description, tentacle_type, triggers_json, actions_json,
                knowledge_json, personality, autonomy, active, created_at, deployed_at
         FROM agent_blueprints ORDER BY created_at DESC",
    ) {
        Ok(s) => s,
        Err(_) => return vec![],
    };

    let rows = stmt.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, String>(3)?,
            row.get::<_, String>(4)?,
            row.get::<_, String>(5)?,
            row.get::<_, String>(6)?,
            row.get::<_, String>(7)?,
            row.get::<_, f64>(8)?,
            row.get::<_, i32>(9)?,
            row.get::<_, i64>(10)?,
            row.get::<_, Option<i64>>(11)?,
        ))
    });

    let rows = match rows {
        Ok(r) => r,
        Err(_) => return vec![],
    };

    let mut out = Vec::new();
    for row in rows.flatten() {
        let triggers = serde_json::from_str::<Vec<serde_json::Value>>(&row.4)
            .ok()
            .and_then(|v| parse_triggers(&v).ok())
            .unwrap_or_default();
        let actions = serde_json::from_str::<Vec<serde_json::Value>>(&row.5)
            .ok()
            .and_then(|v| parse_actions(&v).ok())
            .unwrap_or_default();
        let knowledge_sources: Vec<String> =
            serde_json::from_str(&row.6).unwrap_or_default();

        out.push(AgentBlueprint {
            id: row.0,
            name: row.1,
            description: row.2,
            tentacle_type: row.3,
            triggers,
            actions,
            knowledge_sources,
            personality: row.7,
            autonomy: row.8 as f32,
            active: row.9 != 0,
            created_at: row.10,
            deployed_at: row.11,
        });
    }
    out
}

// ── JSON parse helpers ────────────────────────────────────────────────────────

fn extract_json(raw: &str) -> Result<&str, String> {
    if let Some(start) = raw.find('{') {
        if let Some(end) = raw.rfind('}') {
            return Ok(&raw[start..=end]);
        }
    }
    Err(format!(
        "No JSON object found in LLM response: {}",
        crate::safe_slice(raw, 200)
    ))
}

fn parse_triggers(values: &[serde_json::Value]) -> Result<Vec<Trigger>, String> {
    let mut out = Vec::new();
    for v in values {
        let t = match v.get("type").and_then(|t| t.as_str()) {
            Some("message") => Trigger::Message {
                platform: v
                    .get("platform")
                    .and_then(|p| p.as_str())
                    .unwrap_or("unknown")
                    .to_string(),
                contains: v
                    .get("contains")
                    .and_then(|c| c.as_str())
                    .filter(|s| !s.is_empty() && *s != "?")
                    .map(|s| s.to_string()),
                from: v
                    .get("from")
                    .and_then(|f| f.as_str())
                    .filter(|s| !s.is_empty())
                    .map(|s| s.to_string()),
            },
            Some("schedule") => Trigger::Schedule {
                cron: v
                    .get("cron")
                    .and_then(|c| c.as_str())
                    .unwrap_or("0 9 * * *")
                    .to_string(),
            },
            Some("event") => Trigger::Event {
                event_type: v
                    .get("event_type")
                    .and_then(|e| e.as_str())
                    .unwrap_or("unknown")
                    .to_string(),
            },
            Some("condition") => Trigger::Condition {
                check: v
                    .get("check")
                    .and_then(|c| c.as_str())
                    .unwrap_or("")
                    .to_string(),
            },
            other => {
                log::warn!("[AgentFactory] Unknown trigger type: {:?}", other);
                continue;
            }
        };
        out.push(t);
    }
    Ok(out)
}

fn parse_actions(values: &[serde_json::Value]) -> Result<Vec<Action>, String> {
    let mut out = Vec::new();
    for v in values {
        let a = match v.get("type").and_then(|t| t.as_str()) {
            Some("reply") => Action::Reply {
                draft: v.get("draft").and_then(|d| d.as_bool()).unwrap_or(true),
            },
            Some("create_ticket") => Action::CreateTicket {
                project: v
                    .get("project")
                    .and_then(|p| p.as_str())
                    .unwrap_or("")
                    .to_string(),
            },
            Some("notify_user") => Action::NotifyUser {
                channel: v
                    .get("channel")
                    .and_then(|c| c.as_str())
                    .unwrap_or("")
                    .to_string(),
            },
            Some("run_command") => Action::RunCommand {
                command: v
                    .get("command")
                    .and_then(|c| c.as_str())
                    .unwrap_or("")
                    .to_string(),
            },
            Some("call_api") => Action::CallApi {
                url: v
                    .get("url")
                    .and_then(|u| u.as_str())
                    .unwrap_or("")
                    .to_string(),
                method: v
                    .get("method")
                    .and_then(|m| m.as_str())
                    .unwrap_or("GET")
                    .to_string(),
            },
            Some("custom") => Action::Custom {
                description: v
                    .get("description")
                    .and_then(|d| d.as_str())
                    .unwrap_or("")
                    .to_string(),
            },
            other => {
                log::warn!("[AgentFactory] Unknown action type: {:?}", other);
                continue;
            }
        };
        out.push(a);
    }
    Ok(out)
}

// ── Tauri commands ────────────────────────────────────────────────────────────

/// Parse a natural-language description into a blueprint (no deployment yet).
#[tauri::command]
pub async fn factory_create_agent(description: String) -> Result<AgentBlueprint, String> {
    create_agent_from_description(&description).await
}

/// Activate a blueprint so it becomes a live agent.
#[tauri::command]
pub async fn factory_deploy_agent(blueprint: AgentBlueprint) -> Result<String, String> {
    deploy_agent(&blueprint).await
}

/// List all blueprints (active and paused).
#[tauri::command]
pub fn factory_list_agents() -> Vec<AgentBlueprint> {
    list_deployed_agents()
}

/// Pause an active agent (keeps the blueprint).
#[tauri::command]
pub fn factory_pause_agent(agent_id: String) -> Result<(), String> {
    pause_agent(&agent_id)
}

/// Permanently delete an agent blueprint.
#[tauri::command]
pub fn factory_delete_agent(agent_id: String) -> Result<(), String> {
    delete_agent(&agent_id)
}
