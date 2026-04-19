// src/features/agents/AgentDashboard.tsx — Phase 5 Plan 05-03 (AGENT-01).
//
// Running + idle + completed + failed agents list with a 4-segment status filter
// chip row. Mounts on route `/agents`; on mount calls three wrappers in parallel
// (agentList, getActiveAgents, agentDetectAvailable) and groups the results.
// Selecting a card routes to AgentDetail via the pref `agents.selectedAgent`.
//
// Contract:
//   - No raw invoke / listen (D-13, ESLint no-raw-tauri).
//   - All invokes via Plan 05-02 wrappers.
//   - Filter state persisted via usePrefs `agents.filterStatus` (D-133).
//   - Selected-agent dotted key drives AgentDetail deep-link (D-133).
//
// @see .planning/phases/05-agents-knowledge/05-CONTEXT.md §D-131, §D-133, §D-134
// @see .planning/REQUIREMENTS.md §AGENT-01

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge, Button, EmptyState, GlassPanel, GlassSpinner, Pill } from '@/design-system/primitives';
import { usePrefs } from '@/hooks/usePrefs';
import { useToast } from '@/lib/context/ToastContext';
import { useRouterCtx } from '@/windows/main/useRouter';
import {
  agentDetectAvailable,
  agentList,
  getActiveAgents,
} from '@/lib/tauri/agents';
import type { Agent, AgentStatus, BackgroundAgent } from './types';
import type { AgentFilterStatus } from './types';
import './agents.css';
import './agents-dashboard.css';

type GroupKey = 'running' | 'idle' | 'complete' | 'failed';

const GROUP_ORDER: GroupKey[] = ['running', 'idle', 'complete', 'failed'];

const GROUP_LABELS: Record<GroupKey, string> = {
  running: 'Running',
  idle: 'Idle',
  complete: 'Complete',
  failed: 'Failed',
};

const FILTER_OPTIONS: AgentFilterStatus[] = ['all', 'running', 'idle', 'failed'];
const FILTER_LABELS: Record<AgentFilterStatus, string> = {
  all: 'All',
  running: 'Running',
  idle: 'Idle',
  failed: 'Failed',
};

/** Map Rust AgentStatus + BackgroundAgent status variants to our grouping key. */
function classify(status: string): GroupKey {
  switch (status) {
    case 'Executing':
    case 'Running':
    case 'Planning':
    case 'WaitingApproval':
      return 'running';
    case 'Paused':
      return 'idle';
    case 'Completed':
      return 'complete';
    case 'Failed':
      return 'failed';
    default:
      return 'idle';
  }
}

/** Data-status attribute value for `.agent-card[data-status]` visual cues. */
function cardDataStatus(group: GroupKey): string {
  if (group === 'running') return 'running';
  if (group === 'complete') return 'complete';
  if (group === 'failed') return 'failed';
  return 'idle';
}

/** Shared display shape across Agent + BackgroundAgent so cards render uniformly. */
interface DashboardAgent {
  id: string;
  role: string;
  task: string;
  status: string;
  group: GroupKey;
  kind: 'foreground' | 'background';
}

function toDashboardFg(agent: Agent): DashboardAgent {
  const primaryStep = agent.steps?.[agent.current_step ?? 0];
  const role = typeof primaryStep?.tool_name === 'string' ? primaryStep.tool_name : 'Agent';
  return {
    id: agent.id,
    role,
    task: agent.goal,
    status: agent.status,
    group: classify(agent.status),
    kind: 'foreground',
  };
}

function toDashboardBg(agent: BackgroundAgent): DashboardAgent {
  return {
    id: agent.id,
    role: agent.agent_type,
    task: agent.task,
    status: agent.status as AgentStatus,
    group: classify(agent.status),
    kind: 'background',
  };
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, Math.max(0, n - 1)).trimEnd() + '…';
}

