/// VOICE INTELLIGENCE — Emotion-aware voice context for BLADE.
///
/// Goes beyond raw transcription: classifies the user's emotional state from
/// their words, adapts spoken responses accordingly, and maintains session
/// continuity across multiple voice turns so BLADE can track topic drift,
/// conversational momentum, and shift tone on the fly.
///
/// LLM usage:
///   - Emotion detection  → cheap/fast model (haiku-class)
///   - Response adaptation → quality model (full provider)
///   - Topic change detection → cheap/fast model

use rusqlite::params;
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

// ---------------------------------------------------------------------------
// Static session state
// ---------------------------------------------------------------------------

static CURRENT_SESSION_ID: Mutex<Option<String>> = Mutex::new(None);

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VoiceSegment {
    pub transcript: String,
    pub timestamp: i64,
    /// One of: "neutral" | "excited" | "frustrated" | "tired" | "focused" | "casual"
    pub detected_emotion: String,
    /// Rough words-per-minute estimate derived from transcript length vs a 15-second
    /// audio window assumption. Caller can override by providing a real duration.
    pub speaking_rate: f32,
    /// LLM confidence in the emotion classification, 0.0–1.0.
    pub confidence: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VoiceSession {
    pub session_id: String,
    pub started_at: i64,
    pub segments: Vec<VoiceSegment>,
    /// The single emotion that appeared most frequently across all segments.
    pub dominant_emotion: String,
    /// Short topic labels extracted by the system over the session's lifetime.
    pub topic_thread: Vec<String>,
}

#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VoiceResponse {
    pub text: String,
    /// One of: "warm" | "energetic" | "calm" | "focused" | "encouraging"
    pub tone: String,
    /// One of: "slow" | "normal" | "fast"
    pub pace: String,
    /// Free-text notes for TTS post-processing, e.g. "speak slowly, pause after each point".
    pub style_notes: String,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn now_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

fn db_path() -> std::path::PathBuf {
    crate::config::blade_config_dir().join("blade.db")
}

/// Estimate speaking rate from transcript text.
/// Assumes a typical 15-second audio window; returns words-per-minute.
fn estimate_speaking_rate(transcript: &str) -> f32 {
    let word_count = transcript.split_whitespace().count() as f32;
    // 15 seconds assumed window → convert to minutes
    let minutes = 15.0_f32 / 60.0;
    if minutes > 0.0 {
        word_count / minutes
    } else {
        120.0 // neutral default
    }
}

/// Compute dominant emotion across all segments.
fn compute_dominant(segments: &[VoiceSegment]) -> String {
    if segments.is_empty() {
        return "neutral".to_string();
    }
    let mut counts = std::collections::HashMap::<&str, usize>::new();
    for seg in segments {
        *counts.entry(seg.detected_emotion.as_str()).or_insert(0) += 1;
    }
    counts
        .into_iter()
        .max_by_key(|(_, c)| *c)
        .map(|(e, _)| e.to_string())
        .unwrap_or_else(|| "neutral".to_string())
}

/// Strip markdown code fences that LLMs occasionally wrap responses in.
#[allow(dead_code)]
fn strip_fences(s: &str) -> &str {
    let s = s.trim();
    if s.starts_with("```") {
        let after = s.trim_start_matches('`');
        let after = after.trim_start_matches("json").trim_start_matches('\n');
        if let Some(end) = after.rfind("```") {
            return after[..end].trim();
        }
        return after.trim();
    }
    s
}

/// Cheap model for fast classification tasks.
fn fast_model(provider: &str) -> &'static str {
    match provider {
        "anthropic" => "claude-haiku-4-5-20251001",
        "openai"    => "gpt-4o-mini",
        "gemini"    => "gemini-2.0-flash",
        "groq"      => "llama-3.1-8b-instant",
        _           => "gemini-2.0-flash",
    }
}

/// One-shot LLM call — returns raw text content.
async fn llm_call(
    provider: &str,
    api_key: &str,
    model: &str,
    base_url: Option<&str>,
    system: &str,
    user_msg: &str,
) -> Result<String, String> {
    use crate::providers::{complete_turn, ConversationMessage};
    let messages = vec![
        ConversationMessage::System(system.to_string()),
        ConversationMessage::User(user_msg.to_string()),
    ];
    let turn = complete_turn(provider, api_key, model, &messages, &crate::providers::no_tools(), base_url).await?;
    Ok(turn.content)
}

