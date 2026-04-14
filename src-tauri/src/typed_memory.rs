/// TYPED MEMORY — Omi-inspired structured memory categories for BLADE.
///
/// Flat memory storage (like the old human_block) treats "User's birthday is March 15"
/// the same as "Prefers dark mode". This module gives every memory a semantic type so
/// BLADE can surface the right kind of knowledge at the right moment:
///
///   Fact        — immutable biographical data  ("birthday is March 15")
///   Preference  — how the user likes things     ("hates verbose answers, prefers bullets")
///   Decision    — choices made with rationale   ("chose React over Vue for the dashboard")
///   Relationship — people and their context     ("Sarah leads the API team")
///   Skill       — what the user knows or is learning ("expert in Rust, learning Go")
///   Goal        — near/medium-term intentions   ("launch BLADE by end of month")
///   Routine     — recurring behaviours/schedule ("codes 10am-6pm, gym at 7pm")
///
/// Each memory carries: category, content, confidence, source, timestamps, access_count.
///
/// Proactive surfacing: given a set of perception context tags (e.g. ["rust","debugging"]),
/// `get_relevant_memories_for_context` returns the top-N memories whose content
/// keyword-matches the tags, ordered by relevance × confidence. The top 3 are injected
/// into brain.rs's system prompt.
///
/// Consolidation: duplicate detection merges same-content entries and boosts confidence.
/// Conflict detection ("prefers tabs" vs "prefers spaces") preserves the newer entry
/// and lowers the confidence of the older one. A monthly "BLADE knows about you" summary
/// can be generated on demand.

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

// ── Category enum ─────────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MemoryCategory {
    Fact,         // "User's birthday is March 15"
    Preference,   // "Prefers dark mode, hates verbose answers"
    Decision,     // "Chose React over Vue for the dashboard"
    Relationship, // "Works with Sarah on the API team"
    Skill,        // "Knows Rust well, learning Go"
    Goal,         // "Wants to launch BLADE by end of month"
    Routine,      // "Codes from 10am-6pm, gym at 7pm"
}

impl MemoryCategory {
    pub fn as_str(&self) -> &'static str {
        match self {
            MemoryCategory::Fact         => "fact",
            MemoryCategory::Preference   => "preference",
            MemoryCategory::Decision     => "decision",
            MemoryCategory::Relationship => "relationship",
            MemoryCategory::Skill        => "skill",
            MemoryCategory::Goal         => "goal",
            MemoryCategory::Routine      => "routine",
        }
    }

    pub fn from_str(s: &str) -> MemoryCategory {
        match s {
            "fact"         => MemoryCategory::Fact,
            "preference"   => MemoryCategory::Preference,
            "decision"     => MemoryCategory::Decision,
            "relationship" => MemoryCategory::Relationship,
            "skill"        => MemoryCategory::Skill,
            "goal"         => MemoryCategory::Goal,
            "routine"      => MemoryCategory::Routine,
            _              => MemoryCategory::Fact,
        }
    }
}

// ── TypedMemory struct ────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TypedMemory {
    pub id: String,
    pub category: String,   // MemoryCategory::as_str()
    pub content: String,
    pub confidence: f64,    // 0.0–1.0
    pub source: String,     // e.g. "conversation:1234567890" or "manual"
    pub created_at: i64,
    pub last_accessed: i64,
    pub access_count: i64,
}

// ── DB helpers ────────────────────────────────────────────────────────────────

fn db_path() -> std::path::PathBuf {
    crate::config::blade_config_dir().join("blade.db")
}

fn open_conn() -> Result<Connection, String> {
    Connection::open(db_path()).map_err(|e| e.to_string())
}

