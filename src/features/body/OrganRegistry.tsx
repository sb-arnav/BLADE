// src/features/body/OrganRegistry.tsx — BODY-04.
//
// Plan 08-03 Task 2: real implementation.
//
// Renders organ_get_registry() as a list of expandable organ rows. Each row:
//   - Name chip + health chip (colored via status tokens on the Pill tone).
//   - Summary + observations count + capabilities count.
//   - Click toggles expand → capabilities list with per-capability autonomy
//     slider (0-5, integer step). Slider change:
//       level >= 4 → Dialog-gated confirm (D-204)
//       level < 4  → immediate organSetAutonomy call
//   - "View roster" button → Dialog with organGetRoster() raw text.
//
// @see .planning/phases/08-body-hive/08-03-PLAN.md Task 2
// @see .planning/phases/08-body-hive/08-CONTEXT.md §D-204
// @see .planning/REQUIREMENTS.md §BODY-04

import { useCallback, useEffect, useState } from 'react';
import { Button, Dialog, GlassPanel, GlassSpinner, Pill } from '@/design-system/primitives';
import { useToast } from '@/lib/context';
import { organGetRegistry, organGetRoster, organSetAutonomy } from '@/lib/tauri/body';
import type { OrganCapability, OrganStatus } from '@/lib/tauri/body';
import './body.css';

type PendingAutonomy = {
  organ: string;
  action: string;
  level: number;
};

function healthTone(health: string): 'free' | 'new' | 'pro' | 'default' {
  switch (health) {
    case 'active':
      return 'free';
    case 'dormant':
      return 'default';
    case 'error':
      return 'new';
    case 'disconnected':
      return 'pro';
    default:
      return 'default';
  }
}

