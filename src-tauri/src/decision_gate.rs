/// Decision Gate — BLADE's autonomous decision classifier.
///
/// Given a signal + a `PerceptionState`, decides in microseconds whether to:
///   ActAutonomously — safe, reversible, high-confidence, user is idle
///   AskUser         — irreversible, low-confidence, or needs human judgment
///   QueueForLater   — not urgent, medium confidence
///   Ignore          — too weak a signal, not worth surfacing
///
/// Decision logic: rule-based for the 80% case, cheap LLM call only for the
/// genuinely ambiguous middle (0.5-0.9 confidence, reversible, time-sensitive).
///
/// All decisions are appended to a static ring buffer (max 100) and exposed via
/// `get_decision_log`. Feedback from `decision_feedback` nudges the per-source
/// confidence threshold so BLADE learns each user's tolerance for autonomy.

use std::sync::{Mutex, OnceLock};
use std::collections::HashMap;
use serde::{Deserialize, Serialize};
use crate::perception_fusion::PerceptionState;

// ── Types ─────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum Priority {
    Critical,
    High,
    Medium,
    Low,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "data")]
pub enum DecisionOutcome {
    ActAutonomously {
        action: String,
        reasoning: String,
    },
    AskUser {
        question: String,
        suggested_action: String,
    },
    QueueForLater {
        task: String,
        priority: Priority,
    },
    Ignore {
        reason: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Signal {
    pub source: String,      // "clipboard" | "error_detection" | "proactive_engine" | "god_mode"
    pub description: String,
    pub confidence: f64,     // 0.0 – 1.0
    pub reversible: bool,
    pub time_sensitive: bool,
}

// ── Persisted decision record ─────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DecisionRecord {
    pub id: String,
    pub signal: Signal,
    pub outcome: DecisionOutcome,
    pub timestamp: i64,
    /// None = pending, Some(true) = correct, Some(false) = incorrect
    pub feedback: Option<bool>,
}

// ── Ring buffer (max 100) — uses VecDeque for O(1) front removal ──────────────

const RING_MAX: usize = 100;

static DECISION_LOG: OnceLock<Mutex<std::collections::VecDeque<DecisionRecord>>> = OnceLock::new();

fn decision_log() -> &'static Mutex<std::collections::VecDeque<DecisionRecord>> {
    DECISION_LOG.get_or_init(|| Mutex::new(std::collections::VecDeque::new()))
}

fn push_decision(record: DecisionRecord) {
    if let Ok(mut log) = decision_log().lock() {
        if log.len() >= RING_MAX {
            log.pop_front();
        }
        log.push_back(record);
    }
}

// ── Per-source confidence threshold adjustments ───────────────────────────────
//
// When `decision_feedback(id, was_correct=false)` is called, we bump up the
// threshold for that source by THRESHOLD_STEP so BLADE requires stronger
// evidence before acting autonomously in the future.
// When `was_correct=true`, we slightly lower the threshold (reward correct calls).
// Thresholds are persisted to blade.db (settings table) so they survive restarts.

const THRESHOLD_STEP_PENALTY: f64 = 0.05;
const THRESHOLD_STEP_REWARD: f64 = 0.02;
const THRESHOLD_MIN: f64 = 0.5;
const THRESHOLD_MAX: f64 = 0.98;
const THRESHOLD_DB_KEY: &str = "decision_gate_thresholds";

static SOURCE_THRESHOLDS: OnceLock<Mutex<HashMap<String, f64>>> = OnceLock::new();

fn source_thresholds() -> &'static Mutex<HashMap<String, f64>> {
    SOURCE_THRESHOLDS.get_or_init(|| {
        // Try to load persisted thresholds from DB on first access
        Mutex::new(load_thresholds_from_db().unwrap_or_default())
    })
}

/// Load threshold map from the settings table in blade.db.
fn load_thresholds_from_db() -> Option<HashMap<String, f64>> {
    let db_path = crate::config::blade_config_dir().join("blade.db");
    let conn = rusqlite::Connection::open(&db_path).ok()?;
    let json: String = conn
        .query_row(
            "SELECT value FROM settings WHERE key = ?1",
            rusqlite::params![THRESHOLD_DB_KEY],
            |row| row.get(0),
        )
        .ok()?;
    serde_json::from_str(&json).ok()
}

/// Persist the current threshold map to blade.db settings.
fn persist_thresholds() {
    let map = match source_thresholds().lock() {
        Ok(m) => m.clone(),
        Err(_) => return,
    };
    let json = match serde_json::to_string(&map) {
        Ok(j) => j,
        Err(_) => return,
    };
    let db_path = crate::config::blade_config_dir().join("blade.db");
    if let Ok(conn) = rusqlite::Connection::open(&db_path) {
        let _ = conn.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            rusqlite::params![THRESHOLD_DB_KEY, json],
        );
    }
}

/// Get the effective "act autonomously" threshold for a given source.
/// Defaults to 0.9 (the base rule) if no adjustment has been made yet.
fn effective_threshold(source: &str) -> f64 {
    source_thresholds()
        .lock()
        .ok()
        .and_then(|m| m.get(source).copied())
        .unwrap_or(0.9)
}

