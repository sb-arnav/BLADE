/// BLADE Global Voice Input — push-to-talk + conversational voice mode.
///
/// Push-to-talk (existing):
///   Press the voice shortcut (default Ctrl+Shift+V) from anywhere:
///   First press  → starts mic recording, shows visual indicator
///   Second press → stops recording, transcribes via Groq Whisper,
///                  opens QuickAsk pre-filled with the text
///
/// Conversational mode (new — Phase 6):
///   start_voice_conversation() → enters continuous listening loop:
///     1. VAD detects speech start → records
///     2. VAD detects speech end → transcribes → sends to chat pipeline
///     3. Response arrives → TTS speaks it
///     4. Loop until 30s of silence OR user says stop/bye/that's all
///
/// Events emitted:
///   voice_conversation_listening  — idle, waiting for speech
///   voice_conversation_speaking   — TTS is playing the response
///   voice_conversation_thinking   — waiting for the AI response
///   voice_conversation_ended      — conversation mode exited
///
/// Enhancements (human-feel update):
///   - Full conversation history passed to every turn (context continuity)
///   - Filler detection: "um", "uh", "hmm" → waits longer before responding
///   - Interruption grace period: 500 ms wait before cutting TTS (avoids "uh-huh" kills)
///   - Session memory: summarised and stored in chat history when session ends

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use tauri::{Emitter, Manager};

static IS_RECORDING: AtomicBool = AtomicBool::new(false);

/// Set by the conversation loop to signal TTS should be interrupted
/// because the user has started speaking.
static TTS_INTERRUPT: AtomicBool = AtomicBool::new(false);

/// Whether the voice conversation mode is active.
static CONV_ACTIVE: AtomicBool = AtomicBool::new(false);

/// Timestamp (ms since epoch) when TTS interruption was first signalled.
/// Used to enforce the 500 ms grace period before actually cutting speech.
static TTS_INTERRUPT_AT: AtomicU64 = AtomicU64::new(0);

// ---------------------------------------------------------------------------
// Filler word detection
// ---------------------------------------------------------------------------

/// Returns true when the transcript is predominantly a filler — the user is
/// still gathering their thoughts and BLADE should wait before responding.
fn is_filler(text: &str) -> bool {
    let lower = text.trim().to_lowercase();
    // Pure fillers (whole-phrase match)
    let pure_fillers = ["um", "uh", "hmm", "hm", "er", "ah", "uhh", "umm"];
    if pure_fillers.iter().any(|f| lower == *f) {
        return true;
    }
    // Short phrase that's mostly filler
    let word_count = lower.split_whitespace().count();
    if word_count <= 3 {
        let filler_words = ["um", "uh", "hmm", "hm", "er", "ah", "well", "so"];
        let filler_count = lower.split_whitespace()
            .filter(|w| filler_words.contains(w))
            .count();
        if filler_count >= word_count.saturating_sub(1) {
            return true;
        }
    }
    false
}

// ---------------------------------------------------------------------------
// Back-channel word detection (don't cut TTS for these)
// ---------------------------------------------------------------------------

/// Returns true when the transcript is a back-channel acknowledgement:
/// the user is signalling they're listening, not actually interrupting.
fn is_back_channel(text: &str) -> bool {
    let lower = text.trim().to_lowercase();
    let back_channels = [
        "uh huh", "uh-huh", "mm hmm", "mm-hmm", "yeah", "yep", "ok", "okay",
        "right", "sure", "got it", "i see", "mhm", "mhmm", "yup", "cool",
    ];
    back_channels.iter().any(|b| lower == *b || lower == format!("{}.", b))
}

/// Returns true if a TTS interruption was requested by the conversation loop.
pub fn is_tts_interrupted() -> bool {
    TTS_INTERRUPT.load(Ordering::SeqCst)
}

/// Returns the timestamp (ms since epoch) when the interruption grace period started,
/// or 0 if no interruption is pending.
pub fn tts_interrupt_at() -> u64 {
    TTS_INTERRUPT_AT.load(Ordering::SeqCst)
}

