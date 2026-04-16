/// CARDIOVASCULAR SYSTEM — BLADE's data flow monitoring and event registry.
///
/// The heart pumps data through the body. Arteries (emit) carry data from
/// backend to frontend. Veins (invoke) carry data from frontend to backend.
/// Capillaries (inter-module calls) exchange data between organs.
///
/// This module provides:
///   1. Event registry — central list of ALL 94+ events with metadata
///   2. Flow monitor — tracks events/minute, data volume, error rate
///   3. Blood pressure — real-time health of the circulatory system
///   4. Pulse rate — how fast data is flowing (events per second)

use serde::{Deserialize, Serialize};
use std::sync::{Mutex, OnceLock};
use std::collections::HashMap;

// ── Flow Monitor ─────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Default)]
struct FlowCounters {
    /// Events emitted per event name in the last minute
    events_per_minute: HashMap<String, u32>,
    /// Total events this minute
    total_this_minute: u32,
    /// Total events since startup
    total_lifetime: u64,
    /// API calls this minute (provider calls)
    api_calls_this_minute: u32,
    /// API calls since startup
    api_calls_lifetime: u64,
    /// Errors this minute
    errors_this_minute: u32,
    /// Last reset timestamp
    last_reset: i64,
}

static FLOW: OnceLock<Mutex<FlowCounters>> = OnceLock::new();

fn flow_store() -> &'static Mutex<FlowCounters> {
    FLOW.get_or_init(|| Mutex::new(FlowCounters::default()))
}

/// Record an event emission. Called from a lightweight hook, NOT from every
/// module individually — we intercept at the Tauri emit level.
pub fn record_event(event_name: &str) {
    if let Ok(mut flow) = flow_store().lock() {
        let now = chrono::Utc::now().timestamp();
        // Reset counters every 60 seconds
        if now - flow.last_reset >= 60 {
            flow.events_per_minute.clear();
            flow.total_this_minute = 0;
            flow.api_calls_this_minute = 0;
            flow.errors_this_minute = 0;
            flow.last_reset = now;
        }
        *flow.events_per_minute.entry(event_name.to_string()).or_insert(0) += 1;
        flow.total_this_minute += 1;
        flow.total_lifetime += 1;
    }
}

/// Record an API call (provider call to LLM).
pub fn record_api_call() {
    if let Ok(mut flow) = flow_store().lock() {
        flow.api_calls_this_minute += 1;
        flow.api_calls_lifetime += 1;
    }
}

/// Record an error.
pub fn record_error() {
    if let Ok(mut flow) = flow_store().lock() {
        flow.errors_this_minute += 1;
    }
}

// ── Blood Pressure (system health snapshot) ──────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BloodPressure {
    /// Events per minute (pulse rate)
    pub events_per_minute: u32,
    /// API calls per minute (metabolic rate)
    pub api_calls_per_minute: u32,
    /// Errors per minute (infection rate)
    pub errors_per_minute: u32,
    /// Total events since startup
    pub total_events: u64,
    /// Total API calls since startup
    pub total_api_calls: u64,
    /// Top 5 most active event channels
    pub hottest_channels: Vec<(String, u32)>,
    /// Health assessment
    pub status: String, // "healthy" | "elevated" | "critical"
}

/// Get the current blood pressure — real-time health of data flow.
pub fn get_blood_pressure() -> BloodPressure {
    let flow = flow_store().lock()
        .map(|f| f.clone())
        .unwrap_or_default();

    let mut hottest: Vec<(String, u32)> = flow.events_per_minute
        .iter()
        .map(|(k, v)| (k.clone(), *v))
        .collect();
    hottest.sort_by(|a, b| b.1.cmp(&a.1));
    hottest.truncate(5);

    let status = if flow.errors_this_minute > 10 {
        "critical" // too many errors
    } else if flow.api_calls_this_minute > 30 {
        "elevated" // burning API credits fast
    } else if flow.total_this_minute > 200 {
        "elevated" // event storm
    } else {
        "healthy"
    };

    BloodPressure {
        events_per_minute: flow.total_this_minute,
        api_calls_per_minute: flow.api_calls_this_minute,
        errors_per_minute: flow.errors_this_minute,
        total_events: flow.total_lifetime,
        total_api_calls: flow.api_calls_lifetime,
        hottest_channels: hottest,
        status: status.to_string(),
    }
}