/// Ensure the typed_memories table exists. Called lazily before every write.
pub fn ensure_table(conn: &Connection) {
    let _ = conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS typed_memories (
            id           TEXT PRIMARY KEY,
            category     TEXT NOT NULL,
            content      TEXT NOT NULL,
            confidence   REAL NOT NULL DEFAULT 0.7,
            source       TEXT NOT NULL DEFAULT 'manual',
            created_at   INTEGER NOT NULL,
            last_accessed INTEGER NOT NULL,
            access_count INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_typed_memories_category
            ON typed_memories (category);
        CREATE INDEX IF NOT EXISTS idx_typed_memories_confidence
            ON typed_memories (confidence DESC);",
    );
}

fn row_to_typed_memory(row: &rusqlite::Row) -> rusqlite::Result<TypedMemory> {
    Ok(TypedMemory {
        id:            row.get(0)?,
        category:      row.get(1)?,
        content:       row.get(2)?,
        confidence:    row.get(3)?,
        source:        row.get(4)?,
        created_at:    row.get(5)?,
        last_accessed: row.get(6)?,
        access_count:  row.get(7)?,
    })
}

// ── Core CRUD ─────────────────────────────────────────────────────────────────

/// Store a new typed memory. Automatically runs duplicate + conflict detection.
/// Returns the ID of the stored (or merged) memory.
pub fn store_typed_memory(
    category: MemoryCategory,
    content: &str,
    source: &str,
    confidence: Option<f64>,
) -> Result<String, String> {
    let conn = open_conn()?;
    ensure_table(&conn);

    let content = content.trim();
    if content.is_empty() {
        return Err("content cannot be empty".to_string());
    }

    let cat_str   = category.as_str();
    let conf      = confidence.unwrap_or(0.7).clamp(0.0, 1.0);
    let now       = chrono::Utc::now().timestamp();

    // ── Duplicate detection ───────────────────────────────────────────────────
    // Exact content match within same category → merge (boost confidence, update source)
    let existing_exact: Option<TypedMemory> = conn
        .prepare(
            "SELECT id, category, content, confidence, source, created_at, last_accessed, access_count
             FROM typed_memories
             WHERE category = ?1 AND content = ?2
             LIMIT 1",
        )
        .and_then(|mut stmt| {
            stmt.query_row(params![cat_str, content], row_to_typed_memory)
                .optional()
        })
        .map_err(|e| e.to_string())?;

    if let Some(existing) = existing_exact {
        // Merge: boost confidence (average, capped at 0.97)
        let merged_conf = ((existing.confidence + conf) / 2.0 + 0.05).min(0.97);
        conn.execute(
            "UPDATE typed_memories
             SET confidence = ?1, source = ?2, last_accessed = ?3, access_count = access_count + 1
             WHERE id = ?4",
            params![merged_conf, source, now, existing.id],
        )
        .map_err(|e| e.to_string())?;
        return Ok(existing.id);
    }

    // ── Conflict detection (Preference & Fact only) ───────────────────────────
    // Look for entries in the same category whose keywords overlap significantly.
    // Strategy: load all entries in same category, run keyword-overlap check.
    // If conflict found, lower the old entry's confidence.
    if matches!(category, MemoryCategory::Preference | MemoryCategory::Fact) {
        detect_and_resolve_conflicts(&conn, cat_str, content, now)?;
    }

    // ── Insert new memory ─────────────────────────────────────────────────────
    let id = uuid::Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO typed_memories (id, category, content, confidence, source, created_at, last_accessed, access_count)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0)",
        params![id, cat_str, content, conf, source, now, now],
    )
    .map_err(|e| e.to_string())?;

    Ok(id)
}