// ---------------------------------------------------------------------------
// Push-to-talk (original)
// ---------------------------------------------------------------------------

/// Toggle global voice recording. Called from the global shortcut handler.
pub fn toggle_voice_input(app: &tauri::AppHandle) {
    if IS_RECORDING.load(Ordering::SeqCst) {
        // Stop recording and transcribe
        IS_RECORDING.store(false, Ordering::SeqCst);
        let app_clone = app.clone();
        tauri::async_runtime::spawn(async move {
            transcribe_and_emit(app_clone).await;
        });
    } else {
        // Start recording
        IS_RECORDING.store(true, Ordering::SeqCst);
        let _ = crate::voice::voice_start_recording();
        let _ = app.emit("voice_global_started", ());
    }
}

async fn transcribe_and_emit(app: tauri::AppHandle) {
    let _ = app.emit("voice_global_transcribing", ());

    // Get the audio (WAV bytes as base64)
    let audio_b64 = match crate::voice::voice_stop_recording() {
        Ok(a) => a,
        Err(e) => {
            log::warn!("[voice_global] stop_recording error: {}", e);
            let _ = app.emit("voice_global_error", e);
            return;
        }
    };

    let config = crate::config::load_config();

    // Route to local whisper.cpp or Groq API based on config
    let text = if config.use_local_whisper {
        use base64::Engine;
        let wav_bytes = match base64::engine::general_purpose::STANDARD.decode(&audio_b64) {
            Ok(b) => b,
            Err(e) => {
                let msg = format!("Audio decode error: {}", e);
                log::warn!("[voice_global] {}", msg);
                let _ = app.emit("voice_global_error", msg);
                return;
            }
        };
        // VAD gate: skip silent audio
        let samples = crate::voice::audio_bytes_to_f32_approx(&wav_bytes);
        if !crate::whisper_local::is_speech(&samples, crate::whisper_local::DEFAULT_VAD_THRESHOLD) {
            log::debug!("[voice_global] VAD: silence, skipping");
            let _ = app.emit("voice_global_error", "No speech detected");
            return;
        }
        match crate::whisper_local::transcribe_audio(&wav_bytes).await {
            Ok(t) => t,
            Err(e) => {
                log::warn!("[voice_global] local transcription error: {}", e);
                let _ = app.emit("voice_global_error", e);
                return;
            }
        }
    } else {
        // Transcribe via Groq Whisper API
        match crate::voice::voice_transcribe(audio_b64).await {
            Ok(t) => t,
            Err(e) => {
                log::warn!("[voice_global] transcription error: {}", e);
                let _ = app.emit("voice_global_error", e);
                return;
            }
        }
    };

    if text.trim().is_empty() {
        let _ = app.emit("voice_global_error", "No speech detected");
        return;
    }

    // Open QuickAsk pre-filled with the transcript
    if let Some(win) = app.get_webview_window("quickask") {
        let _ = win.center();
        let _ = win.show();
        let _ = win.set_focus();
    }

    let _ = app.emit("voice_transcript_ready", serde_json::json!({ "text": text }));
    log::info!("[voice_global] transcript: {}", crate::safe_slice(&text, 80));
}

/// Returns whether global voice recording is active.
#[allow(dead_code)]
pub fn is_recording() -> bool {
    IS_RECORDING.load(Ordering::SeqCst)
}

// ---------------------------------------------------------------------------
// Conversational Voice Mode (Phase 6)
// ---------------------------------------------------------------------------

const STOP_PHRASES: &[&str] = &[
    "stop",
    "bye",
    "goodbye",
    "that's all",
    "thats all",
    "exit",
    "quit",
    "end conversation",
    "stop listening",
];

