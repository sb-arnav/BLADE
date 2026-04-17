#![allow(dead_code)]

/// Local Whisper transcription via whisper-rs (whisper.cpp bindings)
///
/// Downloads the model on first use to ~/.config/blade/models/ (or platform equivalent).
/// Supports tiny.en, base.en, and small.en model variants.
/// Includes simple energy-based VAD to skip silent audio chunks before transcription.

use base64::Engine;
use std::fs;
use std::path::PathBuf;

// --- Model definitions -------------------------------------------------------

struct ModelDef {
    name: &'static str,
    file: &'static str,
    url: &'static str,
}

const MODELS: &[ModelDef] = &[
    ModelDef {
        name: "tiny.en",
        file: "ggml-tiny.en.bin",
        url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin",
    },
    ModelDef {
        name: "base.en",
        file: "ggml-base.en.bin",
        url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin",
    },
    ModelDef {
        name: "small.en",
        file: "ggml-small.en.bin",
        url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin",
    },
    // Multilingual variants
    ModelDef {
        name: "tiny",
        file: "ggml-tiny.bin",
        url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin",
    },
    ModelDef {
        name: "base",
        file: "ggml-base.bin",
        url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin",
    },
    ModelDef {
        name: "small",
        file: "ggml-small.bin",
        url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin",
    },
];

fn find_model(name: &str) -> Option<&'static ModelDef> {
    MODELS.iter().find(|m| m.name == name)
}

// --- Paths -------------------------------------------------------------------

fn models_dir() -> PathBuf {
    let dir = crate::config::blade_config_dir().join("models");
    fs::create_dir_all(&dir).ok();
    dir
}

fn model_path_for(model_name: &str) -> PathBuf {
    let def = find_model(model_name).unwrap_or(&MODELS[0]);
    models_dir().join(def.file)
}

// --- VAD: energy-based silence detection ------------------------------------

/// Compute RMS energy of a f32 PCM buffer.
/// Returns a value in [0.0, 1.0] approximately (can exceed 1.0 for clipped audio).
fn rms_energy(samples: &[f32]) -> f32 {
    if samples.is_empty() {
        return 0.0;
    }
    let sum_sq: f32 = samples.iter().map(|s| s * s).sum();
    (sum_sq / samples.len() as f32).sqrt()
}

/// Returns true if the audio chunk contains speech (energy above threshold).
/// Threshold ~0.01 filters out near-silence; real speech is typically 0.05+.
pub fn is_speech(samples: &[f32], threshold: f32) -> bool {
    rms_energy(samples) >= threshold
}

/// Default RMS silence threshold (configurable in future).
pub const DEFAULT_VAD_THRESHOLD: f32 = 0.01;

// --- WAV parsing for f32 PCM ------------------------------------------------

/// Parse a WAV file's PCM samples as f32 mono at 16 kHz.
/// whisper.cpp requires 16 kHz mono f32 PCM input.
/// Returns (samples_f32, sample_rate).
fn parse_wav_to_f32(wav_bytes: &[u8]) -> Result<(Vec<f32>, u32), String> {
    use std::io::Cursor;
    let cursor = Cursor::new(wav_bytes);
    let mut reader = hound::WavReader::new(cursor).map_err(|e| format!("WAV parse error: {}", e))?;

    let spec = reader.spec();
    let sample_rate = spec.sample_rate;
    let channels = spec.channels as usize;
    let bits = spec.bits_per_sample;
    let fmt = spec.sample_format;

    // Read all samples and convert to f32
    let raw_f32: Vec<f32> = match (fmt, bits) {
        (hound::SampleFormat::Float, 32) => {
            reader
                .samples::<f32>()
                .map(|s| s.map_err(|e| e.to_string()))
                .collect::<Result<Vec<_>, _>>()?
        }
        (hound::SampleFormat::Int, 16) => {
            reader
                .samples::<i16>()
                .map(|s| s.map(|v| v as f32 / 32768.0).map_err(|e| e.to_string()))
                .collect::<Result<Vec<_>, _>>()?
        }
        (hound::SampleFormat::Int, 32) => {
            reader
                .samples::<i32>()
                .map(|s| s.map(|v| v as f32 / 2_147_483_648.0).map_err(|e| e.to_string()))
                .collect::<Result<Vec<_>, _>>()?
        }
        (hound::SampleFormat::Int, 8) => {
            // hound's Sample impl for i8 already converts unsigned WAV 8-bit
            // (0-255) to signed i8 (-128..127) via signed_from_u8 (subtracts 128).
            // So v=0 → -128 (min), v_raw=128 → 0 (silence), v_raw=255 → 127 (max).
            // Dividing by 128.0 gives the correct [-1.0, ~1.0) float range.
            reader
                .samples::<i8>()
                .map(|s| s.map(|v| v as f32 / 128.0).map_err(|e| e.to_string()))
                .collect::<Result<Vec<_>, _>>()?
        }
        _ => return Err(format!("Unsupported WAV format: {:?} {}bit", fmt, bits)),
    };

    // Mix down to mono
    let mono: Vec<f32> = if channels == 1 {
        raw_f32
    } else {
        raw_f32
            .chunks(channels)
            .map(|ch| ch.iter().sum::<f32>() / channels as f32)
            .collect()
    };

    // Resample to 16 kHz if needed (simple linear interpolation)
    let samples = if sample_rate == 16000 {
        mono
    } else {
        resample_to_16k(&mono, sample_rate)
    };

    Ok((samples, 16000))
}

