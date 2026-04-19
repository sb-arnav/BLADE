// src/features/knowledge/KnowledgeGraph.tsx — Phase 5 Plan 05-05 (KNOW-02).
//
// Deterministic SVG network visualization — calls graph_get_stats +
// graph_search_nodes('') on mount, maps nodes through the hash-based
// polar layout (D-137 + Pattern §4), renders nodes as circles with
// click-to-inspect behavior.
//
// D-137 cluster threshold: when nodes.length > 200, we group by tag via
// clusterByTag and render one meta-node per group with a count badge;
// clicking a meta-node expands it inline.
//
// Edge rendering: the Rust graph_get_stats + graph_search_nodes calls
// do not return edge arrays directly (only node arrays + stats counts). A
// full edge pull would require iterating every node through graphTraverse
// which is expensive (O(n) backend calls). For Phase 5 we render nodes only
// and note this as a follow-up in the plan SUMMARY.
//
// @see .planning/phases/05-agents-knowledge/05-CONTEXT.md §D-137
// @see .planning/REQUIREMENTS.md §KNOW-02

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, GlassPanel } from '@/design-system/primitives';
import {
  graphGetStats,
  graphSearchNodes,
  graphTraverse,
  type GraphNode,
  type GraphStats,
} from '@/lib/tauri/knowledge';
import { clusterByTag, layoutNodes, type LaidOutNode } from './graphLayout';
import { usePrefs } from '@/hooks/usePrefs';
import './knowledge.css';
import './KnowledgeGraph.css';

const CANVAS_W = 900;
const CANVAS_H = 600;
const CANVAS_CX = 450;
const CANVAS_CY = 300;
const CANVAS_R = 260;
const CLUSTER_THRESHOLD = 200;
const NODE_RADIUS = 8;
const CLUSTER_NODE_RADIUS = 18;

interface Tooltip {
  node: LaidOutNode;
  x: number;
  y: number;
}

function nodePreview(node: GraphNode): string {
  const desc = typeof node.description === 'string' ? node.description : '';
  return desc.length > 60 ? desc.slice(0, 59) + '…' : desc;
}

