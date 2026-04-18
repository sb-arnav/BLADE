// src/design-system/shell/GlobalOverlays.tsx — SHELL-05 plumbing (D-61).
//
// Phase 2 ships STUBS: each overlay mounts, subscribes to its event via the
// P-06-safe useTauriEvent hook, and renders a small dev pill in DEV builds
// proving the plumbing works. Phase 3 replaces each body with the real UI
// (ambient strip lives in Dashboard; catchup and nudge cards render here).
//
// T-02-06-07 mitigation: listeners unmount cleanly via the P-06-tested
// useTauriEvent teardown (Phase 1 Plan 01-09 Playwright spec). The dev-only
// __BLADE_LISTENERS_COUNT__ counter on window observes the +3 / -3 behaviour
// when MainShell mounts and unmounts.
//
// @see .planning/phases/02-onboarding-shell/02-CONTEXT.md §D-61

import { useState } from 'react';
import { BLADE_EVENTS, useTauriEvent } from '@/lib/events';
import type {
  ProactiveNudgePayload,
  GodmodeUpdatePayload,
  BladeStatusPayload,
} from '@/lib/events';

export function GlobalOverlays() {
  return (
    <div className="global-overlays" aria-hidden="true">
      {import.meta.env.DEV && (
        <>
          <CatchupStub />
          <AmbientStripStub />
          <ProactiveNudgeStub />
        </>
      )}
    </div>
  );
}

function CatchupStub() {
  const [status, setStatus] = useState<string>('idle');
  useTauriEvent<BladeStatusPayload>(BLADE_EVENTS.BLADE_STATUS, (e) => {
    setStatus(String(e.payload));
  });
  return (
    <div className="overlay-stub overlay-catchup" data-overlay="catchup">
      catchup · {status}
    </div>
  );
}

function AmbientStripStub() {
  const [dominant, setDominant] = useState<string>('—');
  useTauriEvent<GodmodeUpdatePayload>(BLADE_EVENTS.GODMODE_UPDATE, (e) => {
    setDominant(String(e.payload.tier ?? '—'));
  });
  return (
    <div className="overlay-stub overlay-ambient" data-overlay="ambient">
      ambient · {dominant}
    </div>
  );
}

function ProactiveNudgeStub() {
  const [last, setLast] = useState<string>('');
  useTauriEvent<ProactiveNudgePayload>(BLADE_EVENTS.PROACTIVE_NUDGE, (e) => {
    setLast(e.payload.message ?? '');
  });
  return (
    <div className="overlay-stub overlay-nudge" data-overlay="nudge">
      nudge · {last || 'none'}
    </div>
  );
}
