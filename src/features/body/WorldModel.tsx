// src/features/body/WorldModel.tsx — BODY-06.
//
// Plan 08-03 Task 3: real implementation.
//
// Renders world_get_state() with:
//   - Hero: timestamp (relative) + workspace_cwd + active_window + network
//     activity + system_load (CPU cores + RAM used/total + disk free).
//   - 5 pill tabs: Git / Processes / Ports / File changes / Todos.
//   - 'Refresh' button -> worldRefresh() -> setState + toast.
//   - 'Summary' button -> Dialog with worldGetSummary() raw text.
//
// Event subscription:
//   - useTauriEvent(BLADE_EVENTS.WORLD_STATE_UPDATED) -> worldGetState().then(setState)
//     (payload is a summary string; refetch for the full state).
//
// @see .planning/phases/08-body-hive/08-03-PLAN.md Task 3
// @see .planning/phases/08-body-hive/08-CONTEXT.md §D-203 (WorldModel section)
// @see .planning/REQUIREMENTS.md §BODY-06

import { useCallback, useEffect, useState } from 'react';
import { Button, Dialog, GlassPanel, GlassSpinner, EmptyState } from '@/design-system/primitives';
import { useToast } from '@/lib/context';
import { BLADE_EVENTS, useTauriEvent } from '@/lib/events';
import { worldGetState, worldGetSummary, worldRefresh } from '@/lib/tauri/body';
import type { WorldState } from '@/lib/tauri/body';
import './body.css';

type WorldTab = 'git' | 'processes' | 'ports' | 'file-changes' | 'todos';

