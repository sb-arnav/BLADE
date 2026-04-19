// src/features/dev/GhostDev.tsx — DEV-only isolation route for Ghost overlay.
//
// Phase 4 Plan 04-07 Task 1f. Mounts <GhostOverlayWindow/> inside the main-window
// route tree so Playwright (targets main Vite dev server at :1420) can
// assert D-10 headline-clipping + bullet constraints without spinning up the
// real `ghost_overlay` Tauri window.
//
// Ghost's Linux warning dialog blocks the card render on `navigator.platform`
// matching /linux/i — so the spec that drives this route pre-acks the
// warning via localStorage.setItem('blade_prefs_v1', {...ack: true}).
//
// D-09 discipline: this file sets NO cursor CSS (matches GhostOverlayWindow).
// The verify:ghost-no-cursor script greps src/features/ghost/ — not this dev
// file — but we stay consistent anyway.
//
// @see .planning/phases/04-overlay-windows/04-07-PLAN.md Sub-task 1f
// @see .planning/phases/04-overlay-windows/04-CONTEXT.md §D-110 (Linux warning)

import '@/features/ghost/ghost.css';
import { GhostOverlayWindow } from '@/features/ghost';

export function GhostDev() {
  return (
    <div
      style={{
        padding: 40,
        minHeight: '80vh',
        display: 'grid',
        placeItems: 'center',
      }}
    >
      <GhostOverlayWindow />
    </div>
  );
}
