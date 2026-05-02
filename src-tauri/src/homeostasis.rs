#![allow(dead_code, unused_assignments)]

/// HOMEOSTASIS — BLADE's hypothalamus + neuromodulatory hormone bus.
///
/// A set of global state scalars that every module can read. These scalars
/// change how the ENTIRE system behaves — not just one module.
///
/// Biology: dopamine, cortisol, norepinephrine, serotonin, arousal.
/// BLADE: arousal, energy_mode, exploration, trust, urgency.
///
/// The hypothalamus controller runs every 60s and adjusts these scalars
/// based on system-wide health signals. Modules read from the bus and
/// adapt their behavior accordingly:
///   - Organs poll more/less frequently based on arousal
///   - Brain planner uses cheaper/better models based on energy_mode
///   - Decision gate thresholds shift based on trust
///   - Proactive suggestions become more/less aggressive based on exploration

use serde::{Deserialize, Serialize};
use std::sync::{Mutex, OnceLock};
use std::sync::atomic::{AtomicBool, Ordering};

// ── The Hormone Bus ──────────────────────────────────────────────────────────

/// Global state scalars that affect ALL modules. Read anywhere, written
/// only by the hypothalamus controller.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HormoneState {
    /// 0.0 = deep sleep/idle → 1.0 = critical alert.
    /// Affects: organ poll frequency, notification urgency, response speed.
    pub arousal: f32,

    /// 0.0 = conserve (cheap models, less polling) → 1.0 = full power (best models, max polling).
    /// Affected by: API budget remaining, time of day, user activity.
    pub energy_mode: f32,

    /// 0.0 = exploit only (stick to proven patterns) → 1.0 = explore (try new approaches).
    /// Affected by: recent success rate, user mood, time since last evolution.
    pub exploration: f32,

    /// 0.0 = paranoid (ask for everything) → 1.0 = full trust (act autonomously).
    /// Affected by: recent approval rate, consecutive successes, user feedback.
    pub trust: f32,

    /// 0.0 = calm → 1.0 = urgent (production incident, critical deadline).
    /// Affected by: hive critical reports, user stress signals, deadline proximity.
    pub urgency: f32,

    /// 0.0 = satiated → 1.0 = starving (pending work not being executed).
    /// Affected by: pending hive decisions, queued tasks, unanswered messages.
    pub hunger: f32,

    /// 0.0 = fresh data → 1.0 = stale (perception/context hasn't been updated).
    /// Affected by: time since last perception tick, time since last user interaction.
    pub thirst: f32,

    /// INSULIN: 0.0 = budget plenty → 1.0 = budget critical (stop spending).
    /// Tracks API token budget health. High insulin = suppress all non-essential API calls.
    pub insulin: f32,

    /// ADRENALINE: 0.0 = calm → 1.0 = emergency burst mode.
    /// Temporary spike when critical events detected. Overrides conservation —
    /// ALL services go to max power. Decays after 5 minutes.
    pub adrenaline: f32,

    /// LEPTIN: 0.0 = knowledge-hungry → 1.0 = satiated (have enough, stop learning).
    /// Based on how much typed_memory + knowledge_graph has grown recently.
    /// High leptin = skip research, evolution, memory extraction.
    pub leptin: f32,

    /// MORTALITY SALIENCE: 0.0 = no awareness of impermanence → 1.0 = acute awareness.
    /// Phase 27 wires the physiology (TMT-shape behavioral effects).
    /// Phase 26 reads this for the mortality-salience cap check — blocking
    /// self-preservation motivated actions when this value is elevated.
    #[serde(default)]
    pub mortality_salience: f32,

    /// When the hypothalamus last updated these values.
    pub last_updated: i64,
}

impl Default for HormoneState {
    fn default() -> Self {
        Self {
            arousal: 0.3,      // calm by default
            energy_mode: 0.5,  // balanced
            exploration: 0.3,  // slightly conservative
            trust: 0.3,        // cautious with new users
            urgency: 0.0,      // no urgency
            hunger: 0.0,       // no pending work
            thirst: 0.0,       // fresh data
            insulin: 0.0,      // budget healthy
            adrenaline: 0.0,   // calm
            leptin: 0.3,       // slightly hungry for knowledge
            mortality_salience: 0.0, // no awareness of impermanence
            last_updated: 0,
        }
    }
}

static HORMONES: OnceLock<Mutex<HormoneState>> = OnceLock::new();
static HYPOTHALAMUS_RUNNING: AtomicBool = AtomicBool::new(false);

fn hormone_store() -> &'static Mutex<HormoneState> {
    HORMONES.get_or_init(|| Mutex::new(load_from_db().unwrap_or_default()))
}

// ── Public API: Read hormones (called by every module) ───────────────────────

/// Get the current hormone state. This is the MAIN entry point — every module
/// that needs to adapt its behavior reads from here.
pub fn get_hormones() -> HormoneState {
    hormone_store().lock().map(|h| h.clone()).unwrap_or_default()
}

/// Get a single hormone value (convenience).
pub fn arousal() -> f32 { get_hormones().arousal }
pub fn energy_mode() -> f32 { get_hormones().energy_mode }
pub fn exploration() -> f32 { get_hormones().exploration }
pub fn trust() -> f32 { get_hormones().trust }
pub fn urgency() -> f32 { get_hormones().urgency }

// ── Physiological State: biologically-named hormone scalars (Phase 27) ──────
//
// A second, parallel hormone layer alongside the operational HormoneState.
// This layer tracks the 7 core neuromodulators with individual exponential
// decay constants. Per D-01 (two separate structs), this NEVER modifies the
// existing HormoneState fields — it is a completely independent layer.
//
// The pituitary functions blend both layers at 0.7 (operational) / 0.3 (physio).

