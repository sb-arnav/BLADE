import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

interface TraceEntry {
  provider: string;
  model: string;
  operation: string;
  started_at: string;
  duration_ms: number;
  success: boolean;
  error: string | null;
}

interface Props {
  onBack: () => void;
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function truncate(str: string, max: number): string {
  return str.length > max ? str.slice(0, max) + "\u2026" : str;
}

export function Diagnostics({ onBack }: Props) {
  const [traces, setTraces] = useState<TraceEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);

  const fetchTraces = useCallback(async () => {
    setLoading(true);
    try {
      const data = await invoke<TraceEntry[]>("get_recent_traces");
      setTraces(data);
    } catch {
      setTraces([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTraces();
  }, [fetchTraces]);

  return (
    <div className="flex flex-col h-full bg-blade-bg text-blade-text">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-blade-border bg-blade-surface">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="text-blade-secondary hover:text-blade-text transition-colors text-sm"
          >
            &larr; Back
          </button>
          <h2 className="text-sm font-semibold">Diagnostics</h2>
        </div>
        <button
          onClick={fetchTraces}
          disabled={loading}
          className="text-blade-secondary hover:text-blade-accent transition-colors disabled:opacity-40"
          title="Refresh traces"
        >
          <svg
            className={`w-4 h-4 ${loading ? "animate-spin" : ""}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M4 4v5h5M20 20v-5h-5M4.929 9A8 8 0 0119.07 9M19.071 15A8 8 0 014.93 15"
            />
          </svg>
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {traces.length === 0 && !loading ? (
          <div className="flex items-center justify-center h-full px-6">
            <p className="text-blade-muted text-sm text-center">
              No traces yet. Start chatting to see API calls.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-blade-border">
            {traces.map((trace, i) => (
              <div key={i}>
                <button
                  className={`w-full text-left px-4 py-2 hover:bg-blade-surface transition-colors ${
                    trace.error ? "cursor-pointer" : "cursor-default"
                  }`}
                  onClick={() => {
                    if (trace.error) {
                      setExpandedIndex(expandedIndex === i ? null : i);
                    }
                  }}
                >
                  <div className="flex items-center gap-3 text-2xs font-mono">
                    {/* Status */}
                    <span className="flex-shrink-0">
                      {trace.success ? (
                        <span className="text-emerald-400">&check;</span>
                      ) : (
                        <span className="text-red-400">&times;</span>
                      )}
                    </span>

                    {/* Time */}
                    <span className="text-blade-muted w-14 flex-shrink-0">
                      {relativeTime(trace.started_at)}
                    </span>

                    {/* Provider */}
                    <span className="text-blade-accent w-16 flex-shrink-0">
                      {trace.provider}
                    </span>

                    {/* Model */}
                    <span className="text-blade-secondary w-28 flex-shrink-0 truncate">
                      {truncate(trace.model, 20)}
                    </span>

                    {/* Operation */}
                    <span className="text-blade-text flex-1 truncate">
                      {trace.operation}
                    </span>

                    {/* Duration */}
                    <span className="text-blade-muted w-16 flex-shrink-0 text-right">
                      {trace.duration_ms}ms
                    </span>
                  </div>
                </button>

                {/* Expanded error detail */}
                {expandedIndex === i && trace.error && (
                  <div className="px-4 pb-2 pl-10">
                    <pre className="text-2xs font-mono text-red-400 bg-blade-surface rounded px-3 py-2 whitespace-pre-wrap break-all">
                      {trace.error}
                    </pre>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
