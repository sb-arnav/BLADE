import { useCallback, useEffect, useRef, useState } from "react";

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

  const playChime = useCallback(() => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new AudioContext();
    }
    const ctx = audioCtxRef.current;
    const now = ctx.currentTime;

    const playTone = (frequency: number, startTime: number, duration: number) => {
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      gain.gain.value = 0.08;
      gain.gain.setValueAtTime(0.08, startTime);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
      oscillator.connect(gain);
      gain.connect(ctx.destination);
      oscillator.start(startTime);
      oscillator.stop(startTime + duration);
    };

    playTone(880, now, 0.08);
    playTone(1100, now + 0.11, 0.08);
  }, []);

  useEffect(() => {
    const wasLoading = prevLoadingRef.current;
    prevLoadingRef.current = loading;

    if (wasLoading && !loading && enabled) {
      playChime();
    }
  }, [loading, enabled, playChime]);

  return { enabled, toggleEnabled };
}
