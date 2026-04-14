/// KNOWLEDGE GRAPH — BLADE's semantic concept network.
///
/// Connects concepts across everything BLADE knows: conversation history,
/// documents, goals, memories, research findings. When you ask about
/// "machine learning", BLADE traverses the graph to find related notes,
/// past conversations about it, documents you've read, and goals that depend on it.
///
/// Architecture:
/// - Nodes: concepts (technology, person, project, place, event) with importance scores
/// - Edges: typed relations (is_a, part_of, related_to, depends_on, contradicts, enables, used_by)
/// - BFS traversal with depth and relation type filtering
/// - LLM-powered concept extraction and relation inference
/// - Async graph growth from conversation text (fire-and-forget)

use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet, VecDeque};

// ─── Structs ─────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KnowledgeNode {
    pub id: String,
    pub concept: String,      // normalized concept name
    pub node_type: String,    // "concept", "person", "project", "technology", "place", "event"
    pub description: String,
    pub sources: Vec<String>, // where this knowledge came from: ["memory:id", "doc:id", "conversation:ts"]
    pub importance: f32,      // 0.0–1.0, how central is this concept
    pub created_at: i64,
    pub last_updated: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KnowledgeEdge {
    pub from_id: String,
    pub to_id: String,
    pub relation: String,  // "is_a", "part_of", "related_to", "depends_on", "contradicts", "enables", "used_by"
    pub strength: f32,     // 0.0–1.0
    pub created_at: i64,
}

#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GraphQuery {
    pub concept: String,
    pub depth: usize,
    pub relation_filter: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubGraph {
    pub nodes: Vec<KnowledgeNode>,
    pub edges: Vec<KnowledgeEdge>,
    pub root_concept: String,
}

// ─── LLM extraction helpers (private) ────────────────────────────────────────

#[derive(Debug, Deserialize)]
struct ExtractedNode {
    concept: Option<String>,
    node_type: Option<String>,
    description: Option<String>,
    importance: Option<f32>,
}

#[derive(Debug, Deserialize)]
struct ExtractedRelation {
    from: Option<String>,
    to: Option<String>,
    relation: Option<String>,
    strength: Option<f32>,
}

// ─── DB helpers ──────────────────────────────────────────────────────────────

fn db_path() -> std::path::PathBuf {
    crate::config::blade_config_dir().join("blade.db")
}

fn open_conn() -> Result<rusqlite::Connection, String> {
    rusqlite::Connection::open(db_path()).map_err(|e| e.to_string())
}

/// Ensure knowledge graph tables exist. Called lazily before every write.
pub fn ensure_tables() {
    let conn = match open_conn() {
        Ok(c) => c,
        Err(_) => return,
    };
    let _ = conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS kg_nodes (
            id TEXT PRIMARY KEY,
            concept TEXT NOT NULL,
            node_type TEXT NOT NULL DEFAULT 'concept',
            description TEXT NOT NULL DEFAULT '',
            sources TEXT NOT NULL DEFAULT '[]',
            importance REAL NOT NULL DEFAULT 0.5,
            created_at INTEGER NOT NULL,
            last_updated INTEGER NOT NULL
        );
        CREATE UNIQUE INDEX IF NOT EXISTS kg_nodes_concept_idx ON kg_nodes (concept);
        CREATE TABLE IF NOT EXISTS kg_edges (
            from_id TEXT NOT NULL,
            to_id TEXT NOT NULL,
            relation TEXT NOT NULL,
            strength REAL NOT NULL DEFAULT 0.5,
            created_at INTEGER NOT NULL,
            PRIMARY KEY (from_id, to_id, relation)
        );
        CREATE INDEX IF NOT EXISTS kg_edges_from_idx ON kg_edges (from_id);
        CREATE INDEX IF NOT EXISTS kg_edges_to_idx ON kg_edges (to_id);",
    );
}

// ─── JSON helpers ─────────────────────────────────────────────────────────────

fn json_to_vec(s: &str) -> Vec<String> {
    serde_json::from_str(s).unwrap_or_default()
}

fn vec_to_json(v: &[String]) -> String {
    serde_json::to_string(v).unwrap_or_else(|_| "[]".to_string())
}