export function KnowledgeGraph() {
  const { prefs, setPref } = usePrefs();
  const sidebarCollapsed =
    typeof prefs['knowledge.sidebarCollapsed'] === 'boolean'
      ? (prefs['knowledge.sidebarCollapsed'] as boolean)
      : false;

  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [stats, setStats] = useState<GraphStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<Tooltip | null>(null);
  const [expandedClusters, setExpandedClusters] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const [statsVal, initialNodes] = await Promise.all([
          graphGetStats(),
          graphSearchNodes(''),
        ]);
        if (cancelled) return;
        setStats(statsVal);

        // Heuristic fallback: if empty-query returns no nodes, try a
        // traversal seeded on "BLADE" to surface something. Documented in
        // SUMMARY as the observed empty-query behavior.
        let working: GraphNode[] = initialNodes;
        if (working.length === 0) {
          try {
            const sg = await graphTraverse({ concept: 'BLADE', depth: 2 });
            if (!cancelled) working = sg.nodes || [];
          } catch {
            /* swallow — empty state rendered below */
          }
        }

        if (!cancelled) setNodes(working);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Choose between flat + clustered layouts based on D-137 threshold.
  const { flatNodes, clusters } = useMemo(() => {
    if (nodes.length <= CLUSTER_THRESHOLD) {
      return {
        flatNodes: layoutNodes(nodes, CANVAS_R, CANVAS_CX, CANVAS_CY),
        clusters: null as Map<string, LaidOutNode[]> | null,
      };
    }
    const grouped = clusterByTag(nodes);
    const meta: GraphNode[] = [];
    for (const [tag, children] of grouped.entries()) {
      meta.push({
        id: `cluster:${tag}`,
        concept: tag,
        node_type: 'cluster',
        description: `${children.length} nodes`,
        sources: [],
        importance: 0,
        created_at: 0,
        last_updated: 0,
      });
    }
    const laidOutMeta = layoutNodes(meta, CANVAS_R, CANVAS_CX, CANVAS_CY);

    const expanded = new Map<string, LaidOutNode[]>();
    for (const [tag, children] of grouped.entries()) {
      if (!expandedClusters.has(tag)) continue;
      const metaNode = laidOutMeta.find((n) => n.id === `cluster:${tag}`);
      if (!metaNode) continue;
      const innerRadius = 60;
      const laidOutChildren = children.map((child, i) => {
        const theta = (i / Math.max(1, children.length)) * Math.PI * 2;
        return {
          ...child,
          x: metaNode.x + Math.cos(theta) * innerRadius,
          y: metaNode.y + Math.sin(theta) * innerRadius,
        };
      });
      expanded.set(tag, laidOutChildren);
    }

    return {
      flatNodes: laidOutMeta,
      clusters: expanded,
    };
  }, [nodes, expandedClusters]);

  const onNodeClick = useCallback((n: LaidOutNode) => {
    if (n.node_type === 'cluster') {
      const tag = n.concept;
      setExpandedClusters((prev) => {
        const next = new Set(prev);
        if (next.has(tag)) next.delete(tag);
        else next.add(tag);
        return next;
      });
      return;
    }
    setSelectedId((cur) => (cur === n.id ? null : n.id));
  }, []);

  const onNodeEnter = useCallback((n: LaidOutNode) => {
    setTooltip({ node: n, x: n.x + 12, y: n.y + 12 });
  }, []);

  const onNodeLeave = useCallback(() => {
    setTooltip(null);
  }, []);

  const selectedNode = useMemo(() => {
    if (!selectedId) return null;
    return nodes.find((n) => n.id === selectedId) ?? null;
  }, [nodes, selectedId]);

  const nodeCount =
    (stats && typeof stats.node_count === 'number' ? (stats.node_count as number) : undefined) ??
    nodes.length;
  const edgeCount =
    stats && typeof stats.edge_count === 'number' ? (stats.edge_count as number) : undefined;

  return (
    <GlassPanel tier={1} className="knowledge-surface" data-testid="knowledge-graph-root">
      <header className="knowledge-graph-header">
        <h2>Knowledge Graph</h2>
        <div className="knowledge-graph-stats">
          <span>nodes: {nodeCount}</span>
          {edgeCount != null && <span>edges: {edgeCount}</span>}
          {nodes.length > CLUSTER_THRESHOLD && (
            <span>clustered ({nodes.length} &gt; {CLUSTER_THRESHOLD})</span>
          )}
        </div>
        <Button
          variant="ghost"
          onClick={() => setPref('knowledge.sidebarCollapsed', !sidebarCollapsed)}
          aria-label={sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'}
        >
          {sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'}
        </Button>
      </header>

      <div
        className={
          sidebarCollapsed ? 'knowledge-graph-root collapsed' : 'knowledge-graph-root'
        }
      >
        <div className="knowledge-graph-canvas">
          {loading && <div className="knowledge-graph-loading">Loading graph…</div>}
          {error && (
            <div className="knowledge-graph-error" role="alert">
              {error}
            </div>
          )}
          {!loading && !error && nodes.length === 0 && (
            <div className="knowledge-graph-empty">
              No graph nodes yet. The knowledge graph grows as you capture
              entries and BLADE extracts relationships.
            </div>
          )}
          {!loading && nodes.length > 0 && (
            <svg
              width={CANVAS_W}
              height={CANVAS_H}
              viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`}
              role="img"
              aria-label={`Knowledge graph with ${nodes.length} nodes`}
            >
              {flatNodes.map((n) => {
                const isCluster = n.node_type === 'cluster';
                const r = isCluster ? CLUSTER_NODE_RADIUS : NODE_RADIUS;
                const selected = !isCluster && n.id === selectedId;
                const countMatch = /^\d+/.exec(
                  typeof n.description === 'string' ? n.description : '',
                );
                return (
                  <g
                    key={n.id}
                    className="knowledge-graph-node-group"
                    transform={`translate(${n.x}, ${n.y})`}
                    onMouseEnter={() => onNodeEnter(n)}
                    onMouseLeave={onNodeLeave}
                    onClick={() => onNodeClick(n)}
                    style={{ cursor: 'pointer' }}
                  >
                    <circle
                      r={r}
                      className="knowledge-graph-node"
                      data-testid="graph-node"
                      data-selected={selected ? 'true' : undefined}
                      data-cluster={isCluster ? 'true' : undefined}
                    />
                    {isCluster && countMatch && (
                      <text
                        className="knowledge-graph-cluster-badge"
                        textAnchor="middle"
                        dy="0.35em"
                      >
                        {countMatch[0]}
                      </text>
                    )}
                  </g>
                );
              })}
              {clusters &&
                Array.from(clusters.values()).flatMap((children) =>
                  children.map((c) => (
                    <g
                      key={c.id}
                      className="knowledge-graph-node-group"
                      transform={`translate(${c.x}, ${c.y})`}
                      onMouseEnter={() => onNodeEnter(c)}
                      onMouseLeave={onNodeLeave}
                      onClick={() => onNodeClick(c)}
                      style={{ cursor: 'pointer' }}
                    >
                      <circle
                        r={NODE_RADIUS}
                        className="knowledge-graph-node"
                        data-testid="graph-node"
                        data-selected={c.id === selectedId ? 'true' : undefined}
                      />
                    </g>
                  )),
                )}
              {tooltip && (
                <g
                  className="knowledge-graph-tooltip"
                  transform={`translate(${tooltip.x}, ${tooltip.y})`}
                  pointerEvents="none"
                >
                  <rect
                    x={0}
                    y={0}
                    width={240}
                    height={60}
                    rx={6}
                    ry={6}
                    className="knowledge-graph-tooltip-bg"
                  />
                  <text x={8} y={18} className="knowledge-graph-tooltip-title">
                    {tooltip.node.concept}
                  </text>
                  <text x={8} y={34} className="knowledge-graph-tooltip-meta">
                    {tooltip.node.node_type || '—'}
                  </text>
                  <text x={8} y={50} className="knowledge-graph-tooltip-preview">
                    {nodePreview(tooltip.node)}
                  </text>
                </g>
              )}
            </svg>
          )}
        </div>

        {!sidebarCollapsed && (
          <aside className="knowledge-graph-sidebar">
            {selectedNode ? (
              <div className="knowledge-graph-sidebar-card">
                <h3>{selectedNode.concept}</h3>
                <div className="knowledge-graph-sidebar-meta">
                  type: {selectedNode.node_type || '—'}
                </div>
                <div className="knowledge-graph-sidebar-meta">
                  importance:{' '}
                  {typeof selectedNode.importance === 'number'
                    ? selectedNode.importance.toFixed(2)
                    : '—'}
                </div>
                <p className="knowledge-graph-sidebar-desc">
                  {selectedNode.description || '(no description)'}
                </p>
                {Array.isArray(selectedNode.sources) && selectedNode.sources.length > 0 && (
                  <>
                    <div className="knowledge-graph-sidebar-meta">sources:</div>
                    <ul className="knowledge-graph-sidebar-sources">
                      {selectedNode.sources.map((s, i) => (
                        <li key={i}>{s}</li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            ) : (
              <div className="knowledge-graph-sidebar-empty">
                Click a node to inspect it.{' '}
                {nodes.length > CLUSTER_THRESHOLD && 'Click a cluster badge to expand.'}
              </div>
            )}
          </aside>
        )}
      </div>
    </GlassPanel>
  );
}