export function OrganRegistry() {
  const toast = useToast();

  const [organs, setOrgans] = useState<OrganStatus[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Local view of capability autonomy levels (per organ+action) for immediate
  // UI feedback while the Rust write settles.
  const [levels, setLevels] = useState<Map<string, number>>(new Map());

  const [pending, setPending] = useState<PendingAutonomy | null>(null);
  const [busy, setBusy] = useState(false);

  const [rosterOpen, setRosterOpen] = useState(false);
  const [rosterText, setRosterText] = useState<string | null>(null);
  const [rosterBusy, setRosterBusy] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await organGetRegistry();
      setOrgans(rows);
      const next = new Map<string, number>();
      for (const org of rows) {
        for (const cap of org.capabilities) {
          next.set(`${org.name}::${cap.action}`, cap.autonomy_level);
        }
      }
      setLevels(next);
    } catch (e) {
      setError(typeof e === 'string' ? e : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const toggle = (name: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const writeAutonomy = async (organ: string, action: string, level: number) => {
    const key = `${organ}::${action}`;
    setBusy(true);
    try {
      await organSetAutonomy({ organ, action, level });
      setLevels((prev) => {
        const next = new Map(prev);
        next.set(key, level);
        return next;
      });
      toast.show({
        type: 'success',
        title: `Autonomy → ${level}`,
        message: `${organ} / ${action}`,
      });
    } catch (e) {
      toast.show({
        type: 'error',
        title: 'Autonomy update failed',
        message: typeof e === 'string' ? e : String(e),
      });
    } finally {
      setBusy(false);
      setPending(null);
    }
  };

  const requestAutonomy = (organ: string, action: string, rawLevel: number) => {
    const level = Math.max(0, Math.min(5, Math.round(rawLevel)));
    if (level >= 4) {
      setPending({ organ, action, level });
      return;
    }
    void writeAutonomy(organ, action, level);
  };

  const openRoster = async () => {
    setRosterOpen(true);
    if (rosterText !== null) return;
    setRosterBusy(true);
    try {
      const txt = await organGetRoster();
      setRosterText(txt);
    } catch (e) {
      setRosterText(`(Failed to load roster: ${String(e)})`);
    } finally {
      setRosterBusy(false);
    }
  };

  return (
    <GlassPanel tier={1} className="organ-registry-surface" data-testid="organ-registry-root">
      <header className="organ-registry-header">
        <div>
          <h1 className="organ-registry-title">Organ Registry</h1>
          <p className="organ-registry-sub">
            {organs ? `${organs.length} organs · ` : ''}
            tap a row to view capabilities + tune autonomy (0-5).
          </p>
        </div>
        <div className="organ-registry-actions">
          <Button
            variant="ghost"
            onClick={openRoster}
            disabled={rosterBusy}
            data-testid="organ-roster-button"
          >
            View roster
          </Button>
          <Button variant="secondary" onClick={reload} disabled={loading}>
            {loading ? 'Loading…' : 'Refresh'}
          </Button>
        </div>
      </header>

      {error && (
        <GlassPanel tier={2} className="body-map-error">
          <strong>Organ registry unavailable.</strong>
          <p>{error}</p>
        </GlassPanel>
      )}

      {loading && !organs && (
        <div className="body-map-loading">
          <GlassSpinner />
          <span>Reading organ registry…</span>
        </div>
      )}

      {organs && organs.length > 0 && (
        <ul className="organ-list">
          {organs.map((org) => {
            const isOpen = expanded.has(org.name);
            return (
              <li
                key={org.name}
                className={`organ-row${isOpen ? ' expanded' : ''}`}
                data-testid={`organ-row-${org.name}`}
              >
                <button
                  type="button"
                  className="organ-row-head"
                  aria-expanded={isOpen}
                  onClick={() => toggle(org.name)}
                >
                  <span className="organ-name">{org.name}</span>
                  <Pill tone={healthTone(org.health)}>{org.health}</Pill>
                  <span className="organ-summary">{org.summary}</span>
                  <span className="organ-counts">
                    {org.recent_observations.length} obs · {org.capabilities.length} caps
                  </span>
                  <span className="organ-chevron" aria-hidden>
                    {isOpen ? '▾' : '▸'}
                  </span>
                </button>
                {isOpen && (
                  <div className="organ-row-body">
                    {org.recent_observations.length > 0 && (
                      <ul className="organ-observations">
                        {org.recent_observations.slice(0, 5).map((obs, i) => (
                          <li key={i}>{obs}</li>
                        ))}
                      </ul>
                    )}
                    <table className="organ-caps-table">
                      <thead>
                        <tr>
                          <th>Action</th>
                          <th>Description</th>
                          <th>Mutating?</th>
                          <th>Autonomy</th>
                        </tr>
                      </thead>
                      <tbody>
                        {org.capabilities.map((cap: OrganCapability) => {
                          const key = `${org.name}::${cap.action}`;
                          const level = levels.get(key) ?? cap.autonomy_level;
                          return (
                            <tr key={cap.action}>
                              <td>
                                <code>{cap.action}</code>
                              </td>
                              <td>{cap.description}</td>
                              <td>
                                {cap.mutating ? (
                                  <Pill tone="new">mutating</Pill>
                                ) : (
                                  <Pill tone="default">read</Pill>
                                )}
                              </td>
                              <td>
                                <div className="organ-autonomy">
                                  <input
                                    type="range"
                                    min={0}
                                    max={5}
                                    step={1}
                                    value={level}
                                    disabled={busy}
                                    onChange={(e) =>
                                      requestAutonomy(
                                        org.name,
                                        cap.action,
                                        Number(e.target.value),
                                      )
                                    }
                                    aria-label={`${org.name} ${cap.action} autonomy`}
                                    data-testid={`organ-autonomy-${org.name}-${cap.action}`}
                                  />
                                  <span className="organ-autonomy-value">{level}</span>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {organs && organs.length === 0 && !loading && (
        <p className="body-system-detail-empty">No organs registered.</p>
      )}

      <Dialog
        open={pending !== null}
        onClose={() => setPending(null)}
        ariaLabel="Confirm high autonomy"
      >
        {pending && (
          <>
            <h3>Raise autonomy to {pending.level}?</h3>
            <p>
              Autonomy <strong>{pending.level}</strong> allows{' '}
              <code>{pending.organ}</code> / <code>{pending.action}</code> to act
              without asking first. Level 5 is fully autonomous.
            </p>
            <div className="body-dialog-actions">
              <Button
                variant="primary"
                onClick={() =>
                  pending &&
                  writeAutonomy(pending.organ, pending.action, pending.level)
                }
                disabled={busy}
              >
                {busy ? 'Saving…' : 'Confirm'}
              </Button>
              <Button variant="ghost" onClick={() => setPending(null)} disabled={busy}>
                Cancel
              </Button>
            </div>
          </>
        )}
      </Dialog>

      <Dialog
        open={rosterOpen}
        onClose={() => setRosterOpen(false)}
        ariaLabel="Organ roster"
      >
        <h3>Organ roster</h3>
        {rosterBusy ? (
          <div className="body-map-loading">
            <GlassSpinner />
            <span>Loading roster…</span>
          </div>
        ) : (
          <pre className="organ-roster-pre">{rosterText ?? ''}</pre>
        )}
        <div className="body-dialog-actions">
          <Button variant="ghost" onClick={() => setRosterOpen(false)}>
            Close
          </Button>
        </div>
      </Dialog>
    </GlassPanel>
  );
}
