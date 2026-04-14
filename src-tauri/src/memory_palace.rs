/// MEMORY PALACE — BLADE's episodic long-term memory system.
///
/// Humans remember episodes (specific events with context), not just facts.
/// This module gives BLADE the ability to remember "that time you debugged
/// the auth issue for 6 hours and found it was a timezone bug" — not just
/// "user knows timezones can cause bugs."
///
/// Every meaningful conversation turn is evaluated for memory-worthiness.
/// If it passes, it's crystallised into a structured episode with title,
/// summary, tags, emotional valence, and importance score. Related episodes
/// are associated. Contradictions are surfaced. The palace can be recalled
/// against any query and synthesised into actionable context.

use rusqlite::params;
use serde::{Deserialize, Serialize};

// ─── Structs ──────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryEpisode {
    pub id: String,
    pub title: String,
    pub summary: String,
    pub full_context: String,
    pub tags: Vec<String>,
    pub episode_type: String,
    pub importance: i32,
    pub emotional_valence: String,
    pub people: Vec<String>,
    pub projects: Vec<String>,
    pub recall_count: i64,
    pub created_at: i64,
    pub occurred_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryRecall {
    pub episodes: Vec<MemoryEpisode>,
    pub associations: Vec<String>,  // human-readable relationship strings
    pub synthesis: String,          // LLM synthesis of what these memories mean together
}

#[derive(Debug, Deserialize)]
struct EpisodeExtraction {
    title: Option<String>,
    summary: Option<String>,
    tags: Option<Vec<String>>,
    episode_type: Option<String>,
    importance: Option<i32>,
    emotional_valence: Option<String>,
    people: Option<Vec<String>>,
    projects: Option<Vec<String>>,
}

// ─── DB helpers ───────────────────────────────────────────────────────────────

fn db_path() -> std::path::PathBuf {
    crate::config::blade_config_dir().join("blade.db")
}

fn open_conn() -> Result<rusqlite::Connection, String> {
    rusqlite::Connection::open(db_path()).map_err(|e| e.to_string())
}

/// Ensure memory tables exist. Called lazily — module degrades gracefully if DB
/// is unavailable.
fn ensure_tables(conn: &rusqlite::Connection) {
    let _ = conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS memory_episodes (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            summary TEXT NOT NULL,
            full_context TEXT NOT NULL,
            tags TEXT DEFAULT '[]',
            episode_type TEXT NOT NULL,
            importance INTEGER DEFAULT 5,
            emotional_valence TEXT DEFAULT 'neutral',
            people TEXT DEFAULT '[]',
            projects TEXT DEFAULT '[]',
            recall_count INTEGER DEFAULT 0,
            created_at INTEGER NOT NULL,
            occurred_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS memory_associations (
            id TEXT PRIMARY KEY,
            episode_a TEXT NOT NULL,
            episode_b TEXT NOT NULL,
            relationship TEXT NOT NULL,
            strength REAL DEFAULT 0.5
        );",
    );
}

// ─── JSON helpers ─────────────────────────────────────────────────────────────

fn json_to_vec(s: &str) -> Vec<String> {
    serde_json::from_str(s).unwrap_or_default()
}

fn vec_to_json(v: &[String]) -> String {
    serde_json::to_string(v).unwrap_or_else(|_| "[]".to_string())
}

// ─── Row → Struct mapping ─────────────────────────────────────────────────────

fn row_to_episode(row: &rusqlite::Row) -> rusqlite::Result<MemoryEpisode> {
    let tags_str: String = row.get(4)?;
    let people_str: String = row.get(7)?;
    let projects_str: String = row.get(8)?;

    Ok(MemoryEpisode {
        id: row.get(0)?,
        title: row.get(1)?,
        summary: row.get(2)?,
        full_context: row.get(3)?,
        tags: json_to_vec(&tags_str),
        episode_type: row.get(5)?,
        importance: row.get(6)?,
        emotional_valence: row.get(9)?,
        people: json_to_vec(&people_str),
        projects: json_to_vec(&projects_str),
        recall_count: row.get(10)?,
        created_at: row.get(11)?,
        occurred_at: row.get(12)?,
    })
}

