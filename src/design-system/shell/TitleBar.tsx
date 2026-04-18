// src/design-system/shell/TitleBar.tsx — main-window chrome bar (SHELL-01, D-54).
//
// Height: var(--title-height) from src/styles/layout.css (40px).
// Drag region: data-tauri-drag-region on the root; interactive children
// (traffic lights, the status pill, the ⌘K hint) opt out via
// data-tauri-drag-region="false" so clicks land on buttons, not drags.
// Layout: 3-column grid — traffic lights (left), title + live status pill
// (center), ⌘K hint chip (right).
//
// No role switcher — role-switching is Phase 6 IDEN scope (D-54). Mining
// the src.bak/TitleBar.tsx role-switcher is explicitly forbidden (D-17).
//
// Window controls: typed wrappers from Plan 02-01 (`src/lib/tauri/window.ts`
// via the `@/lib/tauri` barrel). Raw `@tauri-apps/api/window.getCurrentWindow`
// is NOT banned by the `no-raw-tauri` ESLint rule (that rule targets raw
// `invoke` from `@tauri-apps/api/core` and raw `listen` from
// `@tauri-apps/api/event`), but wrapping keeps a single named surface for
// future mock-in-test work (D-36 file-per-cluster).
//
// @see .planning/phases/02-onboarding-shell/02-CONTEXT.md §D-54
// @see .planning/phases/02-onboarding-shell/02-03-PLAN.md (this plan)
// @see src/lib/tauri/window.ts (Plan 02-01)

import { useState } from 'react';
import { BLADE_EVENTS, useTauriEvent } from '@/lib/events';
import type { BladeStatusPayload } from '@/lib/events';
import {
  minimizeWindow,
  closeWindow,
  toggleMaximize,
} from '@/lib/tauri';

type Status = 'processing' | 'thinking' | 'idle' | 'error';

const STATUS_LABEL: Record<Status, string> = {
  processing: 'Working',
  thinking: 'Thinking',
  idle: 'Ready',
  error: 'Error',
};

export function TitleBar() {
  const [status, setStatus] = useState<Status>('idle');

  // Backend `blade_status` emits the status string directly as the payload
  // (type BladeStatusPayload = 'processing' | 'thinking' | 'idle' | 'error').
  // Narrow defensively via literal check before calling setState so an
  // unexpected string from a future Rust drift can't poison component state
  // (T-02-03-02 mitigation).
  useTauriEvent<BladeStatusPayload>(BLADE_EVENTS.BLADE_STATUS, (e) => {
    const next = e.payload;
    if (
      next === 'processing' ||
      next === 'thinking' ||
      next === 'idle' ||
      next === 'error'
    ) {
      setStatus(next);
    }
  });

  return (
    <header
      className="titlebar"
      data-tauri-drag-region
      role="banner"
      aria-label="Window chrome"
    >
      {/* Left zone — macOS-style traffic lights. Tauri abstracts
          close/minimize across all 3 platforms so the BLADE-native aesthetic
          stays consistent (D-15 single aesthetic). Interactive children opt
          out of drag so clicks land on the buttons. */}
      <div className="titlebar-traffic" data-tauri-drag-region="false">
        <button
          type="button"
          className="tlight tlight-close"
          aria-label="Close window"
          onClick={() => { void closeWindow(); }}
        >
          <span aria-hidden="true">×</span>
        </button>
        <button
          type="button"
          className="tlight tlight-min"
          aria-label="Minimize window"
          onClick={() => { void minimizeWindow(); }}
        >
          <span aria-hidden="true">–</span>
        </button>
        <button
          type="button"
          className="tlight tlight-max"
          aria-label="Toggle maximize"
          onClick={() => { void toggleMaximize(); }}
        >
          <span aria-hidden="true">+</span>
        </button>
      </div>

      {/* Center zone — title + live status pill. The title region itself
          is still draggable (no opt-out) so users can grab the middle of
          the bar to move the window. The pill opts out so future clickable
          UX (e.g. open activity panel) doesn't initiate a drag. */}
      <div className="titlebar-title" data-tauri-drag-region>
        <span className="titlebar-brand">BLADE</span>
        <span
          className={`titlebar-status titlebar-status-${status}`}
          data-tauri-drag-region="false"
          aria-live="polite"
        >
          <span className="titlebar-status-dot" aria-hidden="true" />
          {STATUS_LABEL[status]}
        </span>
      </div>

      {/* Right zone — ⌘K hint chip. Visual only in Wave 1; Plan 02-05
          wires the actual keyboard capture and palette open. */}
      <div
        className="titlebar-hint"
        data-tauri-drag-region="false"
        aria-hidden="true"
      >
        <kbd>⌘K</kbd>
      </div>
    </header>
  );
}
