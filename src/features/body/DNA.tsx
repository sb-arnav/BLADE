// src/features/body/DNA.tsx — BODY-05.
//
// Plan 08-03 Task 2: real implementation.
//
// 4 pill tabs: Identity / Goals / Patterns / Query — active tab persisted via
// prefs['body.dna.activeDoc'] (default 'identity').
//
// Identity/Goals/Patterns tabs display read-only text via dna_get_* commands
// in <pre>. Identity tab also exposes an "Edit" textarea with a "Copy edits"
// button that writes to clipboard — honest deferral card explains the absence
// of dna_set_* backend commands (D-203).
//
// Query tab: <Input> + "Ask" button calls dnaQuery(query) and renders the
// result in a GlassPanel. Empty state before first query.
//
// @see .planning/phases/08-body-hive/08-03-PLAN.md Task 2
// @see .planning/phases/08-body-hive/08-CONTEXT.md §D-203
// @see .planning/REQUIREMENTS.md §BODY-05

import { useCallback, useEffect, useState } from 'react';
import { Button, GlassPanel, GlassSpinner, Input } from '@/design-system/primitives';
import { usePrefs } from '@/hooks/usePrefs';
import { useToast } from '@/lib/context';
import { dnaGetGoals, dnaGetIdentity, dnaGetPatterns, dnaQuery } from '@/lib/tauri/body';
import './body.css';

type DnaTab = 'identity' | 'goals' | 'patterns' | 'query';

const PREF_KEY = 'body.dna.activeDoc';
const DEFAULT_TAB: DnaTab = 'identity';

function readInitialTab(raw: string | number | boolean | undefined): DnaTab {
  if (typeof raw === 'string') {
    if (raw === 'identity' || raw === 'goals' || raw === 'patterns' || raw === 'query') {
      return raw;
    }
  }
  return DEFAULT_TAB;
}

export function DNA() {
  const { prefs, setPref } = usePrefs();
  const [tab, setTab] = useState<DnaTab>(() => readInitialTab(prefs[PREF_KEY]));

  const handleTabChange = (next: DnaTab) => {
    setTab(next);
    setPref(PREF_KEY, next);
  };

  return (
    <GlassPanel tier={1} className="dna-surface" data-testid="dna-root">
      <header className="dna-header">
        <div>
          <h1 className="dna-title">DNA</h1>
          <p className="dna-sub">
            Identity + goals + patterns + free-form query — sourced from dna_*
            commands.
          </p>
        </div>
      </header>

      <div className="dna-tabs" role="tablist" aria-label="DNA sections">
        {(
          [
            ['identity', 'Identity'],
            ['goals', 'Goals'],
            ['patterns', 'Patterns'],
            ['query', 'Query'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className="dna-tab-pill"
            data-active={tab === id}
            data-testid={`dna-tab-${id}`}
            onClick={() => handleTabChange(id)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="dna-body" role="tabpanel">
        {tab === 'identity' && <IdentityTab />}
        {tab === 'goals' && <DnaTextTab fetcher={dnaGetGoals} label="goals" />}
        {tab === 'patterns' && <DnaTextTab fetcher={dnaGetPatterns} label="patterns" />}
        {tab === 'query' && <QueryTab />}
      </div>
    </GlassPanel>
  );
}

// ─── Identity tab with edit-via-clipboard ───────────────────────────────────

function IdentityTab() {
  const toast = useToast();
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  const reload = useCallback(async () => {
    try {
      const t = await dnaGetIdentity();
      setText(t);
      setError(null);
    } catch (e) {
      setError(typeof e === 'string' ? e : String(e));
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const startEdit = () => {
    setDraft(text ?? '');
    setEditing(true);
  };

  const copyDraft = async () => {
    try {
      await navigator.clipboard.writeText(draft);
      toast.show({
        type: 'success',
        title: 'Copied to clipboard',
        message: 'Paste into dna.md manually (direct write deferred to Phase 9).',
      });
    } catch (e) {
      toast.show({
        type: 'error',
        title: 'Clipboard copy failed',
        message: typeof e === 'string' ? e : String(e),
      });
    }
  };

  return (
    <section className="dna-section" data-testid="dna-identity-section">
      {error && <p className="body-system-detail-empty">{error}</p>}
      {text === null && !error && (
        <div className="body-map-loading">
          <GlassSpinner />
          <span>Reading identity…</span>
        </div>
      )}
      {text !== null && !editing && (
        <>
          <pre className="dna-text">{text || '(empty)'}</pre>
          <div className="dna-actions">
            <Button variant="secondary" onClick={startEdit} data-testid="dna-identity-edit">
              Edit
            </Button>
            <Button variant="ghost" onClick={reload}>
              Refresh
            </Button>
          </div>
        </>
      )}
      {editing && (
        <>
          <textarea
            className="dna-edit-textarea"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={14}
            data-testid="dna-identity-textarea"
          />
          <div className="dna-actions">
            <Button variant="primary" onClick={copyDraft} data-testid="dna-identity-copy">
              Copy proposed edits
            </Button>
            <Button variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </>
      )}
      <GlassPanel tier={2} className="dna-deferral">
        <strong>Direct write deferred (Phase 9).</strong>
        <p>
          No <code>dna_set_identity</code> backend command exists yet. Identity
          edits are copied to the clipboard for manual paste into your dna.md;
          you can also propose changes to the Brain via the Query tab.
        </p>
      </GlassPanel>
    </section>
  );
}

// ─── Generic read-only text tab for Goals / Patterns ────────────────────────

function DnaTextTab({
  fetcher,
  label,
}: {
  fetcher: () => Promise<string>;
  label: string;
}) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const t = await fetcher();
      setText(t);
      setError(null);
    } catch (e) {
      setError(typeof e === 'string' ? e : String(e));
    }
  }, [fetcher]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return (
    <section className="dna-section" data-testid={`dna-${label}-section`}>
      {error && <p className="body-system-detail-empty">{error}</p>}
      {text === null && !error && (
        <div className="body-map-loading">
          <GlassSpinner />
          <span>Reading {label}…</span>
        </div>
      )}
      {text !== null && <pre className="dna-text">{text || `(no ${label} recorded)`}</pre>}
      <div className="dna-actions">
        <Button variant="ghost" onClick={reload}>
          Refresh
        </Button>
      </div>
    </section>
  );
}

// ─── Query tab (dna_query) ──────────────────────────────────────────────────

function QueryTab() {
  const toast = useToast();
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    const q = query.trim();
    if (!q) {
      toast.show({ type: 'warn', title: 'Enter a query' });
      return;
    }
    setBusy(true);
    try {
      const r = await dnaQuery({ query: q });
      setResult(r);
    } catch (e) {
      toast.show({
        type: 'error',
        title: 'DNA query failed',
        message: typeof e === 'string' ? e : String(e),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="dna-section" data-testid="dna-query-section">
      <div className="dna-query-input">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="e.g. 'what are my open goals?' or 'summarise my team'"
          disabled={busy}
          data-testid="dna-query-input"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !busy) void run();
          }}
        />
        <Button
          variant="primary"
          onClick={run}
          disabled={busy}
          data-testid="dna-query-button"
        >
          {busy ? 'Asking…' : 'Ask'}
        </Button>
      </div>
      {result ? (
        <GlassPanel tier={2} className="dna-query-result" data-testid="dna-query-result">
          <pre className="dna-text">{result}</pre>
        </GlassPanel>
      ) : (
        <p className="body-system-detail-empty">
          Ask a natural-language question about identity, goals, patterns, or
          people/teams/companies.
        </p>
      )}
    </section>
  );
}
