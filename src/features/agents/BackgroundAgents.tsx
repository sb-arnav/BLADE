// src/features/agents/BackgroundAgents.tsx — Phase 5 Plan 05-03 (AGENT-06).
//
// Two-pane layout for external-runtime agents (claude-code / aider / goose /
// codex / custom). Left column lists all background agents + active-agents
// snapshot; right column streams selected agent's output (event-driven primary
// path + 2s polling fallback), exposes Cancel with a Dialog confirm, and hosts
// the Spawn form that calls `agent_spawn`.
//
// Contract:
//   - No raw invoke / listen (D-13, ESLint no-raw-tauri).
//   - All invokes via Plan 05-02 wrappers.
//   - agent_output event stream is the primary surface; 2s polling is a
//     belt-and-braces fallback for missed events (T-05-03-01 defensive layer).
//   - Dialog primitive guards destructive Cancel (T-05-03 review).
//
// @see .planning/REQUIREMENTS.md §AGENT-06
// @see .planning/phases/05-agents-knowledge/05-CONTEXT.md §D-131, §D-134

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Badge,
  Button,
  Dialog,
  GlassPanel,
  GlassSpinner,
  Input,
  Pill,
} from '@/design-system/primitives';
import { useToast } from '@/lib/context/ToastContext';
import { BLADE_EVENTS, useTauriEvent } from '@/lib/events';
import type { AgentOutputPayload } from '@/lib/events/payloads';
import {
  agentCancelBackground,
  agentDetectAvailable,
  agentGetOutput,
  agentListBackground,
  agentSpawn,
  getActiveAgents,
} from '@/lib/tauri/agents';
import type { BackgroundAgent } from './types';
import './agents.css';
import './agents-dashboard.css';

const OUTPUT_POLL_MS = 2000;

/** Merge two BackgroundAgent lists by id (earlier entries win). */
function mergeById(a: BackgroundAgent[], b: BackgroundAgent[]): BackgroundAgent[] {
  const seen = new Set<string>();
  const out: BackgroundAgent[] = [];
  for (const x of [...a, ...b]) {
    if (!x.id || seen.has(x.id)) continue;
    seen.add(x.id);
    out.push(x);
  }
  return out;
}

function cardStatus(status: string): string {
  if (status === 'Executing' || status === 'Running' || status === 'Planning') return 'running';
  if (status === 'Completed') return 'complete';
  if (status === 'Failed') return 'failed';
  return 'idle';
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, Math.max(0, n - 1)).trimEnd() + '…';
}

