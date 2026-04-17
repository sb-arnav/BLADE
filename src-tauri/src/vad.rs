/// BLADE VAD (Voice Activity Detection) Engine
///
/// Ported from Pluely's `speaker/commands.rs` (Tauri+Rust Cluely clone).
/// Replaces fixed-length chunk capture in ghost_mode with real speech detection.
///
/// Pipeline:
///   cpal stream (f32 samples) → noise gate → RMS/peak analysis → speech/silence tracking
///   → when utterance ends: emit Vec<f32> speech segment via channel
///
/// Key improvements over the previous 5-second fixed chunk:
///   - Pre-speech buffer (0.27s) — captures the start of words, not just middle
///   - Min duration filter — discards noise clicks / background bumps
///   - Trailing silence trim — natural utterance boundaries, not fixed timer
///   - Noise gate — filters constant background noise before RMS check

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use std::collections::VecDeque;
use std::sync::mpsc;

// ── VAD Config ────────────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub struct VadConfig {
    /// Size of each VAD analysis chunk in samples.
    pub hop_size: usize,
    /// RMS threshold — chunks above this are considered speech.
    pub sensitivity_rms: f32,
    /// Peak amplitude threshold — alternative speech detector for sharp transients.
    pub peak_threshold: f32,
    /// How many consecutive silent chunks before ending an utterance.
    pub silence_chunks: usize,
    /// Minimum speech chunks required for a valid utterance (noise filter).
    pub min_speech_chunks: usize,
    /// Number of pre-speech chunks to include before detected speech start.
    pub pre_speech_chunks: usize,
    /// Noise gate: samples below this amplitude are zeroed before RMS check.
    pub noise_gate_threshold: f32,
    /// Hard cap on utterance length in seconds before force-emitting.
    pub max_recording_duration_secs: u64,
}

impl Default for VadConfig {
    fn default() -> Self {
        Self {
            hop_size: 1024,
            sensitivity_rms: 0.012,
            peak_threshold: 0.035,
            silence_chunks: 45,      // ~1.0s at 44100Hz/1024hop
            min_speech_chunks: 7,    // ~0.16s
            pre_speech_chunks: 12,   // ~0.27s
            noise_gate_threshold: 0.003,
            max_recording_duration_secs: 60,
        }
    }
}

// ── Audio Utilities ───────────────────────────────────────────────────────────

/// Zero out samples below the noise gate threshold.
fn apply_noise_gate(samples: &[f32], threshold: f32) -> Vec<f32> {
    samples.iter().map(|&s| if s.abs() < threshold { 0.0 } else { s }).collect()
}

/// Returns (rms, peak) for a sample slice.
fn audio_metrics(samples: &[f32]) -> (f32, f32) {
    if samples.is_empty() {
        return (0.0, 0.0);
    }
    let rms = (samples.iter().map(|s| s * s).sum::<f32>() / samples.len() as f32).sqrt();
    let peak = samples.iter().map(|s| s.abs()).fold(0.0_f32, f32::max);
    (rms, peak)
}

/// Normalize audio to target RMS level.
fn normalize_audio(samples: &[f32], target_rms: f32) -> Vec<f32> {
    let rms = (samples.iter().map(|s| s * s).sum::<f32>() / samples.len() as f32).sqrt();
    if rms < 1e-6 {
        return samples.to_vec();
    }
    let gain = target_rms / rms;
    samples.iter().map(|s| (s * gain).clamp(-1.0, 1.0)).collect()
}