/// Enter conversational voice mode. Continuously listens, transcribes, routes
/// through the chat pipeline, and speaks responses. Stays active until 30s of
/// silence or the user says one of the STOP_PHRASES.
///
/// This is a Tauri command so the frontend can call it via invoke().
#[tauri::command]
pub async fn start_voice_conversation(app: tauri::AppHandle) -> Result<(), String> {
    if CONV_ACTIVE.swap(true, Ordering::SeqCst) {
        return Err("Voice conversation already active".to_string());
    }
    TTS_INTERRUPT.store(false, Ordering::SeqCst);

    log::info!("[voice_conv] starting conversational mode");
    let _ = app.emit("voice_conversation_listening", serde_json::json!({ "active": true }));

    let result = run_conversation_loop(app.clone()).await;

    // If CONV_ACTIVE was set to false by the mic-init thread (no device),
    // map a successful-but-empty result into a meaningful error.
    let result = if result.is_ok() && !CONV_ACTIVE.swap(false, Ordering::SeqCst) {
        // CONV_ACTIVE was already false — mic thread killed it
        Err("No microphone available. Connect a mic and try again.".to_string())
    } else {
        CONV_ACTIVE.store(false, Ordering::SeqCst);
        result
    };

    TTS_INTERRUPT.store(false, Ordering::SeqCst);
    let reason = if result.is_err() { "no_mic" } else { "stopped" };
    let _ = app.emit("voice_conversation_ended", serde_json::json!({ "reason": reason }));
    log::info!("[voice_conv] conversation ended: {}", reason);
    result
}

/// Stop the voice conversation loop. Can be called from frontend or programmatically.
#[tauri::command]
pub fn stop_voice_conversation() {
    if CONV_ACTIVE.swap(false, Ordering::SeqCst) {
        log::info!("[voice_conv] stop requested");
    }
}

/// Returns whether the voice conversation is currently active.
#[tauri::command]
pub fn voice_conversation_active() -> bool {
    CONV_ACTIVE.load(Ordering::SeqCst)
}

// ---------------------------------------------------------------------------
// Internal conversation loop
// ---------------------------------------------------------------------------

