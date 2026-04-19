// src/features/agents/AgentTimeline.tsx — Phase 5 Plan 05-04
//
// AGENT-05: unified agent + swarm historical activity log.
// Merges agentList() + swarmList(50) into a single time-sorted feed
// (descending by started_at / created_at). Click routes:
//   - agent row  → openRoute('agent-detail') + setPref('agents.selectedAgent')
//   - swarm row  → openRoute('swarm-view') + local state for selection
//     (D-133 doesn't ship an `agents.selectedSwarm` pref; we avoid schema
//     drift mid-plan and use in-memory state on the SwarmView side).
//
// Rendering stays plain useState (not the rAF-buffer pattern) — this is a
// historical snapshot, not a high-frequency subscriber. A visibility-driven
// poll every 15s keeps the list fresh without re-subscribing to events.
//
// @see .planning/phases/05-agents-knowledge/05-CONTEXT.md §D-133
// @see .planning/REQUIREMENTS.md §AGENT-05

import { useCallback, useEffect, useMemo, useState } from 'react';
import { GlassPanel, GlassSpinner, Pill } from '@/design-system/primitives';
import { agentList, swarmList } from '@/lib/tauri/agents';
import type { Agent, Swarm } from './types';
import { usePrefs } from '@/hooks/usePrefs';
import { useRouterCtx } from '@/windows/main/useRouter';
import './agents.css';
import './agents-dag-pack.css';

type TimelineRow =
  | { kind: 'agent'; id: string; title: string; status: string; ts: number; source: Agent }
  | { kind: 'swarm'; id: string; title: string; status: string; ts: number; source: Swarm };

function relativeTime(ms: number): string {
  const now = Date.now();
  // Rust uses seconds since epoch for most `created_at` fields (agent_factory.rs,
  // swarm.rs). Detect scale by magnitude: anything < 1e12 is treated as seconds.
  const t = ms < 1e12 ? ms * 1000 : ms;
  const diff = now - t;
  if (diff < 0) return 'just now';
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function firstTaskGoal(agent: Agent): string {
  return agent.goal?.slice(0, 80) || agent.id;
}

export function AgentTimeline() {
  const { setPref } = usePrefs();
  const { openRoute } = useRouterCtx();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [swarms, setSwarms] = useState<Swarm[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [a, s] = await Promise.all([agentList(), swarmList(50)]);
      setAgents(a);
      setSwarms(s);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), 15_000);
    return () => window.clearInterval(id);
  }, [refresh]);

  const rows = useMemo<TimelineRow[]>(() => {
    const out: TimelineRow[] = [];
    for (const a of agents) {
      out.push({
        kind: 'agent',
        id: a.id,
        title: firstTaskGoal(a),
        status: String(a.status),
        ts: a.updated_at ?? a.created_at ?? 0,
        source: a,
      });
    }
    for (const s of swarms) {
      out.push({
        kind: 'swarm',
        id: s.id,
        title: s.goal?.slice(0, 80) || s.id,
        status: String(s.status),
        ts: s.updated_at ?? s.created_at ?? 0,
        source: s,
      });
    }
    out.sort((x, y) => y.ts - x.ts);
    return out;
  }, [agents, swarms]);

  const onRowClick = useCallback(
    (row: TimelineRow) => {
      if (row.kind === 'agent') {
        setPref('agents.selectedAgent', row.id);
        openRoute('agent-detail');
      } else {
        openRoute('swarm-view');
      }
    },
    [openRoute, setPref],
  );

  return (
    <GlassPanel tier={1} className="agents-surface" data-testid="agent-timeline-root">
      <header className="timeline-head">
        <h2 className="timeline-heading">Agent Timeline</h2>
        <p className="timeline-sub">Unified history — agents + swarms, newest first.</p>
      </header>

      {loading ? (
        <div className="timeline-empty">
          <GlassSpinner label="Loading timeline" />
        </div>
      ) : err ? (
        <div className="timeline-empty timeline-error" role="alert">
          {err}
        </div>
      ) : rows.length === 0 ? (
        <div className="timeline-empty">No agent history yet.</div>
      ) : (
        <ul className="agents-timeline-list" aria-label="Agent activity">
          {rows.map((row) => (
            <li
              key={`${row.kind}:${row.id}`}
              className="timeline-entry"
              data-testid="timeline-entry"
              data-kind={row.kind}
              data-status={row.status}
              onClick={() => onRowClick(row)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onRowClick(row);
                }
              }}
              role="button"
              tabIndex={0}
              aria-label={`${row.kind} ${row.title} (${row.status})`}
            >
              <span className="timeline-icon" aria-hidden="true">
                {row.kind === 'swarm' ? '◇' : '●'}
              </span>
              <div className="timeline-body">
                <span className="timeline-title">{row.title}</span>
                <span className="timeline-meta">
                  {row.kind === 'swarm' ? 'swarm' : 'agent'} · {row.id.slice(0, 8)}
                </span>
              </div>
              <Pill tone="default">{row.status}</Pill>
              <span className="timeline-time">{relativeTime(row.ts)}</span>
            </li>
          ))}
        </ul>
      )}
    </GlassPanel>
  );
}
