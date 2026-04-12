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
use tauri::Emitter;

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

    // Get the audio
    let audio_b64 = match crate::voice::voice_stop_recording() {
        Ok(a) => a,
        Err(e) => {
            log::warn!("[voice_global] stop_recording error: {}", e);
            let _ = app.emit("voice_global_error", e);
            return;
        }
    };

    // Transcribe via Groq Whisper
    let text = match crate::voice::voice_transcribe(audio_b64).await {
        Ok(t) => t,
        Err(e) => {
            log::warn!("[voice_global] transcription error: {}", e);
            let _ = app.emit("voice_global_error", e);
            return;
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
    log::info!("[voice_global] transcript: {}", &text[..text.len().min(80)]);
}

/// Returns whether global voice recording is active.
pub fn is_recording() -> bool {
    IS_RECORDING.load(Ordering::SeqCst)
}