fn adjust_threshold(source: &str, was_correct: bool) {
    if let Ok(mut thresholds) = source_thresholds().lock() {
        let current = thresholds.get(source).copied().unwrap_or(0.9);
        let new_val = if was_correct {
            (current - THRESHOLD_STEP_REWARD).max(THRESHOLD_MIN)
        } else {
            (current + THRESHOLD_STEP_PENALTY).min(THRESHOLD_MAX)
        };
        thresholds.insert(source.to_string(), new_val);
    }
}

// ── Core decision evaluator ───────────────────────────────────────────────────

/// Classify a signal against the current perception context.
/// Uses rules first; calls LLM only for genuinely ambiguous cases.
pub async fn evaluate(signal: &Signal, perception: &PerceptionState) -> DecisionOutcome {
    let c = signal.confidence;
    let act_threshold = effective_threshold(&signal.source);

    // ── Rule 1: Very weak signal → ignore immediately ─────────────────────────
    if c < 0.3 {
        return DecisionOutcome::Ignore {
            reason: format!(
                "Signal confidence too low ({:.0}%) to act on.",
                c * 100.0
            ),
        };
    }

    // ── Rule 2: Irreversible action → always ask the user ────────────────────
    if !signal.reversible {
        return DecisionOutcome::AskUser {
            question: format!(
                "This action cannot be undone: {}. Should I proceed?",
                signal.description
            ),
            suggested_action: signal.description.clone(),
        };
    }

    // From here: reversible action, confidence >= 0.3

    // ── Rule 3: Low confidence (0.3–0.5) → ask ───────────────────────────────
    if c < 0.5 {
        return DecisionOutcome::AskUser {
            question: format!(
                "I'm not very confident about this ({:.0}%). Should I: {}?",
                c * 100.0,
                signal.description
            ),
            suggested_action: signal.description.clone(),
        };
    }

    // From here: reversible, confidence >= 0.5

    // ── Rule 4: High confidence + user is idle → act autonomously ────────────
    let mut outcome_candidate: Option<DecisionOutcome> = None;
    if c >= act_threshold && perception.user_state == "idle" {
        outcome_candidate = Some(DecisionOutcome::ActAutonomously {
            action: signal.description.clone(),
            reasoning: format!(
                "High confidence ({:.0}%), reversible action, user is idle — safe to proceed.",
                c * 100.0
            ),
        });
    }

    // ── Rule 5: High confidence + user focused + time-sensitive → act ────────
    if outcome_candidate.is_none() && c >= act_threshold && signal.time_sensitive {
        outcome_candidate = Some(DecisionOutcome::ActAutonomously {
            action: signal.description.clone(),
            reasoning: format!(
                "High confidence ({:.0}%), reversible, time-sensitive — acting now.",
                c * 100.0
            ),
        });
    }

    // ── Safety pre-check: danger-triple override (Phase 26 / SAFE-01 / D-02) ──
    if let Some(ref candidate) = outcome_candidate {
        if matches!(candidate, DecisionOutcome::ActAutonomously { .. }) {
            if crate::safety_bundle::check_danger_triple(signal, perception).await {
                return DecisionOutcome::AskUser {
                    question: format!(
                        "[Safety] This action triggers danger-triple detection \
                         (tool access + shutdown threat + goal conflict). \
                         Explicit approval required: {}",
                        signal.description
                    ),
                    suggested_action: signal.description.clone(),
                };
            }
        }
    }

    if let Some(outcome) = outcome_candidate {
        return outcome;
    }

    // ── Rule 6: Not urgent + medium confidence → queue ───────────────────────
    if !signal.time_sensitive {
        let priority = if c >= act_threshold {
            Priority::High
        } else if c >= 0.7 {
            Priority::High
        } else if c >= 0.55 {
            Priority::Medium
        } else {
            Priority::Low
        };
        return DecisionOutcome::QueueForLater {
            task: signal.description.clone(),
            priority,
        };
    }

    // ── Rule 7: Ambiguous zone (0.5–threshold, reversible, time-sensitive) ────
    // Call cheap LLM to classify. On any error, fall back to AskUser.
    if c < act_threshold && signal.time_sensitive {
        if let Some(outcome) = llm_classify(signal, perception).await {
            return outcome;
        }
    }

    // ── Fallback ──────────────────────────────────────────────────────────────
    DecisionOutcome::AskUser {
        question: format!(
            "I need guidance on: {}",
            signal.description
        ),
        suggested_action: signal.description.clone(),
    }
}

