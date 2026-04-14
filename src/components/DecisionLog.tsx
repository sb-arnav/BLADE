import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";

interface DecisionSignal {
  source: string;
  description: string;
  confidence: number;
  reversible: boolean;
  time_sensitive: boolean;
}

type DecisionOutcome = "ActAutonomously" | "AskUser" | "QueueForLater" | "Ignore";

interface DecisionEntry {
  id: string;
  signal: DecisionSignal;
  outcome: DecisionOutcome;
  timestamp: string;
}

const OUTCOME_STYLES: Record<DecisionOutcome, { label: string; classes: string; dot: string }> = {
  ActAutonomously: {
    label: "Act",
    classes: "bg-green-500/15 text-green-400 border-green-700/50",
    dot: "bg-green-400",
  },
  AskUser: {
    label: "Ask",
    classes: "bg-yellow-500/15 text-yellow-400 border-yellow-700/50",
    dot: "bg-yellow-400",
  },
  QueueForLater: {
    label: "Queue",
    classes: "bg-blue-500/15 text-blue-400 border-blue-700/50",
    dot: "bg-blue-400",
  },
  Ignore: {
    label: "Ignore",
    classes: "bg-blade-border/30 text-blade-muted border-blade-border/40",
    dot: "bg-blade-muted",
  },
};

function formatTimestamp(ts: string): string {
  try {
    const d = new Date(ts);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return d.toLocaleDateString();
  } catch {
    return ts;
  }
}

function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const color = pct >= 80 ? "bg-green-500" : pct >= 50 ? "bg-yellow-500" : "bg-red-500";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1 bg-blade-border rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[10px] text-blade-muted tabular-nums w-7 text-right">{pct}%</span>
    </div>
  );
}

