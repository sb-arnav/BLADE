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

// If the backend enters "thinking" and never returns (crashed, hung, etc.) we
// fall back to "listening" after 30 seconds so the user isn't left stranded.
const THINKING_TIMEOUT_MS = 30_000;

export function useVoiceConversation(): UseVoiceConversationResult {
  const [conversationState, setConversationState] = useState<ConversationState>("idle");
  const [transcript, setTranscript] = useState<ConversationTurn[]>([]);
  const startedRef = useRef(false);
  // Handle for the thinking watchdog timer
  const thinkingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearThinkingTimer = () => {
    if (thinkingTimerRef.current) {
      clearTimeout(thinkingTimerRef.current);
      thinkingTimerRef.current = null;
    }
  };

  // Persist the transcript as a voice conversation in chat history when the
  // session ends. This ensures voice chats show up alongside text conversations.
  const persistTranscriptRef = useRef<ConversationTurn[]>([]);
  useEffect(() => {
    persistTranscriptRef.current = transcript;
  }, [transcript]);

  const persistTranscript = useCallback((turns: ConversationTurn[]) => {
    if (turns.length < 2) return; // don't save empty or single-turn sessions
    const conversationId = crypto.randomUUID();
    const messages = turns.map((t) => ({
      id: crypto.randomUUID(),
      role: t.role,
      content: t.text,
      timestamp: t.timestamp,
    }));
    invoke("history_save_conversation", { conversationId, messages }).catch(() => {});
  }, []);

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
      // Entering listening — cancel any thinking watchdog
      clearThinkingTimer();
      setConversationState("listening");
    }).then((unlisten) => cleanups.push(unlisten));

    listen<{ text: string }>("voice_conversation_thinking", (event) => {
      setConversationState("thinking");
      // Record the user's utterance in the transcript
      setTranscript((prev) => [
        ...prev,
        { role: "user", text: event.payload.text, timestamp: Date.now() },
      ]);
      // Start the 30-second watchdog — if the backend never responds (hung or crashed)
      // we nudge the state machine back to listening so the user isn't stuck.
      clearThinkingTimer();
      thinkingTimerRef.current = setTimeout(() => {
        thinkingTimerRef.current = null;
        setConversationState("listening");
      }, THINKING_TIMEOUT_MS);
    }).then((unlisten) => cleanups.push(unlisten));

    listen<{ text: string }>("voice_conversation_speaking", (event) => {
      // Response arrived — cancel the thinking watchdog
      clearThinkingTimer();
      setConversationState("speaking");
      // Record the assistant's reply in the transcript
      setTranscript((prev) => [
        ...prev,
        { role: "assistant", text: event.payload.text, timestamp: Date.now() },
      ]);
    }).then((unlisten) => cleanups.push(unlisten));

    listen<{ reason: string }>("voice_conversation_ended", () => {
      clearThinkingTimer();
      setConversationState("idle");
      startedRef.current = false;
      // Persist the completed session transcript to chat history
      persistTranscript(persistTranscriptRef.current);
    }).then((unlisten) => cleanups.push(unlisten));

    return () => {
      clearThinkingTimer();
      cleanups.forEach((fn) => fn());
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [persistTranscript]);

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
      clearThinkingTimer();
      setConversationState("idle");
      startedRef.current = false;
    }
  }, []);

  const stopConversation = useCallback(() => {
    invoke("stop_voice_conversation").catch((e) => {
      console.error("[voice_conv] stop failed:", e);
    });
    clearThinkingTimer();
    // Persist whatever transcript has accumulated so far
    persistTranscript(persistTranscriptRef.current);
    setConversationState("idle");
    startedRef.current = false;
  }, [persistTranscript]);

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
