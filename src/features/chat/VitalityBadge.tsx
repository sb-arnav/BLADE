// src/features/chat/VitalityBadge.tsx — Phase 59 Plan 59-03 (TRIO-VITALITY-EXPOSE).
//
// Small 1-character vitality glyph for the chat header bar. Subscribes to the
// Phase 53 / Phase 29 `BLADE_VITALITY_UPDATE` event (emitted by
// src-tauri/src/vitality_engine.rs on band transitions / scalar delta > 0.05).
// Renders nothing until the first event lands so fresh installs and
// pre-first-tick states stay silent.
//
// Glyph mapping (5 bands per src-tauri/src/vitality_engine.rs::VitalityBand):
//   Thriving  -> ⚡  (peak vitality, full power)
//   Waning    -> 🌀  (gentle drift, mid-band)
//   Declining -> 🌙  (low energy, conservation)
//   Critical  -> 💤  (near-dormancy, sleep-shape)
//   Dormant   -> 💤  (post-Phase-29 dormancy)
//
// This is a *separate* component from the existing VitalityIndicator (which
// shows scalar % + colored dot + trend arrow). VitalityBadge is the
// fingernail-sized at-a-glance unicode glyph the Phase 59 REQ asks for; the
// tooltip carries the band name so the visual weight stays at 1 character.
//
// @see .planning/milestones/v2.2-REQUIREMENTS.md §Phase 59 TRIO-VITALITY-EXPOSE
// @see src-tauri/src/vitality_engine.rs (emit site)
// @see src/lib/events/payloads.ts (BladeVitalityUpdatePayload)

import { useCallback, useState } from 'react';
import { BLADE_EVENTS, useTauriEvent } from '@/lib/events';
import type { BladeVitalityUpdatePayload } from '@/lib/events/payloads';

type Band = BladeVitalityUpdatePayload['band'];

const BAND_GLYPH: Record<Band, string> = {
  Thriving:  '⚡',
  Waning:    '🌀',
  Declining: '🌙',
  Critical:  '💤',
  Dormant:   '💤',
};

const BAND_TOOLTIP: Record<Band, string> = {
  Thriving:  'Thriving — peak vitality',
  Waning:    'Waning — gentle drift',
  Declining: 'Declining — conserving energy',
  Critical:  'Critical — near dormancy',
  Dormant:   'Dormant — recovering',
};

export function VitalityBadge() {
  const [state, setState] = useState<BladeVitalityUpdatePayload | null>(null);

  const handleUpdate = useCallback((e: { payload: BladeVitalityUpdatePayload }) => {
    setState(e.payload);
  }, []);

  useTauriEvent<BladeVitalityUpdatePayload>(
    BLADE_EVENTS.BLADE_VITALITY_UPDATE,
    handleUpdate,
  );

  if (!state) return null;

  const glyph = BAND_GLYPH[state.band] ?? '·';
  const tip = BAND_TOOLTIP[state.band] ?? state.band;

  return (
    <span
      className="vitality-badge"
      data-testid="vitality-badge"
      data-band={state.band}
      title={tip}
      role="status"
      aria-label={`Vitality: ${tip}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '20px',
        height: '20px',
        fontSize: '0.9rem',
        lineHeight: 1,
        userSelect: 'none',
        cursor: 'default',
      }}
    >
      {glyph}
    </span>
  );
}