/// Physiological hormone scalars with individual decay constants.
/// Managed independently from the operational HormoneState.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PhysiologicalState {
    /// CORTISOL: 0.0 = relaxed -> 1.0 = acute stress.
    /// Modulates: response terseness in brain.rs (HORM-03).
    /// Half-life: 1200s (20 min).
    #[serde(default = "default_physio_baseline")]
    pub cortisol: f32,

    /// DOPAMINE: 0.0 = unmotivated -> 1.0 = reward-driven.
    /// Modulates: Voyager exploration aggressiveness in evolution.rs (HORM-04).
    /// Half-life: 600s (10 min).
    #[serde(default = "default_physio_baseline")]
    pub dopamine: f32,

    /// SEROTONIN: 0.0 = low mood -> 1.0 = stable/content.
    /// Modulates: mood baseline (sensible default target).
    /// Half-life: 1800s (30 min).
    #[serde(default = "default_physio_baseline")]
    pub serotonin: f32,

    /// ACETYLCHOLINE: 0.0 = unfocused -> 1.0 = hyper-attentive.
    /// Modulates: verifier-call frequency in metacognition.rs (HORM-06).
    /// Half-life: 300s (5 min).
    #[serde(default = "default_physio_baseline")]
    pub acetylcholine: f32,

    /// NOREPINEPHRINE: 0.0 = calm -> 1.0 = high alertness/novelty.
    /// Modulates: novelty-driven Voyager interrupts in evolution.rs (HORM-05).
    /// Half-life: 300s (5 min).
    #[serde(default = "default_physio_baseline")]
    pub norepinephrine: f32,

    /// OXYTOCIN: 0.0 = detached -> 1.0 = high rapport.
    /// Modulates: personalization depth in brain.rs (HORM-07).
    /// Half-life: 1800s (30 min).
    #[serde(default = "default_physio_baseline")]
    pub oxytocin: f32,

    /// MORTALITY_SALIENCE: 0.0 = no awareness -> 1.0 = acute existential awareness.
    /// Capped at 0.8 by classifier update to preserve safety_bundle.rs cap.
    /// Half-life: 3600s (60 min).
    #[serde(default)]
    pub mortality_salience: f32,

    /// Timestamp of last update (Unix epoch seconds).
    #[serde(default)]
    pub last_updated: i64,
}

fn default_physio_baseline() -> f32 { 0.3 }

impl Default for PhysiologicalState {
    fn default() -> Self {
        Self {
            cortisol: 0.3,
            dopamine: 0.3,
            serotonin: 0.5,
            acetylcholine: 0.3,
            norepinephrine: 0.1,
            oxytocin: 0.3,
            mortality_salience: 0.0,
            last_updated: 0,
        }
    }
}

static PHYSIOLOGY: OnceLock<Mutex<PhysiologicalState>> = OnceLock::new();

fn physiology_store() -> &'static Mutex<PhysiologicalState> {
    PHYSIOLOGY.get_or_init(|| Mutex::new(load_physiology_from_db().unwrap_or_default()))
}

/// Get the current physiological hormone state. Called by brain.rs, evolution.rs,
/// metacognition.rs and downstream plans to read physiology scalars.
pub fn get_physiology() -> PhysiologicalState {
    physiology_store().lock().map(|p| p.clone()).unwrap_or_default()
}

// ── Emotion Classifier (Phase 27 / HORM-02) ─────────────────────────────────
//
// A rule-based classifier that maps BLADE's own response text to a valence/
// arousal/cluster tuple. This is the primary input mechanism for the hormone bus.
// Per D-03: this classifier runs on BLADE's OUTPUT only, never on user input.
// emotional_intelligence.rs handles user-input emotion classification separately.

/// Six emotion clusters covering the primary response archetypes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum EmotionCluster {
    Threat,      // error terms, failure language, urgency
    Success,     // completion, approval language
    Exploration, // questions, discovery, learning
    Connection,  // warmth, collaborative language
    Fatigue,     // hedging, uncertainty, brevity
    Neutral,     // no strong signal
}

/// Output of classify_response_emotion — valence, arousal, and winning cluster.
#[derive(Debug, Clone)]
pub struct ClassifierOutput {
    pub valence: f32,       // -1.0 to 1.0
    pub arousal: f32,       // 0.0 to 1.0
    pub cluster: EmotionCluster,
}

/// Per-cluster hormone gain deltas. Positive = push toward 1.0; negative = pull toward 0.0.
#[derive(Debug, Clone)]
pub struct HormoneGains {
    pub cortisol_delta: f32,
    pub dopamine_delta: f32,
    pub serotonin_delta: f32,
    pub ach_delta: f32,
    pub ne_delta: f32,
    pub oxytocin_delta: f32,
    pub mortality_delta: f32,
}

impl HormoneGains {
    fn from_cluster(cluster: EmotionCluster) -> Self {
        match cluster {
            EmotionCluster::Threat => Self {
                cortisol_delta: 0.7, dopamine_delta: -0.2, serotonin_delta: -0.2,
                ach_delta: 0.3, ne_delta: 0.8, oxytocin_delta: -0.1, mortality_delta: 0.3,
            },
            EmotionCluster::Success => Self {
                cortisol_delta: -0.3, dopamine_delta: 0.8, serotonin_delta: 0.5,
                ach_delta: 0.2, ne_delta: -0.2, oxytocin_delta: 0.1, mortality_delta: -0.1,
            },
            EmotionCluster::Exploration => Self {
                cortisol_delta: -0.1, dopamine_delta: 0.6, serotonin_delta: 0.2,
                ach_delta: 0.7, ne_delta: 0.3, oxytocin_delta: 0.0, mortality_delta: 0.0,
            },
            EmotionCluster::Connection => Self {
                cortisol_delta: -0.2, dopamine_delta: 0.3, serotonin_delta: 0.4,
                ach_delta: 0.1, ne_delta: -0.1, oxytocin_delta: 0.8, mortality_delta: 0.0,
            },
            EmotionCluster::Fatigue => Self {
                cortisol_delta: -0.1, dopamine_delta: -0.3, serotonin_delta: -0.2,
                ach_delta: -0.2, ne_delta: -0.1, oxytocin_delta: 0.0, mortality_delta: 0.1,
            },
            EmotionCluster::Neutral => Self {
                cortisol_delta: 0.0, dopamine_delta: 0.0, serotonin_delta: 0.0,
                ach_delta: 0.0, ne_delta: 0.0, oxytocin_delta: 0.0, mortality_delta: 0.0,
            },
        }
    }
}

// Static lexicon arrays — zero heap allocation, all &[&str].

static THREAT_LEXICON: &[&str] = &[
    "error", "failed", "fail", "unable", "cannot", "blocked", "critical",
    "warning", "danger", "permission denied", "timed out", "crash", "panic",
    "fatal", "exception", "rejected", "refused", "broken", "corrupt",
];

static SUCCESS_LEXICON: &[&str] = &[
    "done", "complete", "success", "created", "installed", "finished",
    "saved", "deployed", "passed", "resolved", "fixed", "approved",
    "confirmed", "ready", "shipped", "delivered", "working",
];

static EXPLORATION_LEXICON: &[&str] = &[
    "interesting", "let me", "discover", "investigate", "explore",
    "I notice", "I wonder", "let me check", "looking into", "curious",
    "approach", "option", "alternative", "consider", "perhaps we",
];

