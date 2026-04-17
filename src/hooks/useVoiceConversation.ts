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
 *   wake_word_detected            — wake word fired (play chime + animation)
 *   voice_emotion_detected        — emotion detected from voice
 *   voice_language_detected       — non-English language detected
 *   tts_interrupted               — TTS was cut mid-sentence
 *
 * Exposed:
 *   conversationState  — current state
 *   transcript         — ordered list of { role, text } turns in this session
 *   liveTranscript     — partial transcript text as user speaks (best-effort)
 *   speakingText       — text currently being spoken by TTS (for sync display)
 *   micVolume          — normalised 0..1 mic energy (drives VoiceOrb pulse)
 *   detectedEmotion    — latest emotion detected from voice ("neutral" | "excited" | ...)
 *   detectedLanguage   — ISO 639-1 code of detected user language
 *   startConversation  — invoke to enter conversational mode
 *   stopConversation   — invoke to exit conversational mode
 *   clearTranscript    — reset transcript
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
  /** Partial transcript text while user is still speaking (best-effort). */
  liveTranscript: string;
  /** The full text currently being spoken by TTS — sync with audio output. */
  speakingText: string;
  /** Normalised mic energy 0–1, updated ~10 fps. Drives VoiceOrb pulse. */
  micVolume: number;
  /** Latest emotion detected from the user's voice. */
  detectedEmotion: string;
  /** ISO 639-1 language code detected from the user's speech. */
  detectedLanguage: string;
  isActive: boolean;
  startConversation: () => Promise<void>;
  stopConversation: () => void;
  clearTranscript: () => void;
}

// If the backend enters "thinking" and never returns (crashed, hung, etc.) we
// fall back to "listening" after 30 seconds so the user isn't left stranded.
const THINKING_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// Mic volume sampling via Web Audio API
// ---------------------------------------------------------------------------

/** Set up an AnalyserNode on the default microphone and call `onVolume` ~10 fps
 *  with a normalised 0–1 energy level. Returns a cleanup function. */
function startMicVolumeSampler(onVolume: (v: number) => void): () => void {
  let animFrameId: number | null = null;
  let stream: MediaStream | null = null;
  let ctx: AudioContext | null = null;

  (async () => {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      ctx = new AudioContext();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      const buf = new Uint8Array(analyser.frequencyBinCount);

      const tick = () => {
        analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) {
          const s = (buf[i] - 128) / 128;
          sum += s * s;
        }
        const rms = Math.sqrt(sum / buf.length);
        // Scale to 0–1 with a little headroom; clamp to [0,1]
        onVolume(Math.min(1, rms * 4));
        animFrameId = requestAnimationFrame(tick);
      };
      animFrameId = requestAnimationFrame(tick);
    } catch {
      // Mic permission denied or not available — silently ignore
    }
  })();

  return () => {
    if (animFrameId !== null) cancelAnimationFrame(animFrameId);
    if (stream) stream.getTracks().forEach((t) => t.stop());
    if (ctx) ctx.close();
  };
}

