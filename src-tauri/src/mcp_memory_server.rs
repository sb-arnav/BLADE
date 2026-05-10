/// Built-in MCP memory server — exposes BLADE's brain knowledge graph as MCP tools.
///
/// This is a built-in in-process server. It doesn't spawn a child process — instead
/// it registers its tools directly with McpManager when BLADE starts.
///
/// Tools exposed:
/// - blade.memory.search   — search the knowledge graph by query
/// - blade.memory.add      — add a new fact/entity
/// - blade.memory.get_all  — get recent top entities
/// - blade.memory.relate   — link two entities

use crate::mcp::{McpContent, McpTool, McpToolResult};

pub const SERVER_NAME: &str = "blade.memory";

// v1.5.1: not currently called — dot-named tools were removed from the in-process
// registration to fix Anthropic's tool-name regex (B3). Kept around as the source
// of truth if/when we expose this as an external MCP server.
#[allow(dead_code)]
pub fn register_built_in_tools() -> Vec<McpTool> {
    vec![
        McpTool {
            name: "search".to_string(),
            qualified_name: "blade.memory.search".to_string(),
            description: "Search BLADE's knowledge graph for entities matching a query".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Search query to match against entity labels and descriptions"}
                },
                "required": ["query"]
            }),
            server_name: SERVER_NAME.to_string(),
        },
        McpTool {
            name: "add".to_string(),
            qualified_name: "blade.memory.add".to_string(),
            description: "Add a new entity (fact/concept/person) to BLADE's knowledge graph".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "label": {"type": "string", "description": "Short name or label for the entity"},
                    "node_type": {"type": "string", "description": "Type of entity (concept, person, place, event, fact, etc.)"},
                    "description": {"type": "string", "description": "Longer description or summary of the entity"}
                },
                "required": ["label"]
            }),
            server_name: SERVER_NAME.to_string(),
        },
        McpTool {
            name: "get_all".to_string(),
            qualified_name: "blade.memory.get_all".to_string(),
            description: "Get the top entities from BLADE's knowledge graph ordered by importance".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "limit": {"type": "integer", "description": "Maximum number of entities to return (default: 20)"}
                }
            }),
            server_name: SERVER_NAME.to_string(),
        },
        McpTool {
            name: "relate".to_string(),
            qualified_name: "blade.memory.relate".to_string(),
            description: "Create a relationship (edge) between two entities in BLADE's knowledge graph".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "from": {"type": "string", "description": "Label or id of the source entity"},
                    "to": {"type": "string", "description": "Label or id of the target entity"},
                    "relation": {"type": "string", "description": "Type of relationship (e.g. 'knows', 'part_of', 'related')"}
                },
                "required": ["from", "to"]
            }),
            server_name: SERVER_NAME.to_string(),
        },
    ]
}

pub async fn handle_tool_call(
    tool_name: &str,
    args: serde_json::Value,
) -> Result<McpToolResult, String> {
    match tool_name {
        "search" => handle_search(args).await,
        "add" => handle_add(args).await,
        "get_all" => handle_get_all(args).await,
        "relate" => handle_relate(args).await,
        _ => Err(format!("Unknown blade.memory tool: {}", tool_name)),
    }
}

fn ok_text(text: String) -> McpToolResult {
    McpToolResult {
        content: vec![McpContent {
            content_type: "text".to_string(),
            text: Some(text),
        }],
        is_error: false,
    }
}

fn err_text(text: String) -> McpToolResult {
    McpToolResult {
        content: vec![McpContent {
            content_type: "text".to_string(),
            text: Some(text),
        }],
        is_error: true,
    }
}

fn open_db() -> Result<rusqlite::Connection, String> {
    crate::db::init_db()
}

async fn handle_search(args: serde_json::Value) -> Result<McpToolResult, String> {
    let query = match args["query"].as_str() {
        Some(q) => q.to_string(),
        None => return Ok(err_text("Missing required parameter: query".to_string())),
    };

    let conn = match open_db() {
        Ok(c) => c,
        Err(e) => return Ok(err_text(format!("DB open error: {}", e))),
    };

    let sql = "SELECT id, label, kind, summary, mention_count \
               FROM brain_nodes \
               WHERE label LIKE '%' || ?1 || '%' OR summary LIKE '%' || ?1 || '%' \
               ORDER BY mention_count DESC LIMIT 20";

    let mut stmt = match conn.prepare(sql) {
        Ok(s) => s,
        Err(e) => return Ok(err_text(format!("DB prepare error: {}", e))),
    };

    let rows: Vec<serde_json::Value> = stmt
        .query_map(rusqlite::params![query], |row| {
            Ok(serde_json::json!({
                "id": row.get::<_, String>(0)?,
                "label": row.get::<_, String>(1)?,
                "kind": row.get::<_, String>(2)?,
                "summary": row.get::<_, String>(3)?,
                "mention_count": row.get::<_, i64>(4)?,
            }))
        })
        .map_err(|e| format!("DB query error: {}", e))?
        .filter_map(|r| r.ok())
        .collect();

    let result = serde_json::json!({ "nodes": rows, "count": rows.len() });
    Ok(ok_text(result.to_string()))
}

