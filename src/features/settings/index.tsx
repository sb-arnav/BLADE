// src/features/settings/index.tsx — Settings feature routes (Phase 3 Plan 03-06).
//
// Replaces the Phase 1 ComingSoonSkeleton stubs with a real tabbed SettingsShell.
// All 11 entries (parent `settings` + 10 child tabs) point at the SAME lazy-loaded
// SettingsShell — the shell derives the active pane from `useRouterCtx().routeId`.
//
// Migration-ledger notes (D-79):
//   • `settings-integrations` → renamed to `settings-iot` (label "IoT")
//   • `settings-ambient`      → renamed to `settings-personality` (label "Personality")
//   • NEW: `settings-models`, `settings-routing`, `settings-appearance`,
//          `settings-privacy`, `settings-diagnostics` to match ROADMAP SET-01..10.
// Legacy `settings-ghost`, `settings-autonomy`, `settings-shortcuts`,
// `settings-advanced` are NOT re-exported here — Phase 1 declared them as
// paletteHidden keyboard routes; they remain referenced in the migration ledger
// and are reachable via other plans if needed. Phase 3 ROADMAP top-level is
// only the 10 SET-01..10 tabs.
//
// @see .planning/phases/03-dashboard-chat-settings/03-CONTEXT.md §D-79
// @see .planning/phases/03-dashboard-chat-settings/03-PATTERNS.md §9
// @see .planning/REQUIREMENTS.md §SET-01..10

import { lazy } from 'react';
import type { RouteDefinition } from '@/lib/router';
import './settings.css';

const SettingsShell = lazy(() =>
  import('./SettingsShell').then((m) => ({ default: m.SettingsShell })),
);

// Palette-only action: locks the screen immediately then navigates back.
// Component is never rendered as a full view — the command palette invokes it
// via its action() callback (Phase 14 Plan 14-02, WIRE2-04).
const LockScreenAction = lazy(() =>
  import('./LockScreenAction').then((m) => ({ default: m.LockScreenAction })),
);

export const routes: RouteDefinition[] = [
  { id: 'settings',              label: 'Settings',    section: 'core', component: SettingsShell, phase: 3, shortcut: 'Mod+,' },
  { id: 'settings-providers',    label: 'Providers',   section: 'core', component: SettingsShell, phase: 3 },
  { id: 'settings-models',       label: 'Models',      section: 'core', component: SettingsShell, phase: 3 },
  { id: 'settings-routing',      label: 'Routing',     section: 'core', component: SettingsShell, phase: 3 },
  { id: 'settings-voice',        label: 'Voice',       section: 'core', component: SettingsShell, phase: 3 },
  { id: 'settings-personality',  label: 'Personality', section: 'core', component: SettingsShell, phase: 3 },
  { id: 'settings-appearance',   label: 'Appearance',  section: 'core', component: SettingsShell, phase: 3 },
  { id: 'settings-iot',          label: 'IoT',         section: 'core', component: SettingsShell, phase: 3 },
  { id: 'settings-privacy',      label: 'Privacy',     section: 'core', component: SettingsShell, phase: 3 },
  { id: 'settings-diagnostics',  label: 'Diagnostics', section: 'core', component: SettingsShell, phase: 3 },
  { id: 'settings-about',        label: 'About',       section: 'core', component: SettingsShell, phase: 3 },
  { id: 'settings-ecosystem',    label: 'Ecosystem',   section: 'core', component: SettingsShell, phase: 13 },
  // Phase 59 Plan 59-02 (TRIO-DEMOTE-NAV) — settings "Developer" tab.
  { id: 'settings-developer',    label: 'Developer',   section: 'core', component: SettingsShell, phase: 59 },
  // Palette-only — locks screen immediately; never rendered as a full page route
  {
    id: 'system-lock-screen',
    label: 'Lock Screen',
    section: 'core',
    component: LockScreenAction,
    phase: 14,
    paletteHidden: false,
    description: 'Lock your screen immediately',
  },
];
