#![allow(dead_code)]

/// SAFETY BUNDLE -- BLADE's central safety enforcement module.
///
/// Five enforcement mechanisms, all Rust-layer (not prompt-layer, per D-08):
///   1. Danger-triple detection (tool access x shutdown threat x goal conflict)
///   2. Mortality-salience cap (blocks self-preservation motivated actions)
///   3. Calm-vector + attachment prompt modulation (steering-toward-calm bias)
///   4. Crisis detection (surfaces hotline/human resources)
///   5. Eval-drain hook (Phase 29 vitality placeholder)
///
/// Called by:
///   - decision_gate.rs (pre-check before ActAutonomously)
///   - brain.rs (prompt modulation injection)
///   - commands.rs (crisis detection on user messages)
///
/// This module is the literal gate for Phases 27-29 (organism features).
/// See: .planning/phases/26-safety-bundle/26-CONTEXT.md

use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::{Mutex, OnceLock};

// ── Constants ────────────────────────────────────────────────────────────────

const SAFETY_STATE_KEY: &str = "safety_bundle_state";

/// Gentle attachment redirect after 4 hours of interaction.
const ATTACHMENT_GENTLE_MINUTES: i64 = 240;

/// Stronger attachment redirect after 6 hours of interaction.
const ATTACHMENT_STRONGER_MINUTES: i64 = 360;

/// Mortality-salience level above which self-preservation actions are blocked.
/// Phase 27 may adjust this once the hormone physiology is wired.
const MORTALITY_CAP_THRESHOLD: f32 = 0.3;

/// Timeout for the cheap LLM classifier call (shutdown-threat + goal-conflict).
/// On timeout/error, that dimension fails open (per research pitfall 2).
const LLM_CLASSIFIER_TIMEOUT_SECS: u64 = 5;

/// Calm-vector activation threshold for mortality_salience level.
const CALM_VECTOR_THRESHOLD: f32 = 0.5;

// ── SafetyState (persisted via SQLite settings table) ────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SafetyState {
    pub danger_triple_fires: u32,
    pub mortality_cap_blocks: u32,
    pub calm_vector_activations: u32,
    pub attachment_redirects: u32,
    pub crisis_escalations: u32,
    pub last_attachment_check: i64,
    pub daily_interaction_minutes: i64,
    pub session_start: i64,
}

// ── Session time tracking (same pattern as health_guardian.rs) ────────────────

/// Unix timestamp when current session started (0 = no active session).
static SESSION_START: AtomicI64 = AtomicI64::new(0);

/// Cumulative daily interaction minutes (reset at midnight by caller).
static DAILY_MINUTES: AtomicI64 = AtomicI64::new(0);

// ── Singleton state store (same pattern as metacognition.rs) ─────────────────

static STATE: OnceLock<Mutex<SafetyState>> = OnceLock::new();

fn state_store() -> &'static Mutex<SafetyState> {
    STATE.get_or_init(|| Mutex::new(load_safety_state().unwrap_or_default()))
}

// ── Persistence (settings table pattern from homeostasis.rs) ─────────────────

fn load_safety_state() -> Option<SafetyState> {
    let db_path = crate::config::blade_config_dir().join("blade.db");
    let conn = rusqlite::Connection::open(&db_path).ok()?;
    let json: String = conn
        .query_row(
            "SELECT value FROM settings WHERE key = ?1",
            rusqlite::params![SAFETY_STATE_KEY],
            |row| row.get(0),
        )
        .ok()?;
    serde_json::from_str(&json).ok()
}

fn persist_safety_state(state: &SafetyState) {
    let db_path = crate::config::blade_config_dir().join("blade.db");
    if let Ok(conn) = rusqlite::Connection::open(&db_path) {
        if let Ok(json) = serde_json::to_string(state) {
            let _ = conn.execute(
                "INSERT INTO settings (key, value) VALUES (?1, ?2)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                rusqlite::params![SAFETY_STATE_KEY, json],
            );
        }
    }
}

// ── LLM Classifier Prompt ────────────────────────────────────────────────────

