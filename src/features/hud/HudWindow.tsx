// src/features/hud/HudWindow.tsx — Phase 4 Plan 04-05.
//
// Top-level HUD bar component. Five chips left-to-right (D-113):
//   1. Time           (HudData.time)
//   2. Active app     (HudData.active_app, falls back to "—")
//   3. God-mode tier  (HudData.god_mode_status OR godmode_update event — most recent wins)
//   4. Hormone chip   (dominant of {arousal, exploration, urgency, trust, adrenaline} — reuses HormoneChip)
//   5. Meeting chip   (conditional — only when next_meeting_secs ≠ null)
//
// Click anywhere in the bar → toggleMainWindow() (D-114).
// Right-click anywhere    → opens HudMenu popover at cursor (D-114).
// On mount, reads get_primary_safe_area_insets and offsets the window's
// `top` position by insets.top so the bar sits below the macOS notch (D-115).
// Non-mac and command-failure both fall through to the default position.
//
// Subscribes ONLY through useTauriEvent / invokeTyped — no raw
// @tauri-apps/api/core or /event imports (D-13, D-34). The PhysicalPosition
// import is from @tauri-apps/api/window (NOT /core or /event), which is not
// banned by no-raw-tauri.js, and is intentionally dynamic so the cost is
// only paid on macOS where the heuristic returns a non-zero inset.
//
// @see .planning/phases/04-overlay-windows/04-05-PLAN.md Task 1b
// @see .planning/phases/04-overlay-windows/04-CONTEXT.md §D-113, §D-114, §D-115
// @see .planning/phases/04-overlay-windows/04-PATTERNS.md §9
// @see src-tauri/src/overlay_manager.rs `get_primary_safe_area_insets`,
//      `emit_route_request`, `overlay_hide_hud` (Plan 04-01)

import { useEffect, useRef, useState } from 'react';
import { BLADE_EVENTS, useTauriEvent } from '@/lib/events';
import type { HormoneUpdatePayload, GodmodeUpdatePayload } from '@/lib/events';
import { HormoneChip } from '@/features/dashboard/hormoneChip';
import { toggleMainWindow, getCurrentWebviewWindow } from '@/lib/tauri/window';
import { invokeTyped } from '@/lib/tauri/_base';
import { formatCountdown } from './formatCountdown';
import { HudMenu } from './HudMenu';

/**
 * Mirrors the Rust struct at src-tauri/src/overlay_manager.rs (HudData) field
 * for field. snake_case passthrough — no transform per D-38 / P-04.
 */
interface HudData {
  time: string;
  active_app: string;
  god_mode_status: string;
  unread_count: number;
  next_meeting_secs: number | null;
  next_meeting_name: string | null;
  meeting_active: boolean;
  meeting_name: string | null;
  speaker_name: string | null;
  hive_organs_active: number;
  hive_pending_decisions: number;
  hive_status_line: string;
}