/// Detect potentially conflicting memories in the same category and lower their confidence.
/// A "conflict" is two entries that share a strong topic keyword but make different claims
/// (e.g. "prefers tabs" vs "prefers spaces"). We use a simple keyword-overlap heuristic
/// rather than an LLM call to keep this synchronous and fast.
fn detect_and_resolve_conflicts(
    conn: &Connection,
    category: &str,
    new_content: &str,
    now: i64,
) -> Result<(), String> {
    // Keywords that signal the same "preference topic"
    let conflict_signals: &[&str] = &[
        "prefers", "prefer", "likes", "hates", "dislikes", "uses", "avoid",
        "always", "never", "favorite", "favourite",
    ];

    let new_lower = new_content.to_lowercase();

    // Find the first conflict signal in the new content
    let trigger_word = conflict_signals
        .iter()
        .find(|&&w| new_lower.contains(w));

    let trigger = match trigger_word {
        Some(t) => t,
        None    => return Ok(()), // no conflict signal — nothing to check
    };

    // Extract the noun after the trigger word as a "topic"
    let topic_start = new_lower.find(trigger).unwrap_or(0) + trigger.len();
    let topic_fragment: String = new_lower[topic_start..]
        .split_whitespace()
        .take(2)
        .collect::<Vec<_>>()
        .join(" ");

    if topic_fragment.len() < 3 {
        return Ok(());
    }

    // Find existing entries in same category that share this topic fragment
    let pattern = format!("%{}%", topic_fragment);

    let conflicting: Vec<String> = conn
        .prepare(
            "SELECT id FROM typed_memories
             WHERE category = ?1 AND lower(content) LIKE ?2",
        )
        .and_then(|mut stmt| {
            stmt.query_map(params![category, pattern], |row| row.get::<_, String>(0))
                .map(|rows| rows.filter_map(|r| r.ok()).collect())
        })
        .unwrap_or_default();

    // Lower confidence on conflicting entries (keep the newer one we're about to store)
    for old_id in conflicting {
        let _ = conn.execute(
            "UPDATE typed_memories
             SET confidence = MAX(confidence - 0.2, 0.1), last_accessed = ?1
             WHERE id = ?2",
            params![now, old_id],
        );
    }

    Ok(())
}

/// Recall all typed memories in a given category, ordered by confidence desc.
pub fn recall_by_category(category: MemoryCategory, limit: usize) -> Vec<TypedMemory> {
    let conn = match open_conn() {
        Ok(c) => c,
        Err(_) => return vec![],
    };
    ensure_table(&conn);

    let cat_str   = category.as_str();
    let limit_i64 = limit as i64;
    let now       = chrono::Utc::now().timestamp();

    let memories: Vec<TypedMemory> = conn
        .prepare(
            "SELECT id, category, content, confidence, source, created_at, last_accessed, access_count
             FROM typed_memories
             WHERE category = ?1
             ORDER BY confidence DESC, last_accessed DESC
             LIMIT ?2",
        )
        .and_then(|mut stmt| {
            stmt.query_map(params![cat_str, limit_i64], row_to_typed_memory)
                .map(|rows| rows.filter_map(|r| r.ok()).collect())
        })
        .unwrap_or_default();

    // Bump access_count for returned memories
    for m in &memories {
        let _ = conn.execute(
            "UPDATE typed_memories SET last_accessed = ?1, access_count = access_count + 1 WHERE id = ?2",
            params![now, m.id],
        );
    }

    memories
}

/// Get ALL typed memories across all categories.
pub fn get_all_typed_memories() -> Vec<TypedMemory> {
    let conn = match open_conn() {
        Ok(c) => c,
        Err(_) => return vec![],
    };
    ensure_table(&conn);

    conn.prepare(
        "SELECT id, category, content, confidence, source, created_at, last_accessed, access_count
         FROM typed_memories
         ORDER BY category ASC, confidence DESC",
    )
    .and_then(|mut stmt| {
        stmt.query_map([], row_to_typed_memory)
            .map(|rows| rows.filter_map(|r| r.ok()).collect())
    })
    .unwrap_or_default()
}

/// Delete a typed memory by ID.
pub fn delete_typed_memory(id: &str) -> Result<(), String> {
    let conn = open_conn()?;
    ensure_table(&conn);
    conn.execute("DELETE FROM typed_memories WHERE id = ?1", params![id])
        .map(|_| ())
        .map_err(|e| e.to_string())
}

