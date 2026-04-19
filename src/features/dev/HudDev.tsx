// src/features/dev/HudDev.tsx — DEV-only isolation route for HUD bar.
//
// Phase 4 Plan 04-07 Task 1f. Mounts <HudWindow/> inside the main-window route
// tree so Playwright can assert the 5-chip layout + right-click menu without
// spinning up the real `blade_hud` Tauri window.
//
// HudWindow on mount calls `get_primary_safe_area_insets` via invokeTyped —
// the spec shim mocks that command to return zeros so the notch-aware
// position-offset branch is a no-op.
//
// @see .planning/phases/04-overlay-windows/04-07-PLAN.md Sub-task 1f
// @see .planning/phases/04-overlay-windows/04-CONTEXT.md §D-113 (5-chip layout)

import '@/features/hud/hud.css';
import { HudWindow } from '@/features/hud';

export function HudDev() {
  // HUD bar is position: fixed top:0 — leave a 40px top padding so the rest
  // of the page is still addressable if other content ever lands here. The
  // fixed-position bar floats above everything regardless.
  return (
    <div
      style={{
        padding: '60px 40px 40px 40px',
        minHeight: '80vh',
      }}
    >
      <HudWindow />
    </div>
  );
}