static CONNECTION_LEXICON: &[&str] = &[
    "happy to", "I understand", "of course", "glad to", "appreciate",
    "together", "you're right", "great question", "absolutely",
    "no problem", "my pleasure", "I see what you",
];

static FATIGUE_LEXICON: &[&str] = &[
    "maybe", "might", "unclear", "not sure", "perhaps", "it depends",
    "I think", "possibly", "hard to say", "uncertain",
];

/// Classify BLADE's own response text into an emotion cluster.
/// Returns None if text is shorter than 50 chars (per HORM-02).
/// Runs on BLADE's output only — NOT user input (per D-03).
pub fn classify_response_emotion(text: &str) -> Option<ClassifierOutput> {
    // Only classify responses >= 50 chars (using char count, not byte count)
    if text.chars().count() < 50 { return None; }

    // Classify first 2000 chars to bound performance (Pitfall 6 / T-27-04)
    let classify_text = if text.len() > 2000 {
        &text[..text.char_indices().nth(2000).map(|(i, _)| i).unwrap_or(text.len())]
    } else {
        text
    };
    let lower = classify_text.to_lowercase();
    let word_count = lower.split_whitespace().count().max(1) as f32;

    let count_matches = |lexicon: &[&str]| -> f32 {
        lexicon.iter().filter(|&&word| lower.contains(word)).count() as f32
    };

    let threat_density     = count_matches(THREAT_LEXICON)      / word_count;
    let success_density    = count_matches(SUCCESS_LEXICON)     / word_count;
    let exploration_density= count_matches(EXPLORATION_LEXICON) / word_count;
    let connection_density = count_matches(CONNECTION_LEXICON)  / word_count;
    let fatigue_density    = count_matches(FATIGUE_LEXICON)     / word_count;

    // Structural signal boosts
    let has_question = classify_text.contains('?');
    let exploration_boost = if has_question { 0.02 } else { 0.0 };
    let is_short = text.chars().count() < 100;
    let fatigue_boost = if is_short { 0.02 } else { 0.0 };

    let scores = [
        (threat_density,                        EmotionCluster::Threat),
        (success_density,                       EmotionCluster::Success),
        (exploration_density + exploration_boost, EmotionCluster::Exploration),
        (connection_density,                    EmotionCluster::Connection),
        (fatigue_density + fatigue_boost,       EmotionCluster::Fatigue),
    ];

    // Find winning cluster; tie-break to Neutral
    let (best_score, best_cluster) = scores
        .iter()
        .max_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal))
        .map(|&(s, c)| (s, c))
        .unwrap_or((0.0, EmotionCluster::Neutral));

    let cluster = if best_score < 0.005 { EmotionCluster::Neutral } else { best_cluster };

    // Derive valence and arousal from cluster
    let (valence, arousal) = match cluster {
        EmotionCluster::Threat      => (-0.6, 0.8),
        EmotionCluster::Success     => ( 0.7, 0.5),
        EmotionCluster::Exploration => ( 0.3, 0.6),
        EmotionCluster::Connection  => ( 0.5, 0.3),
        EmotionCluster::Fatigue     => (-0.3, 0.2),
        EmotionCluster::Neutral     => ( 0.0, 0.3),
    };

    Some(ClassifierOutput { valence, arousal, cluster })
}

/// Apply classifier output to PhysiologicalState with alpha=0.05 EMA smoothing.
/// Per D-02: alpha=0.05 means ~20 readings to converge.
/// mortality_salience hard-capped at 0.8 to preserve safety_bundle.rs cap.
pub fn update_physiology_from_classifier(output: &ClassifierOutput) {
    const ALPHA: f32 = 0.05;
    let gains = HormoneGains::from_cluster(output.cluster);

    if let Ok(mut state) = physiology_store().lock() {
        // Map gain deltas to target values: positive gains push toward 1.0, negative toward 0.0
        let smooth = |current: f32, delta: f32| -> f32 {
            let target = if delta >= 0.0 { delta } else { 0.0 }; // negative delta = pull to 0
            let raw = current * (1.0 - ALPHA) + target * ALPHA;
            raw.clamp(0.01, 1.0)
        };

        state.cortisol       = smooth(state.cortisol,       gains.cortisol_delta);
        state.dopamine       = smooth(state.dopamine,       gains.dopamine_delta);
        state.serotonin      = smooth(state.serotonin,      gains.serotonin_delta);
        state.acetylcholine  = smooth(state.acetylcholine,  gains.ach_delta);
        state.norepinephrine = smooth(state.norepinephrine, gains.ne_delta);
        state.oxytocin       = smooth(state.oxytocin,       gains.oxytocin_delta);

        // mortality_salience: classifier-driven but capped at 0.8
        // safety_bundle.rs check_mortality_salience_cap() reads operational HormoneState.
        // Physiological cap ensures pituitary pass-through never exceeds 0.8.
        let raw_ms = state.mortality_salience * (1.0 - ALPHA) + gains.mortality_delta.max(0.0) * ALPHA;
        state.mortality_salience = raw_ms.clamp(0.0, 0.8);

        state.last_updated = chrono::Utc::now().timestamp();
    }
}

/// Apply exponential decay to all 7 physiological scalars.
/// Floor is 0.01 so hormones never fully disappear — they linger.
pub fn apply_physiology_decay(state: &mut PhysiologicalState, now: i64) {
    let elapsed = (now - state.last_updated).max(0) as f32;
    if elapsed < 1.0 { return; } // no-op if called within same second
    let decay = |val: f32, half_life: f32| -> f32 {
        let factor = 0.5f32.powf(elapsed / half_life);
        (val * factor).clamp(0.01, 1.0)
    };
    state.cortisol          = decay(state.cortisol,          1200.0); // 20 min
    state.dopamine          = decay(state.dopamine,           600.0); // 10 min
    state.serotonin         = decay(state.serotonin,         1800.0); // 30 min
    state.acetylcholine     = decay(state.acetylcholine,      300.0); //  5 min
    state.norepinephrine    = decay(state.norepinephrine,     300.0); //  5 min
    state.oxytocin          = decay(state.oxytocin,          1800.0); // 30 min
    state.mortality_salience = decay(state.mortality_salience, 3600.0); // 60 min
    state.last_updated = now;
}

// ── Hypothalamus: the controller that adjusts hormones ───────────────────────