// ── Proactive surfacing ───────────────────────────────────────────────────────

/// Given a set of perception context tags (e.g. ["coding", "rust", "debugging"]),
/// return the top-N typed memories whose content overlaps with the tags.
///
/// Scoring: for each memory, count how many tags appear in its content (case-insensitive).
/// Multiply by confidence. Sort descending. Return top `limit` entries.
///
/// Example:
///   tags = ["rust", "debugging", "coding"]
///   → "User prefers match statements over if-else chains" scores 2 (rust, coding) × 0.8 = 1.6
///   → "Working on BLADE swarm system" (Goal) scores 1 (coding) × 0.9 = 0.9
pub fn get_relevant_memories_for_context(
    context_tags: &[String],
    limit: usize,
) -> Vec<TypedMemory> {
    if context_tags.is_empty() {
        return vec![];
    }

    let conn = match open_conn() {
        Ok(c) => c,
        Err(_) => return vec![],
    };
    ensure_table(&conn);

    // Load all memories (capped to avoid huge result sets)
    let all: Vec<TypedMemory> = conn
        .prepare(
            "SELECT id, category, content, confidence, source, created_at, last_accessed, access_count
             FROM typed_memories
             WHERE confidence >= 0.4
             ORDER BY confidence DESC
             LIMIT 200",
        )
        .and_then(|mut stmt| {
            stmt.query_map([], row_to_typed_memory)
                .map(|rows| rows.filter_map(|r| r.ok()).collect())
        })
        .unwrap_or_default();

    // Score each memory against the tags
    let tags_lower: Vec<String> = context_tags.iter().map(|t| t.to_lowercase()).collect();

    let mut scored: Vec<(f64, TypedMemory)> = all
        .into_iter()
        .filter_map(|m| {
            let content_lower = m.content.to_lowercase();
            let hit_count = tags_lower
                .iter()
                .filter(|tag| content_lower.contains(tag.as_str()))
                .count();
            if hit_count == 0 {
                return None;
            }
            let score = (hit_count as f64) * m.confidence;
            Some((score, m))
        })
        .collect();

    // Sort by score descending
    scored.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));

    let top: Vec<TypedMemory> = scored.into_iter().take(limit).map(|(_, m)| m).collect();

    // Bump access stats
    let now = chrono::Utc::now().timestamp();
    for m in &top {
        let _ = conn.execute(
            "UPDATE typed_memories SET last_accessed = ?1, access_count = access_count + 1 WHERE id = ?2",
            params![now, m.id],
        );
    }

    top
}

/// Build a compact context string for brain.rs injection.
/// Format designed to be concise and scannable in a system prompt.
pub fn get_typed_memory_context(context_tags: &[String]) -> String {
    let memories = get_relevant_memories_for_context(context_tags, 3);
    if memories.is_empty() {
        return String::new();
    }

    let lines: Vec<String> = memories
        .iter()
        .map(|m| {
            format!(
                "- [{}] {} (confidence: {:.0}%)",
                m.category,
                m.content,
                m.confidence * 100.0
            )
        })
        .collect();

    format!(
        "## What BLADE Knows About You (relevant to this context)\n\n{}",
        lines.join("\n")
    )
}

// ── Memory consolidation ──────────────────────────────────────────────────────