export function BackgroundAgents() {
  const { show } = useToast();

  const [agents, setAgents] = useState<BackgroundAgent[]>([]);
  const [availableKinds, setAvailableKinds] = useState<string[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [output, setOutput] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Spawn form state.
  const [spawnKind, setSpawnKind] = useState<string>('');
  const [spawnTask, setSpawnTask] = useState<string>('');
  const [spawning, setSpawning] = useState(false);

  // Cancel dialog state.
  const [confirmCancel, setConfirmCancel] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [bgRes, activeRes, kindsRes] = await Promise.allSettled([
        agentListBackground(),
        getActiveAgents(),
        agentDetectAvailable(),
      ]);
      const bg = bgRes.status === 'fulfilled' ? bgRes.value : [];
      const active = activeRes.status === 'fulfilled' ? activeRes.value : [];
      const kinds = kindsRes.status === 'fulfilled' ? kindsRes.value : [];
      setAgents(mergeById(bg, active));
      setAvailableKinds(kinds);
      if (!spawnKind && kinds.length > 0) setSpawnKind(kinds[0] ?? '');
      const firstError =
        bgRes.status === 'rejected'
          ? String(bgRes.reason)
          : activeRes.status === 'rejected'
            ? String(activeRes.reason)
            : kindsRes.status === 'rejected'
              ? String(kindsRes.reason)
              : null;
      if (firstError) setError(firstError);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      show({ type: 'error', title: 'Failed to load background agents', message: msg });
    } finally {
      setLoading(false);
    }
  }, [show, spawnKind]);

  useEffect(() => {
    void load();
  }, [load]);

  const selected = useMemo(
    () => (selectedId ? agents.find((a) => a.id === selectedId) ?? null : null),
    [agents, selectedId],
  );

  // When selection changes, fetch the current output snapshot once.
  useEffect(() => {
    if (!selectedId) {
      setOutput('');
      return;
    }
    let cancelled = false;
    agentGetOutput(selectedId)
      .then((o) => {
        if (!cancelled) setOutput(typeof o === 'string' ? o : '');
      })
      .catch((e) => {
        if (!cancelled) {
          const msg = e instanceof Error ? e.message : String(e);
          setOutput(`[error fetching output: ${msg}]`);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  // Poll output every 2s while selected agent is running (fallback channel).
  const outputRef = useRef(output);
  outputRef.current = output;
  useEffect(() => {
    if (!selected) return;
    // Cast to string for loose comparison — the Rust wire may emit "Running"
    // on some legacy paths even though the authoritative AgentStatus union
    // uses "Executing" (see src/lib/tauri/agents.ts:30). Treat both as live.
    const s = String(selected.status);
    const isRunning = s === 'Executing' || s === 'Running' || s === 'Planning';
    if (!isRunning) return;
    const targetId = selected.id;
    const handle = window.setInterval(() => {
      agentGetOutput(targetId)
        .then((o) => {
          if (typeof o === 'string' && o !== outputRef.current) {
            setOutput(o);
          }
        })
        .catch(() => {
          /* silent — fallback poll must not spam toasts */
        });
    }, OUTPUT_POLL_MS);
    return () => window.clearInterval(handle);
  }, [selected]);

  // Event-driven output streaming (primary path) — D-129 single subscriber.
  useTauriEvent<AgentOutputPayload | null>(BLADE_EVENTS.AGENT_OUTPUT, (e) => {
    const payload = e.payload;
    if (!payload) return;
    if (payload.id !== selectedId) return;
    const chunk = typeof payload.output === 'string' ? payload.output : '';
    if (!chunk) return;
    setOutput((prev) => (prev.endsWith('\n') || prev === '' ? prev + chunk : prev + '\n' + chunk));
  });

  // Agent lifecycle — refresh list when agents start / complete.
  useTauriEvent(BLADE_EVENTS.AGENT_STARTED, () => {
    void load();
  });
  useTauriEvent(BLADE_EVENTS.AGENT_COMPLETED, () => {
    void load();
  });

  const handleSpawn = useCallback(async () => {
    const kind = spawnKind.trim();
    const task = spawnTask.trim();
    if (!kind || !task) {
      show({ type: 'warn', title: 'Spawn requires kind + task' });
      return;
    }
    setSpawning(true);
    try {
      const id = await agentSpawn({ agentType: kind, task });
      show({ type: 'success', title: 'Agent spawned', message: `id: ${id}` });
      setSpawnTask('');
      await load();
      setSelectedId(id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      show({ type: 'error', title: 'Spawn failed', message: msg });
    } finally {
      setSpawning(false);
    }
  }, [load, show, spawnKind, spawnTask]);

  const handleCancelConfirmed = useCallback(async () => {
    if (!confirmCancel) return;
    setCancelling(true);
    try {
      await agentCancelBackground(confirmCancel);
      show({ type: 'success', title: 'Cancel requested' });
      await load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      show({ type: 'error', title: 'Cancel failed', message: msg });
    } finally {
      setCancelling(false);
      setConfirmCancel(null);
    }
  }, [confirmCancel, load, show]);

  return (
    <GlassPanel tier={1} className="agents-surface" data-testid="background-agents-root">
      <header className="agents-header-row">
        <div>
          <h1 className="agents-header-title">Background Agents</h1>
          <div className="agents-header-meta">
            <span>{agents.length} total</span>
            <span aria-hidden>·</span>
            {availableKinds.length > 0 ? (
              <div className="agents-available-chip-row">
                {availableKinds.map((k) => (
                  <Badge key={k} tone="ok">
                    {k}
                  </Badge>
                ))}
              </div>
            ) : (
              <span>no runtimes detected</span>
            )}
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={() => void load()}>
          Refresh
        </Button>
      </header>

      <div className="agents-background-spawn" data-testid="background-agents-spawn">
        <select
          value={spawnKind}
          onChange={(e) => setSpawnKind(e.target.value)}
          disabled={spawning}
          aria-label="Agent runtime kind"
        >
          {availableKinds.length === 0 ? (
            <option value="">No runtime detected</option>
          ) : null}
          {availableKinds.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
        <Input
          placeholder="Task description…"
          value={spawnTask}
          onChange={(e) => setSpawnTask(e.target.value)}
          disabled={spawning}
          aria-label="Task description"
        />
        <Button
          variant="primary"
          size="sm"
          onClick={() => void handleSpawn()}
          disabled={spawning || !spawnKind || !spawnTask.trim()}
        >
          {spawning ? 'Spawning…' : 'Spawn'}
        </Button>
      </div>

      {error ? (
        <div className="agents-error-pill" role="alert">
          Error: {error}
        </div>
      ) : null}

      {loading ? (
        <div className="agents-loading-wrap">
          <GlassSpinner size={28} label="Loading background agents" />
        </div>
      ) : (
        <div className="agents-background-layout">
          <div className="agents-background-left" data-testid="background-agents-list">
            {agents.length === 0 ? (
              <div className="agents-empty-state">
                No background agents. Detected runtimes:{' '}
                {availableKinds.length > 0 ? availableKinds.join(', ') : 'none'}.
              </div>
            ) : (
              agents.map((a) => (
                <div
                  key={a.id}
                  className="agent-card"
                  data-status={cardStatus(a.status)}
                  data-selectable="true"
                  data-selected={selectedId === a.id ? 'true' : 'false'}
                  data-testid="background-agents-card"
                  onClick={() => setSelectedId(a.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setSelectedId(a.id);
                    }
                  }}
                >
                  <div className="agent-card-role">{a.agent_type}</div>
                  <p className="agent-card-task">{truncate(a.task, 140)}</p>
                  <div className="agent-card-meta">
                    <Pill tone="default">{a.status}</Pill>
                    <span>{new Date(a.started_at * 1000).toLocaleTimeString()}</span>
                  </div>
                </div>
              ))
            )}
          </div>
          <div className="agents-background-right" data-testid="background-agents-detail">
            {selected ? (
              <>
                <div className="agents-detail-header">
                  <div>
                    <div className="agent-card-role">{selected.agent_type}</div>
                    <p className="agent-card-task">{selected.task}</p>
                    <div className="agent-card-meta">
                      <Pill tone="default">{selected.status}</Pill>
                      <span>
                        started {new Date(selected.started_at * 1000).toLocaleTimeString()}
                      </span>
                      {typeof selected.exit_code === 'number' ? (
                        <span>exit {selected.exit_code}</span>
                      ) : null}
                    </div>
                  </div>
                  <div className="agents-detail-actions">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setConfirmCancel(selected.id)}
                      disabled={cancelling}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
                <pre
                  className="agents-output-block"
                  aria-label="Agent output stream"
                  data-testid="background-agents-output"
                >
                  {output || '(no output yet)'}
                </pre>
              </>
            ) : (
              <div className="agents-empty-state">Select an agent to stream its output.</div>
            )}
          </div>
        </div>
      )}

      <Dialog
        open={confirmCancel !== null}
        onClose={() => setConfirmCancel(null)}
        ariaLabel="Confirm cancel background agent"
      >
        <div className="agents-confirm-dialog">
          <h3>Cancel this agent?</h3>
          <p>
            This sends a kill signal to the background runtime. In-progress work may be lost.
          </p>
          <div className="agents-confirm-dialog-actions">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setConfirmCancel(null)}
              disabled={cancelling}
            >
              Keep running
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => void handleCancelConfirmed()}
              disabled={cancelling}
            >
              {cancelling ? 'Cancelling…' : 'Cancel agent'}
            </Button>
          </div>
        </div>
      </Dialog>
    </GlassPanel>
  );
}
