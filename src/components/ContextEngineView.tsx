import React, { useState } from "react";
import { invoke } from "@tauri-apps/api/core";

// ── Types ─────────────────────────────────────────────────────────────────────

type SourceType = "memory" | "screen" | "goals" | "files" | "conversation";

interface ContextChunk {
  id: string;
  source: SourceType;
  content: string;
  relevance_score: number;
  timestamp: string;
  token_count: number;
  metadata?: Record<string, string>;
}

interface AssembledContext {
  chunks: ContextChunk[];
  total_tokens: number;
  token_budget: number;
  sources_used: SourceType[];
  was_truncated: boolean;
  assembly_time_ms: number;
}

interface ScoreResult {
  score: number;
  explanation: string;
}

// ── Source badges ─────────────────────────────────────────────────────────────

const SOURCE_COLORS: Record<SourceType, { bg: string; text: string; border: string }> = {
  memory: { bg: "bg-purple-900/40", text: "text-purple-400", border: "border-purple-700" },
  screen: { bg: "bg-blue-900/40", text: "text-blue-400", border: "border-blue-700" },
  goals: { bg: "bg-green-900/40", text: "text-green-400", border: "border-green-700" },
  files: { bg: "bg-amber-900/40", text: "text-amber-400", border: "border-amber-700" },
  conversation: { bg: "bg-cyan-900/40", text: "text-cyan-400", border: "border-cyan-700" },
};

const SOURCE_ICONS: Record<SourceType, string> = {
  memory: "◈",
  screen: "⊡",
  goals: "◎",
  files: "◫",
  conversation: "◷",
};

function SourceBadge({ source }: { source: SourceType }) {
  const c = SOURCE_COLORS[source];
  return (
    <span className={`inline-flex items-center gap-1 font-mono text-xs px-2 py-0.5 rounded border ${c.bg} ${c.text} ${c.border}`}>
      {SOURCE_ICONS[source]} {source}
    </span>
  );
}

function RelevanceBar({ score }: { score: number }) {
  const pct = Math.round(score * 100);
  const color =
    pct >= 75 ? "bg-green-500" :
    pct >= 50 ? "bg-amber-500" :
    pct >= 25 ? "bg-orange-500" : "bg-red-500";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-gray-900 rounded overflow-hidden">
        <div className={`h-full ${color} transition-all`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-gray-500 font-mono text-xs min-w-[32px] text-right">{pct}%</span>
    </div>
  );
}

// ── Chunk Card ────────────────────────────────────────────────────────────────