export function AgentDashboard() {
  const { prefs, setPref } = usePrefs();
  const { openRoute } = useRouterCtx();
  const { show } = useToast();

  const [agents, setAgents] = useState<DashboardAgent[]>([]);
  const [availableKinds, setAvailableKinds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const filter = (prefs['agents.filterStatus'] ?? 'all') as AgentFilterStatus;

  const load = useCallback(async () => {
    setError(null);
    try {
      const [fgRes, bgRes, kindsRes] = await Promise.allSettled([
        agentList(),
        getActiveAgents(),
        agentDetectAvailable(),
      ]);
      const fg = fgRes.status === 'fulfilled' ? fgRes.value.map(toDashboardFg) : [];
      const bg = bgRes.status === 'fulfilled' ? bgRes.value.map(toDashboardBg) : [];
      const kinds = kindsRes.status === 'fulfilled' ? kindsRes.value : [];
      // Merge: dedupe by id (foreground agents win if both surfaces report).
      const seen = new Set<string>();
      const merged: DashboardAgent[] = [];
      for (const a of [...fg, ...bg]) {
        if (!a.id || seen.has(a.id)) continue;
        seen.add(a.id);
        merged.push(a);
      }
      setAgents(merged);
      setAvailableKinds(kinds);
      // Collect error message from any rejected promise for non-blocking toast.
      const firstError =
        fgRes.status === 'rejected'
          ? String(fgRes.reason)
          : bgRes.status === 'rejected'
            ? String(bgRes.reason)
            : kindsRes.status === 'rejected'
              ? String(kindsRes.reason)
              : null;
      if (firstError) {
        setError(firstError);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      show({ type: 'error', title: 'Failed to load agents', message: msg });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [show]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    void load();
  }, [load]);

  const handleSelect = useCallback(
    (agentId: string) => {
      setPref('agents.selectedAgent', agentId);
      openRoute('agent-detail');
    },
    [openRoute, setPref],
  );

  const handleFilter = useCallback(
    (next: AgentFilterStatus) => {
      setPref('agents.filterStatus', next);
    },
    [setPref],
  );

  // Apply filter to groupings.
  const grouped = useMemo(() => {
    const by: Record<GroupKey, DashboardAgent[]> = {
      running: [],
      idle: [],
      complete: [],
      failed: [],
    };
    for (const a of agents) {
      by[a.group].push(a);
    }
    if (filter === 'all') return by;
    const empty: Record<GroupKey, DashboardAgent[]> = {
      running: [],
      idle: [],
      complete: [],
      failed: [],
    };
    empty[filter as GroupKey] = by[filter as GroupKey] ?? [];
    return empty;
  }, [agents, filter]);

  const totalVisible = GROUP_ORDER.reduce((acc, k) => acc + (grouped[k]?.length ?? 0), 0);

  return (
    <GlassPanel tier={1} className="agents-surface" data-testid="agent-dashboard-root">
      <header className="agents-header-row">
        <div>
          <h1 className="agents-header-title">Agents</h1>
          <div className="agents-header-meta">
            <span>{totalVisible} visible</span>
            <span aria-hidden>·</span>
            <span>{agents.length} total</span>
          </div>
        </div>
        <div className="agents-header-meta">
          {availableKinds.length > 0 ? (
            <div
              className="agents-available-chip-row"
              aria-label="Detected agent runtimes"
            >
              {availableKinds.map((k) => (
                <Badge key={k} tone="ok">
                  {k}
                </Badge>
              ))}
            </div>
          ) : null}
          <Button variant="ghost" size="sm" onClick={handleRefresh} disabled={refreshing}>
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </Button>
        </div>
      </header>

      <div
        className="agents-filter-row"
        role="radiogroup"
        aria-label="Filter agents by status"
      >
        {FILTER_OPTIONS.map((opt) => (
          <button
            key={opt}
            type="button"
            className="agents-filter-pill"
            data-active={filter === opt ? 'true' : 'false'}
            role="radio"
            aria-checked={filter === opt}
            onClick={() => handleFilter(opt)}
          >
            {FILTER_LABELS[opt]}
          </button>
        ))}
      </div>

      {error ? (
        <div className="agents-error-pill" role="alert">
          Error: {error}
        </div>
      ) : null}

      {loading ? (
        <div className="agents-loading-wrap">
          <GlassSpinner size={28} label="Loading agents" />
        </div>
      ) : totalVisible === 0 ? (
        <EmptyState
          label="No agents yet"
          description="Spawn one from the agent factory."
          actionLabel="Open factory"
          onAction={() => openRoute('agent-factory')}
        />
      ) : (
        GROUP_ORDER.map((group) => {
          const items = grouped[group] ?? [];
          if (items.length === 0) return null;
          return (
            <section key={group} className="agents-group" aria-labelledby={`agents-group-${group}`}>
              <h2 id={`agents-group-${group}`} className="agents-group-heading">
                {GROUP_LABELS[group]} · {items.length}
              </h2>
              <div className="agents-card-grid">
                {items.map((a) => (
                  <div
                    key={a.id}
                    className="agent-card"
                    data-status={cardDataStatus(a.group)}
                    data-testid="agent-dashboard-card"
                  >
                    <div className="agent-card-role">{a.role}</div>
                    <p className="agent-card-task">{truncate(a.task, 120)}</p>
                    <div className="agent-card-meta">
                      <Pill tone="default">{a.status}</Pill>
                      <span>{a.kind === 'background' ? 'background' : 'foreground'}</span>
                    </div>
                    <div className="agent-card-actions">
                      <Button size="sm" variant="secondary" onClick={() => handleSelect(a.id)}>
                        View
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          );
        })
      )}
    </GlassPanel>
  );
}
