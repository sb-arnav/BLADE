/// DNA — BLADE's shared knowledge query layer.
///
/// Every organ writes observations into existing data stores (typed_memory,
/// people_graph, knowledge_graph, persona_engine, etc.). DNA provides a
/// unified query interface so the Brain planner can ask "who is the user?",
/// "what do we know about this person?", "what patterns have we observed?"
/// without knowing which module stores what.
///
/// DNA does NOT store data itself — it's a facade over existing tables.
/// Think of it as the body's collective memory, queryable in one place.

use crate::config::blade_config_dir;

// ── Identity ─────────────────────────────────────────────────────────────────

/// Compact identity summary (~3-5 lines). Who is the user?
pub fn get_identity() -> String {
    let mut lines: Vec<String> = Vec::new();

    // Persona file (user-written self-description)
    let persona_path = blade_config_dir().join("persona.md");
    if let Ok(persona) = std::fs::read_to_string(&persona_path) {
        let trimmed = persona.trim();
        if !trimmed.is_empty() {
            // Take first 3 lines — enough to know who they are
            let preview: String = trimmed
                .lines()
                .take(3)
                .collect::<Vec<&str>>()
                .join("\n");
            lines.push(preview);
        }
    }

    // Top personality traits
    let traits = crate::persona_engine::get_all_traits();
    let top: Vec<String> = traits
        .iter()
        .filter(|t| t.confidence > 0.5 && t.score > 0.4)
        .take(5)
        .map(|t| t.trait_name.clone())
        .collect();
    if !top.is_empty() {
        lines.push(format!("Traits: {}", top.join(", ")));
    }

    lines.join("\n")
}

// ── Voice & Communication Style ──────────────────────────────────────────────

/// How the user communicates. Pulls from personality_mirror.
pub fn get_voice() -> Option<String> {
    crate::personality_mirror::get_personality_injection()
}

// ── People ───────────────────────────────────────────────────────────────────

/// Get everything BLADE knows about a specific person.
pub fn get_person(name: &str) -> Option<String> {
    let person = crate::people_graph::get_person(name)?;
    let mut lines = Vec::new();
    lines.push(format!("**{}**", person.name));
    if !person.role.is_empty() {
        lines.push(format!("Role: {}", person.role));
    }
    if !person.relationship.is_empty() {
        lines.push(format!("Relationship: {}", person.relationship));
    }
    if !person.communication_style.is_empty() {
        lines.push(format!("Style: {}", person.communication_style));
    }
    if !person.notes.is_empty() {
        lines.push(format!("Notes: {}", crate::safe_slice(&person.notes, 200)));
    }
    Some(lines.join("\n"))
}

/// Get context about mentioned people — for Brain to understand who's involved.
pub fn get_people_context(names: &[String]) -> String {
    crate::people_graph::get_people_context_for_prompt(names)
}

/// List all known people (compact, for Brain's awareness).
pub fn get_known_people_summary() -> String {
    let people = crate::people_graph::people_list_pub();
    if people.is_empty() {
        return String::new();
    }
    let names: Vec<String> = people
        .iter()
        .take(20)
        .map(|p| {
            if p.role.is_empty() {
                p.name.clone()
            } else {
                format!("{} ({})", p.name, p.role)
            }
        })
        .collect();
    format!("**Known people:** {}", names.join(", "))
}

// ── Patterns & Observations ──────────────────────────────────────────────────

/// What recurring behaviors has BLADE observed?
pub fn get_patterns() -> String {
    let db_path = blade_config_dir().join("blade.db");
    let conn = match rusqlite::Connection::open(&db_path) {
        Ok(c) => c,
        Err(_) => return String::new(),
    };

    // Pull from behavior_patterns (learning_engine's table)
    let mut stmt = match conn.prepare(
        "SELECT description, frequency, confidence FROM behavior_patterns
         WHERE confidence > 0.5
         ORDER BY frequency DESC, confidence DESC
         LIMIT 8"
    ) {
        Ok(s) => s,
        Err(_) => return String::new(),
    };

    let patterns: Vec<String> = stmt
        .query_map([], |row| {
            let desc: String = row.get(0)?;
            let freq: i64 = row.get(1)?;
            let conf: f64 = row.get(2)?;
            Ok(format!(
                "- {} (seen {}x, {:.0}% confident)",
                crate::safe_slice(&desc, 100),
                freq,
                conf * 100.0
            ))
        })
        .ok()
        .map(|rows| rows.filter_map(|r| r.ok()).collect())
        .unwrap_or_default();

    if patterns.is_empty() {
        return String::new();
    }
    format!("**Observed patterns:**\n{}", patterns.join("\n"))
}

// ── Expertise ────────────────────────────────────────────────────────────────

/// What does the user know? What are they learning?
pub fn get_expertise() -> String {
    use crate::typed_memory::{recall_by_category, MemoryCategory};

    let skills = recall_by_category(MemoryCategory::Skill, 10);
    if skills.is_empty() {
        return String::new();
    }

    let skill_lines: Vec<String> = skills
        .iter()
        .take(8)
        .map(|m| format!("- {}", crate::safe_slice(&m.content, 80)))
        .collect();

    format!("**Skills & expertise:**\n{}", skill_lines.join("\n"))
}

// ── Goals ────────────────────────────────────────────────────────────────────