/// Naive linear resampler to 16 kHz.
fn resample_to_16k(input: &[f32], from_rate: u32) -> Vec<f32> {
    if from_rate == 16000 || input.is_empty() {
        return input.to_vec();
    }
    let ratio = from_rate as f64 / 16000.0;
    let out_len = (input.len() as f64 / ratio).round() as usize;
    let mut output = Vec::with_capacity(out_len);
    for i in 0..out_len {
        let src_pos = i as f64 * ratio;
        let idx = src_pos as usize;
        let frac = (src_pos - idx as f64) as f32;
        let s0 = input.get(idx).copied().unwrap_or(0.0);
        let s1 = input.get(idx + 1).copied().unwrap_or(s0);
        output.push(s0 + frac * (s1 - s0));
    }
    output
}

// --- Download ----------------------------------------------------------------

/// Download a model by name if not already present.
/// Returns the path to the model file.
async fn ensure_model_downloaded(model_name: &str) -> Result<PathBuf, String> {
    let def = find_model(model_name)
        .ok_or_else(|| format!("Unknown model '{}'. Valid: tiny.en, base.en, small.en, tiny, base, small", model_name))?;

    let path = models_dir().join(def.file);
    if path.exists() {
        return Ok(path);
    }

    log::info!("[whisper_local] Downloading model {} from {}", def.name, def.url);

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(600)) // 10 min — small model is ~75 MB
        .build()
        .map_err(|e| e.to_string())?;

    let response = client
        .get(def.url)
        .send()
        .await
        .map_err(|e| format!("Download failed: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("Download failed: HTTP {}", response.status()));
    }

    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("Download read error: {}", e))?;

    fs::write(&path, &bytes).map_err(|e| format!("Save error: {}", e))?;
    log::info!("[whisper_local] Model saved to {:?} ({} MB)", path, bytes.len() / 1_000_000);

    Ok(path)
}

// --- Core transcription ------------------------------------------------------

/// Transcribe WAV audio bytes using local whisper.cpp via whisper-rs.
///
/// - `wav_bytes`: raw WAV file bytes (any sample rate, mono or stereo)
/// - Returns the transcribed text or an error string.
///
/// VAD gate: if RMS energy is below DEFAULT_VAD_THRESHOLD, returns empty string
/// immediately without loading the model. This avoids pointless inference on silence.
pub async fn transcribe_audio(wav_bytes: &[u8]) -> Result<String, String> {
    let config = crate::config::load_config();
    let model_name = config.whisper_model.clone();
    transcribe_audio_with_model(wav_bytes, &model_name).await
}

/// Transcribe with an explicit model name. Useful for callers that already have
/// the model name without loading config again.
pub async fn transcribe_audio_with_model(wav_bytes: &[u8], model_name: &str) -> Result<String, String> {
    // 1. Parse WAV → f32 PCM mono at 16 kHz
    let (samples, _sr) = parse_wav_to_f32(wav_bytes)?;

    // 2. VAD gate — skip silent audio
    if !is_speech(&samples, DEFAULT_VAD_THRESHOLD) {
        log::debug!("[whisper_local] VAD: silence detected (RMS {:.4}), skipping transcription", rms_energy(&samples));
        return Ok(String::new());
    }

    // 3. Ensure model is present (download if needed)
    let model_path = ensure_model_downloaded(model_name).await?;
    let model_path_str = model_path
        .to_str()
        .ok_or("Model path contains invalid UTF-8")?
        .to_string();

    // 4. Run whisper.cpp inference on a blocking thread (CPU-bound)
    let result = tokio::task::spawn_blocking(move || {
        run_whisper_inference(&model_path_str, &samples)
    })
    .await
    .map_err(|e| format!("Inference task panicked: {}", e))??;

    Ok(result)
}

