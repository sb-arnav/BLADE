use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::fs;

/// Local Whisper transcription fallback (D2)
/// Downloads model on first use, runs entirely offline via whisper-rs

const MODEL_DIR: &str = "models";
const MODEL_FILE: &str = "ggml-tiny.en.bin";
const MODEL_URL: &str = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin";

fn models_dir() -> PathBuf {
    let dir = crate::config::blade_config_dir().join(MODEL_DIR);
    fs::create_dir_all(&dir).ok();
    dir
}

fn model_path() -> PathBuf {
    models_dir().join(MODEL_FILE)
}

/// Check if the local Whisper model is available
#[tauri::command]
pub fn whisper_model_available() -> bool {
    model_path().exists()
}

/// Download the Whisper model (~75MB for tiny.en)
#[tauri::command]
pub async fn whisper_download_model(app: tauri::AppHandle) -> Result<String, String> {
    use tauri::Emitter;

    let path = model_path();
    if path.exists() {
        return Ok("Model already downloaded.".to_string());
    }

    let _ = app.emit("whisper_download_started", ());

    let client = reqwest::Client::new();
    let response = client
        .get(MODEL_URL)
        .send()
        .await
        .map_err(|e| format!("Download failed: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("Download failed: HTTP {}", response.status()));
    }

    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("Download error: {}", e))?;

    fs::write(&path, &bytes).map_err(|e| format!("Save error: {}", e))?;

    let _ = app.emit("whisper_download_complete", ());

    Ok(format!("Downloaded {} ({} MB)", MODEL_FILE, bytes.len() / 1_000_000))
}

/// Get model info
#[tauri::command]
pub fn whisper_model_info() -> WhisperModelInfo {
    let path = model_path();
    let exists = path.exists();
    let size = if exists {
        fs::metadata(&path).map(|m| m.len()).unwrap_or(0)
    } else {
        0
    };

    WhisperModelInfo {
        available: exists,
        model_name: MODEL_FILE.to_string(),
        size_mb: size / 1_000_000,
        path: path.to_string_lossy().to_string(),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WhisperModelInfo {
    pub available: bool,
    pub model_name: String,
    pub size_mb: u64,
    pub path: String,
}
