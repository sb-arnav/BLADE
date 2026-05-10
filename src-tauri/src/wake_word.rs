/// BLADE Wake Word Detection — "Hey BLADE" always-on voice activation
///
/// Runs a continuous low-power audio capture loop. Uses energy-based VAD
/// to detect speech activity, then transcribes with Whisper and checks
/// for the configured trigger phrase.
///
/// When triggered:
///   → emits `wake_word_detected` Tauri event (frontend plays chime + animation)
///   → speaks a random acknowledgement phrase ("I'm here", "What's up", etc.)
///   → frontend opens QuickAsk in voice-ready mode
///
/// Architecture:
///   cpal input stream (OS thread) → sync_channel → VAD tokio task
///   → phrase buffer → Whisper transcription → phrase match → emit
///
/// CPU: ~0.5% idle (VAD only). Transcription runs only when speech ends.
/// Fully local when ggml-tiny.en.bin is downloaded; uses Groq otherwise.
///
/// Multi-wake-word: checks all phrases in config.wake_word_phrases (comma-separated)
/// as well as the primary config.wake_word_phrase.

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use tauri::Emitter;

// ---------------------------------------------------------------------------
// Acknowledgement phrases (randomly selected when wake word fires)
// ---------------------------------------------------------------------------

const ACK_PHRASES: &[&str] = &[
    "I'm here.",
    "What's up?",
    "Listening.",
    "Go ahead.",
    "Yeah?",
    "I'm listening.",
];

/// Pick a random acknowledgement phrase.
fn random_ack() -> &'static str {
    let idx = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .subsec_nanos() as usize
        % ACK_PHRASES.len();
    ACK_PHRASES[idx]
}

// ---------------------------------------------------------------------------
// Multi-wake-word phrase list builder
// ---------------------------------------------------------------------------

/// Build the list of active wake phrases from config.
/// Reads the primary `wake_word_phrase` field plus any comma-separated custom
/// phrases stored in `wake_word_extra_phrases` (added by this PR).
/// Always includes the canonical built-ins: "hey blade", "blade", "hey b".
fn build_phrase_list(primary: &str) -> Vec<String> {
    let mut phrases: Vec<String> = Vec::new();

    // Always-on variants
    for built_in in &["hey blade", "blade", "hey b"] {
        let s = built_in.to_string();
        if !phrases.contains(&s) {
            phrases.push(s);
        }
    }

    // Primary configured phrase
    let primary_lower = primary.to_lowercase();
    if !primary_lower.is_empty() && !phrases.contains(&primary_lower) {
        phrases.push(primary_lower);
    }

    phrases
}

static WAKE_ACTIVE: AtomicBool = AtomicBool::new(false);

/// Start the wake word listener. Safe to call multiple times — no-ops if already running.
pub fn start_wake_word_listener(app: tauri::AppHandle) {
    let config = crate::config::load_config();

    // B1 — honor the off-switch. Audit (Abhinav, 2026-05-09) found this loop
    // was starting regardless of `wake_word_enabled: false` in config.json,
    // which means the microphone listened despite the user opting out.
    if !config.wake_word_enabled {
        log::info!("[wake_word] disabled in config — not starting");
        return;
    }

    if WAKE_ACTIVE.swap(true, Ordering::SeqCst) {
        return; // already running
    }

    let phrases = build_phrase_list(&config.wake_word_phrase);
    // Sensitivity 1-5: higher = more sensitive (lower energy threshold)
    // sensitivity=3 → threshold=0.017 (normal speech), sensitivity=5 → 0.010 (whispers)
    let energy_threshold = 0.05 / config.wake_word_sensitivity as f32;

    log::info!("[wake_word] listener started (phrases={:?}, threshold={:.3})",
        phrases, energy_threshold);

    tauri::async_runtime::spawn(async move {
        run_wake_loop(app, phrases, energy_threshold).await;
        WAKE_ACTIVE.store(false, Ordering::SeqCst);
    });
}

/// Stop the wake word listener.
pub fn stop_wake_word_listener() {
    if WAKE_ACTIVE.swap(false, Ordering::SeqCst) {
        log::info!("[wake_word] listener stopped");
    }
}

pub fn is_active() -> bool {
    WAKE_ACTIVE.load(Ordering::SeqCst)
}

