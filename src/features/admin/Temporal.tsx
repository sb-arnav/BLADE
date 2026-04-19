// src/features/admin/Temporal.tsx
//
// Admin cluster — Temporal route (ADMIN-06, D-184). Hero = daily standup
// briefing; 4 tabs persisted via prefs['admin.activeTab'] with prefix "temp:":
//   What was I doing / Patterns / Meeting prep / Execution memory.
//
// All invokes go through the admin.ts typed wrappers — no raw invoke/listen.
// Meeting prep is a SHARED read with Phase 6 MeetingsView (D-184) — this tab
// is the admin/debug window into the same backend.
//
// @see .planning/phases/07-dev-tools-admin/07-CONTEXT.md §D-184
// @see .planning/phases/07-dev-tools-admin/07-PATTERNS.md §3 (tabbed surface)
// @see src/lib/tauri/admin.ts (temporal* + exmem*)

import { useCallback, useEffect, useState } from 'react';
import { Button, GlassPanel, GlassSpinner, Input } from '@/design-system/primitives';
import { useToast } from '@/lib/context';
import { usePrefs } from '@/hooks/usePrefs';
import {
  exmemRecent,
  exmemRecord,
  exmemSearch,
  temporalDailyStandup,
  temporalDetectPatterns,
  temporalMeetingPrep,
  temporalWhatWasIDoing,
} from '@/lib/tauri/admin';
import type { ExecutionMemoryEntry, TemporalPattern } from './types';
import './admin.css';
import './admin-rich-b.css';

type TemporalTab = 'recall' | 'patterns' | 'meeting' | 'exmem';
const TAB_PREF_KEY = 'admin.activeTab';
const TAB_PREF_PREFIX = 'temp:';
const DEFAULT_TAB: TemporalTab = 'recall';

function readInitialTab(raw: string | number | boolean | undefined): TemporalTab {
  if (typeof raw === 'string' && raw.startsWith(TAB_PREF_PREFIX)) {
    const t = raw.slice(TAB_PREF_PREFIX.length) as TemporalTab;
    if (t === 'recall' || t === 'patterns' || t === 'meeting' || t === 'exmem') return t;
  }
  return DEFAULT_TAB;
}

function formatTimestamp(ts: number): string {
  if (!ts) return '—';
  try {
    return new Date(ts * 1000).toLocaleString();
  } catch {
    return String(ts);
  }
}