function formatRelative(unixLike: number): string {
  if (!unixLike) return '—';
  // Rust emits either seconds-since-epoch (most of our commands) or ms; auto-detect.
  const ts = unixLike > 1e12 ? unixLike : unixLike * 1000;
  const diffMs = Date.now() - ts;
  const sec = Math.round(diffMs / 1000);
  if (sec < 5) return 'just now';
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.round(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.round(sec / 3600)}h ago`;
  return new Date(ts).toLocaleString();
}

function pct(numerator: number, denom: number): number {
  if (!denom || !Number.isFinite(denom)) return 0;
  return Math.max(0, Math.min(100, (numerator / denom) * 100));
}

export function WorldModel() {
  const toast = useToast();
  const [state, setState] = useState<WorldState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<WorldTab>('git');

  const [summaryOpen, setSummaryOpen] = useState(false);
  const [summaryText, setSummaryText] = useState<string | null>(null);
  const [summaryBusy, setSummaryBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const s = await worldGetState();
      setState(s);
      setError(null);
    } catch (e) {
      setError(typeof e === 'string' ? e : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useTauriEvent(BLADE_EVENTS.WORLD_STATE_UPDATED, () => {
    // Live refresh — refetch full state (payload is a summary string only).
    void worldGetState()
      .then((s) => setState(s))
      .catch(() => {
        /* swallow — next scheduled reload will recover */
      });
  });

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const next = await worldRefresh();
      setState(next);
      toast.show({ type: 'success', title: 'World refreshed' });
    } catch (e) {
      toast.show({
        type: 'error',
        title: 'Refresh failed',
        message: typeof e === 'string' ? e : String(e),
      });
    } finally {
      setRefreshing(false);
    }
  };

  const openSummary = async () => {
    setSummaryOpen(true);
    if (summaryText !== null) return;
    setSummaryBusy(true);
    try {
      const s = await worldGetSummary();
      setSummaryText(s);
    } catch (e) {
      setSummaryText(`(Failed to load summary: ${String(e)})`);
    } finally {
      setSummaryBusy(false);
    }
  };

  return (
    <GlassPanel tier={1} className="world-model-surface" data-testid="world-model-root">
      <header className="world-model-header">
        <div>
          <h1 className="world-model-title">World Model</h1>
          <p className="world-model-sub">
            {state
              ? `${formatRelative(state.timestamp)} · ${state.running_processes.length} processes · ${state.git_repos.length} repos · ${state.open_ports.length} ports`
              : 'Loading world state…'}
          </p>
        </div>
        <div className="world-model-actions">
          <Button variant="ghost" onClick={openSummary} data-testid="world-summary-button">
            Summary
          </Button>
          <Button
            variant="secondary"
            onClick={handleRefresh}
            disabled={refreshing}
            data-testid="world-refresh-button"
          >
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </Button>
        </div>
      </header>

      {error && (
        <GlassPanel tier={2} className="body-map-error">
          <strong>World state unavailable.</strong>
          <p>{error}</p>
        </GlassPanel>
      )}

      {loading && !state && (
        <div className="body-map-loading">
          <GlassSpinner />
          <span>Reading world state…</span>
        </div>
      )}

      {state && (
        <>
          <div className="world-hero" data-testid="world-hero">
            <GlassPanel tier={2} className="world-hero-card">
              <span className="world-hero-label">Workspace</span>
              <code className="world-hero-value">{state.workspace_cwd || '—'}</code>
            </GlassPanel>
            <GlassPanel tier={2} className="world-hero-card">
              <span className="world-hero-label">Active window</span>
              <strong className="world-hero-value">{state.active_window || '—'}</strong>
            </GlassPanel>
            <GlassPanel tier={2} className="world-hero-card">
              <span className="world-hero-label">Network</span>
              <strong className="world-hero-value">{state.network_activity || '—'}</strong>
            </GlassPanel>
            <GlassPanel tier={2} className="world-hero-card">
              <span className="world-hero-label">
                CPU cores · {state.system_load.cpu_cores}
              </span>
              <div className="world-load-bar">
                <div style={{ width: `${Math.min(100, (state.system_load.cpu_cores / 16) * 100).toFixed(0)}%` }} />
              </div>
            </GlassPanel>
            <GlassPanel tier={2} className="world-hero-card">
              <span className="world-hero-label">
                RAM · {state.system_load.memory_used_mb.toLocaleString()} /{' '}
                {state.system_load.memory_total_mb.toLocaleString()} MB
              </span>
              <div className="world-load-bar">
                <div
                  style={{
                    width: `${pct(state.system_load.memory_used_mb, state.system_load.memory_total_mb).toFixed(0)}%`,
                  }}
                />
              </div>
            </GlassPanel>
            <GlassPanel tier={2} className="world-hero-card">
              <span className="world-hero-label">
                Disk free · {state.system_load.disk_free_gb.toFixed(1)} GB
              </span>
              <div className="world-load-bar">
                <div
                  style={{
                    width: `${Math.min(100, state.system_load.disk_free_gb).toFixed(0)}%`,
                  }}
                />
              </div>
            </GlassPanel>
          </div>

          <div className="world-tabs" role="tablist" aria-label="World sections">
            {(
              [
                ['git', 'Git'],
                ['processes', 'Processes'],
                ['ports', 'Ports'],
                ['file-changes', 'File changes'],
                ['todos', 'Todos'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                className="world-tab-pill"
                data-active={tab === id}
                data-testid={`world-tab-${id}`}
                onClick={() => setTab(id)}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="world-tab-body" role="tabpanel">
            {tab === 'git' && <GitTab state={state} />}
            {tab === 'processes' && <ProcessesTab state={state} />}
            {tab === 'ports' && <PortsTab state={state} />}
            {tab === 'file-changes' && <FileChangesTab state={state} />}
            {tab === 'todos' && <TodosTab state={state} />}
          </div>
        </>
      )}

      <Dialog open={summaryOpen} onClose={() => setSummaryOpen(false)} ariaLabel="World summary">
        <h3>World summary</h3>
        {summaryBusy ? (
          <div className="body-map-loading">
            <GlassSpinner />
            <span>Loading summary…</span>
          </div>
        ) : (
          <pre className="world-summary-pre">{summaryText ?? ''}</pre>
        )}
        <div className="body-dialog-actions">
          <Button variant="ghost" onClick={() => setSummaryOpen(false)}>
            Close
          </Button>
        </div>
      </Dialog>
    </GlassPanel>
  );
}

// ─── Tab panels ────────────────────────────────────────────────────────────

function GitTab({ state }: { state: WorldState }) {
  if (state.git_repos.length === 0) {
    return <EmptyState label="No git repos" />;
  }
  return (
    <table className="world-table" data-testid="world-git-table">
      <thead>
        <tr>
          <th>Path</th>
          <th>Branch</th>
          <th>Uncommitted</th>
          <th>Untracked</th>
          <th>Ahead</th>
          <th>Last commit</th>
        </tr>
      </thead>
      <tbody>
        {state.git_repos.map((r) => (
          <tr key={r.path}>
            <td>
              <code>{r.path}</code>
            </td>
            <td>{r.branch}</td>
            <td>{r.uncommitted}</td>
            <td>{r.untracked}</td>
            <td>{r.ahead}</td>
            <td className="world-last-commit">{r.last_commit.slice(0, 80)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ProcessesTab({ state }: { state: WorldState }) {
  const rows = [...state.running_processes].slice(0, 20);
  if (rows.length === 0) {
    return <EmptyState label="No processes" />;
  }
  return (
    <table className="world-table" data-testid="world-processes-table">
      <thead>
        <tr>
          <th>PID</th>
          <th>Name</th>
          <th>Interesting</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((p) => (
          <tr key={`${p.pid}-${p.name}`}>
            <td>{p.pid}</td>
            <td>{p.name}</td>
            <td>{p.interesting ? 'yes' : ''}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function PortsTab({ state }: { state: WorldState }) {
  if (state.open_ports.length === 0) {
    return <EmptyState label="No open ports" />;
  }
  return (
    <table className="world-table" data-testid="world-ports-table">
      <thead>
        <tr>
          <th>Port</th>
          <th>Process</th>
          <th>Protocol</th>
        </tr>
      </thead>
      <tbody>
        {state.open_ports.map((p) => (
          <tr key={`${p.port}-${p.protocol}`}>
            <td>{p.port}</td>
            <td>{p.process}</td>
            <td>{p.protocol}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function FileChangesTab({ state }: { state: WorldState }) {
  if (state.recent_file_changes.length === 0) {
    return <EmptyState label="No recent changes" />;
  }
  return (
    <table className="world-table" data-testid="world-changes-table">
      <thead>
        <tr>
          <th>Path</th>
          <th>Kind</th>
          <th>When</th>
        </tr>
      </thead>
      <tbody>
        {state.recent_file_changes.map((c, i) => (
          <tr key={`${c.path}-${i}`}>
            <td>
              <code>{c.path}</code>
            </td>
            <td>{c.change_type}</td>
            <td>{formatRelative(c.changed_at)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function TodosTab({ state }: { state: WorldState }) {
  if (state.pending_todos.length === 0) {
    return <EmptyState label="No pending todos" />;
  }
  return (
    <ul className="world-todos-list" data-testid="world-todos-list">
      {state.pending_todos.map((t, i) => (
        <li key={`${t.file}-${t.line}-${i}`} className="world-todo-row">
          <code className="world-todo-loc">
            {t.file}:{t.line}
          </code>
          <span className="world-todo-text">{t.text}</span>
        </li>
      ))}
    </ul>
  );
}
