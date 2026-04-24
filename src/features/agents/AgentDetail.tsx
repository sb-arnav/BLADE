// src/features/agents/AgentDetail.tsx — Phase 5 Plan 05-03 (AGENT-02).
//
// Real-time timeline surface for a single agent. Consumes 10 Rust emit sites via
// the shared useAgentTimeline hook (Pattern §2 + D-125 + D-129 + D-130) and
// renders an append-only event log next to a 320px agent summary panel. Pause /
// Resume / Cancel action row wires the agentPause / agentResume / agentCancel
// wrappers; Cancel confirms via the Dialog primitive before firing.
//
// WIRE-05 consumer: every event from
//   src-tauri/src/agents/executor.rs:99,177,243,267,314,335,349
// plus `blade_agent_event`, `agent_event`, `agent_step_result` flows through
// the hook into `timeline.rows`. The hook caps retained rows at 200 (D-125)
// and drops cross-agent events client-side (D-130) so the timeline view stays
// focused on the currently-selected agent.
//
// @see .planning/phases/05-agents-knowledge/05-CONTEXT.md §D-125, §D-129, §D-130, §D-134
// @see .planning/phases/05-agents-knowledge/05-PATTERNS.md §2
// @see .planning/REQUIREMENTS.md §AGENT-02

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Button,
  Dialog,
  EmptyState,
  GlassPanel,
  GlassSpinner,
  Pill,
} from '@/design-system/primitives';
import { usePrefs } from '@/hooks/usePrefs';
import { useToast } from '@/lib/context/ToastContext';
import {
  agentCancel,
  agentGet,
  agentPause,
  agentResume,
} from '@/lib/tauri/agents';
import type { Agent } from './types';
import { useAgentTimeline } from './useAgentTimeline';
import './agents.css';
import './agents-dashboard.css';

/** Zero-padded 2-digit formatter for the HH:MM:SS timestamp column. */
function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

