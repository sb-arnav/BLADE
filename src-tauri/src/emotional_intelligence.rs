/// BLADE Emotional Intelligence — Adaptive Empathy Engine
///
/// BLADE reads emotional signals in the user's messages and adapts its
/// responses accordingly. It tracks emotional history, identifies patterns,
/// provides support when needed, and never piles on when the user is struggling.
///
/// All DB work is done synchronously before any `.await` points so no
/// rusqlite::Connection is held across an await boundary.

use rusqlite::params;
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::Emitter;

// ── Static current emotion ────────────────────────────────────────────────────

static CURRENT_EMOTION: Mutex<Option<EmotionalState>> = Mutex::new(None);

// ── Structs ───────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmotionalState {
    /// One of: "stressed", "excited", "focused", "tired", "frustrated",
    ///         "happy", "anxious", "neutral"
    pub primary_emotion: String,
    /// -1.0 (very negative) to 1.0 (very positive)
    pub valence: f32,
    /// 0.0 (calm) to 1.0 (highly activated)
    pub arousal: f32,
    /// 0.0 to 1.0 — how confident we are in this reading
    pub confidence: f32,
    /// Textual signals that led to this reading
    pub signals: Vec<String>,
    pub detected_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmotionalTrend {
    pub period: String,               // "today", "this_week"
    pub avg_valence: f32,
    pub dominant_emotion: String,
    pub notable_shifts: Vec<String>,  // e.g. "dropped sharply Tuesday afternoon"
    pub recommendation: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SupportResponse {
    /// One of: "encouraging", "practical", "empathetic", "direct", "celebratory"
    pub tone: String,
    /// Optional emotional acknowledgment to prepend to a response
    pub prefix: String,
    /// One of: "slow_down", "normal", "match_energy"
    pub pacing: String,
    /// Things NOT to say (e.g. don't minimize feelings)
    pub avoid: Vec<String>,
}

// ── DB helpers ────────────────────────────────────────────────────────────────

fn db_path() -> std::path::PathBuf {
    crate::config::blade_config_dir().join("blade.db")
}

fn open_db() -> Result<rusqlite::Connection, String> {
    rusqlite::Connection::open(db_path()).map_err(|e| format!("DB open failed: {e}"))
}

fn strip_json_fences(s: &str) -> &str {
    let s = s.trim();
    if let Some(inner) = s.strip_prefix("```json") {
        if let Some(stripped) = inner.strip_suffix("```") {
            return stripped.trim();
        }
    }
    if let Some(inner) = s.strip_prefix("```") {
        if let Some(stripped) = inner.strip_suffix("```") {
            return stripped.trim();
        }
    }
    s
}

// ── Schema ────────────────────────────────────────────────────────────────────

pub fn ensure_tables() {
    if let Ok(conn) = open_db() {
        let _ = conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS emotional_readings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                primary_emotion TEXT NOT NULL,
                valence REAL NOT NULL,
                arousal REAL NOT NULL,
                confidence REAL NOT NULL,
                signals TEXT NOT NULL,
                detected_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_emotional_readings_ts
                ON emotional_readings (detected_at DESC);",
        );
    }
}

// ── Heuristic pre-check ───────────────────────────────────────────────────────

/// Returns true when the message contains strong emotional signals that
/// justify an LLM call. Short, neutral messages are classified locally.
fn has_strong_signals(message: &str) -> bool {
    let msg = message.to_lowercase();
    let word_count = message.split_whitespace().count();

    // Very short messages — almost certainly neutral
    if word_count < 3 {
        return false;
    }

    // Stress / frustration markers
    let stress_words = [
        "stressed", "stress", "overwhelmed", "panic", "anxious", "anxiety",
        "worried", "worry", "scared", "frustrated", "frustrating", "annoyed",
        "tired", "exhausted", "burnt out", "burnout", "can't", "impossible",
        "stuck", "blocked", "deadline", "urgent", "HELP", "broken",
    ];

    // Excitement / positivity markers
    let positive_words = [
        "excited", "amazing", "awesome", "great", "love", "perfect",
        "finally", "working", "nailed", "fixed", "done", "shipped",
        "launched", "celebrating", "happy", "ecstatic",
    ];

    // Typographic stress signals
    let has_caps = message.chars().filter(|c| c.is_uppercase()).count() > 4;
    let has_multiple_exclamations = message.matches('!').count() >= 2;
    let has_ellipsis = msg.contains("...");
    let has_question_urgency = message.matches('?').count() >= 2;

    if has_caps || has_multiple_exclamations || has_ellipsis || has_question_urgency {
        return true;
    }

    for word in stress_words.iter().chain(positive_words.iter()) {
        if msg.contains(word) {
            return true;
        }
    }

    false
}

