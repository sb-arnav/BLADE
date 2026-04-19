/// ACTION TAGS — Semantic action tags embedded in LLM responses.
///
/// The LLM can embed structured commands inside its text output:
///   [ACTION:REMEMBER:fact]
///   [ACTION:REMIND:HH:MM:message]
///   [ACTION:RESEARCH:query]
///   [ACTION:SAVE:filename:content]
///
/// `extract_actions` strips these from the visible text and returns them as
/// structured `ParsedAction` values. `execute_actions` dispatches each one.

use tauri::Emitter;

/// A single parsed action tag from LLM output.
#[derive(Debug, Clone)]
pub struct ParsedAction {
    pub tag: String,
    pub args: Vec<String>,
}

/// Strip all `[ACTION:TAG:arg1:arg2:...]` occurrences from `text`.
/// Returns `(clean_text, actions)`.
pub fn extract_actions(text: &str) -> (String, Vec<ParsedAction>) {
    let mut actions = Vec::new();
    let mut clean = String::with_capacity(text.len());
    let mut remaining = text;

    while let Some(start) = remaining.find("[ACTION:") {
        // Append everything before the tag
        clean.push_str(&remaining[..start]);

        // Skip the '[', look for matching ']'
        let after_open = &remaining[start + 1..];
        if let Some(end_rel) = after_open.find(']') {
            // tag_content = "ACTION:REMIND:17:00:check build status"
            let tag_content = &after_open[..end_rel];
            // Split into ["ACTION", "REMIND", "17", "00", "check build status"]
            let parts: Vec<&str> = tag_content.splitn(3, ':').collect();
            // parts[0]="ACTION", parts[1]=tag_name, parts[2]=rest_of_args
            if parts.len() >= 2 && parts[0] == "ACTION" {
                let tag = parts[1].to_string();
                // For the args, split the remainder on ':' further
                let args: Vec<String> = if parts.len() > 2 {
                    parts[2].split(':').map(|s| s.to_string()).collect()
                } else {
                    Vec::new()
                };
                actions.push(ParsedAction { tag, args });
            }

            // Advance past the closing ']', optionally eating one trailing space
            let after_tag = &after_open[end_rel + 1..];
            remaining = if after_tag.starts_with(' ') && !after_tag.starts_with("  ") {
                &after_tag[1..]
            } else {
                after_tag
            };
        } else {
            // No closing bracket — treat as literal text
            clean.push('[');
            remaining = &remaining[start + 1..];
        }
    }

    clean.push_str(remaining);

    // Collapse any double-spaces introduced by tag removal
    let clean = clean.replace("  ", " ");
    let clean = clean.trim().to_string();

    (clean, actions)
}

/// Execute a list of parsed actions. Each runs concurrently in a background task.
pub async fn execute_actions(actions: Vec<ParsedAction>, app: &tauri::AppHandle) {
    for action in actions {
        let app2 = app.clone();
        tokio::spawn(async move {
            dispatch_action(action, app2).await;
        });
    }
}