/// Monthly consolidation: generate a "BLADE knows about you" summary that the
/// user can review and correct. Groups memories by category, lists highest-confidence
/// entries, and optionally uses LLM to synthesise a human-readable profile.
///
/// Returns a Markdown summary string.
pub async fn generate_user_knowledge_summary() -> String {
    let conn = match open_conn() {
        Ok(c) => c,
        Err(_) => return "Could not open database.".to_string(),
    };
    ensure_table(&conn);

    // Gather top memories per category
    let categories = [
        MemoryCategory::Fact,
        MemoryCategory::Preference,
        MemoryCategory::Decision,
        MemoryCategory::Relationship,
        MemoryCategory::Skill,
        MemoryCategory::Goal,
        MemoryCategory::Routine,
    ];

    let mut sections: Vec<String> = Vec::new();

    for cat in &categories {
        let entries = recall_by_category(cat.clone(), 5);
        if entries.is_empty() {
            continue;
        }
        let bullets: Vec<String> = entries
            .iter()
            .map(|e| format!("  - {} ({}% confident)", e.content, (e.confidence * 100.0) as u32))
            .collect();
        sections.push(format!(
            "**{}**\n{}",
            capitalise(cat.as_str()),
            bullets.join("\n")
        ));
    }

    if sections.is_empty() {
        return "BLADE has no typed memories yet. They accumulate as you chat.".to_string();
    }

    let raw_summary = sections.join("\n\n");

    // Optional LLM synthesis pass
    let config = crate::config::load_config();
    if config.api_key.is_empty() && config.provider != "ollama" {
        return format!(
            "# BLADE Knows About You\n\n{}\n\n_Review this and correct anything wrong._",
            raw_summary
        );
    }

    let prompt = format!(
        r#"You are BLADE, a personal AI. Here is what you have learned about your user from observing their work and conversations:

{}

Write a friendly, first-person summary of what you know — as if you are introducing yourself to the user. Be specific, reference actual details, and note any gaps or things you are uncertain about. Keep it to 4-6 sentences. End with a question asking if anything needs correcting."#,
        raw_summary
    );

    let messages = vec![crate::providers::ConversationMessage::User(prompt)];
    let cheap = crate::config::cheap_model_for_provider(&config.provider, &config.model);

    let synthesis = match crate::providers::complete_turn(
        &config.provider,
        &config.api_key,
        &cheap,
        &messages,
        &[],
        config.base_url.as_deref(),
    )
    .await
    {
        Ok(r) => r.content.trim().to_string(),
        Err(_) => String::new(),
    };

    if synthesis.is_empty() {
        format!(
            "# BLADE Knows About You\n\n{}\n\n_Review this and correct anything wrong._",
            raw_summary
        )
    } else {
        format!(
            "# BLADE Knows About You\n\n{}\n\n---\n\n## Detailed breakdown\n\n{}\n\n_Review and correct anything wrong by telling BLADE directly._",
            synthesis,
            raw_summary
        )
    }
}

fn capitalise(s: &str) -> String {
    let mut c = s.chars();
    match c.next() {
        None    => String::new(),
        Some(f) => f.to_uppercase().collect::<String>() + c.as_str(),
    }
}

// ── Tauri commands ─────────────────────────────────────────────────────────────

/// Store a typed memory. category is one of: fact, preference, decision, relationship, skill, goal, routine.
#[tauri::command]
pub fn memory_store_typed(
    category: String,
    content: String,
    source: Option<String>,
    confidence: Option<f64>,
) -> Result<String, String> {
    let cat = MemoryCategory::from_str(&category);
    let src = source.as_deref().unwrap_or("manual");
    store_typed_memory(cat, &content, src, confidence)
}

/// Recall memories for a specific category (ordered by confidence, desc).
#[tauri::command]
pub fn memory_recall_category(
    category: String,
    limit: Option<usize>,
) -> Vec<TypedMemory> {
    let cat = MemoryCategory::from_str(&category);
    recall_by_category(cat, limit.unwrap_or(20))
}

/// Get all typed memories across all categories.
#[tauri::command]
pub fn memory_get_all_typed() -> Vec<TypedMemory> {
    get_all_typed_memories()
}

/// Delete a typed memory by ID.
#[tauri::command]
pub fn memory_delete_typed(id: String) -> Result<(), String> {
    delete_typed_memory(&id)
}

/// Generate a "BLADE knows about you" summary (optionally LLM-synthesised).
#[tauri::command]
pub async fn memory_generate_user_summary() -> Result<String, String> {
    Ok(generate_user_knowledge_summary().await)
}
