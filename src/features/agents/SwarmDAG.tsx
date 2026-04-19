// src/features/agents/SwarmDAG.tsx — Phase 5 Plan 05-04
//
// Reusable read-only DAG renderer used by SwarmView. Deterministic topological
// grid layout (Pattern §3) + axis-aligned SVG L-paths for dependency edges
// (D-124 "legibility over prettiness"). No external DAG library; no d3-force;
// no zoom/pan; no drag/drop — all explicitly deferred per D-124.
//
// Layout discipline (T-05-04-01 mitigation):
//   - `useMemo` keyed on swarm.id + steps.length + a compact status hash, so
//     high-frequency swarm_progress events that only mutate a step's status
//     do NOT trigger a re-layout. Position is stable for the life of the DAG.
//   - Nodes render as absolutely-positioned <SwarmNode> children. Status
//     updates flow via the `swarm` prop → the status pill inside each node
//     re-renders, but x/y never move.
//
// Cycle safety (defensive, D-38-payload loose shape):
//   - Topological walk guards against re-entry via a `visiting` set; any
//     cycle produces a console.warn + treats the offending nodes as layer 0.
//
// @see .planning/phases/05-agents-knowledge/05-CONTEXT.md §D-124
// @see .planning/phases/05-agents-knowledge/05-PATTERNS.md §3
// @see .planning/REQUIREMENTS.md §AGENT-08

import { useMemo } from 'react';
import type { Swarm, SwarmTask } from './types';
import { SwarmNode } from './SwarmNode';

export interface SwarmDAGProps {
  swarm: Swarm;
  onNodeClick?: (stepId: string) => void;
}

interface LayoutNode {
  step: SwarmTask;
  layer: number;
  row: number;
  x: number;
  y: number;
}

const LAYER_COL_WIDTH = 220;
const NODE_ROW_HEIGHT = 112;
const NODE_WIDTH = 180;
const NODE_HEIGHT = 88;
const PADDING = 20;

/** Pure layout fn — exported for testing. Deterministic: same input → same output. */
export function computeLayout(swarm: Swarm): LayoutNode[] {
  const steps = swarm.tasks ?? [];
  if (steps.length === 0) return [];

  const stepById = new Map<string, SwarmTask>(steps.map((s) => [s.id, s]));
  const layerById = new Map<string, number>();
  const visiting = new Set<string>();

  const walk = (id: string): number => {
    if (layerById.has(id)) return layerById.get(id)!;
    if (visiting.has(id)) {
      // Cycle detected — log + bail out at layer 0 for this node.
      // eslint-disable-next-line no-console
      console.warn(`[SwarmDAG] cycle detected at step "${id}", treating as layer 0`);
      layerById.set(id, 0);
      return 0;
    }
    const step = stepById.get(id);
    if (!step) {
      // Unknown dep reference — treat as layer 0.
      layerById.set(id, 0);
      return 0;
    }
    const deps = step.depends_on ?? [];
    if (deps.length === 0) {
      layerById.set(id, 0);
      return 0;
    }
    visiting.add(id);
    const layer = 1 + Math.max(...deps.map((d) => walk(d)));
    visiting.delete(id);
    layerById.set(id, layer);
    return layer;
  };

  steps.forEach((s) => walk(s.id));

  // Group by layer in input order (stable).
  const byLayer = new Map<number, SwarmTask[]>();
  steps.forEach((s) => {
    const l = layerById.get(s.id)!;
    if (!byLayer.has(l)) byLayer.set(l, []);
    byLayer.get(l)!.push(s);
  });

  const nodes: LayoutNode[] = [];
  byLayer.forEach((stepsInLayer, layer) => {
    stepsInLayer.forEach((step, row) => {
      nodes.push({
        step,
        layer,
        row,
        x: layer * LAYER_COL_WIDTH + PADDING,
        y: row * NODE_ROW_HEIGHT + PADDING,
      });
    });
  });
  return nodes;
}

/**
 * Compact status hash — contributes to useMemo key so pure-status changes on
 * existing step ids re-render nodes without re-laying-out (T-05-04-01).
 */
function statusKey(swarm: Swarm): string {
  return (swarm.tasks ?? []).map((t) => `${t.id}:${t.status}`).join('|');
}

export function SwarmDAG({ swarm, onNodeClick }: SwarmDAGProps) {
  const steps = swarm.tasks ?? [];

  const nodes = useMemo(
    () => computeLayout(swarm),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [swarm.id, steps.length],
  );

  if (steps.length === 0) {
    return (
      <div
        className="swarm-dag swarm-dag-empty"
        data-testid="swarm-dag-root"
        role="status"
        aria-label="Empty swarm"
      >
        <span className="swarm-dag-empty-hint">No steps in this swarm.</span>
      </div>
    );
  }

  const width = Math.max(...nodes.map((n) => n.x + NODE_WIDTH), 400) + PADDING;
  const height = Math.max(...nodes.map((n) => n.y + NODE_HEIGHT), 200) + PADDING;
  const nodeById = new Map(nodes.map((n) => [n.step.id, n]));

  // Status key included on the container for debugging / memoization boundary visibility.
  const sKey = statusKey(swarm);

  return (
    <div
      className="swarm-dag"
      data-testid="swarm-dag-root"
      data-swarm-id={swarm.id}
      data-status={swarm.status}
      data-status-key={sKey}
      style={{ width, height, position: 'relative' }}
    >
      <svg
        className="swarm-dag-edges"
        width={width}
        height={height}
        aria-hidden="true"
        focusable="false"
      >
        {nodes.flatMap((n) =>
          (n.step.depends_on ?? [])
            .map((depId) => {
              const from = nodeById.get(depId);
              if (!from) return null;
              // Axis-aligned L-path from from.right-center → n.left-center (D-124).
              const x1 = from.x + NODE_WIDTH;
              const y1 = from.y + NODE_HEIGHT / 2;
              const x2 = n.x;
              const y2 = n.y + NODE_HEIGHT / 2;
              const mx = (x1 + x2) / 2;
              return (
                <path
                  key={`${depId}→${n.step.id}`}
                  d={`M ${x1} ${y1} H ${mx} V ${y2} H ${x2}`}
                  stroke="var(--line-strong)"
                  strokeWidth={1.5}
                  fill="none"
                />
              );
            })
            .filter(Boolean),
        )}
      </svg>
      {nodes.map((n) => (
        <SwarmNode
          key={n.step.id}
          step={n.step}
          style={{
            position: 'absolute',
            left: n.x,
            top: n.y,
            width: NODE_WIDTH,
            height: NODE_HEIGHT,
          }}
          onClick={onNodeClick ? () => onNodeClick(n.step.id) : undefined}
        />
      ))}
    </div>
  );
}