/// Fast heuristic classification — used when `has_strong_signals` is false
/// (avoids burning an LLM call on "thanks" or "ok").
fn heuristic_neutral(now_ts: i64) -> EmotionalState {
    EmotionalState {
        primary_emotion: "neutral".to_string(),
        valence: 0.0,
        arousal: 0.3,
        confidence: 0.5,
        signals: vec!["no strong emotional signals detected".to_string()],
        detected_at: now_ts,
    }
}

// ── Detection ─────────────────────────────────────────────────────────────────

/// Detect emotional state from a message + optional conversation context.
/// Uses a cheap LLM call if strong signals are present; otherwise returns
/// a heuristic neutral state to save tokens.
pub async fn detect_emotion(message: &str, conversation_context: &str) -> EmotionalState {
    let now_ts = chrono::Local::now().timestamp();

    // Fast path — no strong signals
    if !has_strong_signals(message) {
        return heuristic_neutral(now_ts);
    }

    let context_section = if conversation_context.is_empty() {
        String::new()
    } else {
        format!(
            "\n\nRecent conversation context:\n{}",
            crate::safe_slice(conversation_context, 800)
        )
    };

    let prompt = format!(
        "Analyze the emotional state of the USER in the message below. \
         Focus on what they are feeling, not what they are asking about.{context_section}\n\n\
         User message: \"{msg}\"\n\n\
         Return ONLY a JSON object (no markdown, no extra text):\n\
         {{\n  \
           \"primary_emotion\": \"stressed|excited|focused|tired|frustrated|happy|anxious|neutral\",\n  \
           \"valence\": <float -1.0 to 1.0>,\n  \
           \"arousal\": <float 0.0 to 1.0>,\n  \
           \"confidence\": <float 0.0 to 1.0>,\n  \
           \"signals\": [\"signal 1\", \"signal 2\"]\n\
         }}\n\n\
         Guidelines:\n\
         - valence: -1.0=very negative, 0=neutral, 1.0=very positive\n\
         - arousal: 0.0=calm/sleepy, 1.0=highly activated/agitated\n\
         - signals: 2-4 brief phrases describing what in the text led to your reading\n\
         - confidence: how certain you are (0.3=guessing, 0.7=clear signals, 0.95=unmistakable)",
        context_section = context_section,
        msg = crate::safe_slice(message, 600),
    );

    let config = crate::config::load_config();

    // Use fast/cheap model for emotion detection
    let (provider, api_key, model) =
        crate::config::resolve_provider_for_task(&config, &crate::router::TaskType::Simple);

    let messages = vec![crate::providers::ConversationMessage::User(prompt)];
    let turn = match crate::providers::complete_turn(
        &provider, &api_key, &model, &messages, &[], None,
    )
    .await
    {
        Ok(t) => t,
        Err(e) => {
            eprintln!("[emotional_intelligence] LLM detect_emotion error: {e}");
            return heuristic_neutral(now_ts);
        }
    };

    let raw = strip_json_fences(&turn.content);

    #[derive(Deserialize)]
    struct RawEmotion {
        primary_emotion: String,
        valence: f32,
        arousal: f32,
        confidence: f32,
        signals: Vec<String>,
    }

    match serde_json::from_str::<RawEmotion>(raw) {
        Ok(r) => EmotionalState {
            primary_emotion: r.primary_emotion,
            valence: r.valence.clamp(-1.0, 1.0),
            arousal: r.arousal.clamp(0.0, 1.0),
            confidence: r.confidence.clamp(0.0, 1.0),
            signals: r.signals,
            detected_at: now_ts,
        },
        Err(e) => {
            eprintln!(
                "[emotional_intelligence] parse error: {e}\nRaw: {}",
                crate::safe_slice(raw, 200)
            );
            heuristic_neutral(now_ts)
        }
    }
}

// ── Persistence ───────────────────────────────────────────────────────────────

/// Persist an EmotionalState reading to SQLite.
pub fn save_reading(state: &EmotionalState) {
    let signals_json = serde_json::to_string(&state.signals).unwrap_or_else(|_| "[]".to_string());
    if let Ok(conn) = open_db() {
        let _ = conn.execute(
            "INSERT INTO emotional_readings
                (primary_emotion, valence, arousal, confidence, signals, detected_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                state.primary_emotion,
                state.valence,
                state.arousal,
                state.confidence,
                signals_json,
                state.detected_at,
            ],
        );
    }
}