export function Temporal() {
  const { prefs, setPref } = usePrefs();
  const [tab, setTab] = useState<TemporalTab>(() => readInitialTab(prefs[TAB_PREF_KEY]));

  // Hero state: daily standup briefing.
  const [standup, setStandup] = useState<string | null>(null);
  const [standupError, setStandupError] = useState<string | null>(null);
  const [standupLoading, setStandupLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setStandupLoading(true);
    temporalDailyStandup()
      .then((s) => {
        if (!cancelled) {
          setStandup(typeof s === 'string' ? s : String(s));
          setStandupError(null);
        }
      })
      .catch((e) => {
        if (!cancelled) setStandupError(typeof e === 'string' ? e : String(e));
      })
      .finally(() => {
        if (!cancelled) setStandupLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleTabChange = (next: TemporalTab) => {
    setTab(next);
    setPref(TAB_PREF_KEY, `${TAB_PREF_PREFIX}${next}`);
  };

  return (
    <GlassPanel tier={1} className="admin-surface" data-testid="temporal-root">
      <div className="temporal-layout">
        <section className="temporal-hero" data-testid="temporal-standup-card">
          <h3>Daily standup</h3>
          {standupLoading && (
            <div className="admin-inline-row">
              <GlassSpinner />
              <span className="admin-empty">Generating briefing…</span>
            </div>
          )}
          {standupError && !standupLoading && (
            <p className="admin-empty">No standup available yet ({standupError}).</p>
          )}
          {!standupError && !standupLoading && (
            <div className="temporal-standup-body">
              {standup && standup.trim() ? standup : 'No standup summary available yet.'}
            </div>
          )}
        </section>

        <div className="admin-tabs" role="tablist" aria-label="Temporal sections">
          {(
            [
              ['recall', 'What was I doing'],
              ['patterns', 'Patterns'],
              ['meeting', 'Meeting prep'],
              ['exmem', 'Execution memory'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              className="admin-tab-pill"
              data-active={tab === id}
              data-testid="temporal-tab"
              data-tab={id}
              onClick={() => handleTabChange(id)}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === 'recall' && <RecallTab />}
        {tab === 'patterns' && <PatternsTab />}
        {tab === 'meeting' && <MeetingPrepTab />}
        {tab === 'exmem' && <ExmemTab />}
      </div>
    </GlassPanel>
  );
}

// ─── What was I doing tab ───────────────────────────────────────────────────

function RecallTab() {
  const [windowHours, setWindowHours] = useState('24');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const toast = useToast();

  const recall = useCallback(async () => {
    const hours = Number(windowHours);
    if (!Number.isFinite(hours) || hours <= 0) {
      toast.show({ type: 'warn', title: 'Enter a positive hour count' });
      return;
    }
    setBusy(true);
    try {
      const out = await temporalWhatWasIDoing(hours);
      setResult(out);
    } catch (e) {
      toast.show({
        type: 'error',
        title: 'Recall failed',
        message: typeof e === 'string' ? e : String(e),
      });
    } finally {
      setBusy(false);
    }
  }, [windowHours, toast]);

  return (
    <section className="diagnostics-section" data-testid="temporal-recall-section">
      <div className="admin-inline-row">
        <label className="admin-dialog-label">
          Window (hours)
          <Input
            type="number"
            value={windowHours}
            onChange={(e) => setWindowHours(e.target.value)}
            aria-label="Recall window hours"
            style={{ width: 120 }}
          />
        </label>
        <Button
          variant="primary"
          onClick={recall}
          disabled={busy}
          data-testid="temporal-recall-button"
        >
          {busy ? 'Recalling…' : 'Recall'}
        </Button>
      </div>
      {result ? (
        <div className="temporal-recall-card">{result}</div>
      ) : (
        <p className="admin-empty">Click Recall to summarise the last window.</p>
      )}
    </section>
  );
}

// ─── Patterns tab ───────────────────────────────────────────────────────────

function PatternsTab() {
  const [patterns, setPatterns] = useState<TemporalPattern[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const list = await temporalDetectPatterns();
      setPatterns(list);
      setError(null);
    } catch (e) {
      setError(typeof e === 'string' ? e : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="diagnostics-section" data-testid="temporal-patterns-section">
      <div className="admin-inline-row" style={{ justifyContent: 'space-between' }}>
        <p className="admin-empty" style={{ margin: 0 }}>
          {busy ? 'Detecting…' : `${patterns?.length ?? 0} patterns detected`}
        </p>
        <Button variant="ghost" onClick={load} disabled={busy}>
          Refresh
        </Button>
      </div>
      {error && <p className="admin-empty">Error: {error}</p>}
      <div className="admin-row-list">
        {(patterns ?? []).map((p, i) => (
          <div key={`${p.pattern_type}-${i}`} className="temporal-pattern-card">
            <div style={{ color: 'var(--t-1)', fontWeight: 600 }}>{p.pattern_type}</div>
            <div style={{ marginTop: 'var(--s-1)' }}>{p.description}</div>
            <div className="temporal-pattern-confidence">
              confidence {(p.confidence ?? 0).toFixed(2)} • data points {p.data_points ?? 0}
            </div>
          </div>
        ))}
        {!busy && patterns && patterns.length === 0 && (
          <p className="admin-empty">No patterns detected yet.</p>
        )}
      </div>
    </section>
  );
}

// ─── Meeting prep tab ───────────────────────────────────────────────────────

function MeetingPrepTab() {
  const [topic, setTopic] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const toast = useToast();

  const prep = useCallback(async () => {
    if (!topic.trim()) {
      toast.show({ type: 'warn', title: 'Enter a meeting id or topic' });
      return;
    }
    setBusy(true);
    try {
      const brief = await temporalMeetingPrep(topic);
      setResult(brief);
    } catch (e) {
      toast.show({
        type: 'error',
        title: 'Meeting prep failed',
        message: typeof e === 'string' ? e : String(e),
      });
    } finally {
      setBusy(false);
    }
  }, [topic, toast]);

  return (
    <section className="diagnostics-section" data-testid="temporal-meeting-section">
      <p className="admin-empty" style={{ margin: 0 }}>
        Shared read with <code>/meetings</code> route — use this tab for debugging / admin.
      </p>
      <div className="admin-inline-row">
        <Input
          placeholder="Meeting id or topic"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          aria-label="Meeting id"
          style={{ flex: 1, minWidth: 240 }}
        />
        <Button variant="primary" onClick={prep} disabled={busy || !topic.trim()}>
          {busy ? 'Preparing…' : 'Prep'}
        </Button>
      </div>
      {result ? (
        <div className="temporal-meeting-prep-card">{result}</div>
      ) : (
        <p className="admin-empty">Brief for the selected meeting will appear here.</p>
      )}
    </section>
  );
}

// ─── Execution memory tab ───────────────────────────────────────────────────

function ExmemTab() {
  const [recent, setRecent] = useState<ExecutionMemoryEntry[] | null>(null);
  const [recentError, setRecentError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [searchResult, setSearchResult] = useState<string | null>(null);
  const [searchBusy, setSearchBusy] = useState(false);
  const [recordBusy, setRecordBusy] = useState(false);

  // Record form state.
  const [recCmd, setRecCmd] = useState('');
  const [recCwd, setRecCwd] = useState('');
  const [recStdout, setRecStdout] = useState('');
  const [recStderr, setRecStderr] = useState('');
  const [recExit, setRecExit] = useState('0');
  const toast = useToast();

  const loadRecent = useCallback(async () => {
    try {
      const list = await exmemRecent(50);
      setRecent(list);
      setRecentError(null);
    } catch (e) {
      setRecentError(typeof e === 'string' ? e : String(e));
    }
  }, []);

  useEffect(() => {
    void loadRecent();
  }, [loadRecent]);

  const runSearch = useCallback(async () => {
    if (!query.trim()) return;
    setSearchBusy(true);
    try {
      const out = await exmemSearch({ query, limit: 20 });
      setSearchResult(out);
    } catch (e) {
      toast.show({
        type: 'error',
        title: 'Exmem search failed',
        message: typeof e === 'string' ? e : String(e),
      });
    } finally {
      setSearchBusy(false);
    }
  }, [query, toast]);

  const record = useCallback(async () => {
    if (!recCmd.trim()) {
      toast.show({ type: 'warn', title: 'Command required' });
      return;
    }
    setRecordBusy(true);
    try {
      await exmemRecord({
        command: recCmd,
        cwd: recCwd || '.',
        stdout: recStdout,
        stderr: recStderr,
        exitCode: Number(recExit) || 0,
      });
      toast.show({ type: 'success', title: 'Recorded' });
      setRecCmd('');
      setRecCwd('');
      setRecStdout('');
      setRecStderr('');
      setRecExit('0');
      await loadRecent();
    } catch (e) {
      toast.show({
        type: 'error',
        title: 'Record failed',
        message: typeof e === 'string' ? e : String(e),
      });
    } finally {
      setRecordBusy(false);
    }
  }, [recCmd, recCwd, recStdout, recStderr, recExit, loadRecent, toast]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s-3)' }}>
      <section className="diagnostics-section" data-testid="temporal-exmem-feed">
        <h4 className="diagnostics-section-title">Recent executions</h4>
        {recentError && <p className="admin-empty">Error: {recentError}</p>}
        <div className="admin-row-list">
          {(recent ?? []).map((row) => (
            <div key={row.id} className="temporal-exmem-row">
              <div className="temporal-exmem-row-cmd">$ {row.command}</div>
              <div className="temporal-exmem-row-meta">
                exit {row.exit_code} • {row.duration_ms}ms • {formatTimestamp(row.timestamp)} •
                cwd {row.cwd}
              </div>
            </div>
          ))}
          {recent && recent.length === 0 && (
            <p className="admin-empty">No execution history yet.</p>
          )}
        </div>
      </section>

      <section className="diagnostics-section">
        <h4 className="diagnostics-section-title">Search</h4>
        <div className="admin-inline-row">
          <Input
            placeholder="Search query"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Exmem search"
            style={{ flex: 1, minWidth: 240 }}
          />
          <Button variant="primary" onClick={runSearch} disabled={searchBusy || !query.trim()}>
            {searchBusy ? 'Searching…' : 'Search'}
          </Button>
        </div>
        {searchResult && <div className="temporal-recall-card">{searchResult}</div>}
      </section>

      <section className="diagnostics-section">
        <h4 className="diagnostics-section-title">Record (debug)</h4>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--s-2)' }}>
          <label className="admin-dialog-label">
            Command
            <Input
              value={recCmd}
              onChange={(e) => setRecCmd(e.target.value)}
              aria-label="Record command"
            />
          </label>
          <label className="admin-dialog-label">
            CWD
            <Input
              value={recCwd}
              onChange={(e) => setRecCwd(e.target.value)}
              aria-label="Record cwd"
            />
          </label>
          <label className="admin-dialog-label" style={{ gridColumn: '1 / -1' }}>
            Stdout
            <textarea
              className="admin-dialog-textarea"
              value={recStdout}
              onChange={(e) => setRecStdout(e.target.value)}
              aria-label="Record stdout"
            />
          </label>
          <label className="admin-dialog-label" style={{ gridColumn: '1 / -1' }}>
            Stderr
            <textarea
              className="admin-dialog-textarea"
              value={recStderr}
              onChange={(e) => setRecStderr(e.target.value)}
              aria-label="Record stderr"
            />
          </label>
          <label className="admin-dialog-label">
            Exit code
            <Input
              type="number"
              value={recExit}
              onChange={(e) => setRecExit(e.target.value)}
              aria-label="Record exit code"
            />
          </label>
        </div>
        <div className="admin-dialog-actions">
          <Button variant="primary" onClick={record} disabled={recordBusy || !recCmd.trim()}>
            {recordBusy ? 'Recording…' : 'Record'}
          </Button>
        </div>
      </section>
    </div>
  );
}