async fn dispatch_action(action: ParsedAction, app: tauri::AppHandle) {
    match action.tag.to_uppercase().as_str() {
        "REMEMBER" => {
            let fact = action.args.join(" ");
            if fact.is_empty() {
                return;
            }
            // Grow knowledge graph from the fact (same pipeline used post-conversation)
            let full_text = format!("Remember this fact: {}", fact);
            crate::knowledge_graph::grow_graph_from_conversation(&full_text).await;

            // Also store as a short-term memory entity
            let n = crate::brain::extract_entities_from_exchange("", &fact).await;
            if n > 0 {
                let _ = app.emit_to("main", "brain_grew", serde_json::json!({ "new_entities": n }));
            }
            log::info!("[action_tags] REMEMBER executed: {}", crate::safe_slice(&fact, 80));
        }

        "REMIND" => {
            // Format: REMIND:HH:MM:message   or  REMIND:HH:MM
            // args[0] = HH, args[1] = MM, args[2..] = message words
            if action.args.len() < 2 {
                log::warn!("[action_tags] REMIND: too few args {:?}", action.args);
                return;
            }
            let hh: u32 = action.args[0].parse().unwrap_or(0);
            let mm: u32 = action.args[1].parse().unwrap_or(0);
            let message = if action.args.len() > 2 {
                action.args[2..].join(" ")
            } else {
                "BLADE Reminder".to_string()
            };

            // Compute unix timestamp for today at HH:MM (or tomorrow if already passed)
            let now = chrono::Local::now();
            let today_candidate = now
                .date_naive()
                .and_hms_opt(hh, mm, 0);

            let fire_at = if let Some(naive_dt) = today_candidate {
                let local_dt = naive_dt.and_local_timezone(chrono::Local).single();
                if let Some(ldt) = local_dt {
                    let ts = ldt.timestamp();
                    if ts > chrono::Utc::now().timestamp() {
                        ts
                    } else {
                        // Already passed today — schedule for tomorrow
                        ts + 86400
                    }
                } else {
                    chrono::Utc::now().timestamp() + 3600 // fallback: 1 hour
                }
            } else {
                chrono::Utc::now().timestamp() + 3600
            };

            match crate::reminders::reminder_add(message.clone(), String::new(), fire_at) {
                Ok(id) => {
                    let _ = app.emit_to("main", "blade_reminder_created", serde_json::json!({
                        "id": id,
                        "title": message,
                        "source": "action_tag",
                        "fire_at": fire_at,
                    }));
                    log::info!("[action_tags] REMIND set: '{}' at {}:{:02}", message, hh, mm);
                }
                Err(e) => {
                    log::warn!("[action_tags] REMIND failed: {}", e);
                }
            }
        }

        "RESEARCH" => {
            let query = action.args.join(" ");
            if query.is_empty() {
                return;
            }
            log::info!("[action_tags] RESEARCH spawning background task: {}", crate::safe_slice(&query, 80));
            // Emit notification so UI shows that research is happening
            let _ = app.emit_to("main", "blade_notification", serde_json::json!({
                "type": "info",
                "message": format!("Researching: {}", crate::safe_slice(&query, 60))
            }));

            // Use autonomous research — detect gap and trigger background research
            crate::autonomous_research::detect_gaps_from_conversation(&query, "").await;
        }

        "SAVE" => {
            // Format: SAVE:filename:content
            if action.args.is_empty() {
                log::warn!("[action_tags] SAVE: missing filename");
                return;
            }
            let filename = action.args[0].clone();
            let content = if action.args.len() > 1 {
                action.args[1..].join(":")
            } else {
                String::new()
            };

            // Save to BLADE config dir / saved_files / filename
            let dir = crate::config::blade_config_dir().join("saved_files");
            if std::fs::create_dir_all(&dir).is_ok() {
                let path = dir.join(&filename);
                match std::fs::write(&path, &content) {
                    Ok(_) => {
                        let _ = app.emit_to("main", "blade_notification", serde_json::json!({
                            "type": "success",
                            "message": format!("Saved: {}", filename)
                        }));
                        log::info!("[action_tags] SAVE wrote: {}", path.display());
                    }
                    Err(e) => {
                        log::warn!("[action_tags] SAVE failed for '{}': {}", filename, e);
                    }
                }
            }
        }

        unknown => {
            log::debug!("[action_tags] unknown action tag: {}", unknown);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_single_remember() {
        let input = "Here is your answer. [ACTION:REMEMBER:Arnav prefers dark mode]";
        let (clean, actions) = extract_actions(input);
        assert_eq!(clean, "Here is your answer.");
        assert_eq!(actions.len(), 1);
        assert_eq!(actions[0].tag, "REMEMBER");
        assert_eq!(actions[0].args, vec!["Arnav prefers dark mode"]);
    }

    #[test]
    fn test_extract_remind() {
        let input = "Got it, I'll remind you at 5pm. [ACTION:REMIND:17:00:check build status]";
        let (clean, actions) = extract_actions(input);
        assert!(clean.contains("Got it"));
        assert!(!clean.contains("[ACTION:"));
        assert_eq!(actions.len(), 1);
        assert_eq!(actions[0].tag, "REMIND");
        assert_eq!(actions[0].args[0], "17");
        assert_eq!(actions[0].args[1], "00");
        assert_eq!(actions[0].args[2], "check build status");
    }

    #[test]
    fn test_no_actions() {
        let input = "Nothing special here.";
        let (clean, actions) = extract_actions(input);
        assert_eq!(clean, "Nothing special here.");
        assert!(actions.is_empty());
    }

    #[test]
    fn test_multiple_actions() {
        let input = "Done! [ACTION:REMEMBER:user likes Rust] [ACTION:RESEARCH:async runtimes]";
        let (clean, actions) = extract_actions(input);
        assert!(!clean.contains("[ACTION:"));
        assert_eq!(actions.len(), 2);
        assert_eq!(actions[0].tag, "REMEMBER");
        assert_eq!(actions[1].tag, "RESEARCH");
    }
}