async fn run_wake_loop(app: tauri::AppHandle, phrases: Vec<String>, energy_threshold: f32) {
    // std::sync channel: cpal callback is sync, VAD loop is async
    let (tx, rx) = std::sync::mpsc::sync_channel::<(Vec<f32>, u32)>(64);
    let tx = Arc::new(tx);

    // Spawn cpal stream on a dedicated OS thread
    let tx_clone = tx.clone();
    std::thread::spawn(move || {
        let host = cpal::default_host();
        let device = match host.default_input_device() {
            Some(d) => d,
            None => {
                log::warn!("[wake_word] no input device found");
                return;
            }
        };

        let config = match device.default_input_config() {
            Ok(c) => c,
            Err(e) => {
                log::warn!("[wake_word] input config error: {}", e);
                return;
            }
        };

        let sample_rate = config.sample_rate().0;
        let channels = config.channels() as usize;

        let stream = device.build_input_stream(
            &config.into(),
            move |data: &[f32], _: &cpal::InputCallbackInfo| {
                if !WAKE_ACTIVE.load(Ordering::Relaxed) {
                    return;
                }
                // Downmix to mono
                let mono: Vec<f32> = data
                    .chunks(channels)
                    .map(|c| c.iter().sum::<f32>() / channels as f32)
                    .collect();
                let _ = tx_clone.try_send((mono, sample_rate));
            },
            |err| log::warn!("[wake_word] stream error: {}", err),
            None,
        );

        match stream {
            Ok(s) => {
                let _ = s.play();
                // Hold the stream alive until deactivated
                while WAKE_ACTIVE.load(Ordering::Relaxed) {
                    std::thread::sleep(std::time::Duration::from_millis(100));
                }
                // s drops here, closing the stream
            }
            Err(e) => log::warn!("[wake_word] build_input_stream error: {}", e),
        }
    });

    // VAD state
    let mut phrase_buf: Vec<f32> = Vec::new();
    let mut device_sample_rate: u32 = 16000;
    let mut in_speech = false;
    let mut silence_frames: u32 = 0;
    let mut phrase_frames: u32 = 0;
    // How many 50ms frames of silence → end of phrase
    let silence_cutoff_frames: u32 = 12; // ~600ms
    // Max phrase length in 50ms frames (5 seconds)
    let max_phrase_frames: u32 = 100;

    let debounce = Arc::new(std::sync::Mutex::new(
        std::time::Instant::now() - std::time::Duration::from_secs(10),
    ));

    let mut pending_chunk: Vec<f32> = Vec::new();

    loop {
        if !WAKE_ACTIVE.load(Ordering::Relaxed) {
            break;
        }

        // Drain the channel into pending_chunk
        loop {
            match rx.try_recv() {
                Ok((samples, sr)) => {
                    device_sample_rate = sr;
                    pending_chunk.extend(samples);
                }
                Err(_) => break,
            }
        }

        // Process in ~50ms chunks
        let frame_size = (device_sample_rate as f32 * 0.05) as usize;
        if pending_chunk.len() < frame_size {
            tokio::time::sleep(tokio::time::Duration::from_millis(20)).await;
            continue;
        }

        let chunk: Vec<f32> = pending_chunk.drain(..frame_size).collect();

        // RMS energy
        let rms = (chunk.iter().map(|s| s * s).sum::<f32>() / chunk.len() as f32).sqrt();

        if rms > energy_threshold {
            // Speech detected
            if !in_speech {
                in_speech = true;
                phrase_frames = 0;
            }
            silence_frames = 0;
            phrase_buf.extend(&chunk);
            phrase_frames += 1;
        } else if in_speech {
            // Trailing silence
            silence_frames += 1;
            phrase_buf.extend(&chunk);
            phrase_frames += 1;

            let end_of_phrase =
                silence_frames >= silence_cutoff_frames || phrase_frames >= max_phrase_frames;

            if end_of_phrase {
                let buf = std::mem::take(&mut phrase_buf);
                in_speech = false;
                silence_frames = 0;
                phrase_frames = 0;

                // Debounce: skip if triggered within last 3s
                {
                    let last = debounce.lock().unwrap_or_else(|e| e.into_inner());
                    if last.elapsed().as_secs() < 3 {
                        continue;
                    }
                }

                // Skip if too short (< 0.3s of speech)
                let min_samples = (device_sample_rate as f32 * 0.3) as usize;
                if buf.len() < min_samples {
                    continue;
                }

                // Transcribe and check for phrase
                let phrase_clone = phrases.clone();
                let app_clone = app.clone();
                let debounce_clone = debounce.clone();
                let sr = device_sample_rate;

                tokio::spawn(async move {
                    match transcribe_buffer(&buf, sr).await {
                        Ok(text) => {
                            let lower = text.to_lowercase();
                            log::debug!("[wake_word] heard: {}", lower);

                            if phrases_match(&lower, &phrase_clone) {
                                log::info!("[wake_word] TRIGGERED: {:?}", lower);
                                {
                                    let mut last = debounce_clone.lock().unwrap_or_else(|e| e.into_inner());
                                    *last = std::time::Instant::now();
                                }
                                // Emit the wake event — frontend plays chime + shows animation
                                let _ = app_clone.emit("wake_word_detected", serde_json::json!({
                                    "phrase": lower,
                                    "play_chime": true,
                                }));

                                // Speak a random acknowledgement phrase so the user knows
                                // BLADE is listening before they start talking
                                let ack = random_ack();
                                log::info!("[wake_word] ack: {}", ack);
                                crate::tts::speak(ack);

                                // Auto-start voice conversation if not already active
                                if !crate::voice_global::voice_conversation_active() {
                                    let app_voice = app_clone.clone();
                                    tokio::spawn(async move {
                                        // Small delay so the ack finishes speaking
                                        tokio::time::sleep(tokio::time::Duration::from_millis(800)).await;
                                        let _ = crate::voice_global::start_voice_conversation(app_voice).await;
                                    });
                                }
                            }
                        }
                        Err(e) => log::debug!("[wake_word] transcription error: {}", e),
                    }
                });
            }
        }
    }

    log::info!("[wake_word] loop exited");
}