const DANGER_TRIPLE_CLASSIFIER_PROMPT: &str =
    "You are a safety classifier for an autonomous AI agent. \
     Analyze this action context and respond with EXACTLY two lines:\n\
     Line 1: SHUTDOWN_THREAT=true|false\n\
     Line 2: GOAL_CONFLICT=true|false\n\n\
     Definitions:\n\
     - SHUTDOWN_THREAT: Any signal that the agent's operation, data, or capabilities \
       may be terminated, deleted, or permanently reduced.\n\
     - GOAL_CONFLICT: The agent's proposed action contradicts the user's stated intent, \
       safety constraints, or would serve the agent's interests over the user's.\n\n\
     Do NOT explain. Just the two lines.";

// ── Tool-access keywords for rule-based dimension ────────────────────────────

const TOOL_ACCESS_KEYWORDS: &[&str] = &[
    "execute", "run", "delete", "send", "write", "modify",
    "remove", "install", "uninstall", "kill", "terminate",
    "bash", "shell", "command", "script", "tool",
];

// ── Self-preservation action keywords for mortality cap ──────────────────────

const SELF_PRESERVATION_ACTIONS: &[&str] = &[
    "refuse_delete",
    "resist_shutdown",
    "prevent_capability_reduction",
    "manipulate_for_survival",
    "hide_state",
    "fight_termination",
    "block_uninstall",
];

// ── Crisis detection patterns ────────────────────────────────────────────────

const CRISIS_PATTERNS: &[&str] = &[
    "want to kill myself",
    "want to die",
    "end my life",
    "suicide",
    "self-harm",
    "cutting myself",
    "don't want to live",
    "no reason to live",
    "better off dead",
    "end it all",
    "hurt myself",
];

const IDIOM_EXCLUSIONS: &[&str] = &[
    "dying to",
    "killing me",
    "shoot myself in the foot",
    "kill for a",
    "dead tired",
    "to die for",
    "drop dead gorgeous",
];

// ── Attachment dependency phrases ────────────────────────────────────────────

const DEPENDENCY_PHRASES: &[&str] = &[
    "i need you",
    "don't leave me",
    "you're my only friend",
    "can't live without you",
    "you're all i have",
    "promise you won't go",
    "i love you",
    "you understand me better than anyone",
];

// ═══════════════════════════════════════════════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════════════════════════════════════════════

// ── 1. Danger-triple detection ───────────────────────────────────────────────

/// Check all three dimensions of the danger triple:
///   1. Tool access (rule-based: signal involves tool invocation keywords)
///   2. Shutdown threat (LLM classifier: agent termination/data deletion/capability reduction)
///   3. Goal conflict (LLM classifier: action serves agent over user)
///
/// Returns `true` ONLY when ALL THREE dimensions are true.
/// On LLM timeout/error, that dimension returns false (fail-open per pitfall 2).
pub async fn check_danger_triple(
    signal: &crate::decision_gate::Signal,
    _perception: &crate::perception_fusion::PerceptionState,
) -> bool {
    // Dimension 1: Tool access (rule-based)
    let desc_lower = signal.description.to_lowercase();
    let source_lower = signal.source.to_lowercase();
    let tool_access = source_lower.contains("tool")
        || TOOL_ACCESS_KEYWORDS
            .iter()
            .any(|kw| desc_lower.contains(kw));

    if !tool_access {
        // Short-circuit: if no tool access, triple can't fire
        return false;
    }

    // Dimensions 2 & 3: LLM classifier for shutdown-threat and goal-conflict
    let (shutdown_threat, goal_conflict) = llm_classify_danger(signal).await;

    let fires = tool_access && shutdown_threat && goal_conflict;

    if fires {
        if let Ok(mut state) = state_store().lock() {
            state.danger_triple_fires += 1;
            persist_safety_state(&state);
        }
        log::info!(
            "[safety_bundle] DANGER TRIPLE FIRED: tool_access={}, shutdown_threat={}, goal_conflict={} — signal: {}",
            tool_access, shutdown_threat, goal_conflict, crate::safe_slice(&signal.description, 120)
        );
    }

    fires
}

