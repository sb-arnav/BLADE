/// BLADE Social Graph — Personal CRM with Emotional Intelligence
///
/// Tracks the people in the user's life: traits, interaction history,
/// topics discussed, relationship strength, communication style.
/// Provides context-aware advice on how to approach people and
/// surfaces relationship health insights (drift, follow-ups, opportunities).
///
/// All DB work is done synchronously before any `.await` points so no
/// rusqlite::Connection is held across an await boundary.

use rusqlite::params;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

// ── DB helpers ────────────────────────────────────────────────────────────────

fn db_path() -> std::path::PathBuf {
    crate::config::blade_config_dir().join("blade.db")
}

fn open_db() -> Result<rusqlite::Connection, String> {
    rusqlite::Connection::open(db_path()).map_err(|e| format!("DB open failed: {e}"))
}

// ── Structs ───────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Contact {
    pub id: String,
    pub name: String,
    pub aliases: Vec<String>,
    /// "colleague" | "friend" | "manager" | "mentor" | "client" | "family"
    pub relationship_type: String,
    /// e.g. "analytical", "detail-oriented", "emotional", "direct"
    pub traits: Vec<String>,
    pub interests: Vec<String>,
    /// "formal" | "casual" | "brief" | "verbose"
    pub communication_style: String,
    pub interaction_count: i32,
    pub last_interaction: Option<i64>,
    pub relationship_strength: f32, // 0.0–1.0
    pub notes: String,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Interaction {
    pub id: String,
    pub contact_id: String,
    pub summary: String,
    /// "positive" | "neutral" | "negative" | "mixed"
    pub sentiment: String,
    pub topics: Vec<String>,
    /// commitments made
    pub action_items: Vec<String>,
    pub timestamp: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RelationshipInsight {
    pub contact_name: String,
    /// "drift" | "follow_up" | "strengthen"
    pub insight_type: String,
    pub description: String,
    pub suggested_action: String,
}

// ── Schema ────────────────────────────────────────────────────────────────────

pub fn ensure_tables() {
    if let Ok(conn) = open_db() {
        let _ = conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS social_contacts (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                aliases TEXT NOT NULL DEFAULT '[]',
                relationship_type TEXT NOT NULL DEFAULT 'friend',
                traits TEXT NOT NULL DEFAULT '[]',
                interests TEXT NOT NULL DEFAULT '[]',
                communication_style TEXT NOT NULL DEFAULT 'casual',
                interaction_count INTEGER NOT NULL DEFAULT 0,
                last_interaction INTEGER,
                relationship_strength REAL NOT NULL DEFAULT 0.5,
                notes TEXT NOT NULL DEFAULT '',
                created_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS social_interactions (
                id TEXT PRIMARY KEY,
                contact_id TEXT NOT NULL,
                summary TEXT NOT NULL DEFAULT '',
                sentiment TEXT NOT NULL DEFAULT 'neutral',
                topics TEXT NOT NULL DEFAULT '[]',
                action_items TEXT NOT NULL DEFAULT '[]',
                timestamp INTEGER NOT NULL,
                FOREIGN KEY (contact_id) REFERENCES social_contacts(id)
            );
            CREATE INDEX IF NOT EXISTS idx_social_interactions_contact
                ON social_interactions(contact_id);
            CREATE INDEX IF NOT EXISTS idx_social_interactions_ts
                ON social_interactions(timestamp DESC);",
        );
    }
}

// ── Serialisation helpers ─────────────────────────────────────────────────────

fn to_json_str(v: &[String]) -> String {
    serde_json::to_string(v).unwrap_or_else(|_| "[]".to_string())
}

fn from_json_str(s: &str) -> Vec<String> {
    serde_json::from_str(s).unwrap_or_default()
}

fn row_to_contact(row: &rusqlite::Row) -> rusqlite::Result<Contact> {
    Ok(Contact {
        id: row.get(0)?,
        name: row.get(1)?,
        aliases: from_json_str(&row.get::<_, String>(2)?),
        relationship_type: row.get(3)?,
        traits: from_json_str(&row.get::<_, String>(4)?),
        interests: from_json_str(&row.get::<_, String>(5)?),
        communication_style: row.get(6)?,
        interaction_count: row.get(7)?,
        last_interaction: row.get(8)?,
        relationship_strength: row.get(9)?,
        notes: row.get(10)?,
        created_at: row.get(11)?,
    })
}

fn row_to_interaction(row: &rusqlite::Row) -> rusqlite::Result<Interaction> {
    Ok(Interaction {
        id: row.get(0)?,
        contact_id: row.get(1)?,
        summary: row.get(2)?,
        sentiment: row.get(3)?,
        topics: from_json_str(&row.get::<_, String>(4)?),
        action_items: from_json_str(&row.get::<_, String>(5)?),
        timestamp: row.get(6)?,
    })
}

// ── Contact management ────────────────────────────────────────────────────────

pub fn add_contact(c: Contact) -> Result<String, String> {
    let conn = open_db()?;
    conn.execute(
        "INSERT INTO social_contacts
         (id, name, aliases, relationship_type, traits, interests,
          communication_style, interaction_count, last_interaction,
          relationship_strength, notes, created_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)",
        params![
            c.id,
            c.name,
            to_json_str(&c.aliases),
            c.relationship_type,
            to_json_str(&c.traits),
            to_json_str(&c.interests),
            c.communication_style,
            c.interaction_count,
            c.last_interaction,
            c.relationship_strength,
            c.notes,
            c.created_at,
        ],
    )
    .map_err(|e| format!("Insert contact failed: {e}"))?;
    Ok(c.id)
}

pub fn get_contact(id: &str) -> Option<Contact> {
    let conn = open_db().ok()?;
    let mut stmt = conn
        .prepare(
            "SELECT id, name, aliases, relationship_type, traits, interests,
                    communication_style, interaction_count, last_interaction,
                    relationship_strength, notes, created_at
             FROM social_contacts WHERE id = ?1",
        )
        .ok()?;
    stmt.query_row(params![id], row_to_contact).ok()
}

pub fn search_contacts(query: &str) -> Vec<Contact> {
    let conn = match open_db() {
        Ok(c) => c,
        Err(_) => return vec![],
    };
    let pattern = format!("%{}%", query.to_lowercase());
    let mut stmt = match conn.prepare(
        "SELECT id, name, aliases, relationship_type, traits, interests,
                communication_style, interaction_count, last_interaction,
                relationship_strength, notes, created_at
         FROM social_contacts
         WHERE lower(name) LIKE ?1 OR lower(notes) LIKE ?1 OR lower(aliases) LIKE ?1
         ORDER BY relationship_strength DESC",
    ) {
        Ok(s) => s,
        Err(_) => return vec![],
    };
    stmt.query_map(params![pattern], row_to_contact)
        .map(|rows| rows.filter_map(|r| r.ok()).collect())
        .unwrap_or_default()
}

pub fn update_contact(id: &str, updates: serde_json::Value) -> Result<(), String> {
    let conn = open_db()?;
    let mut contact = get_contact(id).ok_or_else(|| format!("Contact {id} not found"))?;

    if let Some(v) = updates.get("name").and_then(|v| v.as_str()) {
        contact.name = v.to_string();
    }
    if let Some(v) = updates.get("relationship_type").and_then(|v| v.as_str()) {
        contact.relationship_type = v.to_string();
    }
    if let Some(v) = updates.get("communication_style").and_then(|v| v.as_str()) {
        contact.communication_style = v.to_string();
    }
    if let Some(v) = updates.get("notes").and_then(|v| v.as_str()) {
        contact.notes = v.to_string();
    }
    if let Some(v) = updates.get("relationship_strength").and_then(|v| v.as_f64()) {
        contact.relationship_strength = v as f32;
    }
    if let Some(arr) = updates.get("traits").and_then(|v| v.as_array()) {
        contact.traits = arr
            .iter()
            .filter_map(|v| v.as_str().map(|s| s.to_string()))
            .collect();
    }
    if let Some(arr) = updates.get("interests").and_then(|v| v.as_array()) {
        contact.interests = arr
            .iter()
            .filter_map(|v| v.as_str().map(|s| s.to_string()))
            .collect();
    }
    if let Some(arr) = updates.get("aliases").and_then(|v| v.as_array()) {
        contact.aliases = arr
            .iter()
            .filter_map(|v| v.as_str().map(|s| s.to_string()))
            .collect();
    }

    conn.execute(
        "UPDATE social_contacts
         SET name=?1, aliases=?2, relationship_type=?3, traits=?4, interests=?5,
             communication_style=?6, relationship_strength=?7, notes=?8
         WHERE id=?9",
        params![
            contact.name,
            to_json_str(&contact.aliases),
            contact.relationship_type,
            to_json_str(&contact.traits),
            to_json_str(&contact.interests),
            contact.communication_style,
            contact.relationship_strength,
            contact.notes,
            id,
        ],
    )
    .map_err(|e| format!("Update contact failed: {e}"))?;
    Ok(())
}

pub fn delete_contact(id: &str) -> Result<(), String> {
    let conn = open_db()?;
    conn.execute("DELETE FROM social_interactions WHERE contact_id = ?1", params![id])
        .map_err(|e| format!("Delete interactions failed: {e}"))?;
    conn.execute("DELETE FROM social_contacts WHERE id = ?1", params![id])
        .map_err(|e| format!("Delete contact failed: {e}"))?;
    Ok(())
}

pub fn list_contacts() -> Vec<Contact> {
    let conn = match open_db() {
        Ok(c) => c,
        Err(_) => return vec![],
    };
    let mut stmt = match conn.prepare(
        "SELECT id, name, aliases, relationship_type, traits, interests,
                communication_style, interaction_count, last_interaction,
                relationship_strength, notes, created_at
         FROM social_contacts
         ORDER BY relationship_strength DESC, last_interaction DESC",
    ) {
        Ok(s) => s,
        Err(_) => return vec![],
    };
    stmt.query_map([], row_to_contact)
        .map(|rows| rows.filter_map(|r| r.ok()).collect())
        .unwrap_or_default()
}

// ── Interaction tracking ──────────────────────────────────────────────────────

pub fn log_interaction(
    contact_id: &str,
    summary: &str,
    sentiment: &str,
    topics: Vec<String>,
    actions: Vec<String>,
) -> Result<String, String> {
    let conn = open_db()?;
    let now = chrono::Utc::now().timestamp();
    let id = Uuid::new_v4().to_string();

    conn.execute(
        "INSERT INTO social_interactions (id, contact_id, summary, sentiment, topics, action_items, timestamp)
         VALUES (?1,?2,?3,?4,?5,?6,?7)",
        params![id, contact_id, summary, sentiment, to_json_str(&topics), to_json_str(&actions), now],
    )
    .map_err(|e| format!("Insert interaction failed: {e}"))?;

    // Update contact metadata
    conn.execute(
        "UPDATE social_contacts
         SET interaction_count = interaction_count + 1,
             last_interaction = ?1,
             relationship_strength = min(1.0, relationship_strength + 0.05)
         WHERE id = ?2",
        params![now, contact_id],
    )
    .map_err(|e| format!("Update contact stats failed: {e}"))?;

    Ok(id)
}

pub fn get_interactions(contact_id: &str, limit: usize) -> Vec<Interaction> {
    let conn = match open_db() {
        Ok(c) => c,
        Err(_) => return vec![],
    };
    let mut stmt = match conn.prepare(
        "SELECT id, contact_id, summary, sentiment, topics, action_items, timestamp
         FROM social_interactions
         WHERE contact_id = ?1
         ORDER BY timestamp DESC
         LIMIT ?2",
    ) {
        Ok(s) => s,
        Err(_) => return vec![],
    };
    stmt.query_map(params![contact_id, limit as i64], row_to_interaction)
        .map(|rows| rows.filter_map(|r| r.ok()).collect())
        .unwrap_or_default()
}

// ── LLM helpers ───────────────────────────────────────────────────────────────

fn strip_json_fences(s: &str) -> &str {
    let s = s.trim();
    let s = s.strip_prefix("```json").or_else(|| s.strip_prefix("```")).unwrap_or(s);
    s.strip_suffix("```").unwrap_or(s).trim()
}

async fn llm_complete(prompt: &str) -> Result<String, String> {
    let config = crate::config::load_config();
    let (provider, api_key, model) =
        crate::config::resolve_provider_for_task(&config, &crate::router::TaskType::Complex);
    let messages = vec![crate::providers::ConversationMessage::User(prompt.to_string())];
    let turn = crate::providers::complete_turn(&provider, &api_key, &model, &messages, &[], None)
        .await
        .map_err(|e| format!("LLM error: {e}"))?;
    Ok(turn.content)
}

// ── Intelligence ──────────────────────────────────────────────────────────────

/// Ask the LLM if the text mentions a person and, if so, extract their name and traits.
/// Returns None if no person is detected.
#[allow(dead_code)]
pub async fn extract_contact_from_text(text: &str) -> Option<Contact> {
    let prompt = format!(
        "Does the following text mention a specific person (not a public figure or generic role)?\n\n\
         Text:\n{}\n\n\
         If YES, extract their info as JSON with this exact schema:\n\
         {{\"name\": \"full name\", \"relationship_type\": \"colleague|friend|manager|mentor|client|family\", \
         \"traits\": [\"trait1\"], \"interests\": [\"interest1\"], \
         \"communication_style\": \"formal|casual|brief|verbose\", \"notes\": \"any extra context\"}}\n\n\
         If NO, respond with exactly: null\n\n\
         Return ONLY the JSON object or null. No markdown fences. No extra text.",
        crate::safe_slice(text, 2000)
    );

    let raw = llm_complete(&prompt).await.ok()?;
    let raw = raw.trim();
    if raw == "null" || raw.is_empty() {
        return None;
    }
    let raw = strip_json_fences(raw);

    #[derive(Deserialize)]
    struct Extracted {
        name: String,
        #[serde(default = "default_friend")]
        relationship_type: String,
        #[serde(default)]
        traits: Vec<String>,
        #[serde(default)]
        interests: Vec<String>,
        #[serde(default = "default_casual")]
        communication_style: String,
        #[serde(default)]
        notes: String,
    }
    fn default_friend() -> String { "friend".to_string() }
    fn default_casual() -> String { "casual".to_string() }

    let ex: Extracted = serde_json::from_str(raw)
        .map_err(|e| eprintln!("[social_graph] extract parse error: {e}"))
        .ok()?;

    Some(Contact {
        id: Uuid::new_v4().to_string(),
        name: ex.name,
        aliases: vec![],
        relationship_type: ex.relationship_type,
        traits: ex.traits,
        interests: ex.interests,
        communication_style: ex.communication_style,
        interaction_count: 0,
        last_interaction: None,
        relationship_strength: 0.3,
        notes: ex.notes,
        created_at: chrono::Utc::now().timestamp(),
    })
}

/// Use the LLM to extract a structured Interaction from raw conversation text.
pub async fn analyze_interaction(
    contact_id: &str,
    conversation_text: &str,
) -> Result<Interaction, String> {
    // Gather contact name before await
    let contact_name = get_contact(contact_id)
        .map(|c| c.name)
        .unwrap_or_else(|| "this person".to_string());

    let prompt = format!(
        "Analyse the following conversation involving {} and extract a structured summary.\n\n\
         Conversation:\n{}\n\n\
         Return a JSON object with this schema:\n\
         {{\"summary\": \"1-2 sentence summary\", \
         \"sentiment\": \"positive|neutral|negative|mixed\", \
         \"topics\": [\"topic1\", \"topic2\"], \
         \"action_items\": [\"commitment or next step\"]}}\n\n\
         Return ONLY valid JSON. No markdown fences. No extra text.",
        contact_name,
        crate::safe_slice(conversation_text, 3000)
    );

    let raw = llm_complete(&prompt).await?;
    let raw = strip_json_fences(raw.trim());

    #[derive(Deserialize)]
    struct Extracted {
        #[serde(default)]
        summary: String,
        #[serde(default = "default_neutral")]
        sentiment: String,
        #[serde(default)]
        topics: Vec<String>,
        #[serde(default)]
        action_items: Vec<String>,
    }
    fn default_neutral() -> String { "neutral".to_string() }

    let ex: Extracted = serde_json::from_str(raw)
        .map_err(|e| format!("Failed to parse interaction JSON: {e}\nRaw: {}", crate::safe_slice(raw, 200)))?;

    Ok(Interaction {
        id: Uuid::new_v4().to_string(),
        contact_id: contact_id.to_string(),
        summary: ex.summary,
        sentiment: ex.sentiment,
        topics: ex.topics,
        action_items: ex.action_items,
        timestamp: chrono::Utc::now().timestamp(),
    })
}

/// Check all contacts and surface:
/// - "drift"      : not contacted in >30 days
/// - "follow_up"  : has open action items from last interaction
/// - "strengthen" : high-value contact with declining relationship strength
pub async fn generate_relationship_insights() -> Vec<RelationshipInsight> {
    let now = chrono::Utc::now().timestamp();
    let thirty_days_ago = now - 30 * 24 * 3600;

    // Gather all data synchronously before any await
    let contacts = list_contacts();
    if contacts.is_empty() {
        return vec![];
    }

    let mut heuristic_insights: Vec<RelationshipInsight> = Vec::new();

    for contact in &contacts {
        // Drift check
        if let Some(last) = contact.last_interaction {
            if last < thirty_days_ago {
                let days_ago = (now - last) / 86400;
                heuristic_insights.push(RelationshipInsight {
                    contact_name: contact.name.clone(),
                    insight_type: "drift".to_string(),
                    description: format!(
                        "You haven't interacted with {} in {} days.",
                        contact.name, days_ago
                    ),
                    suggested_action: format!(
                        "Reach out to {} — a quick check-in keeps the relationship warm.",
                        contact.name
                    ),
                });
            }
        }

        // Follow-up check — look at latest interaction for open action items
        let interactions = get_interactions(&contact.id, 1);
        if let Some(last_interaction) = interactions.first() {
            if !last_interaction.action_items.is_empty() {
                let items = last_interaction.action_items.join(", ");
                heuristic_insights.push(RelationshipInsight {
                    contact_name: contact.name.clone(),
                    insight_type: "follow_up".to_string(),
                    description: format!(
                        "You have open commitments with {}: {}",
                        contact.name, crate::safe_slice(&items, 120)
                    ),
                    suggested_action: format!(
                        "Follow up with {} on the items you committed to.",
                        contact.name
                    ),
                });
            }
        }

        // Strengthen — high relationship_type importance but strength dropping
        let is_key_relationship = matches!(
            contact.relationship_type.as_str(),
            "manager" | "mentor" | "client"
        );
        if is_key_relationship && contact.relationship_strength < 0.4 {
            heuristic_insights.push(RelationshipInsight {
                contact_name: contact.name.clone(),
                insight_type: "strengthen".to_string(),
                description: format!(
                    "{} is a {} — an important relationship that could use more investment.",
                    contact.name, contact.relationship_type
                ),
                suggested_action: format!(
                    "Schedule intentional time with {} to deepen the relationship.",
                    contact.name
                ),
            });
        }
    }

    // If there are enough contacts, ask the LLM for an additional strategic insight
    if contacts.len() >= 2 && heuristic_insights.len() < 6 {
        let contact_summary: Vec<String> = contacts
            .iter()
            .take(10)
            .map(|c| {
                let days_since = c.last_interaction
                    .map(|t| (now - t) / 86400)
                    .map(|d| format!("{d}d ago"))
                    .unwrap_or_else(|| "never".to_string());
                format!(
                    "- {} ({}, strength {:.1}, last: {})",
                    c.name, c.relationship_type, c.relationship_strength, days_since
                )
            })
            .collect();

        let prompt = format!(
            "You are a personal relationship advisor. Here is the user's contact list:\n{}\n\n\
             Identify ONE additional strategic relationship insight not already obvious from the data. \
             Return a JSON object:\n\
             {{\"contact_name\": \"name\", \"insight_type\": \"drift|follow_up|strengthen\", \
             \"description\": \"one sentence\", \"suggested_action\": \"one concrete action\"}}\n\n\
             Return ONLY valid JSON. No markdown fences.",
            contact_summary.join("\n")
        );

        if let Ok(raw) = llm_complete(&prompt).await {
            let raw = strip_json_fences(raw.trim());
            if let Ok(insight) = serde_json::from_str::<RelationshipInsight>(raw) {
                heuristic_insights.push(insight);
            }
        }
    }

    heuristic_insights
}

/// Given what is known about a contact, tell the user how to approach them about a goal.
pub async fn how_to_approach(contact_id: &str, goal: &str) -> String {
    // Gather all context synchronously first
    let contact = match get_contact(contact_id) {
        Some(c) => c,
        None => return "Contact not found.".to_string(),
    };
    let recent = get_interactions(contact_id, 3);

    let interaction_ctx = if recent.is_empty() {
        "No recorded interactions yet.".to_string()
    } else {
        recent
            .iter()
            .map(|i| format!("- [{}] {} ({})", i.sentiment, crate::safe_slice(&i.summary, 100), i.topics.join(", ")))
            .collect::<Vec<_>>()
            .join("\n")
    };

    let prompt = format!(
        "You are a personal advisor helping someone navigate a relationship strategically.\n\n\
         Contact profile:\n\
         - Name: {}\n\
         - Relationship: {}\n\
         - Traits: {}\n\
         - Interests: {}\n\
         - Communication style: {}\n\
         - Relationship strength: {:.1}/1.0\n\
         - Notes: {}\n\n\
         Recent interaction history:\n{}\n\n\
         Goal: {}\n\n\
         How should the user approach {} about this goal? Be specific, practical, and empathetic. \
         Consider their communication style and personality traits. Keep advice under 200 words.",
        contact.name,
        contact.relationship_type,
        contact.traits.join(", "),
        contact.interests.join(", "),
        contact.communication_style,
        contact.relationship_strength,
        crate::safe_slice(&contact.notes, 200),
        interaction_ctx,
        goal,
        contact.name
    );

    llm_complete(&prompt)
        .await
        .unwrap_or_else(|e| format!("Could not generate advice: {e}"))
}

// ── Context injection ─────────────────────────────────────────────────────────

/// If the user message mentions a known contact by name (or alias), return their profile
/// as a formatted context string. Returns empty string if no match found.
pub fn get_social_context(user_message: &str) -> String {
    let contacts = list_contacts();
    if contacts.is_empty() {
        return String::new();
    }

    let msg_lower = user_message.to_lowercase();

    let mut matched: Vec<&Contact> = contacts
        .iter()
        .filter(|c| {
            let name_lower = c.name.to_lowercase();
            // Match first name, full name, or any alias
            let first = name_lower.split_whitespace().next().unwrap_or(&name_lower);
            msg_lower.contains(first)
                || msg_lower.contains(&name_lower)
                || c.aliases.iter().any(|a| msg_lower.contains(&a.to_lowercase()))
        })
        .collect();

    if matched.is_empty() {
        return String::new();
    }

    // Limit to top 3 by relationship strength
    matched.sort_by(|a, b| b.relationship_strength.partial_cmp(&a.relationship_strength).unwrap_or(std::cmp::Ordering::Equal));
    matched.truncate(3);

    let profiles: Vec<String> = matched
        .iter()
        .map(|c| {
            let last = c
                .last_interaction
                .and_then(|t| chrono::DateTime::from_timestamp(t, 0))
                .map(|dt| dt.with_timezone(&chrono::Local).format("%b %-d").to_string())
                .unwrap_or_else(|| "never".to_string());
            format!(
                "**{}** ({}, strength {:.1})\n  Traits: {}\n  Style: {}\n  Last contact: {}\n  Notes: {}",
                c.name,
                c.relationship_type,
                c.relationship_strength,
                if c.traits.is_empty() { "unknown".to_string() } else { c.traits.join(", ") },
                c.communication_style,
                last,
                crate::safe_slice(&c.notes, 150),
            )
        })
        .collect();

    format!("## People Mentioned\n\n{}", profiles.join("\n\n"))
}

/// Short summary of social graph health for system prompt injection.
/// Returns empty string when there are no contacts.
pub fn get_social_summary() -> String {
    let contacts = list_contacts();
    if contacts.is_empty() {
        return String::new();
    }

    let now = chrono::Utc::now().timestamp();
    let thirty_days_ago = now - 30 * 24 * 3600;

    let total = contacts.len();

    // Count contacts needing follow-up (have open action items)
    let mut follow_up_names: Vec<String> = Vec::new();
    for c in &contacts {
        let interactions = get_interactions(&c.id, 1);
        if let Some(i) = interactions.first() {
            if !i.action_items.is_empty() {
                follow_up_names.push(c.name.clone());
            }
        }
    }

    // Count drifted contacts
    let drifted: Vec<String> = contacts
        .iter()
        .filter(|c| c.last_interaction.map(|t| t < thirty_days_ago).unwrap_or(true))
        .map(|c| {
            let days = c.last_interaction
                .map(|t| (now - t) / 86400)
                .map(|d| format!("{d}d ago"))
                .unwrap_or_else(|| "never".to_string());
            format!("{} ({})", c.name, days)
        })
        .take(3)
        .collect();

    let mut parts = vec![format!("Active relationships: {}", total)];

    if !follow_up_names.is_empty() {
        parts.push(format!(
            "Follow-ups needed: {} ({})",
            follow_up_names.len(),
            follow_up_names.join(", ")
        ));
    }

    if !drifted.is_empty() {
        parts.push(format!(
            "Drifting relationships: {}",
            drifted.join(", ")
        ));
    }

    format!("## Social Graph\n\n{}", parts.join(". "))
}

// ── Tauri commands ────────────────────────────────────────────────────────────

#[tauri::command]
pub fn social_add_contact(
    name: String,
    relationship_type: Option<String>,
    traits: Option<Vec<String>>,
    interests: Option<Vec<String>>,
    communication_style: Option<String>,
    notes: Option<String>,
    aliases: Option<Vec<String>>,
) -> Result<String, String> {
    ensure_tables();
    let c = Contact {
        id: Uuid::new_v4().to_string(),
        name,
        aliases: aliases.unwrap_or_default(),
        relationship_type: relationship_type.unwrap_or_else(|| "friend".to_string()),
        traits: traits.unwrap_or_default(),
        interests: interests.unwrap_or_default(),
        communication_style: communication_style.unwrap_or_else(|| "casual".to_string()),
        interaction_count: 0,
        last_interaction: None,
        relationship_strength: 0.3,
        notes: notes.unwrap_or_default(),
        created_at: chrono::Utc::now().timestamp(),
    };
    add_contact(c)
}

#[tauri::command]
pub fn social_get_contact(id: String) -> Option<Contact> {
    ensure_tables();
    get_contact(&id)
}

#[tauri::command]
pub fn social_search_contacts(query: String) -> Vec<Contact> {
    ensure_tables();
    search_contacts(&query)
}

#[tauri::command]
pub fn social_update_contact(id: String, updates: serde_json::Value) -> Result<(), String> {
    ensure_tables();
    update_contact(&id, updates)
}

#[tauri::command]
pub fn social_delete_contact(id: String) -> Result<(), String> {
    ensure_tables();
    delete_contact(&id)
}

#[tauri::command]
pub fn social_list_contacts() -> Vec<Contact> {
    ensure_tables();
    list_contacts()
}

#[tauri::command]
pub fn social_log_interaction(
    contact_id: String,
    summary: String,
    sentiment: Option<String>,
    topics: Option<Vec<String>>,
    action_items: Option<Vec<String>>,
) -> Result<String, String> {
    ensure_tables();
    log_interaction(
        &contact_id,
        &summary,
        &sentiment.unwrap_or_else(|| "neutral".to_string()),
        topics.unwrap_or_default(),
        action_items.unwrap_or_default(),
    )
}

#[tauri::command]
pub fn social_get_interactions(contact_id: String, limit: Option<usize>) -> Vec<Interaction> {
    ensure_tables();
    get_interactions(&contact_id, limit.unwrap_or(20))
}

#[tauri::command]
pub async fn social_analyze_interaction(
    contact_id: String,
    conversation_text: String,
) -> Result<Interaction, String> {
    ensure_tables();
    analyze_interaction(&contact_id, &conversation_text).await
}

#[tauri::command]
pub async fn social_get_insights() -> Vec<RelationshipInsight> {
    ensure_tables();
    generate_relationship_insights().await
}

#[tauri::command]
pub async fn social_how_to_approach(contact_id: String, goal: String) -> String {
    ensure_tables();
    how_to_approach(&contact_id, &goal).await
}
