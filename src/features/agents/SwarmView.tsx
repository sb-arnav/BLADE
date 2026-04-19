// src/features/agents/SwarmView.tsx — Phase 5 Plan 05-04
//
// AGENT-08 + ROADMAP Phase 5 SC-1 — "SwarmView renders a DAG from swarm_*
// commands." Left sidebar = swarmList(20); right pane = selected swarm's
// SwarmDAG + live SwarmProgress.
//
// Event discipline (D-129, D-130, D-135):
//   - Three useTauriEvent subscriptions at top-level hook scope.
//   - SWARM_PROGRESS uses plain useState (swarm_progress emits at step
//     boundaries, not 50/s — rAF buffer would be overkill; D-125 gates rAF
//     to the AgentDetail 10-event surface).
//   - Event → swarm-id filter on payload before mutating state (D-130).
//
// Safety (T-05-04-03):
//   - swarmList(20) — hard limit on sidebar pull; no unbounded polling.
//   - Cancel uses Dialog confirm (T-05-04-02 parity).
//
// @see .planning/phases/05-agents-knowledge/05-CONTEXT.md §D-124, §D-129, §D-130
// @see .planning/REQUIREMENTS.md §AGENT-08

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Button,
  Dialog,
  EmptyState,
  GlassPanel,
  GlassSpinner,
  Pill,
} from '@/design-system/primitives';
import { useRouterCtx } from '@/windows/main/useRouter';
import {
  swarmCancel,
  swarmGet,
  swarmGetProgress,
  swarmList,
  swarmPause,
  swarmResume,
} from '@/lib/tauri/agents';
import type { Swarm, SwarmProgress } from './types';
import { BLADE_EVENTS, useTauriEvent } from '@/lib/events';
import type {
  SwarmCompletedPayload,
  SwarmCreatedPayload,
  SwarmProgressPayload,
} from '@/lib/events';
import { useToast } from '@/lib/context';
import { SwarmDAG } from './SwarmDAG';
import './agents.css';
import './SwarmDAG.css';
import './agents-dag-pack.css';