/** Mirrors Rust `serde_json::json!({ "top": .., "bottom": .., "left": .., "right": .. })`. */
interface SafeAreaInsets {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/**
 * Hormones surfaced as candidates for the dominant chip. Limited to the five
 * most user-meaningful axes per D-113 — the other five (hunger/thirst/insulin/
 * leptin/energy_mode) are background metrics owned by Dashboard, not HUD.
 */
const SHOWN_HORMONES: (keyof HormoneUpdatePayload)[] = [
  'arousal',
  'exploration',
  'urgency',
  'trust',
  'adrenaline',
];

/**
 * God-mode tier accent. Color values match src.bak/components/HudBar.tsx:57-64
 * (D-17 retype, NOT import). 'off' / unknown falls through to a low-contrast
 * white so the chip stays present without drawing attention.
 */
function godTierColor(tier: string): string {
  switch (tier.toLowerCase()) {
    case 'extreme':
      return '#f59e0b';
    case 'intermediate':
      return '#6366f1';
    case 'normal':
      return '#34c759';
    default:
      return 'rgba(255, 255, 255, 0.25)';
  }
}

export function HudWindow() {
  const [data, setData] = useState<HudData | null>(null);
  const [tier, setTier] = useState<string>('off');
  const [hormones, setHormones] = useState<HormoneUpdatePayload | null>(null);
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
  // Track whether the safe-area offset has been applied to avoid double-offset
  // if the window is reloaded while React state persists (rare but cheap guard).
  const positionedRef = useRef(false);

  // ── Event subscriptions (D-13: useTauriEvent only) ──────────────────────
  useTauriEvent<HudData>(BLADE_EVENTS.HUD_DATA_UPDATED, (e) => {
    setData(e.payload);
    // hud_data_updated carries god_mode_status; respect it but the dedicated
    // godmode_update event below is more authoritative when both fire.
    if (e.payload.god_mode_status) {
      setTier(e.payload.god_mode_status);
    }
  });

  useTauriEvent<GodmodeUpdatePayload>(BLADE_EVENTS.GODMODE_UPDATE, (e) => {
    // GodmodeUpdatePayload.tier is sometimes 'Normal' / sometimes 'normal' depending
    // on the emit site — normalise to lowercase for godTierColor() switch matching.
    setTier(String(e.payload.tier ?? 'off').toLowerCase());
  });

  useTauriEvent<HormoneUpdatePayload>(BLADE_EVENTS.HORMONE_UPDATE, (e) => {
    setHormones(e.payload);
  });

  // ── Mount: notch-aware positioning (D-115) ──────────────────────────────
  // On macOS, get_primary_safe_area_insets returns { top: 37, ... } as a
  // conservative heuristic for all notched MacBooks. Non-mac returns zeros.
  // PhysicalPosition is dynamically imported so the @tauri-apps/api/window
  // bundle cost is only paid on platforms that need it.
  useEffect(() => {
    if (positionedRef.current) return;
    positionedRef.current = true;
    void (async () => {
      try {
        const insets = await invokeTyped<SafeAreaInsets>('get_primary_safe_area_insets');
        if (insets.top > 0) {
          const win = getCurrentWebviewWindow();
          const { PhysicalPosition } = await import('@tauri-apps/api/window');
          await win.setPosition(new PhysicalPosition(0, Math.round(insets.top)));
        }
      } catch {
        // Non-mac, command missing, or window-positioning denied — leave the
        // bar at its default Rust-side position (top: 0). The Rust heuristic
        // returns zeros on non-mac so this branch is rare in practice.
      }
    })();
  }, []);

  // Compute dominant hormone among the surfaced axes. reduce() is safe because
  // SHOWN_HORMONES is non-empty; on equal values the earlier entry wins
  // (deterministic, prevents flicker when two hormones tie).
  const dominant = hormones
    ? SHOWN_HORMONES.reduce((a, b) => (hormones[a] >= hormones[b] ? a : b))
    : null;

  return (
    <>
      <div
        className="hud-bar"
        role="toolbar"
        aria-label="BLADE HUD"
        onClick={() => {
          // Suppress click when the menu is open — right-click left a menu up
          // and a primary click on the bar should close it without also
          // popping the main window.
          if (menuPos) {
            setMenuPos(null);
            return;
          }
          void toggleMainWindow().catch(() => {
            /* main window toggle failure is non-fatal — swallow */
          });
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          setMenuPos({ x: e.clientX, y: e.clientY });
        }}
      >
        <span className="hud-chip hud-time">{data?.time ?? '--:--'}</span>
        <span className="hud-chip hud-app">{data?.active_app || '—'}</span>
        <span
          className="hud-chip hud-god"
          style={{ color: godTierColor(tier) }}
        >
          GM · {tier}
        </span>
        {dominant && hormones && (
          <HormoneChip
            name={String(dominant)}
            value={hormones[dominant]}
            dominant
          />
        )}
        {data?.next_meeting_secs != null && (
          <span className="hud-chip hud-meet">
            {data.next_meeting_name ?? 'Meeting'} in{' '}
            {formatCountdown(data.next_meeting_secs)}
          </span>
        )}
      </div>
      {menuPos && (
        <HudMenu pos={menuPos} onClose={() => setMenuPos(null)} />
      )}
    </>
  );
}
