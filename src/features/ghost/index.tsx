// src/features/ghost/index.tsx — Phase 4 Plan 04-04
//
// Barrel export for Ghost Mode feature module. Window bootstrap
// (`src/windows/ghost/main.tsx`) imports `GhostOverlayWindow` from here.
//
// @see .planning/phases/04-overlay-windows/04-04-PLAN.md

export { GhostOverlayWindow } from './GhostOverlayWindow';
export { clipHeadline } from './clipHeadline';
export type { ClippedSuggestion } from './clipHeadline';
export { speakerColor, confColor } from './speakerColor';