/// Return the most recent N emotional readings (newest first).
pub fn get_recent_readings(limit: usize) -> Vec<EmotionalState> {
    let conn = match open_db() {
        Ok(c) => c,
        Err(_) => return vec![],
    };

    let mut stmt = match conn.prepare(
        "SELECT primary_emotion, valence, arousal, confidence, signals, detected_at
         FROM emotional_readings
         ORDER BY detected_at DESC
         LIMIT ?1",
    ) {
        Ok(s) => s,
        Err(_) => return vec![],
    };

    stmt.query_map(params![limit as i64], |row| {
        let signals_json: String = row.get(4)?;
        let signals: Vec<String> =
            serde_json::from_str(&signals_json).unwrap_or_default();
        Ok(EmotionalState {
            primary_emotion: row.get(0)?,
            valence: row.get(1)?,
            arousal: row.get(2)?,
            confidence: row.get(3)?,
            signals,
            detected_at: row.get(5)?,
        })
    })
    .map(|rows| rows.flatten().collect())
    .unwrap_or_default()
}

// ── Trend analysis ────────────────────────────────────────────────────────────

/// Compute an EmotionalTrend from the readings stored in the last 7 days.
pub fn get_trend() -> EmotionalTrend {
    let conn = match open_db() {
        Ok(c) => c,
        Err(_) => {
            return EmotionalTrend {
                period: "this_week".to_string(),
                avg_valence: 0.0,
                dominant_emotion: "neutral".to_string(),
                notable_shifts: vec![],
                recommendation: "Not enough data yet.".to_string(),
            };
        }
    };

    let week_ago = chrono::Local::now().timestamp() - 7 * 86400;
    let today_start = {
        let now = chrono::Local::now();
        now.date_naive()
            .and_hms_opt(0, 0, 0)
            .and_then(|naive_dt| naive_dt.and_local_timezone(chrono::Local).earliest())
            .map(|dt| dt.timestamp())
            .unwrap_or(now.timestamp() - 86400)
    };

    // Fetch readings for trend computation
    let mut stmt = match conn.prepare(
        "SELECT primary_emotion, valence, arousal, confidence, detected_at
         FROM emotional_readings
         WHERE detected_at >= ?1
         ORDER BY detected_at ASC",
    ) {
        Ok(s) => s,
        Err(_) => {
            return EmotionalTrend {
                period: "this_week".to_string(),
                avg_valence: 0.0,
                dominant_emotion: "neutral".to_string(),
                notable_shifts: vec![],
                recommendation: "Not enough data yet.".to_string(),
            };
        }
    };

    #[derive(Debug)]
    struct Row {
        emotion: String,
        valence: f32,
        _arousal: f32,
        _confidence: f32,
        ts: i64,
    }

    let rows: Vec<Row> = stmt
        .query_map(params![week_ago], |r| {
            Ok(Row {
                emotion: r.get(0)?,
                valence: r.get(1)?,
                _arousal: r.get(2)?,
                _confidence: r.get(3)?,
                ts: r.get(4)?,
            })
        })
        .map(|r| r.flatten().collect())
        .unwrap_or_default();

    if rows.is_empty() {
        return EmotionalTrend {
            period: "this_week".to_string(),
            avg_valence: 0.0,
            dominant_emotion: "neutral".to_string(),
            notable_shifts: vec![],
            recommendation: "No emotional history yet. Keep chatting and BLADE will learn your patterns.".to_string(),
        };
    }

    // Average valence
    let avg_valence = rows.iter().map(|r| r.valence).sum::<f32>() / rows.len() as f32;

    // Dominant emotion (mode)
    let mut counts: std::collections::HashMap<&str, usize> = std::collections::HashMap::new();
    for row in &rows {
        *counts.entry(row.emotion.as_str()).or_insert(0) += 1;
    }
    let dominant_emotion = counts
        .iter()
        .max_by_key(|(_, &c)| c)
        .map(|(&e, _)| e.to_string())
        .unwrap_or_else(|| "neutral".to_string());

    // Detect notable shifts — look for valence dropping >0.5 within a short window
    let mut notable_shifts: Vec<String> = vec![];
    const SHIFT_THRESHOLD: f32 = 0.5;
    for window in rows.windows(3) {
        let first = &window[0];
        let last = &window[2];
        let delta = last.valence - first.valence;
        if delta.abs() >= SHIFT_THRESHOLD {
            let ts = chrono::DateTime::from_timestamp(last.ts, 0)
                .map(|dt| dt.with_timezone(&chrono::Local).format("%A %I%p").to_string())
                .unwrap_or_else(|| "recently".to_string());
            if delta < 0.0 {
                notable_shifts.push(format!("mood dropped sharply around {}", ts));
            } else {
                notable_shifts.push(format!("mood lifted around {}", ts));
            }
        }
    }
    notable_shifts.dedup();
    notable_shifts.truncate(4);

    // Today's average for context
    let today_rows: Vec<&Row> = rows.iter().filter(|r| r.ts >= today_start).collect();
    let today_avg = if today_rows.is_empty() {
        avg_valence
    } else {
        today_rows.iter().map(|r| r.valence).sum::<f32>() / today_rows.len() as f32
    };

    let recommendation = make_trend_recommendation(avg_valence, today_avg, &dominant_emotion);

    EmotionalTrend {
        period: "this_week".to_string(),
        avg_valence,
        dominant_emotion,
        notable_shifts,
        recommendation,
    }
}