// ─── LLM helpers ──────────────────────────────────────────────────────────────

fn cheap_model_for(provider: &str) -> String {
    crate::config::cheap_model_for_provider(provider, "")
}

fn default_llm_triple(config: &crate::config::BladeConfig) -> (String, String, String) {
    let provider = config.provider.clone();
    let key = config.api_key.clone();
    let model = cheap_model_for(&provider);
    (provider, key, model)
}

async fn llm_complete(prompt: &str) -> Result<String, String> {
    let config = crate::config::load_config();

    let (provider, api_key, model) = {
        if let Some(fast_provider) = config.task_routing.fast.clone() {
            let key = crate::config::get_provider_key(&fast_provider);
            if !key.is_empty() {
                let model = cheap_model_for(&fast_provider);
                (fast_provider, key, model)
            } else {
                default_llm_triple(&config)
            }
        } else {
            default_llm_triple(&config)
        }
    };

    if api_key.is_empty() && provider != "ollama" {
        return Err("No API key configured".to_string());
    }

    let messages = vec![crate::providers::ConversationMessage::User(prompt.to_string())];
    let turn = crate::providers::complete_turn(&provider, &api_key, &model, &messages, &[], None).await?;
    Ok(turn.content)
}

fn strip_json_fences(raw: &str) -> &str {
    raw.trim()
        .trim_start_matches("```json")
        .trim_start_matches("```")
        .trim_end_matches("```")
        .trim()
}

// ─── Core: consolidate a conversation turn into an episode ────────────────────

pub async fn consolidate_to_episode(
    conversation: &str,
    user_text: &str,
    assistant_text: &str,
) -> Option<MemoryEpisode> {
    let combined = if conversation.is_empty() {
        format!("User: {}\n\nAssistant: {}", user_text, assistant_text)
    } else {
        conversation.to_string()
    };

    let prompt = format!(
        r#"You are BLADE's memory curator. Evaluate this conversation exchange and decide if it is worth remembering as a specific episode in BLADE's long-term memory.

CONVERSATION:
{combined}

Criteria for remembering:
- Solved a real problem (debugging, architecture decision, learning something new)
- Emotional weight (frustration, breakthrough, failure, achievement)
- Contains a specific decision with long-term implications
- Involved meaningful collaboration or conflict
- A learning that should not be forgotten
- Something the user will want to reference months from now

If this is worth remembering, respond with JSON only (no markdown fences, no prose):
{{
  "title": "10 words max — specific and memorable, like a diary headline",
  "summary": "2-3 sentences. Write like a diary entry — vivid and specific, not generic.",
  "tags": ["tag1", "tag2"],
  "episode_type": "conversation|achievement|failure|decision|learning|insight",
  "importance": 7,
  "emotional_valence": "positive|negative|neutral",
  "people": ["names if any"],
  "projects": ["project names if any"]
}}

If NOT worth remembering (small talk, trivial questions, one-liners), respond with exactly: skip

Be aggressive about remembering — if in doubt, remember it. Storage is cheap, forgotten lessons are expensive."#
    );

    let raw = match llm_complete(&prompt).await {
        Ok(r) => r,
        Err(e) => {
            eprintln!("[memory_palace] LLM error during consolidation: {e}");
            return None;
        }
    };

    let cleaned = raw.trim();
    if cleaned.eq_ignore_ascii_case("skip") || cleaned.starts_with("skip") {
        return None;
    }

    // Try to parse JSON (may or may not have fences)
    let json_str = strip_json_fences(cleaned);
    let extraction: EpisodeExtraction = match serde_json::from_str(json_str) {
        Ok(e) => e,
        Err(err) => {
            eprintln!("[memory_palace] Failed to parse extraction JSON: {err}\nRaw: {json_str}");
            return None;
        }
    };

    let now = chrono::Utc::now().timestamp();
    let id = uuid::Uuid::new_v4().to_string();

    let episode = MemoryEpisode {
        id: id.clone(),
        title: extraction.title.unwrap_or_else(|| "Untitled memory".to_string()),
        summary: extraction.summary.unwrap_or_else(|| combined.chars().take(300).collect()),
        full_context: combined,
        tags: extraction.tags.unwrap_or_default(),
        episode_type: extraction.episode_type.unwrap_or_else(|| "conversation".to_string()),
        importance: extraction.importance.unwrap_or(5).clamp(1, 10),
        emotional_valence: extraction.emotional_valence.unwrap_or_else(|| "neutral".to_string()),
        people: extraction.people.unwrap_or_default(),
        projects: extraction.projects.unwrap_or_default(),
        recall_count: 0,
        created_at: now,
        occurred_at: now,
    };

    // Save to DB
    if let Ok(conn) = open_conn() {
        ensure_tables(&conn);
        let _ = conn.execute(
            "INSERT OR IGNORE INTO memory_episodes
                (id, title, summary, full_context, tags, episode_type, importance,
                 emotional_valence, people, projects, recall_count, created_at, occurred_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 0, ?11, ?12)",
            params![
                episode.id,
                episode.title,
                episode.summary,
                episode.full_context,
                vec_to_json(&episode.tags),
                episode.episode_type,
                episode.importance,
                episode.emotional_valence,
                vec_to_json(&episode.people),
                vec_to_json(&episode.projects),
                episode.created_at,
                episode.occurred_at,
            ],
        );

        // Find related episodes and create associations
        find_and_create_associations(&conn, &episode);
    }

    Some(episode)
}

