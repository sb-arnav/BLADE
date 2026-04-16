/// CONSEQUENCE ENGINE — predict outcomes before acting.
///
/// A world model isn't just knowing the current state (world_model.rs does that).
/// It's predicting what WILL happen if you take an action. This is the difference
/// between a reactive tool and an intelligent agent.
///
/// Two layers:
///   Symbolic predictions (fast, deterministic, no LLM):
///     - "delete this file → 3 imports will break" (code dependency graph)
///     - "push to main → CI will run" (workflow knowledge)
///     - "send message at 3am → recipient timezone check"
///     - "git force push → history destroyed" (hard rule)
///
///   Learned predictions (from causal_graph history):
///     - "last time you deployed on this branch, CI failed"
///     - "this person usually takes 2 hours to respond"
///     - "running this command took 5 minutes last time"
///
/// Called by brain_planner after generating a plan, and by commands.rs
/// before executing high-risk tools. Returns warnings that get injected
/// into the context so the LLM (and user) can make informed decisions.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Consequence {
    pub category: String,    // "dependency" | "timing" | "risk" | "history" | "social"
    pub prediction: String,  // what will happen
    pub confidence: f32,     // 0.0-1.0
    pub source: String,      // "symbolic" | "causal_history" | "pattern"
}

/// Predict consequences of a planned action. Returns warnings.
/// Fast path: symbolic rules (no LLM). Slow path: causal history lookup.
pub fn predict_consequences(action: &str) -> Vec<Consequence> {
    let mut consequences = Vec::new();
    let action_lower = action.to_lowercase();

    // ── Symbolic predictions (deterministic, instant) ─────────────────

    // File deletion → dependency check
    if action_lower.contains("delete") && (action_lower.contains("file") || action_lower.contains(".rs") || action_lower.contains(".ts")) {
        // Extract filename if possible
        let potential_file = extract_filename(&action_lower);
        if !potential_file.is_empty() {
            let dependents = check_file_dependents(&potential_file);
            if dependents > 0 {
                consequences.push(Consequence {
                    category: "dependency".to_string(),
                    prediction: format!("{} other files import/reference '{}'. Deleting it will break them.", dependents, potential_file),
                    confidence: 0.9,
                    source: "symbolic".to_string(),
                });
            }
        }
    }

    // Git force push → history destruction
    if action_lower.contains("force push") || action_lower.contains("--force") || action_lower.contains("push -f") {
        consequences.push(Consequence {
            category: "risk".to_string(),
            prediction: "Force push will overwrite remote history. Other contributors' work may be lost.".to_string(),
            confidence: 1.0,
            source: "symbolic".to_string(),
        });
    }

    // Database operations
    if action_lower.contains("drop ") || action_lower.contains("truncate ") || action_lower.contains("delete from") {
        if !action_lower.contains("where") && action_lower.contains("delete from") {
            consequences.push(Consequence {
                category: "risk".to_string(),
                prediction: "DELETE without WHERE clause will remove ALL rows from the table.".to_string(),
                confidence: 1.0,
                source: "symbolic".to_string(),
            });
        }
    }

    // Deploy timing
    if action_lower.contains("deploy") || action_lower.contains("push to prod") || action_lower.contains("release") {
        let now = chrono::Local::now();
        let hour = now.format("%H").to_string().parse::<u32>().unwrap_or(12);
        let day = now.format("%A").to_string();

        if day == "Friday" && hour >= 16 {
            consequences.push(Consequence {
                category: "timing".to_string(),
                prediction: "Deploying on Friday evening means issues won't be caught until Monday.".to_string(),
                confidence: 0.85,
                source: "symbolic".to_string(),
            });
        }
        if hour >= 22 || hour < 6 {
            consequences.push(Consequence {
                category: "timing".to_string(),
                prediction: "Late-night deploy. If something breaks, you're the only one who can fix it.".to_string(),
                confidence: 0.8,
                source: "symbolic".to_string(),
            });
        }
    }

    // Message timing → timezone check
    if (action_lower.contains("send") || action_lower.contains("message") || action_lower.contains("email"))
        && (action_lower.contains("slack") || action_lower.contains("email"))
    {
        let hour = chrono::Local::now().format("%H").to_string().parse::<u32>().unwrap_or(12);
        if hour >= 23 || hour < 7 {
            consequences.push(Consequence {
                category: "social".to_string(),
                prediction: "Sending messages at this hour may disturb the recipient. Consider scheduling for morning.".to_string(),
                confidence: 0.7,
                source: "symbolic".to_string(),
            });
        }
    }

    // npm/pip install without lockfile
    if (action_lower.contains("npm install") || action_lower.contains("pip install"))
        && !action_lower.contains("--save-exact") && !action_lower.contains("==")
    {
        consequences.push(Consequence {
            category: "risk".to_string(),
            prediction: "Installing without pinned version may cause dependency drift across environments.".to_string(),
            confidence: 0.6,
            source: "symbolic".to_string(),
        });
    }

    // ── Learned predictions (from causal_graph history) ──────────────

    let historical = check_causal_history(&action_lower);
    consequences.extend(historical);

    consequences
}