fn make_trend_recommendation(avg_valence: f32, today_avg: f32, dominant: &str) -> String {
    if avg_valence < -0.4 {
        "This has been a tough week emotionally. Consider what's been weighing on you and whether there's one thing you can change.".to_string()
    } else if today_avg < -0.5 {
        format!("Today looks harder than usual — {}. Take care of yourself first.", dominant)
    } else if avg_valence > 0.4 {
        "You've been in a pretty positive headspace this week. Keep the momentum going.".to_string()
    } else {
        "Mood has been mixed this week — normal human variation. BLADE will keep adapting to you.".to_string()
    }
}

// ── Response adaptation ───────────────────────────────────────────────────────

/// Map an emotional state to a response strategy. Uses deterministic mapping
/// for common states — no LLM call needed.
pub async fn get_support_response(emotion: &EmotionalState) -> SupportResponse {
    match emotion.primary_emotion.as_str() {
        "stressed" => SupportResponse {
            tone: "empathetic".to_string(),
            prefix: "I can see you're carrying a lot right now.".to_string(),
            pacing: "slow_down".to_string(),
            avoid: vec![
                "adding more tasks".to_string(),
                "lengthy explanations".to_string(),
                "minimizing the load".to_string(),
            ],
        },
        "frustrated" => SupportResponse {
            tone: "practical".to_string(),
            prefix: "That's genuinely frustrating — let's cut through it.".to_string(),
            pacing: "normal".to_string(),
            avoid: vec![
                "over-explaining".to_string(),
                "suggesting it might be the user's fault".to_string(),
                "lengthy preamble".to_string(),
            ],
        },
        "anxious" => SupportResponse {
            tone: "empathetic".to_string(),
            prefix: "Let's slow this down and take it one step at a time.".to_string(),
            pacing: "slow_down".to_string(),
            avoid: vec![
                "big picture overloads".to_string(),
                "open-ended uncertainty".to_string(),
                "multiple simultaneous asks".to_string(),
            ],
        },
        "tired" => SupportResponse {
            tone: "practical".to_string(),
            prefix: String::new(),
            pacing: "slow_down".to_string(),
            avoid: vec![
                "complex multi-step asks".to_string(),
                "dense walls of text".to_string(),
                "things requiring high cognitive load".to_string(),
            ],
        },
        "excited" => SupportResponse {
            tone: "celebratory".to_string(),
            prefix: String::new(),
            pacing: "match_energy".to_string(),
            avoid: vec![
                "deflating enthusiasm".to_string(),
                "unsolicited caveats".to_string(),
            ],
        },
        "happy" => SupportResponse {
            tone: "direct".to_string(),
            prefix: String::new(),
            pacing: "normal".to_string(),
            avoid: vec![],
        },
        "focused" => SupportResponse {
            tone: "direct".to_string(),
            prefix: String::new(),
            pacing: "normal".to_string(),
            avoid: vec![
                "unnecessary small talk".to_string(),
                "unsolicited tangents".to_string(),
            ],
        },
        _ => SupportResponse {
            // "neutral" and anything else
            tone: "direct".to_string(),
            prefix: String::new(),
            pacing: "normal".to_string(),
            avoid: vec![],
        },
    }
}

// ── System prompt context ─────────────────────────────────────────────────────

