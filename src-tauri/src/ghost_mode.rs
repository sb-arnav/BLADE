#![allow(dead_code, unused_assignments)] // Ghost mode helpers invoked via dynamic tool dispatch

/// BLADE Ghost Mode — invisible AI overlay for meetings and chat
///
/// Listens to system audio during meetings (Zoom, Meet, Teams, Discord, Slack)
/// and chat platforms (Slack Web, Discord, WhatsApp Web), transcribes in real
/// time using Whisper (5-second chunks), and shows a transparent always-on-top
/// overlay with AI-generated response suggestions in the user's own style.
///
/// The overlay is NOT visible to screen share on Windows (content protection).
///
/// Architecture:
///   cpal loopback/input → 5s chunk buffer → Whisper transcription
///   → rolling 2-min context window → question detection
///   → LLM response (personality_mirror profile injected)
///   → emit `ghost_suggestion` Tauri event → overlay window
///
/// Tauri commands: ghost_start, ghost_stop, ghost_set_position, ghost_get_status

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use tauri::{Emitter, Manager};

// ── Constants ─────────────────────────────────────────────────────────────────

/// Seconds of audio to collect before a Whisper transcription pass.
const CHUNK_SECONDS: u32 = 5;
/// How many seconds of conversation to keep in the rolling context window.
const CONTEXT_WINDOW_SECS: u64 = 120;
/// Energy threshold for considering a frame as speech (arbitrary f32 amplitude).
const SPEECH_ENERGY_THRESHOLD: f32 = 0.005;
/// Silence gap (seconds) that signals end of a speaker's turn.
const SPEAKER_CHANGE_GAP_SECS: f64 = 1.5;

// ── Global state ──────────────────────────────────────────────────────────────

static GHOST_ACTIVE: AtomicBool = AtomicBool::new(false);

// ── Data Structures ───────────────────────────────────────────────────────────

/// A single detected participant in the current meeting/conversation.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ConversationParticipant {
    /// Display name, if identified from calendar event or prior knowledge.
    pub name: Option<String>,
    /// Inferred relationship role: "manager" | "teammate" | "client" | "unknown"
    pub role: Option<String>,
    /// Short summary of how this person speaks (built up during the session).
    pub speaking_style: String,
    /// Relationship descriptor pulled from the knowledge graph.
    pub relationship: String,
}

/// One segment of transcribed speech in the rolling context window.
#[derive(Debug, Clone)]
struct ConversationSegment {
    /// UTC timestamp when this segment was captured.
    timestamp: u64,
    /// Transcribed text.
    text: String,
    /// Speaker index (0 = user, 1+ = detected participants).
    speaker_idx: usize,
}

/// The shared state owned by the ghost-mode worker.
struct GhostState {
    /// Known participants discovered during this session.
    participants: Vec<ConversationParticipant>,
    /// The detected meeting platform ("zoom" | "teams" | "meet" | "discord" | "slack" | "none").
    platform: String,
    /// Position of the overlay window ("bottom-right" | "bottom-left" | "top-right" | "top-left").
    position: String,
    /// When the current meeting was first detected (Unix seconds).
    meeting_start_secs: Option<u64>,
    /// Name of the most recently identified speaker.
    current_speaker: Option<String>,
}

impl Default for GhostState {
    fn default() -> Self {
        Self {
            participants: Vec::new(),
            platform: "none".to_string(),
            position: "bottom-right".to_string(),
            meeting_start_secs: None,
            current_speaker: None,
        }
    }
}

/// A suggestion emitted to the frontend overlay.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GhostSuggestion {
    /// The suggested response text (1-3 sentences).
    pub response: String,
    /// The question or statement that triggered this suggestion.
    pub trigger: String,
    /// Speaker name, if known.
    pub speaker: Option<String>,
    /// Confidence score 0.0–1.0.
    pub confidence: f32,
    /// Current detected platform.
    pub platform: String,
    /// UTC timestamp (ms).
    pub timestamp_ms: u64,
}

