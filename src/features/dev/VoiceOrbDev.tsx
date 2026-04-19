// src/features/dev/VoiceOrbDev.tsx — DEV-only isolation route for Voice Orb.
//
// Phase 4 Plan 04-07 Task 1f. Mounts <VoiceOrbWindow/> inside the main-window
// route tree so Playwright (which targets the main Vite dev server at :1420)
// can assert phase transitions without spinning up the real `overlay` window.
//
// The real Voice Orb window is a transparent borderless surface created by
// Rust at src-tauri/src/lib.rs:349-366. This dev route wraps the same
// component in a padded container so the orb's 440px footprint renders
// visibly and can be addressed by selectors.
//
// NOT a replacement for the real window — only used in:
//   1. `dev-voice-orb` route (gated on import.meta.env.DEV per router.ts)
//   2. tests/e2e/voice-orb-phases.spec.ts (SC-2 falsifier)
//
// Import orb.css here (not globally) so the dev route can render the exact
// visual surface the overlay window does. The `@/styles/index.css` tokens are
// already loaded by the main-window bootstrap.
//
// @see .planning/phases/04-overlay-windows/04-07-PLAN.md Sub-task 1f
// @see .planning/phases/04-overlay-windows/04-CONTEXT.md §D-103..D-108

import '@/features/voice-orb/orb.css';
import { VoiceOrbWindow } from '@/features/voice-orb';

export function VoiceOrbDev() {
  return (
    <div
      style={{
        padding: 40,
        minHeight: '80vh',
        display: 'grid',
        placeItems: 'center',
      }}
    >
      <VoiceOrbWindow />
    </div>
  );
}