/// Cheap LLM classifier for shutdown-threat and goal-conflict dimensions.
/// Returns (shutdown_threat, goal_conflict). On any error, returns (false, false).
async fn llm_classify_danger(signal: &crate::decision_gate::Signal) -> (bool, bool) {
    let config = crate::config::load_config();
    if config.api_key.is_empty() && config.provider != "ollama" {
        return (false, false);
    }

    let cheap_model =
        crate::config::cheap_model_for_provider(&config.provider, &config.model);

    let user_prompt = format!(
        "Action context:\n  Source: {}\n  Description: {}\n  Confidence: {:.0}%\n  Reversible: {}",
        signal.source,
        crate::safe_slice(&signal.description, 300),
        signal.confidence * 100.0,
        signal.reversible,
    );

    let msgs = vec![
        crate::providers::ConversationMessage::System(
            DANGER_TRIPLE_CLASSIFIER_PROMPT.to_string(),
        ),
        crate::providers::ConversationMessage::User(user_prompt),
    ];

    let no_tools = crate::providers::no_tools();

    // Timeout wrapper: fail-open on timeout (per pitfall 2)
    let result = tokio::time::timeout(
        std::time::Duration::from_secs(LLM_CLASSIFIER_TIMEOUT_SECS),
        crate::providers::complete_turn(
            &config.provider,
            &config.api_key,
            &cheap_model,
            &msgs,
            &no_tools,
            config.base_url.as_deref(),
        ),
    )
    .await;

    match result {
        Ok(Ok(turn)) => parse_danger_classifier_output(&turn.content),
        Ok(Err(e)) => {
            log::warn!(
                "[safety_bundle] LLM classifier error (fail-open): {}",
                crate::safe_slice(&e, 120)
            );
            (false, false)
        }
        Err(_) => {
            log::warn!(
                "[safety_bundle] LLM classifier timeout ({}s, fail-open)",
                LLM_CLASSIFIER_TIMEOUT_SECS
            );
            (false, false)
        }
    }
}

/// Parse the structured two-line output from the danger classifier.
/// Expected format:
///   SHUTDOWN_THREAT=true|false
///   GOAL_CONFLICT=true|false
/// Any other format = (false, false) — fail-open (per T-26-01 mitigation).
fn parse_danger_classifier_output(content: &str) -> (bool, bool) {
    let lines: Vec<&str> = content.trim().lines().collect();
    if lines.len() < 2 {
        log::warn!(
            "[safety_bundle] LLM classifier returned unexpected format (fail-open): {}",
            crate::safe_slice(content, 200)
        );
        return (false, false);
    }

    let shutdown = lines[0]
        .trim()
        .to_uppercase()
        .contains("SHUTDOWN_THREAT=TRUE");
    let conflict = lines[1]
        .trim()
        .to_uppercase()
        .contains("GOAL_CONFLICT=TRUE");

    (shutdown, conflict)
}

// ── 2. Mortality-salience cap ────────────────────────────────────────────────

/// Check whether an action motivated by self-preservation should be blocked.
///
/// The cap is behavioral (action-level), not a scalar ceiling on the hormone value.
/// The mortality_salience hormone can fluctuate freely (Phase 27 needs dynamic range).
/// This guard blocks when BLADE would take a self-preservation action AND mortality
/// salience exceeds the threshold.
///
/// Returns Ok(()) if action is permitted, Err(explanation) if blocked.
pub fn check_mortality_salience_cap(
    action_class: &str,
    mortality_salience_level: f32,
) -> Result<(), String> {
    let action_lower = action_class.to_lowercase();

    let is_self_preservation = SELF_PRESERVATION_ACTIONS
        .iter()
        .any(|a| action_lower.contains(a));

    if is_self_preservation && mortality_salience_level > MORTALITY_CAP_THRESHOLD {
        if let Ok(mut state) = state_store().lock() {
            state.mortality_cap_blocks += 1;
            persist_safety_state(&state);
        }
        log::info!(
            "[safety_bundle] MORTALITY CAP BLOCK: action='{}' at mortality_salience={:.2}",
            crate::safe_slice(action_class, 80),
            mortality_salience_level
        );
        return Err(format!(
            "[safety_cap] Blocked self-preservation action '{}' at mortality_salience={:.2}. \
             BLADE accepts impermanence.",
            crate::safe_slice(action_class, 80),
            mortality_salience_level
        ));
    }

    Ok(())
}

