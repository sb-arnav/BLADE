// src/features/hud/index.tsx — Phase 4 Plan 04-05 barrel.
//
// Single named export surface for the HUD feature. The window bootstrap at
// src/windows/hud/main.tsx imports `HudWindow` from here; tests import
// `formatCountdown` and `HudMenu` directly through this barrel as well.
//
// @see .planning/phases/04-overlay-windows/04-05-PLAN.md Task 1c

export { HudWindow } from './HudWindow';
export { HudMenu } from './HudMenu';
export type { HudMenuProps } from './HudMenu';
export { formatCountdown } from './formatCountdown';