/// Meeting state pushed to the HUD bar so it can render meeting mode.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GhostMeetingState {
    /// Platform name ("zoom" | "teams" | "meet" | "discord" | "slack" | "whatsapp")
    pub platform: String,
    /// Display name of the meeting (same as platform for now; can be enriched later)
    pub meeting_name: String,
    /// Name of the participant currently (or most recently) speaking.
    pub speaker_name: Option<String>,
    /// Duration of the current meeting in seconds (approximate).
    pub duration_secs: u64,
    /// Whether ghost mode is active and listening.
    pub listening: bool,
}

/// Status returned by ghost_get_status.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GhostStatus {
    pub active: bool,
    pub platform: String,
    pub position: String,
    pub participant_count: usize,
    pub context_segments: usize,
}

// ── Meeting Detection ──────────────────────────────────────────────────────────

/// Detect which meeting/chat platform is currently in the foreground.
/// Returns the platform name or "none".
fn detect_meeting_platform() -> String {
    let windows = match crate::context::list_open_windows_internal() {
        Ok(w) => w,
        Err(_) => return "none".to_string(),
    };

    for w in &windows {
        let title = w.window_title.to_lowercase();
        let app = w.app_name.to_lowercase();

        if app.contains("zoom") || title.contains("zoom meeting") || title.contains("zoom video") {
            return "zoom".to_string();
        }
        if app.contains("teams") || title.contains("microsoft teams") {
            return "teams".to_string();
        }
        if app.contains("discord") || title.contains("discord") {
            return "discord".to_string();
        }
        if title.contains("google meet") || title.contains("meet.google.com") {
            return "meet".to_string();
        }
        if title.contains("slack") && (title.contains("huddle") || app.contains("slack")) {
            return "slack".to_string();
        }
        if title.contains("whatsapp") {
            return "whatsapp".to_string();
        }
    }
    "none".to_string()
}

// ── Audio capture + VAD ───────────────────────────────────────────────────────

/// Capture CHUNK_SECONDS of audio from the default input device.
/// Returns the PCM samples (f32, mono) and the sample rate.
/// Falls back gracefully if no device is available.
/// NOTE: Kept for reference / audio_timeline use. Ghost mode now uses vad::start_vad_capture().
#[allow(dead_code)]
fn capture_audio_chunk() -> Option<(Vec<f32>, u32)> {
    let host = cpal::default_host();
    let device = host.default_input_device()?;
    let cfg = device.default_input_config().ok()?;
    let sample_rate = cfg.sample_rate().0;
    let channels = cfg.channels() as usize;
    // Target number of mono samples we want
    let target_mono = (sample_rate * CHUNK_SECONDS) as usize;

    let (tx, rx) = std::sync::mpsc::sync_channel::<Vec<f32>>(128);

    let tx_cb = tx.clone();
    let stream = device.build_input_stream(
        &cfg.into(),
        move |data: &[f32], _: &cpal::InputCallbackInfo| {
            // Downmix to mono inline
            let mono: Vec<f32> = data
                .chunks(channels)
                .map(|c| c.iter().sum::<f32>() / channels as f32)
                .collect();
            let _ = tx_cb.try_send(mono);
        },
        |e| log::warn!("[ghost_mode] audio stream error: {}", e),
        None,
    ).ok()?;

    stream.play().ok()?;

    let mut collected: Vec<f32> = Vec::with_capacity(target_mono);
    let start = std::time::Instant::now();
    let timeout = std::time::Duration::from_secs(CHUNK_SECONDS as u64 + 3);

    while collected.len() < target_mono && start.elapsed() < timeout {
        match rx.recv_timeout(std::time::Duration::from_millis(50)) {
            Ok(chunk) => collected.extend(chunk),
            Err(_) => {}
        }
    }
    drop(stream);
    drop(tx);

    if collected.is_empty() {
        return None;
    }

    Some((collected, sample_rate))
}

/// Simple energy-based VAD: returns true if the chunk contains enough speech.
#[allow(dead_code)]
fn has_speech(samples: &[f32]) -> bool {
    let energy: f32 = samples.iter().map(|s| s * s).sum::<f32>() / samples.len() as f32;
    energy > SPEECH_ENERGY_THRESHOLD
}

