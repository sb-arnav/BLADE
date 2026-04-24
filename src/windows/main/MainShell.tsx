// src/windows/main/MainShell.tsx — Composed main-window shell (D-48, D-51).
//
// Responsibilities (factored out of what would otherwise be a 1,300-line
// App.tsx — the src.bak shape D-17 forbids us from resurrecting):
//   1. Gate on onboarding state → mount OnboardingFlow or full shell
//   2. Compose TitleBar + NavRail + Suspense(lazy route) + GlobalOverlays
//   3. Mount BackendToastBridge (pipes 3 Rust events to toast)
//   4. Own CommandPalette open state; wire useGlobalShortcuts
//
// Budget: ≤ 220 non-blank / non-comment lines (SC-5 headroom). Current
// footprint leaves room for Phase 9 polish without breaching the line cap.
//
// T-02-06-03 mitigation: the full route tree (Suspense + RouteSlot + palette)
// is rendered ONLY when `status === 'complete'`. During onboarding the palette
// is not mounted, so `openRoute('dashboard')` via ⌘K cannot escape the flow.
// T-02-06-05 mitigation (same single-gate site).
//
// @see .planning/phases/02-onboarding-shell/02-CONTEXT.md §D-48, §D-51, §D-61

import { Suspense, useCallback, useState } from 'react';
import { BackendToastBridge } from '@/lib/context';
import { GlassSpinner, ErrorBoundary } from '@/design-system/primitives';
import {
  TitleBar,
  NavRail,
  CommandPalette,
  GlobalOverlays,
} from '@/design-system/shell';
import { RouterProvider, useRouterCtx } from './useRouter';
import { useGlobalShortcuts } from './useGlobalShortcuts';
import { useOnboardingGate } from './useOnboardingGate';
import { ShortcutHelp } from './ShortcutHelp';
import { ROUTE_MAP } from './router';
import { DEFAULT_ROUTE_ID } from '@/lib/router';
import { OnboardingFlow } from '@/features/onboarding';
// Phase 4 Plan 04-06 (D-116) — hoist ChatProvider from the chat route up to
// MainShell so the QuickAskBridge can inject user-turns via injectUserMessage
// regardless of the currently-active route. QuickAskBridge subscribes to
// BLADE_QUICKASK_BRIDGED and is a zero-DOM event bridge.
import { ChatProvider, QuickAskBridge } from '@/features/chat';
// Phase 14 Plan 14-01 (LOG-01, M-07) — ActivityLogProvider wraps ShellContent
// so ActivityStrip is a descendant and has access to the log context.
import { ActivityLogProvider } from '@/features/activity-log';
import { ActivityStrip } from '@/features/activity-log/ActivityStrip';

export function MainShell() {
  return (
    <RouterProvider>
      <ChatProvider>
        <ActivityLogProvider>
          <BackendToastBridge />
          <QuickAskBridge />
          <ShellContent />
        </ActivityLogProvider>
      </ChatProvider>
    </RouterProvider>
  );
}

function ShellContent() {
  const gate = useOnboardingGate();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutHelpOpen, setShortcutHelpOpen] = useState(false);
  const openPalette = useCallback(() => setPaletteOpen(true), []);
  const closePalette = useCallback(() => setPaletteOpen(false), []);
  // Phase 9 Plan 09-05 (D-222) — ⌘? shortcut help panel.
  const openShortcutHelp = useCallback(() => setShortcutHelpOpen(true), []);
  const closeShortcutHelp = useCallback(() => setShortcutHelpOpen(false), []);

  // Must be mounted INSIDE RouterProvider — the hook calls useRouterCtx.
  // T-02-06-06 accepted: shortcuts still fire in the onboarding branch, but
  // the route tree isn't mounted so only the prefs write takes effect.
  useGlobalShortcuts({ openPalette, openShortcutHelp });

  if (gate.status === 'checking') {
    return (
      <div className="main-shell" role="application" aria-busy="true">
        <TitleBar />
        <div className="main-shell-body">
          <NavRail />
          <div
            className="main-shell-route"
            style={{ display: 'grid', placeItems: 'center' }}
          >
            <GlassSpinner size={32} label="Starting BLADE" />
          </div>
        </div>
      </div>
    );
  }

  if (gate.status !== 'complete') {
    // Onboarding branch — no NavRail, no RouteSlot, no palette. Single-gate
    // site (T-02-06-03): the route tree is unreachable until the gate flips
    // to 'complete' via reEvaluate().
    return (
      <div className="main-shell" role="application" data-gate-status={gate.status}>
        <TitleBar />
        <OnboardingFlow onComplete={gate.reEvaluate} />
      </div>
    );
  }

  return (
    <div className="main-shell" role="application" data-gate-status="complete">
      <TitleBar />
      <ActivityStrip />
      <div className="main-shell-body">
        <NavRail />
        <div className="main-shell-route" data-shell-route>
          <RouteSlot />
        </div>
      </div>
      <GlobalOverlays />
      <CommandPalette open={paletteOpen} onClose={closePalette} />
      <ShortcutHelp open={shortcutHelpOpen} onClose={closeShortcutHelp} />
    </div>
  );
}

function RouteSlot() {
  const { routeId } = useRouterCtx();
  const route = ROUTE_MAP.get(routeId) ?? ROUTE_MAP.get(DEFAULT_ROUTE_ID);
  if (!route) {
    return (
      <div style={{ padding: 40, color: 'var(--t-3)' }}>
        No routes registered.
      </div>
    );
  }
  const Cmp = route.component;
  return (
    <Suspense fallback={<SuspenseFallback />}>
      <ErrorBoundary resetKey={route.id}>
        <div data-route-id={route.id}>
          <Cmp />
        </div>
      </ErrorBoundary>
    </Suspense>
  );
}

function SuspenseFallback() {
  return (
    <div style={{ display: 'grid', placeItems: 'center', minHeight: '70vh' }}>
      <GlassSpinner size={32} />
    </div>
  );
}
