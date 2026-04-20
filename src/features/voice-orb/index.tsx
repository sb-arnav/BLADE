// src/features/voice-orb/index.tsx — barrel export + main-window route.
//
// VoiceOrb is imported by:
//   - src/windows/overlay/main.tsx                   (Plan 04-03 — this wave)
//   - src/features/quickask/QuickAskWindow.tsx       (Plan 04-02 — voice sub-view)
//
// Phase 11 Plan 11-05 adds a main-window-routable VoiceOrbView that gates on
// audio capability (PROV-08) — this is the view reachable via openRoute('voice-orb').

import { lazy } from 'react';
import type { RouteDefinition } from '@/lib/router';

export { VoiceOrb } from './VoiceOrb';
export type { VoiceOrbProps } from './VoiceOrb';
export { VoiceOrbWindow } from './VoiceOrbWindow';
export { VoiceOrbView } from './VoiceOrbView';
export { useOrbPhase } from './useOrbPhase';
export type { OrbPhase } from './useOrbPhase';
export { useMicRms } from './useMicRms';
export type { MicRmsHandle } from './useMicRms';

const VoiceOrbViewLazy = lazy(() => import('./VoiceOrbView').then((m) => ({ default: m.VoiceOrbView })));

export const routes: RouteDefinition[] = [
  // Phase 11 Plan 11-05 — audio capability-gap entry. Palette-hidden (the live
  // orb lives in an overlay window; this route is the main-window config/gate).
  { id: 'voice-orb', label: 'Voice Orb', section: 'core', component: VoiceOrbViewLazy, phase: 11, paletteHidden: true },
];