// ── Event Registry ───────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EventInfo {
    pub name: String,
    pub direction: String, // "backend→frontend" | "frontend→backend" | "internal"
    pub category: String,  // "chat" | "voice" | "hive" | "vision" | "system" | "agent"
    pub description: String,
}

/// Central registry of ALL known events. This is the circulatory map —
/// every artery, vein, and capillary documented in one place.
pub fn get_event_registry() -> Vec<EventInfo> {
    vec![
        // Chat flow
        ev("chat_token", "backend→frontend", "chat", "Streaming text chunk from LLM"),
        ev("chat_done", "backend→frontend", "chat", "Response complete"),
        ev("chat_ack", "backend→frontend", "chat", "Fast acknowledgment before main response"),
        ev("chat_cancelled", "backend→frontend", "chat", "User cancelled the request"),
        ev("chat_routing", "backend→frontend", "chat", "Provider/model selected for this request"),
        ev("blade_status", "backend→frontend", "system", "Processing state: idle/processing/error"),
        ev("blade_planning", "backend→frontend", "chat", "Brain planner activated for complex task"),

        // Voice
        ev("voice_conversation_listening", "backend→frontend", "voice", "Waiting for speech"),
        ev("voice_conversation_thinking", "backend→frontend", "voice", "Processing spoken command"),
        ev("voice_conversation_speaking", "backend→frontend", "voice", "TTS playing response"),
        ev("voice_conversation_ended", "backend→frontend", "voice", "Voice session ended"),
        ev("voice_chat_submit", "backend→frontend", "voice", "Voice command routed to chat pipeline"),
        ev("voice_user_message", "backend→frontend", "voice", "Spoken message for chat history"),
        ev("voice_emotion_detected", "backend→frontend", "voice", "Emotion detected from voice"),
        ev("voice_language_detected", "backend→frontend", "voice", "Non-English language detected"),
        ev("wake_word_detected", "backend→frontend", "voice", "Hey BLADE triggered"),

        // Vision
        ev("screenshot_taken", "backend→frontend", "vision", "Screen capture completed"),
        ev("timeline_tick", "backend→frontend", "vision", "New screenshot in timeline"),
        ev("screen_context_switch", "internal", "vision", "App/window changed — triggers proactive analysis"),
        ev("proactive_card", "backend→frontend", "vision", "Proactive insight/task/focus card"),

        // Hive
        ev("hive_tick", "backend→frontend", "hive", "Hive 30s cycle completed"),
        ev("hive_action", "backend→frontend", "hive", "Hive executed an action"),
        ev("hive_escalate", "backend→frontend", "hive", "Hive needs user decision"),
        ev("hive_inform", "backend→frontend", "hive", "Hive surfacing information"),

        // Tools
        ev("tool_executing", "backend→frontend", "chat", "Tool call started"),
        ev("tool_completed", "backend→frontend", "chat", "Tool call finished"),
        ev("tool_approval_needed", "backend→frontend", "chat", "Ask-risk tool needs user approval"),
        ev("blade_evolving", "backend→frontend", "system", "Immune system acquiring capability"),

        // Agents
        ev("agent_message", "backend→frontend", "agent", "Background agent output"),
        ev("agent_done", "backend→frontend", "agent", "Background agent completed"),
        ev("swarm_progress", "backend→frontend", "agent", "Swarm task progress update"),
        ev("swarm_completed", "backend→frontend", "agent", "Swarm finished all tasks"),

        // Homeostasis
        ev("homeostasis_update", "backend→frontend", "system", "Hormone state broadcast"),

        // Ambient
        ev("proactive_nudge", "backend→frontend", "system", "Proactive suggestion from ambient/hive"),
        ev("smart_interrupt", "backend→frontend", "system", "User stuck on error >5 min"),
        ev("ambient_update", "backend→frontend", "system", "Activity context update"),

        // Learning
        ev("blade_suggestion", "backend→frontend", "system", "Prediction-based suggestion"),
        ev("blade_reflex", "backend→frontend", "system", "Learned reflex auto-executed"),
        ev("brain_grew", "backend→frontend", "system", "New entities extracted from conversation"),
        ev("skill_learned", "backend→frontend", "system", "Tool pattern graduated to skill"),
        ev("response_improved", "backend→frontend", "chat", "Self-critique rebuilt response"),

        // System
        ev("blade_notification", "backend→frontend", "system", "OS-level notification"),
        ev("blade_toast", "backend→frontend", "system", "HUD toast message"),
        ev("hud_update", "backend→frontend", "system", "HUD bar data refresh"),
        ev("godmode_update", "backend→frontend", "system", "God mode scan completed"),
    ]
}

