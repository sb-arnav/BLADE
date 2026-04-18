// src/features/onboarding/index.tsx — Onboarding (1 route, Phase 2).
//
// Route remains palette-hidden. The OnboardingFlow component here is the
// default render when openRoute('onboarding') is invoked from Settings
// (Phase 3) — the MainShell gate (Plan 02-06) bypasses this route and
// mounts OnboardingFlow directly with onComplete wired to re-gate. Keeping
// both paths alive means the flow is reachable via route OR gate.
//
// Fallback `onComplete` behavior: `window.location.reload()` forces a
// full re-boot, which re-runs the gate with fresh config — acceptable
// last-resort for the Settings re-trigger path.
//
// @see .planning/phases/02-onboarding-shell/02-CONTEXT.md §D-48
// @see .planning/REQUIREMENTS.md §ONBD-01..06

import { lazy } from 'react';
import type { RouteDefinition } from '@/lib/router';

const LazyOnboardingFlow = lazy(async () => {
  const { OnboardingFlow } = await import('./OnboardingFlow');
  // Route mount uses a fallback reload to re-evaluate the gate.
  const Component = () => (
    <OnboardingFlow
      onComplete={() => {
        window.location.reload();
      }}
    />
  );
  return { default: Component };
});

export const routes: RouteDefinition[] = [
  {
    id: 'onboarding',
    label: 'Onboarding',
    section: 'core',
    component: LazyOnboardingFlow,
    phase: 2,
    paletteHidden: true,
    description: 'First-run flow',
  },
];

// Re-exports for consumers (e.g. MainShell gate in Plan 02-06) that need the
// non-lazy symbol directly.
export { OnboardingFlow } from './OnboardingFlow';
export { useResetOnboarding } from './useResetOnboarding';