fn row_to_node(row: &rusqlite::Row) -> rusqlite::Result<KnowledgeNode> {
    let sources_str: String = row.get(4)?;
    Ok(KnowledgeNode {
        id: row.get(0)?,
        concept: row.get(1)?,
        node_type: row.get(2)?,
        description: row.get(3)?,
        sources: json_to_vec(&sources_str),
        importance: row.get(5)?,
        created_at: row.get(6)?,
        last_updated: row.get(7)?,
    })
}

fn row_to_edge(row: &rusqlite::Row) -> rusqlite::Result<KnowledgeEdge> {
    Ok(KnowledgeEdge {
        from_id: row.get(0)?,
        to_id: row.get(1)?,
        relation: row.get(2)?,
        strength: row.get(3)?,
        created_at: row.get(4)?,
    })
}

// ─── LLM helpers ──────────────────────────────────────────────────────────────

fn cheap_model_for(provider: &str) -> String {
    crate::config::cheap_model_for_provider(provider, "")
}

async fn llm_complete(prompt: &str) -> Result<String, String> {
    let config = crate::config::load_config();

    let (provider, api_key, model) = if let Some(fast_prov) = config.task_routing.fast.clone() {
        let key = crate::config::get_provider_key(&fast_prov);
        if !key.is_empty() {
            let m = cheap_model_for(&fast_prov);
            (fast_prov, key, m)
        } else {
            let m = cheap_model_for(&config.provider);
            (config.provider.clone(), config.api_key.clone(), m)
        }
    } else {
        let m = cheap_model_for(&config.provider);
        (config.provider.clone(), config.api_key.clone(), m)
    };

    if api_key.is_empty() && provider != "ollama" {
        return Err("No API key configured".to_string());
    }

    let messages = vec![crate::providers::ConversationMessage::User(prompt.to_string())];
    let turn = crate::providers::complete_turn(&provider, &api_key, &model, &messages, &[], None).await?;
    Ok(turn.content)
}

fn strip_json_fences(raw: &str) -> &str {
    let s = raw.trim();
    if s.starts_with("```") {
        let after = s.trim_start_matches('`');
        let after_lang = after.trim_start_matches("json").trim_start_matches('\n');
        if let Some(end) = after_lang.rfind("```") {
            return after_lang[..end].trim();
        }
        return after_lang.trim();
    }
    s
}

// ─── Node management ──────────────────────────────────────────────────────────

/// Add or merge a KnowledgeNode. If a node with the same concept already exists,
/// merges sources and updates importance/description if the new values are higher.
/// Returns the node ID.
pub fn add_node(n: KnowledgeNode) -> Result<String, String> {
    ensure_tables();
    let conn = open_conn()?;

    // Normalize concept: lowercase, trim
    let concept_normalized = n.concept.trim().to_lowercase();
    if concept_normalized.is_empty() {
        return Err("concept cannot be empty".to_string());
    }

    let now = chrono::Utc::now().timestamp();

    // Check if the concept already exists
    let existing: Option<KnowledgeNode> = conn
        .prepare("SELECT id, concept, node_type, description, sources, importance, created_at, last_updated FROM kg_nodes WHERE concept = ?1")
        .and_then(|mut stmt| {
            stmt.query_row(params![concept_normalized], row_to_node)
                .optional()
        })
        .map_err(|e| e.to_string())?;

    if let Some(mut existing_node) = existing {
        // Merge: combine sources, take higher importance, update description if non-empty
        let mut merged_sources = existing_node.sources.clone();
        for src in &n.sources {
            if !merged_sources.contains(src) {
                merged_sources.push(src.clone());
            }
        }
        let new_importance = if n.importance > existing_node.importance {
            n.importance
        } else {
            existing_node.importance
        };
        let new_desc = if !n.description.is_empty() && n.description != existing_node.description {
            n.description.clone()
        } else {
            existing_node.description.clone()
        };
        let sources_json = vec_to_json(&merged_sources);

        conn.execute(
            "UPDATE kg_nodes SET description = ?1, sources = ?2, importance = ?3, last_updated = ?4 WHERE id = ?5",
            params![new_desc, sources_json, new_importance, now, existing_node.id],
        )
        .map_err(|e| e.to_string())?;

        existing_node.id = existing_node.id.clone();
        Ok(existing_node.id)
    } else {
        // Insert new node
        let id = if n.id.is_empty() {
            uuid::Uuid::new_v4().to_string()
        } else {
            n.id.clone()
        };
        let sources_json = vec_to_json(&n.sources);

        conn.execute(
            "INSERT INTO kg_nodes (id, concept, node_type, description, sources, importance, created_at, last_updated)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![id, concept_normalized, n.node_type, n.description, sources_json, n.importance, now, now],
        )
        .map_err(|e| e.to_string())?;

        Ok(id)
    }
}