/// Extract a filename from an action description (best-effort).
fn extract_filename(action: &str) -> String {
    // Look for common file patterns
    let extensions = [".rs", ".ts", ".tsx", ".js", ".py", ".go", ".json", ".toml", ".yaml", ".md"];
    for ext in extensions {
        if let Some(pos) = action.find(ext) {
            // Walk backwards to find the start of the filename
            let before = &action[..pos + ext.len()];
            let start = before.rfind(|c: char| c.is_whitespace() || c == '/' || c == '\\')
                .map(|i| i + 1)
                .unwrap_or(0);
            let filename = &before[start..];
            if !filename.is_empty() {
                return filename.to_string();
            }
        }
    }
    String::new()
}

/// Check how many files reference/import a given file.
fn check_file_dependents(filename: &str) -> u32 {
    let db_path = crate::config::blade_config_dir().join("blade.db");
    let conn = match rusqlite::Connection::open(&db_path) {
        Ok(c) => c,
        Err(_) => return 0,
    };

    // Search code_symbols table for references to this file
    let base = std::path::Path::new(filename)
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();

    if base.is_empty() { return 0; }

    // Count how many other files import/use this module
    let search = format!("%{}%", base);
    conn.query_row(
        "SELECT COUNT(DISTINCT file_path) FROM code_symbols WHERE symbol_text LIKE ?1",
        rusqlite::params![search],
        |row| row.get::<_, u32>(0),
    ).unwrap_or(0)
}

/// Look up causal history for similar actions.
fn check_causal_history(action: &str) -> Vec<Consequence> {
    let db_path = crate::config::blade_config_dir().join("blade.db");
    let conn = match rusqlite::Connection::open(&db_path) {
        Ok(c) => c,
        Err(_) => return vec![],
    };

    let mut consequences = Vec::new();

    // Search for past events with similar descriptions
    let search = format!("%{}%", crate::safe_slice(action, 50));
    let cutoff = chrono::Utc::now().timestamp() - 30 * 86400; // last 30 days

    if let Ok(mut stmt) = conn.prepare(
        "SELECT description, context FROM causal_events
         WHERE description LIKE ?1 AND timestamp > ?2
         ORDER BY timestamp DESC LIMIT 5"
    ) {
        let past_events: Vec<(String, String)> = stmt
            .query_map(rusqlite::params![search, cutoff], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .ok()
            .map(|rows| rows.filter_map(|r| r.ok()).collect())
            .unwrap_or_default();

        if past_events.len() >= 2 {
            // Look for error patterns in past similar actions
            let error_count = past_events.iter()
                .filter(|(_, ctx)| {
                    let lower = ctx.to_lowercase();
                    lower.contains("error") || lower.contains("failed") || lower.contains("crash")
                })
                .count();

            if error_count > 0 {
                let rate = error_count as f32 / past_events.len() as f32;
                consequences.push(Consequence {
                    category: "history".to_string(),
                    prediction: format!(
                        "Similar actions had a {:.0}% failure rate in the last 30 days ({}/{} failed).",
                        rate * 100.0, error_count, past_events.len()
                    ),
                    confidence: rate.min(0.9),
                    source: "causal_history".to_string(),
                });
            }
        }
    }

    // Check causal insights for relevant warnings
    if let Ok(mut stmt) = conn.prepare(
        "SELECT title, explanation, confidence FROM causal_insights
         WHERE (title LIKE ?1 OR explanation LIKE ?1) AND acknowledged = 0
         ORDER BY confidence DESC LIMIT 3"
    ) {
        let insights: Vec<(String, String, f64)> = stmt
            .query_map(rusqlite::params![search], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, f64>(2)?))
            })
            .ok()
            .map(|rows| rows.filter_map(|r| r.ok()).collect())
            .unwrap_or_default();

        for (title, explanation, confidence) in insights {
            consequences.push(Consequence {
                category: "pattern".to_string(),
                prediction: format!("{}: {}", title, crate::safe_slice(&explanation, 100)),
                confidence: confidence as f32,
                source: "causal_history".to_string(),
            });
        }
    }

    consequences
}

/// Format consequences as a warning block for brain_planner or tool execution.
pub fn format_warnings(consequences: &[Consequence]) -> String {
    if consequences.is_empty() { return String::new(); }

    let mut lines = vec!["**Predicted consequences:**".to_string()];
    for c in consequences {
        let icon = match c.category.as_str() {
            "risk" => "⚠️",
            "timing" => "⏰",
            "social" => "👤",
            "dependency" => "🔗",
            "history" => "📊",
            "pattern" => "🔄",
            _ => "•",
        };
        lines.push(format!("{} {} ({:.0}% confident)", icon, c.prediction, c.confidence * 100.0));
    }
    lines.join("\n")
}

// ── Tauri Commands ───────────────────────────────────────────────────────────

#[tauri::command]
pub fn consequence_predict(action: String) -> Vec<Consequence> {
    predict_consequences(&action)
}
