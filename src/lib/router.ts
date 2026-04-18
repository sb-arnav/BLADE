// src/lib/router.ts — custom route registry contract (FOUND-07, D-39).
// Adding a route costs 1 file + 1 entry (FOUND-08) per D-40 feature-index pattern.
//
// D-05: custom registry — NO react-router-dom. Navigation is state-managed in
// the window shell; ROUTE_MAP lookup + lazy component render is the entire
// contract. Later phases layer keyboard shortcuts, history, and deep-link
// hydration on top of this primitive without touching the shape.
//
// @see .planning/phases/01-foundation/01-CONTEXT.md §D-05, §D-39, §D-40-default
// @see .planning/research/ARCHITECTURE.md §"route registry contract"

import type { ComponentType, LazyExoticComponent } from 'react';

export type Section =
  | 'core'
  | 'agents'
  | 'knowledge'
  | 'life'
  | 'identity'
  | 'dev'
  | 'admin'
  | 'body'
  | 'hive';

export interface RouteDefinition {
  /** Kebab-case unique identifier (e.g. 'dashboard', 'settings-providers'). */
  id: string;
  /** Human-readable label surfaced in nav + ⌘K palette. */
  label: string;
  /** Section enum — drives nav grouping + palette grouping. */
  section: Section;
  /** React.lazy-wrapped component (D-44: Phase-1 stubs point to ComingSoonSkeleton). */
  component: LazyExoticComponent<ComponentType<any>>;
  /** Optional icon element for nav + palette. */
  icon?: ComponentType;
  /** Keyboard shortcut (e.g. 'Mod+K'). */
  shortcut?: string;
  /** true = excluded from ⌘K palette (D-40-palette: dev-only surfaces + onboarding). */
  paletteHidden?: boolean;
  /** Palette subtitle — optional short description. */
  description?: string;
  /** Phase number this route ships in — drives ComingSoonSkeleton + migration ledger. */
  phase?: number;
}

/**
 * Default route id when prefs have no `app.defaultRoute` / `app.lastRoute`
 * (D-40-default). Consumers resolve via `prefs['app.lastRoute'] ??
 * prefs['app.defaultRoute'] ?? DEFAULT_ROUTE_ID`.
 */
export const DEFAULT_ROUTE_ID = 'dashboard';
