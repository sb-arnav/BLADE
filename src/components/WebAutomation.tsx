import { useCallback, useRef, useState } from "react";
import {
  useWebAutomation,
  type WebAction,
  type WebSession,
  type WebRecipe,
} from "../hooks/useWebAutomation";

// ── Props ────────────────────────────────────────────────────────────────────

interface Props {
  onBack: () => void;
  onSendToChat: (text: string) => void;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const ACTION_ICONS: Record<WebAction["type"], string> = {
  navigate: "🌐",
  click: "👆",
  type: "⌨️",
  scroll: "📜",
  screenshot: "📸",
  extract: "📄",
  wait: "⏳",
};

const STATUS_COLORS: Record<WebAction["status"], string> = {
  pending: "text-blade-muted",
  running: "text-yellow-400",
  done: "text-emerald-400",
  error: "text-red-400",
};

const STATUS_LABELS: Record<WebAction["status"], string> = {
  pending: "Pending",
  running: "Running...",
  done: "Done",
  error: "Error",
};

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 1000) return "just now";
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
  return `${Math.floor(diff / 3600_000)}h ago`;
}

function truncate(str: string, len: number): string {
  if (str.length <= len) return str;
  return str.slice(0, len - 1) + "\u2026";
}

function sessionStatusBadge(status: WebSession["status"]) {
  const map: Record<string, string> = {
    active: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
    completed: "bg-blue-500/20 text-blue-400 border-blue-500/30",
    error: "bg-red-500/20 text-red-400 border-red-500/30",
  };
  return map[status] ?? "";
}

// ── Action type options for the builder ──────────────────────────────────────

const ACTION_TYPES: WebAction["type"][] = [
  "navigate", "click", "type", "scroll", "screenshot", "extract", "wait",
];

// ── Component ────────────────────────────────────────────────────────────────

