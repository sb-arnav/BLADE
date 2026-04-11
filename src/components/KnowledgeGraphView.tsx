// src/components/KnowledgeGraphView.tsx
// Minimal SVG force-directed knowledge graph. No D3 dependency.

import { useEffect, useRef, useState } from "react";
import { BrainEdge, BrainNode } from "../types";

interface NodePos {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

const KIND_COLORS: Record<string, string> = {
  person: "#60a5fa",   // blue
  project: "#34d399",  // green
  tool: "#a78bfa",     // purple
  concept: "#9ca3af",  // gray
  company: "#fbbf24",  // amber
  url: "#f472b6",      // pink
};

function kindColor(kind: string) {
  return KIND_COLORS[kind] ?? "#9ca3af";
}

interface Props {
  nodes: BrainNode[];
  edges: BrainEdge[];
  onNodeClick?: (node: BrainNode) => void;
}

export function KnowledgeGraphView({ nodes, edges, onNodeClick }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const frameRef = useRef<number>(0);
  const [positions, setPositions] = useState<NodePos[]>([]);
  const [search, setSearch] = useState("");
  const posRef = useRef<NodePos[]>([]);
  const [dims, setDims] = useState({ w: 800, h: 500 });

  // Initialise positions randomly
  useEffect(() => {
    const w = svgRef.current?.clientWidth ?? 800;
    const h = svgRef.current?.clientHeight ?? 500;
    setDims({ w, h });

    const initial: NodePos[] = nodes.map((n) => ({
      id: n.id,
      x: w / 2 + (Math.random() - 0.5) * w * 0.6,
      y: h / 2 + (Math.random() - 0.5) * h * 0.6,
      vx: 0,
      vy: 0,
    }));
    posRef.current = initial;
    setPositions([...initial]);
  }, [nodes.length]);

  // Force simulation
  useEffect(() => {
    if (nodes.length === 0) return;

    const REPULSION = 3000;
    const SPRING_LEN = 120;
    const SPRING_K = 0.05;
    const DAMPING = 0.85;
    const GRAVITY = 0.02;
    const cx = dims.w / 2;
    const cy = dims.h / 2;

    let running = true;

    function tick() {
      if (!running) return;

      const pos = posRef.current;
      const forces = pos.map(() => ({ fx: 0, fy: 0 }));

      // Repulsion between all pairs
      for (let i = 0; i < pos.length; i++) {
        for (let j = i + 1; j < pos.length; j++) {
          const dx = pos[j].x - pos[i].x;
          const dy = pos[j].y - pos[i].y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const force = REPULSION / (dist * dist);
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;
          forces[i].fx -= fx;
          forces[i].fy -= fy;
          forces[j].fx += fx;
          forces[j].fy += fy;
        }
      }

      // Spring attraction along edges
      const idxById = new Map(pos.map((p, i) => [p.id, i]));
      for (const edge of edges) {
        const si = idxById.get(edge.from_id);
        const ti = idxById.get(edge.to_id);
        if (si == null || ti == null) continue;
        const dx = pos[ti].x - pos[si].x;
        const dy = pos[ti].y - pos[si].y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const force = SPRING_K * (dist - SPRING_LEN);
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        forces[si].fx += fx;
        forces[si].fy += fy;
        forces[ti].fx -= fx;
        forces[ti].fy -= fy;
      }

      // Gravity toward center
      for (let i = 0; i < pos.length; i++) {
        forces[i].fx += (cx - pos[i].x) * GRAVITY;
        forces[i].fy += (cy - pos[i].y) * GRAVITY;
      }

      // Integrate
      for (let i = 0; i < pos.length; i++) {
        pos[i].vx = (pos[i].vx + forces[i].fx) * DAMPING;
        pos[i].vy = (pos[i].vy + forces[i].fy) * DAMPING;
        pos[i].x = Math.max(20, Math.min(dims.w - 20, pos[i].x + pos[i].vx));
        pos[i].y = Math.max(20, Math.min(dims.h - 20, pos[i].y + pos[i].vy));
      }

      posRef.current = [...pos];
      setPositions([...pos]);
      frameRef.current = requestAnimationFrame(tick);
    }

    frameRef.current = requestAnimationFrame(tick);
    // Stop simulation after 3s (static thereafter)
    const timeout = setTimeout(() => { running = false; }, 3000);

    return () => {
      running = false;
      cancelAnimationFrame(frameRef.current);
      clearTimeout(timeout);
    };
  }, [nodes.length, edges.length, dims]);

  const posById = new Map(positions.map((p) => [p.id, p]));
  const filteredNodeIds = search
    ? new Set(nodes.filter((n) => n.label.toLowerCase().includes(search.toLowerCase())).map((n) => n.id))
    : null;

  const visibleNodes = nodes.filter((n) => !filteredNodeIds || filteredNodeIds.has(n.id));

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 pb-3 pt-1">
        <input
          type="text"
          placeholder="Search nodes..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full text-sm bg-blade-surface border border-blade-border rounded-lg px-3 py-1.5 text-blade-text placeholder:text-blade-muted outline-none focus:border-blade-accent/50"
        />
      </div>

      <div className="flex-1 relative overflow-hidden">
        <svg ref={svgRef} className="w-full h-full" style={{ minHeight: 400 }}>
          {/* Edges */}
          {edges.map((edge) => {
            const s = posById.get(edge.from_id);
            const t = posById.get(edge.to_id);
            if (!s || !t) return null;
            if (filteredNodeIds && !filteredNodeIds.has(edge.from_id) && !filteredNodeIds.has(edge.to_id)) return null;
            const opacity = Math.min(0.7, 0.15 + edge.weight * 0.1);
            return (
              <line
                key={edge.id}
                x1={s.x} y1={s.y} x2={t.x} y2={t.y}
                stroke="#4b5563"
                strokeOpacity={opacity}
                strokeWidth={1 + Math.min(edge.weight * 0.3, 2)}
              />
            );
          })}

          {/* Edge labels */}
          {edges.slice(0, 30).map((edge) => {
            const s = posById.get(edge.from_id);
            const t = posById.get(edge.to_id);
            if (!s || !t) return null;
            if (filteredNodeIds && !filteredNodeIds.has(edge.from_id) && !filteredNodeIds.has(edge.to_id)) return null;
            return (
              <text
                key={`lbl-${edge.id}`}
                x={(s.x + t.x) / 2}
                y={(s.y + t.y) / 2}
                fontSize={9}
                fill="#6b7280"
                textAnchor="middle"
                dominantBaseline="middle"
              >
                {edge.label}
              </text>
            );
          })}

          {/* Nodes */}
          {visibleNodes.map((node) => {
            const pos = posById.get(node.id);
            if (!pos) return null;
            const color = kindColor(node.kind);
            const r = 6 + Math.min(node.mention_count * 1.5, 10);
            return (
              <g
                key={node.id}
                transform={`translate(${pos.x},${pos.y})`}
                className="cursor-pointer"
                onClick={() => onNodeClick?.(node)}
              >
                <circle r={r} fill={color} fillOpacity={0.2} stroke={color} strokeWidth={1.5} />
                <text fontSize={11} fill="#e5e7eb" textAnchor="middle" dy={r + 12} className="select-none pointer-events-none">
                  {node.label.length > 18 ? `${node.label.slice(0, 16)}…` : node.label}
                </text>
              </g>
            );
          })}
        </svg>

        {nodes.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center">
              <div className="w-8 h-8 rounded-lg bg-blade-accent/10 border border-blade-accent/20 flex items-center justify-center mx-auto mb-3">
                <svg className="w-4 h-4 text-blade-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <circle cx="12" cy="12" r="3" strokeWidth={2} />
                  <path d="M12 2v2M12 20v2M2 12h2M20 12h2" strokeWidth={2} strokeLinecap="round" />
                </svg>
              </div>
              <p className="text-sm text-blade-muted">No entities yet.</p>
              <p className="text-2xs text-blade-muted/60 mt-1">Blade will build your graph as you chat.</p>
            </div>
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="px-4 pt-2 pb-3 flex flex-wrap gap-3">
        {Object.entries(KIND_COLORS).map(([kind, color]) => (
          <div key={kind} className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full" style={{ background: color }} />
            <span className="text-2xs text-blade-muted">{kind}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
