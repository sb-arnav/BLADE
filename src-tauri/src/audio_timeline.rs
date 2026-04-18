/// BLADE Audio Timeline — always-on audio capture + smart extraction
///
/// Inspired by Omi: record everything, transcribe in real-time, extract action
/// items / decisions / topics from every 30-second chunk.
///
/// "What did we decide in that call an hour ago?" → exact transcript + summary.
/// "Find all tasks I said I'd do today" → action items across all chunks.
///
/// Runs alongside the screenshot capture loop, sharing the same DB file.
/// Audio chunks are NOT saved to disk (just transcripts) to save space.

use rusqlite::params;
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{Emitter, Manager};

// ---------------------------------------------------------------------------
// AtomicBool guard — prevents duplicate loops
// ---------------------------------------------------------------------------

static AUDIO_CAPTURE_ACTIVE: AtomicBool = AtomicBool::new(false);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AudioTimelineEntry {
    pub id: i64,
    pub timestamp: i64,
    pub duration_secs: i64,
    pub transcript: String,
    pub source: String, // "mic" | "system" | "both"
    pub action_items: Vec<String>,
    pub decisions: Vec<String>,
    pub mentions: Vec<String>,
    pub topics: Vec<String>,
    pub sentiment: String,
    pub meeting_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TranscriptInsights {
    pub action_items: Vec<String>,
    pub decisions: Vec<String>,
    pub mentions: Vec<String>,
    pub topics: Vec<String>,
    pub sentiment: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MeetingSummary {
    pub meeting_id: String,
    pub title: String,
    pub start_timestamp: i64,
    pub end_timestamp: i64,
    pub participants: Vec<String>,
    pub summary: String,
    pub action_items: Vec<String>,
    pub decisions: Vec<String>,
    pub sentiment: String,
    pub duration_minutes: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnifiedSearchResult {
    pub result_type: SearchResultType,
    pub content: String,
    pub timestamp: i64,
    pub relevance: f64,
    pub source_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SearchResultType {
    Screenshot,
    AudioTranscript,
    Conversation,
    File,
    KnowledgeFact,
}

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

fn db_path() -> std::path::PathBuf {
    crate::config::blade_config_dir().join("blade.db")
}

fn open_db() -> Option<rusqlite::Connection> {
    rusqlite::Connection::open(db_path()).ok()
}

fn insert_audio_entry(
    conn: &rusqlite::Connection,
    timestamp: i64,
    duration_secs: i64,
    transcript: &str,
    source: &str,
    insights: &TranscriptInsights,
    meeting_id: &str,
) -> Option<i64> {
    let action_items = serde_json::to_string(&insights.action_items).unwrap_or_default();
    let decisions = serde_json::to_string(&insights.decisions).unwrap_or_default();
    let mentions = serde_json::to_string(&insights.mentions).unwrap_or_default();
    let topics = serde_json::to_string(&insights.topics).unwrap_or_default();

    conn.execute(
        "INSERT INTO audio_timeline (timestamp, duration_secs, transcript, source, action_items, decisions, mentions, topics, sentiment, meeting_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![
            timestamp,
            duration_secs,
            transcript,
            source,
            action_items,
            decisions,
            mentions,
            topics,
            insights.sentiment,
            meeting_id,
        ],
    )
    .ok()?;
    Some(conn.last_insert_rowid())
}

fn map_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<AudioTimelineEntry> {
    let action_items: Vec<String> = row
        .get::<_, String>(4)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();
    let decisions: Vec<String> = row
        .get::<_, String>(5)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();
    let mentions: Vec<String> = row
        .get::<_, String>(6)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();
    let topics: Vec<String> = row
        .get::<_, String>(7)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();

    Ok(AudioTimelineEntry {
        id: row.get(0)?,
        timestamp: row.get(1)?,
        duration_secs: row.get(2)?,
        transcript: row.get(3)?,
        action_items,
        decisions,
        mentions,
        topics,
        sentiment: row.get::<_, String>(8).unwrap_or_else(|_| "neutral".to_string()),
        source: row.get::<_, String>(9).unwrap_or_else(|_| "mic".to_string()),
        meeting_id: row.get::<_, String>(10).unwrap_or_default(),
    })
}

// ---------------------------------------------------------------------------
// LLM-powered smart extraction
// ---------------------------------------------------------------------------

/// Ask a cheap LLM to extract action items, decisions, mentions, topics, and
/// sentiment from a raw 30-second transcript chunk.
pub async fn extract_from_transcript(transcript: &str) -> TranscriptInsights {
    let empty = TranscriptInsights {
        action_items: vec![],
        decisions: vec![],
        mentions: vec![],
        topics: vec![],
        sentiment: "neutral".to_string(),
    };

    if transcript.trim().len() < 20 {
        return empty;
    }

    let config = crate::config::load_config();
    if config.api_key.is_empty() {
        return empty;
    }

    let model = crate::config::cheap_model_for_provider(&config.provider, &config.model);

    let prompt = format!(
        r#"Analyze this short audio transcript and extract structured information.
Return ONLY valid JSON in this exact shape — no markdown fences, no commentary:

{{
  "action_items": ["thing to do", ...],
  "decisions": ["agreed to X", ...],
  "mentions": ["Alice", "ProjectX", "Rust", ...],
  "topics": ["authentication", "deployment", ...],
  "sentiment": "positive|neutral|frustrated|excited|confused"
}}

Rules:
- action_items: concrete tasks or commitments ("need to fix auth bug by Friday")
- decisions: things agreed upon ("we will use PostgreSQL")
- mentions: people, projects, tools, technologies, companies named
- topics: high-level themes discussed (2-5 words each)
- sentiment: single word from the enum above
- If a category has no items, use an empty array []
- Keep all strings concise (under 100 chars each)

Transcript:
{}"#,
        transcript
    );

    use crate::providers::ConversationMessage;
    let messages = vec![ConversationMessage::User(prompt)];
    let no_tools: Vec<crate::providers::ToolDefinition> = vec![];

    let result = crate::providers::complete_turn(
        &config.provider,
        &config.api_key,
        &model,
        &messages,
        &no_tools,
        config.base_url.as_deref(),
    )
    .await;

    match result {
        Ok(turn) => {
            let text = turn.content.trim().to_string();
            // Strip markdown fences if the model added them anyway
            let json_str = strip_json_fences(&text);
            match serde_json::from_str::<serde_json::Value>(json_str) {
                Ok(v) => TranscriptInsights {
                    action_items: json_str_array(&v, "action_items"),
                    decisions: json_str_array(&v, "decisions"),
                    mentions: json_str_array(&v, "mentions"),
                    topics: json_str_array(&v, "topics"),
                    sentiment: v
                        .get("sentiment")
                        .and_then(|s| s.as_str())
                        .unwrap_or("neutral")
                        .to_string(),
                },
                Err(e) => {
                    log::warn!("[audio_timeline] JSON parse failed: {} — raw: {}", e, crate::safe_slice(&text, 120));
                    empty
                }
            }
        }
        Err(e) => {
            log::warn!("[audio_timeline] extraction LLM call failed: {}", e);
            empty
        }
    }
}

fn strip_json_fences(s: &str) -> &str {
    let s = s.trim();
    let s = s.strip_prefix("```json").unwrap_or(s);
    let s = s.strip_prefix("```").unwrap_or(s);
    let s = s.strip_suffix("```").unwrap_or(s);
    s.trim()
}

fn json_str_array(v: &serde_json::Value, key: &str) -> Vec<String> {
    v.get(key)
        .and_then(|a| a.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|x| x.as_str())
                .map(|s| s.to_string())
                .collect()
        })
        .unwrap_or_default()
}

// ---------------------------------------------------------------------------
// Embed audio transcript into vector store
// ---------------------------------------------------------------------------

fn embed_audio_entry(
    store: &crate::embeddings::SharedVectorStore,
    entry_id: i64,
    transcript: &str,
    topics: &[String],
) {
    let text = if topics.is_empty() {
        transcript.to_string()
    } else {
        format!("[{}] {}", topics.join(", "), transcript)
    };
    let text = if text.len() > 2000 {
        text[..2000].to_string()
    } else {
        text
    };

    let embed_input = vec![text.clone()];
    match crate::embeddings::embed_texts(&embed_input) {
        Ok(embeddings) => {
            if let Some(embedding) = embeddings.into_iter().next() {
                if let Ok(mut s) = store.lock() {
                    s.add(
                        text,
                        embedding,
                        "audio_timeline".to_string(),
                        entry_id.to_string(),
                    );
                }
            }
        }
        Err(e) => {
            log::warn!("[audio_timeline] embed failed: {}", e);
        }
    }
}

// ---------------------------------------------------------------------------
// Meeting detection
// ---------------------------------------------------------------------------

/// Returns true if a known video-call application is currently the foreground
/// window. When true, the capture loop boosts quality and keeps a meeting_id
/// consistent across chunks.
pub fn detect_meeting_in_progress() -> bool {
    let meeting_apps = [
        "zoom", "meet", "teams", "discord", "webex", "skype",
        "gotomeeting", "whereby", "gather", "slack",
    ];

    match crate::context::get_active_window() {
        Ok(win) => {
            let app_lower = win.app_name.to_lowercase();
            let title_lower = win.window_title.to_lowercase();
            meeting_apps
                .iter()
                .any(|a| app_lower.contains(a) || title_lower.contains(a))
        }
        Err(_) => false,
    }
}

// ---------------------------------------------------------------------------
// Core 30-second capture tick
// ---------------------------------------------------------------------------

/// Record one 30-second audio chunk, transcribe it, extract insights, and
/// store everything in the DB + vector store.
pub async fn audio_capture_tick(
    app: &tauri::AppHandle,
    meeting_id: &mut String,
) {
    use tauri::Manager;

    let config = crate::config::load_config();
    let now = chrono::Utc::now().timestamp();

    // Detect if we're in a meeting — keep a consistent meeting_id for the session
    let in_meeting = detect_meeting_in_progress();
    if in_meeting {
        if meeting_id.is_empty() {
            *meeting_id = format!("meeting_{}", now);
            log::info!("[audio_timeline] meeting detected — starting session {}", meeting_id);
            let _ = app.emit_to("main", "audio_meeting_started",
                serde_json::json!({ "meeting_id": meeting_id.clone(), "timestamp": now }),
            );
        }
    } else if !meeting_id.is_empty() {
        // Meeting ended — trigger summary generation
        let ended_id = std::mem::take(meeting_id);
        log::info!("[audio_timeline] meeting {} ended", ended_id);
        let app_clone = app.clone();
        tauri::async_runtime::spawn(async move {
            match generate_meeting_summary(&ended_id).await {
                Ok(summary) => {
                    let _ = app_clone.emit_to("main", "audio_meeting_ended",
                        serde_json::json!({
                            "meeting_id": summary.meeting_id,
                            "summary": summary.summary,
                            "action_items": summary.action_items,
                            "decisions": summary.decisions,
                        }),
                    );
                }
                Err(e) => log::warn!("[audio_timeline] meeting summary failed: {}", e),
            }
        });
    }

    // Determine source: prefer "both" in meetings, "mic" otherwise
    let source = if in_meeting { "both" } else { "mic" };

    // Record 30 seconds via cpal (mic)
    let wav_bytes = match record_audio_chunk(30).await {
        Ok(b) => b,
        Err(e) => {
            log::warn!("[audio_timeline] record failed: {}", e);
            return;
        }
    };

    // VAD gate: skip silent chunks
    let samples = crate::voice::audio_bytes_to_f32_approx(&wav_bytes);
    if !crate::whisper_local::is_speech(&samples, crate::whisper_local::DEFAULT_VAD_THRESHOLD * 0.5) {
        log::debug!("[audio_timeline] VAD: silence, skipping chunk");
        return;
    }

    // Transcribe
    let transcript = if config.use_local_whisper {
        match crate::whisper_local::transcribe_audio(&wav_bytes).await {
            Ok(t) => t,
            Err(e) => {
                log::warn!("[audio_timeline] local transcription error: {}", e);
                return;
            }
        }
    } else {
        use base64::Engine as _;
        let b64 = base64::engine::general_purpose::STANDARD.encode(&wav_bytes);
        match crate::voice::voice_transcribe(b64).await {
            Ok(t) => t,
            Err(e) => {
                log::warn!("[audio_timeline] API transcription error: {}", e);
                return;
            }
        }
    };

    if transcript.trim().is_empty() {
        return;
    }

    log::debug!("[audio_timeline] transcript: {}", crate::safe_slice(&transcript, 80));

    // Insert DB row immediately with empty insights (filled in async below)
    let empty_insights = TranscriptInsights {
        action_items: vec![],
        decisions: vec![],
        mentions: vec![],
        topics: vec![],
        sentiment: "neutral".to_string(),
    };

    let entry_id = {
        let conn = match open_db() {
            Some(c) => c,
            None => return,
        };
        match insert_audio_entry(&conn, now, 30, &transcript, source, &empty_insights, meeting_id) {
            Some(id) => id,
            None => return,
        }
    };

    // Emit to frontend
    let _ = app.emit_to("main", "audio_timeline_tick",
        serde_json::json!({
            "id": entry_id,
            "timestamp": now,
            "transcript": &transcript,
            "source": source,
            "in_meeting": in_meeting,
        }),
    );

    // Async: extract insights + embed (doesn't block the capture loop)
    let store = app.state::<crate::embeddings::SharedVectorStore>().inner().clone();
    let transcript_clone = transcript.clone();
    let meeting_id_clone = meeting_id.clone();

    tauri::async_runtime::spawn(async move {
        let insights = extract_from_transcript(&transcript_clone).await;

        // Update the DB row with insights
        if let Some(conn) = open_db() {
            let action_items = serde_json::to_string(&insights.action_items).unwrap_or_default();
            let decisions = serde_json::to_string(&insights.decisions).unwrap_or_default();
            let mentions = serde_json::to_string(&insights.mentions).unwrap_or_default();
            let topics = serde_json::to_string(&insights.topics).unwrap_or_default();
            let _ = conn.execute(
                "UPDATE audio_timeline SET action_items=?1, decisions=?2, mentions=?3, topics=?4, sentiment=?5 WHERE id=?6",
                params![action_items, decisions, mentions, topics, insights.sentiment, entry_id],
            );
        }

        // Store extracted action items into KG if any
        if !insights.action_items.is_empty() {
            if let Some(conn) = open_db() {
                let _ = push_action_items_to_kg(&conn, &insights.action_items, now, &meeting_id_clone);
            }
        }

        // Embed transcript for search
        embed_audio_entry(&store, entry_id, &transcript_clone, &insights.topics);
    });
}

/// Push extracted action items as KG nodes (node_type = 'action_item') so they
/// surface in smart_context_recall and the knowledge graph view.
fn push_action_items_to_kg(
    conn: &rusqlite::Connection,
    items: &[String],
    timestamp: i64,
    meeting_id: &str,
) -> Result<(), String> {
    let source_tag = if meeting_id.is_empty() {
        "audio_timeline".to_string()
    } else {
        format!("meeting:{}", meeting_id)
    };
    let sources_json = serde_json::to_string(&[&source_tag]).unwrap_or_default();
    for item in items {
        let id = format!("ai_{}_{}", timestamp, uuid_fragment(item));
        // Insert as KG node matching the knowledge_graph.rs schema
        let _ = conn.execute(
            "INSERT OR IGNORE INTO kg_nodes (id, concept, node_type, description, sources, importance, created_at, last_updated)
             VALUES (?1, ?2, 'action_item', ?3, ?4, 0.8, ?5, ?5)",
            params![id, item, item, sources_json, timestamp],
        );
    }
    Ok(())
}

fn uuid_fragment(s: &str) -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut h = DefaultHasher::new();
    s.hash(&mut h);
    format!("{:x}", h.finish())
}