export default function WebAutomation({ onBack, onSendToChat }: Props) {
  const {
    sessions,
    activeSession,
    activeSessionId,
    setActiveSessionId,
    startSession,
    executeAction,
    runRecipe,
    stopSession,
    recipes,
  } = useWebAutomation();

  // ── Local state ────────────────────────────────────────────────────────

  const [urlInput, setUrlInput] = useState("");
  const [urlHistory, setUrlHistory] = useState<string[]>([]);
  const [showUrlHistory, setShowUrlHistory] = useState(false);
  const [tab, setTab] = useState<"actions" | "data" | "sessions">("actions");
  const [isLoading, setIsLoading] = useState(false);

  // Action builder state
  const [builderType, setBuilderType] = useState<WebAction["type"]>("click");
  const [builderTarget, setBuilderTarget] = useState("");
  const [builderValue, setBuilderValue] = useState("");

  // AI mode
  const [aiPrompt, setAiPrompt] = useState("");

  // Recipe modal
  const [selectedRecipe, setSelectedRecipe] = useState<WebRecipe | null>(null);
  const [recipeParams, setRecipeParams] = useState<Record<string, string>>({});

  const logEndRef = useRef<HTMLDivElement>(null);
  const urlInputRef = useRef<HTMLInputElement>(null);

  // ── Handlers ───────────────────────────────────────────────────────────

  const handleGo = useCallback(async () => {
    const raw = urlInput.trim();
    if (!raw) return;
    const url = raw.startsWith("http") ? raw : `https://${raw}`;
    setIsLoading(true);
    setUrlHistory((prev) => {
      const next = [url, ...prev.filter((u) => u !== url)].slice(0, 10);
      return next;
    });
    try {
      await startSession(url);
      setTab("actions");
    } finally {
      setIsLoading(false);
    }
  }, [urlInput, startSession]);

  const handleExecuteBuilder = useCallback(async () => {
    if (!activeSessionId) return;
    setIsLoading(true);
    try {
      await executeAction(activeSessionId, {
        type: builderType,
        target: builderTarget || undefined,
        value: builderValue || undefined,
      });
      setBuilderTarget("");
      setBuilderValue("");
    } finally {
      setIsLoading(false);
    }
  }, [activeSessionId, builderType, builderTarget, builderValue, executeAction]);

  const handleRunRecipe = useCallback(async () => {
    if (!selectedRecipe) return;
    setIsLoading(true);
    try {
      await runRecipe(selectedRecipe.id, { ...recipeParams, url: urlInput.trim().startsWith("http") ? urlInput.trim() : `https://${urlInput.trim()}` });
    } finally {
      setIsLoading(false);
      setSelectedRecipe(null);
      setRecipeParams({});
    }
  }, [selectedRecipe, recipeParams, urlInput, runRecipe]);

  const handleAiSubmit = useCallback(async () => {
    if (!aiPrompt.trim()) return;
    // Send the AI prompt to chat for planning
    onSendToChat(`[Web Automation Request] ${aiPrompt.trim()}`);
    setAiPrompt("");
  }, [aiPrompt, onSendToChat]);

  const handleSendExtracted = useCallback(() => {
    if (!activeSession?.extractedData) return;
    onSendToChat(activeSession.extractedData);
  }, [activeSession, onSendToChat]);

  // ── Active session actions ─────────────────────────────────────────────

  const actions = activeSession?.actions ?? [];
  const extractedData = activeSession?.extractedData ?? "";

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full bg-blade-base text-blade-text">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-blade-border shrink-0">
        <button
          onClick={onBack}
          className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-blade-surface text-blade-muted hover:text-blade-text transition-colors"
          title="Back"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M10 12L6 8l4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <h2 className="text-sm font-semibold tracking-wide flex-1">Web Automation</h2>
        {activeSession && (
          <span className={`text-[11px] px-2 py-0.5 rounded-full border ${sessionStatusBadge(activeSession.status)}`}>
            {activeSession.status}
          </span>
        )}
        {activeSession?.status === "active" && (
          <button
            onClick={() => stopSession(activeSession.id)}
            className="text-[11px] px-2 py-1 rounded-lg bg-red-500/15 text-red-400 hover:bg-red-500/25 transition-colors"
          >
            Stop
          </button>
        )}
      </div>

      {/* ── URL Bar ────────────────────────────────────────────────────── */}
      <div className="px-4 py-3 border-b border-blade-border shrink-0">
        <div className="relative flex gap-2">
          <div className="flex-1 relative">
            <input
              ref={urlInputRef}
              type="text"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              onFocus={() => urlHistory.length > 0 && setShowUrlHistory(true)}
              onBlur={() => setTimeout(() => setShowUrlHistory(false), 200)}
              onKeyDown={(e) => e.key === "Enter" && handleGo()}
              placeholder="Enter URL (e.g., https://example.com)"
              className="w-full bg-blade-surface border border-blade-border rounded-lg px-3 py-2 text-sm font-mono text-blade-text placeholder:text-blade-muted focus:outline-none focus:border-blade-accent transition-colors"
            />
            {showUrlHistory && urlHistory.length > 0 && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-blade-surface border border-blade-border rounded-lg overflow-hidden shadow-lg z-20">
                {urlHistory.map((u) => (
                  <button
                    key={u}
                    onMouseDown={() => { setUrlInput(u); setShowUrlHistory(false); }}
                    className="w-full text-left px-3 py-1.5 text-xs font-mono text-blade-muted hover:bg-blade-hover hover:text-blade-text truncate transition-colors"
                  >
                    {u}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            onClick={handleGo}
            disabled={isLoading || !urlInput.trim()}
            className="px-4 py-2 rounded-lg bg-blade-accent text-white text-sm font-medium hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed transition"
          >
            {isLoading ? "..." : "Go"}
          </button>
        </div>
      </div>

      {/* ── Tabs ───────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-1 px-4 pt-2 shrink-0">
        {(["actions", "data", "sessions"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
              tab === t
                ? "bg-blade-surface text-blade-text"
                : "text-blade-muted hover:text-blade-text hover:bg-blade-surface/50"
            }`}
          >
            {t === "actions" ? "Actions" : t === "data" ? "Extracted Data" : "Sessions"}
          </button>
        ))}
      </div>

      {/* ── Tab Content ────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        {/* ── Actions tab ──────────────────────────────────────────────── */}
        {tab === "actions" && (
          <>
            {/* Recipe Cards */}
            <div>
              <h3 className="text-xs font-semibold text-blade-muted uppercase tracking-wider mb-2">Quick Recipes</h3>
              <div className="grid grid-cols-3 gap-2">
                {recipes.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => { setSelectedRecipe(r); setRecipeParams({}); }}
                    className="flex flex-col items-center gap-1.5 p-3 rounded-xl bg-blade-surface border border-blade-border hover:border-blade-accent/50 hover:bg-blade-hover transition-colors group"
                  >
                    <span className="text-lg">{r.icon}</span>
                    <span className="text-[11px] font-medium text-blade-text group-hover:text-blade-accent transition-colors leading-tight text-center">
                      {r.name}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {/* Recipe Modal */}
            {selectedRecipe && (
              <div className="bg-blade-surface border border-blade-border rounded-xl p-4 space-y-3 animate-fade-in">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-base">{selectedRecipe.icon}</span>
                    <h4 className="text-sm font-semibold">{selectedRecipe.name}</h4>
                  </div>
                  <button
                    onClick={() => setSelectedRecipe(null)}
                    className="text-blade-muted hover:text-blade-text text-xs"
                  >
                    Cancel
                  </button>
                </div>
                <p className="text-xs text-blade-muted">{selectedRecipe.description}</p>
                <div className="space-y-2">
                  <p className="text-[11px] text-blade-muted font-medium uppercase tracking-wide">Steps:</p>
                  {selectedRecipe.steps.map((step, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs text-blade-muted">
                      <span className="w-4 text-center">{ACTION_ICONS[step.type]}</span>
                      <span className="font-mono">{step.type}</span>
                      {step.target && (
                        <span className="text-blade-text/60 font-mono truncate">{truncate(step.target, 40)}</span>
                      )}
                    </div>
                  ))}
                </div>
                <button
                  onClick={handleRunRecipe}
                  disabled={isLoading || !urlInput.trim()}
                  className="w-full py-2 rounded-lg bg-blade-accent text-white text-sm font-medium hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed transition"
                >
                  {isLoading ? "Running..." : "Run Recipe"}
                </button>
              </div>
            )}

            {/* Action Builder */}
            <div>
              <h3 className="text-xs font-semibold text-blade-muted uppercase tracking-wider mb-2">Action Builder</h3>
              <div className="bg-blade-surface border border-blade-border rounded-xl p-3 space-y-2">
                <div className="flex gap-2">
                  <select
                    value={builderType}
                    onChange={(e) => setBuilderType(e.target.value as WebAction["type"])}
                    className="bg-blade-base border border-blade-border rounded-lg px-2 py-1.5 text-xs font-mono text-blade-text focus:outline-none focus:border-blade-accent"
                  >
                    {ACTION_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {ACTION_ICONS[t]} {t}
                      </option>
                    ))}
                  </select>
                  <input
                    type="text"
                    value={builderTarget}
                    onChange={(e) => setBuilderTarget(e.target.value)}
                    placeholder="CSS selector or URL"
                    className="flex-1 bg-blade-base border border-blade-border rounded-lg px-2 py-1.5 text-xs font-mono text-blade-text placeholder:text-blade-muted focus:outline-none focus:border-blade-accent"
                  />
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={builderValue}
                    onChange={(e) => setBuilderValue(e.target.value)}
                    placeholder="Value (text to type, scroll direction, etc.)"
                    className="flex-1 bg-blade-base border border-blade-border rounded-lg px-2 py-1.5 text-xs font-mono text-blade-text placeholder:text-blade-muted focus:outline-none focus:border-blade-accent"
                  />
                  <button
                    onClick={handleExecuteBuilder}
                    disabled={isLoading || !activeSessionId}
                    className="px-3 py-1.5 rounded-lg bg-blade-accent/20 text-blade-accent text-xs font-medium hover:bg-blade-accent/30 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    Execute
                  </button>
                </div>
                {!activeSessionId && (
                  <p className="text-[11px] text-blade-muted">Start a session first by entering a URL and clicking Go.</p>
                )}
              </div>
            </div>

            {/* AI Mode */}
            <div>
              <h3 className="text-xs font-semibold text-blade-muted uppercase tracking-wider mb-2">AI Mode</h3>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={aiPrompt}
                  onChange={(e) => setAiPrompt(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleAiSubmit()}
                  placeholder="Describe what you want (e.g., 'scrape the top 10 HN posts')"
                  className="flex-1 bg-blade-surface border border-blade-border rounded-lg px-3 py-2 text-sm text-blade-text placeholder:text-blade-muted focus:outline-none focus:border-blade-accent transition-colors"
                />
                <button
                  onClick={handleAiSubmit}
                  disabled={!aiPrompt.trim()}
                  className="px-3 py-2 rounded-lg bg-purple-500/20 text-purple-400 text-xs font-medium hover:bg-purple-500/30 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  Plan
                </button>
              </div>
            </div>

            {/* Action Log */}
            {actions.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold text-blade-muted uppercase tracking-wider mb-2">
                  Action Log ({actions.length})
                </h3>
                <div className="space-y-1">
                  {actions.map((a) => (
                    <div
                      key={a.id}
                      className="flex items-start gap-2 p-2 rounded-lg bg-blade-surface border border-blade-border text-xs"
                    >
                      <span className="text-sm shrink-0 mt-0.5">{ACTION_ICONS[a.type]}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-medium">{a.type}</span>
                          <span className={`text-[10px] ${STATUS_COLORS[a.status]}`}>
                            {STATUS_LABELS[a.status]}
                          </span>
                          <span className="text-[10px] text-blade-muted ml-auto shrink-0">
                            {timeAgo(a.timestamp)}
                          </span>
                        </div>
                        {a.target && (
                          <p className="font-mono text-blade-muted truncate mt-0.5">{truncate(a.target, 60)}</p>
                        )}
                        {a.result && (
                          <p className="text-emerald-400/80 mt-0.5 truncate">{truncate(a.result, 80)}</p>
                        )}
                        {a.error && (
                          <p className="text-red-400/80 mt-0.5 truncate">{truncate(a.error, 80)}</p>
                        )}
                      </div>
                    </div>
                  ))}
                  <div ref={logEndRef} />
                </div>
              </div>
            )}

            {actions.length === 0 && !selectedRecipe && (
              <div className="flex flex-col items-center justify-center py-12 text-blade-muted">
                <span className="text-3xl mb-3">🤖</span>
                <p className="text-sm font-medium">No actions yet</p>
                <p className="text-xs mt-1">Enter a URL to start a web automation session</p>
              </div>
            )}
          </>
        )}

        {/* ── Extracted Data tab ───────────────────────────────────────── */}
        {tab === "data" && (
          <div className="space-y-3">
            {extractedData ? (
              <>
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold text-blade-muted uppercase tracking-wider">
                    Extracted Content
                  </h3>
                  <button
                    onClick={handleSendExtracted}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blade-accent/20 text-blade-accent text-xs font-medium hover:bg-blade-accent/30 transition-colors"
                  >
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                      <path d="M14 2L7 9M14 2l-5 12-2-5-5-2 12-5z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    Send to AI
                  </button>
                </div>
                <div className="bg-blade-surface border border-blade-border rounded-xl p-3 max-h-[500px] overflow-y-auto">
                  <pre className="text-xs font-mono text-blade-text whitespace-pre-wrap break-words leading-relaxed">
                    {extractedData}
                  </pre>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => navigator.clipboard.writeText(extractedData)}
                    className="px-3 py-1.5 rounded-lg bg-blade-surface border border-blade-border text-xs text-blade-muted hover:text-blade-text transition-colors"
                  >
                    Copy to Clipboard
                  </button>
                  <span className="text-[11px] text-blade-muted">
                    {extractedData.length.toLocaleString()} characters
                  </span>
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center justify-center py-16 text-blade-muted">
                <span className="text-3xl mb-3">📭</span>
                <p className="text-sm font-medium">No extracted data</p>
                <p className="text-xs mt-1">Run an extract action or a scrape recipe to see data here</p>
              </div>
            )}
          </div>
        )}

        {/* ── Sessions tab ─────────────────────────────────────────────── */}
        {tab === "sessions" && (
          <div className="space-y-2">
            {sessions.length > 0 ? (
              sessions.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setActiveSessionId(s.id)}
                  className={`w-full text-left p-3 rounded-xl border transition-colors ${
                    s.id === activeSessionId
                      ? "bg-blade-accent/10 border-blade-accent/40"
                      : "bg-blade-surface border-blade-border hover:border-blade-accent/30"
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium truncate flex-1 mr-2">{s.title}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full border shrink-0 ${sessionStatusBadge(s.status)}`}>
                      {s.status}
                    </span>
                  </div>
                  <p className="text-[11px] font-mono text-blade-muted truncate">{s.url}</p>
                  <div className="flex items-center gap-3 mt-1.5 text-[10px] text-blade-muted">
                    <span>{s.actions.length} action{s.actions.length !== 1 ? "s" : ""}</span>
                    <span>{timeAgo(s.startedAt)}</span>
                    {s.extractedData && <span className="text-emerald-400">has data</span>}
                  </div>
                </button>
              ))
            ) : (
              <div className="flex flex-col items-center justify-center py-16 text-blade-muted">
                <span className="text-3xl mb-3">🕸️</span>
                <p className="text-sm font-medium">No sessions yet</p>
                <p className="text-xs mt-1">Start your first session by navigating to a URL</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Footer Status ──────────────────────────────────────────────── */}
      <div className="shrink-0 px-4 py-2 border-t border-blade-border flex items-center justify-between text-[11px] text-blade-muted">
        <span>
          {sessions.length} session{sessions.length !== 1 ? "s" : ""}
          {activeSession ? ` \u00b7 viewing: ${truncate(activeSession.url, 30)}` : ""}
        </span>
        {isLoading && (
          <span className="flex items-center gap-1 text-yellow-400">
            <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 animate-pulse" />
            Working...
          </span>
        )}
      </div>
    </div>
  );
}
