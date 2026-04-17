import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import {
  useCodebaseGraph,
  CodeEntity,
  CodeRelation,
} from "../hooks/useCodebaseGraph";

interface Props {
  onBack: () => void;
  onSendToChat: (context: string) => void;
}

type Tab = "overview" | "entities" | "graph";

// ── Helpers ───────────────────────────────────────────────────────

function formatNumber(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return n.toString();
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return Math.floor(diff / 60_000) + "m ago";
  if (diff < 86_400_000) return Math.floor(diff / 3_600_000) + "h ago";
  return Math.floor(diff / 86_400_000) + "d ago";
}

const ENTITY_TYPE_LABELS: Record<string, string> = {
  file: "File", function: "Function", class: "Class", interface: "Interface",
  type: "Type", variable: "Variable", import: "Import", export: "Export",
  module: "Module", component: "Component", hook: "Hook", route: "Route",
  api: "API", test: "Test",
};

const COMPLEXITY_COLORS: Record<string, string> = {
  low: "text-emerald-400",
  medium: "text-amber-400",
  high: "text-red-400",
};

// ── Stat Card ─────────────────────────────────────────────────────

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="bg-blade-surface rounded-lg p-3 border border-blade-border/30">
      <div className="text-2xs text-blade-muted uppercase tracking-wider">{label}</div>
      <div className="text-lg font-bold text-blade-text mt-0.5">{value}</div>
      {sub && <div className="text-2xs text-blade-muted mt-0.5">{sub}</div>}
    </div>
  );
}

// ── Language Bar ──────────────────────────────────────────────────

const LANG_COLORS: Record<string, string> = {
  typescript: "#3178c6",
  javascript: "#f7df1e",
  python: "#3776ab",
  rust: "#ce422b",
  go: "#00add8",
  java: "#b07219",
  css: "#563d7c",
  html: "#e34c26",
  json: "#292929",
  markdown: "#083fa1",
  yaml: "#cb171e",
  toml: "#9c4221",
  sql: "#e38c00",
  bash: "#4eaa25",
};

