// src/features/voice-orb/useOrbPhase.ts (ORB-03)
//
// Writes OpenClaw-derived CSS vars to the orb DOM node every animation frame.
// React state is NOT updated per frame — vars are written directly via
// `style.setProperty`. CSS-var writes trigger paint-only, no React commit.
//
// Math locked per D-08 / RECOVERY_LOG §2.3 / Plan 04-03 must_have truths:
//   ring speeds 0.6 / 0.9 / 0.6 / 1.4
//   amp formulas:
//     idle      0.35
//     listening 0.5 + level * 0.7
//     thinking  0.35
//     speaking  0.95
//   alpha:
//     idle      0.40
//     listening 0.58 + level * 0.28
//     thinking  0.40
//     speaking  0.72
//   orb scale:
//     idle      1.00
//     listening 1 + level * 0.12
//     thinking  1.00
//     speaking  1 + 0.06 * sin(t * 6)
//   EMA smoothing: level_next = 0.45 * prev + 0.55 * new
//
// @see .planning/phases/04-overlay-windows/04-CONTEXT.md §D-103
// @see .planning/phases/04-overlay-windows/04-PATTERNS.md §6
// @see docs/design/orb.css

import { useEffect, useRef } from 'react';
import type { MutableRefObject, RefObject } from 'react';

export type OrbPhase = 'idle' | 'listening' | 'thinking' | 'speaking';

interface OrbConfig {
  ringSpeed: number;
  amp: number;
  alpha: number;
  scale: number;
}

function configFor(phase: OrbPhase, level: number, t: number): OrbConfig {
  switch (phase) {
    case 'idle':
      return { ringSpeed: 0.6, amp: 0.35, alpha: 0.40, scale: 1.00 };
    case 'listening':
      return {
        ringSpeed: 0.9,
        amp: 0.5 + level * 0.7,
        alpha: 0.58 + level * 0.28,
        scale: 1 + level * 0.12,
      };
    case 'thinking':
      return { ringSpeed: 0.6, amp: 0.35, alpha: 0.40, scale: 1.00 };
    case 'speaking':
      return {
        ringSpeed: 1.4,
        amp: 0.95,
        alpha: 0.72,
        scale: 1 + 0.06 * Math.sin(t * 6),
      };
  }
}

/**
 * Run a rAF loop for the orb's CSS vars. The hook is a no-op render-side; all
 * work happens inside `requestAnimationFrame`. Uses refs only (no React state
 * updates per frame) per D-103.
 *
 * @param phase     — current orb phase, set by VoiceOrbWindow from Rust events.
 * @param orbRef    — DOM ref to the `.orb-overlay` element receiving the vars.
 * @param micRmsRef — ref-backed RMS 0..1 from useMicRms; read once per frame.
 */
export function useOrbPhase(
  phase: OrbPhase,
  orbRef: RefObject<HTMLDivElement | null>,
  micRmsRef: MutableRefObject<number>,
): void {
  const smoothedRef = useRef(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const start = performance.now();
    const tick = (t: number) => {
      const el = orbRef.current;
      if (!el) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }
      // EMA smoothing — locked 0.45·prev + 0.55·new (D-08 / motion.css --orb-rms-alpha)
      const raw = Math.max(0, Math.min(1, micRmsRef.current));
      smoothedRef.current = smoothedRef.current * 0.45 + raw * 0.55;
      const level = smoothedRef.current;

      const cfg = configFor(phase, level, (t - start) / 1000);
      el.style.setProperty('--ring-speed', String(cfg.ringSpeed));
      el.style.setProperty('--amp', cfg.amp.toFixed(4));
      el.style.setProperty('--alpha', cfg.alpha.toFixed(4));
      el.style.setProperty('--orb-scale', cfg.scale.toFixed(4));
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
    // micRmsRef + orbRef are refs (stable identity); only `phase` should re-run effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);
}
