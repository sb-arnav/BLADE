// src/lib/tauri/voice.ts — Phase 14 Plan 14-02 (WIRE2-01)
//
// Wrappers for voice.rs, tts.rs, voice_intelligence.rs, voice_local.rs.
// D-36 file-per-cluster discipline: voice backend commands → own TS file.
// All commands are already registered in lib.rs — no Rust changes required.
//
// @see src-tauri/src/voice_global.rs
// @see src-tauri/src/tts.rs
// @see src-tauri/src/whisper_local.rs
// @see .planning/phases/14-wiring-accessibility-pass/14-02-PLAN.md

import { invokeTyped } from './_base';

/**
 * Start recording voice input.
 * @see voice_global.rs `pub async fn voice_start_recording()`
 */
export function voiceStartRecording(): Promise<void> {
  return invokeTyped<void>('voice_start_recording');
}

/**
 * Stop recording and return transcript.
 * @see voice_global.rs `pub async fn voice_stop_recording() -> String`
 */
export function voiceStopRecording(): Promise<string> {
  return invokeTyped<string>('voice_stop_recording');
}

/**
 * Speak `text` via TTS at optional `speed` multiplier (0.5–2.0).
 * @see tts.rs `pub async fn tts_speak(text: String, speed: Option<f64>)`
 */
export function ttsSpeak(text: string, speed?: number): Promise<void> {
  return invokeTyped<void, { text: string; speed?: number }>('tts_speak', { text, speed });
}

/**
 * Stop any active TTS playback immediately.
 * @see tts.rs `pub async fn tts_stop()`
 */
export function ttsStop(): Promise<void> {
  return invokeTyped<void>('tts_stop');
}

/**
 * Returns true if a local Whisper model file is present on disk.
 * Read-only — no blade_activity_log emission required.
 * @see whisper_local.rs `pub fn whisper_model_available() -> bool`
 */
export function whisperModelAvailable(): Promise<boolean> {
  return invokeTyped<boolean>('whisper_model_available');
}

/**
 * Start a voice intelligence session (meeting transcription + real-time context).
 * @see audio_timeline.rs `pub async fn voice_intel_start_session()`
 */
export function voiceIntelStartSession(): Promise<void> {
  return invokeTyped<void>('voice_intel_start_session');
}