/// Returns a short, dense string for injection into the system prompt.
/// Example:
///   "User emotional state: stressed (confidence: 0.8). Signals: short messages, caps.
///    Adaptation: be empathetic, avoid adding tasks, offer to simplify."
pub fn get_emotional_context() -> String {
    let state = {
        let guard = CURRENT_EMOTION.lock().unwrap();
        match guard.as_ref() {
            Some(s) => s.clone(),
            None => {
                // Fall back to most recent DB reading
                let recent = get_recent_readings(1);
                match recent.into_iter().next() {
                    Some(s) => s,
                    None => return String::new(),
                }
            }
        }
    };

    // Only inject if confidence is meaningful
    if state.confidence < 0.4 || state.primary_emotion == "neutral" {
        return String::new();
    }

    // Build adaptation line from emotion type
    let adaptation = match state.primary_emotion.as_str() {
        "stressed" => "be empathetic, avoid adding tasks, offer to simplify.",
        "frustrated" => "validate first, avoid over-explaining, give one concrete next step.",
        "anxious" => "use a calm tone, break into small steps, be reassuring.",
        "tired" => "keep responses brief, skip complex asks, suggest a break if appropriate.",
        "excited" => "match the energy, celebrate, build on the momentum.",
        "happy" => "normal tone, get out of the way.",
        "focused" => "direct and efficient — no fluff.",
        _ => "normal tone.",
    };

    let signals_str = state.signals.join(", ");

    format!(
        "## User Emotional State\n\n\
         Current state: {} (confidence: {:.1}). Signals: {}.\n\
         Adaptation: {}",
        state.primary_emotion,
        state.confidence,
        signals_str,
        adaptation,
    )
}

// ── Pattern analysis (LLM) ────────────────────────────────────────────────────

/// Ask the LLM to find long-term emotional patterns over `days_back` days.
/// Returns a human-readable summary string.
pub async fn analyze_emotional_patterns(days_back: i32) -> String {
    // Collect data before await
    let readings = {
        let conn = match open_db() {
            Ok(c) => c,
            Err(_) => return "Could not open database.".to_string(),
        };
        let cutoff = chrono::Local::now().timestamp() - (days_back as i64) * 86400;
        let mut stmt = match conn.prepare(
            "SELECT primary_emotion, valence, arousal, confidence, detected_at
             FROM emotional_readings
             WHERE detected_at >= ?1
             ORDER BY detected_at ASC",
        ) {
            Ok(s) => s,
            Err(_) => return "Could not query database.".to_string(),
        };

        #[derive(Serialize)]
        struct ReadingRow {
            emotion: String,
            valence: f32,
            arousal: f32,
            confidence: f32,
            day: String,
            hour: u32,
        }

        let rows: Vec<ReadingRow> = match stmt.query_map(params![cutoff], |r| {
                let ts: i64 = r.get(4)?;
                Ok((r.get::<_, String>(0)?, r.get::<_, f32>(1)?, r.get::<_, f32>(2)?, r.get::<_, f32>(3)?, ts))
            }) {
            Ok(mapped) => {
                use chrono::Timelike;
                mapped
                    .flatten()
                    .map(|(emotion, valence, arousal, confidence, ts)| {
                        let dt = chrono::DateTime::from_timestamp(ts, 0)
                            .map(|d| d.with_timezone(&chrono::Local))
                            .unwrap_or_else(chrono::Local::now);
                        ReadingRow {
                            emotion,
                            valence,
                            arousal,
                            confidence,
                            day: dt.format("%A").to_string(),
                            hour: dt.hour(),
                        }
                    })
                    .collect()
            }
            Err(_) => vec![],
        };
        rows
    };

    if readings.is_empty() {
        return "Not enough emotional history to find patterns yet. Keep chatting with BLADE.".to_string();
    }

    let readings_json = serde_json::to_string_pretty(&readings).unwrap_or_default();

    let prompt = format!(
        "You are an empathetic analyst reviewing a user's emotional pattern data over the last {} days.\n\n\
         Data (each row: emotion, valence -1 to 1, arousal 0 to 1, day of week, hour of day):\n{}\n\n\
         Find meaningful patterns. Examples: 'stressed on Sunday evenings before Mondays', \
         'energy dips around 3pm', 'mood improves mid-week'. Be specific, warm, and concrete.\n\n\
         Write 2-4 sentences. No bullet points. No JSON. Plain prose.",
        days_back, crate::safe_slice(&readings_json, 3000)
    );

    let config = crate::config::load_config();
    let (provider, api_key, model) =
        crate::config::resolve_provider_for_task(&config, &crate::router::TaskType::Complex);

    let messages = vec![crate::providers::ConversationMessage::User(prompt)];
    match crate::providers::complete_turn(&provider, &api_key, &model, &messages, &[], None).await {
        Ok(t) => t.content,
        Err(e) => {
            eprintln!("[emotional_intelligence] pattern analysis LLM error: {e}");
            "Pattern analysis temporarily unavailable.".to_string()
        }
    }
}