async fn run_conversation_loop(app: tauri::AppHandle) -> Result<(), String> {
    // Conversation history: alternating user / assistant turns, accumulated
    // across the entire session so every AI call has full context.
    let mut conv_history: Vec<crate::providers::ConversationMessage> = Vec::new();

    // Track voice intelligence session
    let session_id = crate::voice_intelligence::start_voice_session();

    // Use a sync_channel to bridge the cpal OS thread → async VAD loop.
    // This mirrors the wake_word.rs pattern exactly.
    let (tx, rx) = std::sync::mpsc::sync_channel::<(Vec<f32>, u32)>(128);

    // Spawn cpal stream on a dedicated OS thread (Stream is not Send on some platforms)
    let tx_clone = tx.clone();
    std::thread::spawn(move || {
        use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};

        let host = cpal::default_host();
        let device = match host.default_input_device() {
            Some(d) => d,
            None => {
                log::warn!("[voice_conv] no input device — voice conversation unavailable");
                // Signal the async loop to exit by setting CONV_ACTIVE = false
                CONV_ACTIVE.store(false, Ordering::SeqCst);
                return;
            }
        };
        let cpal_config = match device.default_input_config() {
            Ok(c) => c,
            Err(e) => {
                log::warn!("[voice_conv] mic config error: {} — voice conversation unavailable", e);
                CONV_ACTIVE.store(false, Ordering::SeqCst);
                return;
            }
        };

        let sample_rate = cpal_config.sample_rate().0;
        let channels = cpal_config.channels() as usize;

        let stream = device.build_input_stream(
            &cpal_config.into(),
            move |data: &[f32], _: &cpal::InputCallbackInfo| {
                if !CONV_ACTIVE.load(Ordering::Relaxed) {
                    return;
                }
                let mono: Vec<f32> = data
                    .chunks(channels)
                    .map(|c| c.iter().sum::<f32>() / channels as f32)
                    .collect();
                let _ = tx_clone.try_send((mono, sample_rate));
            },
            |err| log::warn!("[voice_conv] stream error: {}", err),
            None,
        );

        match stream {
            Ok(s) => {
                let _ = s.play();
                while CONV_ACTIVE.load(Ordering::Relaxed) {
                    std::thread::sleep(std::time::Duration::from_millis(50));
                }
                // s drops here, releasing the mic
            }
            Err(e) => log::warn!("[voice_conv] build_input_stream error: {}", e),
        }
    });

    // We need the sample_rate from the device; read first frame to discover it.
    // Default to 44100 until we get real data.
    let mut device_sample_rate: u32 = 44100;
    drop(tx); // we only need the rx side in the async loop

    // VAD parameters — similar to wake_word.rs
    let speech_threshold: f32 = 0.02;
    let silence_threshold: f32 = 0.012;
    let silence_end_frames: u32 = 20;   // ~1000ms silence → end of utterance
    let max_utterance_frames: u32 = 400; // ~20s max utterance

    let mut in_speech = false;
    let mut silence_frames: u32 = 0;
    let mut phrase_frames: u32 = 0;
    let mut speech_buf: Vec<f32> = Vec::new();
    let mut total_silence_frames: u32 = 0;
    // 30s of silence (at 50ms/frame = 600 frames) → exit conversation
    let exit_silence_frames: u32 = 600;

    let mut pending: Vec<f32> = Vec::new();

    'outer: loop {
        if !CONV_ACTIVE.load(Ordering::Relaxed) {
            break;
        }

        // Drain the channel into pending
        loop {
            match rx.try_recv() {
                Ok((samples, sr)) => {
                    device_sample_rate = sr;
                    pending.extend(samples);
                }
                Err(_) => break,
            }
        }

        let frame_size = (device_sample_rate as f32 * 0.05) as usize; // 50ms frames
        if pending.len() < frame_size {
            tokio::time::sleep(tokio::time::Duration::from_millis(20)).await;
            continue;
        }

        // Process frames
        while pending.len() >= frame_size {
            if !CONV_ACTIVE.load(Ordering::Relaxed) {
                break 'outer;
            }

            let frame: Vec<f32> = pending.drain(..frame_size).collect();
            let rms = rms_energy(&frame);

            if !in_speech {
                if rms > speech_threshold {
                    in_speech = true;
                    silence_frames = 0;
                    phrase_frames = 0;
                    speech_buf.clear();
                    speech_buf.extend_from_slice(&frame);
                    total_silence_frames = 0;

                    // If TTS was playing, start the interruption grace-period timer.
                    // The actual interrupt fires in speak_and_wait once 500 ms elapses.
                    if crate::tts::is_speaking() {
                        let now_ms = std::time::SystemTime::now()
                            .duration_since(std::time::UNIX_EPOCH)
                            .unwrap_or_default()
                            .as_millis() as u64;
                        TTS_INTERRUPT_AT.store(now_ms, Ordering::SeqCst);
                        // Don't set TTS_INTERRUPT yet — speak_and_wait polls it
                        log::info!("[voice_conv] user started speaking — grace-period started");
                    }
                } else {
                    total_silence_frames += 1;
                    if total_silence_frames >= exit_silence_frames {
                        log::info!("[voice_conv] 30s silence — exiting conversation");
                        break 'outer;
                    }
                }
            } else {
                speech_buf.extend_from_slice(&frame);
                phrase_frames += 1;

                if rms < silence_threshold {
                    silence_frames += 1;
                } else {
                    silence_frames = 0;
                }

                let end_of_utterance =
                    silence_frames >= silence_end_frames || phrase_frames >= max_utterance_frames;

                if end_of_utterance {
                    in_speech = false;
                    silence_frames = 0;
                    phrase_frames = 0;

                    // Check minimum speech length (~0.3s)
                    let min_samples = (device_sample_rate as f32 * 0.3) as usize;
                    if speech_buf.len() < min_samples {
                        speech_buf.clear();
                        continue;
                    }

                    let buf = std::mem::take(&mut speech_buf);
                    let transcription = transcribe_samples(&buf, device_sample_rate).await;

                    match transcription {
                        Ok(text) if !text.trim().is_empty() => {
                            let trimmed = text.trim().to_string();
                            log::info!("[voice_conv] heard: {}", crate::safe_slice(&trimmed, 80));

                            // Reset any pending interrupt signal now that TTS is done / we
                            // are in the processing phase.
                            TTS_INTERRUPT_AT.store(0, Ordering::SeqCst);
                            TTS_INTERRUPT.store(false, Ordering::SeqCst);

                            // Filler detection: if the user is still thinking, skip this
                            // turn and wait for them to form a real utterance.
                            if is_filler(&trimmed) {
                                log::info!("[voice_conv] filler detected ('{}') — waiting", crate::safe_slice(&trimmed, 20));
                                // Extra wait: give the user 1.5 s to continue speaking
                                tokio::time::sleep(tokio::time::Duration::from_millis(1500)).await;
                                continue;
                            }

                            // Back-channel check: if TTS was playing and this is just
                            // acknowledgement, don't process it as a new turn.
                            if is_back_channel(&trimmed) {
                                log::info!("[voice_conv] back-channel ('{}') — ignoring", crate::safe_slice(&trimmed, 20));
                                continue;
                            }

                            // Check for stop phrases
                            let lower = trimmed.to_lowercase();
                            let is_stop = STOP_PHRASES.iter().any(|p| lower.contains(p));

                            if is_stop {
                                log::info!("[voice_conv] stop phrase detected");
                                break 'outer;
                            }

                            // Analyze emotion in background (non-blocking; best-effort)
                            let emotion = crate::voice_intelligence::analyze_voice_emotion(
                                &trimmed, ""
                            ).await;
                            crate::voice_intelligence::add_segment(
                                &session_id, &trimmed, &emotion, 0.8
                            );

                            // Emit emotion to frontend so the orb can adapt
                            let _ = app.emit("voice_emotion_detected", serde_json::json!({
                                "emotion": &emotion,
                                "transcript": crate::safe_slice(&trimmed, 100),
                            }));

                            // Update UserModel mood from detected voice emotion
                            update_mood_from_voice_emotion(&emotion);

                            // Language detection (non-English auto-respond in same language)
                            let (lang, is_foreign) = crate::voice_intelligence::detect_non_english(&trimmed).await;
                            if is_foreign {
                                log::info!("[voice_conv] non-English detected: {}", lang);
                                let _ = app.emit("voice_language_detected", serde_json::json!({
                                    "language": &lang,
                                }));
                            }

                            // Check cancel before the (potentially slow) AI call
                            if !CONV_ACTIVE.load(Ordering::Relaxed) {
                                break 'outer;
                            }

                            // Append user turn to conversation history
                            conv_history.push(crate::providers::ConversationMessage::User(trimmed.clone()));

                            // Process through chat pipeline with full history
                            let response = process_voice_turn_with_history(
                                &app, &trimmed, &conv_history, &emotion, &lang
                            ).await;

                            // Check cancel again after AI returns — user may have hit stop
                            if !CONV_ACTIVE.load(Ordering::Relaxed) {
                                break 'outer;
                            }
                            match response {
                                Ok(reply) if !reply.trim().is_empty() => {
                                    log::info!("[voice_conv] speaking reply ({} chars)", reply.len());
                                    // Append assistant reply to history for next turn
                                    conv_history.push(crate::providers::ConversationMessage::Assistant {
                                        content: reply.clone(),
                                        tool_calls: vec![],
                                    });

                                    TTS_INTERRUPT.store(false, Ordering::SeqCst);
                                    TTS_INTERRUPT_AT.store(0, Ordering::SeqCst);
                                    let _ = app.emit("voice_conversation_speaking", serde_json::json!({ "text": &reply }));
                                    let _ = crate::tts::speak_and_wait(&app, &reply).await;
                                    TTS_INTERRUPT.store(false, Ordering::SeqCst);
                                    TTS_INTERRUPT_AT.store(0, Ordering::SeqCst);
                                    // Only re-enter listening state if still active
                                    if CONV_ACTIVE.load(Ordering::Relaxed) {
                                        let _ = app.emit("voice_conversation_listening", serde_json::json!({ "active": true }));
                                    }
                                }
                                Ok(_) => {}
                                Err(e) => {
                                    log::warn!("[voice_conv] pipeline error: {}", e);
                                }
                            }
                        }
                        Ok(_) => {} // empty transcription
                        Err(e) => {
                            log::warn!("[voice_conv] transcription error: {}", e);
                        }
                    }
                }
            }
        }

        // Small yield to avoid spinning
    }

    // End voice intelligence session
    if let Some(session) = crate::voice_intelligence::end_voice_session(&session_id) {
        // Persist the voice session as a chat history entry if it had any turns
        if !session.segments.is_empty() {
            save_voice_session_to_history(&app, &session, &conv_history).await;
        }
    }

    // CONV_ACTIVE is already false (set by stop_voice_conversation or break 'outer).
    // The cpal OS thread checks CONV_ACTIVE and will exit, releasing the mic.
    Ok(())
}