// ─── Association finding ──────────────────────────────────────────────────────

fn find_and_create_associations(conn: &rusqlite::Connection, new_episode: &MemoryEpisode) {
    ensure_tables(conn);

    // Find candidates: episodes that share tags, projects, or episode_type
    let mut candidates: Vec<String> = Vec::new();

    for tag in &new_episode.tags {
        let pattern = format!("%{}%", tag);
        if let Ok(mut stmt) = conn.prepare(
            "SELECT id FROM memory_episodes WHERE tags LIKE ?1 AND id != ?2 LIMIT 5",
        ) {
            if let Ok(rows) = stmt.query_map(params![pattern, new_episode.id], |r| r.get(0)) {
                for row in rows.flatten() {
                    candidates.push(row);
                }
            }
        }
    }

    for project in &new_episode.projects {
        let pattern = format!("%{}%", project);
        if let Ok(mut stmt) = conn.prepare(
            "SELECT id FROM memory_episodes WHERE projects LIKE ?1 AND id != ?2 LIMIT 5",
        ) {
            if let Ok(rows) = stmt.query_map(params![pattern, new_episode.id], |r| r.get(0)) {
                for row in rows.flatten() {
                    candidates.push(row);
                }
            }
        }
    }

    // Deduplicate
    candidates.sort();
    candidates.dedup();

    // Create "related" associations (max 5 to avoid noise)
    for candidate_id in candidates.iter().take(5) {
        let assoc_id = uuid::Uuid::new_v4().to_string();
        let _ = conn.execute(
            "INSERT OR IGNORE INTO memory_associations (id, episode_a, episode_b, relationship, strength)
             VALUES (?1, ?2, ?3, 'related', 0.5)",
            params![assoc_id, new_episode.id, candidate_id],
        );
    }
}

// ─── Search ───────────────────────────────────────────────────────────────────