// ---------------------------------------------------------------------------
// Raw audio recording via cpal
// ---------------------------------------------------------------------------

/// Record `duration_secs` seconds of microphone audio and return WAV bytes.
async fn record_audio_chunk(duration_secs: u64) -> Result<Vec<u8>, String> {
    // Run the blocking cpal capture on a dedicated thread, pass result back via channel.
    let (tx, rx) = std::sync::mpsc::channel::<Result<Vec<u8>, String>>();

    std::thread::spawn(move || {
        use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};

        let host = cpal::default_host();
        let device = match host.default_input_device() {
            Some(d) => d,
            None => {
                let _ = tx.send(Err("No input device available".to_string()));
                return;
            }
        };
        let cpal_config = match device.default_input_config() {
            Ok(c) => c,
            Err(e) => {
                let _ = tx.send(Err(format!("Device config error: {}", e)));
                return;
            }
        };

        let sample_rate = cpal_config.sample_rate().0;
        let channels = cpal_config.channels() as usize;
        let total_samples = (sample_rate as u64 * duration_secs) as usize * channels;

        let collected: std::sync::Arc<std::sync::Mutex<Vec<f32>>> =
            std::sync::Arc::new(std::sync::Mutex::new(Vec::with_capacity(total_samples)));
        let collected_clone = collected.clone();
        let done = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let done_clone = done.clone();

        let stream = device.build_input_stream(
            &cpal_config.into(),
            move |data: &[f32], _: &cpal::InputCallbackInfo| {
                if done_clone.load(Ordering::Relaxed) {
                    return;
                }
                if let Ok(mut buf) = collected_clone.lock() {
                    let remaining = total_samples.saturating_sub(buf.len());
                    let take = data.len().min(remaining);
                    buf.extend_from_slice(&data[..take]);
                    if buf.len() >= total_samples {
                        done_clone.store(true, Ordering::Relaxed);
                    }
                }
            },
            |err| log::warn!("[audio_timeline] stream error: {}", err),
            None,
        );

        match stream {
            Ok(s) => {
                let _ = s.play();
                // Block until we have enough samples or audio capture is disabled
                let deadline = std::time::Instant::now()
                    + std::time::Duration::from_secs(duration_secs + 2);
                while !done.load(Ordering::Relaxed)
                    && std::time::Instant::now() < deadline
                    && AUDIO_CAPTURE_ACTIVE.load(Ordering::Relaxed)
                {
                    std::thread::sleep(std::time::Duration::from_millis(50));
                }
                drop(s); // release mic
            }
            Err(e) => {
                let _ = tx.send(Err(format!("Stream build error: {}", e)));
                return;
            }
        }

        let samples = match collected.lock() {
            Ok(b) => b.clone(),
            Err(_) => {
                let _ = tx.send(Err("Buffer lock failed".to_string()));
                return;
            }
        };

        // Mix to mono
        let mono: Vec<f32> = if channels > 1 {
            samples
                .chunks(channels)
                .map(|c| c.iter().sum::<f32>() / channels as f32)
                .collect()
        } else {
            samples
        };

        // Encode to WAV
        match crate::voice::encode_wav(&mono, 1, sample_rate) {
            Ok(wav) => { let _ = tx.send(Ok(wav)); }
            Err(e) => { let _ = tx.send(Err(e)); }
        }
    });

    // Await the result with tokio (we're in an async context)
    tokio::task::spawn_blocking(move || {
        rx.recv()
            .map_err(|e| format!("Channel error: {}", e))
            .and_then(|r| r)
    })
    .await
    .map_err(|e| format!("Task error: {}", e))?
}

