import { useState, useEffect, useRef, useCallback } from "react";
import type { Message } from "../types";

const STORAGE_KEY = "blade-tts";

function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, "")        // code blocks
    .replace(/`([^`]+)`/g, "$1")            // inline code
    .replace(/!\[.*?\]\(.*?\)/g, "")        // images
    .replace(/\[([^\]]+)\]\(.*?\)/g, "$1")  // links
    .replace(/#{1,6}\s+/g, "")              // headings
    .replace(/(\*\*|__)(.*?)\1/g, "$2")     // bold
    .replace(/(\*|_)(.*?)\1/g, "$2")        // italic
    .replace(/~~(.*?)~~/g, "$1")            // strikethrough
    .replace(/>\s+/g, "")                   // blockquotes
    .replace(/[-*+]\s+/g, "")              // unordered list markers
    .replace(/\d+\.\s+/g, "")             // ordered list markers
    .replace(/---+/g, "")                  // horizontal rules
    .replace(/\n{2,}/g, ". ")             // collapse multiple newlines
    .replace(/\n/g, " ")                  // remaining newlines
    .trim();
}

function pickVoice(): SpeechSynthesisVoice | null {
  const voices = speechSynthesis.getVoices();
  const english = voices.filter((v) => v.lang.startsWith("en"));

  const preferred = english.find(
    (v) => v.name.includes("Google") || v.name.includes("Microsoft")
  );
  return preferred ?? english[0] ?? voices[0] ?? null;
}

export function useTTS(messages: Message[] = [], loading = false) {
  const [enabled, setEnabled] = useState<boolean>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === "true";
    } catch {
      return false;
    }
  });
  const [speaking, setSpeaking] = useState(false);
  const lastSpokenId = useRef<string | null>(null);

  // Persist enabled state
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, String(enabled));
    } catch {
      // storage unavailable
    }
  }, [enabled]);

  const toggleEnabled = useCallback(() => {
    setEnabled((prev) => {
      if (prev) speechSynthesis.cancel();
      return !prev;
    });
  }, []);

  const stop = useCallback(() => {
    speechSynthesis.cancel();
    setSpeaking(false);
  }, []);

  const speak = useCallback((text: string) => {
    speechSynthesis.cancel();
    const clean = stripMarkdown(text);
    if (!clean) return;

    const utterance = new SpeechSynthesisUtterance(clean);
    const voice = pickVoice();
    if (voice) utterance.voice = voice;
    utterance.rate = 1.05;
    utterance.pitch = 1.0;

    utterance.onstart = () => setSpeaking(true);
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);

    speechSynthesis.speak(utterance);
  }, []);

  // Auto-speak last assistant message
  useEffect(() => {
    if (!enabled || loading || messages.length === 0) return;

    const last = messages[messages.length - 1];
    if (
      last.role === "assistant" &&
      last.content &&
      last.id !== lastSpokenId.current
    ) {
      lastSpokenId.current = last.id;
      speak(last.content);
    }
  }, [enabled, loading, messages, speak]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      speechSynthesis.cancel();
    };
  }, []);

  return { speak, stop, speaking, enabled, toggleEnabled };
}