pub fn search_episodes(query: &str, limit: usize) -> Vec<MemoryEpisode> {
    let conn = match open_conn() {
        Ok(c) => c,
        Err(_) => return vec![],
    };
    ensure_tables(&conn);

    let pattern = format!("%{}%", query);
    let limit_i64 = limit as i64;

    let mut stmt = match conn.prepare(
        "SELECT id, title, summary, full_context, tags, episode_type, importance,
                people, projects, emotional_valence, recall_count, created_at, occurred_at
         FROM memory_episodes
         WHERE (title LIKE ?1 OR summary LIKE ?2 OR tags LIKE ?3 OR full_context LIKE ?4)
           AND importance >= 5
         ORDER BY importance DESC, occurred_at DESC
         LIMIT ?5",
    ) {
        Ok(s) => s,
        Err(_) => return vec![],
    };

    let episodes: Vec<MemoryEpisode> = stmt
        .query_map(
            params![pattern, pattern, pattern, pattern, limit_i64],
            row_to_episode,
        )
        .map(|rows| rows.flatten().collect())
        .unwrap_or_default();

    // Increment recall_count for returned episodes
    for ep in &episodes {
        let _ = conn.execute(
            "UPDATE memory_episodes SET recall_count = recall_count + 1 WHERE id = ?1",
            params![ep.id],
        );
    }

    episodes
}

// ─── Recall with LLM synthesis ────────────────────────────────────────────────

pub async fn recall_relevant(query: &str) -> MemoryRecall {
    let episodes = search_episodes(query, 5);

    if episodes.is_empty() {
        return MemoryRecall {
            episodes: vec![],
            associations: vec![],
            synthesis: String::new(),
        };
    }

    // Load associations between returned episodes
    let mut associations: Vec<String> = Vec::new();

    if let Ok(conn) = open_conn() {
        let ids: Vec<String> = episodes.iter().map(|e| format!("'{}'", e.id)).collect();
        let id_list = ids.join(", ");

        let sql = format!(
            "SELECT episode_a, episode_b, relationship, strength
             FROM memory_associations
             WHERE episode_a IN ({id_list}) AND episode_b IN ({id_list})"
        );

        if let Ok(mut stmt) = conn.prepare(&sql) {
            if let Ok(rows) = stmt.query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, f64>(3)?,
                ))
            }) {
                for row in rows.flatten() {
                    let (a, b, rel, strength) = row;
                    // Find titles
                    let title_a = episodes.iter().find(|e| e.id == a).map(|e| e.title.as_str()).unwrap_or(&a);
                    let title_b = episodes.iter().find(|e| e.id == b).map(|e| e.title.as_str()).unwrap_or(&b);
                    associations.push(format!(
                        "\"{title_a}\" {rel} \"{title_b}\" (strength: {strength:.1})"
                    ));
                }
            }
        }
    }

    // LLM synthesis
    let episode_summaries: Vec<String> = episodes
        .iter()
        .map(|e| format!("- **{}** ({}): {}", e.title, e.episode_type, e.summary))
        .collect();

    let synthesis_prompt = format!(
        r#"These past experiences from BLADE's memory are relevant to the current query: "{query}"

Past experiences:
{}

What do these memories collectively teach about this topic? Be specific and practical — reference actual details from the summaries, not generic advice. 2-3 sentences max."#,
        episode_summaries.join("\n")
    );

    let synthesis = llm_complete(&synthesis_prompt).await.unwrap_or_default();

    MemoryRecall {
        episodes,
        associations,
        synthesis,
    }
}

// ─── Retrieval helpers ────────────────────────────────────────────────────────

pub fn get_recent_episodes(days: u32, limit: usize) -> Vec<MemoryEpisode> {
    let conn = match open_conn() {
        Ok(c) => c,
        Err(_) => return vec![],
    };
    ensure_tables(&conn);

    let cutoff = chrono::Utc::now().timestamp() - (days as i64 * 86_400);
    let limit_i64 = limit as i64;

    let mut stmt = match conn.prepare(
        "SELECT id, title, summary, full_context, tags, episode_type, importance,
                people, projects, emotional_valence, recall_count, created_at, occurred_at
         FROM memory_episodes
         WHERE occurred_at >= ?1
         ORDER BY importance DESC, occurred_at DESC
         LIMIT ?2",
    ) {
        Ok(s) => s,
        Err(_) => return vec![],
    };

    stmt.query_map(params![cutoff, limit_i64], row_to_episode)
        .map(|rows| rows.flatten().collect())
        .unwrap_or_default()
}