export function SwarmView() {
  const toast = useToast();
  const { openRoute } = useRouterCtx();
  const [swarms, setSwarms] = useState<Swarm[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedSwarm, setSelectedSwarm] = useState<Swarm | null>(null);
  const [progress, setProgress] = useState<SwarmProgress | null>(null);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingSwarm, setLoadingSwarm] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<Swarm | null>(null);

  const selectedIdRef = useRef<string | null>(null);
  selectedIdRef.current = selectedId;

  const loadList = useCallback(async () => {
    try {
      const list = await swarmList(20);
      setSwarms(list);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingList(false);
    }
  }, []);

  const loadSwarm = useCallback(async (swarmId: string) => {
    setLoadingSwarm(true);
    try {
      const [swarm, prog] = await Promise.all([
        swarmGet(swarmId),
        swarmGetProgress(swarmId),
      ]);
      setSelectedSwarm(swarm);
      setProgress(prog);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.show({ type: 'error', title: 'Load swarm failed', message: msg });
    } finally {
      setLoadingSwarm(false);
    }
  }, [toast]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  useEffect(() => {
    if (!selectedId) {
      setSelectedSwarm(null);
      setProgress(null);
      return;
    }
    void loadSwarm(selectedId);
  }, [selectedId, loadSwarm]);

  // ── Event subscriptions (D-129 top-level; D-130 swarm-id filter) ─────
  useTauriEvent<SwarmProgressPayload>(BLADE_EVENTS.SWARM_PROGRESS, (e) => {
    const payload = e.payload;
    if (!payload || payload.swarm_id !== selectedIdRef.current) return;
    // Map event shape → SwarmProgress interface (fields overlap loosely).
    setProgress((prev) => ({
      swarm_id: payload.swarm_id,
      total: payload.total_steps ?? prev?.total ?? 0,
      completed: payload.completed_steps ?? prev?.completed ?? 0,
      running: (payload.running as number | undefined) ?? prev?.running ?? 0,
      failed: (payload.failed as number | undefined) ?? prev?.failed ?? 0,
      pending: (payload.pending as number | undefined) ?? prev?.pending ?? 0,
      percent:
        payload.total_steps && payload.total_steps > 0
          ? ((payload.completed_steps ?? 0) / payload.total_steps) * 100
          : (prev?.percent ?? 0),
      estimated_seconds_remaining: prev?.estimated_seconds_remaining ?? null,
    }));
  });

  useTauriEvent<SwarmCompletedPayload>(BLADE_EVENTS.SWARM_COMPLETED, (e) => {
    const payload = e.payload;
    if (!payload) return;
    // Refetch on completion so final step statuses land (D-130 filter still
    // applies — only reload if it's the selected swarm).
    if (payload.swarm_id === selectedIdRef.current) {
      void loadSwarm(payload.swarm_id);
    }
    // Any completion also refreshes the sidebar (status pill changes).
    void loadList();
  });

  useTauriEvent<SwarmCreatedPayload>(BLADE_EVENTS.SWARM_CREATED, () => {
    // New swarm exists — refetch list.
    void loadList();
  });

  const onSelect = useCallback((id: string) => {
    setSelectedId(id);
  }, []);

  const onPause = useCallback(
    async (id: string) => {
      try {
        await swarmPause(id);
        toast.show({ type: 'info', title: 'Paused', message: id });
        void loadSwarm(id);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        toast.show({ type: 'error', title: 'Pause failed', message: msg });
      }
    },
    [toast, loadSwarm],
  );

  const onResume = useCallback(
    async (id: string) => {
      try {
        await swarmResume(id);
        toast.show({ type: 'success', title: 'Resumed', message: id });
        void loadSwarm(id);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        toast.show({ type: 'error', title: 'Resume failed', message: msg });
      }
    },
    [toast, loadSwarm],
  );

  const confirmCancel = useCallback(async () => {
    if (!cancelTarget) return;
    try {
      await swarmCancel(cancelTarget.id);
      toast.show({ type: 'success', title: 'Cancelled', message: cancelTarget.id });
      void loadSwarm(cancelTarget.id);
      void loadList();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.show({ type: 'error', title: 'Cancel failed', message: msg });
    } finally {
      setCancelTarget(null);
    }
  }, [cancelTarget, toast, loadSwarm, loadList]);

  const sidebarList = useMemo(
    () => [...swarms].sort((a, b) => (b.updated_at ?? 0) - (a.updated_at ?? 0)),
    [swarms],
  );

  return (
    <GlassPanel tier={1} className="agents-surface swarm-view-shell" data-testid="swarm-view-root">
      <div className="swarm-view-layout">
        {/* ── Sidebar ─────────────────────────────────────────────────── */}
        <aside className="swarm-sidebar" aria-label="Swarms">
          <header className="swarm-sidebar-head">
            <h2 className="swarm-heading">Swarms</h2>
            <span className="swarm-count">{sidebarList.length}</span>
          </header>

          {loadingList ? (
            <div className="swarm-sidebar-empty">
              <GlassSpinner label="Loading swarms" />
            </div>
          ) : err ? (
            <div className="swarm-sidebar-empty swarm-error" role="alert">
              {err}
            </div>
          ) : sidebarList.length === 0 ? (
            <EmptyState
              label="No swarm runs"
              description="Start a swarm from the agent factory."
              actionLabel="Open factory"
              onAction={() => openRoute('agent-factory')}
            />
          ) : (
            <ul className="swarm-sidebar-list">
              {sidebarList.map((s) => (
                <li
                  key={s.id}
                  className={`swarm-sidebar-row${s.id === selectedId ? ' is-selected' : ''}`}
                  data-testid="swarm-sidebar-row"
                  data-status={s.status}
                  onClick={() => onSelect(s.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onSelect(s.id);
                    }
                  }}
                  role="button"
                  tabIndex={0}
                  aria-selected={s.id === selectedId}
                  aria-label={`Swarm ${s.id}: ${s.goal}`}
                >
                  <div className="swarm-row-head">
                    <span className="swarm-row-id">{s.id.slice(0, 8)}</span>
                    <Pill tone="default">{s.status}</Pill>
                  </div>
                  <span className="swarm-row-goal" title={s.goal}>
                    {s.goal || '(no goal)'}
                  </span>
                  <span className="swarm-row-meta">
                    {(s.tasks ?? []).length} steps
                  </span>
                </li>
              ))}
            </ul>
          )}
        </aside>

        {/* ── Right pane ──────────────────────────────────────────────── */}
        <section className="swarm-pane" aria-label="Swarm detail">
          {!selectedId ? (
            <div className="swarm-pane-empty">Select a swarm to see its DAG.</div>
          ) : loadingSwarm && !selectedSwarm ? (
            <div className="swarm-pane-empty">
              <GlassSpinner label="Loading swarm" />
            </div>
          ) : !selectedSwarm ? (
            <div className="swarm-pane-empty">Swarm not found.</div>
          ) : (
            <>
              <header className="swarm-pane-head">
                <div className="swarm-pane-title">
                  <h2 className="swarm-heading">{selectedSwarm.goal || selectedSwarm.id}</h2>
                  <span className="swarm-row-meta">
                    {progress
                      ? `${progress.completed}/${progress.total} steps complete · ${Math.round(progress.percent)}%`
                      : `${(selectedSwarm.tasks ?? []).length} steps`}
                    {' · status: '}
                    <strong>{selectedSwarm.status}</strong>
                  </span>
                </div>
                <div className="swarm-pane-actions">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => onPause(selectedSwarm.id)}
                    disabled={selectedSwarm.status !== 'running'}
                  >
                    Pause
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => onResume(selectedSwarm.id)}
                    disabled={selectedSwarm.status !== 'paused'}
                  >
                    Resume
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setCancelTarget(selectedSwarm)}
                    disabled={
                      selectedSwarm.status === 'completed' ||
                      selectedSwarm.status === 'failed'
                    }
                  >
                    Cancel
                  </Button>
                </div>
              </header>

              {progress ? (
                <div className="swarm-progress-bar" aria-label="Swarm progress">
                  <div
                    className="swarm-progress-fill"
                    style={{ width: `${Math.min(100, Math.max(0, progress.percent))}%` }}
                  />
                </div>
              ) : null}

              <SwarmDAG swarm={selectedSwarm} />
            </>
          )}
        </section>
      </div>

      <Dialog
        open={cancelTarget != null}
        onClose={() => setCancelTarget(null)}
        ariaLabel="Cancel swarm"
      >
        <div className="factory-dialog">
          <h3>Cancel swarm?</h3>
          <p>
            Cancel <strong>{cancelTarget?.id.slice(0, 8)}</strong> —{' '}
            <em>{cancelTarget?.goal}</em>? Running steps will be terminated.
          </p>
          <div className="factory-dialog-actions">
            <Button variant="ghost" onClick={() => setCancelTarget(null)}>
              Keep running
            </Button>
            <Button variant="primary" onClick={confirmCancel}>
              Cancel swarm
            </Button>
          </div>
        </div>
      </Dialog>
    </GlassPanel>
  );
}
