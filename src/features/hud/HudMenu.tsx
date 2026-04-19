// src/features/hud/HudMenu.tsx — Phase 4 Plan 04-05.
//
// Right-click popover menu rendered above the HUD bar. Four items per D-114:
//   1. Open BLADE          → toggleMainWindow()
//   2. Open Chat           → emit_route_request('chat')   + toggleMainWindow()
//   3. Hide HUD            → overlay_hide_hud
//   4. Settings            → emit_route_request('settings-voice') + toggleMainWindow()
//
// All Tauri IPC routes through the typed wrapper layer:
//   - toggleMainWindow → invokeTyped('toggle_window')
//   - emit_route_request / overlay_hide_hud → invokeTyped (raw command names
//     are not wrapped in src/lib/tauri/ because they are HUD-internal; the
//     invokeTyped surface is the lint boundary, not the wrapper).
//
// Click-outside and Escape both close the menu (standard popover affordance).
// Mousedown handler is intentionally on `window` so a click anywhere outside
// dismisses without needing a portal — the menu is rendered as a sibling of
// .hud-bar so its own clicks bubble through .hud-menu and DON'T match the
// outside-check (ref.current.contains(e.target)).
//
// @see .planning/phases/04-overlay-windows/04-05-PLAN.md Task 2a
// @see .planning/phases/04-overlay-windows/04-CONTEXT.md §D-114
// @see src-tauri/src/overlay_manager.rs:347 emit_route_request,
//      :280 overlay_hide_hud
// @see src-tauri/src/lib.rs:187 toggle_window

import { useEffect, useRef } from 'react';
import { invokeTyped } from '@/lib/tauri/_base';
import { toggleMainWindow } from '@/lib/tauri/window';

export interface HudMenuProps {
  pos: { x: number; y: number };
  onClose: () => void;
}

export function HudMenu({ pos, onClose }: HudMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  // Click-outside + Escape both dismiss. Listeners attach to `window`, not the
  // menu, so a click anywhere off the popover closes it. The handler skips
  // closing when the target is inside the menu (re-entrant clicks on the
  // menu's own items handle their own onClose).
  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  /**
   * Curried handler for "navigate to a specific route in the main window".
   * Order matters: emit the route request first so main subscribes BEFORE the
   * window pop animation; then toggle the main window so it's visible. If the
   * main window is already focused, toggle is a no-op (Rust-side guard).
   */
  const goToRoute = (routeId: string) => async () => {
    try {
      await invokeTyped<void, { route_id: string }>('emit_route_request', {
        route_id: routeId,
      });
      await toggleMainWindow();
    } catch {
      // Non-fatal — invalid route ids are silently no-op'd by main's router
      // (T-04-05-02 mitigation in the plan threat model).
    }
    onClose();
  };

  return (
    <div
      ref={ref}
      className="hud-menu"
      role="menu"
      aria-label="HUD context menu"
      style={{ left: pos.x, top: pos.y }}
    >
      <button
        role="menuitem"
        type="button"
        onClick={async () => {
          try {
            await toggleMainWindow();
          } catch {
            /* swallow — non-fatal */
          }
          onClose();
        }}
      >
        Open BLADE
      </button>
      <button role="menuitem" type="button" onClick={goToRoute('chat')}>
        Open Chat
      </button>
      <button
        role="menuitem"
        type="button"
        onClick={async () => {
          try {
            await invokeTyped<void>('overlay_hide_hud');
          } catch {
            /* swallow — non-fatal */
          }
          onClose();
        }}
      >
        Hide HUD
      </button>
      <button role="menuitem" type="button" onClick={goToRoute('settings-voice')}>
        Settings
      </button>
    </div>
  );
}
