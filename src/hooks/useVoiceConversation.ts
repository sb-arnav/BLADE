/**
 * useVoiceConversation — Phase 6 conversational voice mode for BLADE.
 *
 * States:
 *   idle      — not in conversation mode
 *   listening — waiting for the user to speak
 *   thinking  — transcribed text sent, waiting for AI response
 *   speaking  — TTS is playing the AI's reply
 *
 * Backend events consumed:
 *   voice_conversation_listening  — backend entered listening state
 *   voice_conversation_thinking   — backend is processing the utterance
 *   voice_conversation_speaking   — backend started TTS playback
 *   voice_conversation_ended      — conversation loop exited
 *
 * Exposed:
 *   conversationState  — current state
 *   transcript         — ordered list of { role, text } turns in this session
 *   startConversation  — invoke to enter conversational mode
 *   stopConversation   — invoke to exit conversational mode
 *   isActive           — true when state != "idle"
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export type ConversationState = "idle" | "listening" | "thinking" | "speaking";

export interface ConversationTurn {
  role: "user" | "assistant";
  text: string;
  timestamp: number;
}

export interface UseVoiceConversationResult {
  conversationState: ConversationState;
  transcript: ConversationTurn[];
  isActive: boolean;
  startConversation: () => Promise<void>;
  stopConversation: () => void;
  clearTranscript: () => void;
}

export function useVoiceConversation(): UseVoiceConversationResult {
  const [conversationState, setConversationState] = useState<ConversationState>("idle");
  const [transcript, setTranscript] = useState<ConversationTurn[]>([]);
  const startedRef = useRef(false);

  // Listen to backend events and wake word
  useEffect(() => {
    const cleanups: Array<() => void> = [];

    // Start conversation on wake word (only if not already active)
    const wakeWordHandler = () => {
      if (!startedRef.current) {
        startConversation();
      }
    };
    window.addEventListener("blade_wake_word_triggered", wakeWordHandler);
    cleanups.push(() => window.removeEventListener("blade_wake_word_triggered", wakeWordHandler));

    listen<{ active: boolean }>("voice_conversation_listening", () => {
      setConversationState("listening");
    }).then((unlisten) => cleanups.push(unlisten));

    listen<{ text: string }>("voice_conversation_thinking", (event) => {
      setConversationState("thinking");
      // Record the user's utterance in the transcript
      setTranscript((prev) => [
        ...prev,
        { role: "user", text: event.payload.text, timestamp: Date.now() },
      ]);
    }).then((unlisten) => cleanups.push(unlisten));

    listen<{ text: string }>("voice_conversation_speaking", (event) => {
      setConversationState("speaking");
      // Record the assistant's reply in the transcript
      setTranscript((prev) => [
        ...prev,
        { role: "assistant", text: event.payload.text, timestamp: Date.now() },
      ]);
    }).then((unlisten) => cleanups.push(unlisten));

    listen<{ reason: string }>("voice_conversation_ended", () => {
      setConversationState("idle");
      startedRef.current = false;
    }).then((unlisten) => cleanups.push(unlisten));

    return () => {
      cleanups.forEach((fn) => fn());
    };
  }, []);

  const startConversation = useCallback(async () => {
    if (startedRef.current) return;
    startedRef.current = true;
    setConversationState("listening");
    setTranscript([]);
    try {
      // start_voice_conversation runs the blocking loop on the Rust side;
      // it will resolve when the conversation ends
      await invoke("start_voice_conversation");
    } catch (e) {
      console.error("[voice_conv] start failed:", e);
    } finally {
      setConversationState("idle");
      startedRef.current = false;
    }
  }, []);

  const stopConversation = useCallback(() => {
    invoke("stop_voice_conversation").catch((e) => {
      console.error("[voice_conv] stop failed:", e);
    });
    setConversationState("idle");
    startedRef.current = false;
  }, []);

  const clearTranscript = useCallback(() => {
    setTranscript([]);
  }, []);

  return {
    conversationState,
    transcript,
    isActive: conversationState !== "idle",
    startConversation,
    stopConversation,
    clearTranscript,
  };
}
