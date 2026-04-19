// src/features/dashboard/AmbientStrip.tsx — DASH-02 hormone consumer.
//
// Subscribes BLADE_EVENTS.HORMONE_UPDATE (WIRE-02 rename target, parallel-
// emitted with legacy HOMEOSTASIS_UPDATE — see D-64). The Rust homeostasis
// loop fires hormone_update on a 60s tick (homeostasis.rs:424) so the first
// paint would otherwise be an empty strip for up to a minute — we also call
// homeostasisGet() on mount to populate immediately (D-75 first-paint rule).
//
// Dominant hormone is computed client-side (Math.max across the 5 SHOWN_KEYS)
// per D-75: the Rust struct exposes all 10 scalars but Phase 3 shows the
// 5 high-salience ones (arousal / energy_mode / exploration / urgency / trust).
// The other 5 (hunger / thirst / insulin / adrenaline / leptin) land via the
// typed state for Phase 4 HUD reuse (HormoneChip already knows their colors).
//
// The state type is HormoneState — superset of HormoneUpdatePayload (which
// omits last_updated). On event, we coerce by adding last_updated: Date.now()
// so the component never deals with two shapes. T-03-05-03 mitigation: field
// names match Rust struct verbatim (snake_case passthrough per D-38).
//
// P-06 discipline: uses useTauriEvent (the ONLY permitted listen surface per
// D-13). `cancelled` flag guards the async homeostasisGet against unmount
// races so the state setter never fires after unmount.
//
// @see .planning/phases/03-dashboard-chat-settings/03-CONTEXT.md §D-75
// @see .planning/phases/03-dashboard-chat-settings/03-PATTERNS.md §8
// @see src-tauri/src/homeostasis.rs:424 (hormone_update parallel emit)

import { useEffect, useState } from 'react';
import { BLADE_EVENTS, useTauriEvent } from '@/lib/events';
import type { HormoneUpdatePayload } from '@/lib/events';
import { homeostasisGet } from '@/lib/tauri/homeostasis';
import type { HormoneState } from '@/types/hormones';
import { HormoneChip } from './hormoneChip';

/** Five high-salience hormones surfaced in the Ambient strip row. Remaining
 *  5 (hunger/thirst/insulin/adrenaline/leptin) exist in state for Phase 4
 *  HUD reuse but are intentionally not rendered here to keep the strip
 *  scannable (D-75). */
const SHOWN_KEYS: readonly (keyof HormoneState)[] = [
  'arousal',
  'energy_mode',
  'exploration',
  'urgency',
  'trust',
] as const;

function payloadToState(p: HormoneUpdatePayload): HormoneState {
  // HORMONE_UPDATE payload is 10 fields; HormoneState adds last_updated.
  // Event doesn't carry a timestamp — we stamp it client-side so consumers
  // that read `last_updated` (Phase 4 HUD freshness indicator) get a sane
  // value instead of 0. Not authoritative — just "received at".
  return { ...p, last_updated: Date.now() };
}

export function AmbientStrip() {
  const [state, setState] = useState<HormoneState | null>(null);

  // First-paint fetch: the HORMONE_UPDATE event only fires on the 60s tick;
  // without this, a freshly mounted dashboard shows an empty strip for up to
  // a minute. homeostasisGet returns the full 11-field snapshot.
  useEffect(() => {
    let cancelled = false;
    homeostasisGet()
      .then((snap) => { if (!cancelled) setState(snap); })
      .catch(() => { /* initial fetch failure is non-fatal; events will catch up */ });
    return () => { cancelled = true; };
  }, []);

  // Live updates via the WIRE-02 hormone_update emit (src-tauri/src/
  // homeostasis.rs:424). useTauriEvent handles the listen/unlisten dance and
  // the dev-only __BLADE_LISTENERS_COUNT__ counter (P-06).
  useTauriEvent<HormoneUpdatePayload>(BLADE_EVENTS.HORMONE_UPDATE, (e) => {
    setState(payloadToState(e.payload));
  });

  if (!state) {
    return (
      <div className="ambient-strip ambient-strip-empty" role="status" aria-live="polite">
        Reading hormones…
      </div>
    );
  }

  // Dominant = argmax over the SHOWN_KEYS scalars. Computed per render (5
  // comparisons — cheaper than memoizing).
  const dominant = SHOWN_KEYS.reduce((a, b) =>
    (state[a] as number) >= (state[b] as number) ? a : b,
  );

  return (
    <section className="ambient-strip" aria-label="Ambient hormone state">
      <HormoneChip name={String(dominant)} value={state[dominant] as number} dominant />
      {SHOWN_KEYS.filter((k) => k !== dominant).map((k) => (
        <HormoneChip key={String(k)} name={String(k)} value={state[k] as number} />
      ))}
    </section>
  );
}