fn ev(name: &str, direction: &str, category: &str, description: &str) -> EventInfo {
    EventInfo {
        name: name.to_string(),
        direction: direction.to_string(),
        category: category.to_string(),
        description: description.to_string(),
    }
}

// ── Wire into provider calls for API tracking ────────────────────────────────

/// Call this from providers/mod.rs after every complete_turn call.
/// Tracks API call volume for blood pressure monitoring.
pub fn on_provider_call_complete(provider: &str, model: &str, success: bool) {
    record_api_call();
    if !success {
        record_error();
    }

    // Feed into homeostasis hunger — more API calls = more resources consumed
    // This creates a natural feedback loop: high API usage → homeostasis detects
    // high "metabolic rate" → pituitary adjusts TSH → modules slow down
}

// ── Vital Signs: full body health check ───────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VitalSigns {
    /// Hormones
    pub hormones: crate::homeostasis::HormoneState,
    /// Blood pressure (data flow health)
    pub blood_pressure: BloodPressure,
    /// Immune status (threats)
    pub immune: crate::urinary::ImmuneStatus,
    /// Service health (how many alive, crashed, dead)
    pub services_alive: usize,
    pub services_dead: Vec<String>,
    /// Brain state
    pub brain_working_memory_active: bool,
    /// Hive organ count
    pub hive_organs_active: usize,
    /// Focus score
    pub focus_score: u32,
    /// Overall status
    pub overall: String, // "healthy" | "stressed" | "critical" | "conserving"
}

/// Full body health check — like a doctor checking vitals.
pub fn check_vital_signs() -> VitalSigns {
    let hormones = crate::homeostasis::get_hormones();
    let bp = get_blood_pressure();
    let immune = crate::urinary::get_immune_status();
    let hive = crate::hive::get_hive_status();
    let wm = crate::prefrontal::get();
    let focus = crate::proactive_vision::compute_daily_focus_score();

    let service_health = crate::supervisor::supervisor_get_health();
    let alive = service_health.iter().filter(|s| s.status == "running").count();
    let dead: Vec<String> = service_health.iter()
        .filter(|s| s.status == "dead")
        .map(|s| s.name.clone())
        .collect();

    // Overall status assessment
    let overall = if !dead.is_empty() || immune.status == "under_attack" || bp.status == "critical" {
        "critical"
    } else if hormones.adrenaline > 0.5 || hormones.insulin > 0.7 || bp.status == "elevated" {
        "stressed"
    } else if hormones.energy_mode < 0.25 {
        "conserving"
    } else {
        "healthy"
    };

    VitalSigns {
        hormones,
        blood_pressure: bp,
        immune,
        services_alive: alive,
        services_dead: dead,
        brain_working_memory_active: wm.active,
        hive_organs_active: hive.active_tentacles,
        focus_score: focus.score,
        overall: overall.to_string(),
    }
}

// ── Tauri Commands ───────────────────────────────────────────────────────────

#[tauri::command]
pub fn cardio_get_blood_pressure() -> BloodPressure {
    get_blood_pressure()
}

#[tauri::command]
pub fn cardio_get_event_registry() -> Vec<EventInfo> {
    get_event_registry()
}

/// Full body health check — all vital signs in one call.
#[tauri::command]
pub fn blade_vital_signs() -> VitalSigns {
    check_vital_signs()
}
