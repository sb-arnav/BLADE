// src/windows/main/main.tsx — Main window bootstrap (Phase 2 rewrite).
//
// Responsibility: create root + wrap in context providers + mount MainShell.
// All composition (TitleBar / NavRail / palette / overlays / onboarding gate)
// lives in MainShell.tsx (SC-5 — this file ≤ 80 non-blank/non-comment lines).
//
// Preserves Phase 1 D-29 P-01 perf marks (boot → first-paint). The measured
// cost now includes MainShell rendering but that's the intended floor for
// Phase 2; Phase 3 retests with the real Dashboard.
//
// @see .planning/phases/02-onboarding-shell/02-CONTEXT.md §D-51
// @see .planning/phases/01-foundation/01-CONTEXT.md §D-29

import '@/styles/index.css'; // Design tokens + Tailwind + glass + shell (FOUND-01)
// P-01 gate (D-29): performance.mark('boot') BEFORE any React work. CSS
// side-effect imports are hoisted by the bundler but kept literally above the
// mark for human readability — CSS parse is pre-React.
performance.mark('boot');

import React from 'react';
import { createRoot } from 'react-dom/client';
import { ConfigProvider, ToastProvider } from '@/lib/context';
import { MainShell } from './MainShell';

const el = document.getElementById('root');
if (!el) throw new Error('[main] no #root');

createRoot(el).render(
  <React.StrictMode>
    <ConfigProvider>
      <ToastProvider>
        <MainShell />
      </ToastProvider>
    </ConfigProvider>
  </React.StrictMode>,
);

// P-01 measurement: mark first paint on next frame after React mount. Phase 2
// cost now includes MainShell; Phase 3 retests with real Dashboard + ambient
// strip (D-29 floor, not ceiling).
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
