// Main window bootstrap — Phase 1 foundation
import '@/styles/index.css';  // Design tokens + Tailwind + glass + typography (FOUND-01)
// P-01 gate (D-29): performance.mark('boot') BEFORE any React work.
// CSS side-effect imports are hoisted by the bundler but kept literally above
// the mark for human readability — CSS parse is pre-React, what we measure is
// React bootstrap cost.
performance.mark('boot');

import React, { Suspense, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ConfigProvider } from '@/lib/context';
import { GlassSpinner } from '@/design-system/primitives';
import { DEFAULT_ROUTE_ID } from '@/lib/router';
import { ROUTE_MAP } from './router';
import { usePrefs } from '@/hooks/usePrefs';

/**
 * AppShell — minimal route renderer for Phase 1. Phase 2 Shell wraps this with
 * TitleBar + Nav + CommandPalette + ToastContext + GlobalOverlays. For Phase 1
 * we only need: prefs-driven initial route + ROUTE_MAP lookup + Suspense
 * fallback for lazy components. No keyboard shortcuts, no history — those land
 * in Phase 2 on top of this primitive (D-05 custom registry).
 */
function AppShell() {
  const { prefs } = usePrefs();
  const initialRouteId =
    prefs['app.lastRoute'] ?? prefs['app.defaultRoute'] ?? DEFAULT_ROUTE_ID;
  const [routeId] = useState<string>(
    typeof initialRouteId === 'string' ? initialRouteId : DEFAULT_ROUTE_ID,
  );

  const route = useMemo(
    () => ROUTE_MAP.get(routeId) ?? ROUTE_MAP.get(DEFAULT_ROUTE_ID),
    [routeId],
  );

  if (!route) {
    // T-07-03: unknown id + no default registered — unreachable once Task 2
    // lands (dashboard always present), but guard anyway.
    return <div style={{ padding: 40, color: '#ccc' }}>No routes registered yet.</div>;
  }

  const Cmp = route.component;
  return (
    <Suspense
      fallback={
        <div style={{ display: 'grid', placeItems: 'center', height: '100vh' }}>
          <GlassSpinner size={32} />
        </div>
      }
    >
      <Cmp />
    </Suspense>
  );
}

const el = document.getElementById('root');
if (!el) throw new Error('[main] no #root');
createRoot(el).render(
  <React.StrictMode>
    <ConfigProvider>
      <AppShell />
    </ConfigProvider>
  </React.StrictMode>,
);

// P-01 measurement: mark first paint on next frame after React mount. Phase 1's
// Dashboard is ComingSoonSkeleton so this is a FLOOR, not ceiling (D-29). Phase
// 3 retests with real Dashboard + ambient strip wiring.
requestAnimationFrame(() => {
  performance.mark('first-paint');
  try {
    performance.measure('boot-to-first-paint', 'boot', 'first-paint');
    const m = performance.getEntriesByName('boot-to-first-paint')[0];
    if (m) console.log(`[perf] boot-to-first-paint: ${m.duration.toFixed(1)}ms`);
  } catch {
    /* noop — perf API unavailable */
  }
});