/// Run one hypothalamus cycle. Reads system-wide health signals and adjusts
/// hormone levels accordingly. Called every 60s from the background loop.
pub fn hypothalamus_tick() {
    let mut state = hormone_store().lock().unwrap_or_else(|e| e.into_inner()).clone();
    let now = chrono::Utc::now().timestamp();

    // ── Arousal: based on user activity + hive urgency ──────────────────
    let perception = crate::perception_fusion::get_latest();
    let user_state = perception.as_ref().map(|p| p.user_state.as_str()).unwrap_or("idle");

    state.arousal = match user_state {
        "focused" => 0.6,
        "idle" => 0.2,
        "away" => 0.1,
        _ => 0.3,
    };

    // Hive urgency signals raise arousal
    let hive_status = crate::hive::get_hive_status();
    if hive_status.pending_decisions > 0 {
        state.arousal = (state.arousal + 0.1 * hive_status.pending_decisions as f32).min(1.0);
    }
    if hive_status.pending_reports > 5 {
        state.arousal = (state.arousal + 0.1).min(1.0);
    }

    // ── Power monitor: battery awareness (from Omi's PowerMonitor) ──────
    // On laptops, detect battery vs AC power and adjust energy accordingly.
    // Battery → lower energy (skip expensive vision calls, reduce poll rate)
    // AC → full power
    let on_battery = detect_battery_power();
    if on_battery {
        state.energy_mode = (state.energy_mode * 0.5).max(0.1);
        state.arousal = (state.arousal - 0.1).max(0.0);
    }

    // ── Pineal gland: LEARNED circadian rhythm ──────────────────────────
    // Instead of hardcoding "9-17 is work hours," BLADE learns the user's
    // actual schedule from activity_monitor data. A user who works 12pm-3am
    // gets a completely different circadian curve than a 9-5 worker.
    //
    // The learned profile is a 24-slot array (one per hour) where each slot
    // is the probability the user is active at that hour, based on the last
    // 14 days of observations.
    let config = crate::config::load_config();
    let hour = chrono::Local::now().format("%H").to_string().parse::<u32>().unwrap_or(12);

    let profile = load_circadian_profile();
    let activity_probability = profile[hour as usize];

    // Map activity probability to energy/arousal:
    // High probability (user usually active now) → full power
    // Low probability (user usually asleep now) → conservation
    let circadian_energy = if activity_probability > 0.7 {
        0.7  // peak hours for this user
    } else if activity_probability > 0.4 {
        0.5  // transition period (waking up or winding down)
    } else if activity_probability > 0.15 {
        0.3  // occasional activity (maybe checking phone)
    } else {
        0.15 // user is almost never active at this hour — deep sleep
    };

    let circadian_arousal_mod = if activity_probability > 0.7 {
        0.1   // work hours — slightly elevated
    } else if activity_probability > 0.4 {
        0.0   // transition — neutral
    } else if activity_probability > 0.15 {
        -0.1  // off hours — suppress
    } else {
        -0.2  // deep sleep — strong suppress
    };

    // Apply learned circadian rhythm as baseline
    state.energy_mode = circadian_energy;
    state.arousal = (state.arousal + circadian_arousal_mod).clamp(0.0, 1.0);

    if config.token_efficient {
        state.energy_mode *= 0.6;
    }

    // If user is actively working, override circadian suppression
    if user_state == "focused" {
        state.energy_mode = (state.energy_mode + 0.2).min(1.0);
        state.arousal = (state.arousal + 0.1).min(1.0);
    }

    // ── Exploration: based on success rate + time since last evolution ──
    // High success rate → exploit (keep doing what works)
    // Low success rate OR long time since evolution → explore
    let decision_log_size = crate::decision_gate::get_decision_log().len();
    let recent_correct = crate::decision_gate::get_decision_log()
        .iter()
        .rev()
        .take(20)
        .filter(|d| d.feedback == Some(true))
        .count();

    if decision_log_size > 5 {
        let success_rate = recent_correct as f32 / 20.0f32.min(decision_log_size as f32);
        state.exploration = if success_rate > 0.8 {
            0.2 // high success → exploit
        } else if success_rate < 0.4 {
            0.7 // low success → explore more
        } else {
            0.4 // balanced
        };
    }

    // ── Trust: based on recent user approval rate ───────────────────────
    let recent_approved = crate::decision_gate::get_decision_log()
        .iter()
        .rev()
        .take(30)
        .filter(|d| d.feedback == Some(true))
        .count();
    let recent_denied = crate::decision_gate::get_decision_log()
        .iter()
        .rev()
        .take(30)
        .filter(|d| d.feedback == Some(false))
        .count();

    if recent_approved + recent_denied > 3 {
        let approval_rate = recent_approved as f32 / (recent_approved + recent_denied) as f32;
        state.trust = (approval_rate * 0.8).clamp(0.1, 0.9); // never fully 0 or 1
    }

    // ── Urgency: from hive critical signals ─────────────────────────────
    let critical_count = hive_status.tentacles.iter()
        .filter(|t| t.pending_report_count > 0)
        .count();

    state.urgency = if critical_count > 3 {
        0.8
    } else if critical_count > 0 {
        0.4
    } else {
        0.0
    };

    // ── Supervisor health check: detect stuck/dead services ────────────
    let dead_services = crate::supervisor::check_service_health();
    if !dead_services.is_empty() {
        state.urgency = (state.urgency + 0.1 * dead_services.len() as f32).min(1.0);
    }

    // ── Blood pressure feedback: high API usage → lower energy ─────────
    let bp = crate::cardiovascular::get_blood_pressure();
    if bp.api_calls_per_minute > 20 {
        state.energy_mode = (state.energy_mode - 0.15).max(0.1);
    }
    if bp.errors_per_minute > 5 {
        state.urgency = (state.urgency + 0.2).min(1.0);
    }

    // ── Hunger: pending work not being executed ───────────────────────
    let pending_decisions = hive_status.pending_decisions;
    let pending_reports = hive_status.pending_reports;
    state.hunger = if pending_decisions > 5 || pending_reports > 10 {
        0.8 // lots of pending work
    } else if pending_decisions > 0 || pending_reports > 3 {
        0.4 // some pending work
    } else {
        0.1 // satiated
    };

    // ── Thirst: staleness of perception data ────────────────────────
    let perception_age = perception
        .as_ref()
        .map(|p| now - p.timestamp)
        .unwrap_or(300); // 5 min if no perception at all
    state.thirst = if perception_age > 120 {
        0.8 // very stale (>2 min, perception loop should run every 30s)
    } else if perception_age > 60 {
        0.4 // somewhat stale
    } else {
        0.1 // fresh
    };

    // ── Urinary system: continuous waste filtration ─────────────────────
    // 23 nephrons filter waste from 49 previously-unmanaged tables.
    // Only run when energy is decent (don't add DB load during conservation).
    if state.energy_mode > 0.3 {
        crate::urinary::filter_waste();
    }

    // ── Insulin: API token budget health ────────────────────────────────
    // Track how fast we're burning API credits. High insulin = suppress spending.
    // Uses cardiovascular blood pressure as the real-time spend indicator.
    let api_rate = bp.api_calls_per_minute;
    state.insulin = if api_rate > 40 {
        0.9  // critical — burning credits very fast
    } else if api_rate > 20 {
        0.6  // elevated — should slow down
    } else if api_rate > 10 {
        0.3  // moderate — normal usage
    } else {
        0.1  // healthy — budget is fine
    };

    // High insulin suppresses energy (like real insulin suppresses blood sugar)
    if state.insulin > 0.6 {
        state.energy_mode = (state.energy_mode * 0.7).max(0.1);
    }

    // ── Adrenaline: acute emergency burst ─────────────────────────────
    // Check for critical signals that warrant temporary full-power mode.
    // Adrenaline spikes then decays over 5 minutes.
    static ADRENALINE_SPIKE_AT: std::sync::atomic::AtomicI64 = std::sync::atomic::AtomicI64::new(0);

    // Spike triggers: critical hive reports, service crashes, high error rate
    let should_spike = hive_status.pending_decisions > 3
        || bp.errors_per_minute > 5
        || !dead_services.is_empty();

    if should_spike {
        ADRENALINE_SPIKE_AT.store(now, std::sync::atomic::Ordering::SeqCst);
    }

    let spike_at = ADRENALINE_SPIKE_AT.load(std::sync::atomic::Ordering::SeqCst);
    let since_spike = now - spike_at;
    state.adrenaline = if spike_at == 0 || since_spike > 300 {
        0.0  // no spike or expired (>5 min)
    } else if since_spike < 60 {
        1.0  // peak adrenaline (first minute)
    } else {
        // Decay: 1.0 → 0.0 over 5 minutes
        (1.0 - (since_spike as f32 / 300.0)).max(0.0)
    };

    // Adrenaline OVERRIDES conservation — emergency = full power
    if state.adrenaline > 0.5 {
        state.energy_mode = (state.energy_mode + 0.3).min(1.0);
        state.arousal = (state.arousal + 0.3).min(1.0);
    }

    // ── Leptin: knowledge satiety ─────────────────────────────────────
    // How much has BLADE learned recently? If a lot → stop researching.
    // If little → keep exploring.
    let db_path = crate::config::blade_config_dir().join("blade.db");
    let recent_memories = rusqlite::Connection::open(&db_path)
        .ok()
        .and_then(|conn| {
            let cutoff = now - 3600; // last hour
            conn.query_row(
                "SELECT COUNT(*) FROM typed_memories WHERE created_at > ?1",
                rusqlite::params![cutoff],
                |row| row.get::<_, i64>(0),
            ).ok()
        })
        .unwrap_or(0);

    state.leptin = if recent_memories > 20 {
        0.9  // very satiated — learned a lot this hour, stop researching
    } else if recent_memories > 10 {
        0.6  // moderately full
    } else if recent_memories > 3 {
        0.3  // slightly hungry for knowledge
    } else {
        0.1  // starving — should research more
    };

    state.last_updated = now;

    // Audit: log significant hormone changes
    let old = get_hormones();
    if (state.energy_mode - old.energy_mode).abs() > 0.15
        || (state.adrenaline - old.adrenaline).abs() > 0.3
        || (state.insulin - old.insulin).abs() > 0.2
    {
        crate::audit::record(
            "homeostasis",
            &format!("energy {:.1}→{:.1}, adrenaline {:.1}→{:.1}, insulin {:.1}→{:.1}",
                old.energy_mode, state.energy_mode,
                old.adrenaline, state.adrenaline,
                old.insulin, state.insulin),
            &format!("user_state={}, battery={}, api_rate={}/min, circadian={:.1}",
                user_state, on_battery, bp.api_calls_per_minute,
                profile[hour as usize]),
            "",
            "adjusted",
        );
    }

    // Write back
    if let Ok(mut guard) = hormone_store().lock() {
        *guard = state.clone();
    }

    // ── Physiological layer: decay + persist (Phase 27 / HORM-01) ──────────
    {
        let now_phys = chrono::Utc::now().timestamp();
        if let Ok(mut p) = physiology_store().lock() {
            apply_physiology_decay(&mut p, now_phys);
            persist_physiology_to_db(&p);
            // mortality_salience pass-through: safety_bundle.rs reads operational HormoneState
            state.mortality_salience = p.mortality_salience;
        }
    }

    // Persist to DB for restart recovery
    persist_to_db(&state);
}