async fn handle_add(args: serde_json::Value) -> Result<McpToolResult, String> {
    let label = match args["label"].as_str() {
        Some(l) => l.to_string(),
        None => return Ok(err_text("Missing required parameter: label".to_string())),
    };
    let node_type = args["node_type"].as_str().unwrap_or("concept").to_string();
    let description = args["description"].as_str().unwrap_or("").to_string();

    // Use the label lowercased and slugified as the id for idempotency
    let id = label.to_lowercase().replace(' ', "_");

    let conn = match open_db() {
        Ok(c) => c,
        Err(e) => return Ok(err_text(format!("DB open error: {}", e))),
    };

    match crate::db::brain_upsert_node(&conn, &id, &label, &node_type, &description) {
        Ok(_) => Ok(ok_text(format!(
            "{{\"ok\": true, \"id\": \"{}\", \"label\": \"{}\"}}",
            id, label
        ))),
        Err(e) => Ok(err_text(format!("Failed to add entity: {}", e))),
    }
}

async fn handle_get_all(args: serde_json::Value) -> Result<McpToolResult, String> {
    let limit = args["limit"].as_i64().unwrap_or(20).max(1).min(200);

    let conn = match open_db() {
        Ok(c) => c,
        Err(e) => return Ok(err_text(format!("DB open error: {}", e))),
    };

    let sql = "SELECT id, label, kind, summary, mention_count, last_seen_at \
               FROM brain_nodes ORDER BY mention_count DESC LIMIT ?1";

    let mut stmt = match conn.prepare(sql) {
        Ok(s) => s,
        Err(e) => return Ok(err_text(format!("DB prepare error: {}", e))),
    };

    let rows: Vec<serde_json::Value> = stmt
        .query_map(rusqlite::params![limit], |row| {
            Ok(serde_json::json!({
                "id": row.get::<_, String>(0)?,
                "label": row.get::<_, String>(1)?,
                "kind": row.get::<_, String>(2)?,
                "summary": row.get::<_, String>(3)?,
                "mention_count": row.get::<_, i64>(4)?,
                "last_seen_at": row.get::<_, i64>(5)?,
            }))
        })
        .map_err(|e| format!("DB query error: {}", e))?
        .filter_map(|r| r.ok())
        .collect();

    let result = serde_json::json!({ "nodes": rows, "count": rows.len() });
    Ok(ok_text(result.to_string()))
}

async fn handle_relate(args: serde_json::Value) -> Result<McpToolResult, String> {
    let from = match args["from"].as_str() {
        Some(f) => f.to_string(),
        None => return Ok(err_text("Missing required parameter: from".to_string())),
    };
    let to = match args["to"].as_str() {
        Some(t) => t.to_string(),
        None => return Ok(err_text("Missing required parameter: to".to_string())),
    };
    let relation = args["relation"].as_str().unwrap_or("related").to_string();

    // Derive node ids the same way handle_add does (lowercase + underscore)
    let from_id = from.to_lowercase().replace(' ', "_");
    let to_id = to.to_lowercase().replace(' ', "_");
    let edge_id = format!("{}__{}__{}", from_id, relation, to_id);

    let conn = match open_db() {
        Ok(c) => c,
        Err(e) => return Ok(err_text(format!("DB open error: {}", e))),
    };

    match crate::db::brain_upsert_edge(&conn, &edge_id, &from_id, &to_id, &relation) {
        Ok(_) => Ok(ok_text(format!(
            "{{\"ok\": true, \"from\": \"{}\", \"to\": \"{}\", \"relation\": \"{}\"}}",
            from_id, to_id, relation
        ))),
        Err(e) => Ok(err_text(format!("Failed to create relation: {}", e))),
    }
}