// ---------------------------------------------------------------------------
// Capture loop — runs alongside screenshot loop
// ---------------------------------------------------------------------------

pub fn start_audio_timeline_capture(app: tauri::AppHandle) {
    if AUDIO_CAPTURE_ACTIVE.swap(true, Ordering::SeqCst) {
        log::warn!("[audio_timeline] capture loop already running");
        return;
    }

    // Notify HUD that audio capture is now active
    let _ = app.emit_to("main", "audio_capture_state", serde_json::json!({ "active": true }));

    tauri::async_runtime::spawn(async move {
        log::info!("[audio_timeline] capture loop started");
        let mut meeting_id = String::new();

        loop {
            let config = crate::config::load_config();
            if !config.audio_capture_enabled {
                AUDIO_CAPTURE_ACTIVE.store(false, Ordering::SeqCst);
                log::info!("[audio_timeline] disabled in config — stopping");
                let _ = app.emit_to("main", "audio_capture_state", serde_json::json!({ "active": false }));
                break;
            }

            // Vagus nerve: skip transcription in deep conservation mode
            // BUT always capture during meetings (meetings override conservation)
            let in_meeting = detect_meeting_in_progress();
            if !in_meeting && crate::homeostasis::energy_mode() < 0.2 {
                tokio::time::sleep(tokio::time::Duration::from_secs(30)).await;
                continue;
            }

            audio_capture_tick(&app, &mut meeting_id).await;

            // Respect audio_capture_enabled between chunks too
            if !crate::config::load_config().audio_capture_enabled {
                AUDIO_CAPTURE_ACTIVE.store(false, Ordering::SeqCst);
                let _ = app.emit_to("main", "audio_capture_state", serde_json::json!({ "active": false }));
                break;
            }

            // Small sleep between chunks (audio_capture_tick itself takes ~30s)
            tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
        }
    });
}

