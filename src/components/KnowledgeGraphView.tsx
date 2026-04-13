// src/components/KnowledgeGraphView.tsx
// Visual knowledge graph explorer — radial CSS layout, no D3 dependency.

import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

// ── Types ─────────────────────────────────────────────────────────────────────

interface GraphNode {
  id: string;
  concept: string;
  node_type: string;
  description?: string;
  importance: number; // 0.0–1.0
  sources?: string[];
}

interface GraphEdge {
  from: string;
  to: string;
  relation: string;
}

interface SubGraph {
  root: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

interface GraphStats {
  node_count: number;
  edge_count: number;
  most_connected: string[];
}

// ── Node type colours ─────────────────────────────────────────────────────────

const NODE_TYPE_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  concept:    { bg: "bg-green-900",  text: "text-green-300",  border: "border-green-600" },
  person:     { bg: "bg-blue-900",   text: "text-blue-300",   border: "border-blue-600" },
  technology: { bg: "bg-purple-900", text: "text-purple-300", border: "border-purple-600" },
  event:      { bg: "bg-amber-900",  text: "text-amber-300",  border: "border-amber-600" },
  place:      { bg: "bg-teal-900",   text: "text-teal-300",   border: "border-teal-600" },
  fact:       { bg: "bg-gray-800",   text: "text-gray-300",   border: "border-gray-600" },
};

function nodeColors(type: string) {
  return NODE_TYPE_COLORS[type.toLowerCase()] ?? NODE_TYPE_COLORS.fact;
}

// ── Radial graph display ──────────────────────────────────────────────────────
// Nodes arranged in concentric rings by hop distance from root (ring 0 = root).

