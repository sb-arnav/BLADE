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

use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{Emitter, Manager};

static IS_RECORDING: AtomicBool = AtomicBool::new(false);

/// Set by the conversation loop to signal TTS should be interrupted
/// because the user has started speaking.
static TTS_INTERRUPT: AtomicBool = AtomicBool::new(false);

/// Whether the voice conversation mode is active.
static CONV_ACTIVE: AtomicBool = AtomicBool::new(false);

/// Returns true if a TTS interruption was requested by the conversation loop.
pub fn is_tts_interrupted() -> bool {
    TTS_INTERRUPT.load(Ordering::SeqCst)
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

    CONV_ACTIVE.store(false, Ordering::SeqCst);
    TTS_INTERRUPT.store(false, Ordering::SeqCst);
    let _ = app.emit("voice_conversation_ended", serde_json::json!({ "reason": "stopped" }));
    log::info!("[voice_conv] conversation ended");
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
            None => { log::warn!("[voice_conv] no input device"); return; }
        };
        let cpal_config = match device.default_input_config() {
            Ok(c) => c,
            Err(e) => { log::warn!("[voice_conv] mic config error: {}", e); return; }
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

                    // If TTS was playing, interrupt it
                    if crate::tts::is_speaking() {
                        TTS_INTERRUPT.store(true, Ordering::SeqCst);
                        log::info!("[voice_conv] user started speaking — interrupting TTS");
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

                            // Check for stop phrases
                            let lower = trimmed.to_lowercase();
                            let is_stop = STOP_PHRASES.iter().any(|p| lower.contains(p));

                            if is_stop {
                                log::info!("[voice_conv] stop phrase detected");
                                break 'outer;
                            }

                            // Process through chat pipeline
                            let response = process_voice_turn(&app, &trimmed).await;
                            match response {
                                Ok(reply) if !reply.trim().is_empty() => {
                                    log::info!("[voice_conv] speaking reply ({} chars)", reply.len());
                                    TTS_INTERRUPT.store(false, Ordering::SeqCst);
                                    let _ = app.emit("voice_conversation_speaking", serde_json::json!({ "text": &reply }));
                                    let _ = crate::tts::speak_and_wait(&app, &reply).await;
                                    TTS_INTERRUPT.store(false, Ordering::SeqCst);
                                    let _ = app.emit("voice_conversation_listening", serde_json::json!({ "active": true }));
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

    // CONV_ACTIVE is already false (set by stop_voice_conversation or break 'outer).
    // The cpal OS thread checks CONV_ACTIVE and will exit, releasing the mic.
    Ok(())
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
/// Emits `voice_conversation_thinking` while waiting.
async fn process_voice_turn(app: &tauri::AppHandle, user_text: &str) -> Result<String, String> {
    let _ = app.emit("voice_conversation_thinking", serde_json::json!({ "text": user_text }));

    let config = crate::config::load_config();
    let (provider, api_key, model) = crate::config::resolve_provider_for_task(
        &config,
        &crate::router::TaskType::Simple,
    );

    // Build a minimal system prompt
    let system_prompt = crate::brain::build_system_prompt_voice(app).await;

    let messages = vec![
        crate::providers::ConversationMessage::System(system_prompt),
        crate::providers::ConversationMessage::User(user_text.to_string()),
    ];

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