export function useVoiceConversation(): UseVoiceConversationResult {
  const [conversationState, setConversationState] = useState<ConversationState>("idle");
  const [transcript, setTranscript] = useState<ConversationTurn[]>([]);
  // Live (partial) transcript shown while the user is speaking
  const [liveTranscript, setLiveTranscript] = useState<string>("");
  // Text currently being spoken by TTS
  const [speakingText, setSpeakingText] = useState<string>("");
  // Mic energy for VoiceOrb pulse (0–1)
  const [micVolume, setMicVolume] = useState<number>(0);
  // Emotion detected from voice
  const [detectedEmotion, setDetectedEmotion] = useState<string>("neutral");
  // Language detected from voice
  const [detectedLanguage, setDetectedLanguage] = useState<string>("en");

  const startedRef = useRef(false);
  // Handle for the thinking watchdog timer
  const thinkingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Cleanup for mic sampler
  const micCleanupRef = useRef<(() => void) | null>(null);

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

  // Start/stop mic volume sampler based on active state
  const conversationStateRef = useRef(conversationState);
  conversationStateRef.current = conversationState;

  useEffect(() => {
    if (conversationState === "listening") {
      // Start sampling mic volume
      const cleanup = startMicVolumeSampler(setMicVolume);
      micCleanupRef.current = cleanup;
      return () => {
        cleanup();
        micCleanupRef.current = null;
        setMicVolume(0);
      };
    } else {
      // Not listening — stop mic sampler and reset volume
      if (micCleanupRef.current) {
        micCleanupRef.current();
        micCleanupRef.current = null;
      }
      setMicVolume(0);
    }
  }, [conversationState]);

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

    // Wake word from Tauri backend — play chime and start animation
    listen<{ phrase: string; play_chime: boolean }>("wake_word_detected", (event) => {
      if (event.payload.play_chime) {
        // Dispatch custom DOM event so VoiceOrb (or any component) can play the chime
        window.dispatchEvent(new CustomEvent("blade_wake_chime", { detail: event.payload }));
      }
      if (!startedRef.current) {
        startConversation();
      }
    }).then((unlisten) => cleanups.push(unlisten));

    listen<{ active: boolean }>("voice_conversation_listening", () => {
      // Entering listening — cancel any thinking watchdog, clear live transcript
      clearThinkingTimer();
      setConversationState("listening");
      setLiveTranscript("");
      setSpeakingText("");
    }).then((unlisten) => cleanups.push(unlisten));

    listen<{ text: string }>("voice_conversation_thinking", (event) => {
      setConversationState("thinking");
      // The thinking event carries the finalised transcript text
      setLiveTranscript(event.payload.text);
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
        setLiveTranscript("");
      }, THINKING_TIMEOUT_MS);
    }).then((unlisten) => cleanups.push(unlisten));

    listen<{ text: string }>("voice_conversation_speaking", (event) => {
      // Response arrived — cancel the thinking watchdog
      clearThinkingTimer();
      setConversationState("speaking");
      setLiveTranscript("");
      // Show the spoken text synchronized with voice output
      setSpeakingText(event.payload.text);
      // Record the assistant's reply in the transcript
      setTranscript((prev) => [
        ...prev,
        { role: "assistant", text: event.payload.text, timestamp: Date.now() },
      ]);
    }).then((unlisten) => cleanups.push(unlisten));

    // TTS was interrupted (user spoke over BLADE)
    listen("tts_interrupted", () => {
      setSpeakingText("");
    }).then((unlisten) => cleanups.push(unlisten));

    // Emotion detected from voice
    listen<{ emotion: string; transcript: string }>("voice_emotion_detected", (event) => {
      setDetectedEmotion(event.payload.emotion);
    }).then((unlisten) => cleanups.push(unlisten));

    // Language detected from voice
    listen<{ language: string }>("voice_language_detected", (event) => {
      setDetectedLanguage(event.payload.language);
    }).then((unlisten) => cleanups.push(unlisten));

    // Voice → Chat pipeline bridge: when the voice backend needs to execute
    // a command through the full chat pipeline (tools, brain planner, etc.),
    // it emits voice_chat_submit. We catch it here and call send_message_stream.
    // The response tokens flow back via chat_token events which the voice
    // backend collects and speaks via TTS.
    listen<{ content: string; voice_mode: boolean; history?: Array<{ role: string; content: string }> }>("voice_chat_submit", (event) => {
      const { content, history } = event.payload;
      // Include conv history so BLADE has context across voice turns
      const messages = [
        ...(history ?? []).map((m) => ({ role: m.role, content: m.content, image_base64: null })),
        { role: "user", content, image_base64: null },
      ];
      invoke("send_message_stream", { messages }).catch((err: unknown) => {
        console.warn("[voice] send_message_stream failed:", err);
      });
    }).then((unlisten) => cleanups.push(unlisten));

    // Voice user message: persist to chat history so voice and typing
    // share the same conversation. When the user opens BLADE's chat window,
    // they see voice turns alongside typed messages.
    listen<{ content: string }>("voice_user_message", (event) => {
      const turn: ConversationTurn = {
        role: "user",
        text: event.payload.content,
        timestamp: Date.now(),
      };
      setTranscript((prev) => [...prev, turn]);
    }).then((unlisten) => cleanups.push(unlisten));

    listen<{ reason: string }>("voice_conversation_ended", () => {
      clearThinkingTimer();
      setConversationState("idle");
      setLiveTranscript("");
      setSpeakingText("");
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
    setLiveTranscript("");
    setSpeakingText("");
    setDetectedEmotion("neutral");
    setDetectedLanguage("en");
    try {
      // start_voice_conversation runs the blocking loop on the Rust side;
      // it will resolve when the conversation ends
      await invoke("start_voice_conversation");
    } catch (e) {
      console.error("[voice_conv] start failed:", e);
    } finally {
      clearThinkingTimer();
      setConversationState("idle");
      setLiveTranscript("");
      setSpeakingText("");
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
    setLiveTranscript("");
    setSpeakingText("");
    startedRef.current = false;
  }, [persistTranscript]);

  const clearTranscript = useCallback(() => {
    setTranscript([]);
  }, []);

  return {
    conversationState,
    transcript,
    liveTranscript,
    speakingText,
    micVolume,
    detectedEmotion,
    detectedLanguage,
    isActive: conversationState !== "idle",
    startConversation,
    stopConversation,
    clearTranscript,
  };
}