function RadialGraph({
  subgraph,
  onNodeClick,
  selectedId,
}: {
  subgraph: SubGraph;
  onNodeClick: (node: GraphNode) => void;
  selectedId: string | null;
}) {
  const { root, nodes, edges } = subgraph;

  // BFS to determine hop distance from root
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    if (!adj.has(e.from)) adj.set(e.from, []);
    if (!adj.has(e.to)) adj.set(e.to, []);
    adj.get(e.from)!.push(e.to);
    adj.get(e.to)!.push(e.from);
  }

  const hop = new Map<string, number>();
  const queue: string[] = [root];
  hop.set(root, 0);
  while (queue.length) {
    const cur = queue.shift()!;
    for (const nb of adj.get(cur) ?? []) {
      if (!hop.has(nb)) {
        hop.set(nb, hop.get(cur)! + 1);
        queue.push(nb);
      }
    }
  }

  // Group nodes by ring
  const rings = new Map<number, GraphNode[]>();
  for (const n of nodes) {
    const d = hop.get(n.id) ?? 2;
    if (!rings.has(d)) rings.set(d, []);
    rings.get(d)!.push(n);
  }

  const maxRing = Math.max(...Array.from(rings.keys()));

  // Build edge relation labels
  const edgeLabels: { key: string; from: string; to: string; relation: string }[] = edges.map((e, i) => ({
    key: `${i}`,
    from: e.from,
    to: e.to,
    relation: e.relation,
  }));

  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  return (
    <div className="relative w-full" style={{ minHeight: 420 }}>
      {/* Edge relations as floating labels (simplified: listed below graph) */}
      <div className="flex flex-col items-center gap-6">
        {Array.from({ length: maxRing + 1 }, (_, ring) => {
          const ringNodes = rings.get(ring) ?? [];
          return (
            <div key={ring} className="flex flex-wrap justify-center gap-3">
              {ringNodes.map((n) => {
                const c = nodeColors(n.node_type);
                const isRoot = n.id === root;
                const isSelected = n.id === selectedId;
                return (
                  <button
                    key={n.id}
                    onClick={() => onNodeClick(n)}
                    className={`
                      font-mono rounded-lg border px-3 py-2 text-left transition-all
                      ${c.bg} ${c.text} ${c.border}
                      ${isRoot ? "text-base font-bold ring-2 ring-green-400 px-5 py-3" : "text-xs"}
                      ${isSelected ? "ring-2 ring-white" : ""}
                      hover:brightness-125 cursor-pointer
                    `}
                    title={n.description ?? n.concept}
                  >
                    <div>{n.concept}</div>
                    {isRoot && (
                      <div className="text-xs opacity-60 font-normal mt-0.5">{n.node_type}</div>
                    )}
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>

      {/* Edge labels panel */}
      {edgeLabels.length > 0 && (
        <div className="mt-4 border-t border-gray-800 pt-3">
          <p className="text-gray-600 text-2xs font-mono mb-2">Relations</p>
          <div className="flex flex-wrap gap-2">
            {edgeLabels.map((el) => {
              const fromNode = nodeMap.get(el.from);
              const toNode = nodeMap.get(el.to);
              if (!fromNode || !toNode) return null;
              return (
                <span
                  key={el.key}
                  className="text-2xs font-mono text-gray-500 border border-gray-800 rounded px-2 py-0.5"
                >
                  {fromNode.concept}{" "}
                  <span className="text-blue-500">{el.relation}</span>{" "}
                  {toNode.concept}
                </span>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Node detail panel ─────────────────────────────────────────────────────────

function NodeDetailPanel({
  node,
  onExplore,
}: {
  node: GraphNode;
  onExplore: (concept: string) => void;
}) {
  const c = nodeColors(node.node_type);
  return (
    <div className="border border-gray-700 rounded-lg p-4 bg-gray-900 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-gray-100 font-mono text-sm font-semibold">{node.concept}</h3>
        <span className={`text-2xs font-mono px-2 py-0.5 rounded border ${c.bg} ${c.text} ${c.border}`}>
          {node.node_type}
        </span>
      </div>

      {node.description && (
        <p className="text-gray-400 text-xs font-mono leading-relaxed">{node.description}</p>
      )}

      {/* Importance bar */}
      <div>
        <div className="flex justify-between text-2xs text-gray-600 font-mono mb-0.5">
          <span>Importance</span>
          <span>{Math.round(node.importance * 100)}%</span>
        </div>
        <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
          <div
            className="h-full bg-green-500 rounded-full"
            style={{ width: `${node.importance * 100}%` }}
          />
        </div>
      </div>

      {/* Sources */}
      {node.sources && node.sources.length > 0 && (
        <div>
          <p className="text-gray-600 text-2xs font-mono mb-1.5">Sources</p>
          <div className="flex flex-wrap gap-1.5">
            {node.sources.map((src, i) => (
              <span
                key={i}
                className="text-2xs font-mono text-blue-400 border border-blue-900 rounded px-2 py-0.5 cursor-pointer hover:bg-blue-900/20"
                title={src}
              >
                {src.length > 30 ? src.slice(0, 27) + "..." : src}
              </span>
            ))}
          </div>
        </div>
      )}

      <button
        onClick={() => onExplore(node.concept)}
        className="w-full text-xs text-green-400 border border-green-700 rounded py-1.5 hover:bg-green-900/30 font-mono"
      >
        Explore from here →
      </button>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function KnowledgeGraphView({ onBack }: { onBack: () => void }) {
  const [tab, setTab] = useState<"graph" | "find-path" | "extract" | "ask">("graph");

  // Search
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<GraphNode[]>([]);
  const [searching, setSearching] = useState(false);

  // Graph
  const [subgraph, setSubgraph] = useState<SubGraph | null>(null);
  const [traversing, setTraversing] = useState(false);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);

  // Stats
  const [stats, setStats] = useState<GraphStats | null>(null);

  // Find path
  const [pathFrom, setPathFrom] = useState("");
  const [pathTo, setPathTo] = useState("");
  const [pathResult, setPathResult] = useState<string[]>([]);
  const [findingPath, setFindingPath] = useState(false);

  // Extract
  const [extractText, setExtractText] = useState("");
  const [extractedNodes, setExtractedNodes] = useState<GraphNode[]>([]);
  const [extracting, setExtracting] = useState(false);

  // Ask
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    invoke<GraphStats>("graph_get_stats")
      .then(setStats)
      .catch(console.error);
  }, []);

  const search = useCallback(async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    try {
      const results = await invoke<GraphNode[]>("graph_search_nodes", { query: searchQuery });
      setSearchResults(results);
    } catch (e) {
      console.error(e);
    } finally {
      setSearching(false);
    }
  }, [searchQuery]);

  const explore = useCallback(async (concept: string) => {
    setTraversing(true);
    setSubgraph(null);
    setSelectedNode(null);
    try {
      const sg = await invoke<SubGraph>("graph_traverse", { concept, depth: 2 });
      setSubgraph(sg);
    } catch (e) {
      console.error(e);
    } finally {
      setTraversing(false);
    }
  }, []);

  async function findPath() {
    if (!pathFrom.trim() || !pathTo.trim()) return;
    setFindingPath(true);
    setPathResult([]);
    try {
      const path = await invoke<string[]>("graph_find_path", { fromConcept: pathFrom, toConcept: pathTo });
      setPathResult(path);
    } catch (e) {
      console.error(e);
    } finally {
      setFindingPath(false);
    }
  }

  async function extractFromText() {
    if (!extractText.trim()) return;
    setExtracting(true);
    setExtractedNodes([]);
    try {
      const nodes = await invoke<GraphNode[]>("graph_extract_from_text", { text: extractText });
      setExtractedNodes(nodes);
    } catch (e) {
      console.error(e);
    } finally {
      setExtracting(false);
    }
  }

  async function askGraph() {
    if (!question.trim()) return;
    setAsking(true);
    setAnswer("");
    try {
      const ans = await invoke<string>("graph_answer", { question });
      setAnswer(ans);
    } catch (e) {
      console.error(e);
    } finally {
      setAsking(false);
    }
  }

  const tabs = [
    { id: "graph" as const, label: "Explore" },
    { id: "find-path" as const, label: "Find Path" },
    { id: "extract" as const, label: "Extract" },
    { id: "ask" as const, label: "Ask Graph" },
  ];

  return (
    <div className="flex flex-col h-screen bg-black text-gray-200 font-mono">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="text-gray-500 hover:text-gray-300 text-xs border border-gray-800 rounded px-2 py-1"
          >
            ← Back
          </button>
          <span className="text-green-400 text-sm">🕸 Knowledge Graph</span>
        </div>

        {/* Stats bar */}
        {stats && (
          <div className="flex gap-4 text-2xs text-gray-500">
            <span>{stats.node_count.toLocaleString()} nodes</span>
            <span>{stats.edge_count.toLocaleString()} edges</span>
            {stats.most_connected.slice(0, 2).map((c) => (
              <span key={c} className="text-green-600">⭐ {c}</span>
            ))}
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-800 px-4">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-xs font-mono border-b-2 -mb-px transition-colors ${
              tab === t.id
                ? "border-green-500 text-green-400"
                : "border-transparent text-gray-500 hover:text-gray-300"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden flex">
        {/* Main area */}
        <div className="flex-1 overflow-y-auto p-4">

          {/* ── EXPLORE TAB ── */}
          {tab === "graph" && (
            <div className="space-y-4">
              {/* Search bar */}
              <div className="flex gap-2">
                <input
                  className="flex-1 bg-gray-900 border border-gray-700 rounded px-3 py-2 text-xs font-mono focus:outline-none focus:border-green-500"
                  placeholder="Search concepts..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && search()}
                />
                <button
                  onClick={search}
                  disabled={searching}
                  className="px-3 py-2 text-xs border border-gray-700 rounded hover:border-green-600 hover:text-green-400 disabled:opacity-40"
                >
                  {searching ? "..." : "Search"}
                </button>
              </div>

              {/* Search results */}
              {searchResults.length > 0 && (
                <div className="space-y-1">
                  <p className="text-gray-600 text-2xs uppercase tracking-wider">Results</p>
                  {searchResults.map((n) => {
                    const c = nodeColors(n.node_type);
                    return (
                      <div key={n.id} className="flex items-center justify-between border border-gray-800 rounded p-2 hover:border-gray-600">
                        <div className="flex items-center gap-2">
                          <span className={`text-2xs font-mono px-1.5 py-0.5 rounded ${c.bg} ${c.text}`}>{n.node_type}</span>
                          <span className="text-gray-200 text-xs">{n.concept}</span>
                          {n.description && (
                            <span className="text-gray-600 text-2xs truncate max-w-xs">{n.description}</span>
                          )}
                        </div>
                        <button
                          onClick={() => { setSelectedNode(n); explore(n.concept); }}
                          className="text-2xs text-green-400 border border-green-800 rounded px-2 py-0.5 hover:bg-green-900/30"
                        >
                          Explore
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Graph visualization */}
              {traversing && (
                <div className="flex items-center justify-center py-12">
                  <div className="text-green-400 text-xs font-mono animate-pulse">Traversing graph...</div>
                </div>
              )}

              {subgraph && !traversing && (
                <div className="border border-gray-800 rounded-lg p-4 bg-gray-950">
                  <p className="text-gray-600 text-2xs font-mono mb-4 uppercase tracking-wider">
                    Graph — root: <span className="text-green-400">{subgraph.root}</span> · {subgraph.nodes.length} nodes · {subgraph.edges.length} edges
                  </p>
                  <RadialGraph
                    subgraph={subgraph}
                    onNodeClick={(n) => { setSelectedNode(n); }}
                    selectedId={selectedNode?.id ?? null}
                  />
                </div>
              )}

              {!subgraph && !traversing && searchResults.length === 0 && (
                <div className="text-center py-16">
                  <p className="text-gray-700 text-xs font-mono">Search for a concept and click Explore to visualize the graph.</p>
                </div>
              )}
            </div>
          )}

          {/* ── FIND PATH TAB ── */}
          {tab === "find-path" && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-gray-500 text-2xs font-mono">From concept</label>
                  <input
                    className="w-full mt-1 bg-gray-900 border border-gray-700 rounded px-3 py-2 text-xs font-mono focus:outline-none focus:border-green-500"
                    value={pathFrom}
                    onChange={(e) => setPathFrom(e.target.value)}
                    placeholder="e.g. Machine Learning"
                  />
                </div>
                <div>
                  <label className="text-gray-500 text-2xs font-mono">To concept</label>
                  <input
                    className="w-full mt-1 bg-gray-900 border border-gray-700 rounded px-3 py-2 text-xs font-mono focus:outline-none focus:border-green-500"
                    value={pathTo}
                    onChange={(e) => setPathTo(e.target.value)}
                    placeholder="e.g. Neural Networks"
                  />
                </div>
              </div>
              <button
                onClick={findPath}
                disabled={findingPath || !pathFrom.trim() || !pathTo.trim()}
                className="px-4 py-2 text-xs text-green-400 border border-green-700 rounded hover:bg-green-900/30 disabled:opacity-40 font-mono"
              >
                {findingPath ? "Finding path..." : "Find Path →"}
              </button>

              {pathResult.length > 0 && (
                <div className="border border-gray-800 rounded-lg p-4">
                  <p className="text-gray-500 text-2xs font-mono mb-3">Path ({pathResult.length} hops)</p>
                  <div className="flex flex-wrap items-center gap-2">
                    {pathResult.map((concept, i) => (
                      <span key={i} className="flex items-center gap-2">
                        <span className="text-xs font-mono bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-gray-200">
                          {concept}
                        </span>
                        {i < pathResult.length - 1 && (
                          <span className="text-gray-600 text-xs">→</span>
                        )}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {pathResult.length === 0 && !findingPath && (
                <p className="text-gray-700 text-xs font-mono text-center py-8">Enter two concepts to find the shortest path between them.</p>
              )}
            </div>
          )}

          {/* ── EXTRACT TAB ── */}
          {tab === "extract" && (
            <div className="space-y-4">
              <div>
                <label className="text-gray-500 text-2xs font-mono">Paste text to extract concepts from</label>
                <textarea
                  className="w-full mt-2 bg-gray-900 border border-gray-700 rounded p-3 text-xs font-mono resize-none h-36 focus:outline-none focus:border-green-500"
                  placeholder="Paste any text, article, notes, or document here..."
                  value={extractText}
                  onChange={(e) => setExtractText(e.target.value)}
                />
              </div>
              <button
                onClick={extractFromText}
                disabled={extracting || !extractText.trim()}
                className="px-4 py-2 text-xs text-green-400 border border-green-700 rounded hover:bg-green-900/30 disabled:opacity-40 font-mono"
              >
                {extracting ? "Extracting..." : "Extract Concepts →"}
              </button>

              {extractedNodes.length > 0 && (
                <div>
                  <p className="text-gray-500 text-2xs font-mono mb-3">Extracted {extractedNodes.length} nodes</p>
                  <div className="grid grid-cols-2 gap-2">
                    {extractedNodes.map((n) => {
                      const c = nodeColors(n.node_type);
                      return (
                        <div key={n.id} className={`border rounded-lg p-3 ${c.bg} ${c.border}`}>
                          <div className="flex items-center gap-2 mb-1">
                            <span className={`text-2xs font-mono ${c.text}`}>{n.node_type}</span>
                          </div>
                          <p className={`text-xs font-mono font-semibold ${c.text}`}>{n.concept}</p>
                          {n.description && (
                            <p className="text-gray-400 text-2xs font-mono mt-1">{n.description}</p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── ASK TAB ── */}
          {tab === "ask" && (
            <div className="space-y-4">
              <div>
                <label className="text-gray-500 text-2xs font-mono">Ask the knowledge graph a question</label>
                <div className="flex gap-2 mt-2">
                  <input
                    className="flex-1 bg-gray-900 border border-gray-700 rounded px-3 py-2 text-xs font-mono focus:outline-none focus:border-green-500"
                    placeholder="What do I know about neural networks?"
                    value={question}
                    onChange={(e) => setQuestion(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && askGraph()}
                  />
                  <button
                    onClick={askGraph}
                    disabled={asking || !question.trim()}
                    className="px-3 py-2 text-xs text-green-400 border border-green-700 rounded hover:bg-green-900/30 disabled:opacity-40 font-mono"
                  >
                    {asking ? "..." : "Ask →"}
                  </button>
                </div>
              </div>

              {asking && (
                <p className="text-green-400 text-xs font-mono animate-pulse">Querying graph...</p>
              )}

              {answer && (
                <div className="border border-gray-700 rounded-lg p-4 bg-gray-900">
                  <p className="text-gray-500 text-2xs font-mono mb-2">Answer</p>
                  <p className="text-gray-200 text-xs font-mono leading-relaxed whitespace-pre-wrap">{answer}</p>
                </div>
              )}

              {!answer && !asking && (
                <p className="text-gray-700 text-xs font-mono text-center py-8">Ask any question and BLADE will answer using your knowledge graph.</p>
              )}
            </div>
          )}
        </div>

        {/* Right: Node detail panel */}
        {selectedNode && (
          <div className="w-72 border-l border-gray-800 p-4 overflow-y-auto flex-shrink-0">
            <div className="flex items-center justify-between mb-3">
              <p className="text-gray-500 text-2xs font-mono uppercase tracking-wider">Node Detail</p>
              <button
                onClick={() => setSelectedNode(null)}
                className="text-gray-600 hover:text-gray-400 text-sm"
              >
                ✕
              </button>
            </div>
            <NodeDetailPanel
              node={selectedNode}
              onExplore={(concept) => explore(concept)}
            />
          </div>
        )}
      </div>
    </div>
  );
}