// ---------------------------------------------------------------------------
// Database schema
// ---------------------------------------------------------------------------

pub fn ensure_tables() {
    let conn = match rusqlite::Connection::open(db_path()) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("[voice_intelligence] DB open failed: {e}");
            return;
        }
    };
    let _ = conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS voice_sessions (
            session_id   TEXT PRIMARY KEY,
            started_at   INTEGER NOT NULL,
            ended_at     INTEGER,
            dominant_emotion TEXT NOT NULL DEFAULT 'neutral',
            topic_thread_json TEXT NOT NULL DEFAULT '[]'
        );
        CREATE TABLE IF NOT EXISTS voice_segments (
            id               INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id       TEXT NOT NULL,
            transcript       TEXT NOT NULL,
            timestamp        INTEGER NOT NULL,
            detected_emotion TEXT NOT NULL DEFAULT 'neutral',
            speaking_rate    REAL NOT NULL DEFAULT 120.0,
            confidence       REAL NOT NULL DEFAULT 0.5,
            FOREIGN KEY (session_id) REFERENCES voice_sessions(session_id)
        );",
    );
}

// ---------------------------------------------------------------------------
// Session management
// ---------------------------------------------------------------------------

/// Create a new voice session, store it in the DB, and track it in static state.
/// Returns the new session_id (UUID v4).
pub fn start_voice_session() -> String {
    ensure_tables();

    let session_id = uuid::Uuid::new_v4().to_string();
    let started_at = now_secs();

    if let Ok(conn) = rusqlite::Connection::open(db_path()) {
        let _ = conn.execute(
            "INSERT INTO voice_sessions (session_id, started_at, dominant_emotion, topic_thread_json)
             VALUES (?1, ?2, 'neutral', '[]')",
            params![session_id, started_at],
        );
    }

    if let Ok(mut guard) = CURRENT_SESSION_ID.lock() {
        *guard = Some(session_id.clone());
    }

    session_id
}

/// Mark a session as ended, return the fully populated VoiceSession.
pub fn end_voice_session(session_id: &str) -> Option<VoiceSession> {
    let ended_at = now_secs();

    if let Some(conn) = rusqlite::Connection::open(db_path()).ok() {
        let _ = conn.execute(
            "UPDATE voice_sessions SET ended_at = ?1 WHERE session_id = ?2",
            params![ended_at, session_id],
        );
    }

    // Clear static if this was the active session.
    if let Ok(mut guard) = CURRENT_SESSION_ID.lock() {
        if guard.as_deref() == Some(session_id) {
            *guard = None;
        }
    }

    load_session(session_id)
}

/// Append a segment to an existing session.
pub fn add_segment(session_id: &str, transcript: &str, emotion: &str, confidence: f32) {
    ensure_tables();

    let ts = now_secs();
    let rate = estimate_speaking_rate(transcript);
    let emotion = normalize_emotion(emotion);

    if let Ok(conn) = rusqlite::Connection::open(db_path()) {
        let _ = conn.execute(
            "INSERT INTO voice_segments
                (session_id, transcript, timestamp, detected_emotion, speaking_rate, confidence)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![session_id, transcript, ts, emotion, rate, confidence],
        );

        // Recompute dominant emotion across all segments for this session.
        let segs = load_segments_for_session(session_id, &conn);
        let dominant = compute_dominant(&segs);
        let _ = conn.execute(
            "UPDATE voice_sessions SET dominant_emotion = ?1 WHERE session_id = ?2",
            params![dominant, session_id],
        );
    }
}

/// Return the currently active session if one exists.
#[allow(dead_code)]
pub fn get_current_session() -> Option<VoiceSession> {
    let session_id = CURRENT_SESSION_ID.lock().ok()?.clone()?;
    load_session(&session_id)
}

/// Return the N most-recently-started sessions.
#[allow(dead_code)]
pub fn list_recent_sessions(limit: usize) -> Vec<VoiceSession> {
    ensure_tables();
    let conn = match rusqlite::Connection::open(db_path()) {
        Ok(c) => c,
        Err(_) => return Vec::new(),
    };

    let mut stmt = match conn.prepare(
        "SELECT session_id FROM voice_sessions ORDER BY started_at DESC LIMIT ?1",
    ) {
        Ok(s) => s,
        Err(_) => return Vec::new(),
    };

    let ids: Vec<String> = match stmt.query_map(params![limit as i64], |row| row.get(0)) {
        Ok(rows) => rows.filter_map(|r| r.ok()).collect(),
        Err(_) => Vec::new(),
    };

    ids.iter().filter_map(|id| load_session(id)).collect()
}

