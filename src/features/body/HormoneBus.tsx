// src/features/body/HormoneBus.tsx — BODY-03 (SC-2 falsifier).
//
// Plan 08-03 Task 2: real implementation.
//
// Renders:
//   - 10 hormone bar meters (from @/types/hormones HormoneState fields).
//   - Dominant-hormone chip + value.
//   - 24-bar circadian histogram with current-hour highlighted.
//   - Module directive lookup (homeostasisGetDirective input).
//   - Dialog-gated "Relearn circadian" button (homeostasisRelearnCircadian).
//
// Event subscription:
//   - useTauriEvent(BLADE_EVENTS.HORMONE_UPDATE) -> setState(e.payload) — live update.
//
// @see .planning/phases/08-body-hive/08-03-PLAN.md Task 2
// @see .planning/phases/08-body-hive/08-CONTEXT.md §D-203 (SC-2 falsifier)
// @see .planning/phases/08-body-hive/08-PATTERNS.md §3
// @see .planning/REQUIREMENTS.md §BODY-03

import { useEffect, useMemo, useState } from 'react';
import { Button, Dialog, GlassPanel, GlassSpinner, Input, Pill } from '@/design-system/primitives';
import { useToast } from '@/lib/context';
import { BLADE_EVENTS, useTauriEvent } from '@/lib/events';
import {
  homeostasisGet,
  homeostasisGetCircadian,
  homeostasisGetDirective,
  homeostasisRelearnCircadian,
} from '@/lib/tauri/homeostasis';
import type { HormoneState, ModuleDirective } from '@/types/hormones';
import './body.css';

// 10 hormones (D-203) — keys match HormoneState in @/types/hormones exactly.
const HORMONES: Array<{
  key: keyof HormoneState;
  label: string;
  accent: 'red' | 'green' | 'blue' | 'purple' | 'neutral';
}> = [
  { key: 'arousal', label: 'Arousal', accent: 'red' },
  { key: 'energy_mode', label: 'Energy', accent: 'green' },
  { key: 'exploration', label: 'Exploration', accent: 'blue' },
  { key: 'trust', label: 'Trust', accent: 'green' },
  { key: 'urgency', label: 'Urgency', accent: 'red' },
  { key: 'hunger', label: 'Hunger', accent: 'red' },
  { key: 'thirst', label: 'Thirst', accent: 'blue' },
  { key: 'insulin', label: 'Budget', accent: 'purple' },
  { key: 'adrenaline', label: 'Adrenaline', accent: 'red' },
  { key: 'leptin', label: 'Satiation', accent: 'purple' },
];

