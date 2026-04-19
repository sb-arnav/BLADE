// src/features/knowledge/graphLayout.ts — Phase 5 Plan 05-05
//
// Deterministic polar-coordinate layout for KnowledgeGraph (D-137 + Pattern §4).
// No d3-force dependency — the same node id always lands at the same coordinate
// so the user's mental map survives reloads. Concentric rings (40% / 70% / 100%
// of radius) picked by `hash & 3` prevent every node clustering on the outer
// circle.
//
// `clusterByTag` is the D-137 `nodes.length > 200` escape hatch: group by
// `tag` client-side and render each cluster as a single meta-node.
//
// @see .planning/phases/05-agents-knowledge/05-PATTERNS.md §4
// @see .planning/phases/05-agents-knowledge/05-CONTEXT.md §D-137
//
// Re-uses the wire GraphNode shape from src/lib/tauri/knowledge.ts — callers
// typically pass the array straight through from `graphSearchNodes` /
// `graphTraverse`.

import type { GraphNode } from '@/lib/tauri/knowledge';

/** GraphNode enriched with deterministic (x, y) coordinates. */
export interface LaidOutNode extends GraphNode {
  x: number;
  y: number;
}

/**
 * FNV-1a 32-bit hash — deterministic, seedless, collision tolerance good
 * enough for layout. Matches Pattern §4 reference verbatim.
 *
 * Exported so downstream plans (and tests) can derive the exact same bucket
 * indices the layout uses.
 */
export function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Map each node to (r, θ) via hash; three concentric rings (40%, 70%, 100%
 * of `radius`) picked by `hash & 3` (which gives 0..3; ring 0 = inner,
 * 1 = middle, 2 or 3 = outer).
 *
 * @param nodes  list of GraphNode values from the Rust wire
 * @param radius outer-ring radius in viewport pixels
 * @param cx     viewport center X (px)
 * @param cy     viewport center Y (px)
 * @returns      each input node with `x` + `y` set — original fields preserved
 */
export function layoutNodes(
  nodes: GraphNode[],
  radius: number,
  cx: number,
  cy: number,
): LaidOutNode[] {
  return nodes.map((n) => {
    const h = hash32(n.id);
    const ringPicker = h & 3;
    const ringR =
      ringPicker === 0 ? radius * 0.4 : ringPicker === 1 ? radius * 0.7 : radius * 1.0;
    // Remaining 30 bits give theta in [0, 2π).
    const theta = ((h >>> 2) / 0x40000000) * Math.PI * 2;
    return {
      ...n,
      x: cx + Math.cos(theta) * ringR,
      y: cy + Math.sin(theta) * ringR,
    };
  });
}

/**
 * Group nodes by their `tag` / `node_type` for the D-137 `nodes.length > 200`
 * case. Returns a Map keyed by tag string (falling back to "untagged" when a
 * node has no tag data). Callers can then render each cluster as a single
 * meta-node with a count badge + click-to-expand affordance.
 *
 * The Rust wire shape uses `node_type` (see KnowledgeNode serde struct at
 * knowledge_graph.rs:22), so we read that first and fall back to a generic
 * `tag` property for forward-compat.
 */
export function clusterByTag(nodes: GraphNode[]): Map<string, GraphNode[]> {
  const out = new Map<string, GraphNode[]>();
  for (const n of nodes) {
    const maybeTag = (n as Record<string, unknown>).tag;
    const rawTag =
      typeof n.node_type === 'string' && n.node_type.length > 0
        ? n.node_type
        : typeof maybeTag === 'string' && maybeTag.length > 0
          ? maybeTag
          : 'untagged';
    const arr = out.get(rawTag);
    if (arr) arr.push(n);
    else out.set(rawTag, [n]);
  }
  return out;
}
