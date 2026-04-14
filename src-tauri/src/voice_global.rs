/// BLADE Global Voice Input — Wispr Flow style.
///
/// Press the voice shortcut (default Ctrl+Shift+V) from anywhere:
///   First press  → starts mic recording, shows visual indicator
///   Second press → stops recording, transcribes via Groq Whisper,
///                  opens QuickAsk pre-filled with the text
///
/// The transcript is emitted as a `voice_transcript_ready` event with
/// payload `{ "text": "..." }` so the QuickAsk window can receive it.

use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{Emitter, Manager};

static IS_RECORDING: AtomicBool = AtomicBool::new(false);

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
