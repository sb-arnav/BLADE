// src/features/ghost/index.tsx — Phase 4 Plan 04-04
//
// Barrel export for Ghost Mode feature module. Window bootstrap
// (`src/windows/ghost/main.tsx`) imports `GhostOverlayWindow` from here.
//
// Phase 11 Plan 11-05 adds a main-window-routable MeetingGhostView that gates
// on audio capability (PROV-08) — this is the view reachable via
// openRoute('meeting-ghost'). The live overlay continues to live in its own
// Tauri window unchanged.
//
// Phase 59 Plan 59-02 (TRIO-DEMOTE-NAV) — Ghost Mode is part of the v2.0-held
// trio; the main-window MeetingGhostView is demoted from ⌘K + NavRail via
// paletteHidden:true. The overlay-window itself is unchanged. The view is
// surfaced inside /dev-tools (DevToolsPane Ghost Mode tab).
//
// @see .planning/phases/04-overlay-windows/04-04-PLAN.md
// @see .planning/phases/11-smart-provider-setup/11-05-PLAN.md
// @see .planning/decisions.md (2026-05-14 — held-trio reorganized into /dev-tools)

import { lazy } from 'react';
import type { RouteDefinition } from '@/lib/router';

export { GhostOverlayWindow } from './GhostOverlayWindow';
export { MeetingGhostView } from './MeetingGhostView';
export { clipHeadline } from './clipHeadline';
export type { ClippedSuggestion } from './clipHeadline';
export { speakerColor, confColor } from './speakerColor';

const MeetingGhostViewLazy = lazy(() =>
  import('./MeetingGhostView').then((m) => ({ default: m.MeetingGhostView })),
);

export const routes: RouteDefinition[] = [
  {
    id: 'meeting-ghost',
    label: 'Meeting Ghost',
    section: 'core',
    component: MeetingGhostViewLazy,
    phase: 11,
    paletteHidden: true,
    description: 'Held-trio — surfaced inside /dev-tools.',
  },
];