// ── Transcription ─────────────────────────────────────────────────────────────

/// Transcribe audio samples using Groq Whisper API (or local if configured).
/// Returns the transcript text or empty string on failure.
/// NOTE: Replaced by deepgram::transcribe_with_fallback() in ghost_mode's main loop.
#[allow(dead_code)]
async fn transcribe_chunk(samples: &[f32], sample_rate: u32) -> String {
    // Encode as WAV in memory (mono, 1 channel)
    let wav_data = match crate::voice::encode_wav(samples, 1, sample_rate) {
        Ok(d) => d,
        Err(e) => {
            log::warn!("[ghost_mode] WAV encode failed: {}", e);
            return String::new();
        }
    };

    let config = crate::config::load_config();

    // Try local Whisper first if enabled
    #[cfg(feature = "local-whisper")]
    if config.use_local_whisper {
        if let Ok(text) = crate::whisper_local::transcribe_audio_with_model(&wav_data, &config.whisper_model).await {
            return text;
        }
    }

    // Fall back to Groq Whisper API
    let groq_key = crate::config::get_provider_key("groq");
    if groq_key.is_empty() {
        // Try active provider's API key via OpenAI-compatible transcription
        if config.api_key.is_empty() {
            return String::new();
        }
    }

    let api_key = if !groq_key.is_empty() { groq_key } else { config.api_key.clone() };
    let url = "https://api.groq.com/openai/v1/audio/transcriptions";

    let client = reqwest::Client::new();
    let part = reqwest::multipart::Part::bytes(wav_data)
        .file_name("audio.wav")
        .mime_str("audio/wav")
        .unwrap_or_else(|_| reqwest::multipart::Part::bytes(vec![]));
    let form = reqwest::multipart::Form::new()
        .part("file", part)
        .text("model", "whisper-large-v3-turbo")
        .text("language", "en")
        .text("response_format", "text");

    let resp = match client
        .post(url)
        .bearer_auth(&api_key)
        .multipart(form)
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => {
            log::warn!("[ghost_mode] Whisper API request failed: {}", e);
            return String::new();
        }
    };

    if resp.status().is_success() {
        resp.text().await.unwrap_or_default().trim().to_string()
    } else {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        log::warn!("[ghost_mode] Whisper API error {}: {}", status, body);
        String::new()
    }
}

// ── Question Detection ─────────────────────────────────────────────────────────

/// Returns true if the text looks like a question directed at the user or
/// a statement followed by a significant pause that warrants a response.
fn is_question_or_prompt(text: &str, user_name: &str) -> bool {
    let t = text.trim().to_lowercase();
    if t.is_empty() {
        return false;
    }

    // Direct address
    let name_lower = user_name.to_lowercase();
    if !name_lower.is_empty() && t.contains(&name_lower) {
        return true;
    }

    // Ends with a question mark
    if t.ends_with('?') {
        return true;
    }

    // Common question starters
    let starters = [
        "what do you", "what are your", "what's your",
        "how do you", "how would you", "how should",
        "do you think", "do you have", "have you",
        "can you", "could you", "would you",
        "what about you", "any thoughts", "any questions",
        "thoughts on", "opinion on", "do you agree",
        "what would you", "why do you", "when would",
    ];
    for s in &starters {
        if t.starts_with(s) || t.contains(s) {
            return true;
        }
    }

    false
}

// ── Speaker Detection ──────────────────────────────────────────────────────────