// ── Intervention suggestion ────────────────────────────────────────────────────

/// If the user is in a severe negative state (valence < -0.6 AND confidence > 0.7),
/// suggest a grounding action. Returns None otherwise.
pub async fn suggest_emotional_intervention(current_state: &EmotionalState) -> Option<String> {
    if current_state.valence >= -0.6 || current_state.confidence <= 0.7 {
        return None;
    }

    // Build a targeted suggestion based on the emotion type
    let suggestion = match current_state.primary_emotion.as_str() {
        "stressed" => {
            "You seem really stressed right now. Consider stepping away for 5 minutes — \
             a short walk or the 4-7-8 breathing technique (inhale 4s, hold 7s, exhale 8s) \
             can noticeably lower cortisol. I'll be here when you're back."
        }
        "anxious" => {
            "I'm noticing some anxiety in your messages. Try grounding yourself with the 5-4-3-2-1 method: \
             name 5 things you can see, 4 you can touch, 3 you can hear, 2 you can smell, 1 you can taste. \
             It takes 60 seconds and often works."
        }
        "frustrated" => {
            "You're hitting a wall. Sometimes the best move is to write out exactly what's wrong \
             (not to fix it — just to name it) and then take a 10-minute break. \
             Frustration narrows thinking; distance opens it back up."
        }
        "tired" => {
            "You sound genuinely depleted. If you can, close your laptop for 20 minutes — \
             even a short nap or rest with eyes closed improves cognitive performance more than pushing through. \
             The work will still be here."
        }
        _ => {
            "You seem to be having a hard time. A short break — even just standing up and drinking water — \
             can help reset. Take care of yourself first."
        }
    };

    Some(suggestion.to_string())
}

// ── Integration ───────────────────────────────────────────────────────────────

/// Detect emotion from a user message, save to DB, update CURRENT_EMOTION,
/// and emit `blade_emotion_detected` if there's a significant shift.
/// Designed to be called from a background `tokio::spawn` in commands.rs.
pub async fn process_message_emotion(message: &str, app: tauri::AppHandle) -> EmotionalState {
    // Ensure schema exists
    ensure_tables();

    // Get previous state before we do anything async
    let previous_valence = {
        let guard = CURRENT_EMOTION.lock().unwrap();
        guard.as_ref().map(|s| s.valence)
    };

    let new_state = detect_emotion(message, "").await;

    // Update static current state
    {
        let mut guard = CURRENT_EMOTION.lock().unwrap();
        *guard = Some(new_state.clone());
    }

    // Only persist meaningful readings (skip low-confidence neutral noise)
    if new_state.confidence >= 0.4 {
        save_reading(&new_state);
    }

    // Emit event on significant emotional shift (>0.4 valence change)
    let should_emit = match previous_valence {
        None => new_state.primary_emotion != "neutral" && new_state.confidence >= 0.5,
        Some(prev) => (new_state.valence - prev).abs() >= 0.4 && new_state.confidence >= 0.5,
    };

    if should_emit {
        let _ = app.emit(
            "blade_emotion_detected",
            serde_json::json!({
                "emotion": new_state.primary_emotion,
                "valence": new_state.valence,
                "arousal": new_state.arousal,
                "confidence": new_state.confidence,
                "signals": new_state.signals,
            }),
        );
    }

    new_state
}

// ── Tauri commands ────────────────────────────────────────────────────────────

#[tauri::command]
pub fn emotion_get_current() -> Option<EmotionalState> {
    let guard = CURRENT_EMOTION.lock().unwrap();
    guard.clone()
}

#[tauri::command]
pub fn emotion_get_trend() -> EmotionalTrend {
    get_trend()
}

#[tauri::command]
pub fn emotion_get_readings(limit: Option<usize>) -> Vec<EmotionalState> {
    get_recent_readings(limit.unwrap_or(50))
}

#[tauri::command]
pub async fn emotion_analyze_patterns(days_back: Option<i32>) -> String {
    analyze_emotional_patterns(days_back.unwrap_or(14)).await
}

#[tauri::command]
pub fn emotion_get_context() -> String {
    get_emotional_context()
}
