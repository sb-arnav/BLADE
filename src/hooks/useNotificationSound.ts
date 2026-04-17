import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";

const STORAGE_KEY = "blade-sound";

function getInitialEnabled(): boolean {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === null ? true : stored === "true";
  } catch {
    return true;
  }
}

export function useNotificationSound(loading: boolean) {
  const [enabled, setEnabled] = useState(getInitialEnabled);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const prevLoadingRef = useRef(loading);

  const toggleEnabled = useCallback(() => {
    setEnabled((prev) => {
      const next = !prev;
      localStorage.setItem(STORAGE_KEY, String(next));
      return next;
    });
  }, []);

  const getCtx = useCallback(() => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new AudioContext();
    }
    return audioCtxRef.current;
  }, []);

  const playTone = useCallback((ctx: AudioContext, frequency: number, startTime: number, duration: number, vol = 0.08) => {
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = frequency;
    gain.gain.value = vol;
    gain.gain.setValueAtTime(vol, startTime);
    gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.start(startTime);
    oscillator.stop(startTime + duration);
  }, []);

  // Chat completion chime — two ascending notes
  const playChime = useCallback(() => {
    const ctx = getCtx();
    const now = ctx.currentTime;
    playTone(ctx, 880, now, 0.08);
    playTone(ctx, 1100, now + 0.11, 0.08);
  }, [getCtx, playTone]);

  // Proactive nudge — softer, three-note descending arpeggio (BLADE wants attention)
  const playNudge = useCallback(() => {
    const ctx = getCtx();
    const now = ctx.currentTime;
    playTone(ctx, 660, now, 0.12, 0.05);
    playTone(ctx, 550, now + 0.14, 0.12, 0.04);
    playTone(ctx, 440, now + 0.28, 0.18, 0.03);
  }, [getCtx, playTone]);

  // Alert — urgent, short staccato
  const playAlert = useCallback(() => {
    const ctx = getCtx();
    const now = ctx.currentTime;
    playTone(ctx, 1200, now, 0.06, 0.1);
    playTone(ctx, 1200, now + 0.1, 0.06, 0.1);
  }, [getCtx, playTone]);

  // Chat completion sound
  useEffect(() => {
    const wasLoading = prevLoadingRef.current;
    prevLoadingRef.current = loading;
    if (wasLoading && !loading && enabled) {
      playChime();
    }
  }, [loading, enabled, playChime]);

  // Proactive event sounds — BLADE feels alive
  useEffect(() => {
    if (!enabled) return;

    const unlistenNudge = listen("proactive_nudge", () => playNudge());
    const unlistenCard = listen("proactive_card", () => playNudge());
    const unlistenCatchup = listen("blade_catchup", () => playChime());
    const unlistenAlert = listen("blade_status", (ev) => {
      if ((ev.payload as string) === "error") playAlert();
    });

    return () => {
      unlistenNudge.then((fn) => fn());
      unlistenCard.then((fn) => fn());
      unlistenCatchup.then((fn) => fn());
      unlistenAlert.then((fn) => fn());
    };
  }, [enabled, playNudge, playChime, playAlert]);

  return { enabled, toggleEnabled };
}
