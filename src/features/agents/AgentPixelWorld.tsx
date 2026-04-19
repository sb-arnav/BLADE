// src/features/agents/AgentPixelWorld.tsx — Phase 5 Plan 05-04
//
// AGENT-09: emoji grid — one 3×3 cell per role, hormone-tinted border,
// count of agents currently in that role. No animation beyond a CSS hover
// transform (D-138 "Claude's Discretion — planner picked emoji-grid, motion
// deferred to Phase 9 polish"). D-07 blur caps: rgba(...) bg only.
//
// Click navigates to `agent-team` (the role-grouped surface owned by Plan
// 05-03). We don't deep-link to a role — that's a Phase 9 polish item.
//
// @see .planning/phases/05-agents-knowledge/05-CONTEXT.md §D-138
// @see .planning/REQUIREMENTS.md §AGENT-09

import { useCallback, useEffect, useMemo, useState } from 'react';
import { GlassPanel, GlassSpinner } from '@/design-system/primitives';
import { agentList } from '@/lib/tauri/agents';
import type { Agent } from './types';
import { useRouterCtx } from '@/windows/main/useRouter';
import './agents.css';
import './agents-dag-pack.css';

/** 9 canonical roles — see src-tauri/src/agents/mod.rs AgentRole.
 *  Ordered as a 3×3 grid, reading left-to-right, top-to-bottom. */
interface RoleCell {
  id: string;
  label: string;
  emoji: string;
  /** Hormone palette key; matches HORMONE_COLORS in src/features/dashboard/hormoneChip.tsx. */
  color: string;
}

/** ROLE_HORMONE_COLOR — single source of truth for Plan 05-07 spec ground truth.
 *  Values align to src/features/dashboard/hormoneChip.tsx HORMONE_COLORS. */
export const ROLE_HORMONE_COLOR: Record<string, string> = {
  Researcher: '#8affc7', // exploration — green, growth/discovery
  Coder: '#ffd2a6', // energy_mode — amber, sustained focus
  Analyst: '#7fb6ff', // trust — cool blue, consideration
  Writer: '#c8a6ff', // leptin — violet, reflection/satiation
  Reviewer: '#a8d8ff', // thirst — cool, fresh pass
  SecurityRedTeam: '#ff8a8a', // urgency/arousal — warm red, offensive
  SecurityBlueTeam: '#7fb6ff', // trust — defensive stance
  SecurityTestResearcher: '#ffa87f', // hunger — warm amber, probing
  Executor: '#ff9ab0', // adrenaline — warm pink, action
};

const ROLE_GRID: RoleCell[] = [
  { id: 'Researcher', label: 'Researcher', emoji: '📚', color: ROLE_HORMONE_COLOR.Researcher },
  { id: 'Coder', label: 'Coder', emoji: '🛠️', color: ROLE_HORMONE_COLOR.Coder },
  { id: 'Analyst', label: 'Analyst', emoji: '📊', color: ROLE_HORMONE_COLOR.Analyst },
  { id: 'Writer', label: 'Writer', emoji: '✍️', color: ROLE_HORMONE_COLOR.Writer },
  { id: 'Reviewer', label: 'Reviewer', emoji: '🔍', color: ROLE_HORMONE_COLOR.Reviewer },
  { id: 'SecurityRedTeam', label: 'Red Team', emoji: '⚔️', color: ROLE_HORMONE_COLOR.SecurityRedTeam },
  { id: 'SecurityBlueTeam', label: 'Blue Team', emoji: '🛡️', color: ROLE_HORMONE_COLOR.SecurityBlueTeam },
  { id: 'SecurityTestResearcher', label: 'Sec Test', emoji: '🧪', color: ROLE_HORMONE_COLOR.SecurityTestResearcher },
  { id: 'Executor', label: 'Executor', emoji: '⚡', color: ROLE_HORMONE_COLOR.Executor },
];

/**
 * Derive a role id from an Agent record. The Rust Agent struct's top-level
 * shape exposes `goal / status / steps` — there isn't a single canonical
 * "role" field on Agent itself (per agents/mod.rs:155). Roles attach to
 * individual steps via the wire's loose index signature. We probe the first
 * step's `role` hint when present; otherwise we fall back to `"Executor"`
 * (the catch-all agent).
 */
function agentRole(a: Agent): string {
  const firstStep = Array.isArray(a.steps) && a.steps.length > 0 ? a.steps[0] : null;
  const raw = (firstStep?.role ?? (a as { role?: unknown }).role ?? 'Executor') as string;
  return typeof raw === 'string' ? raw : 'Executor';
}

export function AgentPixelWorld() {
  const { openRoute } = useRouterCtx();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await agentList();
        if (!cancelled) setAgents(list);
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const countsByRole = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of agents) {
      const r = agentRole(a);
      m.set(r, (m.get(r) ?? 0) + 1);
    }
    return m;
  }, [agents]);

  const onCellClick = useCallback(() => {
    openRoute('agent-team');
  }, [openRoute]);

  return (
    <GlassPanel tier={1} className="agents-surface" data-testid="agent-pixel-world-root">
      <header className="pixel-world-head">
        <h2 className="pixel-world-heading">Pixel World</h2>
        <p className="pixel-world-sub">
          Nine agent roles, hormone-tinted. Click a cell to jump to the team view.
        </p>
      </header>

      {loading ? (
        <div className="pixel-world-empty">
          <GlassSpinner label="Loading roles" />
        </div>
      ) : err ? (
        <div className="pixel-world-empty pixel-world-error" role="alert">
          {err}
        </div>
      ) : (
        <div className="pixel-world-grid" role="grid" aria-label="Agent roles">
          {ROLE_GRID.map((cell) => {
            const count = countsByRole.get(cell.id) ?? 0;
            return (
              <button
                key={cell.id}
                type="button"
                className="pixel-world-cell"
                data-testid="pixel-world-cell"
                data-role={cell.id}
                data-count={count}
                onClick={onCellClick}
                style={{ borderColor: cell.color }}
                aria-label={`${cell.label} role, ${count} agent${count === 1 ? '' : 's'}`}
                title={`${cell.label} · ${count} agent${count === 1 ? '' : 's'}`}
              >
                <span className="pixel-world-cell-emoji" aria-hidden="true">
                  {cell.emoji}
                </span>
                <span className="pixel-world-cell-label">{cell.label}</span>
                <span className="pixel-world-cell-count">{count}</span>
              </button>
            );
          })}
        </div>
      )}
    </GlassPanel>
  );
}