/// Encode f32 mono samples as WAV bytes (16-bit PCM).
pub fn encode_wav_mono(samples: &[f32], sample_rate: u32) -> Result<Vec<u8>, String> {
    let spec = hound::WavSpec {
        channels: 1,
        sample_rate,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    let mut buf = std::io::Cursor::new(Vec::new());
    let mut writer = hound::WavWriter::new(&mut buf, spec)
        .map_err(|e| format!("hound WavWriter: {e}"))?;
    for &s in samples {
        let pcm = (s.clamp(-1.0, 1.0) * i16::MAX as f32) as i16;
        writer.write_sample(pcm).map_err(|e| format!("write_sample: {e}"))?;
    }
    writer.finalize().map_err(|e| format!("finalize: {e}"))?;
    Ok(buf.into_inner())
}

// ── VAD Loop ──────────────────────────────────────────────────────────────────

/// A completed speech segment ready for transcription.
pub struct SpeechSegment {
    pub samples: Vec<f32>,
    pub sample_rate: u32,
    /// WAV-encoded bytes, ready to POST to STT API.
    pub wav: Vec<u8>,
}

/// Start a VAD capture loop on the default input device.
/// Runs in a blocking thread. Sends `SpeechSegment` via the returned channel receiver.
/// Stops when the `stop_rx` channel receives any value, or sender drops.
pub fn start_vad_capture(
    config: VadConfig,
) -> Result<(mpsc::Receiver<SpeechSegment>, mpsc::SyncSender<()>), String> {
    let (speech_tx, speech_rx) = mpsc::sync_channel::<SpeechSegment>(8);
    let (stop_tx, stop_rx) = mpsc::sync_channel::<()>(1);

    std::thread::spawn(move || {
        vad_capture_loop(config, speech_tx, stop_rx);
    });

    Ok((speech_rx, stop_tx))
}

fn vad_capture_loop(
    config: VadConfig,
    speech_tx: mpsc::SyncSender<SpeechSegment>,
    stop_rx: mpsc::Receiver<()>,
) {
    let host = cpal::default_host();
    let device = match host.default_input_device() {
        Some(d) => d,
        None => {
            log::warn!("[vad] no input device found");
            return;
        }
    };

    let cfg = match device.default_input_config() {
        Ok(c) => c,
        Err(e) => {
            log::warn!("[vad] default_input_config: {e}");
            return;
        }
    };

    let sample_rate = cfg.sample_rate().0;
    let channels = cfg.channels() as usize;

    let (raw_tx, raw_rx) = mpsc::sync_channel::<Vec<f32>>(256);
    let raw_tx_cb = raw_tx.clone();

    let stream = match device.build_input_stream(
        &cfg.into(),
        move |data: &[f32], _| {
            // Downmix to mono
            let mono: Vec<f32> = data
                .chunks(channels)
                .map(|c| c.iter().sum::<f32>() / channels as f32)
                .collect();
            let _ = raw_tx_cb.try_send(mono);
        },
        |e| log::warn!("[vad] stream error: {e}"),
        None,
    ) {
        Ok(s) => s,
        Err(e) => {
            log::warn!("[vad] build_input_stream: {e}");
            return;
        }
    };

    if let Err(e) = stream.play() {
        log::warn!("[vad] stream play: {e}");
        return;
    }

    log::info!("[vad] started at {}Hz", sample_rate);

    // VAD state
    let mut buffer: VecDeque<f32> = VecDeque::new();
    let mut pre_speech: VecDeque<f32> = VecDeque::with_capacity(
        config.pre_speech_chunks * config.hop_size
    );
    let mut speech_buffer: Vec<f32> = Vec::new();
    let mut in_speech = false;
    let mut silence_chunks: usize = 0;
    let mut speech_chunks: usize = 0;
    let max_samples = (sample_rate as u64 * config.max_recording_duration_secs) as usize;

    loop {
        // Check stop signal (non-blocking)
        if stop_rx.try_recv().is_ok() {
            log::info!("[vad] stop signal received");
            break;
        }

        // Drain raw audio from cpal callback
        match raw_rx.recv_timeout(std::time::Duration::from_millis(100)) {
            Ok(chunk) => buffer.extend(chunk),
            Err(mpsc::RecvTimeoutError::Timeout) => continue,
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }

        // Process in hop_size chunks
        while buffer.len() >= config.hop_size {
            let hop: Vec<f32> = buffer.drain(..config.hop_size).collect();

            // Noise gate before VAD analysis
            let gated = apply_noise_gate(&hop, config.noise_gate_threshold);
            let (rms, peak) = audio_metrics(&gated);
            let is_speech = rms > config.sensitivity_rms || peak > config.peak_threshold;

            if is_speech {
                if !in_speech {
                    // Speech started — prepend the pre-speech buffer for natural word starts
                    in_speech = true;
                    speech_chunks = 0;
                    speech_buffer.extend(pre_speech.drain(..));
                }

                speech_chunks += 1;
                speech_buffer.extend_from_slice(&gated);
                silence_chunks = 0;

                // Hard cap — force emit to prevent unbounded growth
                if speech_buffer.len() > max_samples {
                    emit_segment(&config, &speech_buffer, sample_rate, &speech_tx);
                    speech_buffer.clear();
                    in_speech = false;
                    speech_chunks = 0;
                }
            } else {
                if in_speech {
                    silence_chunks += 1;
                    // Keep collecting during silence gaps (natural speech has pauses)
                    speech_buffer.extend_from_slice(&gated);

                    if silence_chunks >= config.silence_chunks {
                        if speech_chunks >= config.min_speech_chunks && !speech_buffer.is_empty() {
                            // Trim most of the trailing silence, keep 0.15s for natural ending
                            let keep_silence = (sample_rate as usize * 15 / 100).min(speech_buffer.len());
                            let total_silence = silence_chunks * config.hop_size;
                            let trim = total_silence.saturating_sub(keep_silence);
                            if speech_buffer.len() > trim {
                                speech_buffer.truncate(speech_buffer.len() - trim);
                            }
                            emit_segment(&config, &speech_buffer, sample_rate, &speech_tx);
                        } else {
                            log::debug!("[vad] discarded: too short ({} chunks)", speech_chunks);
                        }

                        speech_buffer.clear();
                        in_speech = false;
                        silence_chunks = 0;
                        speech_chunks = 0;
                    }
                } else {
                    // Maintain rolling pre-speech buffer
                    pre_speech.extend(hop.iter());
                    while pre_speech.len() > config.pre_speech_chunks * config.hop_size {
                        pre_speech.pop_front();
                    }
                }
            }
        }
    }

    log::info!("[vad] loop exited");
}

fn emit_segment(
    _config: &VadConfig,
    samples: &[f32],
    sample_rate: u32,
    tx: &mpsc::SyncSender<SpeechSegment>,
) {
    let normalized = normalize_audio(samples, 0.1);
    match encode_wav_mono(&normalized, sample_rate) {
        Ok(wav) => {
            let seg = SpeechSegment {
                samples: normalized,
                sample_rate,
                wav,
            };
            if tx.try_send(seg).is_err() {
                log::warn!("[vad] speech_tx full — dropping segment");
            }
        }
        Err(e) => log::warn!("[vad] WAV encode failed: {e}"),
    }
}