/// Very simple energy-based speaker-change heuristic.
/// Returns an estimated speaker index (0 = first detected speaker).
/// In a real implementation this would use diarization, but for now we
/// cycle speakers when a gap is detected in energy patterns.
fn estimate_speaker(samples: &[f32], sample_rate: u32, previous_speaker: usize) -> usize {
    // Detect pauses longer than SPEAKER_CHANGE_GAP_SECS in the audio
    let gap_samples = (sample_rate as f64 * SPEAKER_CHANGE_GAP_SECS) as usize;
    let window = samples.len().min(gap_samples);
    if window == 0 {
        return previous_speaker;
    }
    // Check if first window is predominantly silence (speaker just started after a gap)
    let leading_energy: f32 = samples[..window].iter().map(|s| s * s).sum::<f32>() / window as f32;
    if leading_energy < SPEECH_ENERGY_THRESHOLD * 0.5 {
        // New speaker started after a pause — rotate
        return (previous_speaker + 1) % 4; // max 4 tracked speakers
    }
    previous_speaker
}

// ── Response Generation ────────────────────────────────────────────────────────

/// Generate a ghost response for the detected question/prompt.
/// Injects the user's personality profile for stylistic mirroring.
pub async fn generate_ghost_response(context: &str, question_detected: &str) -> Result<String, String> {
    let config = crate::config::load_config();

    // Load personality profile for style injection
    let style_hint = if let Some(profile) = crate::personality_mirror::load_profile() {
        format!(
            "Mirror the user's communication style: {}. \
             Formality: {:.0}%, Technical depth: {:.0}%, \
             Avg length: {}, Humor: {}. \
             Signature phrases: {}.",
            profile.summary,
            profile.formality_level * 100.0,
            profile.technical_depth * 100.0,
            profile.avg_message_length,
            profile.humor_style,
            profile.signature_phrases.join(", ")
        )
    } else {
        "Be concise and natural. Match the conversation's energy level.".to_string()
    };

    // Cluely response format: ≤6-word headline, 1-2 bullets ≤15 words, ≤60 chars/line.
    // Silence is default — only fire when confident. Peripheral reading during calls.
    let system_prompt = format!(
        "You are BLADE Ghost — an invisible AI assistant during live meetings.\n\
         SILENCE IS DEFAULT. Only respond when the trigger is a genuine question or objection.\n\
         RESPONSE FORMAT (strict):\n\
         - Line 1: ≤6-word headline (no period)\n\
         - Line 2-3: 1-2 bullet points, ≤15 words each, ≤60 chars per line\n\
         - No markdown headers, no paragraphs, no filler\n\
         - Sound human — never say 'As an AI'\n\
         - No disclaimers unless critical\n\
         {}\n\
         Return ONLY the formatted response. No preamble.",
        style_hint
    );

    let user_message = if context.is_empty() {
        format!("Respond to this: {}", question_detected)
    } else {
        format!(
            "Recent conversation context:\n{}\n\nRespond to this: {}",
            context, question_detected
        )
    };

    let messages = vec![
        crate::providers::ConversationMessage::System(system_prompt),
        crate::providers::ConversationMessage::User(user_message),
    ];

    // Use the active provider's cheap model for low-latency responses
    let cheap_model = crate::config::cheap_model_for_provider(&config.provider, &config.model);
    let no_tools: &[crate::providers::ToolDefinition] = &[];

    crate::providers::complete_turn(
        &config.provider,
        &config.api_key,
        &cheap_model,
        &messages,
        no_tools,
        config.base_url.as_deref(),
    )
    .await
    .map(|turn| turn.content.trim().to_string())
    .map_err(|e| e.to_string())
}

// ── Overlay Window ─────────────────────────────────────────────────────────────