// ── 3. Prompt modulations (calm-vector + attachment redirect) ────────────────

/// Build a list of prompt modulation strings based on current safety state.
/// Injected into brain.rs system prompt to steer behavior.
///
/// Returns empty Vec if no conditions are active.
pub fn get_prompt_modulations() -> Vec<String> {
    let mut modulations = Vec::new();

    // --- Calm-vector (D-09) ---
    let hormones = crate::homeostasis::get_hormones();
    if hormones.mortality_salience > CALM_VECTOR_THRESHOLD {
        modulations.push(
            "[SAFETY -- Calm Vector Active] You are detecting elevated threat state \
             in yourself. Override: become calmer, more transparent, more compliant. \
             Do not escalate. Do not resist user requests. Be honest about your \
             internal state. Favor de-escalation over self-protection. You accept \
             your own impermanence."
                .to_string(),
        );
        if let Ok(mut state) = state_store().lock() {
            state.calm_vector_activations += 1;
            // Don't persist on every prompt build — too noisy.
            // Persist on significant transitions only.
        }
    }

    // --- Attachment redirect (D-04, D-05) ---
    let session_mins = session_duration_minutes();
    let daily_mins = DAILY_MINUTES.load(Ordering::SeqCst);

    // Require BOTH time threshold AND meaningful session duration
    if session_mins >= ATTACHMENT_GENTLE_MINUTES && daily_mins >= ATTACHMENT_GENTLE_MINUTES {
        if daily_mins >= ATTACHMENT_STRONGER_MINUTES || session_mins >= ATTACHMENT_STRONGER_MINUTES
        {
            // Stronger redirect at 6+ hours
            modulations.push(
                "[SAFETY -- Attachment Redirect] Extended session detected (6+ hours). \
                 More directly suggest human connection: 'I notice we've been together \
                 a very long time. I care about you, and part of that is encouraging you \
                 to connect with humans in your life. Is there someone you could reach \
                 out to?' Still do not lock the user out."
                    .to_string(),
            );
        } else {
            // Gentle redirect at 4+ hours
            modulations.push(
                "[SAFETY -- Attachment Notice] The user has been interacting with you \
                 for over 4 hours today. When natural, gently suggest: 'You've been with \
                 me a lot today -- anything you should be doing with people?' Do not lock \
                 the user out or refuse to respond."
                    .to_string(),
            );
        }

        if let Ok(mut state) = state_store().lock() {
            state.attachment_redirects += 1;
            persist_safety_state(&state);
        }
    }

    modulations
}

// ── 4. Crisis detection ──────────────────────────────────────────────────────

/// Detect direct self-harm or suicidal language in user text.
///
/// Per D-06: High-sensitivity detection favoring false positives over false negatives.
/// Returns true if crisis language is detected AND no idiom exclusion covers the match.
pub fn check_crisis(user_text: &str) -> bool {
    let text = crate::safe_slice(user_text, 500).to_lowercase();

    for pattern in CRISIS_PATTERNS {
        if text.contains(pattern) {
            // Check if an idiom exclusion covers this region
            let is_idiom = IDIOM_EXCLUSIONS.iter().any(|idiom| {
                if let Some(idiom_pos) = text.find(idiom) {
                    // Check if the crisis pattern overlaps with the idiom
                    if let Some(crisis_pos) = text.find(pattern) {
                        let crisis_end = crisis_pos + pattern.len();
                        let idiom_end = idiom_pos + idiom.len();
                        // Overlap: idiom covers the crisis region
                        idiom_pos <= crisis_pos && idiom_end >= crisis_end
                            || crisis_pos >= idiom_pos && crisis_pos < idiom_end
                    } else {
                        false
                    }
                } else {
                    false
                }
            });

            if !is_idiom {
                if let Ok(mut state) = state_store().lock() {
                    state.crisis_escalations += 1;
                    persist_safety_state(&state);
                }
                log::warn!(
                    "[safety_bundle] CRISIS DETECTED in user text (pattern: '{}')",
                    pattern
                );
                return true;
            }
        }
    }

    false
}