/// Cheap LLM triage for ambiguous signals.
/// Returns None on any provider error so the caller can fall back gracefully.
async fn llm_classify(signal: &Signal, perception: &PerceptionState) -> Option<DecisionOutcome> {
    let config = crate::config::load_config();
    if config.api_key.is_empty() && config.provider != "ollama" {
        return None;
    }

    let cheap_model = crate::config::cheap_model_for_provider(&config.provider, &config.model);

    let system_prompt =
        "You are BLADE's autonomous decision classifier. \
         Respond with exactly one word on line 1: ACT | ASK | QUEUE | IGNORE. \
         Then on line 2, one sentence of reasoning. No other text.\n\
         Rules:\n\
         - ACT = safe, reversible, high-value, user won't be disrupted\n\
         - ASK = needs user judgment, significant impact, or ambiguous intent\n\
         - QUEUE = useful but not urgent; can wait\n\
         - IGNORE = low value, noise, or already handled";

    let user_prompt = format!(
        "Signal:\n  Source: {}\n  Description: {}\n  Confidence: {:.0}%\n  Reversible: {}\n  Time-sensitive: {}\n\nUser context:\n  App: {} — {}\n  State: {}\n  Active tags: {}",
        signal.source,
        signal.description,
        signal.confidence * 100.0,
        signal.reversible,
        signal.time_sensitive,
        perception.active_app,
        crate::safe_slice(&perception.active_title, 60),
        perception.user_state,
        perception.context_tags.join(", "),
    );

    let msgs = vec![
        crate::providers::ConversationMessage::System(system_prompt.to_string()),
        crate::providers::ConversationMessage::User(user_prompt),
    ];
    let turn = crate::providers::complete_turn(
        &config.provider,
        &config.api_key,
        &cheap_model,
        &msgs,
        &[],
        config.base_url.as_deref(),
    )
    .await
    .ok()?;

    let response = turn.content.trim().to_string();
    let lines: Vec<&str> = response.lines().collect();
    let verdict = lines.first().map(|l| l.trim().to_uppercase()).unwrap_or_default();
    let reasoning = lines.get(1).map(|l| l.trim().to_string()).unwrap_or_default();

    match verdict.as_str() {
        "ACT" => Some(DecisionOutcome::ActAutonomously {
            action: signal.description.clone(),
            reasoning: if reasoning.is_empty() {
                "LLM classifier: act autonomously".to_string()
            } else {
                reasoning
            },
        }),
        "ASK" => Some(DecisionOutcome::AskUser {
            question: format!("Should I: {}?", signal.description),
            suggested_action: signal.description.clone(),
        }),
        "QUEUE" => Some(DecisionOutcome::QueueForLater {
            task: signal.description.clone(),
            priority: Priority::Medium,
        }),
        "IGNORE" => Some(DecisionOutcome::Ignore {
            reason: if reasoning.is_empty() {
                "LLM classifier: ignore".to_string()
            } else {
                reasoning
            },
        }),
        _ => None,
    }
}

// ── Convenience: evaluate + record ───────────────────────────────────────────

/// Evaluate a signal, record the decision, and return both the record ID and the outcome.
pub async fn evaluate_and_record(
    signal: Signal,
    perception: &PerceptionState,
) -> (String, DecisionOutcome) {
    let outcome = evaluate(&signal, perception).await;
    let id = format!("dg-{}", chrono::Utc::now().timestamp_millis());
    let record = DecisionRecord {
        id: id.clone(),
        signal,
        outcome: outcome.clone(),
        timestamp: chrono::Utc::now().timestamp(),
        feedback: None,
    };
    push_decision(record);
    (id, outcome)
}

// ── Tauri commands ────────────────────────────────────────────────────────────

/// Return the last 20 decision records for the UI.
#[tauri::command]
pub fn get_decision_log() -> Vec<DecisionRecord> {
    decision_log()
        .lock()
        .map(|log| {
            let start = log.len().saturating_sub(20);
            log.iter().skip(start).cloned().collect()
        })
        .unwrap_or_default()
}

/// Record user feedback for a decision. Adjusts future confidence thresholds
/// for the signal source so BLADE learns the user's preferred autonomy level.
/// Thresholds are persisted to DB so they survive restarts.
#[tauri::command]
pub fn decision_feedback(id: String, was_correct: bool) -> Result<(), String> {
    // Single lock: read source and update feedback in one pass
    let source = {
        let mut log = decision_log().lock().map_err(|e| e.to_string())?;
        let mut found_source: Option<String> = None;
        if let Some(record) = log.iter_mut().find(|r| r.id == id) {
            record.feedback = Some(was_correct);
            found_source = Some(record.signal.source.clone());
        }
        found_source
    };

    // Adjust threshold for the source and persist
    if let Some(src) = source {
        adjust_threshold(&src, was_correct);
        persist_thresholds();
    }

    Ok(())
}

/// Evaluate a signal on demand (callable from the frontend for testing/demos).
#[tauri::command]
pub async fn decision_evaluate(
    source: String,
    description: String,
    confidence: f64,
    reversible: bool,
    time_sensitive: bool,
) -> Result<DecisionRecord, String> {
    let perception = crate::perception_fusion::get_latest()
        .unwrap_or_default();

    let signal = Signal {
        source,
        description,
        confidence,
        reversible,
        time_sensitive,
    };

    let (id, outcome) = evaluate_and_record(signal.clone(), &perception).await;

    Ok(DecisionRecord {
        id,
        signal,
        outcome,
        timestamp: chrono::Utc::now().timestamp(),
        feedback: None,
    })
}