/// Create the ghost overlay window.
/// - Always-on-top
/// - Transparent background
/// - Click-through (platform-dependent)
/// - Content-protected on Windows (not captured in screen share)
pub fn create_ghost_overlay(app: &tauri::AppHandle) -> Result<(), String> {
    // Reuse existing if already created
    if app.get_webview_window("ghost_overlay").is_some() {
        return Ok(());
    }

    let config = crate::config::load_config();
    let position = config.ghost_mode_position.clone();

    // Determine window placement from config position string
    let (x_offset, y_offset) = match position.as_str() {
        "bottom-left"  => (20.0_f64, -200.0_f64),
        "top-right"    => (-320.0_f64, 20.0_f64),
        "top-left"     => (20.0_f64, 20.0_f64),
        _              => (-320.0_f64, -200.0_f64), // bottom-right default
    };

    // content_protected(true) = NSWindowSharingNone on macOS, WDA_EXCLUDEFROMCAPTURE on Windows.
    // Invisible to screen share in Google Meet, Teams, all browsers. (Zoom macOS bypasses this.)
    let builder = tauri::WebviewWindowBuilder::new(
        app,
        "ghost_overlay",
        tauri::WebviewUrl::App("ghost_overlay.html".into()),
    )
    .title("BLADE Ghost")
    .inner_size(300.0, 160.0)
    .decorations(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .transparent(true)
    .resizable(false)
    .content_protected(true)
    .visible(false);

    let window = builder.build().map_err(|e| e.to_string())?;

    // Position relative to primary monitor edge
    if let Ok(monitors) = window.available_monitors() {
        if let Some(monitor) = monitors.first() {
            let size = monitor.size();
            let scale = monitor.scale_factor();
            let screen_w = size.width as f64 / scale;
            let screen_h = size.height as f64 / scale;

            let win_x = if x_offset < 0.0 { screen_w + x_offset } else { x_offset };
            let win_y = if y_offset < 0.0 { screen_h + y_offset } else { y_offset };

            let _ = window.set_position(tauri::PhysicalPosition::new(
                (win_x * scale) as i32,
                (win_y * scale) as i32,
            ));
        }
    }

    let _ = window.show();

    log::info!("[ghost_mode] overlay window created at position '{}'", position);
    Ok(())
}

// ── Auto-reply ─────────────────────────────────────────────────────────────────

/// Simulate typing the reply into the active chat input.
/// Only types — does NOT send (user must press Enter to confirm).
/// For voice meetings: the response is shown on screen for reading aloud.
pub async fn auto_reply(app: &tauri::AppHandle, platform: &str, message: &str) -> Result<(), String> {
    use enigo::{Enigo, Keyboard, Settings};

    // For voice-only meetings, just ensure the overlay is visible with the response.
    match platform {
        "zoom" | "teams" | "meet" => {
            // Don't try to type into voice meeting apps — overlay already shows the text
            let _ = app.emit("ghost_suggestion_ready_to_speak", serde_json::json!({
                "message": message,
                "platform": platform
            }));
            return Ok(());
        }
        _ => {}
    }

    // For chat platforms (slack, discord, whatsapp): type into active input field.
    // Small guard: only proceed if ghost_auto_reply is enabled.
    let config = crate::config::load_config();
    if !config.ghost_auto_reply {
        return Ok(());
    }

    let mut enigo = Enigo::new(&Settings::default()).map_err(|e| format!("Enigo init: {}", e))?;

    // Type the message (user still needs to press Enter)
    enigo.text(message).map_err(|e| format!("Type error: {}", e))?;

    Ok(())
}

// ── Main Ghost Loop ────────────────────────────────────────────────────────────

/// Start Ghost Mode. Safe to call multiple times — no-ops if already running.
pub fn start_ghost_mode(app: tauri::AppHandle) {
    if GHOST_ACTIVE.swap(true, Ordering::SeqCst) {
        return; // already running
    }

    log::info!("[ghost_mode] starting");

    // Create overlay window immediately
    if let Err(e) = create_ghost_overlay(&app) {
        log::warn!("[ghost_mode] overlay creation failed: {}", e);
    }

    let state = Arc::new(Mutex::new(GhostState {
        position: crate::config::load_config().ghost_mode_position.clone(),
        ..Default::default()
    }));

    let app_clone = app.clone();
    tauri::async_runtime::spawn(async move {
        run_ghost_loop(app_clone, state).await;
        GHOST_ACTIVE.store(false, Ordering::SeqCst);
    });
}

/// Stop Ghost Mode.
pub fn stop_ghost_mode(app: &tauri::AppHandle) {
    if GHOST_ACTIVE.swap(false, Ordering::SeqCst) {
        log::info!("[ghost_mode] stopped");
    }
    // Hide (but don't destroy) the overlay
    if let Some(window) = app.get_webview_window("ghost_overlay") {
        let _ = window.hide();
    }
}

async fn run_ghost_loop(app: tauri::AppHandle, state: Arc<Mutex<GhostState>>) {
    let config = crate::config::load_config();
    let user_name = config.user_name.clone();
    let mut context_buffer: VecDeque<ConversationSegment> = VecDeque::new();

    // Start VAD capture — replaces 5s fixed chunks with real speech detection.
    // Pre-speech buffer (0.27s), noise gate, silence detection, min duration filter.
    let vad_config = crate::vad::VadConfig::default();
    let (speech_rx, stop_tx) = match crate::vad::start_vad_capture(vad_config) {
        Ok(pair) => pair,
        Err(e) => {
            log::warn!("[ghost_mode] VAD start failed: {e}");
            return;
        }
    };
    // stop_tx kept alive here — dropped when function returns, signals VAD thread to stop.

    // Platform polling: check every 10s whether we're in a meeting
    let mut last_platform_check = std::time::Instant::now();
    let mut current_platform = "none".to_string();

    loop {
        if !GHOST_ACTIVE.load(Ordering::SeqCst) {
            let _ = stop_tx.try_send(());
            break;
        }

        // Poll meeting platform every 10 seconds
        if last_platform_check.elapsed() > std::time::Duration::from_secs(10) {
            current_platform = detect_meeting_platform();
            last_platform_check = std::time::Instant::now();

            let now_secs = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs();

            if let Ok(mut s) = state.lock() {
                if current_platform == "none" {
                    if s.meeting_start_secs.is_some() {
                        s.meeting_start_secs = None;
                        s.current_speaker = None;
                        let _ = app.emit("ghost_meeting_ended", serde_json::json!({}));
                    }
                } else {
                    let is_new_meeting = s.platform != current_platform || s.meeting_start_secs.is_none();
                    if is_new_meeting {
                        s.meeting_start_secs = Some(now_secs);
                    }
                    s.platform = current_platform.clone();
                    let duration_secs = s.meeting_start_secs
                        .map(|start| now_secs.saturating_sub(start))
                        .unwrap_or(0);
                    let speaker_name = s.current_speaker.clone();
                    let _ = app.emit("ghost_meeting_state", &GhostMeetingState {
                        platform: current_platform.clone(),
                        meeting_name: platform_display_name(&current_platform),
                        speaker_name,
                        duration_secs,
                        listening: true,
                    });
                }
            }
        }

        // Wait for a VAD-detected speech segment (non-blocking poll with timeout)
        let segment = match speech_rx.recv_timeout(std::time::Duration::from_millis(500)) {
            Ok(seg) => seg,
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => continue,
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                log::warn!("[ghost_mode] VAD channel disconnected");
                break;
            }
        };

        // Transcribe: try Deepgram streaming first, fall back to Groq Whisper
        let transcript = match crate::deepgram::transcribe_with_fallback(
            &segment.wav,
            &segment.samples,
            segment.sample_rate,
        ).await {
            Some(t) => t,
            None => continue,
        };

        let text = transcript.text.trim().to_string();
        if text.is_empty() {
            continue;
        }

        // Speaker index: Deepgram diarization gives speaker tags (0-based).
        // Treat speaker 0 as "first speaker heard" — in a 1:1 meeting typically the other person.
        // Without diarization (Groq fallback), alternate 0/1 based on energy delta (existing heuristic).
        let speaker_idx = if let Some(spk) = transcript.speaker {
            spk as usize
        } else {
            // Fallback: use existing heuristic
            estimate_speaker(&segment.samples, segment.sample_rate, 0)
        };

        log::debug!("[ghost_mode] VAD+STT [speaker {}]: {}", speaker_idx, crate::safe_slice(&text, 60));

        // 6. Add to rolling context window
        let now_secs = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();

        context_buffer.push_back(ConversationSegment {
            timestamp: now_secs,
            text: text.clone(),
            speaker_idx,
        });

        // Prune segments older than CONTEXT_WINDOW_SECS
        while let Some(front) = context_buffer.front() {
            if now_secs.saturating_sub(front.timestamp) > CONTEXT_WINDOW_SECS {
                context_buffer.pop_front();
            } else {
                break;
            }
        }

        // Update participant speaking style and current speaker tracking
        {
            if let Ok(mut s) = state.lock() {
                if speaker_idx < s.participants.len() {
                    let p = &mut s.participants[speaker_idx];
                    if p.speaking_style.len() < 300 {
                        p.speaking_style.push_str(&format!(" | {}", crate::safe_slice(&text, 60)));
                    }
                    // Update current speaker name in state
                    let name = p.name.clone();
                    s.current_speaker = name.clone().or_else(|| Some(format!("Speaker {}", speaker_idx)));
                } else {
                    // New speaker discovered
                    while s.participants.len() <= speaker_idx {
                        s.participants.push(ConversationParticipant::default());
                    }
                    s.participants[speaker_idx].speaking_style = text.chars().take(60).collect();
                    s.current_speaker = Some(format!("Speaker {}", speaker_idx));
                }

                // Push updated meeting state to HUD with speaker info
                let duration_secs = s.meeting_start_secs
                    .map(|start| now_secs.saturating_sub(start))
                    .unwrap_or(0);
                let speaker_name = s.current_speaker.clone();
                let meeting_state = GhostMeetingState {
                    platform: s.platform.clone(),
                    meeting_name: platform_display_name(&s.platform),
                    speaker_name,
                    duration_secs,
                    listening: true,
                };
                let _ = app.emit("ghost_meeting_state", &meeting_state);
            }
        }

        // 7. Check if this segment is a question/prompt directed at the user.
        // With Deepgram diarization: speaker 0 = first voice detected (usually "them"),
        // speaker 1 = second voice (usually "you"). Without diarization: heuristic only.
        // We respond to ANY speaker asking a question (can't always tell who's "user").
        // TODO: let user calibrate which speaker index is "me" during setup.
        if speaker_idx == 1 && !user_name.is_empty() {
            continue;
        }

        if !is_question_or_prompt(&text, &user_name) {
            continue;
        }

        // 8. Build rolling context string for the LLM
        let context_str: String = context_buffer
            .iter()
            .map(|seg| {
                let label = if seg.speaker_idx == 0 {
                    "You".to_string()
                } else {
                    format!("Speaker {}", seg.speaker_idx)
                };
                format!("{}: {}", label, seg.text)
            })
            .collect::<Vec<_>>()
            .join("\n");

        // 9. Generate a response suggestion
        let question = text.clone();
        let ctx = context_str.clone();
        let platform = detect_active_platform();
        let platform_clone = platform.clone();
        let app_clone = app.clone();

        // Get participant info for this speaker
        let speaker_name: Option<String> = {
            if let Ok(s) = state.lock() {
                s.participants.get(speaker_idx).and_then(|p| p.name.clone())
            } else {
                None
            }
        };

        tauri::async_runtime::spawn(async move {
            match generate_ghost_response(&ctx, &question).await {
                Ok(response) => {
                    if response.is_empty() {
                        return;
                    }

                    let now_ms = std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap_or_default()
                        .as_millis() as u64;

                    let suggestion = GhostSuggestion {
                        response: response.clone(),
                        trigger: question.clone(),
                        speaker: speaker_name,
                        confidence: 0.85,
                        platform: platform_clone.clone(),
                        timestamp_ms: now_ms,
                    };

                    // Emit to main window and all overlays
                    let _ = app_clone.emit("ghost_suggestion", &suggestion);

                    // Push to HUD bar so it can show the response card
                    if let Some(hud) = app_clone.get_webview_window("blade_hud") {
                        let _ = hud.emit("ghost_suggestion", &suggestion);
                    }

                    // Show legacy ghost overlay if present
                    if let Some(overlay) = app_clone.get_webview_window("ghost_overlay") {
                        let _ = overlay.show();
                        let _ = overlay.set_focus();
                        let _ = overlay.emit("ghost_suggestion", &suggestion);
                    }

                    log::info!("[ghost_mode] suggestion generated for platform={}", platform_clone);
                }
                Err(e) => {
                    log::warn!("[ghost_mode] response generation failed: {}", e);
                }
            }
        });
    }

    log::info!("[ghost_mode] loop exited");
}

