import { useState, useEffect, useRef, useCallback } from "react";
import type { Message, BladeConfig } from "../types";

const STORAGE_KEY = "blade-tts";

function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, "code block")
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

function ttsEndpoint(config: BladeConfig): string {
  if (config.base_url) {
    const base = config.base_url
      .replace(/\/chat\/completions\/?$/, "")
      .replace(/\/$/, "");
    return `${base}/audio/speech`;
  }
  return "https://api.openai.com/v1/audio/speech";
}

function splitSentences(text: string): { ready: string[]; remainder: string } {
  const ready: string[] = [];
  let pos = 0;
  while (pos < text.length) {
    const match = /[.!?]+[\s]+|[.!?]+$/.exec(text.slice(pos));
    if (!match) break;
    const end = pos + match.index + match[0].length;
    const sentence = text.slice(pos, end).trim();
    if (sentence.length >= 8) ready.push(sentence);
    pos = end;
  }
  return { ready, remainder: text.slice(pos) };
}

async function fetchOpenAIAudio(text: string, config: BladeConfig): Promise<HTMLAudioElement | null> {
  const clean = stripMarkdown(text);
  if (!clean || clean.length < 3) return null;
  try {
    const resp = await fetch(ttsEndpoint(config), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.api_key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: "tts-1", input: clean, voice: "nova", speed: 1.05, response_format: "mp3" }),
    });
    if (!resp.ok) return null;
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.preload = "auto";
    return audio;
  } catch { return null; }
}

function playAudio(audio: HTMLAudioElement): Promise<void> {
  return new Promise((resolve) => {
    audio.onended = () => { URL.revokeObjectURL(audio.src); resolve(); };
    audio.onerror = () => { URL.revokeObjectURL(audio.src); resolve(); };
    audio.play().catch(resolve);
  });
}

function speakBrowserSentence(text: string): Promise<void> {
  return new Promise((resolve) => {
    const clean = stripMarkdown(text);
    if (!clean) { resolve(); return; }
    speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(clean);
    const voices = speechSynthesis.getVoices();
    const english = voices.filter((v) => v.lang.startsWith("en"));
    const voice =
      english.find((v) => v.name.includes("Natural")) ??
      english.find((v) => v.name.includes("Neural")) ??
      english.find((v) => v.name.includes("Google")) ??
      english.find((v) => v.name.includes("Aria")) ??
      english.find((v) => v.name.includes("Microsoft")) ??
      english[0] ?? voices[0] ?? null;
    if (voice) utterance.voice = voice;
    utterance.rate = 1.05;
    utterance.pitch = 1.0;
    utterance.onend = () => resolve();
    utterance.onerror = () => resolve();
    speechSynthesis.speak(utterance);
  });
}

type QueueItem = {
  text: string;
  audioPromise: Promise<HTMLAudioElement | null> | null;
};

export function useTTS(messages: Message[] = [], loading = false, config?: BladeConfig | null) {
  const [enabled, setEnabled] = useState<boolean>(() => {
    try { return localStorage.getItem(STORAGE_KEY) === "true"; } catch { return false; }
  });
  const [speaking, setSpeaking] = useState(false);

  const queueRef = useRef<QueueItem[]>([]);
  const processingRef = useRef(false);
  const abortRef = useRef(false);

  const streamMsgIdRef = useRef<string | null>(null);
  const processedLenRef = useRef(0);
  const sentenceBufferRef = useRef("");
  const lastFullMsgIdRef = useRef<string | null>(null);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, String(enabled)); } catch { /* noop */ }
  }, [enabled]);

  const stop = useCallback(() => {
    abortRef.current = true;
    queueRef.current = [];
    processingRef.current = false;
    speechSynthesis.cancel();
    setSpeaking(false);
    setTimeout(() => { abortRef.current = false; }, 50);
  }, []);

  const toggleEnabled = useCallback(() => {
    setEnabled((prev) => { if (prev) stop(); return !prev; });
  }, [stop]);

  const useOpenAI = config?.provider === "openai" && !!config?.api_key;

  const processQueue = useCallback(async () => {
    if (processingRef.current) return;
    processingRef.current = true;
    setSpeaking(true);
    while (queueRef.current.length > 0 && !abortRef.current) {
      const item = queueRef.current.shift()!;
      if (useOpenAI && item.audioPromise) {
        const audio = await item.audioPromise;
        if (audio && !abortRef.current) await playAudio(audio);
      } else {
        if (!abortRef.current) await speakBrowserSentence(item.text);
      }
    }
    processingRef.current = false;
    setSpeaking(false);
  }, [useOpenAI]);

  const enqueueSentence = useCallback((text: string) => {
    const clean = stripMarkdown(text);
    if (!clean || clean.length < 3) return;
    const audioPromise = useOpenAI && config ? fetchOpenAIAudio(clean, config) : null;
    queueRef.current.push({ text: clean, audioPromise });
    processQueue();
  }, [config, useOpenAI, processQueue]);

  const speak = useCallback((text: string) => {
    stop();
    const clean = stripMarkdown(text);
    if (!clean) return;
    const { ready, remainder } = splitSentences(clean);
    const all = remainder.trim() ? [...ready, remainder.trim()] : ready;
    if (all.length === 0 && clean.length > 0) {
      enqueueSentence(clean);
    } else {
      all.forEach(s => enqueueSentence(s));
    }
  }, [stop, enqueueSentence]);

  useEffect(() => {
    if (!enabled || messages.length === 0) return;
    const last = messages[messages.length - 1];
    if (!last || last.role !== "assistant" || !last.content) return;

    if (loading) {
      if (streamMsgIdRef.current !== last.id) {
        streamMsgIdRef.current = last.id;
        processedLenRef.current = 0;
        sentenceBufferRef.current = "";
      }
      const newText = last.content.slice(processedLenRef.current);
      if (!newText) return;
      processedLenRef.current = last.content.length;
      sentenceBufferRef.current += newText;
      const { ready, remainder } = splitSentences(sentenceBufferRef.current);
      sentenceBufferRef.current = remainder;
      ready.forEach(s => enqueueSentence(s));
    } else {
      if (streamMsgIdRef.current === last.id) {
        const leftover = sentenceBufferRef.current.trim();
        if (leftover) enqueueSentence(leftover);
        sentenceBufferRef.current = "";
        streamMsgIdRef.current = null;
        processedLenRef.current = 0;
        return;
      }
      if (last.id !== lastFullMsgIdRef.current) {
        lastFullMsgIdRef.current = last.id;
        speak(last.content);
      }
    }
  }, [messages, loading, enabled, enqueueSentence, speak]);

  useEffect(() => () => { stop(); }, [stop]);

  return { speak, stop, speaking, enabled, toggleEnabled };
}
