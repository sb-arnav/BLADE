// src/features/dev-tools/DevToolsPane.tsx — Phase 59 Plan 59-01 (TRIO-DEV-PANE).
//
// Single `/dev-tools` developer pane that hosts the v2.0-held trio of features
// (Body Map, Organ Registry, Pixel World, Tentacle Detail, mortality-salience
// monitor, Ghost Mode) under a sub-tab navigation. These features ship as code
// (they're not removed) but they're demoted from the main nav until the
// external-operator engagement data verdict in v2.3+.
//
// Per workspace rule `feedback_no_feature_removal` — reorganize hierarchy,
// don't delete. Each tab renders the existing feature component lazily.
//
// The mortality-salience monitor is a small inline component that pulls
// the current `mortality_salience` scalar from `homeostasis_get` and shows
// it against the 0.3 informational threshold (the 0.6 emit-threshold is the
// separate "existential awareness elevated" line in homeostasis.rs:814).
//
// @see .planning/milestones/v2.2-REQUIREMENTS.md §Phase 59 TRIO-DEV-PANE
// @see .planning/decisions.md (entry dated 2026-05-14)

import { Suspense, lazy, useEffect, useState } from 'react';
import { GlassPanel, GlassSpinner } from '@/design-system/primitives';
import { homeostasisGet } from '@/lib/tauri/homeostasis';

// Reuse existing feature components — no duplication.
const BodyMap          = lazy(() => import('@/features/body/BodyMap').then((m) => ({ default: m.BodyMap })));
const OrganRegistry    = lazy(() => import('@/features/body/OrganRegistry').then((m) => ({ default: m.OrganRegistry })));
const AgentPixelWorld  = lazy(() => import('@/features/agents/AgentPixelWorld').then((m) => ({ default: m.AgentPixelWorld })));
const TentacleDetail   = lazy(() => import('@/features/hive/TentacleDetail').then((m) => ({ default: m.TentacleDetail })));
const MeetingGhostView = lazy(() => import('@/features/ghost/MeetingGhostView').then((m) => ({ default: m.MeetingGhostView })));

type TabId =
  | 'body-map'
  | 'organ-registry'
  | 'pixel-world'
  | 'tentacle-detail'
  | 'mortality-salience'
  | 'ghost-mode';

interface TabSpec {
  id: TabId;
  label: string;
  description: string;
}

const TABS: TabSpec[] = [
  { id: 'body-map',           label: 'Body Map',           description: '12 body-system overview (organ registry visualisation root).' },
  { id: 'organ-registry',     label: 'Organ Registry',     description: 'Per-organ autonomy + status registry.' },
  { id: 'pixel-world',        label: 'Pixel World',        description: 'Agent role grid (3×3 hormone-tinted cells).' },
  { id: 'tentacle-detail',    label: 'Tentacle Detail',    description: 'Single-tentacle drill-in + per-organ autonomy.' },
  { id: 'mortality-salience', label: 'Mortality Salience', description: 'TMT-shape behavioural scalar (read-only monitor).' },
  { id: 'ghost-mode',         label: 'Ghost Mode',         description: 'Meeting overlay configuration view.' },
];

export function DevToolsPane() {
  const [active, setActive] = useState<TabId>('body-map');

  return (
    <div
      className="dev-tools-pane"
      data-testid="dev-tools-pane-root"
      data-active-tab={active}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--s-4)',
        padding: 'var(--s-6)',
        minHeight: '100%',
      }}
    >
      <header style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s-2)' }}>
        <h1 className="t-h1" style={{ margin: 0 }}>
          Developer Tools
        </h1>
        <p style={{ margin: 0, color: 'var(--t-3)', fontSize: '0.85rem', maxWidth: '60ch' }}>
          Held-for-evaluation surfaces. These features ship as code; the
          external-operator engagement data verdict is pending. See decisions.md
          (2026-05-14) for the reorganisation note.
        </p>
      </header>

      <nav
        className="dev-tools-pane-tabs"
        role="tablist"
        aria-label="Developer tools tabs"
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 'var(--s-2)',
          borderBottom: '1px solid var(--glass-border, rgba(255,255,255,0.08))',
          paddingBottom: 'var(--s-2)',
        }}
      >
        {TABS.map((t) => {
          const isActive = active === t.id;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-controls={`dev-tools-panel-${t.id}`}
              id={`dev-tools-tab-${t.id}`}
              data-testid={`dev-tools-tab-${t.id}`}
              onClick={() => setActive(t.id)}
              style={{
                background: isActive ? 'var(--glass-bg-2, rgba(255,255,255,0.08))' : 'transparent',
                border: '1px solid var(--glass-border, rgba(255,255,255,0.08))',
                color: isActive ? 'var(--t-1)' : 'var(--t-3)',
                padding: 'var(--s-2) var(--s-3)',
                borderRadius: 'var(--r-2, 6px)',
                cursor: 'pointer',
                fontSize: '0.8rem',
                fontWeight: isActive ? 600 : 400,
              }}
            >
              {t.label}
            </button>
          );
        })}
      </nav>

      <section
        role="tabpanel"
        id={`dev-tools-panel-${active}`}
        aria-labelledby={`dev-tools-tab-${active}`}
        data-testid={`dev-tools-panel-${active}`}
        style={{ flex: 1, minHeight: 0 }}
      >
        <Suspense
          fallback={
            <div style={{ display: 'grid', placeItems: 'center', minHeight: '40vh' }}>
              <GlassSpinner size={28} label="Loading surface" />
            </div>
          }
        >
          {active === 'body-map'           && <BodyMap />}
          {active === 'organ-registry'     && <OrganRegistry />}
          {active === 'pixel-world'        && <AgentPixelWorld />}
          {active === 'tentacle-detail'    && <TentacleDetail />}
          {active === 'mortality-salience' && <MortalitySalienceMonitor />}
          {active === 'ghost-mode'         && <MeetingGhostView />}
        </Suspense>
      </section>
    </div>
  );
}