#[allow(dead_code)]
pub fn get_node(id: &str) -> Option<KnowledgeNode> {
    let conn = open_conn().ok()?;
    conn.prepare(
        "SELECT id, concept, node_type, description, sources, importance, created_at, last_updated FROM kg_nodes WHERE id = ?1",
    )
    .and_then(|mut stmt| stmt.query_row(params![id], row_to_node).optional())
    .ok()
    .flatten()
}

pub fn find_node_by_concept(concept: &str) -> Option<KnowledgeNode> {
    let conn = open_conn().ok()?;
    let normalized = concept.trim().to_lowercase();
    conn.prepare(
        "SELECT id, concept, node_type, description, sources, importance, created_at, last_updated FROM kg_nodes WHERE concept = ?1",
    )
    .and_then(|mut stmt| stmt.query_row(params![normalized], row_to_node).optional())
    .ok()
    .flatten()
}

/// Full-text search over concept name and description.
pub fn search_nodes(query: &str) -> Vec<KnowledgeNode> {
    let conn = match open_conn() {
        Ok(c) => c,
        Err(_) => return vec![],
    };
    ensure_tables();
    let pattern = format!("%{}%", query.to_lowercase());
    conn.prepare(
        "SELECT id, concept, node_type, description, sources, importance, created_at, last_updated
         FROM kg_nodes
         WHERE lower(concept) LIKE ?1 OR lower(description) LIKE ?1
         ORDER BY importance DESC
         LIMIT 20",
    )
    .and_then(|mut stmt| {
        stmt.query_map(params![pattern], row_to_node)
            .map(|rows| rows.filter_map(|r| r.ok()).collect())
    })
    .unwrap_or_default()
}

#[allow(dead_code)]
pub fn update_node(id: &str, description: &str, importance: f32) -> Result<(), String> {
    let conn = open_conn()?;
    let now = chrono::Utc::now().timestamp();
    conn.execute(
        "UPDATE kg_nodes SET description = ?1, importance = ?2, last_updated = ?3 WHERE id = ?4",
        params![description, importance, now, id],
    )
    .map(|_| ())
    .map_err(|e| e.to_string())
}

pub fn delete_node(id: &str) -> Result<(), String> {
    let conn = open_conn()?;
    // Remove edges too
    conn.execute("DELETE FROM kg_edges WHERE from_id = ?1 OR to_id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM kg_nodes WHERE id = ?1", params![id])
        .map(|_| ())
        .map_err(|e| e.to_string())
}

// ─── Edge management ──────────────────────────────────────────────────────────

pub fn add_edge(from_id: &str, to_id: &str, relation: &str, strength: f32) -> Result<(), String> {
    ensure_tables();
    let conn = open_conn()?;
    let now = chrono::Utc::now().timestamp();
    let clamped = strength.clamp(0.0, 1.0);

    conn.execute(
        "INSERT INTO kg_edges (from_id, to_id, relation, strength, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT (from_id, to_id, relation) DO UPDATE SET strength = ?4",
        params![from_id, to_id, relation, clamped, now],
    )
    .map(|_| ())
    .map_err(|e| e.to_string())
}

/// Get all edges where node_id is either from or to.
#[allow(dead_code)]
pub fn get_edges(node_id: &str) -> Vec<KnowledgeEdge> {
    let conn = match open_conn() {
        Ok(c) => c,
        Err(_) => return vec![],
    };
    conn.prepare(
        "SELECT from_id, to_id, relation, strength, created_at FROM kg_edges
         WHERE from_id = ?1 OR to_id = ?1
         ORDER BY strength DESC",
    )
    .and_then(|mut stmt| {
        stmt.query_map(params![node_id], row_to_edge)
            .map(|rows| rows.filter_map(|r| r.ok()).collect())
    })
    .unwrap_or_default()
}

