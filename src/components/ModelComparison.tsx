import { useCallback, useMemo, useState } from "react";
import {
  useModelComparison,
  ComparisonModel,
  ComparisonResult,
  ModelResult,
} from "../hooks/useModelComparison";

// ---------------------------------------------------------------------------
// Typing indicator (inline version for comparison columns)
// ---------------------------------------------------------------------------

const dotKeyframes = `
@keyframes mc-dot-bounce {
  0%, 60%, 100% { transform: scale(1); opacity: 0.4; }
  30% { transform: scale(1.8); opacity: 1; }
}
`;

function ColumnTypingIndicator() {
  return (
    <>
      <style>{dotKeyframes}</style>
      <div className="flex items-center gap-1.5 py-4 justify-center">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="w-1.5 h-1.5 rounded-full bg-blade-accent"
            style={{
              animation: `mc-dot-bounce 1.2s ${i * 0.15}s ease-in-out infinite`,
            }}
          />
        ))}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Provider grouping helper
// ---------------------------------------------------------------------------

const PROVIDER_LABELS: Record<string, string> = {
  groq: "Groq",
  openai: "OpenAI",
  anthropic: "Anthropic",
  gemini: "Google Gemini",
  ollama: "Ollama (local)",
};

const PROVIDER_ORDER = ["groq", "openai", "anthropic", "gemini", "ollama"];

function groupByProvider(models: ComparisonModel[]) {
  const groups: Record<string, ComparisonModel[]> = {};
  for (const m of models) {
    if (!groups[m.provider]) groups[m.provider] = [];
    groups[m.provider].push(m);
  }
  return PROVIDER_ORDER
    .filter((p) => groups[p])
    .map((p) => ({ provider: p, label: PROVIDER_LABELS[p] ?? p, models: groups[p] }));
}

// ---------------------------------------------------------------------------
// Badge for response time
// ---------------------------------------------------------------------------