#[allow(dead_code)]
pub fn get_episodes_by_type(episode_type: &str, limit: usize) -> Vec<MemoryEpisode> {
    let conn = match open_conn() {
        Ok(c) => c,
        Err(_) => return vec![],
    };
    ensure_tables(&conn);

    let limit_i64 = limit as i64;

    let mut stmt = match conn.prepare(
        "SELECT id, title, summary, full_context, tags, episode_type, importance,
                people, projects, emotional_valence, recall_count, created_at, occurred_at
         FROM memory_episodes
         WHERE episode_type = ?1
         ORDER BY occurred_at DESC
         LIMIT ?2",
    ) {
        Ok(s) => s,
        Err(_) => return vec![],
    };

    stmt.query_map(params![episode_type, limit_i64], row_to_episode)
        .map(|rows| rows.flatten().collect())
        .unwrap_or_default()
}

// ─── Contradiction finder ─────────────────────────────────────────────────────

pub async fn find_contradictions() -> Vec<(MemoryEpisode, MemoryEpisode, String)> {
    let conn = match open_conn() {
        Ok(c) => c,
        Err(_) => return vec![],
    };
    ensure_tables(&conn);

    // Load all episodes (capped to avoid huge prompts)
    let mut stmt = match conn.prepare(
        "SELECT id, title, summary, full_context, tags, episode_type, importance,
                people, projects, emotional_valence, recall_count, created_at, occurred_at
         FROM memory_episodes
         ORDER BY importance DESC
         LIMIT 50",
    ) {
        Ok(s) => s,
        Err(_) => return vec![],
    };

    let all_episodes: Vec<MemoryEpisode> = stmt
        .query_map([], row_to_episode)
        .map(|rows| rows.flatten().collect())
        .unwrap_or_default();

    if all_episodes.len() < 2 {
        return vec![];
    }

    // Build a compact list for the LLM
    let episode_list: Vec<String> = all_episodes
        .iter()
        .enumerate()
        .map(|(i, e)| format!("[{}] {} — {}", i, e.title, e.summary))
        .collect();

    let prompt = format!(
        r#"You are reviewing BLADE's memory palace for contradictions. These are past experiences and learnings:

{}

Find pairs of episodes that appear to contradict each other — where BLADE learned or decided opposite things, or where one experience undermines a conclusion from another.

Respond with JSON array only (no markdown, no prose):
[
  {{"a": 0, "b": 3, "explanation": "Episode 0 says X but episode 3 says the opposite"}},
  ...
]

If no clear contradictions exist, respond with: []"#,
        episode_list.join("\n")
    );

    let raw = match llm_complete(&prompt).await {
        Ok(r) => r,
        Err(_) => return vec![],
    };

    let json_str = strip_json_fences(raw.trim());

    #[derive(Deserialize)]
    struct ContradictionPair {
        a: usize,
        b: usize,
        explanation: String,
    }

    let pairs: Vec<ContradictionPair> = match serde_json::from_str(json_str) {
        Ok(p) => p,
        Err(_) => return vec![],
    };

    let mut result = Vec::new();

    for pair in pairs {
        let ep_a = match all_episodes.get(pair.a) {
            Some(e) => e.clone(),
            None => continue,
        };
        let ep_b = match all_episodes.get(pair.b) {
            Some(e) => e.clone(),
            None => continue,
        };

        // Record in DB
        let assoc_id = uuid::Uuid::new_v4().to_string();
        let _ = conn.execute(
            "INSERT OR IGNORE INTO memory_associations
                (id, episode_a, episode_b, relationship, strength)
             VALUES (?1, ?2, ?3, 'contradicts', 0.8)",
            params![assoc_id, ep_a.id, ep_b.id],
        );

        result.push((ep_a, ep_b, pair.explanation));
    }

    result
}