// ---------------------------------------------------------------------------
// Meeting summary generation
// ---------------------------------------------------------------------------

/// Aggregate all audio chunks for a meeting_id and generate a structured summary
/// using the chat model.
pub async fn generate_meeting_summary(meeting_id: &str) -> Result<MeetingSummary, String> {
    if meeting_id.is_empty() {
        return Err("Empty meeting_id".to_string());
    }

    // Collect all chunks for this meeting
    let (chunks, start_ts, end_ts) = {
        let conn = open_db().ok_or("DB unavailable")?;
        let mut stmt = conn
            .prepare(
                "SELECT transcript, timestamp, action_items, decisions, mentions
                 FROM audio_timeline WHERE meeting_id = ?1 ORDER BY timestamp ASC",
            )
            .map_err(|e| e.to_string())?;

        let mut transcripts: Vec<String> = vec![];
        let mut action_items: Vec<String> = vec![];
        let mut decisions: Vec<String> = vec![];
        let mut mentions: Vec<String> = vec![];
        let mut start_ts: i64 = i64::MAX;
        let mut end_ts: i64 = 0;

        let rows = stmt
            .query_map(params![meeting_id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                ))
            })
            .map_err(|e| e.to_string())?;

        for row in rows.flatten() {
            let (transcript, ts, ai_json, dec_json, men_json) = row;
            transcripts.push(transcript);
            if ts < start_ts { start_ts = ts; }
            if ts > end_ts { end_ts = ts; }

            if let Ok(items) = serde_json::from_str::<Vec<String>>(&ai_json) {
                action_items.extend(items);
            }
            if let Ok(items) = serde_json::from_str::<Vec<String>>(&dec_json) {
                decisions.extend(items);
            }
            if let Ok(items) = serde_json::from_str::<Vec<String>>(&men_json) {
                mentions.extend(items);
            }
        }

        // Deduplicate
        action_items.dedup();
        decisions.dedup();
        mentions.dedup();

        (
            (transcripts, action_items, decisions, mentions),
            start_ts,
            end_ts,
        )
    };

    let (transcripts, action_items, decisions, mentions) = chunks;
    if transcripts.is_empty() {
        return Err("No chunks found for meeting".to_string());
    }

    let full_transcript = transcripts.join("\n\n---\n\n");
    let duration_minutes = (end_ts - start_ts) / 60;

    // Build summary via LLM
    let config = crate::config::load_config();
    let model = crate::config::cheap_model_for_provider(&config.provider, &config.model);

    let prompt = format!(
        r#"Generate a concise meeting summary from this transcript.

Action items identified: {}
Decisions made: {}
People/tools mentioned: {}

Transcript:
{}

Return a JSON object (no markdown fences):
{{
  "title": "Short meeting title (under 60 chars)",
  "summary": "2-4 sentence executive summary",
  "sentiment": "productive|tense|energetic|inconclusive",
  "participants": ["name1", "name2"]
}}"#,
        action_items.join("; "),
        decisions.join("; "),
        mentions.join(", "),
        crate::safe_slice(&full_transcript, 4000)
    );

    use crate::providers::ConversationMessage;
    let messages = vec![ConversationMessage::User(prompt)];
    let no_tools: Vec<crate::providers::ToolDefinition> = vec![];

    let (title, summary, sentiment, participants) = match crate::providers::complete_turn(
        &config.provider,
        &config.api_key,
        &model,
        &messages,
        &no_tools,
        config.base_url.as_deref(),
    )
    .await
    {
        Ok(turn) => {
            let text = turn.content.trim().to_string();
            let json_str = strip_json_fences(&text);
            match serde_json::from_str::<serde_json::Value>(json_str) {
                Ok(v) => (
                    v.get("title")
                        .and_then(|s| s.as_str())
                        .unwrap_or("Meeting")
                        .to_string(),
                    v.get("summary")
                        .and_then(|s| s.as_str())
                        .unwrap_or("")
                        .to_string(),
                    v.get("sentiment")
                        .and_then(|s| s.as_str())
                        .unwrap_or("neutral")
                        .to_string(),
                    json_str_array(&v, "participants"),
                ),
                Err(_) => (
                    "Meeting".to_string(),
                    text,
                    "neutral".to_string(),
                    vec![],
                ),
            }
        }
        Err(e) => return Err(format!("LLM error: {}", e)),
    };

    Ok(MeetingSummary {
        meeting_id: meeting_id.to_string(),
        title,
        start_timestamp: start_ts,
        end_timestamp: end_ts,
        participants,
        summary,
        action_items,
        decisions,
        sentiment,
        duration_minutes,
    })
}

