// src/features/settings/index.tsx — Settings feature routes (10 tabs).
// Phase 1 stubs per SET-01..10. Phase 3 replaces each with real Settings panes.
//
// @see .planning/phases/01-foundation/01-CONTEXT.md §D-40
// @see .planning/REQUIREMENTS.md §SET-01..10

import { lazy } from 'react';
import type { RouteDefinition } from '@/lib/router';

const skeleton = (label: string, phase: number) =>
  lazy(async () => {
    const { ComingSoonSkeleton } = await import('@/design-system/primitives');
    const Component = () => <ComingSoonSkeleton routeLabel={label} phase={phase} />;
    return { default: Component };
  });

export const routes: RouteDefinition[] = [
  { id: 'settings',              label: 'Settings',     section: 'core', component: skeleton('Settings', 3),              phase: 3, shortcut: 'Mod+,' },
  { id: 'settings-providers',    label: 'Providers',    section: 'core', component: skeleton('Providers', 3),             phase: 3 },
  { id: 'settings-integrations', label: 'Integrations', section: 'core', component: skeleton('Integrations', 3),          phase: 3 },
  { id: 'settings-voice',        label: 'Voice',        section: 'core', component: skeleton('Voice Settings', 3),        phase: 3 },
  { id: 'settings-ghost',        label: 'Ghost Mode',   section: 'core', component: skeleton('Ghost Mode Settings', 3),   phase: 3 },
  { id: 'settings-ambient',      label: 'Ambient',      section: 'core', component: skeleton('Ambient Settings', 3),      phase: 3 },
  { id: 'settings-autonomy',     label: 'Autonomy',     section: 'core', component: skeleton('Autonomy Settings', 3),     phase: 3 },
  { id: 'settings-shortcuts',    label: 'Shortcuts',    section: 'core', component: skeleton('Shortcuts', 3),             phase: 3 },
  { id: 'settings-advanced',     label: 'Advanced',     section: 'core', component: skeleton('Advanced', 3),              phase: 3 },
  { id: 'settings-about',        label: 'About',        section: 'core', component: skeleton('About', 3),                 phase: 3 },
];
