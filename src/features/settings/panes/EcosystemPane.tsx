// src/features/settings/panes/EcosystemPane.tsx — Phase 13 Plan 13-02 (ECOSYS-07, ECOSYS-08)
//
// Settings pane listing auto-enabled observer tentacles with rationale and toggle.
// Follows DeepScanPrivacySection toggle pattern (PrivacyPane.tsx).
// OBSERVE_ONLY badge always visible — tentacles are read-only in v1.1.
//
// @see src-tauri/src/ecosystem.rs
// @see .planning/phases/13-self-configuring-ecosystem/13-RESEARCH.md §Pattern 5

import { useEffect, useState } from 'react';
import { Card, GlassPanel } from '@/design-system/primitives';
import {
  ecosystemListTentacles,
  ecosystemToggleTentacle,
} from '@/lib/tauri';
import { useToast } from '@/lib/context';
import type { TentacleRecord } from '@/types/provider';

// Human-readable labels for each tentacle id
const TENTACLE_LABELS: Record<string, string> = {
  repo_watcher:     'Repository watcher',
  slack_monitor:    'Slack monitor',
  deploy_monitor:   'Deploy monitor',
  pr_watcher:       'PR watcher',
  session_bridge:   'AI session bridge',
  calendar_monitor: 'Calendar monitor',
};

const TENTACLE_DESCS: Record<string, string> = {
  repo_watcher:     'Watches detected repos for git activity and file changes (read-only).',
  slack_monitor:    'Monitors Slack for mentions and messages — never replies (read-only).',
  deploy_monitor:   'Polls Vercel for deploy status — never triggers deploys (read-only).',
  pr_watcher:       'Watches GitHub PRs and review requests — never merges (read-only).',
  session_bridge:   'Bridges active Cursor / Claude Code session context (read-only).',
  calendar_monitor: 'Reads upcoming calendar events from Google Calendar (read-only).',
};

export function EcosystemPane() {
  const { show } = useToast();
  const [tentacles, setTentacles] = useState<TentacleRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    ecosystemListTentacles()
      .then(setTentacles)
      .catch(() => show({ type: 'error', title: 'Could not load ecosystem tentacles.' }))
      .finally(() => setLoading(false));
  }, []);

  const handleToggle = async (id: string, next: boolean) => {
    const prev = tentacles;
    // Optimistic update
    setTentacles((ts) => ts.map((t) => (t.id === id ? { ...t, enabled: next } : t)));
    try {
      await ecosystemToggleTentacle(id, next);
      const label = TENTACLE_LABELS[id] ?? id;
      show({ type: 'success', title: `${label} ${next ? 'enabled' : 'disabled'}.` });
    } catch {
      setTentacles(prev);
      show({ type: 'error', title: "Couldn't save toggle. Try again." });
    }
  };

  return (
    <Card data-testid="ecosystem-pane">
      <section aria-labelledby="ecosystem-heading">
        <h3 id="ecosystem-heading">Ecosystem — Observer Tentacles</h3>
        <p className="settings-notice">
          BLADE auto-enables these read-only observer tentacles based on what your deep scan found.
          Each tentacle watches its service but never acts — no replies, deploys, or merges in v1.1.
        </p>

        {/* OBSERVE_ONLY badge — always visible in v1.1 */}
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 'var(--s-1)',
            padding: '4px 10px',
            borderRadius: 'var(--r-sm)',
            background: 'rgba(255,255,255,0.07)',
            fontSize: 12,
            color: 'var(--t-2)',
            marginBottom: 'var(--s-3)',
            fontVariantCaps: 'all-small-caps',
            letterSpacing: '0.04em',
          }}
          aria-label="Observe only mode active in v1.1"
        >
          Observe only (v1.1)
        </div>

        {loading && (
          <p style={{ color: 'var(--t-3)', fontSize: 14 }}>Loading…</p>
        )}

        {!loading && tentacles.length === 0 && (
          <p style={{ color: 'var(--t-3)', fontSize: 14 }}>
            No tentacles enabled yet. Run a deep scan to let BLADE discover your environment.
          </p>
        )}

        {!loading && tentacles.length > 0 && (
          <GlassPanel tier={2} style={{ borderRadius: 'var(--r-md)', marginBottom: 'var(--s-4)' }}>
            {tentacles.map((record, idx) => {
              const isLast = idx === tentacles.length - 1;
              return (
                <div
                  key={record.id}
                  id={`ecosystem-tentacle-${record.id}`}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '28px 1fr',
                    gap: 'var(--s-2)',
                    minHeight: 64,
                    padding: 'var(--s-2) var(--s-3)',
                    borderBottom: isLast ? 'none' : '1px solid var(--line)',
                    alignItems: 'center',
                    opacity: record.enabled ? 1 : 0.5,
                  }}
                >
                  <input
                    type="checkbox"
                    id={`ecosystem-toggle-${record.id}`}
                    checked={record.enabled}
                    aria-describedby={`ecosystem-desc-${record.id}`}
                    onChange={(e) => handleToggle(record.id, e.target.checked)}
                    style={{ width: 16, height: 16, cursor: 'pointer', accentColor: 'var(--a-cool)' }}
                  />
                  <label htmlFor={`ecosystem-toggle-${record.id}`} style={{ cursor: 'pointer' }}>
                    <div
                      className="t-body"
                      style={{ color: record.enabled ? 'var(--t-1)' : 'var(--t-3)', fontSize: 15, fontWeight: 400, marginBottom: 2 }}
                    >
                      {TENTACLE_LABELS[record.id] ?? record.id}
                    </div>
                    <div
                      id={`ecosystem-desc-${record.id}`}
                      className="t-small"
                      style={{ color: 'var(--t-3)', fontSize: 13, lineHeight: 1.45 }}
                    >
                      {TENTACLE_DESCS[record.id] ?? ''}
                    </div>
                    {record.rationale && (
                      <div
                        className="t-small"
                        style={{ color: 'var(--a-cool)', fontSize: 12, fontStyle: 'italic', marginTop: 2 }}
                      >
                        {record.rationale}
                      </div>
                    )}
                  </label>
                </div>
              );
            })}
          </GlassPanel>
        )}
      </section>
    </Card>
  );
}