/// Build a compact string with the last 3 segments for injection into a system prompt.
pub fn get_voice_context_for_prompt(session_id: &str) -> String {
    let conn = match rusqlite::Connection::open(db_path()) {
        Ok(c) => c,
        Err(_) => return String::new(),
    };

    let segs = load_segments_for_session(session_id, &conn);
    if segs.is_empty() {
        return String::new();
    }

    let recent: Vec<&VoiceSegment> = segs.iter().rev().take(3).collect();
    let mut out = String::from("Recent voice context:\n");
    for seg in recent.iter().rev() {
        out.push_str(&format!(
            "- [{}] ({}): {}\n",
            seg.detected_emotion,
            seg.timestamp,
            crate::safe_slice(&seg.transcript, 200),
        ));
    }
    out
}

// ---------------------------------------------------------------------------
// Internal DB helpers
// ---------------------------------------------------------------------------

fn load_segments_for_session(
    session_id: &str,
    conn: &rusqlite::Connection,
) -> Vec<VoiceSegment> {
    let mut stmt = match conn.prepare(
        "SELECT transcript, timestamp, detected_emotion, speaking_rate, confidence
         FROM voice_segments WHERE session_id = ?1 ORDER BY timestamp ASC",
    ) {
        Ok(s) => s,
        Err(_) => return Vec::new(),
    };

    let result = match stmt.query_map(params![session_id], |row| {
        Ok(VoiceSegment {
            transcript: row.get(0)?,
            timestamp: row.get(1)?,
            detected_emotion: row.get(2)?,
            speaking_rate: row.get(3)?,
            confidence: row.get(4)?,
        })
    }) {
        Ok(rows) => rows.filter_map(|r| r.ok()).collect(),
        Err(_) => Vec::new(),
    };
    result
}

