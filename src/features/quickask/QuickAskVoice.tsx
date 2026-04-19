// src/features/quickask/QuickAskVoice.tsx (QUICK-04)
//
// Voice sub-view — wraps the Plan 04-03 <VoiceOrb compact/> inside a glass
// card. The orb's phase is owned by the standalone Voice Orb window
// (src/windows/overlay); the QuickAsk voice sub-mode renders the stateless
// VoiceOrb with its default `idle` phase so the user sees the resting pulse
// while speaking the query.
//
// Per D-18 the `.qa-voice` card gets backdrop-filter: blur(48px) — the SOLE
// documented exception to the D-07 blur caps (20/12/8). See quickask.css for
// the D-18 comment block.

import { VoiceOrb } from '@/features/voice-orb';

export function QuickAskVoice() {
  return (
    <div className="qa-voice" role="region" aria-label="Quick ask voice mode">
      <VoiceOrb compact />
      <p className="qa-voice-hint">Speak to BLADE — Tab for text · Esc to close</p>
    </div>
  );
}