function DecisionCard({ entry, onFeedback }: {
  entry: DecisionEntry;
  onFeedback: (id: string, wasCorrect: boolean) => void;
}) {
  const style = OUTCOME_STYLES[entry.outcome];
  const [feedbackSent, setFeedbackSent] = useState<boolean | null>(null);
  const [sending, setSending] = useState(false);

  async function handleFeedback(wasCorrect: boolean) {
    if (sending || feedbackSent !== null) return;
    setSending(true);
    try {
      await onFeedback(entry.id, wasCorrect);
      setFeedbackSent(wasCorrect);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="border border-blade-border rounded-lg bg-blade-surface p-3 space-y-2 hover:border-blade-border/80 transition-colors">
      {/* Header row */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${style.classes} shrink-0`}>
            <span className={`w-1.5 h-1.5 rounded-full ${style.dot}`} />
            {style.label}
          </span>
          <span className="text-[10px] text-blade-muted truncate">{entry.signal.source}</span>
        </div>
        <span className="text-[10px] text-blade-muted shrink-0">{formatTimestamp(entry.timestamp)}</span>
      </div>

      {/* Description */}
      <p className="text-xs text-blade-text leading-relaxed">{entry.signal.description}</p>

      {/* Confidence + tags */}
      <div className="space-y-1.5">
        <ConfidenceBar value={entry.signal.confidence} />
        <div className="flex gap-2">
          {entry.signal.reversible && (
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-blade-border/40 text-blade-muted border border-blade-border/30">
              reversible
            </span>
          )}
          {entry.signal.time_sensitive && (
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-yellow-500/10 text-yellow-500/80 border border-yellow-700/30">
              time-sensitive
            </span>
          )}
        </div>
      </div>

      {/* Feedback buttons */}
      <div className="flex items-center gap-2 pt-0.5">
        <span className="text-[10px] text-blade-muted">Was this right?</span>
        {feedbackSent !== null ? (
          <span className="text-[10px] text-blade-muted italic">
            {feedbackSent ? "Thanks for confirming" : "Noted — will recalibrate"}
          </span>
        ) : (
          <>
            <button
              onClick={() => handleFeedback(true)}
              disabled={sending}
              className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] text-blade-muted border border-blade-border/40 hover:border-green-700/60 hover:text-green-400 hover:bg-green-500/5 transition-all disabled:opacity-40"
            >
              <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 12V7l3-5h1l1 3H11a1 1 0 011 1v1l-1.5 5H2z" />
                <path d="M7 7V2" />
              </svg>
              Yes
            </button>
            <button
              onClick={() => handleFeedback(false)}
              disabled={sending}
              className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] text-blade-muted border border-blade-border/40 hover:border-red-700/60 hover:text-red-400 hover:bg-red-500/5 transition-all disabled:opacity-40"
            >
              <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 4v5l-3 5H10L9 11H5a1 1 0 01-1-1V9l1.5-5H14z" />
                <path d="M9 9v5" />
              </svg>
              No
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export function DecisionLog({ onBack }: { onBack: () => void }) {
  const [entries, setEntries] = useState<DecisionEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const data = await invoke<DecisionEntry[]>("get_decision_log");
      setEntries(data.slice(0, 20));
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function handleFeedback(id: string, wasCorrect: boolean) {
    await invoke("decision_feedback", { id, wasCorrect });
  }

  const counts = entries.reduce<Record<DecisionOutcome, number>>(
    (acc, e) => { acc[e.outcome] = (acc[e.outcome] ?? 0) + 1; return acc; },
    { ActAutonomously: 0, AskUser: 0, QueueForLater: 0, Ignore: 0 }
  );

  return (
    <div className="flex flex-col h-full bg-blade-bg text-blade-text">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-blade-border bg-blade-surface/60 sticky top-0 z-10">
        <button
          onClick={onBack}
          className="text-blade-muted hover:text-blade-accent transition-colors"
          aria-label="Go back"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10 12L6 8l4-4" />
          </svg>
        </button>
        <span className="text-blade-accent text-sm font-semibold tracking-wide">Decision Log</span>
        <span className="text-blade-muted text-[10px]">last {entries.length} decisions</span>
        <div className="flex-1" />
        <button
          onClick={load}
          disabled={loading}
          className="text-[10px] text-blade-muted hover:text-blade-accent transition-colors disabled:opacity-40"
        >
          {loading ? "Loading..." : "Refresh"}
        </button>
      </div>

      {/* Summary chips */}
      {!loading && entries.length > 0 && (
        <div className="flex gap-2 px-4 py-2.5 border-b border-blade-border/50 bg-blade-surface/30 flex-wrap">
          {(Object.keys(OUTCOME_STYLES) as DecisionOutcome[]).map((outcome) => {
            const style = OUTCOME_STYLES[outcome];
            const count = counts[outcome];
            if (count === 0) return null;
            return (
              <span key={outcome} className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-medium border ${style.classes}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${style.dot}`} />
                {style.label}: {count}
              </span>
            );
          })}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {loading && (
          <div className="flex items-center justify-center py-12">
            <div className="w-2 h-2 rounded-full bg-blade-accent animate-pulse" />
          </div>
        )}
        {error && (
          <div className="border border-red-700/40 rounded-lg bg-red-900/10 p-4 text-xs text-red-400">
            Failed to load decision log: {error}
          </div>
        )}
        {!loading && !error && entries.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="w-8 h-8 rounded-full bg-blade-surface border border-blade-border flex items-center justify-center mb-3">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <circle cx="8" cy="8" r="6" />
                <path d="M8 5v4M8 11v.5" />
              </svg>
            </div>
            <p className="text-sm text-blade-secondary">No decisions recorded yet</p>
            <p className="text-xs text-blade-muted mt-1">The decision gate will log activity here as BLADE operates</p>
          </div>
        )}
        {!loading && entries.map((entry) => (
          <DecisionCard key={entry.id} entry={entry} onFeedback={handleFeedback} />
        ))}
      </div>
    </div>
  );
}