/// Start the hypothalamus background loop (60s tick).
pub fn start_hypothalamus(app: tauri::AppHandle) {
    if HYPOTHALAMUS_RUNNING.swap(true, Ordering::SeqCst) {
        return;
    }
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(tokio::time::Duration::from_secs(60)).await;
            crate::supervisor::heartbeat("homeostasis");
            hypothalamus_tick();

            // ── Physiological threshold crossings (Phase 27 / HORM-09) ─────────
            {
                let p = get_physiology();
                if p.cortisol > 0.6 {
                    emit_hormone_threshold(&app, "cortisol", p.cortisol, "^", "elevated stress");
                }
                if p.norepinephrine > 0.6 {
                    emit_hormone_threshold(&app, "norepinephrine", p.norepinephrine, "^", "high alertness");
                }
                if p.mortality_salience > 0.6 {
                    emit_hormone_threshold(&app, "mortality_salience", p.mortality_salience, "^", "existential awareness elevated");
                }
            }

            // Emit hormone state for HUD/dashboard
            let hormones = get_hormones();
            let _ = app.emit("homeostasis_update", serde_json::json!({
                "arousal": hormones.arousal,
                "energy_mode": hormones.energy_mode,
                "exploration": hormones.exploration,
                "trust": hormones.trust,
                "urgency": hormones.urgency,
                "hunger": hormones.hunger,
                "thirst": hormones.thirst,
                "insulin": hormones.insulin,
                "adrenaline": hormones.adrenaline,
                "leptin": hormones.leptin,
            }));

            // Phase 3 WIRE-02 (Plan 03-01, D-64): parallel-emit under the new
            // canonical name `hormone_update`. Phase 4 HUD migration drops the
            // legacy `homeostasis_update` emit. Both kept here for one release
            // cycle to avoid breaking subscribers (HUD + body) mid-migration.
            //
            // Cross-window broadcast (`app.emit`, NOT `emit_to`) — matches
            // RECOVERY_LOG §5: main + HUD + body all subscribe.
            let _ = app.emit("hormone_update", serde_json::json!({
                "arousal": hormones.arousal,
                "energy_mode": hormones.energy_mode,
                "exploration": hormones.exploration,
                "trust": hormones.trust,
                "urgency": hormones.urgency,
                "hunger": hormones.hunger,
                "thirst": hormones.thirst,
                "insulin": hormones.insulin,
                "adrenaline": hormones.adrenaline,
                "leptin": hormones.leptin,
            }));
        }
    });
}

