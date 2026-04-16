/**
 * KNOWLEDGE GRAPH — Visual force-directed graph of BLADE's knowledge.
 * Ported from Omi's MemoryGraphPage. Canvas-rendered for performance.
 * Nodes = concepts/entities, edges = relationships.
 * Drag to pan, scroll to zoom, click node for details.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

interface KgNode {
  id: string;
  concept: string;
  node_type: string;
  description: string;
  importance: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

interface KgEdge {
  source_id: string;
  target_id: string;
  relation: string;
  weight: number;
}

interface KnowledgeGraphViewProps {
  onBack: () => void;
}

const TYPE_COLORS: Record<string, string> = {
  person: "#f87171",
  technology: "#60a5fa",
  concept: "#818cf8",
  event: "#fbbf24",
  project: "#4ade80",
  organization: "#fb923c",
};

export function KnowledgeGraphView({ onBack }: KnowledgeGraphViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [nodes, setNodes] = useState<KgNode[]>([]);
  const [edges, setEdges] = useState<KgEdge[]>([]);
  const [selectedNode, setSelectedNode] = useState<KgNode | null>(null);
  const [search, setSearch] = useState("");
  const animRef = useRef<number>(0);
  const panRef = useRef({ x: 0, y: 0 });
  const zoomRef = useRef(1);
  const isPanningRef = useRef(false);
  const lastMouseRef = useRef({ x: 0, y: 0 });

  useEffect(() => {
    invoke<{ nodes: Array<{ id: string; concept: string; node_type: string; description: string; importance: number }>; edges: KgEdge[] }>(
      "knowledge_get_graph", { limit: 200 }
    ).then(({ nodes: raw, edges: e }) => {
      setNodes(raw.map((n) => ({ ...n, x: Math.random() * 600 - 300, y: Math.random() * 400 - 200, vx: 0, vy: 0 })));
      setEdges(e);
    }).catch(() => {
      invoke<Array<{ id: string; concept: string; node_type: string; description: string; importance: number }>>(
        "knowledge_list_nodes", { limit: 200 }
      ).then((raw) => {
        setNodes(raw.map((n) => ({ ...n, x: Math.random() * 600 - 300, y: Math.random() * 400 - 200, vx: 0, vy: 0 })));
      }).catch(() => null);
    });
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || nodes.length === 0) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const frameNodes = [...nodes];

    const tick = () => {
      // Force simulation
      for (let i = 0; i < frameNodes.length; i++) {
        for (let j = i + 1; j < frameNodes.length; j++) {
          const dx = frameNodes[i].x - frameNodes[j].x;
          const dy = frameNodes[i].y - frameNodes[j].y;
          const d = Math.sqrt(dx * dx + dy * dy) + 1;
          const f = 800 / (d * d);
          frameNodes[i].vx += (dx / d) * f;
          frameNodes[i].vy += (dy / d) * f;
          frameNodes[j].vx -= (dx / d) * f;
          frameNodes[j].vy -= (dy / d) * f;
        }
      }
      for (const e of edges) {
        const s = frameNodes.find((n) => n.id === e.source_id);
        const t = frameNodes.find((n) => n.id === e.target_id);
        if (!s || !t) continue;
        const dx = t.x - s.x, dy = t.y - s.y;
        const d = Math.sqrt(dx * dx + dy * dy) + 1;
        const f = d * 0.005;
        s.vx += (dx / d) * f; s.vy += (dy / d) * f;
        t.vx -= (dx / d) * f; t.vy -= (dy / d) * f;
      }
      for (const n of frameNodes) {
        n.vx -= n.x * 0.001; n.vy -= n.y * 0.001;
        n.vx *= 0.92; n.vy *= 0.92;
        n.x += n.vx; n.y += n.vy;
      }

      // Render
      const w = canvas.width / window.devicePixelRatio;
      const h = canvas.height / window.devicePixelRatio;
      ctx.save();
      ctx.setTransform(window.devicePixelRatio, 0, 0, window.devicePixelRatio, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.translate(w / 2 + panRef.current.x, h / 2 + panRef.current.y);
      ctx.scale(zoomRef.current, zoomRef.current);

      ctx.strokeStyle = "rgba(255,255,255,0.07)";
      ctx.lineWidth = 0.5;
      for (const e of edges) {
        const s = frameNodes.find((n) => n.id === e.source_id);
        const t = frameNodes.find((n) => n.id === e.target_id);
        if (!s || !t) continue;
        ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(t.x, t.y); ctx.stroke();
      }

      for (const n of frameNodes) {
        const r = 3 + n.importance * 6;
        const c = TYPE_COLORS[n.node_type] || "#818cf8";
        const sel = selectedNode?.id === n.id;
        const match = search && n.concept.toLowerCase().includes(search.toLowerCase());
        ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
        ctx.fillStyle = match ? "#fff" : sel ? c : `${c}88`;
        ctx.fill();
        if (sel || match) { ctx.strokeStyle = c; ctx.lineWidth = 1.5; ctx.stroke(); }
        if (n.importance > 0.6 || sel || match) {
          ctx.fillStyle = "rgba(255,255,255,0.6)";
          ctx.font = `${sel ? 11 : 9}px Inter, sans-serif`;
          ctx.textAlign = "center";
          ctx.fillText(n.concept.substring(0, 20), n.x, n.y + r + 12);
        }
      }
      ctx.restore();
      animRef.current = requestAnimationFrame(tick);
    };
    animRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animRef.current);
  }, [nodes, edges, selectedNode, search]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      const p = canvas.parentElement;
      if (!p) return;
      canvas.width = p.clientWidth * window.devicePixelRatio;
      canvas.height = p.clientHeight * window.devicePixelRatio;
      canvas.style.width = `${p.clientWidth}px`;
      canvas.style.height = `${p.clientHeight}px`;
    };
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  const handleClick = useCallback((e: React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const z = zoomRef.current, p = panRef.current;
    const mx = (e.clientX - rect.left - rect.width / 2 - p.x) / z;
    const my = (e.clientY - rect.top - rect.height / 2 - p.y) / z;
    setSelectedNode(nodes.find((n) => Math.abs(n.x - mx) < 10 && Math.abs(n.y - my) < 10) || null);
  }, [nodes]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    zoomRef.current = Math.max(0.2, Math.min(5, zoomRef.current - e.deltaY * 0.001));
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    isPanningRef.current = true;
    lastMouseRef.current = { x: e.clientX, y: e.clientY };
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isPanningRef.current) return;
    panRef.current.x += e.clientX - lastMouseRef.current.x;
    panRef.current.y += e.clientY - lastMouseRef.current.y;
    lastMouseRef.current = { x: e.clientX, y: e.clientY };
  }, []);

  const handleMouseUp = useCallback(() => { isPanningRef.current = false; }, []);

  return (
    <div className="flex flex-col h-full bg-[#0a0a0f] text-white">
      <div className="flex items-center gap-3 px-5 py-3 border-b border-[rgba(255,255,255,0.08)]">
        <button onClick={onBack} className="text-[rgba(255,255,255,0.5)] hover:text-white text-sm">← Back</button>
        <h1 className="text-[15px] font-semibold">Knowledge Graph</h1>
        <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search..."
          className="ml-auto px-2 py-1 w-[160px] bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.08)] rounded text-[11px] text-white placeholder-[rgba(255,255,255,0.25)] focus:outline-none focus:border-[#818cf8]" />
        <span className="text-[10px] text-[rgba(255,255,255,0.25)]">{nodes.length} nodes</span>
      </div>
      <div className="flex items-center gap-3 px-5 py-1 border-b border-[rgba(255,255,255,0.04)]">
        {Object.entries(TYPE_COLORS).map(([t, c]) => (
          <div key={t} className="flex items-center gap-1">
            <span className="w-[6px] h-[6px] rounded-full" style={{ background: c }} />
            <span className="text-[9px] text-[rgba(255,255,255,0.3)] capitalize">{t}</span>
          </div>
        ))}
      </div>
      <div className="flex-1 relative">
        <canvas ref={canvasRef} onClick={handleClick} onWheel={handleWheel}
          onMouseDown={handleMouseDown} onMouseMove={handleMouseMove} onMouseUp={handleMouseUp} onMouseLeave={handleMouseUp}
          className="w-full h-full cursor-grab active:cursor-grabbing" />
        {selectedNode && (
          <div className="absolute bottom-4 left-4 max-w-[350px] bg-[rgba(15,15,20,0.95)] border border-[rgba(255,255,255,0.12)] rounded-lg p-3 backdrop-blur-xl">
            <div className="flex items-center gap-2 mb-1">
              <span className="w-[8px] h-[8px] rounded-full" style={{ background: TYPE_COLORS[selectedNode.node_type] || "#818cf8" }} />
              <span className="text-[13px] font-semibold">{selectedNode.concept}</span>
              <span className="text-[9px] text-[rgba(255,255,255,0.3)] capitalize">{selectedNode.node_type}</span>
            </div>
            <div className="text-[11px] text-[rgba(255,255,255,0.55)] leading-[1.5]">{selectedNode.description || "No description"}</div>
            <div className="text-[9px] text-[rgba(255,255,255,0.2)] mt-1">
              Importance: {(selectedNode.importance * 100).toFixed(0)}%
              · {edges.filter((e) => e.source_id === selectedNode.id || e.target_id === selectedNode.id).length} connections
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