#[allow(dead_code)]
pub fn delete_edge(from_id: &str, to_id: &str) -> Result<(), String> {
    let conn = open_conn()?;
    conn.execute(
        "DELETE FROM kg_edges WHERE from_id = ?1 AND to_id = ?2",
        params![from_id, to_id],
    )
    .map(|_| ())
    .map_err(|e| e.to_string())
}

// ─── Graph traversal ──────────────────────────────────────────────────────────

/// BFS from root_concept, up to depth hops, optionally filtered by relation type.
pub fn traverse(root_concept: &str, depth: usize, relation_filter: Option<&str>) -> SubGraph {
    let root_node = match find_node_by_concept(root_concept) {
        Some(n) => n,
        None => {
            return SubGraph {
                nodes: vec![],
                edges: vec![],
                root_concept: root_concept.to_string(),
            }
        }
    };

    let conn = match open_conn() {
        Ok(c) => c,
        Err(_) => {
            return SubGraph {
                nodes: vec![root_node],
                edges: vec![],
                root_concept: root_concept.to_string(),
            }
        }
    };

    let mut visited_ids: HashSet<String> = HashSet::new();
    let mut nodes: Vec<KnowledgeNode> = Vec::new();
    let mut edges: Vec<KnowledgeEdge> = Vec::new();
    let mut queue: VecDeque<(String, usize)> = VecDeque::new();

    visited_ids.insert(root_node.id.clone());
    queue.push_back((root_node.id.clone(), 0));
    nodes.push(root_node);

    while let Some((current_id, current_depth)) = queue.pop_front() {
        if current_depth >= depth {
            continue;
        }

        // Find all edges from/to this node
        let neighbour_edges: Vec<KnowledgeEdge> = if let Some(rel) = relation_filter {
            conn.prepare(
                "SELECT from_id, to_id, relation, strength, created_at FROM kg_edges
                 WHERE (from_id = ?1 OR to_id = ?1) AND relation = ?2",
            )
            .and_then(|mut stmt| {
                stmt.query_map(params![current_id, rel], row_to_edge)
                    .map(|rows| rows.filter_map(|r| r.ok()).collect())
            })
            .unwrap_or_default()
        } else {
            conn.prepare(
                "SELECT from_id, to_id, relation, strength, created_at FROM kg_edges
                 WHERE from_id = ?1 OR to_id = ?1",
            )
            .and_then(|mut stmt| {
                stmt.query_map(params![current_id], row_to_edge)
                    .map(|rows| rows.filter_map(|r| r.ok()).collect())
            })
            .unwrap_or_default()
        };

        for edge in neighbour_edges {
            let neighbour_id = if edge.from_id == current_id {
                edge.to_id.clone()
            } else {
                edge.from_id.clone()
            };

            // Add edge if not already tracked (by from+to+relation key)
            let edge_key = format!("{}|{}|{}", edge.from_id, edge.to_id, edge.relation);
            let edge_exists = edges.iter().any(|e| {
                format!("{}|{}|{}", e.from_id, e.to_id, e.relation) == edge_key
            });
            if !edge_exists {
                edges.push(edge);
            }

            if !visited_ids.contains(&neighbour_id) {
                visited_ids.insert(neighbour_id.clone());
                // Load the neighbour node
                if let Ok(Some(neighbour_node)) = conn
                    .prepare("SELECT id, concept, node_type, description, sources, importance, created_at, last_updated FROM kg_nodes WHERE id = ?1")
                    .and_then(|mut stmt| stmt.query_row(params![neighbour_id], row_to_node).optional())
                {
                    queue.push_back((neighbour_node.id.clone(), current_depth + 1));
                    nodes.push(neighbour_node);
                }
            }
        }
    }

    SubGraph {
        nodes,
        edges,
        root_concept: root_concept.to_string(),
    }
}