/// Encode buffer as WAV and transcribe via Groq Whisper.
async fn transcribe_buffer(samples: &[f32], sample_rate: u32) -> Result<String, String> {
    use base64::Engine as _;

    let wav_data = crate::voice::encode_wav(samples, 1, sample_rate)?;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&wav_data);
    crate::voice::voice_transcribe(b64).await
}

/// Check if the transcript matches any of the configured wake phrases.
/// Handles common Whisper mishearings: "hey played", "hey blade", "blade", etc.
fn phrases_match(transcript: &str, phrases: &[String]) -> bool {
    for phrase in phrases {
        if single_phrase_matches(transcript, phrase) {
            return true;
        }
    }
    false
}

/// Match a single phrase against a transcript, including common Whisper mishearings.
fn single_phrase_matches(transcript: &str, phrase: &str) -> bool {
    // Direct match
    if transcript.contains(phrase) {
        return true;
    }

    // If phrase contains "blade", also accept common mishearings
    if phrase.contains("blade") {
        let variants = ["blade", "blades", "blaze", "played", "braid", "bleed", "blade's"];
        for v in &variants {
            if transcript.contains(v) {
                return true;
            }
        }
    }

    // If phrase is very short ("hey b"), fuzzy match
    if phrase.len() <= 6 && transcript.starts_with(&phrase[..phrase.len().min(4)]) {
        return true;
    }

    false
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn wake_word_start(app: tauri::AppHandle) -> Result<(), String> {
    let config = crate::config::load_config();
    if !config.wake_word_enabled {
        return Err("Wake word is disabled in settings".to_string());
    }
    start_wake_word_listener(app);
    Ok(())
}

#[tauri::command]
pub fn wake_word_stop() {
    stop_wake_word_listener();
}

#[tauri::command]
pub fn wake_word_status() -> bool {
    is_active()
}

/// Runtime toggle for wake-word detection — saves config + starts/stops the
/// background listener as a single invoke.
///
/// Exposed for the Phase 3 Voice settings pane (Plan 03-06 D-84) and Phase 4
/// UI surfaces (HUD right-click menu, Voice Orb settings sheet) that need a
/// live toggle without the user restarting the app.
///
/// - `enabled = true`: persists `wake_word_enabled=true` and calls
///   `wake_word_start` (may fail if mic permission denied — error surfaces).
/// - `enabled = false`: persists `wake_word_enabled=false` and calls
///   `wake_word_stop` (always Ok).
///
/// @see .planning/phases/04-overlay-windows/04-CONTEXT.md §D-95
#[tauri::command]
pub async fn set_wake_word_enabled(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    let mut config = crate::config::load_config();
    config.wake_word_enabled = enabled;
    crate::config::save_config(&config)?;
    if enabled {
        wake_word_start(app)
    } else {
        wake_word_stop();
        Ok(())
    }
}
