// src/features/dashboard/TentacleSignalsCard.tsx — Phase 14 Plan 14-03 (WIRE2-02)
//
// Live "Hive Signals" dashboard card — replaces the ComingSoonCard placeholder.
// Fetches tentacle list from ecosystemListTentacles() on mount and renders
// up to 5 tentacles with enabled/disabled status dots.
// Empty state has a CTA to open Ecosystem settings (not a dead placeholder).
//
// @see src-tauri/src/ecosystem.rs
// @see src/lib/tauri/ecosystem.ts

import { useEffect, useState } from 'react';
import { GlassPanel } from '@/design-system/primitives';
import { ecosystemListTentacles } from '@/lib/tauri';
import { useRouterCtx } from '@/windows/main/useRouter';
import type { TentacleRecord } from '@/types/provider';

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + '…';
}

export function TentacleSignalsCard() {
  const { openRoute } = useRouterCtx();
  const [tentacles, setTentacles] = useState<TentacleRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    ecosystemListTentacles()
      .then(setTentacles)
      .catch(() => { /* silently degrade — backend may not be ready */ })
      .finally(() => setLoading(false));
  }, []);

  const enabled = tentacles.filter((t) => t.enabled);
  const displayed = tentacles.slice(0, 5);

  return (
    <GlassPanel
      tier={2}
      className="dash-card"
      role="region"
      aria-label={`Hive signals — ${enabled.length} active tentacles`}
    >
      <header className="dash-card-head">
        <h3 className="dash-card-title t-h3">Hive Signals</h3>
      </header>

      {loading && (
        <div aria-busy="true" aria-label="Loading hive signals">
          <div className="dash-card-skeleton" style={{ height: 14, borderRadius: 4, background: 'var(--g-fill-weak)', marginBottom: 'var(--s-2)' }} />
          <div className="dash-card-skeleton" style={{ height: 14, borderRadius: 4, background: 'var(--g-fill-weak)', width: '60%' }} />
        </div>
      )}

      {!loading && tentacles.length === 0 && (
        <p className="t-small dash-card-empty" style={{ color: 'var(--t-3)' }}>
          No tentacles active yet. Run deep scan to auto-configure.{' '}
          <button
            className="dash-card-cta"
            aria-label="Open Ecosystem settings to run deep scan"
            onClick={() => openRoute('settings-ecosystem')}
          >
            Open settings
          </button>
        </p>
      )}

      {!loading && tentacles.length > 0 && (
        <ul className="dash-card-list" aria-label="Active tentacles" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {displayed.map((t) => (
            <li key={t.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--s-2)', marginBottom: 'var(--s-1)' }}>
              <span
                aria-hidden="true"
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: t.enabled ? 'var(--a-cool)' : 'var(--t-4)',
                  flexShrink: 0,
                  marginTop: 5,
                }}
              />
              <span className="t-small" style={{ color: t.enabled ? 'var(--t-1)' : 'var(--t-3)' }}>
                <strong>{t.id}</strong>
                {t.rationale ? ` — ${truncate(t.rationale, 60)}` : ''}
              </span>
            </li>
          ))}
        </ul>
      )}

      {!loading && tentacles.length > 0 && (
        <footer style={{ marginTop: 'var(--s-2)', color: 'var(--t-3)', fontSize: 12 }}>
          {enabled.length}/{tentacles.length} active
        </footer>
      )}
    </GlassPanel>
  );
}