/**
 * MortalitySalienceMonitor — read-only display of the current `mortality_salience`
 * scalar against the 0.3 informational threshold (homeostasis.rs:73 doc comment,
 * Phase 26 safety-bundle cap-check). Polls `homeostasis_get` every 5s; the
 * scalar moves slowly enough that no event subscription is needed.
 */
function MortalitySalienceMonitor() {
  const [scalar, setScalar] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const threshold = 0.3;

  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      try {
        const state = await homeostasisGet();
        // mortality_salience is a Rust field on HormoneState; not present in
        // the TS type by default (added via cast). Serde-default to 0.0 if
        // missing.
        const v =
          typeof (state as { mortality_salience?: number }).mortality_salience === 'number'
            ? (state as { mortality_salience?: number }).mortality_salience ?? 0
            : 0;
        if (!cancelled) {
          setScalar(v);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError(typeof e === 'string' ? e : String(e));
      }
    }
    void refresh();
    const id = window.setInterval(refresh, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  const elevated = (scalar ?? 0) > threshold;

  return (
    <GlassPanel
      tier={1}
      data-testid="dev-tools-mortality-salience"
      style={{ padding: 'var(--s-6)', display: 'flex', flexDirection: 'column', gap: 'var(--s-4)' }}
    >
      <header style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s-2)' }}>
        <h2 className="t-h2" style={{ margin: 0 }}>
          Mortality Salience
        </h2>
        <p style={{ margin: 0, color: 'var(--t-3)', fontSize: '0.85rem', maxWidth: '60ch' }}>
          Phase 27 TMT-shape behavioural scalar. Phase 26 reads this against the
          0.3 informational threshold (capped at 0.8 in homeostasis.rs).
          Read-only monitor — adjust via homeostasis tick, not from here.
        </p>
      </header>

      {error && (
        <div role="alert" style={{ color: 'var(--color-red-500, #ef4444)', fontSize: '0.85rem' }}>
          Could not load homeostasis state: {error}
        </div>
      )}

      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 'var(--s-3)',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        <span
          data-testid="dev-tools-mortality-value"
          style={{
            fontSize: '2.4rem',
            fontWeight: 600,
            color: elevated ? 'var(--color-orange-500, #f97316)' : 'var(--t-1)',
          }}
        >
          {scalar === null ? '—' : scalar.toFixed(3)}
        </span>
        <span style={{ color: 'var(--t-3)', fontSize: '0.85rem' }}>
          threshold {threshold.toFixed(1)} · {elevated ? 'elevated' : 'nominal'}
        </span>
      </div>

      <div
        aria-hidden="true"
        style={{
          position: 'relative',
          height: '6px',
          borderRadius: '3px',
          background: 'var(--glass-bg-2, rgba(255,255,255,0.06))',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: `${Math.min(100, Math.max(0, (scalar ?? 0) * 100))}%`,
            background: elevated
              ? 'var(--color-orange-500, #f97316)'
              : 'var(--color-emerald-500, #10b981)',
            transition: 'width 200ms ease',
          }}
        />
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            left: `${threshold * 100}%`,
            top: '-2px',
            bottom: '-2px',
            width: '1px',
            background: 'var(--t-3)',
            opacity: 0.5,
          }}
        />
      </div>
    </GlassPanel>
  );
}