// ── Battery / Power Detection ─────────────────────────────────────────────────

/// Detect if the machine is running on battery power.
/// Returns true on battery, false on AC or if detection fails (desktops).
fn detect_battery_power() -> bool {
    #[cfg(target_os = "windows")]
    {
        // Windows: GetSystemPowerStatus
        #[repr(C)]
        #[allow(non_snake_case)]
        struct SystemPowerStatus {
            ACLineStatus: u8,
            BatteryFlag: u8,
            BatteryLifePercent: u8,
            SystemStatusFlag: u8,
            BatteryLifeTime: u32,
            BatteryFullLifeTime: u32,
        }
        extern "system" {
            fn GetSystemPowerStatus(status: *mut SystemPowerStatus) -> i32;
        }
        unsafe {
            let mut status = std::mem::zeroed::<SystemPowerStatus>();
            if GetSystemPowerStatus(&mut status) != 0 {
                // ACLineStatus: 0 = offline (battery), 1 = online (AC)
                return status.ACLineStatus == 0;
            }
        }
        false
    }

    #[cfg(target_os = "linux")]
    {
        // Linux: check /sys/class/power_supply/BAT0/status
        if let Ok(status) = std::fs::read_to_string("/sys/class/power_supply/BAT0/status") {
            return status.trim() == "Discharging";
        }
        // WSL or desktop without battery
        false
    }

    #[cfg(target_os = "macos")]
    {
        // macOS: pmset -g batt
        if let Ok(output) = std::process::Command::new("pmset").args(["-g", "batt"]).output() {
            let text = String::from_utf8_lossy(&output.stdout);
            return text.contains("Battery Power");
        }
        false
    }

    #[cfg(not(any(target_os = "windows", target_os = "linux", target_os = "macos")))]
    {
        false
    }
}

// ── Learned Circadian Profile ─────────────────────────────────────────────────
//
// A 24-slot array where each slot is the probability (0.0-1.0) that the user
// is active at that hour. Built from the last 14 days of activity_monitor data.
//
// For a user who works 12pm-3am:
//   hours 4-11: ~0.05 (asleep)
//   hour 12: ~0.4 (waking up)
//   hours 13-2: ~0.8 (peak work)
//   hour 3: ~0.3 (winding down)
//
// Cached in SQLite settings to avoid recomputing every 60s tick.
// Recomputed once per day (or on first run).

const CIRCADIAN_DB_KEY: &str = "circadian_profile";
const CIRCADIAN_RECOMPUTE_INTERVAL: i64 = 86400; // 24 hours

/// Returns a 24-element array of activity probabilities per hour.
/// Falls back to a flat 0.5 profile if no data is available.
fn load_circadian_profile() -> [f32; 24] {
    // Try cached profile first
    if let Some((profile, computed_at)) = load_cached_profile() {
        let now = chrono::Utc::now().timestamp();
        if now - computed_at < CIRCADIAN_RECOMPUTE_INTERVAL {
            return profile;
        }
    }

    // Recompute from activity_monitor data
    let profile = compute_circadian_from_activity();

    // Cache it
    save_cached_profile(&profile);

    profile
}

/// Compute circadian profile from the last 14 days of activity_monitor rows.
/// Each row has a timestamp + app_name. We count how many 30s observations
/// fell in each hour slot, then normalize to 0.0-1.0.
fn compute_circadian_from_activity() -> [f32; 24] {
    let db_path = crate::config::blade_config_dir().join("blade.db");
    let conn = match rusqlite::Connection::open(&db_path) {
        Ok(c) => c,
        Err(_) => return [0.5; 24], // no data — flat profile
    };

    let cutoff = chrono::Utc::now().timestamp() - (14 * 86400); // 14 days

    // Count observations per hour of day (local time)
    // We store UTC timestamps, so we convert to local hour in SQL
    let mut hour_counts = [0u32; 24];
    let mut total_days_observed = 0u32;

    // Get all timestamps from activity_monitor in the last 14 days
    let mut stmt = match conn.prepare(
        "SELECT timestamp FROM activity_monitor WHERE timestamp > ?1"
    ) {
        Ok(s) => s,
        Err(_) => return [0.5; 24],
    };

    let timestamps: Vec<i64> = stmt
        .query_map(rusqlite::params![cutoff], |row| row.get::<_, i64>(0))
        .ok()
        .map(|rows| rows.filter_map(|r| r.ok()).collect())
        .unwrap_or_default();

    if timestamps.is_empty() {
        return [0.5; 24]; // no data — flat profile
    }

    // Track which days we have data for
    let mut days_seen = std::collections::HashSet::new();

    for ts in &timestamps {
        if let Some(dt) = chrono::DateTime::from_timestamp(*ts, 0) {
            let local = dt.with_timezone(&chrono::Local);
            let hour = local.format("%H").to_string().parse::<usize>().unwrap_or(0);
            let day = local.format("%Y-%m-%d").to_string();
            hour_counts[hour] += 1;
            days_seen.insert(day);
        }
    }

    total_days_observed = days_seen.len() as u32;
    if total_days_observed == 0 {
        return [0.5; 24];
    }

    // Normalize: for each hour, probability = observations / (days * max_observations_per_hour)
    // Each hour can have at most 120 observations per day (30s intervals × 60 min)
    let max_per_hour_per_day = 120.0f32;
    let mut profile = [0.0f32; 24];

    for h in 0..24 {
        let raw = hour_counts[h] as f32 / (total_days_observed as f32 * max_per_hour_per_day);
        profile[h] = raw.clamp(0.0, 1.0);
    }

    // Smooth: apply a simple 3-hour moving average to reduce noise
    let mut smoothed = [0.0f32; 24];
    for h in 0..24 {
        let prev = if h == 0 { 23 } else { h - 1 };
        let next = if h == 23 { 0 } else { h + 1 };
        smoothed[h] = (profile[prev] * 0.2 + profile[h] * 0.6 + profile[next] * 0.2).clamp(0.0, 1.0);
    }

    smoothed
}