/// BFS shortest path between two concepts. Returns the sequence of nodes from `from` to `to`.
pub fn find_path(from_concept: &str, to_concept: &str) -> Vec<KnowledgeNode> {
    let from_node = match find_node_by_concept(from_concept) {
        Some(n) => n,
        None => return vec![],
    };
    let to_node = match find_node_by_concept(to_concept) {
        Some(n) => n,
        None => return vec![],
    };

    if from_node.id == to_node.id {
        return vec![from_node];
    }

    let conn = match open_conn() {
        Ok(c) => c,
        Err(_) => return vec![],
    };

    // BFS with parent tracking
    let mut visited: HashSet<String> = HashSet::new();
    let mut parent: HashMap<String, String> = HashMap::new();
    let mut queue: VecDeque<String> = VecDeque::new();

    visited.insert(from_node.id.clone());
    queue.push_back(from_node.id.clone());

    let target_id = to_node.id.clone();
    let mut found = false;

    'bfs: while let Some(current_id) = queue.pop_front() {
        let neighbour_ids: Vec<String> = conn
            .prepare(
                "SELECT CASE WHEN from_id = ?1 THEN to_id ELSE from_id END
                 FROM kg_edges WHERE from_id = ?1 OR to_id = ?1",
            )
            .and_then(|mut stmt| {
                stmt.query_map(params![current_id], |row| row.get::<_, String>(0))
                    .map(|rows| rows.filter_map(|r| r.ok()).collect())
            })
            .unwrap_or_default();

        for nid in neighbour_ids {
            if !visited.contains(&nid) {
                visited.insert(nid.clone());
                parent.insert(nid.clone(), current_id.clone());
                if nid == target_id {
                    found = true;
                    break 'bfs;
                }
                queue.push_back(nid);
            }
        }
    }

    if !found {
        return vec![];
    }

    // Reconstruct path
    let mut path_ids: Vec<String> = Vec::new();
    let mut cur = target_id.clone();
    loop {
        path_ids.push(cur.clone());
        if cur == from_node.id {
            break;
        }
        match parent.get(&cur) {
            Some(p) => cur = p.clone(),
            None => break,
        }
    }
    path_ids.reverse();

    // Fetch nodes in order
    path_ids
        .into_iter()
        .filter_map(|id| {
            conn.prepare(
                "SELECT id, concept, node_type, description, sources, importance, created_at, last_updated FROM kg_nodes WHERE id = ?1",
            )
            .and_then(|mut stmt| stmt.query_row(params![id], row_to_node).optional())
            .ok()
            .flatten()
        })
        .collect()
}

// ─── LLM-powered functions ────────────────────────────────────────────────────

/// LLM: Extract key concepts, people, technologies from text.
pub async fn extract_concepts_from_text(text: &str) -> Vec<KnowledgeNode> {
    let snippet = crate::safe_slice(text, 4000);
    let prompt = format!(
        r#"Extract the key concepts, people, technologies, places, and events from this text.
Return a JSON array of objects with these fields:
- concept: string (short normalized name, lowercase, use underscores for spaces)
- node_type: string (one of: "concept", "person", "project", "technology", "place", "event")
- description: string (1-2 sentence explanation)
- importance: number (0.0-1.0, how central is this concept in the text)

Return ONLY the JSON array. No explanation. No markdown fences.

TEXT:
{snippet}"#
    );

    let raw = match llm_complete(&prompt).await {
        Ok(s) => s,
        Err(_) => return vec![],
    };

    let clean = strip_json_fences(&raw);
    let extracted: Vec<ExtractedNode> = match serde_json::from_str(clean) {
        Ok(v) => v,
        Err(_) => return vec![],
    };

    let now = chrono::Utc::now().timestamp();
    extracted
        .into_iter()
        .filter_map(|e| {
            let concept = e.concept?.trim().to_lowercase();
            if concept.is_empty() {
                return None;
            }
            Some(KnowledgeNode {
                id: uuid::Uuid::new_v4().to_string(),
                concept,
                node_type: e.node_type.unwrap_or_else(|| "concept".to_string()),
                description: e.description.unwrap_or_default(),
                sources: vec![],
                importance: e.importance.unwrap_or(0.5).clamp(0.0, 1.0),
                created_at: now,
                last_updated: now,
            })
        })
        .collect()
}