function ChunkCard({ chunk }: { chunk: ContextChunk }) {
  const [expanded, setExpanded] = useState(false);
  const preview = chunk.content.length > 200 ? chunk.content.slice(0, 200) + "…" : chunk.content;

  return (
    <div className="bg-gray-950 border border-gray-800 rounded overflow-hidden">
      <div className="px-3 py-2 flex items-center gap-3 border-b border-gray-800/50">
        <SourceBadge source={chunk.source} />
        <RelevanceBar score={chunk.relevance_score} />
        <span className="text-gray-700 font-mono text-xs min-w-[60px] text-right">{chunk.token_count}t</span>
      </div>
      <div className="px-3 py-2">
        <div className="text-gray-400 font-mono text-xs mb-1">{chunk.timestamp}</div>
        <div className="text-gray-300 text-xs leading-relaxed font-mono whitespace-pre-wrap">
          {expanded ? chunk.content : preview}
        </div>
        {chunk.content.length > 200 && (
          <button
            onClick={() => setExpanded((v) => !v)}
            className="text-green-700 hover:text-green-400 font-mono text-xs mt-1 transition-colors"
          >
            {expanded ? "▲ COLLAPSE" : "▼ EXPAND"}
          </button>
        )}
      </div>
      {chunk.metadata && Object.keys(chunk.metadata).length > 0 && (
        <div className="px-3 py-1 border-t border-gray-800/50 flex flex-wrap gap-2">
          {Object.entries(chunk.metadata).map(([k, v]) => (
            <span key={k} className="text-gray-700 font-mono text-xs">
              <span className="text-gray-600">{k}:</span> {v}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Root Component ────────────────────────────────────────────────────────────

export function ContextEngineView({ onBack }: { onBack: () => void }) {
  const [query, setQuery] = useState("");
  const [maxTokens, setMaxTokens] = useState(2000);
  const [sources, setSources] = useState<Record<SourceType, boolean>>({
    memory: true,
    screen: true,
    goals: true,
    files: true,
    conversation: true,
  });

  const [result, setResult] = useState<AssembledContext | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cacheCleared, setCacheCleared] = useState(false);

  // Score tool
  const [scoreQuery, setScoreQuery] = useState("");
  const [scoreChunk, setScoreChunk] = useState("");
  const [scoreResult, setScoreResult] = useState<ScoreResult | null>(null);
  const [scoreLoading, setScoreLoading] = useState(false);
  const [toolOpen, setToolOpen] = useState(false);

  function toggleSource(src: SourceType) {
    setSources((prev) => ({ ...prev, [src]: !prev[src] }));
  }

  const activeSources = (Object.keys(sources) as SourceType[]).filter((s) => sources[s]);

  async function assembleContext() {
    if (!query.trim() || activeSources.length === 0) return;
    setLoading(true);
    setError(null);
    try {
      const result = await invoke<AssembledContext>("context_assemble", {
        query: query.trim(),
        maxTokens,
        sources: activeSources,
      });
      setResult(result);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function clearCache() {
    try {
      await invoke("context_clear_cache");
      setCacheCleared(true);
      setTimeout(() => setCacheCleared(false), 2000);
    } catch (e) {
      setError(String(e));
    }
  }

  async function scoreChunkFn() {
    if (!scoreQuery.trim() || !scoreChunk.trim()) return;
    setScoreLoading(true);
    try {
      const result = await invoke<ScoreResult>("context_score_chunk", {
        query: scoreQuery.trim(),
        chunk: scoreChunk.trim(),
      });
      setScoreResult(result);
    } catch (e) {
      setError(String(e));
    } finally {
      setScoreLoading(false);
    }
  }

  const SOURCE_LIST: SourceType[] = ["memory", "screen", "goals", "files", "conversation"];

  return (
    <div className="flex flex-col h-full bg-black text-gray-200">
      {/* Header */}
      <div className="flex items-center gap-4 px-4 py-3 border-b border-gray-800 shrink-0">
        <button
          onClick={onBack}
          className="text-gray-600 hover:text-gray-300 font-mono text-xs transition-colors"
        >
          ← BACK
        </button>
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 bg-green-500 rounded-full" />
          <span className="text-green-400 font-mono text-sm uppercase tracking-widest">CONTEXT ENGINE</span>
        </div>
        <button
          onClick={clearCache}
          className={`ml-auto border font-mono text-xs px-3 py-1 transition-colors ${
            cacheCleared
              ? "border-green-700 text-green-400"
              : "border-gray-700 text-gray-600 hover:text-gray-300 hover:border-gray-500"
          }`}
        >
          {cacheCleared ? "✓ CLEARED" : "CLEAR CACHE"}
        </button>
      </div>

      {/* Body: two-column on large screens */}
      <div className="flex-1 overflow-hidden flex flex-col lg:flex-row">

        {/* LEFT: controls + results */}
        <div className="flex-1 flex flex-col overflow-hidden">

          {/* Query input */}
          <div className="px-4 pt-4 pb-2 flex flex-col gap-3 shrink-0">
            <div className="flex flex-col gap-1">
              <label className="text-gray-500 font-mono text-xs">QUERY — what context to retrieve</label>
              <textarea
                rows={2}
                className="bg-gray-950 border border-gray-700 text-gray-200 font-mono text-sm px-3 py-2 rounded focus:outline-none focus:border-green-700 resize-none"
                placeholder="e.g. What are my current project deadlines and financial goals?"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) void assembleContext();
                }}
              />
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={assembleContext}
                disabled={loading || !query.trim() || activeSources.length === 0}
                className="bg-green-900/40 border border-green-700 text-green-400 font-mono text-xs py-2 px-6 hover:bg-green-900/60 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {loading ? "ASSEMBLING..." : "⚡ ASSEMBLE CONTEXT"}
              </button>
              {error && <span className="text-red-400 font-mono text-xs">{error}</span>}
            </div>
          </div>

          {/* Results */}
          <div className="flex-1 overflow-y-auto px-4 pb-4 flex flex-col gap-3">
            {/* Footer summary (shown at top when results present) */}
            {result && (
              <div className="bg-gray-950 border border-gray-800 rounded px-4 py-3 flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2">
                  <span className="text-gray-600 font-mono text-xs">TOKENS:</span>
                  <span className={`font-mono text-xs ${result.was_truncated ? "text-amber-400" : "text-green-400"}`}>
                    {result.total_tokens} / {result.token_budget}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-gray-600 font-mono text-xs">TIME:</span>
                  <span className="text-gray-400 font-mono text-xs">{result.assembly_time_ms}ms</span>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-gray-600 font-mono text-xs">SOURCES:</span>
                  {result.sources_used.map((src) => (
                    <SourceBadge key={src} source={src} />
                  ))}
                </div>
                {result.was_truncated && (
                  <div className="flex items-center gap-1 ml-auto">
                    <span className="text-amber-500 text-xs">⚠</span>
                    <span className="text-amber-500 font-mono text-xs">TRUNCATED</span>
                  </div>
                )}
              </div>
            )}

            {/* Chunk cards */}
            {result && result.chunks.length === 0 && (
              <div className="text-gray-700 font-mono text-xs text-center py-8 border border-dashed border-gray-800 rounded">
                No context chunks returned for this query
              </div>
            )}
            {result && result.chunks.map((chunk) => (
              <ChunkCard key={chunk.id} chunk={chunk} />
            ))}

            {!result && !loading && (
              <div className="flex-1 flex items-center justify-center">
                <div className="text-center">
                  <div className="text-gray-800 font-mono text-xs mb-2">NO CONTEXT ASSEMBLED</div>
                  <div className="text-gray-700 font-mono text-xs">Enter a query and click Assemble</div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* RIGHT SIDEBAR: source toggles + max tokens + score tool */}
        <div className="w-full lg:w-64 border-t lg:border-t-0 lg:border-l border-gray-800 shrink-0 flex flex-col overflow-y-auto">
          <div className="p-4 flex flex-col gap-4">

            {/* Source toggles */}
            <div>
              <div className="text-green-400 font-mono text-xs uppercase tracking-widest mb-2">// Sources</div>
              <div className="flex flex-col gap-2">
                {SOURCE_LIST.map((src) => {
                  const c = SOURCE_COLORS[src];
                  const enabled = sources[src];
                  return (
                    <button
                      key={src}
                      onClick={() => toggleSource(src)}
                      className={`flex items-center gap-2 px-3 py-2 border rounded transition-colors text-left ${
                        enabled
                          ? `${c.bg} ${c.border} ${c.text}`
                          : "bg-gray-950 border-gray-800 text-gray-600 hover:border-gray-700"
                      }`}
                    >
                      <div className={`w-3 h-3 border-2 rounded-sm flex items-center justify-center shrink-0 ${enabled ? c.border : "border-gray-700"}`}>
                        {enabled && <div className={`w-1.5 h-1.5 rounded-sm ${c.text.replace("text-", "bg-")}`} />}
                      </div>
                      <span className="font-mono text-xs uppercase">{SOURCE_ICONS[src]} {src}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Max tokens slider */}
            <div>
              <div className="text-green-400 font-mono text-xs uppercase tracking-widest mb-2">// Max Tokens</div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-gray-600 font-mono text-xs">500</span>
                <span className="text-green-400 font-mono text-xs">{maxTokens}</span>
                <span className="text-gray-600 font-mono text-xs">4000</span>
              </div>
              <input
                type="range"
                min={500}
                max={4000}
                step={100}
                value={maxTokens}
                onChange={(e) => setMaxTokens(parseInt(e.target.value))}
                className="w-full accent-green-500"
              />
              <div className="flex justify-between mt-1">
                {[500, 1000, 2000, 4000].map((v) => (
                  <button
                    key={v}
                    onClick={() => setMaxTokens(v)}
                    className={`font-mono text-xs transition-colors ${maxTokens === v ? "text-green-400" : "text-gray-700 hover:text-gray-500"}`}
                  >
                    {v >= 1000 ? `${v / 1000}k` : v}
                  </button>
                ))}
              </div>
            </div>

            {/* Score Chunk Tool */}
            <div className="border border-gray-800 rounded">
              <button
                className="w-full flex items-center justify-between px-3 py-2 font-mono text-xs text-gray-500 hover:text-gray-300"
                onClick={() => setToolOpen((v) => !v)}
              >
                <span>// SCORE CHUNK</span>
                <span>{toolOpen ? "▲" : "▼"}</span>
              </button>
              {toolOpen && (
                <div className="p-3 flex flex-col gap-2 border-t border-gray-800">
                  <input
                    className="bg-black border border-gray-700 text-gray-200 font-mono text-xs px-2 py-1.5 rounded focus:outline-none focus:border-green-700"
                    placeholder="Query"
                    value={scoreQuery}
                    onChange={(e) => setScoreQuery(e.target.value)}
                  />
                  <textarea
                    rows={4}
                    className="bg-black border border-gray-700 text-gray-200 font-mono text-xs px-2 py-1.5 rounded focus:outline-none focus:border-green-700 resize-none"
                    placeholder="Paste any text to score..."
                    value={scoreChunk}
                    onChange={(e) => setScoreChunk(e.target.value)}
                  />
                  <button
                    onClick={scoreChunkFn}
                    disabled={scoreLoading || !scoreQuery.trim() || !scoreChunk.trim()}
                    className="bg-gray-900 border border-gray-700 text-gray-400 font-mono text-xs py-1.5 hover:border-green-700 hover:text-green-400 disabled:opacity-40 transition-colors"
                  >
                    {scoreLoading ? "..." : "SCORE →"}
                  </button>
                  {scoreResult && (
                    <div className="bg-black border border-gray-800 rounded p-2 flex flex-col gap-2">
                      <div className="flex items-center justify-between">
                        <span className="text-gray-600 font-mono text-xs">SCORE</span>
                        <span className={`font-mono text-xs ${
                          scoreResult.score >= 0.75 ? "text-green-400" :
                          scoreResult.score >= 0.5 ? "text-amber-400" : "text-red-400"
                        }`}>
                          {(scoreResult.score * 100).toFixed(0)}%
                        </span>
                      </div>
                      <RelevanceBar score={scoreResult.score} />
                      {scoreResult.explanation && (
                        <div className="text-gray-600 font-mono text-xs leading-relaxed">{scoreResult.explanation}</div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