/// Update the UserModel mood field from a detected voice emotion.
/// This is a best-effort fire-and-forget; failures are silently ignored.
fn update_mood_from_voice_emotion(emotion: &str) {
    // Map voice emotion → mood string used by persona_engine
    let mood = match emotion {
        "excited"    => "energetic",
        "frustrated" => "frustrated",
        "tired"      => "tired",
        "focused"    => "focused",
        "casual"     => "relaxed",
        _            => return, // "neutral" — no update needed
    };
    // Write directly to the typed_memory "mood" preference so persona_engine picks it up
    let fact = format!("User mood from voice: {}", mood);
    let _ = crate::typed_memory::store_typed_memory(
        crate::typed_memory::MemoryCategory::Preference,
        &fact,
        "voice_mood",
        Some(0.8),
    );
}

/// Summarize and store the completed voice session in chat history.
async fn save_voice_session_to_history(
    app: &tauri::AppHandle,
    session: &crate::voice_intelligence::VoiceSession,
    conv_history: &[crate::providers::ConversationMessage],
) {
    if conv_history.len() < 2 {
        return;
    }

    let turn_count = conv_history.len();
    let conversation_id = format!("voice-{}", session.session_id);
    let started_at = session.started_at;
    let conv_id_clone = conversation_id.clone();

    // Build a compact turn list: only user + assistant (skip system)
    let turns_data: Vec<(String, String, i64)> = conv_history.iter().enumerate().filter_map(|(i, msg)| {
        match msg {
            crate::providers::ConversationMessage::User(t) =>
                Some(("user".to_string(), t.clone(), started_at * 1000 + i as i64 * 2000)),
            crate::providers::ConversationMessage::Assistant { content, .. } =>
                Some(("assistant".to_string(), content.clone(), started_at * 1000 + i as i64 * 2000)),
            _ => None,
        }
    }).collect();

    let _ = tauri::async_runtime::spawn_blocking(move || {
        let db_path = crate::config::blade_config_dir().join("blade.db");
        let conn = match rusqlite::Connection::open(&db_path) {
            Ok(c) => c,
            Err(_) => return,
        };
        // Ensure tables exist
        let _ = conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS conversations (
                id TEXT PRIMARY KEY,
                title TEXT,
                created_at INTEGER,
                updated_at INTEGER,
                message_count INTEGER DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS messages (
                id TEXT PRIMARY KEY,
                conversation_id TEXT NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                timestamp INTEGER NOT NULL
            );"
        );
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as i64;
        let title = format!("Voice session — {} turns", turns_data.len());
        let _ = conn.execute(
            "INSERT OR IGNORE INTO conversations (id, title, created_at, updated_at, message_count)
             VALUES (?1, ?2, ?3, ?3, ?4)",
            rusqlite::params![conv_id_clone, title, now, turns_data.len() as i64],
        );
        for (i, (role, content, ts)) in turns_data.iter().enumerate() {
            let msg_id = format!("{}-msg-{}", conv_id_clone, i);
            let _ = conn.execute(
                "INSERT OR IGNORE INTO messages (id, conversation_id, role, content, timestamp)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                rusqlite::params![msg_id, conv_id_clone, role, content, ts],
            );
        }
    }).await;

    let _ = app.emit("voice_session_saved", serde_json::json!({
        "conversation_id": conversation_id,
        "turn_count": turn_count,
    }));
}