/// What is the user trying to achieve?
pub fn get_goals() -> String {
    let goals = crate::goal_engine::get_active_goals();
    if goals.is_empty() {
        return String::new();
    }

    let goal_lines: Vec<String> = goals
        .iter()
        .take(5)
        .map(|g| {
            let progress = if g.progress > 0 {
                format!(" ({}%)", g.progress)
            } else {
                String::new()
            };
            format!("- {}{}", crate::safe_slice(&g.title, 80), progress)
        })
        .collect();

    format!("**Active goals:**\n{}", goal_lines.join("\n"))
}

// ── Activity & Journal ───────────────────────────────────────────────────────

/// What has the user been doing today?
pub fn get_today_activity() -> String {
    crate::activity_monitor::get_activity_context()
}

// ── Infrastructure & Services ────────────────────────────────────────────────

/// What tools/services is BLADE connected to?
pub fn get_active_integrations() -> String {
    let istate = crate::integration_bridge::get_integration_state();
    let mut parts: Vec<String> = Vec::new();

    if istate.unread_emails > 0 {
        parts.push(format!("Email: {} unread", istate.unread_emails));
    }
    if istate.slack_mentions > 0 {
        parts.push(format!("Slack: {} mentions", istate.slack_mentions));
    }
    if istate.github_notifications > 0 {
        parts.push(format!("GitHub: {} notifications", istate.github_notifications));
    }
    if !istate.upcoming_events.is_empty() {
        parts.push(format!("Calendar: {} upcoming", istate.upcoming_events.len()));
    }

    if parts.is_empty() {
        return String::new();
    }
    format!("**Integrations:** {}", parts.join(" | "))
}

// ── Decisions & History ──────────────────────────────────────────────────────

/// Recent decisions BLADE made — so it doesn't repeat mistakes.
pub fn get_recent_decisions() -> String {
    use crate::typed_memory::{recall_by_category, MemoryCategory};

    let decisions = recall_by_category(MemoryCategory::Decision, 5);
    if decisions.is_empty() {
        return String::new();
    }

    let lines: Vec<String> = decisions
        .iter()
        .take(5)
        .map(|m| format!("- {}", crate::safe_slice(&m.content, 100)))
        .collect();

    format!("**Recent decisions:**\n{}", lines.join("\n"))
}

// ── Full DNA Query (for Brain planner) ───────────────────────────────────────

/// Assemble a compact DNA summary relevant to a given query.
/// This is the main entry point for the Brain planner — it returns
/// only the DNA sections that are relevant to the current task.
///
/// Total output is capped at ~2000 chars to keep Brain prompts small.
pub fn query_for_brain(user_query: &str) -> String {
    let mut sections: Vec<String> = Vec::new();
    let query_lower = user_query.to_lowercase();

    // Identity is always included (tiny, ~3-5 lines)
    let identity = get_identity();
    if !identity.is_empty() {
        sections.push(identity);
    }

    // People context — if the query mentions names
    let people = crate::people_graph::people_list_pub();
    let mentioned: Vec<String> = people
        .iter()
        .filter(|p| query_lower.contains(&p.name.to_lowercase()))
        .map(|p| p.name.clone())
        .collect();
    if !mentioned.is_empty() {
        let ctx = get_people_context(&mentioned);
        if !ctx.is_empty() {
            sections.push(ctx);
        }
    }

    // Goals — if query seems goal/progress/planning related
    let goal_keywords = ["goal", "plan", "progress", "objective", "milestone", "target", "achieve", "priority"];
    if goal_keywords.iter().any(|k| query_lower.contains(k)) {
        let goals = get_goals();
        if !goals.is_empty() {
            sections.push(goals);
        }
    }

    // Expertise — if query is about skills, learning, or capabilities
    let skill_keywords = ["skill", "learn", "know", "expert", "experience", "capable", "can you", "can I"];
    if skill_keywords.iter().any(|k| query_lower.contains(k)) {
        let expertise = get_expertise();
        if !expertise.is_empty() {
            sections.push(expertise);
        }
    }

    // Integrations — always useful context (very compact)
    let integrations = get_active_integrations();
    if !integrations.is_empty() {
        sections.push(integrations);
    }

    // Patterns — if query involves habits, routines, or predictions
    let pattern_keywords = ["pattern", "usually", "habit", "routine", "always", "tend to", "predict"];
    if pattern_keywords.iter().any(|k| query_lower.contains(k)) {
        let patterns = get_patterns();
        if !patterns.is_empty() {
            sections.push(patterns);
        }
    }

    // Voice — if query involves communication/writing on behalf of user
    let voice_keywords = ["post", "reply", "write", "draft", "email", "message", "tweet", "slack", "say", "respond"];
    if voice_keywords.iter().any(|k| query_lower.contains(k)) {
        if let Some(voice) = get_voice() {
            sections.push(voice);
        }
    }

    // Cap total output
    let mut result = sections.join("\n\n");
    if result.len() > 2000 {
        result = crate::safe_slice(&result, 2000).to_string();
    }
    result
}

// ── Tauri Commands ───────────────────────────────────────────────────────────

#[tauri::command]
pub fn dna_get_identity() -> String {
    get_identity()
}

#[tauri::command]
pub fn dna_get_goals() -> String {
    get_goals()
}

#[tauri::command]
pub fn dna_get_patterns() -> String {
    get_patterns()
}

#[tauri::command]
pub fn dna_query(query: String) -> String {
    query_for_brain(&query)
}
