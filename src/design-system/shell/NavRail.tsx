// src/design-system/shell/NavRail.tsx — Derived left rail (SHELL-02, D-55, D-56).
//
// Reads PALETTE_COMMANDS — adding a RouteDefinition anywhere auto-surfaces in
// the rail with no NavRail.tsx edit (SHELL-02 acceptance). The `paletteHidden`
// filter baked into PALETTE_COMMANDS also hides the Onboarding route (D-56)
// using the same rule that hides it from ⌘K.
//
// Layout: 62px-wide sticky column under the TitleBar.
//   - Logo (static)
//   - 3 core icons (dashboard / chat / settings) in a fixed order
//   - Divider
//   - One icon per non-core section (first RouteDefinition in that section).
//
// Active state: exact routeId match for core, or `routeId.startsWith(section + '-')`
// for section-first icons so sub-routes (e.g. `settings-providers`) still
// highlight the cluster.
//
// @see .planning/phases/02-onboarding-shell/02-CONTEXT.md §D-55, §D-56
// @see .planning/phases/02-onboarding-shell/02-PATTERNS.md §9

import { PALETTE_COMMANDS } from '@/windows/main/router';
import type { RouteDefinition } from '@/lib/router';
import { useRouterCtx } from '@/windows/main/useRouter';
import { NavIcon } from './navrail-icons';

const CORE_ORDER = ['dashboard', 'chat', 'settings'] as const;

export function NavRail() {
  const { routeId, openRoute } = useRouterCtx();

  const core = CORE_ORDER.map((id) => PALETTE_COMMANDS.find((c) => c.id === id)).filter(
    (x): x is RouteDefinition => Boolean(x),
  );

  // First non-core route per section — kept uncluttered per D-55.
  const perSection = new Map<string, RouteDefinition>();
  for (const r of PALETTE_COMMANDS) {
    if (r.section !== 'core' && !perSection.has(r.section)) {
      perSection.set(r.section, r);
    }
  }

  return (
    <nav className="navrail" aria-label="Primary">
      <div className="navrail-logo" aria-hidden="true">B</div>
      {core.map((r) => (
        <NavBtn
          key={r.id}
          route={r}
          active={routeId === r.id}
          onClick={() => openRoute(r.id)}
        />
      ))}
      <div className="navrail-divider" aria-hidden="true" />
      {[...perSection.values()].map((r) => (
        <NavBtn
          key={r.id}
          route={r}
          active={routeId === r.id || routeId.startsWith(`${r.section}-`)}
          onClick={() => openRoute(r.id)}
        />
      ))}
    </nav>
  );
}

interface NavBtnProps {
  route: RouteDefinition;
  active: boolean;
  onClick: () => void;
}

function NavBtn({ route, active, onClick }: NavBtnProps) {
  return (
    <button
      type="button"
      className={`navrail-btn ${active ? 'active' : ''}`}
      onClick={onClick}
      data-route-id={route.id}
      aria-label={route.label}
      aria-current={active ? 'page' : undefined}
    >
      <NavIcon routeId={route.id} section={route.section} />
      <span className="navrail-tip" role="tooltip">{route.label}</span>
    </button>
  );
}
