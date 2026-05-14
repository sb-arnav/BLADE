// src/features/settings/SettingsShell.tsx — Phase 3 Plan 03-06 (D-79).
//
// Tabbed shell: 10-entry vertical nav on the left, lazy-loaded pane on the
// right. Each tab id maps 1:1 to a child RouteDefinition. The same shell
// component is referenced by ALL 11 route entries (parent `settings` +
// 10 children); which pane renders is derived from `useRouterCtx().routeId`.
//
// When `routeId === 'settings'` (the parent landing route) the shell defaults
// to the Providers pane.
//
// @see .planning/phases/03-dashboard-chat-settings/03-PATTERNS.md §9
// @see .planning/phases/03-dashboard-chat-settings/03-CONTEXT.md §D-79

import { Suspense, lazy } from 'react';
import { GlassSpinner } from '@/design-system/primitives';
import { useRouterCtx } from '@/windows/main/useRouter';

const PANES = {
  'settings-providers':    lazy(() => import('./panes/ProvidersPane').then(m => ({ default: m.ProvidersPane }))),
  'settings-models':       lazy(() => import('./panes/ModelsPane').then(m => ({ default: m.ModelsPane }))),
  'settings-routing':      lazy(() => import('./panes/RoutingPane').then(m => ({ default: m.RoutingPane }))),
  'settings-voice':        lazy(() => import('./panes/VoicePane').then(m => ({ default: m.VoicePane }))),
  'settings-personality':  lazy(() => import('./panes/PersonalityPane').then(m => ({ default: m.PersonalityPane }))),
  'settings-appearance':   lazy(() => import('./panes/AppearancePane').then(m => ({ default: m.AppearancePane }))),
  'settings-iot':          lazy(() => import('./panes/IoTPane').then(m => ({ default: m.IoTPane }))),
  'settings-privacy':      lazy(() => import('./panes/PrivacyPane').then(m => ({ default: m.PrivacyPane }))),
  'settings-diagnostics':  lazy(() => import('./panes/DiagnosticsEntryPane').then(m => ({ default: m.DiagnosticsEntryPane }))),
  'settings-about':        lazy(() => import('./panes/AboutPane').then(m => ({ default: m.AboutPane }))),
  'settings-ecosystem':    lazy(() => import('./panes/EcosystemPane').then(m => ({ default: m.EcosystemPane }))),
  // Phase 59 Plan 59-02 (TRIO-DEMOTE-NAV) — "Developer" section. Single-click
  // handoff to /dev-tools + list of the v2.0-held trio surfaces hosted there.
  'settings-developer':    lazy(() => import('./panes/DeveloperPane').then(m => ({ default: m.DeveloperPane }))),
} as const;

type PaneId = keyof typeof PANES;

const TABS: { id: PaneId; label: string }[] = [
  { id: 'settings-providers',   label: 'Providers' },
  { id: 'settings-models',      label: 'Models' },
  { id: 'settings-routing',     label: 'Routing' },
  { id: 'settings-voice',       label: 'Voice' },
  { id: 'settings-personality', label: 'Personality' },
  { id: 'settings-appearance',  label: 'Appearance' },
  { id: 'settings-iot',         label: 'IoT' },
  { id: 'settings-privacy',     label: 'Privacy' },
  { id: 'settings-diagnostics', label: 'Diagnostics' },
  { id: 'settings-about',       label: 'About' },
  { id: 'settings-ecosystem',   label: 'Ecosystem' },
  { id: 'settings-developer',   label: 'Developer' },
];

export function SettingsShell() {
  const { routeId, openRoute } = useRouterCtx();
  const activeId: PaneId = (routeId === 'settings'
    ? 'settings-providers'
    : (routeId in PANES ? (routeId as PaneId) : 'settings-providers'));
  const Pane = PANES[activeId];

  return (
    <div className="settings-shell">
      <nav className="settings-tabs" aria-label="Settings sections">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`settings-tab ${activeId === t.id ? 'is-active' : ''}`}
            onClick={() => openRoute(t.id)}
            aria-current={activeId === t.id ? 'page' : undefined}
            type="button"
          >
            {t.label}
          </button>
        ))}
      </nav>
      <div className="settings-pane">
        <Suspense fallback={<GlassSpinner size={28} label="Loading settings pane" />}>
          <Pane />
        </Suspense>
      </div>
    </div>
  );
}
