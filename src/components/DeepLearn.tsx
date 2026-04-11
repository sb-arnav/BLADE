// DeepLearn — Blade's mission zero.
// Blade reads your digital life and becomes you.

import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

interface DataSource {
  id: string;
  name: string;
  description: string;
  path: string | null;
  available: boolean;
  size_hint: string;
}

interface LearnProgress {
  source: string;
  status: "reading" | "embedding" | "synthesizing" | "done" | "error";
  detail: string;
  chunks: number;
}

interface Props {
  onComplete: (summary: string) => void;
  onSkip: () => void;
}

type Phase = "permission" | "select" | "running" | "complete";

export function DeepLearn({ onComplete, onSkip }: Props) {
  const [phase, setPhase] = useState<Phase>("permission");
  const [sources, setSources] = useState<DataSource[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<Record<string, LearnProgress>>({});
  const [summary, setSummary] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const unlistenRef = useRef<(() => void) | null>(null);
  const summaryRef = useRef<HTMLDivElement>(null);

  // Discover available sources when entering select phase
  useEffect(() => {
    if (phase === "select") {
      setLoading(true);
      invoke<DataSource[]>("deeplearn_discover_sources")
        .then((result) => {
          setSources(result);
          // Pre-select all available sources
          setSelected(new Set(result.map((s) => s.id)));
        })
        .catch((e) => setError(String(e)))
        .finally(() => setLoading(false));
    }
  }, [phase]);

  // Listen to progress events during learning
  useEffect(() => {
    if (phase === "running") {
      listen<LearnProgress>("deeplearn_progress", (event) => {
        setProgress((prev) => ({
          ...prev,
          [event.payload.source]: event.payload,
        }));
      }).then((unlisten) => {
        unlistenRef.current = unlisten;
      });
    }
    return () => {
      unlistenRef.current?.();
    };
  }, [phase]);

  const handleRun = async () => {
    setPhase("running");
    setError(null);
    try {
      const result = await invoke<string>("deeplearn_run", {
        sourceIds: Array.from(selected),
      });
      setSummary(result);
      setPhase("complete");
    } catch (e) {
      setError(String(e));
      setPhase("select");
    }
  };

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // ── Permission screen ──────────────────────────────────────────────────────
  if (phase === "permission") {
    return (
      <div className="h-full flex flex-col items-center justify-center px-6 py-8 text-center space-y-6">
        <div className="space-y-3">
          <div className="w-12 h-12 rounded-2xl bg-blade-accent/10 border border-blade-accent/20 flex items-center justify-center mx-auto">
            <svg viewBox="0 0 24 24" className="w-6 h-6 text-blade-accent" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold">Blade wants to know you.</h2>
          <p className="text-sm text-blade-secondary max-w-xs mx-auto leading-relaxed">
            Not in a generic way. In a <em>specific</em> way — your shell history,
            your git commits, your notes. The patterns that make you, you.
          </p>
        </div>

        <div className="bg-blade-surface border border-blade-border rounded-2xl p-4 text-left space-y-3 w-full max-w-sm">
          <p className="text-xs uppercase tracking-wide text-blade-muted">What Blade will read</p>
          {[
            ["Shell history", "Commands you've run — your instincts exposed"],
            ["Git commits", "What you've built — your work ethic, your style"],
            ["Obsidian vault", "Your thoughts — the inside of your head"],
            ["Editor settings", "How you work — tools, shortcuts, preferences"],
            ["Past conversations", "What you've already told Blade"],
          ].map(([title, desc]) => (
            <div key={title} className="flex items-start gap-2.5">
              <div className="w-1.5 h-1.5 rounded-full bg-blade-accent/60 mt-1.5 flex-shrink-0" />
              <div>
                <p className="text-xs font-medium text-blade-text">{title}</p>
                <p className="text-[10px] text-blade-muted">{desc}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="bg-blade-surface/50 border border-blade-border/50 rounded-xl px-4 py-3 text-xs text-blade-muted max-w-sm">
          Everything stays on your machine. Nothing leaves. Blade reads locally, embeds locally, learns locally.
        </div>

        <div className="flex gap-3 w-full max-w-sm">
          <button
            onClick={onSkip}
            className="flex-1 px-4 py-2.5 rounded-xl border border-blade-border text-blade-muted text-sm hover:text-blade-text transition-colors"
          >
            Skip for now
          </button>
          <button
            onClick={() => setPhase("select")}
            className="flex-1 px-4 py-2.5 rounded-xl bg-blade-accent text-white text-sm font-medium hover:opacity-90 transition-opacity"
          >
            Let's go
          </button>
        </div>
      </div>
    );
  }

  // ── Source selection ───────────────────────────────────────────────────────
  if (phase === "select") {
    return (
      <div className="h-full flex flex-col px-4 py-4 space-y-4">
        <div>
          <h2 className="text-base font-semibold">What can Blade read?</h2>
          <p className="text-xs text-blade-muted mt-0.5">
            Found {sources.length} data source{sources.length !== 1 ? "s" : ""} on this machine. Toggle what you want to share.
          </p>
        </div>

        {loading ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="w-1.5 h-1.5 rounded-full bg-blade-accent animate-pulse" />
          </div>
        ) : sources.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-sm text-blade-muted text-center px-6">
            No data sources found on this machine.<br />
            <span className="text-xs mt-1">Try setting up your Obsidian vault path in settings.</span>
          </div>
        ) : (
          <div className="flex-1 min-h-0 overflow-y-auto space-y-2">
            {sources.map((source) => {
              const on = selected.has(source.id);
              return (
                <button
                  key={source.id}
                  onClick={() => toggle(source.id)}
                  className={`w-full flex items-center gap-3 p-3 rounded-xl border text-left transition-colors ${
                    on
                      ? "border-blade-accent bg-blade-accent/8 text-blade-text"
                      : "border-blade-border text-blade-muted hover:border-blade-accent/40"
                  }`}
                >
                  <div className={`w-4 h-4 rounded-md border flex items-center justify-center flex-shrink-0 transition-colors ${
                    on ? "border-blade-accent bg-blade-accent" : "border-blade-border"
                  }`}>
                    {on && (
                      <svg viewBox="0 0 12 12" className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M2 6l3 3 5-5" />
                      </svg>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium">{source.name}</span>
                      <span className="text-[10px] text-blade-muted">{source.size_hint}</span>
                    </div>
                    <p className="text-[10px] text-blade-muted mt-0.5 truncate">{source.description}</p>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {error && (
          <p className="text-xs text-red-400 px-1">{error}</p>
        )}

        <div className="flex gap-3">
          <button
            onClick={onSkip}
            className="px-4 py-2.5 rounded-xl border border-blade-border text-blade-muted text-sm hover:text-blade-text transition-colors"
          >
            Skip
          </button>
          <button
            onClick={handleRun}
            disabled={selected.size === 0 || loading}
            className="flex-1 px-4 py-2.5 rounded-xl bg-blade-accent text-white text-sm font-medium hover:opacity-90 disabled:opacity-40 transition-opacity"
          >
            Start learning ({selected.size} source{selected.size !== 1 ? "s" : ""})
          </button>
        </div>
      </div>
    );
  }

  // ── Running / progress ─────────────────────────────────────────────────────
  if (phase === "running") {
    const items = Object.values(progress);
    const done = items.filter((p) => p.status === "done").length;
    const total = items.length || selected.size + 1; // +1 for synthesis

    return (
      <div className="h-full flex flex-col px-4 py-6 space-y-6">
        <div className="text-center space-y-2">
          <div className="w-10 h-10 rounded-2xl bg-blade-accent/10 border border-blade-accent/20 flex items-center justify-center mx-auto">
            <div className="w-2 h-2 rounded-full bg-blade-accent animate-pulse" />
          </div>
          <h2 className="text-base font-semibold">Blade is reading you.</h2>
          <p className="text-xs text-blade-muted">This takes about 30-60 seconds.</p>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto space-y-2">
          {/* Selected sources with progress */}
          {Array.from(selected).map((id) => {
            const p = progress[id];
            const source = sources.find((s) => s.id === id);
            const statusIcon = {
              reading: "○",
              embedding: "◔",
              synthesizing: "◑",
              done: "●",
              error: "✕",
            }[p?.status ?? "reading"] ?? "○";

            return (
              <div
                key={id}
                className={`flex items-center gap-3 px-3 py-2 rounded-xl border ${
                  p?.status === "done"
                    ? "border-blade-accent/30 bg-blade-accent/5"
                    : p?.status === "error"
                    ? "border-red-500/30 bg-red-500/5"
                    : "border-blade-border"
                }`}
              >
                <span className={`text-xs font-mono flex-shrink-0 ${
                  p?.status === "done" ? "text-blade-accent" :
                  p?.status === "error" ? "text-red-400" :
                  "text-blade-muted animate-pulse"
                }`}>
                  {statusIcon}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-blade-text">
                    {source?.name ?? id}
                  </p>
                  {p && (
                    <p className="text-[10px] text-blade-muted truncate">{p.detail}</p>
                  )}
                </div>
                {p?.chunks ? (
                  <span className="text-[10px] text-blade-muted flex-shrink-0">{p.chunks} chunks</span>
                ) : null}
              </div>
            );
          })}

          {/* Synthesis step */}
          {progress["synthesis"] && (
            <div className={`flex items-center gap-3 px-3 py-2 rounded-xl border ${
              progress["synthesis"].status === "done"
                ? "border-blade-accent/40 bg-blade-accent/8"
                : "border-blade-border"
            }`}>
              <span className={`text-xs font-mono flex-shrink-0 ${
                progress["synthesis"].status === "done" ? "text-blade-accent" : "text-blade-muted animate-pulse"
              }`}>
                {progress["synthesis"].status === "done" ? "●" : "◑"}
              </span>
              <div className="flex-1">
                <p className="text-xs font-medium text-blade-text">Building character model</p>
                <p className="text-[10px] text-blade-muted">{progress["synthesis"].detail}</p>
              </div>
            </div>
          )}
        </div>

        <div className="h-1 bg-blade-border rounded-full overflow-hidden">
          <div
            className="h-full bg-blade-accent transition-all duration-500 rounded-full"
            style={{ width: `${total > 0 ? (done / total) * 100 : 0}%` }}
          />
        </div>
      </div>
    );
  }

  // ── Complete ───────────────────────────────────────────────────────────────
  return (
    <div className="h-full flex flex-col px-4 py-6 space-y-5">
      <div className="text-center space-y-2">
        <div className="w-10 h-10 rounded-2xl bg-blade-accent/15 border border-blade-accent/30 flex items-center justify-center mx-auto">
          <svg viewBox="0 0 24 24" className="w-5 h-5 text-blade-accent" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h2 className="text-base font-semibold">Blade knows you now.</h2>
        <p className="text-xs text-blade-muted">Character model built. Every conversation from here is personalized.</p>
      </div>

      {summary && (
        <div ref={summaryRef} className="flex-1 min-h-0 overflow-y-auto">
          <div className="bg-blade-surface border border-blade-border rounded-xl p-4">
            <p className="text-[10px] uppercase tracking-wide text-blade-muted mb-2">Blade's model of you</p>
            <p className="text-sm text-blade-secondary leading-relaxed whitespace-pre-wrap">{summary}</p>
          </div>
        </div>
      )}

      <button
        onClick={() => onComplete(summary)}
        className="w-full px-4 py-2.5 rounded-xl bg-blade-accent text-white text-sm font-medium hover:opacity-90 transition-opacity"
      >
        Start talking to Blade
      </button>
    </div>
  );
}
