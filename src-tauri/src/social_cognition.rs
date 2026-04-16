/// SOCIAL COGNITION — understanding social dynamics, not just individual people.
///
/// people_graph.rs tracks WHO people are.
/// social_graph.rs tracks interactions.
/// social_cognition.rs understands the DYNAMICS:
///   - How to communicate with each person appropriately
///   - Relationship context (who's connected to whom, power dynamics)
///   - Social timing (when to reach out, when to wait)
///   - Conflict awareness (tensions between people)
///   - Communication channel selection (email vs slack vs in-person)
///
/// Injected into brain.rs when the query involves people or communication.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SocialAdvice {
    pub person: String,
    pub relationship: String,
    pub tone: String,
    pub channel: String,
    pub timing: String,
    pub warnings: Vec<String>,
}

/// Get social intelligence for a communication task.
/// "I need to tell John the deadline is moving" → advice on HOW to tell John.
pub fn get_social_advice(query: &str) -> Vec<SocialAdvice> {
    let mut advice_list = Vec::new();

    // Find mentioned people
    let people = crate::people_graph::people_list_pub();
    let query_lower = query.to_lowercase();

    for person in &people {
        if !query_lower.contains(&person.name.to_lowercase()) {
            continue;
        }

        let mut warnings = Vec::new();

        // Tone advice based on relationship + communication style
        let tone = match (person.relationship.as_str(), person.communication_style.as_str()) {
            ("manager" | "boss", _) => "professional, concise, lead with the conclusion",
            ("client", _) => "polished, solution-oriented, never blame",
            ("friend", "casual") => "casual, direct",
            ("teammate", "technical") => "technical, specific, include context",
            ("teammate", "brief") => "brief, bullet points",
            (_, "formal") => "formal, structured",
            _ => "match their usual style",
        };

        // Channel selection based on urgency + relationship
        let is_urgent = query_lower.contains("urgent") || query_lower.contains("asap")
            || query_lower.contains("critical") || query_lower.contains("immediately");
        let is_bad_news = query_lower.contains("delay") || query_lower.contains("problem")
            || query_lower.contains("issue") || query_lower.contains("failed")
            || query_lower.contains("can't") || query_lower.contains("won't make");

        let channel = if is_urgent {
            "Direct message (Slack DM or call) — don't use email for urgent matters"
        } else if is_bad_news && (person.relationship == "manager" || person.relationship == "client") {
            "Private conversation (DM or call) — don't share bad news in group channels"
        } else {
            match person.platform.as_str() {
                "slack" => "Slack (their preferred platform)",
                "email" => "Email (their preferred platform)",
                "whatsapp" => "WhatsApp (personal — use only if appropriate)",
                _ => "Their usual communication channel",
            }
        };

        // Timing advice
        let now_hour = chrono::Local::now().format("%H").to_string()
            .parse::<u32>().unwrap_or(12);
        let timing = if now_hour < 8 || now_hour > 21 {
            "Consider scheduling for business hours — it's outside normal work time".to_string()
        } else if person.last_interaction > 0 {
            let days_since = (chrono::Utc::now().timestamp() - person.last_interaction) / 86400;
            if days_since > 30 {
                format!("Haven't interacted in {} days — consider adding context/reintroduction", days_since)
            } else {
                "Good timing — recent interaction history".to_string()
            }
        } else {
            "No interaction history — be more formal initially".to_string()
        };

        // Social warnings
        if is_bad_news && person.relationship == "manager" {
            warnings.push("Lead with the impact and your proposed solution, not just the problem".to_string());
        }
        if is_bad_news && person.relationship == "client" {
            warnings.push("Frame as 'revised timeline' not 'delay' — always include the new plan".to_string());
        }
        if person.interaction_count == 0 {
            warnings.push("First interaction — introduce yourself and your role".to_string());
        }
        if !person.notes.is_empty() {
            warnings.push(format!("Note: {}", crate::safe_slice(&person.notes, 80)));
        }

        advice_list.push(SocialAdvice {
            person: person.name.clone(),
            relationship: person.relationship.clone(),
            tone: tone.to_string(),
            channel: channel.to_string(),
            timing,
            warnings,
        });
    }

    advice_list
}

/// Format social advice for brain.rs prompt injection.
pub fn get_social_injection(query: &str) -> String {
    // Only inject for communication-related queries
    let q = query.to_lowercase();
    let is_social = q.contains("message") || q.contains("email") || q.contains("tell")
        || q.contains("reply") || q.contains("respond") || q.contains("send")
        || q.contains("slack") || q.contains("draft") || q.contains("write to")
        || q.contains("let them know") || q.contains("inform") || q.contains("update");

    if !is_social { return String::new(); }

    let advice = get_social_advice(query);
    if advice.is_empty() { return String::new(); }

    let mut lines = vec!["## Social Context".to_string()];

    for a in &advice {
        lines.push(format!("**{}** ({})", a.person, a.relationship));
        lines.push(format!("- Tone: {}", a.tone));
        lines.push(format!("- Channel: {}", a.channel));
        lines.push(format!("- Timing: {}", a.timing));
        for w in &a.warnings {
            lines.push(format!("- ⚠️ {}", w));
        }
    }

    lines.join("\n")
}

// ── Tauri Commands ───────────────────────────────────────────────────────────

#[tauri::command]
pub fn social_get_advice(query: String) -> Vec<SocialAdvice> {
    get_social_advice(&query)
}