function clampValue(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

export function HormoneBus() {
  const toast = useToast();
  const [state, setState] = useState<HormoneState | null>(null);
  const [circadian, setCircadian] = useState<number[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [relearnOpen, setRelearnOpen] = useState(false);
  const [relearnBusy, setRelearnBusy] = useState(false);

  // Directive lookup.
  const [directiveModule, setDirectiveModule] = useState('hive');
  const [directive, setDirective] = useState<ModuleDirective | null>(null);
  const [directiveBusy, setDirectiveBusy] = useState(false);

  // Initial load — state + circadian in parallel.
  useEffect(() => {
    let cancelled = false;
    Promise.all([homeostasisGet(), homeostasisGetCircadian()])
      .then(([s, c]) => {
        if (cancelled) return;
        setState(s);
        setCircadian(c);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(typeof e === 'string' ? e : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Live hormone updates (WIRE-02 / homeostasis.rs:444).
  useTauriEvent<HormoneState>(BLADE_EVENTS.HORMONE_UPDATE, (e) => {
    if (e.payload) setState(e.payload);
  });

  const dominant = useMemo(() => {
    if (!state) return null;
    let best = HORMONES[0];
    let bestVal = clampValue(state[HORMONES[0].key]);
    for (const h of HORMONES) {
      const v = clampValue(state[h.key]);
      if (v > bestVal) {
        best = h;
        bestVal = v;
      }
    }
    return { meta: best, value: bestVal };
  }, [state]);

  const currentHour = new Date().getHours();

  const handleRelearn = async () => {
    setRelearnBusy(true);
    try {
      const next = await homeostasisRelearnCircadian();
      setCircadian(next);
      toast.show({ type: 'success', title: 'Circadian profile relearned' });
      setRelearnOpen(false);
    } catch (e) {
      toast.show({
        type: 'error',
        title: 'Relearn failed',
        message: typeof e === 'string' ? e : String(e),
      });
    } finally {
      setRelearnBusy(false);
    }
  };

  const handleDirectiveLookup = async () => {
    const mod = directiveModule.trim();
    if (!mod) {
      toast.show({ type: 'warn', title: 'Enter a module name' });
      return;
    }
    setDirectiveBusy(true);
    try {
      const d = await homeostasisGetDirective(mod);
      setDirective(d);
    } catch (e) {
      toast.show({
        type: 'error',
        title: 'Directive lookup failed',
        message: typeof e === 'string' ? e : String(e),
      });
    } finally {
      setDirectiveBusy(false);
    }
  };

  return (
    <GlassPanel tier={1} className="hormone-bus-surface" data-testid="hormone-bus-root">
      <header className="hormone-bus-header">
        <div>
          <h1 className="hormone-bus-title">Hormone Bus</h1>
          <p className="hormone-bus-sub">
            10 hormones · {circadian ? `${circadian.length}-hour circadian` : 'loading circadian'} ·{' '}
            {state && state.last_updated
              ? `updated ${new Date(state.last_updated).toLocaleTimeString()}`
              : 'awaiting first tick'}
          </p>
        </div>
        <Button
          variant="secondary"
          onClick={() => setRelearnOpen(true)}
          disabled={relearnBusy}
          data-testid="hormone-relearn-button"
        >
          Relearn circadian
        </Button>
      </header>

      {error && (
        <GlassPanel tier={2} className="body-map-error">
          <strong>Homeostasis unavailable.</strong>
          <p>{error}</p>
        </GlassPanel>
      )}

      {!state && !error && (
        <div className="body-map-loading">
          <GlassSpinner />
          <span>Reading hormone state…</span>
        </div>
      )}

      {state && (
        <div className="hormone-bus-grid">
          <GlassPanel tier={2} className="hormone-bus-meters" data-testid="hormone-meters">
            {HORMONES.map((h) => {
              const v = clampValue(state[h.key]);
              const pct = `${(v * 100).toFixed(0)}%`;
              return (
                <div
                  key={h.key}
                  className={`hormone-row accent-${h.accent}`}
                  data-testid={`hormone-row-${h.key}`}
                >
                  <span className="hormone-label">{h.label}</span>
                  <div className="hormone-meter">
                    <div style={{ width: pct }} />
                  </div>
                  <span className="hormone-value">{v.toFixed(2)}</span>
                </div>
              );
            })}
          </GlassPanel>

          <GlassPanel tier={2} className="hormone-bus-dominant">
            {dominant && (
              <>
                <h3>Dominant</h3>
                <Pill tone="new" data-testid="hormone-dominant">
                  {dominant.meta.label} · {dominant.value.toFixed(2)}
                </Pill>
                <p>
                  Strongest active hormone right now. Tracks the largest HormoneState
                  field; updates on every <code>hormone_update</code> event.
                </p>
              </>
            )}
          </GlassPanel>

          <GlassPanel tier={2} className="hormone-bus-circadian">
            <h3>Circadian profile (24h)</h3>
            {circadian ? (
              <div className="circadian-grid" data-testid="circadian-grid">
                {circadian.map((v, hour) => {
                  const pct = `${(clampValue(v) * 100).toFixed(0)}%`;
                  const isNow = hour === currentHour;
                  return (
                    <div
                      key={hour}
                      className={`circadian-bar${isNow ? ' current-hour' : ''}`}
                      style={{ height: pct }}
                      title={`${hour}:00 — ${v.toFixed(2)}${isNow ? ' (now)' : ''}`}
                    />
                  );
                })}
              </div>
            ) : (
              <p className="body-system-detail-empty">Loading circadian profile…</p>
            )}
            <p className="hormone-circadian-legend">
              Highlighted bar = current hour ({currentHour}:00).
            </p>
          </GlassPanel>

          <GlassPanel tier={2} className="hormone-bus-directive">
            <h3>Module directive</h3>
            <div className="hormone-directive-input">
              <Input
                value={directiveModule}
                onChange={(e) => setDirectiveModule(e.target.value)}
                placeholder="hive | evolution | decision_gate | brain_planner"
                disabled={directiveBusy}
                data-testid="hormone-directive-input"
              />
              <Button
                variant="secondary"
                onClick={handleDirectiveLookup}
                disabled={directiveBusy}
                data-testid="hormone-directive-button"
              >
                {directiveBusy ? 'Reading…' : 'Lookup'}
              </Button>
            </div>
            {directive ? (
              <table className="hormone-directive-table" data-testid="hormone-directive-table">
                <tbody>
                  <tr>
                    <th>Model tier</th>
                    <td>{directive.model_tier}</td>
                  </tr>
                  <tr>
                    <th>Poll rate</th>
                    <td>{directive.poll_rate.toFixed(2)}x</td>
                  </tr>
                  <tr>
                    <th>Expensive ops</th>
                    <td>{directive.allow_expensive_ops ? 'allowed' : 'blocked'}</td>
                  </tr>
                  <tr>
                    <th>Autonomous</th>
                    <td>{directive.autonomous ? 'yes' : 'asks first'}</td>
                  </tr>
                  <tr>
                    <th>Reason</th>
                    <td>{directive.reason}</td>
                  </tr>
                </tbody>
              </table>
            ) : (
              <p className="body-system-detail-empty">
                Enter a module name to read its hormone-derived directive.
              </p>
            )}
          </GlassPanel>
        </div>
      )}

      <Dialog
        open={relearnOpen}
        onClose={() => setRelearnOpen(false)}
        ariaLabel="Confirm relearn circadian"
      >
        <h3>Relearn circadian profile?</h3>
        <p>
          Recomputes the learned 24-hour activity profile from recent history and
          overwrites the cached version. Irreversible but non-destructive.
        </p>
        <div className="body-dialog-actions">
          <Button variant="primary" onClick={handleRelearn} disabled={relearnBusy}>
            {relearnBusy ? 'Relearning…' : 'Confirm relearn'}
          </Button>
          <Button variant="ghost" onClick={() => setRelearnOpen(false)} disabled={relearnBusy}>
            Cancel
          </Button>
        </div>
      </Dialog>
    </GlassPanel>
  );
}
