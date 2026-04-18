// src/features/dev/Diagnostics.tsx — DEV-only, palette-hidden.
//
// Exposes runtime diagnostics for P-06 listener-leak inspection + P-01
// boot-to-first-paint inspection + token sanity. A /diagnostics route exists
// in admin too (Phase 7); this is the Phase 1 DEV counterpart sitting next to
// /primitives and /wrapper-smoke.
//
// No backend state mutations. Polling is cheap (interval 500ms, cleared on
// unmount) — no listener-leak risk from this page itself.
//
// @see .planning/phases/01-foundation/01-CONTEXT.md §D-29, §D-32
// @see .planning/research/PITFALLS.md §P-01, §P-06

import { useCallback, useEffect, useState } from 'react';
import { Button, Card, Pill } from '@/design-system/primitives';
import { useTauriEvent, BLADE_EVENTS } from '@/lib/events';

interface PerfMarkRow {
  name: string;
  type: string;
  startTime: number;
  duration?: number;
}

/** Git HEAD hash injected at build time — vite.define hook; undefined if not wired. */
const GIT_HASH: string | undefined =
  typeof import.meta.env.VITE_GIT_HASH === 'string'
    ? import.meta.env.VITE_GIT_HASH
    : undefined;

export function Diagnostics() {
  const [listenerCount, setListenerCount] = useState<number>(0);
  const [perfMarks, setPerfMarks] = useState<PerfMarkRow[]>([]);
  const [testEventCount, setTestEventCount] = useState<number>(0);
  const [, setTick] = useState(0); // forces re-render of timestamps

  // Subscribe to blade_status (cross-window broadcast) to exercise useTauriEvent +
  // increment __BLADE_LISTENERS_COUNT__.
  useTauriEvent<unknown>(BLADE_EVENTS.BLADE_STATUS, () =>
    setTestEventCount((c) => c + 1),
  );

  // Poll the global counter + perf entries every 500ms. useEffect cleanup
  // clears the interval; no timer leak.
  useEffect(() => {
    const poll = () => {
      const w = window as Window & { __BLADE_LISTENERS_COUNT__?: number };
      setListenerCount(w.__BLADE_LISTENERS_COUNT__ ?? 0);
      const entries = performance.getEntries() as (PerformanceEntry & {
        duration?: number;
      })[];
      const rows: PerfMarkRow[] = entries
        .filter((e) => e.entryType === 'mark' || e.entryType === 'measure')
        .map((e) => ({
          name: e.name,
          type: e.entryType,
          startTime: e.startTime,
          duration: e.duration && e.duration > 0 ? e.duration : undefined,
        }));
      setPerfMarks(rows);
      setTick((t) => t + 1);
    };
    poll();
    const id = window.setInterval(poll, 500);
    return () => window.clearInterval(id);
  }, []);

  const forceMeasure = useCallback(() => {
    // Measure boot→now (handy for manual P-01 spot checks).
    try {
      performance.mark('diagnostics-ping');
      performance.measure('boot-to-ping', 'boot', 'diagnostics-ping');
    } catch {
      // `boot` mark may not exist if we're running outside main window bootstrap.
    }
  }, []);

  return (
    <div
      style={{
        padding: 'var(--s-8)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--s-5)',
        maxWidth: 1100,
        margin: '0 auto',
      }}
    >
      <header>
        <h1 className="t-h1">Diagnostics</h1>
        <p className="t-body" style={{ color: 'var(--t-2)', marginTop: 'var(--s-3)' }}>
          DEV-only. Listener count (P-06), performance marks (P-01), build
          metadata. Not the production /diagnostics — that ships in Phase 7.
        </p>
      </header>

      {/* ───── Listener counter (P-06 gate) ──────────────────────────── */}
      <Card>
        <h2 className="t-h3">Event listener count (P-06)</h2>
        <p
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 28,
            color: 'var(--t-1)',
            margin: 'var(--s-3) 0',
          }}
        >
          {listenerCount}
        </p>
        <p className="t-small" style={{ color: 'var(--t-3)' }}>
          Source: <code>window.__BLADE_LISTENERS_COUNT__</code>. Stable count
          across route churn = P-06 pass. The Playwright spec at
          <code> tests/e2e/listener-leak.spec.ts</code> asserts this.
        </p>
      </Card>

      {/* ───── Performance marks (P-01 gate) ─────────────────────────── */}
      <Card>
        <h2 className="t-h3">Performance marks (P-01)</h2>
        <div style={{ marginTop: 'var(--s-3)', display: 'flex', gap: 'var(--s-3)', alignItems: 'center' }}>
          <Button variant="ghost" size="sm" onClick={forceMeasure}>Measure now</Button>
          <span className="t-small" style={{ color: 'var(--t-3)' }}>
            Records <code>boot-to-ping</code> for manual spot check.
          </span>
        </div>
        {perfMarks.length === 0 ? (
          <p className="t-small" style={{ color: 'var(--t-3)', marginTop: 'var(--s-3)' }}>
            No marks recorded yet.
          </p>
        ) : (
          <ul
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 12,
              color: 'var(--t-2)',
              margin: 'var(--s-3) 0 0',
              paddingLeft: 'var(--s-5)',
              maxHeight: 240,
              overflowY: 'auto',
            }}
          >
            {perfMarks.map((m, i) => (
              <li key={`${m.name}-${i}`}>
                <span style={{ color: 'var(--t-3)' }}>[{m.type}]</span>{' '}
                {m.name}: {m.startTime.toFixed(1)}ms
                {m.duration !== undefined && (
                  <span style={{ color: 'var(--t-3)' }}> ({m.duration.toFixed(1)}ms duration)</span>
                )}
              </li>
            ))}
          </ul>
        )}
        <p className="t-small" style={{ color: 'var(--t-3)', marginTop: 'var(--s-3)' }}>
          Target: <code>boot-to-first-paint ≤ 200ms</code> on integrated GPU.
          Phase 1 measures with ComingSoonSkeleton as the Dashboard — floor
          measurement per D-29.
        </p>
      </Card>

      {/* ───── Test event count ──────────────────────────────────────── */}
      <Card>
        <h2 className="t-h3">Test event count</h2>
        <div style={{ marginTop: 'var(--s-3)', display: 'flex', gap: 'var(--s-3)', alignItems: 'center' }}>
          <Pill tone="free" dot={testEventCount > 0}>
            {testEventCount} received
          </Pill>
        </div>
        <p className="t-small" style={{ color: 'var(--t-3)', marginTop: 'var(--s-2)' }}>
          Subscribed to <code>blade_status</code> via <code>useTauriEvent</code>.
          Increments when the backend broadcasts status transitions.
        </p>
      </Card>

      {/* ───── Build metadata ────────────────────────────────────────── */}
      <Card>
        <h2 className="t-h3">Build metadata</h2>
        <ul
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 12,
            color: 'var(--t-2)',
            margin: 'var(--s-3) 0 0',
            paddingLeft: 'var(--s-5)',
          }}
        >
          <li>mode: {import.meta.env.MODE}</li>
          <li>DEV: {String(import.meta.env.DEV)}</li>
          <li>PROD: {String(import.meta.env.PROD)}</li>
          <li>git HEAD: {GIT_HASH ?? '(not wired — set VITE_GIT_HASH in vite.config.ts)'}</li>
        </ul>
      </Card>
    </div>
  );
}
