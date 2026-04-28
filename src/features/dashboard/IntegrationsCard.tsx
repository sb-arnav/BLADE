// src/features/dashboard/IntegrationsCard.tsx — Phase 14 Plan 14-03 (WIRE2-02, WIRE2-03)
//
// Live "Integrations" dashboard card — replaces the ComingSoonCard placeholder.
// Shows connected (enabled) tentacles as service chips.
// Empty state has a CTA — not a dead placeholder.
//
// @see src-tauri/src/ecosystem.rs
// @see src/lib/tauri/ecosystem.ts

import { useEffect, useState } from 'react';
import { GlassPanel } from '@/design-system/primitives';
import { ecosystemListTentacles } from '@/lib/tauri';
import { useRouterCtx } from '@/windows/main/useRouter';
import type { TentacleRecord } from '@/types/provider';

/** Derive a short human-readable chip label from a tentacle id. */
function chipLabel(id: string): string {
  const map: Record<string, string> = {
    repo_watcher: 'GitHub',
    slack_monitor: 'Slack',
    deploy_monitor: 'Vercel',
    pr_watcher: 'PRs',
    session_bridge: 'AI session',
    calendar_monitor: 'Calendar',
  };
  return map[id] ?? id.replace(/_/g, ' ');
}

export function IntegrationsCard() {
  const { openRoute } = useRouterCtx();
  const [tentacles, setTentacles] = useState<TentacleRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    ecosystemListTentacles()
      .then(setTentacles)
      .catch(() => { /* silently degrade */ })
      .finally(() => setLoading(false));
  }, []);

  const enabled = tentacles.filter((t) => t.enabled);

  return (
    <GlassPanel
      tier={2}
      className="dash-card"
      role="region"
      aria-label={`Integrations — ${enabled.length} connected`}
    >
      <header className="dash-card-head">
        <h3 className="dash-card-title t-h3">Integrations</h3>
      </header>

      {loading && (
        <div aria-busy="true" aria-label="Loading integrations">
          <div className="dash-card-skeleton" style={{ height: 14, borderRadius: 4, background: 'var(--g-fill-weak)', marginBottom: 'var(--s-2)' }} />
          <div className="dash-card-skeleton" style={{ height: 14, borderRadius: 4, background: 'var(--g-fill-weak)', width: '50%' }} />
        </div>
      )}

      {!loading && enabled.length === 0 && (
        <p className="t-small dash-card-empty" style={{ color: 'var(--t-3)' }}>
          No integrations active. Run deep scan to connect services.{' '}
          <button
            className="dash-card-cta"
            aria-label="Open Ecosystem settings to connect integrations"
            onClick={() => openRoute('settings-ecosystem')}
          >
            Open settings
          </button>
        </p>
      )}

      {!loading && enabled.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--s-1)', marginBottom: 'var(--s-2)' }}>
          {enabled.map((t) => (
            <span
              key={t.id}
              className="t-small"
              style={{
                padding: '2px 6px',
                borderRadius: 'var(--r-sm)',
                background: 'var(--g-fill)',
                color: 'var(--t-2)',
                fontSize: 12,
              }}
            >
              {chipLabel(t.id)}
            </span>
          ))}
        </div>
      )}

      {!loading && enabled.length > 0 && (
        <footer style={{ color: 'var(--t-3)', fontSize: 12 }}>
          {enabled.length} connected
        </footer>
      )}
    </GlassPanel>
  );
}
