// src/features/dev/WrapperSmoke.tsx — DEV-only, palette-hidden (D-30, P-04 gate).
//
// P-04 gate verification: exercises every Phase-1 typed Tauri wrapper and
// renders pass/fail + result preview per row. One click runs all read-only
// wrappers (getConfig, getOnboardingStatus, cancelChat — idempotent). Mutating
// wrappers (saveConfig, completeOnboarding, sendMessageStream) are listed but
// NOT auto-run; the operator can trigger them manually if drift is suspected.
//
// Grows as later phases add wrappers. Today this is the gate that catches
// snake_case arg-key drift between TS wrappers and Rust command signatures
// BEFORE it ships to real users.
//
// @see .planning/phases/01-foundation/01-CONTEXT.md §D-30
// @see .planning/research/PITFALLS.md §P-04

import { useCallback, useState } from 'react';
import { Button, Card, Pill } from '@/design-system/primitives';
import {
  getConfig,
  getOnboardingStatus,
  cancelChat,
  TauriError,
} from '@/lib/tauri';

type RowStatus = 'idle' | 'running' | 'pass' | 'fail';

interface TestRow {
  name: string;
  rustCite: string;
  argsPreview: string;
  /** Only present on read-only rows — mutating rows leave this undefined. */
  run?: () => Promise<unknown>;
  mutating?: boolean;
  status: RowStatus;
  result?: string;
  error?: string;
}

const INITIAL_ROWS: TestRow[] = [
  {
    name: 'getConfig',
    rustCite: 'commands.rs:1899',
    argsPreview: '{}',
    run: () => getConfig(),
    status: 'idle',
  },
  {
    name: 'getOnboardingStatus',
    rustCite: 'commands.rs:2312',
    argsPreview: '{}',
    run: () => getOnboardingStatus(),
    status: 'idle',
  },
  {
    name: 'cancelChat (idempotent)',
    rustCite: 'commands.rs:71',
    argsPreview: '{}',
    run: () => cancelChat(),
    status: 'idle',
  },
  {
    name: 'saveConfig',
    rustCite: 'config.rs:514',
    argsPreview: '{ config: BladeConfig }',
    mutating: true,
    status: 'idle',
  },
  {
    name: 'completeOnboarding',
    rustCite: 'commands.rs:2325',
    argsPreview: '{ answers: string[] }',
    mutating: true,
    status: 'idle',
  },
  {
    name: 'sendMessageStream',
    rustCite: 'commands.rs:558',
    argsPreview: '{ messages: ChatMessage[] }',
    mutating: true,
    status: 'idle',
  },
];

function preview(value: unknown): string {
  if (value === undefined || value === null) return String(value);
  if (typeof value === 'object') {
    try {
      const s = JSON.stringify(value);
      return s.length > 120 ? s.slice(0, 117) + '...' : s;
    } catch {
      return '[unserializable]';
    }
  }
  return String(value);
}

function statusTone(s: RowStatus): 'default' | 'free' | 'new' {
  if (s === 'pass') return 'free';
  if (s === 'fail') return 'new';
  return 'default';
}

export function WrapperSmoke() {
  const [rows, setRows] = useState<TestRow[]>(INITIAL_ROWS);

  const runAll = useCallback(async () => {
    // Reset read-only rows to running; leave mutating rows alone.
    setRows((prev) =>
      prev.map((r) =>
        r.mutating
          ? r
          : { ...r, status: 'running' as RowStatus, result: undefined, error: undefined },
      ),
    );

    const next: TestRow[] = [];
    for (const r of INITIAL_ROWS) {
      if (r.mutating || !r.run) {
        next.push({ ...r, status: 'idle' });
        continue;
      }
      const row: TestRow = { ...r, status: 'running' };
      try {
        const result = await r.run();
        row.status = 'pass';
        row.result = preview(result);
      } catch (e) {
        row.status = 'fail';
        row.error =
          e instanceof TauriError
            ? `[${e.kind}] ${e.rustMessage}`
            : e instanceof Error
              ? e.message
              : String(e);
      }
      next.push(row);
    }
    setRows(next);
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
        <h1 className="t-h1">Wrapper Smoke</h1>
        <p className="t-body" style={{ color: 'var(--t-2)', marginTop: 'var(--s-3)' }}>
          P-04 gate: snake_case arg keys round-trip to Rust verbatim. Click
          <strong> Run All </strong> to execute every read-only Phase-1
          wrapper. Mutating wrappers are listed but not auto-run (T-09-04
          mitigation).
        </p>
      </header>

      <div>
        <Button variant="primary" onClick={runAll}>Run All</Button>
      </div>

      <Card padding="sm">
        <div style={{ overflowX: 'auto' }}>
          <table
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: 13,
              color: 'var(--t-1)',
            }}
          >
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--t-3)', fontFamily: 'var(--font-mono)' }}>
                <th style={{ padding: 'var(--s-2)' }}>fn</th>
                <th style={{ padding: 'var(--s-2)' }}>rust cite</th>
                <th style={{ padding: 'var(--s-2)' }}>args</th>
                <th style={{ padding: 'var(--s-2)' }}>status</th>
                <th style={{ padding: 'var(--s-2)' }}>result / error</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.name}
                  style={{ borderTop: '1px solid var(--line)' }}
                >
                  <td
                    style={{
                      padding: 'var(--s-2)',
                      fontFamily: 'var(--font-mono)',
                      color: 'var(--t-1)',
                    }}
                  >
                    {r.name}
                    {r.mutating && (
                      <span style={{ marginLeft: 'var(--s-2)' }}>
                        <Pill tone="new">mutating</Pill>
                      </span>
                    )}
                  </td>
                  <td
                    style={{
                      padding: 'var(--s-2)',
                      fontFamily: 'var(--font-mono)',
                      color: 'var(--t-3)',
                      fontSize: 12,
                    }}
                  >
                    {r.rustCite}
                  </td>
                  <td
                    style={{
                      padding: 'var(--s-2)',
                      fontFamily: 'var(--font-mono)',
                      color: 'var(--t-2)',
                      fontSize: 12,
                    }}
                  >
                    {r.argsPreview}
                  </td>
                  <td style={{ padding: 'var(--s-2)' }}>
                    <Pill
                      tone={statusTone(r.status)}
                      dot={r.status === 'pass' || r.status === 'fail' || r.status === 'running'}
                    >
                      {r.status}
                    </Pill>
                  </td>
                  <td
                    style={{
                      padding: 'var(--s-2)',
                      fontFamily: 'var(--font-mono)',
                      color: r.status === 'fail' ? 'var(--a-hot)' : 'var(--t-2)',
                      fontSize: 12,
                      maxWidth: 420,
                      wordBreak: 'break-word',
                    }}
                  >
                    {r.error ?? r.result ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
