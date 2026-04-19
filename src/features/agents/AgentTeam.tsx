// src/features/agents/AgentTeam.tsx — Phase 5 Plan 05-03 (AGENT-04).
//
// Agents grouped by role. Calls `agentList()` on mount, partitions client-side
// by the first-step tool_name / role field, and renders one section per role.
// Selecting an agent card routes to AgentDetail via the `agents.selectedAgent`
// pref dotted key (D-133).
//
// The 8 "known" roles mirror the Rust agent-role palette referenced by the
// backend registry (Researcher, Coder, Analyst, Writer, Reviewer, plus the
// three Security variants). Unknown roles fall into an "Other" bucket so the
// UI never drops agents silently.
//
// @see .planning/REQUIREMENTS.md §AGENT-04
// @see .planning/phases/05-agents-knowledge/05-CONTEXT.md §D-133

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, GlassPanel, GlassSpinner, Pill } from '@/design-system/primitives';
import { usePrefs } from '@/hooks/usePrefs';
import { useToast } from '@/lib/context/ToastContext';
import { useRouterCtx } from '@/windows/main/useRouter';
import { agentList } from '@/lib/tauri/agents';
import type { Agent } from './types';
import './agents.css';
import './agents-dashboard.css';

/** 8 known agent roles + descriptions. "Other" catches anything unknown. */
const KNOWN_ROLES = [
  'Researcher',
  'Coder',
  'Analyst',
  'Writer',
  'Reviewer',
  'SecurityTestResearcher',
  'SecurityRedTeam',
  'SecurityBlueTeam',
] as const;

const ROLE_DESCRIPTIONS: Record<string, string> = {
  Researcher: 'Web + memory search specialist — gathers evidence for downstream agents.',
  Coder: 'Writes code, runs builds, and iterates until verification passes.',
  Analyst: 'Reasons over datasets, metrics, and logs to surface patterns.',
  Writer: 'Drafts prose, summaries, and user-facing copy from a briefing.',
  Reviewer: 'Cross-checks a peer agent’s output against goals + constraints.',
  SecurityTestResearcher: 'Enumerates attack surface + known CVEs.',
  SecurityRedTeam: 'Simulates adversary behaviour against BLADE’s own posture.',
  SecurityBlueTeam: 'Hardens defences in response to red-team findings.',
  Other: 'Agents whose role is not in the canonical Phase 5 list.',
};

const ROLE_ORDER = [...KNOWN_ROLES, 'Other'] as const;

/** Extract the role label from an Agent — uses first step's tool_name as the
 *  proxy since the Rust Agent struct has no top-level role field (D-127). */
function deriveRole(agent: Agent): string {
  const step0 = agent.steps?.[0];
  const candidate =
    (typeof step0?.tool_name === 'string' ? step0.tool_name : undefined) ??
    (typeof (agent as Record<string, unknown>).role === 'string'
      ? ((agent as Record<string, unknown>).role as string)
      : undefined);
  if (!candidate) return 'Other';
  if ((KNOWN_ROLES as readonly string[]).includes(candidate)) return candidate;
  return 'Other';
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, Math.max(0, n - 1)).trimEnd() + '…';
}

/** Data-status modifier for `.agent-card` visual border cue. */
function cardDataStatus(status: string): string {
  if (status === 'Executing' || status === 'Running' || status === 'Planning') return 'running';
  if (status === 'Completed') return 'complete';
  if (status === 'Failed') return 'failed';
  return 'idle';
}

export function AgentTeam() {
  const { setPref } = usePrefs();
  const { openRoute } = useRouterCtx();
  const { show } = useToast();

  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const list = await agentList();
      setAgents(list);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      show({ type: 'error', title: 'Failed to load team', message: msg });
    } finally {
      setLoading(false);
    }
  }, [show]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSelect = useCallback(
    (agentId: string) => {
      setPref('agents.selectedAgent', agentId);
      openRoute('agent-detail');
    },
    [openRoute, setPref],
  );

  const grouped = useMemo(() => {
    const byRole = new Map<string, Agent[]>();
    for (const a of agents) {
      const role = deriveRole(a);
      const arr = byRole.get(role);
      if (arr) arr.push(a);
      else byRole.set(role, [a]);
    }
    return byRole;
  }, [agents]);

  return (
    <GlassPanel tier={1} className="agents-surface" data-testid="agent-team-root">
      <header className="agents-header-row">
        <div>
          <h1 className="agents-header-title">Agent Team</h1>
          <div className="agents-header-meta">
            <span>{agents.length} total</span>
            <span aria-hidden>·</span>
            <span>{grouped.size} roles</span>
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={() => void load()}>
          Refresh
        </Button>
      </header>

      {error ? (
        <div className="agents-error-pill" role="alert">
          Error: {error}
        </div>
      ) : null}

      {loading ? (
        <div className="agents-loading-wrap">
          <GlassSpinner size={28} label="Loading team" />
        </div>
      ) : agents.length === 0 ? (
        <div className="agents-empty-state">
          No agents active. Create one from the Agent Factory.
        </div>
      ) : (
        ROLE_ORDER.map((role) => {
          const items = grouped.get(role) ?? [];
          if (items.length === 0) return null;
          return (
            <section
              key={role}
              className="agents-group"
              aria-labelledby={`agents-team-role-${role}`}
              data-testid="agent-team-role-section"
            >
              <h2 id={`agents-team-role-${role}`} className="agents-group-heading">
                {role} · {items.length}
              </h2>
              <p className="agents-role-description">
                {ROLE_DESCRIPTIONS[role] ?? ROLE_DESCRIPTIONS.Other}
              </p>
              <div className="agents-card-grid">
                {items.map((a) => (
                  <div
                    key={a.id}
                    className="agent-card"
                    data-status={cardDataStatus(a.status)}
                    data-selectable="true"
                    data-testid="agent-team-card"
                    onClick={() => handleSelect(a.id)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        handleSelect(a.id);
                      }
                    }}
                  >
                    <div className="agent-card-role">{role}</div>
                    <p className="agent-card-task">{truncate(a.goal, 140)}</p>
                    <div className="agent-card-meta">
                      <Pill tone="default">{a.status}</Pill>
                      <span>
                        step {(a.current_step ?? 0) + 1}/{a.steps?.length ?? 0}
                      </span>
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