function LanguageBar({ languages }: { languages: Record<string, number> }) {
  const total = Object.values(languages).reduce((a, b) => a + b, 0);
  if (total === 0) return null;

  const sorted = Object.entries(languages).sort((a, b) => b[1] - a[1]);

  return (
    <div className="space-y-2">
      <div className="flex h-3 rounded-full overflow-hidden border border-blade-border/20">
        {sorted.map(([lang, count]) => (
          <div
            key={lang}
            style={{
              width: `${(count / total) * 100}%`,
              backgroundColor: LANG_COLORS[lang] || "#64748b",
            }}
            title={`${lang}: ${count} files (${((count / total) * 100).toFixed(1)}%)`}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {sorted.map(([lang, count]) => (
          <div key={lang} className="flex items-center gap-1.5 text-2xs">
            <span
              className="w-2 h-2 rounded-full inline-block"
              style={{ backgroundColor: LANG_COLORS[lang] || "#64748b" }}
            />
            <span className="text-blade-secondary">{lang}</span>
            <span className="text-blade-muted">{count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Entity Detail Panel ──────────────────────────────────────────

function EntityDetail({
  entity,
  graph,
  entityColors,
  onAskAI,
}: {
  entity: CodeEntity;
  graph: NonNullable<ReturnType<typeof useCodebaseGraph>["graph"]>;
  entityColors: Record<string, string>;
  onAskAI: (prompt: string) => void;
}) {
  const incomingRels = graph.relations.filter((r) => r.to === entity.id);
  const outgoingRels = graph.relations.filter((r) => r.from === entity.id);

  const resolveEntity = (id: string) => graph.entities.find((e) => e.id === id);

  return (
    <div className="bg-blade-surface rounded-lg border border-blade-border/30 p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <span
              className="px-1.5 py-0.5 rounded text-2xs font-mono font-bold"
              style={{ backgroundColor: entityColors[entity.type] + "20", color: entityColors[entity.type] }}
            >
              {entity.type}
            </span>
            <span className="text-sm font-semibold text-blade-text font-mono">{entity.name}</span>
          </div>
          <div className="text-2xs text-blade-muted mt-1 font-mono">
            {entity.filePath.replace(/\\/g, "/")} : {entity.startLine}-{entity.endLine}
          </div>
        </div>
        <span className={`text-2xs font-medium ${COMPLEXITY_COLORS[entity.complexity]}`}>
          {entity.complexity}
        </span>
      </div>

      {entity.signature && (
        <pre className="text-2xs text-blade-secondary bg-blade-base rounded p-2 overflow-x-auto font-mono whitespace-pre-wrap">
          {entity.signature}
        </pre>
      )}

      {entity.docstring && (
        <p className="text-2xs text-blade-muted italic">{entity.docstring}</p>
      )}

      {outgoingRels.length > 0 && (
        <div>
          <div className="text-2xs text-blade-muted font-semibold mb-1">Outgoing ({outgoingRels.length})</div>
          <div className="space-y-0.5">
            {outgoingRels.slice(0, 8).map((rel) => {
              const target = resolveEntity(rel.to);
              return target ? (
                <div key={rel.id} className="text-2xs text-blade-secondary font-mono flex items-center gap-1">
                  <span className="text-blade-muted">{rel.type}</span>
                  <span className="text-blade-accent">-&gt;</span>
                  <span>{target.name}</span>
                </div>
              ) : null;
            })}
            {outgoingRels.length > 8 && (
              <div className="text-2xs text-blade-muted">+{outgoingRels.length - 8} more</div>
            )}
          </div>
        </div>
      )}

      {incomingRels.length > 0 && (
        <div>
          <div className="text-2xs text-blade-muted font-semibold mb-1">Incoming ({incomingRels.length})</div>
          <div className="space-y-0.5">
            {incomingRels.slice(0, 8).map((rel) => {
              const source = resolveEntity(rel.from);
              return source ? (
                <div key={rel.id} className="text-2xs text-blade-secondary font-mono flex items-center gap-1">
                  <span>{source.name}</span>
                  <span className="text-blade-accent">-&gt;</span>
                  <span className="text-blade-muted">{rel.type}</span>
                </div>
              ) : null;
            })}
            {incomingRels.length > 8 && (
              <div className="text-2xs text-blade-muted">+{incomingRels.length - 8} more</div>
            )}
          </div>
        </div>
      )}

      <button
        onClick={() => onAskAI(`Explain the purpose and usage of \`${entity.name}\` (${entity.type}) in ${entity.filePath}`)}
        className="w-full text-2xs py-1.5 rounded bg-blade-accent/20 text-blade-accent hover:bg-blade-accent/30 transition-colors font-medium"
      >
        Ask AI about this
      </button>
    </div>
  );
}

// ── Mini Graph Visualization ─────────────────────────────────────

function MiniGraph({
  entities,
  relations,
  entityColors,
  selectedId,
  onSelect,
}: {
  entities: CodeEntity[];
  relations: CodeRelation[];
  entityColors: Record<string, string>;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [positions, setPositions] = useState<Map<string, { x: number; y: number }>>(new Map());

  // Simple force-directed layout (computed once)
  useEffect(() => {
    if (entities.length === 0) return;

    const pos = new Map<string, { x: number; y: number }>();
    const width = 600;
    const height = 400;

    // Initialize in a circle
    entities.forEach((e, i) => {
      const angle = (i / entities.length) * Math.PI * 2;
      const r = Math.min(width, height) * 0.35;
      pos.set(e.id, {
        x: width / 2 + Math.cos(angle) * r,
        y: height / 2 + Math.sin(angle) * r,
      });
    });

    // Simple force iterations
    const relSet = new Set(relations.map((r: { from: string; to: string }) => `${r.from}:${r.to}`)); void relSet;
    for (let iter = 0; iter < 50; iter++) {
      // Repulsion
      for (const a of entities) {
        for (const b of entities) {
          if (a.id >= b.id) continue;
          const pa = pos.get(a.id)!;
          const pb = pos.get(b.id)!;
          const dx = pa.x - pb.x;
          const dy = pa.y - pb.y;
          const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
          const force = 800 / (dist * dist);
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;
          pa.x += fx; pa.y += fy;
          pb.x -= fx; pb.y -= fy;
        }
      }

      // Attraction (edges)
      for (const rel of relations) {
        const pa = pos.get(rel.from);
        const pb = pos.get(rel.to);
        if (!pa || !pb) continue;
        const dx = pb.x - pa.x;
        const dy = pb.y - pa.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const force = (dist - 80) * 0.01;
        const fx = (dx / Math.max(dist, 1)) * force;
        const fy = (dy / Math.max(dist, 1)) * force;
        pa.x += fx; pa.y += fy;
        pb.x -= fx; pb.y -= fy;
      }

      // Center gravity
      for (const e of entities) {
        const p = pos.get(e.id)!;
        p.x += (width / 2 - p.x) * 0.01;
        p.y += (height / 2 - p.y) * 0.01;
        // Clamp
        p.x = Math.max(20, Math.min(width - 20, p.x));
        p.y = Math.max(20, Math.min(height - 20, p.y));
      }
    }

    setPositions(pos);
  }, [entities, relations]);

  // Render canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || positions.size === 0) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = 600 * dpr;
    canvas.height = 400 * dpr;
    ctx.scale(dpr, dpr);

    // Clear
    ctx.clearRect(0, 0, 600, 400);

    // Draw edges
    ctx.lineWidth = 0.5;
    for (const rel of relations) {
      const from = positions.get(rel.from);
      const to = positions.get(rel.to);
      if (!from || !to) continue;

      const isHighlighted = selectedId && (rel.from === selectedId || rel.to === selectedId);
      ctx.strokeStyle = isHighlighted ? "#60a5fa" : "rgba(100,116,139,0.15)";
      ctx.lineWidth = isHighlighted ? 1.5 : 0.5;
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
    }

    // Draw nodes
    for (const entity of entities) {
      const pos = positions.get(entity.id);
      if (!pos) continue;

      const isSelected = entity.id === selectedId;
      const isConnected = selectedId && relations.some(
        (r) => (r.from === selectedId && r.to === entity.id) || (r.to === selectedId && r.from === entity.id),
      );
      const color = entityColors[entity.type] || "#64748b";
      const radius = isSelected ? 7 : isConnected ? 5 : 4;
      const alpha = !selectedId || isSelected || isConnected ? 1 : 0.25;

      ctx.globalAlpha = alpha;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, radius, 0, Math.PI * 2);
      ctx.fill();

      if (isSelected) {
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      // Label for selected/connected
      if (isSelected || isConnected) {
        ctx.fillStyle = "#e2e8f0";
        ctx.font = "10px ui-monospace, monospace";
        ctx.textAlign = "center";
        ctx.fillText(entity.name, pos.x, pos.y - radius - 4);
      }

      ctx.globalAlpha = 1;
    }
  }, [entities, relations, positions, selectedId, entityColors]);

  const handleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    let closest: { id: string; dist: number } | null = null;
    for (const entity of entities) {
      const pos = positions.get(entity.id);
      if (!pos) continue;
      const dist = Math.sqrt((pos.x - x) ** 2 + (pos.y - y) ** 2);
      if (dist < 12 && (!closest || dist < closest.dist)) {
        closest = { id: entity.id, dist };
      }
    }

    if (closest) onSelect(closest.id);
  }, [entities, positions, onSelect]);

  return (
    <canvas
      ref={canvasRef}
      width={600}
      height={400}
      onClick={handleClick}
      className="w-full h-[400px] rounded-lg bg-blade-base border border-blade-border/20 cursor-crosshair"
      style={{ imageRendering: "auto" }}
    />
  );
}

// ── Main Component ───────────────────────────────────────────────

export default function CodebaseExplorer({ onBack, onSendToChat }: Props) {
  const {
    graph, indexing, progress, indexCodebase, queryGraph,
    /* getFileEntities, getDependencyTree, getCallGraph, getComponentTree, */
    stats, clear, entityColors, entityIcons,
  } = useCodebaseGraph();

  const [tab, setTab] = useState<Tab>("overview");
  const [rootPath, setRootPath] = useState("");
  const [search, setSearch] = useState("");
  const [entityFilter, setEntityFilter] = useState<string>("all");
  const [langFilter, setLangFilter] = useState<string>("all");
  const [selectedEntity, setSelectedEntity] = useState<CodeEntity | null>(null);
  const [graphSelectedId, setGraphSelectedId] = useState<string | null>(null);
  const [queryInput, setQueryInput] = useState("");
  const [queryResult, setQueryResult] = useState<ReturnType<typeof queryGraph>>(null);
  const queryInputRef = useRef<HTMLInputElement>(null);

  // Filter entities for the entities tab
  const filteredEntities = useMemo(() => {
    if (!graph) return [];
    let list = graph.entities.filter((e) => e.type !== "import");

    if (entityFilter !== "all") {
      list = list.filter((e) => e.type === entityFilter);
    }
    if (langFilter !== "all") {
      list = list.filter((e) => e.language === langFilter);
    }
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((e) =>
        e.name.toLowerCase().includes(q) ||
        e.filePath.toLowerCase().includes(q) ||
        e.signature?.toLowerCase().includes(q),
      );
    }
    return list.slice(0, 200);
  }, [graph, entityFilter, langFilter, search]);

  // Graph tab: limit nodes for performance
  const graphEntities = useMemo(() => {
    if (!graph) return [];
    return graph.entities
      .filter((e) => e.type !== "import" && e.type !== "file")
      .slice(0, 150);
  }, [graph]);

  const graphRelations = useMemo(() => {
    if (!graph) return [];
    const ids = new Set(graphEntities.map((e) => e.id));
    return graph.relations.filter((r) => ids.has(r.from) && ids.has(r.to));
  }, [graph, graphEntities]);

  const handleQuery = useCallback(() => {
    if (!queryInput.trim()) return;
    const result = queryGraph(queryInput.trim());
    setQueryResult(result);
  }, [queryInput, queryGraph]);

  const handleSendQueryToChat = useCallback(() => {
    if (!queryResult) return;
    const header = `[Codebase Query: "${queryResult.query}"]\n[${queryResult.relevantEntities.length} entities, ~${formatNumber(queryResult.tokenEstimate)} tokens]\n\n`;
    onSendToChat(header + queryResult.context);
  }, [queryResult, onSendToChat]);

  const handleAskAI = useCallback((prompt: string) => {
    const result = queryGraph(prompt);
    const context = result ? `\n\n${result.context}` : "";
    onSendToChat(prompt + context);
  }, [queryGraph, onSendToChat]);

  // ── Render ────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full bg-blade-base text-blade-text">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-blade-border/20">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="text-blade-muted hover:text-blade-text transition-colors text-sm"
          >
            &larr;
          </button>
          <div>
            <h2 className="text-sm font-semibold">Codebase Explorer</h2>
            <p className="text-2xs text-blade-muted">
              {graph
                ? `${formatNumber(stats?.totalEntities || 0)} entities indexed ${timeAgo(stats?.indexedAt || 0)}`
                : "Index a codebase to explore its structure"}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {graph && (
            <button
              onClick={clear}
              className="text-2xs text-blade-muted hover:text-red-400 transition-colors px-2 py-1"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Index Controls */}
      {!graph && !indexing && (
        <div className="px-4 py-6 space-y-3 border-b border-blade-border/20">
          <div className="text-xs text-blade-secondary">
            Turn any folder of code into a queryable knowledge graph. Uses 71.5x fewer tokens per query vs reading raw files.
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={rootPath}
              onChange={(e) => setRootPath(e.target.value)}
              placeholder="Path to codebase (e.g. C:\Users\arnav\Documents\blade)"
              className="flex-1 bg-blade-surface text-blade-text text-xs rounded-lg px-3 py-2 border border-blade-border/30 focus:border-blade-accent/50 focus:outline-none font-mono placeholder:text-blade-muted/50"
            />
            <button
              onClick={() => rootPath.trim() && indexCodebase(rootPath.trim())}
              disabled={!rootPath.trim()}
              className="px-4 py-2 bg-blade-accent text-white text-xs rounded-lg font-medium hover:bg-blade-accent/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
            >
              Index Codebase
            </button>
          </div>
        </div>
      )}

      {/* Progress Bar */}
      {indexing && (
        <div className="px-4 py-3 border-b border-blade-border/20 space-y-2">
          <div className="flex items-center justify-between text-2xs">
            <span className="text-blade-muted">
              {progress.phase === "scanning" && "Scanning files..."}
              {progress.phase === "parsing" && `Parsing: ${progress.currentFile}`}
              {progress.phase === "relations" && "Building relations..."}
            </span>
            <span className="text-blade-secondary font-mono">
              {progress.current}/{progress.total}
            </span>
          </div>
          <div className="h-1.5 bg-blade-surface rounded-full overflow-hidden">
            <div
              className="h-full bg-blade-accent rounded-full transition-all duration-300"
              style={{ width: progress.total > 0 ? `${(progress.current / progress.total) * 100}%` : "0%" }}
            />
          </div>
        </div>
      )}

      {/* Query Bar */}
      {graph && (
        <div className="px-4 py-2 border-b border-blade-border/20">
          <div className="flex gap-2">
            <input
              ref={queryInputRef}
              type="text"
              value={queryInput}
              onChange={(e) => setQueryInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleQuery()}
              placeholder="Query codebase: 'auth middleware', 'React hooks', 'API routes'..."
              className="flex-1 bg-blade-surface text-blade-text text-xs rounded-lg px-3 py-1.5 border border-blade-border/30 focus:border-blade-accent/50 focus:outline-none font-mono placeholder:text-blade-muted/50"
            />
            <button
              onClick={handleQuery}
              className="px-3 py-1.5 bg-blade-accent/20 text-blade-accent text-xs rounded-lg font-medium hover:bg-blade-accent/30 transition-colors"
            >
              Query
            </button>
          </div>

          {queryResult && (
            <div className="mt-2 bg-blade-surface rounded-lg border border-blade-border/30 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-2xs text-blade-secondary">
                  Found {queryResult.relevantEntities.length} entities (~{formatNumber(queryResult.tokenEstimate)} tokens)
                </span>
                <span className="text-2xs text-emerald-400">
                  {stats && (
                    <>vs ~{formatNumber(stats.rawTokenEstimate)} tokens reading all files ({stats.tokenSavingsRatio.toFixed(1)}x savings)</>
                  )}
                </span>
              </div>
              <div className="flex flex-wrap gap-1">
                {queryResult.relevantEntities.slice(0, 12).map((e) => (
                  <span
                    key={e.id}
                    className="text-2xs font-mono px-1.5 py-0.5 rounded"
                    style={{ backgroundColor: entityColors[e.type] + "15", color: entityColors[e.type] }}
                  >
                    {e.name}
                  </span>
                ))}
                {queryResult.relevantEntities.length > 12 && (
                  <span className="text-2xs text-blade-muted">+{queryResult.relevantEntities.length - 12} more</span>
                )}
              </div>
              <button
                onClick={handleSendQueryToChat}
                className="w-full text-2xs py-1.5 rounded bg-blade-accent/20 text-blade-accent hover:bg-blade-accent/30 transition-colors font-medium"
              >
                Send to Chat
              </button>
            </div>
          )}
        </div>
      )}

      {/* Tabs */}
      {graph && (
        <div className="flex border-b border-blade-border/20">
          {(["overview", "entities", "graph"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 text-xs py-2 font-medium transition-colors border-b-2 ${
                tab === t
                  ? "text-blade-accent border-blade-accent"
                  : "text-blade-muted border-transparent hover:text-blade-secondary"
              }`}
            >
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
      )}

      {/* Tab Content */}
      <div className="flex-1 overflow-y-auto">
        {/* ── Overview Tab ──────────────────────────────────────── */}
        {graph && tab === "overview" && stats && (
          <div className="p-4 space-y-4">
            {/* Stats Grid */}
            <div className="grid grid-cols-3 gap-2">
              <StatCard label="Files" value={formatNumber(stats.totalFiles)} />
              <StatCard label="Entities" value={formatNumber(stats.codeEntities)} />
              <StatCard label="Relations" value={formatNumber(stats.totalRelations)} />
              <StatCard label="Lines" value={formatNumber(stats.totalLines)} />
              <StatCard
                label="Token Savings"
                value={`${stats.tokenSavingsRatio.toFixed(1)}x`}
                sub={`${formatNumber(stats.graphTokenEstimate)} vs ${formatNumber(stats.rawTokenEstimate)}`}
              />
              <StatCard
                label="Index Time"
                value={`${(stats.indexDurationMs / 1000).toFixed(1)}s`}
                sub={timeAgo(stats.indexedAt)}
              />
            </div>

            {/* Language Distribution */}
            <div>
              <h3 className="text-xs font-semibold text-blade-secondary mb-2">Languages</h3>
              <LanguageBar languages={stats.languages} />
            </div>

            {/* Entity Breakdown */}
            <div>
              <h3 className="text-xs font-semibold text-blade-secondary mb-2">Entity Breakdown</h3>
              <div className="grid grid-cols-4 gap-1.5">
                {Object.entries(stats.entityCounts)
                  .filter(([type]) => type !== "import")
                  .sort((a, b) => b[1] - a[1])
                  .map(([type, count]) => (
                    <div
                      key={type}
                      className="bg-blade-surface rounded px-2 py-1.5 border border-blade-border/20 flex items-center justify-between"
                    >
                      <span className="text-2xs" style={{ color: (entityColors as Record<string, string>)[type] || "#64748b" }}>
                        {ENTITY_TYPE_LABELS[type] || type}
                      </span>
                      <span className="text-2xs text-blade-muted font-mono">{count}</span>
                    </div>
                  ))}
              </div>
            </div>

            {/* Most Connected */}
            <div>
              <h3 className="text-xs font-semibold text-blade-secondary mb-2">Most Connected Entities</h3>
              <div className="space-y-1">
                {stats.mostConnected.slice(0, 10).map(({ entity, connections }) => (
                  <button
                    key={entity.id}
                    onClick={() => { setSelectedEntity(entity); setTab("entities"); }}
                    className="w-full flex items-center justify-between px-2 py-1.5 rounded bg-blade-surface hover:bg-blade-surface-hover transition-colors border border-blade-border/20 group"
                  >
                    <div className="flex items-center gap-2 overflow-hidden">
                      <span
                        className="text-2xs font-mono px-1 rounded flex-shrink-0"
                        style={{ backgroundColor: entityColors[entity.type] + "20", color: entityColors[entity.type] }}
                      >
                        {entity.type}
                      </span>
                      <span className="text-xs text-blade-text font-mono truncate">{entity.name}</span>
                    </div>
                    <span className="text-2xs text-blade-muted font-mono flex-shrink-0">{connections} rels</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Re-index */}
            <button
              onClick={() => graph.metadata.rootPath && indexCodebase(graph.metadata.rootPath)}
              disabled={indexing}
              className="w-full text-2xs py-2 rounded border border-blade-border/30 text-blade-muted hover:text-blade-secondary hover:border-blade-border/50 transition-colors disabled:opacity-40"
            >
              Re-index ({graph.metadata.rootPath.replace(/\\/g, "/").split("/").pop()})
            </button>
          </div>
        )}

        {/* ── Entities Tab ──────────────────────────────────────── */}
        {graph && tab === "entities" && (
          <div className="flex flex-col h-full">
            {/* Filters */}
            <div className="p-3 border-b border-blade-border/20 space-y-2">
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search entities..."
                className="w-full bg-blade-surface text-blade-text text-xs rounded-lg px-3 py-1.5 border border-blade-border/30 focus:border-blade-accent/50 focus:outline-none font-mono placeholder:text-blade-muted/50"
              />
              <div className="flex gap-2">
                <select
                  value={entityFilter}
                  onChange={(e) => setEntityFilter(e.target.value)}
                  className="bg-blade-surface text-blade-secondary text-2xs rounded px-2 py-1 border border-blade-border/30 focus:outline-none"
                >
                  <option value="all">All types</option>
                  {Object.keys(ENTITY_TYPE_LABELS)
                    .filter((t) => t !== "import")
                    .map((t) => (
                      <option key={t} value={t}>{ENTITY_TYPE_LABELS[t]}</option>
                    ))}
                </select>
                <select
                  value={langFilter}
                  onChange={(e) => setLangFilter(e.target.value)}
                  className="bg-blade-surface text-blade-secondary text-2xs rounded px-2 py-1 border border-blade-border/30 focus:outline-none"
                >
                  <option value="all">All languages</option>
                  {Object.keys(stats?.languages || {}).map((lang) => (
                    <option key={lang} value={lang}>{lang}</option>
                  ))}
                </select>
                <span className="text-2xs text-blade-muted self-center ml-auto">
                  {filteredEntities.length} results
                </span>
              </div>
            </div>

            {/* Entity List + Detail Split */}
            <div className="flex-1 flex overflow-hidden">
              {/* List */}
              <div className="w-1/2 overflow-y-auto border-r border-blade-border/20">
                {filteredEntities.map((entity) => (
                  <button
                    key={entity.id}
                    onClick={() => setSelectedEntity(entity)}
                    className={`w-full text-left px-3 py-2 border-b border-blade-border/10 transition-colors ${
                      selectedEntity?.id === entity.id
                        ? "bg-blade-accent/10"
                        : "hover:bg-blade-surface-hover"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className="text-2xs font-mono px-1 rounded flex-shrink-0"
                        style={{ backgroundColor: entityColors[entity.type] + "20", color: entityColors[entity.type] }}
                      >
                        {entityIcons[entity.type]}
                      </span>
                      <span className="text-xs text-blade-text font-mono truncate">{entity.name}</span>
                      <span className={`text-2xs ml-auto flex-shrink-0 ${COMPLEXITY_COLORS[entity.complexity]}`}>
                        {entity.complexity === "high" ? "!!!" : entity.complexity === "medium" ? "!!" : ""}
                      </span>
                    </div>
                    <div className="text-2xs text-blade-muted font-mono mt-0.5 truncate">
                      {entity.filePath.replace(/\\/g, "/").split("/").pop()} : {entity.startLine}
                    </div>
                  </button>
                ))}
                {filteredEntities.length === 0 && (
                  <div className="p-4 text-center text-2xs text-blade-muted">No entities match your filters</div>
                )}
              </div>

              {/* Detail */}
              <div className="w-1/2 overflow-y-auto p-3">
                {selectedEntity ? (
                  <EntityDetail
                    entity={selectedEntity}
                    graph={graph}
                    entityColors={entityColors}
                    onAskAI={handleAskAI}
                  />
                ) : (
                  <div className="h-full flex items-center justify-center text-2xs text-blade-muted">
                    Select an entity to view details
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── Graph Tab ─────────────────────────────────────────── */}
        {graph && tab === "graph" && (
          <div className="p-4 space-y-3">
            {/* Graph search */}
            <div className="flex gap-2">
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Find entity in graph..."
                className="flex-1 bg-blade-surface text-blade-text text-xs rounded-lg px-3 py-1.5 border border-blade-border/30 focus:border-blade-accent/50 focus:outline-none font-mono placeholder:text-blade-muted/50"
              />
              {graphSelectedId && (
                <button
                  onClick={() => setGraphSelectedId(null)}
                  className="text-2xs text-blade-muted hover:text-blade-secondary px-2"
                >
                  Deselect
                </button>
              )}
            </div>

            {/* Search results */}
            {search && (
              <div className="flex flex-wrap gap-1 max-h-20 overflow-y-auto">
                {graphEntities
                  .filter((e) => e.name.toLowerCase().includes(search.toLowerCase()))
                  .slice(0, 20)
                  .map((e) => (
                    <button
                      key={e.id}
                      onClick={() => { setGraphSelectedId(e.id); setSearch(""); }}
                      className="text-2xs font-mono px-1.5 py-0.5 rounded hover:opacity-80 transition-opacity"
                      style={{ backgroundColor: entityColors[e.type] + "20", color: entityColors[e.type] }}
                    >
                      {e.name}
                    </button>
                  ))}
              </div>
            )}

            {/* Legend */}
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              {Object.entries(ENTITY_TYPE_LABELS)
                .filter(([type]) => type !== "import" && type !== "file")
                .map(([type, label]) => (
                  <div key={type} className="flex items-center gap-1 text-2xs">
                    <span
                      className="w-2 h-2 rounded-full inline-block"
                      style={{ backgroundColor: (entityColors as Record<string, string>)[type] }}
                    />
                    <span className="text-blade-muted">{label}</span>
                  </div>
                ))}
            </div>

            {/* Canvas */}
            <MiniGraph
              entities={graphEntities}
              relations={graphRelations}
              entityColors={entityColors}
              selectedId={graphSelectedId}
              onSelect={setGraphSelectedId}
            />

            {/* Selected entity info */}
            {graphSelectedId && (() => {
              const entity = graph.entities.find((e) => e.id === graphSelectedId);
              if (!entity) return null;

              const connected = graph.relations
                .filter((r) => r.from === graphSelectedId || r.to === graphSelectedId)
                .map((r) => {
                  const otherId = r.from === graphSelectedId ? r.to : r.from;
                  const other = graph.entities.find((e) => e.id === otherId);
                  return { rel: r, other };
                })
                .filter((x) => x.other);

              return (
                <div className="bg-blade-surface rounded-lg border border-blade-border/30 p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <span
                      className="text-2xs font-mono px-1.5 py-0.5 rounded font-bold"
                      style={{ backgroundColor: entityColors[entity.type] + "20", color: entityColors[entity.type] }}
                    >
                      {entity.type}
                    </span>
                    <span className="text-sm font-semibold font-mono text-blade-text">{entity.name}</span>
                  </div>
                  {entity.signature && (
                    <pre className="text-2xs text-blade-secondary font-mono bg-blade-base rounded p-2 overflow-x-auto whitespace-pre-wrap">
                      {entity.signature}
                    </pre>
                  )}
                  <div className="text-2xs text-blade-muted">
                    {connected.length} connection{connected.length !== 1 ? "s" : ""}:
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {connected.slice(0, 15).map(({ rel, other }) => (
                      <button
                        key={rel.id}
                        onClick={() => setGraphSelectedId(other!.id)}
                        className="text-2xs font-mono px-1.5 py-0.5 rounded hover:opacity-80 transition-opacity"
                        style={{ backgroundColor: entityColors[other!.type] + "15", color: entityColors[other!.type] }}
                        title={`${rel.type} ${other!.name}`}
                      >
                        {rel.type} {other!.name}
                      </button>
                    ))}
                  </div>
                  <button
                    onClick={() => handleAskAI(
                      `Explain how \`${entity.name}\` relates to its ${connected.length} connections in the codebase`,
                    )}
                    className="w-full text-2xs py-1.5 rounded bg-blade-accent/20 text-blade-accent hover:bg-blade-accent/30 transition-colors font-medium"
                  >
                    Ask AI about relationships
                  </button>
                </div>
              );
            })()}

            {graphEntities.length === 0 && (
              <div className="text-center text-2xs text-blade-muted py-8">
                No graphable entities found. Try indexing a codebase with TypeScript, Python, or Rust files.
              </div>
            )}
          </div>
        )}

        {/* Empty state */}
        {!graph && !indexing && (
          <div className="flex items-center justify-center h-64 text-blade-muted text-xs">
            Enter a path above to index a codebase
          </div>
        )}
      </div>
    </div>
  );
}
