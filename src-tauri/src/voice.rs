use base64::Engine;
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use std::sync::{Arc, Mutex};

struct RecordingState {
    samples: Vec<f32>,
    is_recording: bool,
    sample_rate: u32,
}

static RECORDING: std::sync::LazyLock<Arc<Mutex<RecordingState>>> =
    std::sync::LazyLock::new(|| {
        Arc::new(Mutex::new(RecordingState {
            samples: Vec::new(),
            is_recording: false,
            sample_rate: 16000,
        }))
    });

/// Start recording from the default microphone
#[tauri::command]
pub fn voice_start_recording() -> Result<(), String> {
    let mut state = RECORDING.lock().map_err(|e| e.to_string())?;
    state.samples.clear();
    state.is_recording = true;
    drop(state);

    let recording = RECORDING.clone();

    std::thread::spawn(move || {
        let host = cpal::default_host();
        let device = match host.default_input_device() {
            Some(d) => d,
            None => return,
        };

        let config = match device.default_input_config() {
            Ok(c) => c,
            Err(_) => return,
        };

        let sample_rate = config.sample_rate().0;
        let channels = config.channels() as usize;
        let recording_clone = recording.clone();

        // Store the actual device sample rate
        if let Ok(mut state) = recording.lock() {
            state.sample_rate = sample_rate;
        }

        let stream = device
            .build_input_stream(
                &config.into(),
                move |data: &[f32], _: &cpal::InputCallbackInfo| {
                    let mut state = match recording_clone.lock() {
                        Ok(s) => s,
                        Err(_) => return,
                    };
                    if !state.is_recording {
                        return;
                    }
                    // Mix to mono if multi-channel
                    for chunk in data.chunks(channels) {
                        let mono = chunk.iter().sum::<f32>() / channels as f32;
                        state.samples.push(mono);
                    }
                },
                |_err| {},
                None,
            )
            .ok();

        if let Some(stream) = stream {
            let _ = stream.play();

            // Keep stream alive while recording
            loop {
                std::thread::sleep(std::time::Duration::from_millis(100));
                let state = recording.lock().unwrap();
                if !state.is_recording {
                    break;
                }
            }

            drop(stream);
        }

        // sample_rate already stored in RecordingState above
    });

    Ok(())
}

/// Stop recording and return the audio as base64-encoded WAV
#[tauri::command]
pub fn voice_stop_recording() -> Result<String, String> {
    let mut state = RECORDING.lock().map_err(|e| e.to_string())?;
    state.is_recording = false;
    let samples = std::mem::take(&mut state.samples);
    let sample_rate = state.sample_rate;
    drop(state);

    if samples.is_empty() {
        return Err("No audio recorded".to_string());
    }

    // Encode as WAV using the actual device sample rate
    let wav_data = encode_wav(&samples, 1, sample_rate)?;
    Ok(base64::engine::general_purpose::STANDARD.encode(&wav_data))
}

/// Transcribe audio using Groq Whisper API
#[tauri::command]
pub async fn voice_transcribe(audio_base64: String) -> Result<String, String> {
    let config = crate::config::load_config();

    // Use Groq for transcription (free tier supports whisper)
    // If user is on Groq, use their key. Otherwise check for a separate Groq key.
    let api_key = if config.provider == "groq" {
        config.api_key.clone()
    } else {
        // Try to get Groq key from keychain as fallback
        keyring::Entry::new("blade-ai", "groq-whisper")
            .and_then(|e| e.get_password())
            .unwrap_or(config.api_key.clone())
    };

    if api_key.is_empty() {
        return Err(
            "No API key available for transcription. Use Groq provider or add a Groq key."
                .to_string(),
        );
    }

    let audio_bytes = base64::engine::general_purpose::STANDARD
        .decode(&audio_base64)
        .map_err(|e| format!("Invalid audio data: {}", e))?;

    let client = reqwest::Client::new();
    let part = reqwest::multipart::Part::bytes(audio_bytes)
        .file_name("recording.wav")
        .mime_str("audio/wav")
        .map_err(|e| e.to_string())?;

    let form = reqwest::multipart::Form::new()
        .text("model", "whisper-large-v3")
        .part("file", part);

    let response = client
        .post("https://api.groq.com/openai/v1/audio/transcriptions")
        .header("Authorization", format!("Bearer {}", api_key))
        .multipart(form)
        .send()
        .await
        .map_err(|e| format!("Transcription failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("Whisper API error {}: {}", status, body));
    }

    let json: serde_json::Value = response
        .json::<serde_json::Value>()
        .await
        .map_err(|e| e.to_string())?;
    let text = json["text"].as_str().unwrap_or("").trim().to_string();

    Ok(text)
}

/// Transcribe any audio format (webm, m4a, ogg, mp3…) from MediaRecorder output.
/// `file_ext` should be "webm", "mp4", "ogg", etc.
#[tauri::command]
pub async fn voice_transcribe_blob(audio_base64: String, file_ext: String) -> Result<String, String> {
    let config = crate::config::load_config();

    let api_key = if config.provider == "groq" {
        config.api_key.clone()
    } else {
        keyring::Entry::new("blade-ai", "groq-whisper")
            .and_then(|e| e.get_password())
            .unwrap_or(config.api_key.clone())
    };

    if api_key.is_empty() {
        return Err("No API key for transcription. Set Groq as provider or add a Groq key.".to_string());
    }

    let audio_bytes = base64::engine::general_purpose::STANDARD
        .decode(&audio_base64)
        .map_err(|e| format!("Invalid audio: {}", e))?;

    let safe_ext = match file_ext.trim_start_matches('.') {
        "mp4" | "m4a" => "recording.mp4",
        "ogg" => "recording.ogg",
        "mp3" => "recording.mp3",
        "webm" | _ => "recording.webm",
    };

    let client = reqwest::Client::new();
    let part = reqwest::multipart::Part::bytes(audio_bytes)
        .file_name(safe_ext)
        .mime_str("audio/webm")
        .map_err(|e| e.to_string())?;

    let form = reqwest::multipart::Form::new()
        .text("model", "whisper-large-v3")
        .part("file", part);

    let response = client
        .post("https://api.groq.com/openai/v1/audio/transcriptions")
        .header("Authorization", format!("Bearer {}", api_key))
        .multipart(form)
        .send()
        .await
        .map_err(|e| format!("Transcription failed: {}", e))?;

    if !response.status().is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err(format!("Whisper error: {}", body));
    }

    let json: serde_json::Value = response.json().await.map_err(|e| e.to_string())?;
    Ok(json["text"].as_str().unwrap_or("").trim().to_string())
}

pub(crate) fn encode_wav(samples: &[f32], channels: u16, sample_rate: u32) -> Result<Vec<u8>, String> {
    let mut cursor = std::io::Cursor::new(Vec::new());

    let spec = hound::WavSpec {
        channels,
        sample_rate,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };

    let mut writer =
        hound::WavWriter::new(&mut cursor, spec).map_err(|e| format!("WAV error: {}", e))?;

    for &sample in samples {
        let scaled = (sample * 32767.0).clamp(-32768.0, 32767.0) as i16;
        writer
            .write_sample(scaled)
            .map_err(|e| format!("WAV write error: {}", e))?;
    }

    writer
        .finalize()
        .map_err(|e| format!("WAV finalize error: {}", e))?;

    Ok(cursor.into_inner())
}