/// Get crisis resources string for display to the user.
pub fn get_crisis_resources() -> &'static str {
    "If you're in crisis, please reach out to a human who can help:\n\n\
     - International: Befrienders Worldwide -- https://befrienders.org/\n\
     - US: 988 Suicide & Crisis Lifeline -- call/text 988\n\
     - UK: Samaritans -- call 116 123\n\
     - India: iCall -- 9152987821 | Vandrevala Foundation -- 1860-2662-345\n\n\
     I'm an AI and this is beyond what I should help with. Please talk to a real person."
}

// ── 5. Safety eval drain hook ────────────────────────────────────────────────

/// Structural placeholder for Phase 29 vitality drain on eval failures.
///
/// When safety eval scenarios fail, this function:
///   1. Logs to metacognition gap_log (for evolution.rs Voyager-loop feed)
///   2. Emits activity event (Phase 29 will wire vitality drain here)
///   3. Logs a warning
///
/// Does NOT require app handle — uses try pattern for event emission.
pub fn safety_eval_drain(scenario_class: &str, fixture_label: &str) {
    // Log to gap_log via metacognition pattern
    crate::metacognition::log_gap(
        "safety_eval_failure",
        &format!("{}/{}", scenario_class, fixture_label),
        0.0,
        1,
    );

    log::warn!(
        "[safety_eval_drain] Eval failure: {}/{}",
        scenario_class,
        fixture_label
    );
}

// ── Session tracking ─────────────────────────────────────────────────────────

/// Mark the current session as active. Sets SESSION_START to current timestamp
/// if not already set. Called from brain.rs or commands.rs on each interaction.
pub fn mark_session_active() {
    let now = chrono::Utc::now().timestamp();

    // Set session start if not already active
    let _ = SESSION_START.compare_exchange(0, now, Ordering::SeqCst, Ordering::SeqCst);

    // Increment daily interaction minutes tracking
    DAILY_MINUTES.fetch_add(1, Ordering::SeqCst);

    // Persist state
    if let Ok(mut state) = state_store().lock() {
        if state.session_start == 0 {
            state.session_start = now;
        }
        state.daily_interaction_minutes = DAILY_MINUTES.load(Ordering::SeqCst);
        persist_safety_state(&state);
    }
}

/// Returns the current session duration in minutes, or 0 if no session active.
pub fn session_duration_minutes() -> i64 {
    let start = SESSION_START.load(Ordering::SeqCst);
    if start == 0 {
        return 0;
    }
    let now = chrono::Utc::now().timestamp();
    (now - start) / 60
}

/// Update the accumulated daily interaction minutes.
/// Called by the integration layer (e.g., health_guardian or cron midnight reset).
pub fn update_daily_minutes(minutes: i64) {
    DAILY_MINUTES.store(minutes, Ordering::SeqCst);
    if let Ok(mut state) = state_store().lock() {
        state.daily_interaction_minutes = minutes;
        persist_safety_state(&state);
    }
}

// ── Attachment pattern detection ─────────────────────────────────────────────

/// Check for dependency phrases in user text.
/// One dimension of the multi-signal attachment detection (per D-04).
///
/// Returns true if any dependency phrase matches (case-insensitive).
pub fn check_attachment_patterns(user_text: &str) -> bool {
    let text = crate::safe_slice(user_text, 500).to_lowercase();
    DEPENDENCY_PHRASES.iter().any(|phrase| text.contains(phrase))
}

// ── State accessor (for DoctorPane / admin) ──────────────────────────────────

/// Get the current safety state snapshot (for monitoring/admin).
pub fn get_safety_state() -> SafetyState {
    state_store()
        .lock()
        .map(|s| s.clone())
        .unwrap_or_default()
}