/// Blocking whisper.cpp inference. Runs on a thread pool worker.
/// Requires the `local-whisper` feature (which pulls in whisper-rs + LLVM).
#[cfg(feature = "local-whisper")]
fn run_whisper_inference(model_path: &str, samples: &[f32]) -> Result<String, String> {
    use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

    let ctx = WhisperContext::new_with_params(model_path, WhisperContextParameters::default())
        .map_err(|e| format!("Failed to load Whisper model: {}", e))?;

    let mut state = ctx
        .create_state()
        .map_err(|e| format!("Failed to create Whisper state: {}", e))?;

    let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
    params.set_n_threads(num_threads());
    params.set_translate(false);
    params.set_language(Some("en"));
    params.set_print_special(false);
    params.set_print_progress(false);
    params.set_print_realtime(false);
    params.set_print_timestamps(false);
    params.set_no_speech_thold(0.6);
    params.set_logprob_thold(-1.0);

    state
        .full(params, samples)
        .map_err(|e| format!("Whisper inference error: {}", e))?;

    let num_segments = state
        .full_n_segments()
        .map_err(|e| format!("Segment count error: {}", e))?;

    let mut text = String::new();
    for i in 0..num_segments {
        if let Ok(segment) = state.full_get_segment_text(i) {
            text.push_str(segment.trim());
            text.push(' ');
        }
    }

    Ok(text.trim().to_string())
}

/// Stub when local-whisper feature is disabled — tells user to enable it or use API.
#[cfg(not(feature = "local-whisper"))]
fn run_whisper_inference(_model_path: &str, _samples: &[f32]) -> Result<String, String> {
    Err("Local Whisper is not enabled. Build with --features local-whisper (requires LLVM/libclang), or use cloud transcription in Settings.".to_string())
}

/// Determine a reasonable thread count for whisper.cpp inference.
/// Uses half the logical CPUs, clamped to [1, 8].
fn num_threads() -> i32 {
    let cpus = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4);
    ((cpus / 2).max(1).min(8)) as i32
}

// --- Tauri commands ----------------------------------------------------------

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WhisperModelInfo {
    pub available: bool,
    pub model_name: String,
    pub size_mb: u64,
    pub path: String,
}

/// Check whether the currently configured local Whisper model is downloaded.
pub fn whisper_model_available() -> bool {
    let config = crate::config::load_config();
    model_path_for(&config.whisper_model).exists()
}

/// Download the configured (or specified) Whisper model.
/// Emits `whisper_download_started` and `whisper_download_complete` events.
pub async fn whisper_download_model(app: tauri::AppHandle, model_name: Option<String>) -> Result<String, String> {
    use tauri::Emitter;

    let name = model_name.unwrap_or_else(|| {
        crate::config::load_config().whisper_model
    });

    let def = find_model(&name)
        .ok_or_else(|| format!("Unknown model '{}'. Valid: tiny.en, base.en, small.en", name))?;

    let path = models_dir().join(def.file);
    if path.exists() {
        return Ok(format!("Model '{}' already downloaded.", name));
    }

    let _ = app.emit("whisper_download_started", serde_json::json!({ "model": name }));

    let result = ensure_model_downloaded(&name).await?;
    let size_mb = fs::metadata(&result).map(|m| m.len()).unwrap_or(0) / 1_000_000;

    let _ = app.emit("whisper_download_complete", serde_json::json!({
        "model": name,
        "size_mb": size_mb,
    }));

    Ok(format!("Downloaded '{}' ({} MB)", name, size_mb))
}

/// Get info about the currently configured local Whisper model.
pub fn whisper_model_info() -> WhisperModelInfo {
    let config = crate::config::load_config();
    let model_name = config.whisper_model;
    let path = model_path_for(&model_name);
    let exists = path.exists();
    let size_mb = if exists {
        fs::metadata(&path).map(|m| m.len()).unwrap_or(0) / 1_000_000
    } else {
        0
    };

    WhisperModelInfo {
        available: exists,
        model_name,
        size_mb,
        path: path.to_string_lossy().to_string(),
    }
}

/// Transcribe a base64-encoded WAV using the local Whisper model.
/// This is the command the frontend calls when use_local_whisper is true.
#[tauri::command]
pub async fn whisper_transcribe_local(audio_base64: String) -> Result<String, String> {
    let audio_bytes = base64::engine::general_purpose::STANDARD
        .decode(&audio_base64)
        .map_err(|e| format!("Invalid audio data: {}", e))?;

    transcribe_audio(&audio_bytes).await
}
