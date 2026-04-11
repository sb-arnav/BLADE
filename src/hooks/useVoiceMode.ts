/**
 * useVoiceMode — Wispr Flow-level voice input for Blade.
 *
 * Modes:
 *   "off"           — voice disabled
 *   "push-to-talk"  — hold Ctrl+Space to record, release to transcribe + send
 *   "always-on"     — Web Audio VAD continuously listens; captures speech segments
 *                     and transcribes them. Wake word "hey blade" optional.
 *
 * Smart routing:
 *   - Always-on without wake word: fills input (user reviews before sending)
 *   - Always-on WITH wake word detected OR push-to-talk: auto-sends immediately
 *   - Extreme God Mode: always auto-sends regardless of wake word
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { BladeConfig } from "../types";

export type VoiceStatus =
  | "idle"
  | "listening"   // always-on: monitoring for speech
  | "detecting"   // speech energy detected, starting to record
  | "recording"   // actively capturing
  | "processing"  // sending to Whisper
  | "error";

interface VoiceModeOptions {
  config: BladeConfig;
  onTranscription: (text: string, autoSend: boolean) => void;
}

const WAKE_WORDS = ["hey blade", "ok blade", "yo blade", "blade,", "blade "];
const VAD_INTERVAL_MS = 50;
const SILENCE_THRESHOLD_RMS = 0.012;
const SPEECH_THRESHOLD_RMS = 0.018;
const MIN_SPEECH_CHUNKS = 6;       // ~300ms before we consider it speech
const SILENCE_TIMEOUT_CHUNKS = 30; // ~1500ms silence = end of utterance
const MAX_RECORDING_MS = 30_000;

function rms(data: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
  return Math.sqrt(sum / data.length);
}

function detectWakeWord(text: string): { found: boolean; clean: string } {
  const lower = text.toLowerCase().trim();
  for (const ww of WAKE_WORDS) {
    if (lower.startsWith(ww)) {
      return { found: true, clean: text.slice(ww.length).replace(/^[,.\s]+/, "").trim() };
    }
  }
  return { found: false, clean: text };
}

export function useVoiceMode({ config, onTranscription }: VoiceModeOptions) {
  const mode = (config as BladeConfig & { voice_mode?: string }).voice_mode ?? "off";
  const isExtremeGodMode = config.god_mode && (config as BladeConfig & { god_mode_tier?: string }).god_mode_tier === "extreme";

  const [status, setStatus] = useState<VoiceStatus>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Push-to-talk state
  const pttActiveRef = useRef(false);
  const pttHoldingRef = useRef(false);

  // Always-on VAD state
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const vadTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const speechChunksRef = useRef(0);
  const silenceChunksRef = useRef(0);
  const inSpeechRef = useRef(false);
  const recordingStartRef = useRef<number>(0);

  const stopEverything = useCallback(() => {
    if (vadTimerRef.current) { clearInterval(vadTimerRef.current); vadTimerRef.current = null; }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(t => t.stop());
      mediaStreamRef.current = null;
    }
    analyserRef.current = null;
    inSpeechRef.current = false;
    speechChunksRef.current = 0;
    silenceChunksRef.current = 0;
    recordedChunksRef.current = [];
    setStatus("idle");
  }, []);

  const transcribeAndRoute = useCallback(async (blob: Blob) => {
    setStatus("processing");
    try {
      const buf = await blob.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let binary = "";
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      const b64 = btoa(binary);

      // Determine file extension from MIME type
      const mime = blob.type || "audio/webm";
      const ext = mime.includes("mp4") || mime.includes("m4a") ? "mp4"
                : mime.includes("ogg") ? "ogg"
                : "webm";

      const text: string = await invoke("voice_transcribe_blob", { audioBase64: b64, fileExt: ext });
      const trimmed = text.trim();
      if (!trimmed) { setStatus(mode === "always-on" ? "listening" : "idle"); return; }

      const { found, clean } = detectWakeWord(trimmed);
      const shouldAutoSend = mode === "push-to-talk" || found || isExtremeGodMode;
      const finalText = found ? clean : trimmed;

      if (finalText) onTranscription(finalText, shouldAutoSend ?? false);
    } catch (e) {
      setErrorMsg(typeof e === "string" ? e : "Transcription failed");
      setTimeout(() => setErrorMsg(null), 4000);
    }
    setStatus(mode === "always-on" ? "listening" : "idle");
  }, [mode, isExtremeGodMode, onTranscription]);

  // ── Always-on VAD ──────────────────────────────────────────────────────────
  const startAlwaysOn = useCallback(async () => {
    if (mode !== "always-on") return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, sampleRate: 16000 }
      });
      mediaStreamRef.current = stream;

      const ctx = new AudioContext({ sampleRate: 16000 });
      audioContextRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      analyserRef.current = analyser;

      const dataArray = new Float32Array(analyser.fftSize);
      setStatus("listening");

      // VAD state machine
      vadTimerRef.current = setInterval(() => {
        if (!analyserRef.current) return;
        analyserRef.current.getFloatTimeDomainData(dataArray);
        const energy = rms(dataArray);

        if (!inSpeechRef.current) {
          if (energy > SPEECH_THRESHOLD_RMS) {
            speechChunksRef.current++;
            if (speechChunksRef.current >= MIN_SPEECH_CHUNKS) {
              // Confirmed speech — start recording
              inSpeechRef.current = true;
              silenceChunksRef.current = 0;
              recordedChunksRef.current = [];
              recordingStartRef.current = Date.now();

              const mr = new MediaRecorder(stream, {
                mimeType: MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
                  ? "audio/webm;codecs=opus"
                  : "audio/webm"
              });
              mr.ondataavailable = (e) => { if (e.data.size > 0) recordedChunksRef.current.push(e.data); };
              mr.onstop = () => {
                const blob = new Blob(recordedChunksRef.current, { type: mr.mimeType || "audio/webm" });
                if (blob.size > 1000) transcribeAndRoute(blob);
                else setStatus("listening");
              };
              mr.start(100);
              mediaRecorderRef.current = mr;
              setStatus("recording");
            }
          } else {
            speechChunksRef.current = Math.max(0, speechChunksRef.current - 1);
          }
        } else {
          // In speech — check for silence
          if (energy < SILENCE_THRESHOLD_RMS) {
            silenceChunksRef.current++;
            const elapsed = Date.now() - recordingStartRef.current;
            if (silenceChunksRef.current >= SILENCE_TIMEOUT_CHUNKS || elapsed > MAX_RECORDING_MS) {
              inSpeechRef.current = false;
              speechChunksRef.current = 0;
              if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
                mediaRecorderRef.current.stop();
              }
            }
          } else {
            silenceChunksRef.current = 0;
          }
        }
      }, VAD_INTERVAL_MS);

    } catch (e) {
      setErrorMsg("Microphone access denied");
      setTimeout(() => setErrorMsg(null), 4000);
      setStatus("error");
    }
  }, [mode, transcribeAndRoute]);

  // ── Push-to-talk ───────────────────────────────────────────────────────────
  const startPushToTalk = useCallback(async () => {
    if (pttActiveRef.current) return;
    pttActiveRef.current = true;
    setStatus("recording");
    try {
      await invoke("voice_start_recording");
    } catch (e) {
      setErrorMsg(typeof e === "string" ? e : "Mic not available");
      setTimeout(() => setErrorMsg(null), 4000);
      pttActiveRef.current = false;
      setStatus("idle");
    }
  }, []);

  const stopPushToTalk = useCallback(async () => {
    if (!pttActiveRef.current) return;
    pttActiveRef.current = false;
    setStatus("processing");
    try {
      const wav = await invoke<string>("voice_stop_recording");
      const text = await invoke<string>("voice_transcribe", { audioBase64: wav });
      const trimmed = text.trim();
      if (trimmed) onTranscription(trimmed, true); // push-to-talk always auto-sends
    } catch (e) {
      setErrorMsg(typeof e === "string" ? e : "Transcription failed");
      setTimeout(() => setErrorMsg(null), 4000);
    }
    setStatus("idle");
  }, [onTranscription]);

  // ── Keyboard handler for push-to-talk (Ctrl+Space) ────────────────────────
  useEffect(() => {
    if (mode !== "push-to-talk") return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.code === "Space" && !pttHoldingRef.current) {
        e.preventDefault();
        pttHoldingRef.current = true;
        startPushToTalk();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space" && pttHoldingRef.current) {
        pttHoldingRef.current = false;
        stopPushToTalk();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [mode, startPushToTalk, stopPushToTalk]);

  // ── Lifecycle ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (mode === "always-on") {
      startAlwaysOn();
      return () => { stopEverything(); };
    } else {
      stopEverything();
    }
  }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    status,
    errorMsg,
    mode,
    // Push-to-talk button handlers (for the InputBar mic button)
    onPttMouseDown: mode === "push-to-talk" ? startPushToTalk : undefined,
    onPttMouseUp: mode === "push-to-talk" ? stopPushToTalk : undefined,
    stopEverything,
  };
}