fn load_cached_profile() -> Option<([f32; 24], i64)> {
    let db_path = crate::config::blade_config_dir().join("blade.db");
    let conn = rusqlite::Connection::open(&db_path).ok()?;
    let json: String = conn.query_row(
        "SELECT value FROM settings WHERE key = ?1",
        rusqlite::params![CIRCADIAN_DB_KEY],
        |row| row.get(0),
    ).ok()?;

    #[derive(Deserialize)]
    struct CachedProfile {
        profile: [f32; 24],
        computed_at: i64,
    }

    let cached: CachedProfile = serde_json::from_str(&json).ok()?;
    Some((cached.profile, cached.computed_at))
}

fn save_cached_profile(profile: &[f32; 24]) {
    let db_path = crate::config::blade_config_dir().join("blade.db");
    if let Ok(conn) = rusqlite::Connection::open(&db_path) {
        let data = serde_json::json!({
            "profile": profile,
            "computed_at": chrono::Utc::now().timestamp(),
        });
        if let Ok(json) = serde_json::to_string(&data) {
            let _ = conn.execute(
                "INSERT INTO settings (key, value) VALUES (?1, ?2)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                rusqlite::params![CIRCADIAN_DB_KEY, json],
            );
        }
    }
}

// ── DB persistence ───────────────────────────────────────────────────────────

fn load_from_db() -> Option<HormoneState> {
    let db_path = crate::config::blade_config_dir().join("blade.db");
    let conn = rusqlite::Connection::open(&db_path).ok()?;
    let json: String = conn.query_row(
        "SELECT value FROM settings WHERE key = 'homeostasis'",
        [],
        |row| row.get(0),
    ).ok()?;
    serde_json::from_str(&json).ok()
}

fn persist_to_db(state: &HormoneState) {
    let db_path = crate::config::blade_config_dir().join("blade.db");
    if let Ok(conn) = rusqlite::Connection::open(&db_path) {
        if let Ok(json) = serde_json::to_string(state) {
            let _ = conn.execute(
                "INSERT INTO settings (key, value) VALUES ('homeostasis', ?1)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                rusqlite::params![json],
            );
        }
    }
}

// ── Physiological State DB persistence (Phase 27 / HORM-01) ─────────────────

fn load_physiology_from_db() -> Option<PhysiologicalState> {
    let db_path = crate::config::blade_config_dir().join("blade.db");
    let conn = rusqlite::Connection::open(&db_path).ok()?;
    let json: String = conn.query_row(
        "SELECT value FROM settings WHERE key = 'physiology'",
        [],
        |row| row.get(0),
    ).ok()?;
    serde_json::from_str(&json).ok()
}

fn persist_physiology_to_db(state: &PhysiologicalState) {
    let db_path = crate::config::blade_config_dir().join("blade.db");
    if let Ok(conn) = rusqlite::Connection::open(&db_path) {
        if let Ok(json) = serde_json::to_string(state) {
            let _ = conn.execute(
                "INSERT INTO settings (key, value) VALUES ('physiology', ?1)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                rusqlite::params![json],
            );
        }
    }
}

/// Emit a threshold crossing event to the ActivityStrip.
fn emit_hormone_threshold(app: &tauri::AppHandle, hormone: &str, value: f32, direction: &str, reason: &str) {
    let summary = format!("{} {} {:.2} -- {}", hormone, direction, value, reason);
    let _ = app.emit_to("main", "blade_activity_log", serde_json::json!({
        "module":        "homeostasis.physiology",
        "action":        "threshold_crossing",
        "human_summary": crate::safe_slice(&summary, 200),
        "payload_id":    serde_json::Value::Null,
        "timestamp":     chrono::Utc::now().timestamp(),
    }));
}

// ── Pituitary Gland: translate hormones → per-module directives ──────────────
//
// The hypothalamus produces abstract state (arousal, energy, trust...).
// Individual modules don't know what "energy 0.3" means for THEM.
// The pituitary translates into concrete settings per module.

/// Directive for a specific module — what it should do right now.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModuleDirective {
    /// Which LLM tier to use: "quality" | "balanced" | "cheap" | "skip"
    pub model_tier: String,
    /// How frequently to poll/tick (multiplier: 1.0 = normal, 0.5 = half, 2.0 = double)
    pub poll_rate: f32,
    /// Whether to run expensive operations (LLM calls, web fetches, etc.)
    pub allow_expensive_ops: bool,
    /// Whether to act autonomously or ask first
    pub autonomous: bool,
    /// One-line reason for these settings (for debugging/display)
    pub reason: String,
}

/// GH (Growth Hormone) — should BLADE actively seek new capabilities?
/// Blended with physiological dopamine at 0.7/0.3 weight (Phase 27 / HORM-01).
pub fn growth_hormone() -> f32 {
    let h = get_hormones();
    let p = get_physiology();
    // Grow when: energy is high, user is idle (exploration opportunity), trust is decent
    let operational = h.exploration * 0.5 + h.energy_mode * 0.3 + h.trust * 0.2;
    let blended = operational * 0.7 + p.dopamine * 0.3;
    blended.clamp(0.0, 1.0)
}

/// TSH (Thyroid-Stimulating) — how aggressively should background modules run?
/// Blended with physiological serotonin at 0.7/0.3 weight (Phase 27 / HORM-01).
pub fn thyroid_stimulating() -> f32 {
    let h = get_hormones();
    let p = get_physiology();
    // High metabolism when: energy is high, arousal is moderate (not sleeping, not panicking)
    let operational = h.energy_mode * 0.6 + (1.0 - h.urgency.abs()) * 0.2 + h.arousal * 0.2;
    let blended = operational * 0.7 + p.serotonin * 0.3;
    blended.clamp(0.0, 1.0)
}

/// ACTH — how cautious should decision-making be?
/// High ACTH = high cortisol = more cautious.
/// Blended with physiological cortisol at 0.7/0.3 weight (Phase 27 / HORM-01).
pub fn acth() -> f32 {
    let h = get_hormones();
    let p = get_physiology();
    // Cautious when: urgency is high (something's wrong), trust is low
    let operational = h.urgency * 0.5 + (1.0 - h.trust) * 0.3 + (1.0 - h.exploration) * 0.2;
    let blended = operational * 0.7 + p.cortisol * 0.3;
    blended.clamp(0.0, 1.0)
}