// ---------------------------------------------------------------------------
// Unified search across everything
// ---------------------------------------------------------------------------

/// Search across screenshot descriptions, audio transcripts, conversations,
/// and knowledge graph facts — returns a unified ranked result list.
pub async fn search_everything(
    store: &crate::embeddings::SharedVectorStore,
    query: &str,
    limit: usize,
) -> Vec<UnifiedSearchResult> {
    if query.trim().is_empty() {
        return vec![];
    }

    let embed_input = vec![query.to_string()];
    let embeddings = match crate::embeddings::embed_texts(&embed_input) {
        Ok(e) => e,
        Err(_) => return vec![],
    };
    let query_embedding = match embeddings.into_iter().next() {
        Some(e) => e,
        None => return vec![],
    };

    // Pull all results from the vector store (all source types)
    let raw_results = match store.lock() {
        Ok(s) => s.hybrid_search(&query_embedding, query, limit * 4),
        Err(_) => return vec![],
    };

    let mut results: Vec<UnifiedSearchResult> = Vec::new();
    let conn = match open_db() {
        Some(c) => c,
        None => return vec![],
    };

    for r in raw_results.into_iter().take(limit * 2) {
        let result_type = match r.source_type.as_str() {
            "screen_timeline" => SearchResultType::Screenshot,
            "audio_timeline" => SearchResultType::AudioTranscript,
            "conversation" => SearchResultType::Conversation,
            "kg_fact" | "knowledge" => SearchResultType::KnowledgeFact,
            _ => SearchResultType::File,
        };

        // Resolve timestamp from source table where possible
        let (content, timestamp) = match r.source_type.as_str() {
            "screen_timeline" => {
                if let Ok(id) = r.source_id.parse::<i64>() {
                    let row = conn.query_row(
                        "SELECT description, timestamp FROM screen_timeline WHERE id = ?1",
                        params![id],
                        |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)),
                    );
                    match row {
                        Ok((desc, ts)) => (desc, ts),
                        Err(_) => (r.text.clone(), 0),
                    }
                } else {
                    (r.text.clone(), 0)
                }
            }
            "audio_timeline" => {
                if let Ok(id) = r.source_id.parse::<i64>() {
                    let row = conn.query_row(
                        "SELECT transcript, timestamp FROM audio_timeline WHERE id = ?1",
                        params![id],
                        |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)),
                    );
                    match row {
                        Ok((transcript, ts)) => (transcript, ts),
                        Err(_) => (r.text.clone(), 0),
                    }
                } else {
                    (r.text.clone(), 0)
                }
            }
            _ => (r.text.clone(), 0),
        };

        results.push(UnifiedSearchResult {
            result_type,
            content,
            timestamp,
            relevance: r.score as f64,
            source_id: r.source_id,
        });
    }

    // Also search audio_timeline table directly via keyword for recent chunks
    // (catches transcripts not yet embedded)
    let query_lower = query.to_lowercase();
    let keyword_rows = {
        let mut stmt = conn.prepare(
            "SELECT id, transcript, timestamp FROM audio_timeline
             WHERE transcript LIKE ?1 ORDER BY timestamp DESC LIMIT 10",
        );
        match stmt {
            Ok(ref mut s) => {
                let pattern = format!("%{}%", query_lower);
                s.query_map(params![pattern], |row| {
                    Ok((
                        row.get::<_, i64>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, i64>(2)?,
                    ))
                })
                .ok()
                .map(|rows| rows.flatten().collect::<Vec<_>>())
                .unwrap_or_default()
            }
            Err(_) => vec![],
        }
    };

    for (id, transcript, ts) in keyword_rows {
        // Don't duplicate if already in results
        let id_str = id.to_string();
        if results.iter().any(|r| r.source_id == id_str) {
            continue;
        }
        results.push(UnifiedSearchResult {
            result_type: SearchResultType::AudioTranscript,
            content: transcript,
            timestamp: ts,
            relevance: 0.5,
            source_id: id_str,
        });
    }

    // Sort by relevance descending
    results.sort_by(|a, b| {
        b.relevance
            .partial_cmp(&a.relevance)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    results.truncate(limit);
    results
}

// ---------------------------------------------------------------------------
// Query helpers
// ---------------------------------------------------------------------------

pub fn audio_timeline_browse(
    from_ts: Option<i64>,
    to_ts: Option<i64>,
    limit: usize,
    offset: usize,
) -> Vec<AudioTimelineEntry> {
    let conn = match open_db() {
        Some(c) => c,
        None => return vec![],
    };

    match (from_ts, to_ts) {
        (Some(from), Some(to)) => {
            let mut stmt = match conn.prepare(
                "SELECT id, timestamp, duration_secs, transcript, action_items, decisions, mentions, topics, sentiment, source, meeting_id
                 FROM audio_timeline WHERE timestamp >= ?1 AND timestamp <= ?2
                 ORDER BY timestamp DESC LIMIT ?3 OFFSET ?4",
            ) {
                Ok(s) => s,
                Err(_) => return vec![],
            };
            stmt.query_map(params![from, to, limit as i64, offset as i64], map_row)
                .ok()
                .map(|r| r.flatten().collect())
                .unwrap_or_default()
        }
        _ => {
            let mut stmt = match conn.prepare(
                "SELECT id, timestamp, duration_secs, transcript, action_items, decisions, mentions, topics, sentiment, source, meeting_id
                 FROM audio_timeline ORDER BY timestamp DESC LIMIT ?1 OFFSET ?2",
            ) {
                Ok(s) => s,
                Err(_) => return vec![],
            };
            stmt.query_map(params![limit as i64, offset as i64], map_row)
                .ok()
                .map(|r| r.flatten().collect())
                .unwrap_or_default()
        }
    }
}

pub fn audio_timeline_search(
    store: &crate::embeddings::SharedVectorStore,
    query: &str,
    limit: usize,
) -> Vec<AudioTimelineEntry> {
    let embed_input = vec![query.to_string()];
    let embeddings = match crate::embeddings::embed_texts(&embed_input) {
        Ok(e) => e,
        Err(_) => return vec![],
    };
    let query_embedding = match embeddings.into_iter().next() {
        Some(e) => e,
        None => return vec![],
    };

    let results = match store.lock() {
        Ok(s) => s.hybrid_search(&query_embedding, query, limit * 2),
        Err(_) => return vec![],
    };

    let ids: Vec<i64> = results
        .into_iter()
        .filter(|r| r.source_type == "audio_timeline")
        .take(limit)
        .filter_map(|r| r.source_id.parse::<i64>().ok())
        .collect();

    if ids.is_empty() {
        return vec![];
    }

    let conn = match open_db() {
        Some(c) => c,
        None => return vec![],
    };

    ids.into_iter()
        .filter_map(|id| {
            conn.query_row(
                "SELECT id, timestamp, duration_secs, transcript, action_items, decisions, mentions, topics, sentiment, source, meeting_id
                 FROM audio_timeline WHERE id = ?1",
                params![id],
                map_row,
            )
            .ok()
        })
        .collect()
}

pub fn get_all_action_items(limit: usize) -> Vec<serde_json::Value> {
    let conn = match open_db() {
        Some(c) => c,
        None => return vec![],
    };
    let mut stmt = match conn.prepare(
        "SELECT id, timestamp, action_items, meeting_id FROM audio_timeline
         WHERE action_items != '[]' ORDER BY timestamp DESC LIMIT ?1",
    ) {
        Ok(s) => s,
        Err(_) => return vec![],
    };

    stmt.query_map(params![limit as i64], |row| {
        Ok((
            row.get::<_, i64>(0)?,
            row.get::<_, i64>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, String>(3)?,
        ))
    })
    .ok()
    .map(|rows| {
        rows.flatten()
            .flat_map(|(id, ts, items_json, meeting_id)| {
                let items: Vec<String> =
                    serde_json::from_str(&items_json).unwrap_or_default();
                items.into_iter().map(move |item| {
                    serde_json::json!({
                        "entry_id": id,
                        "timestamp": ts,
                        "action_item": item,
                        "meeting_id": meeting_id,
                    })
                })
            })
            .collect()
    })
    .unwrap_or_default()
}
