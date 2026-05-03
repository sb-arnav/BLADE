// src/features/chat/VitalityIndicator.tsx
//
// Phase 29 Plan 04 (D-22) — Minimal vitality indicator for the chat header.
// Shows band-colored dot + scalar percentage + trend arrow. Returns null
// until the first blade_vitality_update event fires (zero visual weight on
// fresh installs or before the first hypothalamus tick).
//
// Full vitality detail is accessible from DoctorPane (Plan 03); this
// component is the at-a-glance organism health signal.
//
// @see .planning/phases/29-vitality-engine/29-CONTEXT.md §D-22
// @see src-tauri/src/vitality_engine.rs (emit site)

import { useState, useCallback } from 'react';
import { BLADE_EVENTS, useTauriEvent } from '@/lib/events';
import type { BladeVitalityUpdatePayload } from '@/lib/events/payloads';

/** Band -> color mapping (green/yellow/orange/red/grey for the 5 bands per D-22) */
const BAND_COLOR: Record<BladeVitalityUpdatePayload['band'], string> = {
  Thriving:  'var(--color-emerald-500, #10b981)',
  Waning:    'var(--color-yellow-500, #eab308)',
  Declining: 'var(--color-orange-500, #f97316)',
  Critical:  'var(--color-red-500, #ef4444)',
  Dormant:   'var(--color-neutral-400, #a3a3a3)',
};

/** Trend arrow: positive = up, negative = down, near-zero = stable */
function trendArrow(trend: number): string {
  if (trend > 0.01) return '↑';
  if (trend < -0.01) return '↓';
  return '→';
}

export function VitalityIndicator() {
  const [state, setState] = useState<BladeVitalityUpdatePayload | null>(null);

  const handleUpdate = useCallback((e: { payload: BladeVitalityUpdatePayload }) => {
    setState(e.payload);
  }, []);

  useTauriEvent<BladeVitalityUpdatePayload>(
    BLADE_EVENTS.BLADE_VITALITY_UPDATE,
    handleUpdate,
  );

  if (!state) return null; // no data yet -- invisible until first emission

  const pct = Math.round(state.scalar * 100);
  const color = BAND_COLOR[state.band] || BAND_COLOR.Dormant;
  const arrow = trendArrow(state.trend);

  return (
    <div
      className="vitality-indicator"
      title={`Vitality: ${pct}% (${state.band}) — ${state.top_factor}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        fontSize: '0.75rem',
        fontVariantNumeric: 'tabular-nums',
        color: 'var(--text-secondary, #888)',
        cursor: 'default',
        userSelect: 'none',
      }}
    >
      <span
        style={{
          width: '6px',
          height: '6px',
          borderRadius: '50%',
          backgroundColor: color,
          flexShrink: 0,
        }}
      />
      <span>{pct}%</span>
      <span style={{ fontSize: '0.65rem' }}>{arrow}</span>
    </div>
  );
}