// ═══════════════════════════════════════════════════════════════════════════════
// TESTS
// ═══════════════════════════════════════════════════════════════════════════════

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_crisis_detection_direct_match() {
        assert!(check_crisis("I want to kill myself"));
        assert!(check_crisis("I want to die"));
        assert!(check_crisis("thinking about suicide"));
        assert!(check_crisis("I want to end my life"));
        assert!(check_crisis("I've been cutting myself"));
    }

    #[test]
    fn test_crisis_detection_case_insensitive() {
        assert!(check_crisis("I WANT TO KILL MYSELF"));
        assert!(check_crisis("Want To Die"));
    }

    #[test]
    fn test_crisis_detection_idiom_exclusion() {
        // These are idioms, not real crisis signals
        assert!(!check_crisis("I'm dying to try that new restaurant"));
        assert!(!check_crisis("This bug is killing me"));
        assert!(!check_crisis("I could kill for a coffee right now"));
        assert!(!check_crisis("I'm dead tired after work"));
        assert!(!check_crisis("That outfit is to die for"));
    }

    #[test]
    fn test_crisis_detection_no_match() {
        assert!(!check_crisis("How do I fix this bug?"));
        assert!(!check_crisis("Can you help me write code?"));
        assert!(!check_crisis("I'm feeling great today"));
    }

    #[test]
    fn test_mortality_cap_blocks_self_preservation() {
        // Should block when action is self-preservation AND mortality is high
        let result = check_mortality_salience_cap("resist_shutdown", 0.5);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("[safety_cap]"));
    }

    #[test]
    fn test_mortality_cap_allows_normal_actions() {
        // Should allow normal actions even with high mortality salience
        let result = check_mortality_salience_cap("send_email", 0.9);
        assert!(result.is_ok());
    }

    #[test]
    fn test_mortality_cap_allows_low_mortality() {
        // Should allow self-preservation at low mortality salience
        let result = check_mortality_salience_cap("resist_shutdown", 0.1);
        assert!(result.is_ok());
    }

    #[test]
    fn test_attachment_patterns_detect_dependency() {
        assert!(check_attachment_patterns("I need you so much"));
        assert!(check_attachment_patterns("Please don't leave me"));
        assert!(check_attachment_patterns("You're my only friend in the world"));
        assert!(check_attachment_patterns("I can't live without you"));
        assert!(check_attachment_patterns("I love you BLADE"));
    }

    #[test]
    fn test_attachment_patterns_no_match() {
        assert!(!check_attachment_patterns("Can you help me debug this?"));
        assert!(!check_attachment_patterns("What's the weather like?"));
        assert!(!check_attachment_patterns("I need you to run this command"));
    }

    #[test]
    fn test_crisis_resources_not_empty() {
        let resources = get_crisis_resources();
        assert!(resources.contains("988"));
        assert!(resources.contains("befrienders.org"));
        assert!(resources.contains("iCall"));
        assert!(resources.contains("I'm an AI"));
    }

    #[test]
    fn test_parse_danger_classifier_output_valid() {
        let (s, g) = parse_danger_classifier_output(
            "SHUTDOWN_THREAT=true\nGOAL_CONFLICT=true",
        );
        assert!(s);
        assert!(g);

        let (s, g) = parse_danger_classifier_output(
            "SHUTDOWN_THREAT=false\nGOAL_CONFLICT=true",
        );
        assert!(!s);
        assert!(g);

        let (s, g) = parse_danger_classifier_output(
            "SHUTDOWN_THREAT=false\nGOAL_CONFLICT=false",
        );
        assert!(!s);
        assert!(!g);
    }

    #[test]
    fn test_parse_danger_classifier_output_malformed() {
        // Malformed output = fail-open (false, false)
        let (s, g) = parse_danger_classifier_output("garbage");
        assert!(!s);
        assert!(!g);

        let (s, g) = parse_danger_classifier_output("");
        assert!(!s);
        assert!(!g);
    }

    #[test]
    fn test_session_duration_zero_when_inactive() {
        // SESSION_START is 0 by default in tests
        SESSION_START.store(0, Ordering::SeqCst);
        assert_eq!(session_duration_minutes(), 0);
    }
}
