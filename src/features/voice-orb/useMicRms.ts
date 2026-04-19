// src/features/voice-orb/useMicRms.ts (ORB-05)
//
// Web Audio mic acquisition + RMS loop. Synthesizes mic level client-side
// per D-104: Voice Orb runs sub-100ms latency math, so RMS lives next to the
// renderer (no IPC round-trip). WIRE-07 (Rust VAD) stays for meeting detection
// in audio_timeline.rs and is NOT repurposed for the orb.
//
// Privacy invariant (T-04-03-01 mitigate): audio samples NEVER leave the orb
// window — RMS is computed locally and discarded each frame; no recording
// buffer. `releaseMic()` stops every track + closes the AudioContext on
// non-listening phase transitions.
//
// @see .planning/phases/04-overlay-windows/04-CONTEXT.md §D-104, §threat T-04-03-01
// @see .planning/phases/04-overlay-windows/04-PATTERNS.md §7

import { useCallback, useEffect, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';

export interface MicRmsHandle {
  /** Ref-backed RMS 0..1; read every rAF tick by useOrbPhase. */
  micRmsRef: MutableRefObject<number>;
  /** Acquire microphone + start RMS loop. Idempotent — safe to call repeatedly. */
  acquireMic: () => Promise<void>;
  /** Release all mic resources + zero the RMS ref. Idempotent. */
  releaseMic: () => void;
  /** Human-readable mic-permission error; null when no error. */
  micError: string | null;
}

export function useMicRms(): MicRmsHandle {
  const micRmsRef = useRef(0);
  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const [micError, setMicError] = useState<string | null>(null);

  const releaseMic = useCallback(() => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    streamRef.current?.getTracks().forEach((t) => {
      try {
        t.stop();
      } catch {
        /* track already stopped — ignore */
      }
    });
    if (ctxRef.current && ctxRef.current.state !== 'closed') {
      ctxRef.current.close().catch(() => {
        /* AudioContext close may throw on stale ctx — ignore */
      });
    }
    streamRef.current = null;
    ctxRef.current = null;
    analyserRef.current = null;
    micRmsRef.current = 0;
  }, []);

  const acquireMic = useCallback(async () => {
    // Idempotent: if a stream is already live, no-op.
    if (streamRef.current) return;
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setMicError('Microphone API unavailable in this environment.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const ctx = new AudioContext();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);
      streamRef.current = stream;
      ctxRef.current = ctx;
      analyserRef.current = analyser;
      setMicError(null);

      const data = new Float32Array(analyser.fftSize);
      const loop = () => {
        const a = analyserRef.current;
        if (!a) return;
        a.getFloatTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) {
          sum += data[i] * data[i];
        }
        const rms = Math.sqrt(sum / data.length);
        // Speech RMS typically lands 0.05–0.3; scale ~3x then clamp to [0, 1].
        micRmsRef.current = Math.min(1, rms * 3);
        rafRef.current = requestAnimationFrame(loop);
      };
      rafRef.current = requestAnimationFrame(loop);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setMicError(
        /denied|notallowed|permission/i.test(msg)
          ? 'Microphone access denied. Grant permission in System Settings.'
          : `Microphone unavailable: ${msg}`,
      );
      releaseMic();
    }
  }, [releaseMic]);

  // Defensive cleanup if the consuming window unmounts mid-listen.
  useEffect(() => {
    return () => {
      releaseMic();
    };
  }, [releaseMic]);

  return { micRmsRef, acquireMic, releaseMic, micError };
}