/// Transcribe a buffer of f32 mono samples at `sample_rate` Hz.
async fn transcribe_samples(samples: &[f32], sample_rate: u32) -> Result<String, String> {
    let wav_data = crate::voice::encode_wav(samples, 1, sample_rate)?;
    let config = crate::config::load_config();

    if config.use_local_whisper {
        crate::whisper_local::transcribe_audio(&wav_data).await
    } else {
        use base64::Engine as _;
        let b64 = base64::engine::general_purpose::STANDARD.encode(&wav_data);
        crate::voice::voice_transcribe(b64).await
    }
}

/// Route the transcribed user text through the chat pipeline and return the reply.
/// Passes the full conversation history for context continuity.
/// Emits `voice_conversation_thinking` while waiting.
async fn process_voice_turn_with_history(
    app: &tauri::AppHandle,
    user_text: &str,
    conv_history: &[crate::providers::ConversationMessage],
    emotion: &str,
    lang: &str,
) -> Result<String, String> {
    let _ = app.emit("voice_conversation_thinking", serde_json::json!({ "text": user_text }));

    let config = crate::config::load_config();
    let (provider, api_key, model) = crate::config::resolve_provider_for_task(
        &config,
        &crate::router::TaskType::Simple,
    );

    // Build voice system prompt, enhanced with emotion context
    let mut system_prompt = crate::brain::build_system_prompt_voice(app).await;

    // Inject emotion hint so the LLM can adapt tone
    match emotion {
        "frustrated" => system_prompt.push_str(
            " The user sounds frustrated — respond with extra empathy, keep it short and clear.",
        ),
        "excited" => system_prompt.push_str(
            " The user sounds excited — match their energy and keep the reply punchy.",
        ),
        "tired" => system_prompt.push_str(
            " The user sounds tired — be gentle, slow down, use short sentences.",
        ),
        "focused" => system_prompt.push_str(
            " The user is focused — be direct, no filler, answer the question.",
        ),
        _ => {}
    }

    // Language instruction: if user spoke a non-English language, respond in kind
    if lang != "en" {
        system_prompt.push_str(&format!(
            " IMPORTANT: The user spoke in language code '{}'. \
              Respond entirely in that same language.",
            lang
        ));
    }

    // Assemble messages: system + full prior history (already includes the new user turn)
    let mut messages: Vec<crate::providers::ConversationMessage> = Vec::new();
    messages.push(crate::providers::ConversationMessage::System(system_prompt));

    // Add conversation history (the new user turn is already the last item)
    for msg in conv_history {
        messages.push(msg.clone());
    }

    let no_tools: Vec<crate::providers::ToolDefinition> = vec![];

    match crate::providers::complete_turn(
        &provider,
        &api_key,
        &model,
        &messages,
        &no_tools,
        config.base_url.as_deref(),
    )
    .await
    {
        Ok(turn) => Ok(turn.content),
        Err(e) => Err(format!("Chat error: {}", e)),
    }
}

fn rms_energy(samples: &[f32]) -> f32 {
    if samples.is_empty() {
        return 0.0;
    }
    let sum_sq: f32 = samples.iter().map(|s| s * s).sum();
    (sum_sq / samples.len() as f32).sqrt()
}