function formatTs(ms: number): string {
  const d = new Date(ms);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

/** Map AgentStatus to the .agent-card[data-status] visual cue bucket. */
function statusBucket(status: string): string {
  if (status === 'Executing' || status === 'Planning' || status === 'Running') return 'running';
  if (status === 'Completed') return 'complete';
  if (status === 'Failed') return 'failed';
  return 'idle';
}

/** Pretty-print a JSON preview; falls back to raw string when parse fails. */
function prettyJson(preview: string): string {
  try {
    const parsed = JSON.parse(preview) as unknown;
    return JSON.stringify(parsed, null, 2);
  } catch {
    return preview;
  }
}

export function AgentDetail() {
  const { prefs } = usePrefs();
  const { show } = useToast();

  const selectedRaw = prefs['agents.selectedAgent'];
  const selectedId = typeof selectedRaw === 'string' && selectedRaw.length > 0 ? selectedRaw : null;

  const [agent, setAgent] = useState<Agent | null>(null);
  const [loading, setLoading] = useState<boolean>(!!selectedId);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [confirmCancel, setConfirmCancel] = useState<boolean>(false);
  const [actionBusy, setActionBusy] = useState<boolean>(false);

  const timeline = useAgentTimeline(selectedId);

  // Load agent metadata whenever selection changes; reset timeline via clear().
  useEffect(() => {
    timeline.clear();
    setExpanded(new Set());
    setAgent(null);
    setLoadError(null);

    if (!selectedId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    let cancelled = false;
    agentGet(selectedId)
      .then((a) => {
        if (!cancelled) setAgent(a);
      })
      .catch((e) => {
        if (!cancelled) {
          const msg = e instanceof Error ? e.message : String(e);
          setLoadError(msg);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // timeline.clear identity is stable via useCallback inside the hook;
    // listing it would cause a re-run on every commit. Intentionally omitted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  // Auto-scroll timeline to bottom on new rows UNLESS user has scrolled up.
  const timelineRef = useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = useRef<boolean>(true);

  const handleScroll = useCallback(() => {
    const el = timelineRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 12;
    stickToBottomRef.current = atBottom;
  }, []);

  useEffect(() => {
    const el = timelineRef.current;
    if (!el) return;
    if (stickToBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [timeline.rows.length]);

  const toggleExpand = useCallback((seq: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(seq)) next.delete(seq);
      else next.add(seq);
      return next;
    });
  }, []);

  const handlePause = useCallback(async () => {
    if (!selectedId || actionBusy) return;
    setActionBusy(true);
    try {
      await agentPause(selectedId);
      show({ type: 'success', title: 'Agent paused' });
      try {
        setAgent(await agentGet(selectedId));
      } catch {
        /* non-fatal */
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      show({ type: 'error', title: 'Pause failed', message: msg });
    } finally {
      setActionBusy(false);
    }
  }, [actionBusy, selectedId, show]);

  const handleResume = useCallback(async () => {
    if (!selectedId || actionBusy) return;
    setActionBusy(true);
    try {
      await agentResume(selectedId);
      show({ type: 'success', title: 'Agent resumed' });
      try {
        setAgent(await agentGet(selectedId));
      } catch {
        /* non-fatal */
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      show({ type: 'error', title: 'Resume failed', message: msg });
    } finally {
      setActionBusy(false);
    }
  }, [actionBusy, selectedId, show]);

  const handleCancelConfirmed = useCallback(async () => {
    if (!selectedId) return;
    setActionBusy(true);
    try {
      await agentCancel(selectedId);
      show({ type: 'success', title: 'Cancel requested' });
      try {
        setAgent(await agentGet(selectedId));
      } catch {
        /* non-fatal */
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      show({ type: 'error', title: 'Cancel failed', message: msg });
    } finally {
      setActionBusy(false);
      setConfirmCancel(false);
    }
  }, [selectedId, show]);

  const progress = useMemo(() => {
    if (!agent || !agent.steps || agent.steps.length === 0) return null;
    const done = agent.steps.filter((s) => s.status === 'Completed').length;
    return { done, total: agent.steps.length };
  }, [agent]);

  // Empty state — no selection.
  if (!selectedId) {
    return (
      <GlassPanel tier={1} className="agents-surface" data-testid="agent-detail-root">
        <div className="agent-detail-empty">
          <h2>No agent selected</h2>
          <p>Select an agent from the dashboard to see its real-time timeline.</p>
        </div>
      </GlassPanel>
    );
  }

  return (
    <GlassPanel tier={1} className="agents-surface" data-testid="agent-detail-root">
      <div className="agent-detail-layout">
        {/* ───── Left column: agent summary + actions ───── */}
        <aside className="agent-detail-summary">
          <div
            className="agent-detail-summary-card"
            data-status={agent ? statusBucket(agent.status) : 'idle'}
            data-testid="agent-detail-summary"
          >
            {loading ? (
              <div className="agents-loading-wrap">
                <GlassSpinner size={22} label="Loading agent" />
              </div>
            ) : loadError ? (
              <div className="agents-error-pill" role="alert">
                Error: {loadError}
              </div>
            ) : agent ? (
              <>
                <div className="agent-card-role">Agent · {agent.id.slice(0, 8)}</div>
                <div className="agent-card-meta">
                  <Pill tone="default">{agent.status}</Pill>
                  {progress ? (
                    <span>
                      {progress.done}/{progress.total} steps
                    </span>
                  ) : null}
                </div>
                <p className="agent-detail-summary-task">{agent.goal}</p>
                <div className="agent-card-meta">
                  <span>created {new Date(agent.created_at * 1000).toLocaleTimeString()}</span>
                  <span>updated {new Date(agent.updated_at * 1000).toLocaleTimeString()}</span>
                </div>
                <div className="agents-detail-actions">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void handlePause()}
                    disabled={actionBusy || agent.status === 'Paused' || agent.status === 'Completed' || agent.status === 'Failed'}
                  >
                    Pause
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void handleResume()}
                    disabled={actionBusy || agent.status !== 'Paused'}
                  >
                    Resume
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => setConfirmCancel(true)}
                    disabled={actionBusy || agent.status === 'Completed' || agent.status === 'Failed'}
                  >
                    Cancel
                  </Button>
                </div>
              </>
            ) : null}
          </div>
        </aside>

        {/* ───── Right column: event timeline ───── */}
        <section
          className="agent-detail-timeline"
          ref={timelineRef}
          onScroll={handleScroll}
          aria-label="Agent event timeline"
          data-testid="agent-detail-timeline"
        >
          <div className="agent-detail-timeline-header">
            <h2 className="agent-detail-timeline-header-title">Timeline</h2>
            <span className="agent-detail-timeline-header-count">
              {timeline.rows.length} events
            </span>
          </div>
          {timeline.rows.length === 0 ? (
            <EmptyState
              label="Events will appear as this agent works"
              description="The timeline emits in real time once the agent starts — give me a moment after you spawn it."
            />
          ) : (
            timeline.rows.map((row) => {
              const isOpen = expanded.has(row.seq);
              return (
                <div
                  key={row.seq}
                  className="agent-timeline-row"
                  data-event={row.event}
                  data-expanded={isOpen ? 'true' : 'false'}
                  data-testid="timeline-row"
                  role="button"
                  tabIndex={0}
                  onClick={() => toggleExpand(row.seq)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      toggleExpand(row.seq);
                    }
                  }}
                  aria-expanded={isOpen}
                  aria-label={`${row.event} at ${formatTs(row.ts)}`}
                >
                  <span className="agent-timeline-row-ts">{formatTs(row.ts)}</span>
                  <span className="agent-timeline-row-event">{row.event}</span>
                  <span className="agent-timeline-row-preview">
                    {isOpen ? prettyJson(row.preview) : row.preview || '(empty payload)'}
                  </span>
                </div>
              );
            })
          )}
        </section>
      </div>

      <Dialog
        open={confirmCancel}
        onClose={() => setConfirmCancel(false)}
        ariaLabel="Confirm cancel agent"
      >
        <div className="agents-confirm-dialog">
          <h3>Cancel this agent?</h3>
          <p>In-progress steps will halt and any pending work will be discarded.</p>
          <div className="agents-confirm-dialog-actions">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setConfirmCancel(false)}
              disabled={actionBusy}
            >
              Keep running
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => void handleCancelConfirmed()}
              disabled={actionBusy}
            >
              {actionBusy ? 'Cancelling…' : 'Cancel agent'}
            </Button>
          </div>
        </div>
      </Dialog>
    </GlassPanel>
  );
}
