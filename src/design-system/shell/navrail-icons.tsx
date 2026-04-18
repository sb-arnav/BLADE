// src/design-system/shell/navrail-icons.tsx — Inline SVG icons keyed by route id + section.
//
// Phase 2 ships ~12 icons inline (no icon-registry module — there is none
// yet). Phase 9 polish can hoist to a shared registry if the set grows.
//
// Rendering strategy: each entry is a bag of SVG children (paths, rects,
// polygons). `NavIcon` wraps them in a single <svg> with consistent viewBox /
// stroke styling so the rail stays visually coherent. Fallback chain is
// route-id → section → generic dot (keeps the rail from rendering blank if a
// future feature forgets to register an icon).
//
// @see .planning/phases/02-onboarding-shell/02-CONTEXT.md §D-55

import type { ReactNode } from 'react';
import type { Section } from '@/lib/router';

const ICONS: Record<string, ReactNode> = {
  // Core
  dashboard: (
    <>
      <rect x="2" y="2" width="7" height="7" rx="1.5" />
      <rect x="11" y="2" width="7" height="7" rx="1.5" />
      <rect x="2" y="11" width="7" height="7" rx="1.5" />
      <rect x="11" y="11" width="7" height="7" rx="1.5" />
    </>
  ),
  chat: (
    <path d="M18 13a2 2 0 01-2 2H6l-4 3V4a2 2 0 012-2h12a2 2 0 012 2v9z" />
  ),
  settings: (
    <>
      <circle cx="10" cy="10" r="3" />
      <path d="M10 2v2M10 16v2M2 10h2M16 10h2M4.2 4.2l1.4 1.4M14.4 14.4l1.4 1.4M4.2 15.8l1.4-1.4M14.4 5.6l1.4-1.4" />
    </>
  ),
  // Per-section defaults (matched by Section name when routeId isn't in the map)
  agents: (
    <>
      <circle cx="6" cy="6" r="3" />
      <circle cx="14" cy="14" r="3" />
      <path d="M7 8l5 4" />
    </>
  ),
  knowledge: (
    <>
      <path d="M3 4h14v12H3z" />
      <path d="M3 8h14M8 4v12" />
    </>
  ),
  life: (
    // Heart — Life OS cluster
    <path d="M10 17s-6-4-6-9a4 4 0 017-2 4 4 0 017 2c0 5-6 9-6 9z" />
  ),
  identity: (
    <>
      <circle cx="10" cy="6" r="3" />
      <path d="M3 17c0-3 3-5 7-5s7 2 7 5" />
    </>
  ),
  dev: (
    <>
      <polyline points="6 7 2 10 6 13" />
      <polyline points="14 7 18 10 14 13" />
    </>
  ),
  admin: (
    <>
      <rect x="3" y="3" width="14" height="14" rx="2" />
      <path d="M7 10h6M7 7h6M7 13h3" />
    </>
  ),
  body: (
    <>
      <circle cx="10" cy="5" r="2.5" />
      <path d="M10 8v9" />
      <path d="M5 12h10M7 17l3-3 3 3" />
    </>
  ),
  hive: (
    <>
      <polygon points="10 2 16 6 16 14 10 18 4 14 4 6" />
      <circle cx="10" cy="10" r="2" />
    </>
  ),
};

interface NavIconProps {
  routeId: string;
  section: Section;
}

export function NavIcon({ routeId, section }: NavIconProps) {
  const node = ICONS[routeId] ?? ICONS[section] ?? <circle cx="10" cy="10" r="3" />;
  return (
    <svg
      viewBox="0 0 20 20"
      className="nav-icon"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {node}
    </svg>
  );
}