function TimeBadge({ ms }: { ms: number }) {
  let color = "bg-green-500/15 text-green-400";
  if (ms > 5000) color = "bg-red-500/15 text-red-400";
  else if (ms > 2000) color = "bg-yellow-500/15 text-yellow-400";

  const display = ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;

  return (
    <span className={`text-2xs px-1.5 py-0.5 rounded-md font-mono ${color}`}>
      {display}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Single result column
// ---------------------------------------------------------------------------

function ResultColumn({ result }: { result: ModelResult }) {
  const providerLabel = PROVIDER_LABELS[result.provider] ?? result.provider;

  return (
    <div className="flex flex-col bg-blade-surface rounded-lg border border-blade-border overflow-hidden min-w-0">
      {/* Header */}
      <div className="px-3 py-2.5 border-b border-blade-border bg-blade-surface-hover flex items-center justify-between gap-2 flex-shrink-0">
        <div className="min-w-0">
          <p className="text-xs font-medium text-blade-text truncate">
            {result.model}
          </p>
          <p className="text-2xs text-blade-muted truncate">{providerLabel}</p>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {result.status === "complete" && (
            <>
              <TimeBadge ms={result.responseTime} />
              <span className="text-2xs text-blade-muted">
                {result.wordCount}w
              </span>
            </>
          )}
          {result.status === "error" && (
            <span className="text-2xs px-1.5 py-0.5 rounded-md bg-red-500/15 text-red-400">
              error
            </span>
          )}
          {(result.status === "pending" || result.status === "streaming") && (
            <span className="text-2xs px-1.5 py-0.5 rounded-md bg-blade-accent-muted text-blade-accent">
              loading
            </span>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-3 max-h-[420px]">
        {result.status === "pending" || result.status === "streaming" ? (
          <ColumnTypingIndicator />
        ) : result.status === "error" ? (
          <div className="text-sm text-red-400 bg-red-500/10 rounded-md p-3 border border-red-500/20">
            <p className="font-medium text-xs mb-1">Request failed</p>
            <p className="text-2xs leading-relaxed break-words">
              {result.error}
            </p>
          </div>
        ) : (
          <div className="text-sm text-blade-text leading-relaxed whitespace-pre-wrap break-words font-sans">
            {result.content || (
              <span className="text-blade-muted italic">Empty response</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// History item
// ---------------------------------------------------------------------------

function HistoryItem({
  comparison,
  onReview,
}: {
  comparison: ComparisonResult;
  onReview: (c: ComparisonResult) => void;
}) {
  const date = new Date(comparison.timestamp);
  const timeStr = date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  const successCount = comparison.results.filter(
    (r) => r.status === "complete"
  ).length;
  const errorCount = comparison.results.filter(
    (r) => r.status === "error"
  ).length;

  const promptPreview =
    comparison.prompt.length > 90
      ? comparison.prompt.slice(0, 90) + "..."
      : comparison.prompt;

  return (
    <button
      onClick={() => onReview(comparison)}
      className="w-full text-left px-3 py-2.5 rounded-lg bg-blade-surface border border-blade-border hover:border-blade-border-hover hover:bg-blade-surface-hover transition-colors group"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs text-blade-text leading-relaxed flex-1 min-w-0 truncate">
          {promptPreview}
        </p>
        <span className="text-2xs text-blade-muted flex-shrink-0">{timeStr}</span>
      </div>
      <div className="flex items-center gap-2 mt-1.5">
        <span className="text-2xs text-blade-muted">
          {comparison.results.length} models
        </span>
        {successCount > 0 && (
          <span className="text-2xs text-green-400">{successCount} ok</span>
        )}
        {errorCount > 0 && (
          <span className="text-2xs text-red-400">{errorCount} failed</span>
        )}
        <span className="ml-auto text-2xs text-blade-accent opacity-0 group-hover:opacity-100 transition-opacity">
          Review
        </span>
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface Props {
  onBack: () => void;
}

export function ModelComparison({ onBack }: Props) {
  const {
    runComparison,
    results: history,
    activeComparison,
    clearResults,
    availableModels,
  } = useModelComparison();

  const [prompt, setPrompt] = useState("");
  const [selectedModels, setSelectedModels] = useState<Set<string>>(() => {
    // Default: pick first model from two different providers
    const defaults = new Set<string>();
    const seenProviders = new Set<string>();
    for (const m of availableModels) {
      if (seenProviders.size >= 2) break;
      if (!seenProviders.has(m.provider)) {
        seenProviders.add(m.provider);
        defaults.add(`${m.provider}::${m.model}`);
      }
    }
    return defaults;
  });
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [reviewComparison, setReviewComparison] =
    useState<ComparisonResult | null>(null);

  const grouped = useMemo(() => groupByProvider(availableModels), [availableModels]);

  const toggleModel = useCallback((provider: string, model: string) => {
    const key = `${provider}::${model}`;
    setSelectedModels((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        if (next.size >= 4) return prev; // max 4
        next.add(key);
      }
      return next;
    });
  }, []);

  const selectedList: ComparisonModel[] = useMemo(() => {
    return availableModels.filter(
      (m) => selectedModels.has(`${m.provider}::${m.model}`)
    );
  }, [availableModels, selectedModels]);

  const canCompare = selectedList.length >= 2 && prompt.trim().length > 0;

  const handleCompare = useCallback(async () => {
    if (!canCompare || running) return;
    setRunning(true);
    setError(null);
    setReviewComparison(null);

    try {
      await runComparison(prompt.trim(), selectedList);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  }, [canCompare, running, prompt, selectedList, runComparison]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        handleCompare();
      }
    },
    [handleCompare]
  );

  const displayedComparison = reviewComparison ?? activeComparison;

  // Grid column class based on result count
  const columnCount = displayedComparison?.results.length ?? 0;
  const gridClass =
    columnCount <= 2
      ? "grid-cols-1 sm:grid-cols-2"
      : columnCount === 3
        ? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3"
        : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4";

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-5xl mx-auto px-4 py-6 space-y-5 animate-fade-in">
        {/* -------- Header -------- */}
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="p-1.5 rounded-lg hover:bg-blade-surface-hover text-blade-secondary hover:text-blade-text transition-colors"
            title="Back"
          >
            <svg
              viewBox="0 0 24 24"
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
          <div>
            <h1 className="text-base font-semibold text-blade-text">
              Model Comparison
            </h1>
            <p className="text-2xs text-blade-muted">
              Send the same prompt to multiple models and compare responses
            </p>
          </div>
        </div>

        {/* -------- Model Selector -------- */}
        <div className="bg-blade-surface rounded-lg border border-blade-border p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-medium text-blade-secondary uppercase tracking-wider">
              Select Models
            </h2>
            <span className="text-2xs text-blade-muted">
              {selectedModels.size}/4 selected (min 2)
            </span>
          </div>

          <div className="space-y-3">
            {grouped.map((group) => (
              <div key={group.provider}>
                <p className="text-2xs font-medium text-blade-muted mb-1.5">
                  {group.label}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {group.models.map((m) => {
                    const key = `${m.provider}::${m.model}`;
                    const isSelected = selectedModels.has(key);
                    const isDisabled =
                      !isSelected && selectedModels.size >= 4;

                    return (
                      <button
                        key={key}
                        onClick={() => toggleModel(m.provider, m.model)}
                        disabled={isDisabled}
                        className={`px-2.5 py-1.5 rounded-md text-xs transition-all border ${
                          isSelected
                            ? "bg-blade-accent-muted border-blade-accent/40 text-blade-accent-hover"
                            : isDisabled
                              ? "bg-blade-surface border-blade-border text-blade-muted cursor-not-allowed opacity-40"
                              : "bg-blade-surface-hover border-blade-border hover:border-blade-border-hover text-blade-secondary hover:text-blade-text"
                        }`}
                      >
                        {m.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* -------- Prompt Input -------- */}
        <div className="bg-blade-surface rounded-lg border border-blade-border p-4 space-y-3">
          <label
            htmlFor="mc-prompt"
            className="text-xs font-medium text-blade-secondary uppercase tracking-wider"
          >
            Prompt
          </label>
          <textarea
            id="mc-prompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Enter a prompt to send to all selected models..."
            rows={4}
            className="w-full bg-blade-bg border border-blade-border rounded-lg px-3 py-2.5 text-sm text-blade-text placeholder-blade-muted resize-y focus:outline-none focus:border-blade-accent/50 focus:ring-1 focus:ring-blade-accent/25 transition-colors"
          />
          <div className="flex items-center justify-between">
            <p className="text-2xs text-blade-muted">
              {prompt.trim().length > 0
                ? `${prompt.trim().split(/\s+/).length} words`
                : "Ctrl+Enter to compare"}
            </p>
            <button
              onClick={handleCompare}
              disabled={!canCompare || running}
              className={`px-4 py-2 rounded-lg text-xs font-medium transition-all ${
                canCompare && !running
                  ? "bg-blade-accent hover:bg-blade-accent-hover text-white shadow-sm shadow-blade-accent/20"
                  : "bg-blade-surface-hover text-blade-muted cursor-not-allowed"
              }`}
            >
              {running ? (
                <span className="flex items-center gap-2">
                  <svg
                    className="w-3 h-3 animate-spin"
                    viewBox="0 0 24 24"
                    fill="none"
                  >
                    <circle
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="3"
                      className="opacity-25"
                    />
                    <path
                      d="M4 12a8 8 0 018-8"
                      stroke="currentColor"
                      strokeWidth="3"
                      strokeLinecap="round"
                    />
                  </svg>
                  Comparing...
                </span>
              ) : (
                `Compare ${selectedList.length} Models`
              )}
            </button>
          </div>
        </div>

        {/* -------- Error -------- */}
        {error && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3 text-sm text-red-400 animate-fade-in">
            {error}
          </div>
        )}

        {/* -------- Results Grid -------- */}
        {displayedComparison && (
          <div className="space-y-3 animate-fade-in">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-medium text-blade-secondary uppercase tracking-wider">
                {reviewComparison ? "Past Comparison" : "Results"}
              </h2>
              {reviewComparison && (
                <button
                  onClick={() => setReviewComparison(null)}
                  className="text-2xs text-blade-accent hover:text-blade-accent-hover transition-colors"
                >
                  Back to latest
                </button>
              )}
            </div>

            {/* Prompt echo */}
            <div className="bg-blade-surface rounded-lg border border-blade-border px-3 py-2.5">
              <p className="text-2xs text-blade-muted mb-1">Prompt</p>
              <p className="text-xs text-blade-secondary leading-relaxed line-clamp-3">
                {displayedComparison.prompt}
              </p>
            </div>

            {/* Model result columns */}
            <div className={`grid gap-3 ${gridClass}`}>
              {displayedComparison.results.map((result, idx) => (
                <ResultColumn key={`${result.provider}-${result.model}-${idx}`} result={result} />
              ))}
            </div>

            {/* Summary stats row */}
            {displayedComparison.results.some((r) => r.status === "complete") && (
              <div className="bg-blade-surface rounded-lg border border-blade-border px-4 py-3">
                <p className="text-2xs text-blade-muted mb-2 uppercase tracking-wider font-medium">
                  Summary
                </p>
                <div className="flex flex-wrap gap-4">
                  {displayedComparison.results
                    .filter((r) => r.status === "complete")
                    .sort((a, b) => a.responseTime - b.responseTime)
                    .map((r, i) => (
                      <div key={`${r.provider}-${r.model}`} className="flex items-center gap-2">
                        {i === 0 && (
                          <span className="text-2xs px-1.5 py-0.5 rounded bg-green-500/15 text-green-400">
                            fastest
                          </span>
                        )}
                        <span className="text-xs text-blade-secondary">
                          {r.model}
                        </span>
                        <TimeBadge ms={r.responseTime} />
                        <span className="text-2xs text-blade-muted">
                          {r.wordCount} words
                        </span>
                      </div>
                    ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* -------- Comparison History -------- */}
        {history.length > 0 && (
          <div className="bg-blade-surface rounded-lg border border-blade-border overflow-hidden">
            <button
              onClick={() => setHistoryOpen((p) => !p)}
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-blade-surface-hover transition-colors"
            >
              <span className="text-xs font-medium text-blade-secondary uppercase tracking-wider">
                History ({history.length})
              </span>
              <svg
                viewBox="0 0 24 24"
                className={`w-3.5 h-3.5 text-blade-muted transition-transform ${
                  historyOpen ? "rotate-180" : ""
                }`}
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>

            {historyOpen && (
              <div className="border-t border-blade-border px-3 py-3 space-y-2 animate-fade-in">
                {history.map((comparison) => (
                  <HistoryItem
                    key={comparison.id}
                    comparison={comparison}
                    onReview={setReviewComparison}
                  />
                ))}

                <div className="pt-2 border-t border-blade-border">
                  <button
                    onClick={clearResults}
                    className="text-2xs text-red-400 hover:text-red-300 transition-colors"
                  >
                    Clear all history
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Bottom spacer */}
        <div className="h-4" />
      </div>
    </div>
  );
}
