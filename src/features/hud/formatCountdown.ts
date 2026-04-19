// src/features/hud/formatCountdown.ts — Phase 4 Plan 04-05.
//
// Pure helper that formats a "seconds-until" value as a compact human string
// for the HUD meeting chip:
//
//   < 60s      → "35s"
//   < 60 min   → "12m"
//   ≥ 60 min   → "1h 5m"   (rem > 0)
//                "2h"      (rem = 0)
//
// Negative inputs clamp to 0 ("0s") so a stale countdown never renders as
// "-12s" — Rust may briefly emit a negative value during the transition from
// "next meeting" to "meeting active" before `meeting_active` flips.
//
// D-17: retyped (NOT imported) from src.bak/components/HudBar.tsx:48-55. The
// src.bak reference is dead code; the formula is shared by reading not by
// importing.
//
// @see .planning/phases/04-overlay-windows/04-05-PLAN.md Task 1a
// @see .planning/phases/04-overlay-windows/04-CONTEXT.md §D-17

export function formatCountdown(secs: number): string {
  if (!Number.isFinite(secs) || secs < 60) {
    return `${Math.max(0, Math.floor(secs))}s`;
  }
  const m = Math.floor(secs / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem > 0 ? `${h}h ${rem}m` : `${h}h`;
}
