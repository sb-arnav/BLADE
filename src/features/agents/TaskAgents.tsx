// src/features/agents/TaskAgents.tsx — Phase 5 Plan 05-04
//
// AGENT-07: task-queue-style surface for background-spawned agents
// (claude-code / aider / goose / codex) via agent_spawn + agent_list_background.
//
// Layout:
//   - Top card — Spawn form (task textarea + detected-runtime radio + Spawn).
//   - Below   — task-agent-card list, filtered to runtime kinds, with
//               status pill + cancel.
//
// Auto-refresh every 5s (plain setInterval; background agents update on
// agent_output events which are noisy but not per-frame; polling is cheaper
// than subscribing + rAF-buffering for this surface).
//
// @see .planning/phases/05-agents-knowledge/05-CONTEXT.md §D-131
// @see .planning/REQUIREMENTS.md §AGENT-07
// @see src-tauri/src/background_agent.rs:152,377,393,405

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, GlassPanel, GlassSpinner, Pill } from '@/design-system/primitives';
import {
  agentCancelBackground,
  agentDetectAvailable,
  agentListBackground,
  agentSpawn,
} from '@/lib/tauri/agents';
import type { BackgroundAgent } from './types';
import { useToast } from '@/lib/context';
import './agents.css';
import './agents-dag-pack.css';

const TASK_KINDS = new Set(['claude-code', 'aider', 'goose', 'codex', 'custom']);

export function TaskAgents() {
  const toast = useToast();
  const [task, setTask] = useState('');
  const [kind, setKind] = useState<string>('claude-code');
  const [available, setAvailable] = useState<string[]>([]);
  const [agents, setAgents] = useState<BackgroundAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [spawning, setSpawning] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [list, detected] = await Promise.all([
        agentListBackground(),
        agentDetectAvailable(),
      ]);
      setAgents(list);
      setAvailable(detected);
      // Seed the kind dropdown to the first detected runtime if current choice
      // is absent on this system.
      if (detected.length > 0 && !detected.includes(kind)) {
        setKind(detected[0]);
      }
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [kind]);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), 5_000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onSpawn = useCallback(async () => {
    const t = task.trim();
    if (!t) return;
    setSpawning(true);
    try {
      const id = await agentSpawn({ agentType: kind, task: t });
      toast.show({ type: 'success', title: 'Task agent spawned', message: id });
      setTask('');
      void refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.show({ type: 'error', title: 'Spawn failed', message: msg });
    } finally {
      setSpawning(false);
    }
  }, [task, kind, toast, refresh]);

  const onCancel = useCallback(
    async (id: string) => {
      try {
        await agentCancelBackground(id);
        toast.show({ type: 'info', title: 'Cancelled', message: id });
        void refresh();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        toast.show({ type: 'error', title: 'Cancel failed', message: msg });
      }
    },
    [toast, refresh],
  );

  const taskAgents = useMemo(
    () => agents.filter((a) => TASK_KINDS.has(a.agent_type)),
    [agents],
  );

  const runtimeChoices = available.length > 0 ? available : Array.from(TASK_KINDS);

  return (
    <GlassPanel tier={1} className="agents-surface" data-testid="task-agents-root">
      <header className="tasks-head">
        <h2 className="tasks-heading">Task Agents</h2>
        <p className="tasks-sub">
          Queue a task for an external agent runtime.{' '}
          {available.length > 0 ? (
            <>Detected: <strong>{available.join(', ')}</strong></>
          ) : (
            <>No runtimes detected. Install claude-code, aider, or goose.</>
          )}
        </p>
      </header>

      <section className="tasks-spawn" aria-label="Spawn a new task agent">
        <label className="tasks-field">
          <span className="tasks-label">Task</span>
          <textarea
            className="tasks-textarea"
            rows={3}
            value={task}
            onChange={(e) => setTask(e.target.value)}
            placeholder="Refactor the login module to use Supabase SSR…"
            disabled={spawning}
          />
        </label>
        <fieldset className="tasks-kinds" disabled={spawning}>
          <legend className="tasks-label">Runtime</legend>
          {runtimeChoices.map((k) => (
            <label key={k} className="tasks-kind-radio">
              <input
                type="radio"
                name="task-kind"
                value={k}
                checked={kind === k}
                onChange={() => setKind(k)}
              />
              <span>{k}</span>
            </label>
          ))}
        </fieldset>
        <Button
          variant="primary"
          onClick={onSpawn}
          disabled={spawning || !task.trim() || available.length === 0}
        >
          {spawning ? 'Spawning…' : 'Spawn Task'}
        </Button>
      </section>

      <section className="tasks-list-section" aria-label="Running task agents">
        <div className="tasks-list-head">
          <h3 className="tasks-heading tasks-heading-sm">Queued tasks</h3>
          <span className="tasks-count">{taskAgents.length}</span>
        </div>
        {loading ? (
          <div className="tasks-empty">
            <GlassSpinner label="Loading tasks" />
          </div>
        ) : err ? (
          <div className="tasks-empty tasks-error" role="alert">
            {err}
          </div>
        ) : taskAgents.length === 0 ? (
          <div className="tasks-empty">
            No task agents.{' '}
            {available.length > 0
              ? `Detected runtimes: ${available.join(', ')}.`
              : 'Install claude-code, aider, or goose to queue tasks.'}
          </div>
        ) : (
          <ul className="tasks-list">
            {taskAgents.map((a) => (
              <li
                key={a.id}
                className="task-agent-card"
                data-testid="task-agent-card"
                data-agent-id={a.id}
                data-kind={a.agent_type}
                data-status={String(a.status).toLowerCase()}
              >
                <div className="task-agent-head">
                  <span className="task-agent-kind">{a.agent_type}</span>
                  <Pill tone="default">{a.status}</Pill>
                </div>
                <p className="task-agent-task" title={a.task}>
                  {a.task}
                </p>
                <div className="task-agent-footer">
                  <span className="task-agent-id">{a.id.slice(0, 8)}</span>
                  <Button variant="ghost" size="sm" onClick={() => onCancel(a.id)}>
                    Cancel
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </GlassPanel>
  );
}