/// LLM: Infer relations between two concepts.
pub async fn infer_relations(node_a: &str, node_b: &str) -> Vec<KnowledgeEdge> {
    let prompt = format!(
        r#"What are the relationships between "{node_a}" and "{node_b}"?

List as many relevant relationships as you find. Use ONLY these relation types:
is_a, part_of, related_to, depends_on, contradicts, enables, used_by

Return a JSON array where each object has:
- from: "{node_a}" or "{node_b}"
- to: the other concept
- relation: one of the types above
- strength: number 0.0-1.0 (how strong is this relationship)

Return ONLY the JSON array. No explanation. No markdown fences."#
    );

    let raw = match llm_complete(&prompt).await {
        Ok(s) => s,
        Err(_) => return vec![],
    };

    let clean = strip_json_fences(&raw);
    let extracted: Vec<ExtractedRelation> = match serde_json::from_str(clean) {
        Ok(v) => v,
        Err(_) => return vec![],
    };

    let now = chrono::Utc::now().timestamp();
    extracted
        .into_iter()
        .filter_map(|e| {
            let from = e.from?.trim().to_lowercase();
            let to = e.to?.trim().to_lowercase();
            let relation = e.relation?;
            if from.is_empty() || to.is_empty() {
                return None;
            }
            Some(KnowledgeEdge {
                from_id: from,
                to_id: to,
                relation,
                strength: e.strength.unwrap_or(0.5).clamp(0.0, 1.0),
                created_at: now,
            })
        })
        .collect()
}

/// Extract concepts from a conversation, add new nodes, infer edges.
/// Designed for fire-and-forget from commands.rs background spawn.
pub async fn grow_graph_from_conversation(text: &str) {
    ensure_tables();

    // Extract concepts
    let nodes = extract_concepts_from_text(text).await;
    if nodes.is_empty() {
        return;
    }

    // Add all nodes, tracking their assigned IDs
    let mut concept_to_id: HashMap<String, String> = HashMap::new();
    for mut node in nodes {
        node.sources = vec![format!("conversation:{}", chrono::Utc::now().timestamp())];
        if let Ok(id) = add_node(node.clone()) {
            concept_to_id.insert(node.concept.clone(), id);
        }
    }

    // Infer relations between pairs of top concepts (limit to avoid too many LLM calls)
    let concepts: Vec<String> = concept_to_id.keys().cloned().collect();
    let limit = concepts.len().min(5);

    for i in 0..limit {
        for j in (i + 1)..limit {
            let a = &concepts[i];
            let b = &concepts[j];
            let inferred = infer_relations(a, b).await;
            for edge in inferred {
                // Map concept names to real IDs
                let from_id = concept_to_id.get(&edge.from_id).cloned()
                    .or_else(|| find_node_by_concept(&edge.from_id).map(|n| n.id));
                let to_id = concept_to_id.get(&edge.to_id).cloned()
                    .or_else(|| find_node_by_concept(&edge.to_id).map(|n| n.id));

                if let (Some(fid), Some(tid)) = (from_id, to_id) {
                    let _ = add_edge(&fid, &tid, &edge.relation, edge.strength);
                }
            }
        }
    }
}

/// Traverse the graph to find relevant concepts, use them as context for LLM answer.
pub async fn answer_with_graph(question: &str) -> String {
    // Find root concept from question
    let graph_ctx = get_graph_context(question);

    let prompt = if graph_ctx.is_empty() {
        format!(
            "Answer this question using your knowledge:\n\n{}",
            question
        )
    } else {
        format!(
            "Here is relevant context from the knowledge graph:\n\n{}\n\nUsing this context, answer:\n\n{}",
            graph_ctx, question
        )
    };

    llm_complete(&prompt).await.unwrap_or_else(|_| {
        "Could not generate answer — no API key configured.".to_string()
    })
}