fn load_session(session_id: &str) -> Option<VoiceSession> {
    let conn = rusqlite::Connection::open(db_path()).ok()?;

    let (started_at, dominant_emotion, topic_thread_json): (i64, String, String) = conn
        .query_row(
            "SELECT started_at, dominant_emotion, topic_thread_json
             FROM voice_sessions WHERE session_id = ?1",
            params![session_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .ok()?;

    let topic_thread: Vec<String> =
        serde_json::from_str(&topic_thread_json).unwrap_or_default();

    let segments = load_segments_for_session(session_id, &conn);

    Some(VoiceSession {
        session_id: session_id.to_string(),
        started_at,
        segments,
        dominant_emotion,
        topic_thread,
    })
}

/// Normalise any incoming emotion label to one of the six canonical values.
fn normalize_emotion(e: &str) -> &'static str {
    match e.to_lowercase().trim() {
        "excited" | "happy" | "enthusiastic" => "excited",
        "frustrated" | "angry" | "annoyed"   => "frustrated",
        "tired" | "sleepy" | "exhausted"     => "tired",
        "focused" | "concentrated"            => "focused",
        "casual" | "relaxed" | "chill"        => "casual",
        _                                     => "neutral",
    }
}

// ---------------------------------------------------------------------------
// LLM: emotion analysis
// ---------------------------------------------------------------------------

/// Classify the emotional tone of `transcript` using lightweight LLM inference.
/// `context` can be previous segment transcripts to improve accuracy.
///
/// Returns one of: "neutral" | "excited" | "frustrated" | "tired" | "focused" | "casual"
pub async fn analyze_voice_emotion(transcript: &str, context: &str) -> String {
    let cfg = crate::config::load_config();
    let provider = cfg.provider.clone();
    let api_key = cfg.api_key.clone();
    let base_url = cfg.base_url.clone();
    let model = fast_model(&provider).to_string();

    let system = "You are an emotion classifier for voice transcripts. \
                  Classify the speaker's emotional tone as exactly one word from: \
                  neutral, excited, frustrated, tired, focused, casual. \
                  Reply with only that single word — no punctuation, no explanation.";

    let ctx_block = if context.is_empty() {
        String::new()
    } else {
        format!(
            "\n\nConversation context (previous turns):\n{}",
            crate::safe_slice(context, 600)
        )
    };

    let user_msg = format!(
        "Transcript: \"{}\"{ctx_block}",
        crate::safe_slice(transcript, 500)
    );

    match llm_call(&provider, &api_key, &model, base_url.as_deref(), system, &user_msg).await {
        Ok(raw) => {
            let label = raw.trim().to_lowercase();
            let label = label.trim_end_matches('.');
            normalize_emotion(label).to_string()
        }
        Err(e) => {
            eprintln!("[voice_intelligence] emotion LLM error: {e}");
            "neutral".to_string()
        }
    }
}

// ---------------------------------------------------------------------------
// LLM: topic change detection
// ---------------------------------------------------------------------------

/// Returns `true` when the LLM judges that the new transcript represents a
/// genuine topic shift compared to the previous one.
#[allow(dead_code)]
pub async fn detect_topic_change(prev_transcript: &str, new_transcript: &str) -> bool {
    let cfg = crate::config::load_config();
    let provider = cfg.provider.clone();
    let api_key = cfg.api_key.clone();
    let base_url = cfg.base_url.clone();
    let model = fast_model(&provider).to_string();

    let system = "You detect whether two consecutive voice utterances represent a topic change. \
                  Answer only 'yes' or 'no'.";

    let user_msg = format!(
        "Previous: \"{}\"\nNew: \"{}\"\n\nIs this a topic change?",
        crate::safe_slice(prev_transcript, 300),
        crate::safe_slice(new_transcript, 300),
    );

    match llm_call(&provider, &api_key, &model, base_url.as_deref(), system, &user_msg).await {
        Ok(raw) => raw.trim().to_lowercase().starts_with('y'),
        Err(e) => {
            eprintln!("[voice_intelligence] topic-change LLM error: {e}");
            false
        }
    }
}

// ---------------------------------------------------------------------------
// LLM: voice-adapted response generation
// ---------------------------------------------------------------------------

/// Given a `base_response` already generated by the main chat pipeline, adapt
/// its wording, pace, and style for voice delivery based on detected emotion
/// and the ongoing session context.
#[allow(dead_code)]
pub async fn generate_voice_adapted_response(
    user_message: &str,
    emotion: &str,
    session: &VoiceSession,
    base_response: &str,
) -> VoiceResponse {
    let cfg = crate::config::load_config();
    // Use the quality provider for response adaptation — it needs nuance.
    let (provider, api_key, model) = {
        use crate::router::TaskType;
        crate::config::resolve_provider_for_task(&cfg, &TaskType::Complex)
    };
    let base_url = cfg.base_url.clone();

    // Build a short session summary for the LLM.
    let dominant = &session.dominant_emotion;
    let turn_count = session.segments.len();
    let topics = session.topic_thread.join(", ");
    let topics_str = if topics.is_empty() {
        String::from("(none tracked yet)")
    } else {
        topics
    };

    let system = "You are a voice UX specialist. Your job is to rewrite AI responses \
                  so they sound natural when spoken aloud, adjusting tone, pacing, and \
                  word choice to match the user's current emotional state. \
                  Never add new factual content — only adapt delivery.";

    let user_msg = format!(
        r#"User asked (voice input): "{user_msg}"
Current emotion: {emotion}
Session: {turn_count} turns, dominant emotion = {dominant}, topics = {topics_str}

Original response:
{base}

Rewrite this response for voice delivery, adapted to the user's emotional state.
Return ONLY valid JSON — no markdown fences:
{{"text":"<adapted response>","tone":"<warm|energetic|calm|focused|encouraging>","pace":"<slow|normal|fast>","style_notes":"<tts guidance>"}}"#,
        user_msg = crate::safe_slice(user_message, 400),
        base = crate::safe_slice(base_response, 1200),
    );

    let raw = match llm_call(&provider, &api_key, &model, base_url.as_deref(), system, &user_msg).await {
        Ok(r) => r,
        Err(e) => {
            eprintln!("[voice_intelligence] adapt LLM error: {e}");
            return fallback_voice_response(base_response, emotion);
        }
    };

    let json_str = strip_fences(&raw);
    match serde_json::from_str::<serde_json::Value>(json_str) {
        Ok(v) => VoiceResponse {
            text: v["text"].as_str().unwrap_or(base_response).to_string(),
            tone: v["tone"].as_str().unwrap_or("calm").to_string(),
            pace: v["pace"].as_str().unwrap_or("normal").to_string(),
            style_notes: v["style_notes"].as_str().unwrap_or("").to_string(),
        },
        Err(_) => fallback_voice_response(base_response, emotion),
    }
}

/// Returns a sensible default VoiceResponse when the LLM call fails.
#[allow(dead_code)]
fn fallback_voice_response(base_response: &str, emotion: &str) -> VoiceResponse {
    let (tone, pace, style_notes) = match emotion {
        "frustrated" => (
            "calm",
            "slow",
            "Speak slowly and clearly. Pause between sentences.",
        ),
        "excited" => (
            "energetic",
            "normal",
            "Match the energy. Keep it snappy.",
        ),
        "tired" => (
            "warm",
            "slow",
            "Speak softly and slowly. Short sentences.",
        ),
        "focused" => (
            "focused",
            "fast",
            "Be direct. No filler words.",
        ),
        "casual" => (
            "warm",
            "normal",
            "Conversational tone. Relax.",
        ),
        _ => ("calm", "normal", "Natural pacing."),
    };

    VoiceResponse {
        text: base_response.to_string(),
        tone: tone.to_string(),
        pace: pace.to_string(),
        style_notes: style_notes.to_string(),
    }
}

// ---------------------------------------------------------------------------
// Language detection
// ---------------------------------------------------------------------------

/// Detect the language of `transcript` using a fast LLM call.
///
/// Returns an ISO 639-1 code ("en", "es", "fr", "de", "hi", etc.)
/// or "en" on failure.
pub async fn detect_language(transcript: &str) -> String {
    let cfg = crate::config::load_config();
    let provider = cfg.provider.clone();
    let api_key = cfg.api_key.clone();
    let base_url = cfg.base_url.clone();
    let model = fast_model(&provider).to_string();

    let system = "You are a language detection tool. Given a short voice transcript, \
                  return ONLY the ISO 639-1 two-letter language code (e.g. 'en', 'es', 'fr', \
                  'de', 'hi', 'zh', 'ja', 'ar'). No explanation, no punctuation.";

    let user_msg = format!("Transcript: \"{}\"", crate::safe_slice(transcript, 300));

    match llm_call(&provider, &api_key, &model, base_url.as_deref(), system, &user_msg).await {
        Ok(raw) => {
            let code = raw.trim().to_lowercase();
            // Accept only 2-letter codes
            if code.len() == 2 && code.chars().all(|c| c.is_ascii_alphabetic()) {
                code
            } else {
                "en".to_string()
            }
        }
        Err(e) => {
            eprintln!("[voice_intelligence] language detection error: {e}");
            "en".to_string()
        }
    }
}

/// Detect language and, if non-English, emit an event so the conversation loop
/// can prepend a language instruction to the system prompt.
///
/// Returns ("en", false) if English or detection fails; ("xx", true) otherwise.
pub async fn detect_non_english(transcript: &str) -> (String, bool) {
    // Quick heuristic: if the transcript is all ASCII letters/punctuation, it's
    // almost certainly English — skip the LLM call to save latency.
    let all_ascii = transcript.chars().all(|c| c.is_ascii());
    if all_ascii {
        // Still call the LLM if the words look like non-English ASCII languages
        // (Spanish accents stripped by Whisper, etc.) — but only for short clips
        let word_count = transcript.split_whitespace().count();
        if word_count < 3 {
            return ("en".to_string(), false);
        }
    }

    let lang = detect_language(transcript).await;
    let is_non_english = lang != "en";
    (lang, is_non_english)
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn voice_intel_start_session() -> String {
    start_voice_session()
}

#[tauri::command]
pub fn voice_intel_end_session(session_id: String) -> Option<VoiceSession> {
    end_voice_session(&session_id)
}

#[tauri::command]
pub fn voice_intel_add_segment(
    session_id: String,
    transcript: String,
    emotion: String,
    confidence: f32,
) {
    add_segment(&session_id, &transcript, &emotion, confidence);
}

#[tauri::command]
pub async fn voice_intel_analyze_emotion(
    transcript: String,
    context: String,
) -> String {
    analyze_voice_emotion(&transcript, &context).await
}

#[tauri::command]
pub fn voice_intel_get_context(session_id: String) -> String {
    get_voice_context_for_prompt(&session_id)
}

#[tauri::command]
pub fn voice_intel_get_session(session_id: String) -> Option<VoiceSession> {
    load_session(&session_id)
}

#[tauri::command]
pub async fn voice_intel_detect_language(transcript: String) -> String {
    detect_language(&transcript).await
}
