// src/features/agents/SwarmNode.tsx — Phase 5 Plan 05-04
//
// Single DAG step card. Rendered by SwarmDAG via absolute-positioned layout.
// Exposes `data-status` so CSS can drive the left-border accent from the
// Phase 5 Plan 05-02 status token palette (--status-running / success / error /
// idle). `data-testid="swarm-node"` is the Plan 05-07 Playwright spec handle.
//
// @see .planning/phases/05-agents-knowledge/05-CONTEXT.md §D-124, §D-137
// @see .planning/phases/05-agents-knowledge/05-PATTERNS.md §3
// @see .planning/REQUIREMENTS.md §AGENT-08

import type { CSSProperties } from 'react';
import type { SwarmTask } from './types';

export interface SwarmNodeProps {
  /** DAG step (Rust SwarmTask — `steps` in plan parlance, `tasks` on the wire). */
  step: SwarmTask;
  /** Absolute-positioning style computed by SwarmDAG.computeLayout. */
  style: CSSProperties;
  /** Click handler; SwarmDAG forwards via onNodeClick(stepId). */
  onClick?: () => void;
}

/** Maps the Rust SwarmTaskStatus PascalCase enum → status token slug. */
function statusToken(s: SwarmTask['status']): 'running' | 'complete' | 'failed' | 'idle' {
  switch (s) {
    case 'Running':
      return 'running';
    case 'Completed':
      return 'complete';
    case 'Failed':
      return 'failed';
    default:
      return 'idle';
  }
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}

export function SwarmNode({ step, style, onClick }: SwarmNodeProps) {
  const status = statusToken(step.status);
  const role = step.role ?? step.task_type ?? 'agent';
  const title = truncate(step.title || step.goal || step.id, 40);
  return (
    <div
      className="swarm-node"
      data-testid="swarm-node"
      data-status={status}
      data-step-id={step.id}
      style={style}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
      aria-label={`${role} step: ${title} (${status})`}
    >
      <div className="swarm-node-head">
        <span className="swarm-node-id">{step.id.slice(0, 6)}</span>
        <span className="swarm-node-status-pill" data-status={status}>
          {step.status}
        </span>
      </div>
      <div className="swarm-node-role">{role}</div>
      <div className="swarm-node-task" title={step.title || step.goal || ''}>
        {title}
      </div>
    </div>
  );
}