// ─── System prompt injection ──────────────────────────────────────────────────

pub fn get_memory_context(query: &str) -> String {
    if query.is_empty() {
        return String::new();
    }

    let episodes = search_episodes(query, 3);
    if episodes.is_empty() {
        return String::new();
    }

    let mut parts = vec!["## Relevant Past Experiences\n".to_string()];

    for ep in &episodes {
        let valence_icon = match ep.emotional_valence.as_str() {
            "positive" => "+",
            "negative" => "-",
            _ => "~",
        };
        parts.push(format!(
            "**{}** [{valence_icon} importance:{}/10, {}]\n{}",
            ep.title,
            ep.importance,
            ep.episode_type,
            ep.summary
        ));
    }

    parts.join("\n\n")
}

// ─── Auto-consolidation (fire and forget) ────────────────────────────────────

pub async fn auto_consolidate_from_conversation(user_text: &str, assistant_text: &str) {
    // Only consolidate if the exchange is substantive
    let total_len = user_text.len() + assistant_text.len();
    if total_len < 200 {
        return;
    }

    // Quick heuristic: skip obvious small-talk patterns
    let user_lower = user_text.to_lowercase();
    if user_lower == "hi"
        || user_lower == "hello"
        || user_lower == "thanks"
        || user_lower == "ok"
        || user_lower == "bye"
    {
        return;
    }

    let _ = consolidate_to_episode("", user_text, assistant_text).await;
}

// ─── Tauri commands ───────────────────────────────────────────────────────────

#[tauri::command]
pub fn memory_search(query: String, limit: Option<usize>) -> Vec<MemoryEpisode> {
    search_episodes(&query, limit.unwrap_or(10))
}

#[tauri::command]
pub fn memory_get_recent(days: Option<u32>, limit: Option<usize>) -> Vec<MemoryEpisode> {
    get_recent_episodes(days.unwrap_or(7), limit.unwrap_or(20))
}

#[tauri::command]
pub async fn memory_recall(query: String) -> MemoryRecall {
    recall_relevant(&query).await
}

#[tauri::command]
pub fn memory_add_manual(
    title: String,
    summary: String,
    episode_type: String,
    importance: i32,
) -> Result<String, String> {
    let conn = open_conn()?;
    ensure_tables(&conn);

    let now = chrono::Utc::now().timestamp();
    let id = uuid::Uuid::new_v4().to_string();

    conn.execute(
        "INSERT INTO memory_episodes
            (id, title, summary, full_context, tags, episode_type, importance,
             emotional_valence, people, projects, recall_count, created_at, occurred_at)
         VALUES (?1, ?2, ?3, ?4, '[]', ?5, ?6, 'neutral', '[]', '[]', 0, ?7, ?8)",
        params![
            id,
            title,
            summary,
            summary, // full_context defaults to summary for manual entries
            episode_type,
            importance.clamp(1, 10),
            now,
            now,
        ],
    )
    .map_err(|e| e.to_string())?;

    Ok(id)
}

#[tauri::command]
pub fn memory_delete(id: String) -> Result<(), String> {
    let conn = open_conn()?;
    ensure_tables(&conn);

    conn.execute("DELETE FROM memory_episodes WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;

    // Also clean up associations
    let _ = conn.execute(
        "DELETE FROM memory_associations WHERE episode_a = ?1 OR episode_b = ?1",
        params![id],
    );

    Ok(())
}

#[tauri::command]
pub async fn memory_consolidate_now(conversation: String) -> Result<Option<String>, String> {
    // Split conversation heuristically: last user/assistant exchange
    let episode = consolidate_to_episode(&conversation, "", "").await;
    Ok(episode.map(|e| e.title))
}
