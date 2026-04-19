// src/features/voice-orb/VoiceOrb.tsx (ORB-01, ORB-02)
//
// Stateless orb renderer — accepts `phase` + `micRmsRef` from the parent so it
// is reusable from BOTH:
//   1. VoiceOrbWindow (Plan 04-03 — owns phase state machine + mic acquisition)
//   2. QuickAsk voice sub-view (Plan 04-02 — passes its own phase via `compact`)
//
// The renderer is intentionally pure: 6 SVG/DOM nodes (3 rings + 2 arcs + core),
// no per-frame React state, all animation driven by CSS vars written by
// `useOrbPhase`. Phase variants drive color overrides via `data-phase`.
//
// @see .planning/phases/04-overlay-windows/04-CONTEXT.md §D-103
// @see docs/design/voice-orb-states.html
// @see docs/design/orb.css (ported to ./orb.css)

import { useRef } from 'react';
import type { MutableRefObject } from 'react';
import { useOrbPhase, type OrbPhase } from './useOrbPhase';

export interface VoiceOrbProps {
  /** When true, renders at compact 320px footprint for the QuickAsk voice card. */
  compact?: boolean;
  /** Phase driven by Rust voice_conversation_* events (see VoiceOrbWindow). */
  phase?: OrbPhase;
  /** Optional external RMS ref. When omitted, a local zero-ref is used (no mic). */
  micRmsRef?: MutableRefObject<number>;
}

export function VoiceOrb({
  compact = false,
  phase = 'idle',
  micRmsRef: externalRef,
}: VoiceOrbProps) {
  const internalRef = useRef(0);
  const micRmsRef = externalRef ?? internalRef;
  const orbRef = useRef<HTMLDivElement>(null);
  useOrbPhase(phase, orbRef, micRmsRef);

  return (
    <div
      ref={orbRef}
      className={`orb-overlay${compact ? ' orb-compact' : ''}`}
      data-phase={phase}
      role="img"
      aria-label={`Voice orb ${phase}`}
    >
      <svg className="orb-rings" viewBox="-220 -220 440 440" aria-hidden="true">
        <circle className="ring ring-0" cx="0" cy="0" r="90" />
        <circle className="ring ring-1" cx="0" cy="0" r="90" />
        <circle className="ring ring-2" cx="0" cy="0" r="90" />
      </svg>
      <svg className="orb-arcs" viewBox="-220 -220 440 440" aria-hidden="true">
        <circle className="arc arc-1" cx="0" cy="0" r="70" />
        <circle className="arc arc-2" cx="0" cy="0" r="70" />
      </svg>
      <div className="orb-core" />
    </div>
  );
}