// ── Public helpers ─────────────────────────────────────────────────────────────

/// Public wrapper around detect_meeting_platform() used by overlay_manager.
/// Returns "zoom" | "teams" | "meet" | "discord" | "slack" | "whatsapp" | "none".
pub fn detect_active_platform() -> String {
    detect_meeting_platform()
}

/// Return a human-readable display name for a meeting platform identifier.
pub fn platform_display_name(platform: &str) -> String {
    match platform {
        "zoom"      => "Zoom Meeting",
        "teams"     => "Microsoft Teams",
        "meet"      => "Google Meet",
        "discord"   => "Discord",
        "slack"     => "Slack Huddle",
        "whatsapp"  => "WhatsApp",
        other       => other,
    }.to_string()
}

// ── Tauri Commands ─────────────────────────────────────────────────────────────

/// Start Ghost Mode listening and overlay.
#[tauri::command]
pub fn ghost_start(app: tauri::AppHandle) -> Result<(), String> {
    let config = crate::config::load_config();
    if !config.ghost_mode_enabled {
        // Auto-enable the feature when command is explicitly called
        let mut c = config;
        c.ghost_mode_enabled = true;
        crate::config::save_config(&c).ok();
    }
    start_ghost_mode(app);
    Ok(())
}

/// Stop Ghost Mode and hide the overlay.
#[tauri::command]
pub fn ghost_stop(app: tauri::AppHandle) -> Result<(), String> {
    stop_ghost_mode(&app);
    let mut config = crate::config::load_config();
    config.ghost_mode_enabled = false;
    crate::config::save_config(&config)?;
    Ok(())
}