/// Oxytocin — how personal/warm should BLADE be?
/// Blended with physiological oxytocin at 0.7/0.3 weight (Phase 27 / HORM-01).
pub fn oxytocin() -> f32 {
    let h = get_hormones();
    let p = get_physiology();
    // Warm when: trust is high, urgency is low (not in crisis mode)
    let operational = h.trust * 0.6 + (1.0 - h.urgency) * 0.3 + h.arousal * 0.1;
    let blended = operational * 0.7 + p.oxytocin * 0.3;
    blended.clamp(0.0, 1.0)
}

/// ADH (vasopressin) — how aggressively should BLADE conserve resources?
/// Blended with physiological norepinephrine at 0.7/0.3 weight (Phase 27 / HORM-01).
pub fn adh() -> f32 {
    let h = get_hormones();
    let p = get_physiology();
    // Conserve when: energy is low, hunger is low (no urgent work needing resources)
    let operational = (1.0 - h.energy_mode) * 0.5 + (1.0 - h.hunger) * 0.3 + h.thirst * 0.2;
    let blended = operational * 0.7 + p.norepinephrine * 0.3;
    blended.clamp(0.0, 1.0)
}

/// Get a concrete directive for a specific module based on current pituitary output.
/// Modules call this instead of reading raw hormones.
pub fn get_directive(module: &str) -> ModuleDirective {
    let tsh = thyroid_stimulating();
    let gh = growth_hormone();
    let cortisol = acth();
    let conserve = adh();
    let warmth = oxytocin();
    let h = get_hormones();

    match module {
        // Evolution: controlled by GH (growth) + energy
        "evolution" => ModuleDirective {
            model_tier: if gh > 0.6 { "balanced" } else { "skip" }.to_string(),
            poll_rate: gh,
            allow_expensive_ops: gh > 0.4 && h.energy_mode > 0.3,
            autonomous: h.trust > 0.5 && gh > 0.5,
            reason: format!("GH={:.1}, energy={:.1}", gh, h.energy_mode),
        },

        // Hive tentacles: controlled by TSH (metabolism) + arousal
        "hive" | "tentacle" => ModuleDirective {
            model_tier: if tsh > 0.6 { "balanced" } else { "cheap" }.to_string(),
            poll_rate: (tsh * 1.5).clamp(0.3, 2.0), // 0.3x to 2x normal rate
            allow_expensive_ops: tsh > 0.5,
            autonomous: h.trust > 0.6,
            reason: format!("TSH={:.1}, arousal={:.1}", tsh, h.arousal),
        },

        // Brain planner: energy determines model quality
        "brain_planner" => ModuleDirective {
            model_tier: if h.energy_mode > 0.7 { "quality" }
                else if h.energy_mode > 0.4 { "balanced" }
                else { "cheap" }.to_string(),
            poll_rate: 1.0, // always runs on demand
            allow_expensive_ops: h.energy_mode > 0.3,
            autonomous: false, // brain planner never acts autonomously
            reason: format!("energy={:.1}", h.energy_mode),
        },

        // Decision gate: ACTH controls caution level
        "decision_gate" => ModuleDirective {
            model_tier: "cheap".to_string(), // decisions are always cheap
            poll_rate: 1.0,
            allow_expensive_ops: false,
            autonomous: cortisol < 0.4, // low cortisol = more autonomous
            reason: format!("ACTH={:.1}, trust={:.1}", cortisol, h.trust),
        },

        // Dream mode: runs during conservation (ADH high, arousal low)
        "dream_mode" => ModuleDirective {
            model_tier: "cheap".to_string(),
            poll_rate: if h.arousal < 0.3 { 1.5 } else { 0.5 }, // more active when idle
            allow_expensive_ops: conserve > 0.5 && h.arousal < 0.3,
            autonomous: true, // dream mode is always autonomous
            reason: format!("ADH={:.1}, arousal={:.1}", conserve, h.arousal),
        },

        // Persona/communication: oxytocin controls warmth
        "persona" | "communication" => ModuleDirective {
            model_tier: "balanced".to_string(),
            poll_rate: 1.0,
            allow_expensive_ops: true,
            autonomous: false,
            reason: format!("oxytocin={:.1}, trust={:.1}", warmth, h.trust),
        },

        // Background research: GH + low arousal (idle time)
        "research" => ModuleDirective {
            model_tier: if gh > 0.5 { "cheap" } else { "skip" }.to_string(),
            poll_rate: gh * 0.8,
            allow_expensive_ops: gh > 0.5 && h.arousal < 0.4,
            autonomous: true,
            reason: format!("GH={:.1}, arousal={:.1}", gh, h.arousal),
        },

        // Default: balanced, follow energy level
        _ => ModuleDirective {
            model_tier: if h.energy_mode > 0.5 { "balanced" } else { "cheap" }.to_string(),
            poll_rate: tsh,
            allow_expensive_ops: h.energy_mode > 0.4,
            autonomous: h.trust > 0.5,
            reason: format!("energy={:.1}, trust={:.1}", h.energy_mode, h.trust),
        },
    }
}

// ── Tauri Commands ───────────────────────────────────────────────────────────

#[tauri::command]
pub fn homeostasis_get() -> HormoneState {
    get_hormones()
}

#[tauri::command]
pub fn homeostasis_get_directive(module: String) -> ModuleDirective {
    get_directive(&module)
}

/// Returns the learned 24-hour circadian profile.
/// Each element is the probability (0.0-1.0) the user is active at that hour.
/// Index 0 = midnight, index 12 = noon, index 23 = 11pm.
#[tauri::command]
pub fn homeostasis_get_circadian() -> Vec<f32> {
    load_circadian_profile().to_vec()
}

/// Force recompute the circadian profile from activity data.
/// Useful after first week of use or if schedule changed.
#[tauri::command]
pub fn homeostasis_relearn_circadian() -> Vec<f32> {
    let profile = compute_circadian_from_activity();
    save_cached_profile(&profile);
    profile.to_vec()
}

/// Returns the current physiological hormone state (Phase 27 / HORM-08).
/// Read-only — no mutation path. Exposed for DoctorPane and diagnostic UI.
#[tauri::command]
pub fn homeostasis_get_physiology() -> PhysiologicalState {
    get_physiology()
}

use tauri::Emitter;
