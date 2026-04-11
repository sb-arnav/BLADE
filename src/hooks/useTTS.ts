import { useState, useEffect, useRef, useCallback } from "react";
import type { Message, BladeConfig } from "../types";

const STORAGE_KEY = "blade-tts";

function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[.*?\]\(.*?\)/g, "")
    .replace(/\[([^\]]+)\]\(.*?\)/g, "$1")
    .replace(/#{1,6}\s+/g, "")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/(\*|_)(.*?)\1/g, "$2")
    .replace(/~~(.*?)~~/g, "$1")
    .replace(/>\s+/g, "")
    .replace(/[-*+]\s+/g, "")
    .replace(/\d+\.\s+/g, "")
    .replace(/---+/g, "")
    .replace(/\n{2,}/g, ". ")
    .replace(/\n/g, " ")
    .trim();
}

// Derive the TTS endpoint from the config. If a custom base_url is set for
// OpenAI-compatible gateways, replace the completions path with the TTS path.
function ttsEndpoint(config: BladeConfig): string {
  if (config.base_url) {
    // base_url is the full completions URL, e.g. https://gateway.../openai
    // Strip any trailing /chat/completions and append /audio/speech
    const base = config.base_url
      .replace(/\/chat\/completions\/?$/, "")
      .replace(/\/$/, "");
    return `${base}/audio/speech`;
  }
  return "https://api.openai.com/v1/audio/speech";
}

async function speakOpenAI(
  text: string,
  config: BladeConfig,
  onStart: () => void,
  onEnd: () => void,
): Promise<() => void> {
  const endpoint = ttsEndpoint(config);

  const resp = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.api_key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "tts-1",
      input: text,
      voice: "nova",       // warm, expressive, natural personality
      speed: 1.05,
      response_format: "mp3",
    }),
  });

  if (!resp.ok) throw new Error(`TTS ${resp.status}`);

  const blob = await resp.blob();
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);

  audio.onplay = onStart;
  audio.onended = () => { onEnd(); URL.revokeObjectURL(url); };
  audio.onerror = () => { onEnd(); URL.revokeObjectURL(url); };

  audio.play();

  // Return a stop function
  return () => {
    audio.pause();
    audio.src = "";
    URL.revokeObjectURL(url);
    onEnd();
  };
}

// Fallback: browser Web Speech API (robotic but works without a key)
function pickVoice(): SpeechSynthesisVoice | null {
  const voices = speechSynthesis.getVoices();
  const english = voices.filter((v) => v.lang.startsWith("en"));
  // Prefer Neural/Natural voices on Windows (Microsoft), then Google
  const preferred =
    english.find((v) => v.name.includes("Natural")) ??
    english.find((v) => v.name.includes("Neural")) ??
    english.find((v) => v.name.includes("Google")) ??
    english.find((v) => v.name.includes("Microsoft") && v.name.includes("Aria")) ??
    english.find((v) => v.name.includes("Microsoft")) ??
    english[0] ?? voices[0] ?? null;
  return preferred;
}

function speakBrowser(
  text: string,
  onStart: () => void,
  onEnd: () => void,
): () => void {
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  const voice = pickVoice();
  if (voice) utterance.voice = voice;
  utterance.rate = 1.05;
  utterance.pitch = 1.0;
  utterance.onstart = onStart;
  utterance.onend = onEnd;
  utterance.onerror = onEnd;
  speechSynthesis.speak(utterance);
  return () => { speechSynthesis.cancel(); onEnd(); };
}

export function useTTS(messages: Message[] = [], loading = false, config?: BladeConfig | null) {
  const [enabled, setEnabled] = useState<boolean>(() => {
    try { return localStorage.getItem(STORAGE_KEY) === "true"; } catch { return false; }
  });
  const [speaking, setSpeaking] = useState(false);
  const lastSpokenId = useRef<string | null>(null);
  const stopRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, String(enabled)); } catch { /* noop */ }
  }, [enabled]);

  const stop = useCallback(() => {
    stopRef.current?.();
    stopRef.current = null;
    speechSynthesis.cancel();
    setSpeaking(false);
  }, []);

  const toggleEnabled = useCallback(() => {
    setEnabled((prev) => { if (prev) stop(); return !prev; });
  }, [stop]);

  const speak = useCallback(async (text: string) => {
    stop();
    const clean = stripMarkdown(text);
    if (!clean) return;

    const onStart = () => setSpeaking(true);
    const onEnd = () => setSpeaking(false);

    const useOpenAI = config?.provider === "openai" && config.api_key;

    if (useOpenAI) {
      try {
        const stopFn = await speakOpenAI(clean, config!, onStart, onEnd);
        stopRef.current = stopFn;
        return;
      } catch {
        // Fall through to browser TTS if OpenAI TTS fails
      }
    }

    const stopFn = speakBrowser(clean, onStart, onEnd);
    stopRef.current = stopFn;
  }, [config, stop]);

  // Auto-speak last assistant message
  useEffect(() => {
    if (!enabled || loading || messages.length === 0) return;
    const last = messages[messages.length - 1];
    if (last.role === "assistant" && last.content && last.id !== lastSpokenId.current) {
      lastSpokenId.current = last.id;
      speak(last.content);
    }
  }, [enabled, loading, messages, speak]);

  useEffect(() => () => { stop(); }, [stop]);

  return { speak, stop, speaking, enabled, toggleEnabled };
}