/// Build a concise context string about a topic for system prompt injection.
/// Format: "Related concepts to [topic]: machine_learning → neural_networks → transformers → ..."
pub fn get_graph_context(topic: &str) -> String {
    if topic.is_empty() {
        return String::new();
    }

    // Find the best matching node for the topic
    let root = find_node_by_concept(topic)
        .or_else(|| {
            // Fuzzy: search and take the most important match
            let results = search_nodes(topic);
            results.into_iter().next()
        });

    let root_node = match root {
        Some(n) => n,
        None => return String::new(),
    };

    // Traverse up to 2 hops for a concise context
    let subgraph = traverse(&root_node.concept, 2, None);
    if subgraph.nodes.is_empty() {
        return String::new();
    }

    let mut lines: Vec<String> = Vec::new();
    lines.push(format!(
        "## Knowledge Graph: {}\n",
        root_node.concept
    ));

    // Root node description
    if !root_node.description.is_empty() {
        lines.push(format!("**{}**: {}", root_node.concept, root_node.description));
    }

    // Connected concepts
    let connected: Vec<String> = subgraph
        .nodes
        .iter()
        .filter(|n| n.id != root_node.id)
        .map(|n| {
            // Find the relation
            let rel = subgraph
                .edges
                .iter()
                .find(|e| {
                    (e.from_id == root_node.id && e.to_id == n.id)
                        || (e.to_id == root_node.id && e.from_id == n.id)
                })
                .map(|e| e.relation.as_str())
                .unwrap_or("related_to");
            format!("{} --[{}]--> {}", root_node.concept, rel, n.concept)
        })
        .collect();

    if !connected.is_empty() {
        lines.push(format!("Related: {}", connected.join(", ")));
    }

    lines.join("\n")
}

/// Graph statistics: node count, edge count, most connected nodes.
pub fn get_graph_stats() -> serde_json::Value {
    let conn = match open_conn() {
        Ok(c) => c,
        Err(_) => {
            return serde_json::json!({
                "node_count": 0,
                "edge_count": 0,
                "most_connected": []
            })
        }
    };
    ensure_tables();

    let node_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM kg_nodes", [], |r| r.get(0))
        .unwrap_or(0);

    let edge_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM kg_edges", [], |r| r.get(0))
        .unwrap_or(0);

    // Most connected nodes: count edges in both directions
    let most_connected: Vec<serde_json::Value> = conn
        .prepare(
            "SELECT n.concept, COUNT(e.from_id) + COUNT(e2.to_id) as degree
             FROM kg_nodes n
             LEFT JOIN kg_edges e ON e.from_id = n.id
             LEFT JOIN kg_edges e2 ON e2.to_id = n.id
             GROUP BY n.id
             ORDER BY degree DESC
             LIMIT 5",
        )
        .and_then(|mut stmt| {
            stmt.query_map([], |row| {
                Ok(serde_json::json!({
                    "concept": row.get::<_, String>(0)?,
                    "degree": row.get::<_, i64>(1)?
                }))
            })
            .map(|rows| rows.filter_map(|r| r.ok()).collect())
        })
        .unwrap_or_default();

    serde_json::json!({
        "node_count": node_count,
        "edge_count": edge_count,
        "most_connected": most_connected
    })
}

// ─── Tauri commands ───────────────────────────────────────────────────────────

#[tauri::command]
pub async fn graph_add_node(
    id: String,
    concept: String,
    node_type: String,
    description: String,
    sources: Vec<String>,
    importance: f32,
) -> Result<String, String> {
    let now = chrono::Utc::now().timestamp();
    let node = KnowledgeNode {
        id,
        concept,
        node_type,
        description,
        sources,
        importance,
        created_at: now,
        last_updated: now,
    };
    add_node(node)
}

#[tauri::command]
pub async fn graph_search_nodes(query: String) -> Vec<KnowledgeNode> {
    search_nodes(&query)
}

#[tauri::command]
pub async fn graph_traverse(
    concept: String,
    depth: usize,
    relation_filter: Option<String>,
) -> SubGraph {
    traverse(&concept, depth, relation_filter.as_deref())
}

#[tauri::command]
pub async fn graph_find_path(from_concept: String, to_concept: String) -> Vec<KnowledgeNode> {
    find_path(&from_concept, &to_concept)
}

#[tauri::command]
pub async fn graph_extract_from_text(text: String) -> Vec<KnowledgeNode> {
    extract_concepts_from_text(&text).await
}

#[tauri::command]
pub async fn graph_answer(question: String) -> String {
    answer_with_graph(&question).await
}

#[tauri::command]
pub async fn graph_get_stats() -> serde_json::Value {
    get_graph_stats()
}

#[tauri::command]
pub async fn graph_delete_node(id: String) -> Result<(), String> {
    delete_node(&id)
}
