/// voice_local — delegates to whisper_local for local Whisper.cpp inference.
/// Kept as a thin shim so the already-registered Tauri commands continue to work.

/// Check if the configured local Whisper model is downloaded.
#[tauri::command]
pub fn whisper_model_available() -> bool {
    crate::whisper_local::whisper_model_available()
}

/// Download the configured Whisper model (tiny.en by default, ~75 MB).
#[tauri::command]
pub async fn whisper_download_model(app: tauri::AppHandle) -> Result<String, String> {
    crate::whisper_local::whisper_download_model(app, None).await
}

/// Get info about the currently configured local Whisper model.
#[tauri::command]
pub fn whisper_model_info() -> crate::whisper_local::WhisperModelInfo {
    crate::whisper_local::whisper_model_info()
}