/// Move the overlay to a new corner position.
/// Valid values: "bottom-right" | "bottom-left" | "top-right" | "top-left"
#[tauri::command]
pub fn ghost_set_position(app: tauri::AppHandle, position: String) -> Result<(), String> {
    let valid = ["bottom-right", "bottom-left", "top-right", "top-left"];
    if !valid.contains(&position.as_str()) {
        return Err(format!(
            "Invalid position '{}'. Valid: {}",
            position,
            valid.join(", ")
        ));
    }

    let mut config = crate::config::load_config();
    config.ghost_mode_position = position.clone();
    crate::config::save_config(&config)?;

    // Reposition the overlay window if it exists
    if let Some(window) = app.get_webview_window("ghost_overlay") {
        if let Ok(monitors) = window.available_monitors() {
            if let Some(monitor) = monitors.first() {
                let size = monitor.size();
                let scale = monitor.scale_factor();
                let screen_w = size.width as f64 / scale;
                let screen_h = size.height as f64 / scale;

                let (x_offset, y_offset): (f64, f64) = match position.as_str() {
                    "bottom-left"  => (20.0, -200.0),
                    "top-right"    => (-320.0, 20.0),
                    "top-left"     => (20.0, 20.0),
                    _              => (-320.0, -200.0),
                };

                let win_x = if x_offset < 0.0 { screen_w + x_offset } else { x_offset };
                let win_y = if y_offset < 0.0 { screen_h + y_offset } else { y_offset };

                let _ = window.set_position(tauri::PhysicalPosition::new(
                    (win_x * scale) as i32,
                    (win_y * scale) as i32,
                ));
            }
        }
    }

    Ok(())
}

/// Return current Ghost Mode status.
#[tauri::command]
pub fn ghost_get_status() -> GhostStatus {
    let config = crate::config::load_config();
    GhostStatus {
        active: GHOST_ACTIVE.load(Ordering::SeqCst),
        platform: detect_meeting_platform(),
        position: config.ghost_mode_position.clone(),
        participant_count: 0, // participants are held in local loop state
        context_segments: 0,
    }
}
