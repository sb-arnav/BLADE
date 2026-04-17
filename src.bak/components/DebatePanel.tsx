import { useCallback, useMemo, useState } from "react";
import { useDebate, Debate, DebatePosition, AnalysisFramework } from "../hooks/useDebate";

// ---------------------------------------------------------------------------
// Typing indicator
// ---------------------------------------------------------------------------

const dotKeyframes = `
@keyframes debate-dot-bounce {
  0%, 60%, 100% { transform: scale(1); opacity: 0.4; }
  30% { transform: scale(1.8); opacity: 1; }
}
`;

function LoadingDots() {
  return (
    <>
      <style>{dotKeyframes}</style>
      <div className="flex items-center gap-1.5 py-3 justify-center">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="w-1.5 h-1.5 rounded-full bg-blade-accent"
            style={{
              animation: `debate-dot-bounce 1.2s ${i * 0.15}s ease-in-out infinite`,
            }}
          />
        ))}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Framework icons (inline SVGs)
// ---------------------------------------------------------------------------

function FrameworkIcon({ icon, className = "w-5 h-5" }: { icon: string; className?: string }) {
  const props = {
    viewBox: "0 0 24 24",
    className,
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.5,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };

  switch (icon) {
    case "scale":
      return (
        <svg {...props}>
          <path d="M12 3v18M3 7l9-4 9 4M3 7v4l9 4 9-4V7" />
        </svg>
      );
    case "grid":
      return (
        <svg {...props}>
          <rect x="3" y="3" width="8" height="8" rx="1" />
          <rect x="13" y="3" width="8" height="8" rx="1" />
          <rect x="3" y="13" width="8" height="8" rx="1" />
          <rect x="13" y="13" width="8" height="8" rx="1" />
        </svg>
      );
    case "hat":
      return (
        <svg {...props}>
          <path d="M4 17h16M6 17c0-3 2-5 6-10 4 5 6 7 6 10" />
          <path d="M12 7V4" />
        </svg>
      );
    case "flame":
      return (
        <svg {...props}>
          <path d="M12 2c1 4-2 6-2 10a4 4 0 008 0c0-4-3-6-2-10" />
          <path d="M12 22a4 4 0 01-4-4c0-2 1.5-3 2-5 .5 2 2 3 2 5a4 4 0 01-4 4" />
        </svg>
      );
    case "users":
      return (
        <svg {...props}>
          <path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M22 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" />
        </svg>
      );
    case "shield":
      return (
        <svg {...props}>
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        </svg>
      );
    case "atom":
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="2" />
          <ellipse cx="12" cy="12" rx="9" ry="4" />
          <ellipse cx="12" cy="12" rx="9" ry="4" transform="rotate(60 12 12)" />
          <ellipse cx="12" cy="12" rx="9" ry="4" transform="rotate(120 12 12)" />
        </svg>
      );
    case "clock":
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="10" />
          <path d="M12 6v6l4 2" />
        </svg>
      );
    default:
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="10" />
          <path d="M12 8v4M12 16h.01" />
        </svg>
      );
  }
}

// ---------------------------------------------------------------------------
// Perspective color helper
// ---------------------------------------------------------------------------

const POSITION_COLORS = [
  { bg: "bg-blue-500/10", border: "border-blue-500/30", text: "text-blue-400", accent: "bg-blue-500" },
  { bg: "bg-orange-500/10", border: "border-orange-500/30", text: "text-orange-400", accent: "bg-orange-500" },
  { bg: "bg-emerald-500/10", border: "border-emerald-500/30", text: "text-emerald-400", accent: "bg-emerald-500" },
  { bg: "bg-purple-500/10", border: "border-purple-500/30", text: "text-purple-400", accent: "bg-purple-500" },
  { bg: "bg-rose-500/10", border: "border-rose-500/30", text: "text-rose-400", accent: "bg-rose-500" },
  { bg: "bg-cyan-500/10", border: "border-cyan-500/30", text: "text-cyan-400", accent: "bg-cyan-500" },
];

function getPositionColor(index: number) {
  return POSITION_COLORS[index % POSITION_COLORS.length];
}

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: Debate["status"] }) {
  const styles: Record<Debate["status"], string> = {
    setup: "bg-blade-surface-hover text-blade-muted",
    arguing: "bg-yellow-500/15 text-yellow-400",
    summarizing: "bg-blue-500/15 text-blue-400",
    completed: "bg-green-500/15 text-green-400",
  };
  const labels: Record<Debate["status"], string> = {
    setup: "Setup",
    arguing: "Arguing",
    summarizing: "Summarizing",
    completed: "Completed",
  };

  return (
    <span className={`text-2xs px-2 py-0.5 rounded-full font-medium ${styles[status]}`}>
      {labels[status]}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Strength meter
// ---------------------------------------------------------------------------

function StrengthMeter({ value, color }: { value: number; color: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-blade-border rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${color}`}
          style={{ width: `${Math.max(2, value)}%` }}
        />
      </div>
      <span className="text-2xs text-blade-muted font-mono w-7 text-right">{value}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Framework card for selection
// ---------------------------------------------------------------------------

function FrameworkCard({
  framework,
  selected,
  onSelect,
}: {
  framework: AnalysisFramework;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      className={`text-left p-3 rounded-lg border transition-all ${
        selected
          ? "bg-blade-accent-muted border-blade-accent/40 ring-1 ring-blade-accent/25"
          : "bg-blade-surface border-blade-border hover:border-blade-border-hover hover:bg-blade-surface-hover"
      }`}
    >
      <div className="flex items-center gap-2 mb-1.5">
        <FrameworkIcon
          icon={framework.icon}
          className={`w-4 h-4 ${selected ? "text-blade-accent" : "text-blade-muted"}`}
        />
        <span
          className={`text-xs font-medium ${selected ? "text-blade-accent-hover" : "text-blade-text"}`}
        >
          {framework.name}
        </span>
      </div>
      <p className="text-2xs text-blade-muted leading-relaxed">{framework.description}</p>
      <div className="flex flex-wrap gap-1 mt-2">
        {framework.perspectives.map((p) => (
          <span
            key={p}
            className="text-2xs px-1.5 py-0.5 rounded bg-blade-surface-hover text-blade-secondary"
          >
            {p.length > 20 ? p.slice(0, 18) + "..." : p}
          </span>
        ))}
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Position column
// ---------------------------------------------------------------------------

function PositionColumn({
  position,
  index,
  debateId,
  generating,
  onGenerateArgs,
  onGenerateCounter,
}: {
  position: DebatePosition;
  index: number;
  debateId: string;
  generating: boolean;
  onGenerateArgs: (debateId: string, positionId: string) => void;
  onGenerateCounter: (debateId: string, positionId: string) => void;
}) {
  const color = getPositionColor(index);
  const hasArgs = position.arguments.length > 0;
  const hasCounters = position.counterarguments.length > 0;

  return (
    <div
      className={`flex flex-col rounded-lg border overflow-hidden ${color.bg} ${color.border}`}
    >
      {/* Column header */}
      <div className={`px-3 py-2.5 border-b ${color.border} flex items-center justify-between`}>
        <div className="flex items-center gap-2 min-w-0">
          <div className={`w-2 h-2 rounded-full ${color.accent} flex-shrink-0`} />
          <span className={`text-xs font-medium ${color.text} truncate`}>
            {position.perspective}
          </span>
        </div>
      </div>

      {/* Strength meter */}
      {position.strength > 0 && (
        <div className="px-3 pt-2">
          <StrengthMeter value={position.strength} color={color.accent} />
        </div>
      )}

      {/* Arguments */}
      <div className="px-3 py-2 flex-1 overflow-y-auto max-h-[320px] space-y-3">
        {hasArgs && (
          <div>
            <p className="text-2xs font-medium text-blade-secondary uppercase tracking-wider mb-1.5">
              Arguments
            </p>
            <ul className="space-y-1.5">
              {position.arguments.map((arg, i) => (
                <li
                  key={i}
                  className="text-xs text-blade-text leading-relaxed pl-3 border-l-2 border-blade-border"
                >
                  {arg}
                </li>
              ))}
            </ul>
          </div>
        )}

        {hasCounters && (
          <div>
            <p className="text-2xs font-medium text-red-400/80 uppercase tracking-wider mb-1.5">
              Counterarguments
            </p>
            <ul className="space-y-1.5">
              {position.counterarguments.map((counter, i) => (
                <li
                  key={i}
                  className="text-xs text-blade-muted leading-relaxed pl-3 border-l-2 border-red-500/30"
                >
                  {counter}
                </li>
              ))}
            </ul>
          </div>
        )}

        {position.evidence.length > 0 && (
          <div>
            <p className="text-2xs font-medium text-blade-muted uppercase tracking-wider mb-1.5">
              Evidence
            </p>
            <ul className="space-y-1">
              {position.evidence.map((ev, i) => (
                <li key={i} className="text-2xs text-blade-muted italic pl-3 border-l-2 border-blade-border">
                  {ev}
                </li>
              ))}
            </ul>
          </div>
        )}

        {!hasArgs && !generating && (
          <p className="text-2xs text-blade-muted italic py-2">
            No arguments yet. Generate or start the debate.
          </p>
        )}

        {generating && !hasArgs && <LoadingDots />}
      </div>

      {/* Action buttons */}
      <div className="px-3 py-2 border-t border-blade-border/50 flex gap-1.5">
        <button
          onClick={() => onGenerateArgs(debateId, position.id)}
          disabled={generating}
          className={`flex-1 px-2 py-1.5 rounded text-2xs font-medium transition-all ${
            generating
              ? "bg-blade-surface-hover text-blade-muted cursor-not-allowed"
              : `${color.bg} ${color.text} hover:brightness-110`
          }`}
        >
          {hasArgs ? "Regenerate" : "Generate"} Args
        </button>
        <button
          onClick={() => onGenerateCounter(debateId, position.id)}
          disabled={generating || !hasArgs}
          className={`flex-1 px-2 py-1.5 rounded text-2xs font-medium transition-all ${
            generating || !hasArgs
              ? "bg-blade-surface-hover text-blade-muted cursor-not-allowed"
              : "bg-red-500/10 text-red-400 hover:bg-red-500/20"
          }`}
        >
          Counter
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Summary panel
// ---------------------------------------------------------------------------

function SummaryPanel({
  debate,
  onSendToChat,
}: {
  debate: Debate;
  onSendToChat: (prompt: string) => void;
}) {
  if (!debate.summary) return null;

  const handleSend = () => {
    const prompt = `Here is a "${debate.frameworkId}" analysis on "${debate.topic}":\n\n${debate.summary}\n\nPlease expand on this analysis and provide additional insights.`;
    onSendToChat(prompt);
  };

  return (
    <div className="bg-blade-surface rounded-lg border border-blade-border overflow-hidden animate-fade-in">
      <div className="px-4 py-3 border-b border-blade-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <svg
            viewBox="0 0 24 24"
            className="w-4 h-4 text-blade-accent"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M9 12l2 2 4-4" />
            <circle cx="12" cy="12" r="10" />
          </svg>
          <span className="text-xs font-medium text-blade-text">Analysis Summary</span>
        </div>
        {debate.winner && (
          <span className="text-2xs px-2 py-0.5 rounded-full bg-green-500/15 text-green-400 font-medium">
            Strongest: {debate.winner}
          </span>
        )}
      </div>

      <div className="px-4 py-3">
        <div className="text-xs text-blade-secondary leading-relaxed whitespace-pre-wrap">
          {debate.summary}
        </div>
      </div>

      <div className="px-4 py-2.5 border-t border-blade-border flex items-center justify-end gap-2">
        <button
          onClick={handleSend}
          className="px-3 py-1.5 rounded-lg text-2xs font-medium bg-blade-accent hover:bg-blade-accent-hover text-white transition-colors"
        >
          Send to Chat
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Debate history item
// ---------------------------------------------------------------------------

function DebateHistoryItem({
  debate,
  onLoad,
  onDelete,
}: {
  debate: Debate;
  onLoad: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const date = new Date(debate.createdAt);
  const timeStr = date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  const posCount = debate.positions.length;
  const argCount = debate.positions.reduce((sum, p) => sum + p.arguments.length, 0);

  return (
    <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-blade-surface border border-blade-border hover:border-blade-border-hover hover:bg-blade-surface-hover transition-colors group">
      <button
        onClick={() => onLoad(debate.id)}
        className="flex-1 text-left min-w-0"
      >
        <div className="flex items-center gap-2">
          <p className="text-xs text-blade-text truncate flex-1">{debate.topic}</p>
          <StatusBadge status={debate.status} />
        </div>
        <div className="flex items-center gap-2 mt-1">
          <span className="text-2xs text-blade-muted">{debate.frameworkId}</span>
          <span className="text-2xs text-blade-muted">{posCount} positions</span>
          <span className="text-2xs text-blade-muted">{argCount} args</span>
          <span className="text-2xs text-blade-muted ml-auto">{timeStr}</span>
        </div>
        {debate.winner && (
          <p className="text-2xs text-green-400 mt-1">Winner: {debate.winner}</p>
        )}
      </button>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onDelete(debate.id);
        }}
        className="p-1 rounded text-blade-muted hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all flex-shrink-0"
        title="Delete debate"
      >
        <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2" />
        </svg>
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface Props {
  onBack: () => void;
  onSendToChat: (prompt: string) => void;
}

export function DebatePanel({ onBack, onSendToChat }: Props) {
  const {
    debates,
    activeDebate,
    generating,
    createDebate,
    addPosition,
    generateArguments,
    generateCounterarguments,
    generateSummary,
    startDebate,
    loadDebate,
    deleteDebate,
    clearActive,
    frameworks,
  } = useDebate();

  const [topic, setTopic] = useState("");
  const [selectedFramework, setSelectedFramework] = useState<string>("pro-con");
  const [view, setView] = useState<"create" | "active" | "history">(
    activeDebate ? "active" : "create"
  );
  const [historyOpen, setHistoryOpen] = useState(false);
  const [customPerspective, setCustomPerspective] = useState("");

  const currentFramework = useMemo(
    () => frameworks.find((f) => f.id === selectedFramework),
    [frameworks, selectedFramework]
  );

  // Grid class based on position count
  const positionCount = activeDebate?.positions.length ?? 0;
  const gridClass = useMemo(() => {
    if (positionCount <= 2) return "grid-cols-1 sm:grid-cols-2";
    if (positionCount === 3) return "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3";
    if (positionCount === 4) return "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4";
    return "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3";
  }, [positionCount]);

  const handleCreate = useCallback(() => {
    if (!topic.trim() || !selectedFramework) return;
    createDebate(topic.trim(), selectedFramework);
    setTopic("");
    setView("active");
  }, [topic, selectedFramework, createDebate]);

  const handleStartAll = useCallback(() => {
    if (!activeDebate) return;
    startDebate(activeDebate.id);
  }, [activeDebate, startDebate]);

  const handleSummarize = useCallback(() => {
    if (!activeDebate) return;
    generateSummary(activeDebate.id);
  }, [activeDebate, generateSummary]);

  const handleAddPosition = useCallback(() => {
    if (!activeDebate || !customPerspective.trim()) return;
    addPosition(activeDebate.id, customPerspective.trim());
    setCustomPerspective("");
  }, [activeDebate, customPerspective, addPosition]);

  const handleLoadDebate = useCallback(
    (id: string) => {
      loadDebate(id);
      setView("active");
    },
    [loadDebate]
  );

  const handleNewDebate = useCallback(() => {
    clearActive();
    setView("create");
  }, [clearActive]);

  const hasAnyArguments = activeDebate?.positions.some((p) => p.arguments.length > 0) ?? false;

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-6xl mx-auto px-4 py-6 space-y-5 animate-fade-in">
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
          <div className="flex-1">
            <h1 className="text-base font-semibold text-blade-text">
              Debate & Analysis
            </h1>
            <p className="text-2xs text-blade-muted">
              Explore ideas through multi-perspective AI argumentation
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={handleNewDebate}
              className={`px-3 py-1.5 rounded-lg text-2xs font-medium transition-all ${
                view === "create"
                  ? "bg-blade-accent-muted text-blade-accent"
                  : "text-blade-secondary hover:text-blade-text hover:bg-blade-surface-hover"
              }`}
            >
              New
            </button>
            {activeDebate && (
              <button
                onClick={() => setView("active")}
                className={`px-3 py-1.5 rounded-lg text-2xs font-medium transition-all ${
                  view === "active"
                    ? "bg-blade-accent-muted text-blade-accent"
                    : "text-blade-secondary hover:text-blade-text hover:bg-blade-surface-hover"
                }`}
              >
                Active
              </button>
            )}
          </div>
        </div>

        {/* -------- Create View -------- */}
        {view === "create" && (
          <div className="space-y-4 animate-fade-in">
            {/* Topic input */}
            <div className="bg-blade-surface rounded-lg border border-blade-border p-4 space-y-3">
              <label className="text-xs font-medium text-blade-secondary uppercase tracking-wider">
                Topic
              </label>
              <input
                type="text"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && topic.trim()) handleCreate();
                }}
                placeholder="e.g. Should we rewrite the backend in Rust?"
                className="w-full bg-blade-bg border border-blade-border rounded-lg px-3 py-2.5 text-sm text-blade-text placeholder-blade-muted focus:outline-none focus:border-blade-accent/50 focus:ring-1 focus:ring-blade-accent/25 transition-colors"
              />
            </div>

            {/* Framework selector */}
            <div className="bg-blade-surface rounded-lg border border-blade-border p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-xs font-medium text-blade-secondary uppercase tracking-wider">
                  Analysis Framework
                </h2>
                {currentFramework && (
                  <span className="text-2xs text-blade-muted">
                    {currentFramework.perspectives.length} perspectives
                  </span>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
                {frameworks.map((fw) => (
                  <FrameworkCard
                    key={fw.id}
                    framework={fw}
                    selected={selectedFramework === fw.id}
                    onSelect={() => setSelectedFramework(fw.id)}
                  />
                ))}
              </div>
            </div>

            {/* Create button */}
            <div className="flex items-center justify-between">
              <p className="text-2xs text-blade-muted">
                {topic.trim()
                  ? `"${topic.trim().slice(0, 60)}${topic.trim().length > 60 ? "..." : ""}" with ${currentFramework?.name ?? "selected framework"}`
                  : "Enter a topic to begin"}
              </p>
              <button
                onClick={handleCreate}
                disabled={!topic.trim()}
                className={`px-5 py-2.5 rounded-lg text-xs font-medium transition-all ${
                  topic.trim()
                    ? "bg-blade-accent hover:bg-blade-accent-hover text-white shadow-sm shadow-blade-accent/20"
                    : "bg-blade-surface-hover text-blade-muted cursor-not-allowed"
                }`}
              >
                Create Debate
              </button>
            </div>
          </div>
        )}

        {/* -------- Active Debate View -------- */}
        {view === "active" && activeDebate && (
          <div className="space-y-4 animate-fade-in">
            {/* Topic header */}
            <div className="bg-blade-surface rounded-lg border border-blade-border px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <FrameworkIcon
                      icon={
                        frameworks.find((f) => f.id === activeDebate.frameworkId)?.icon ?? "grid"
                      }
                      className="w-4 h-4 text-blade-accent flex-shrink-0"
                    />
                    <h2 className="text-sm font-medium text-blade-text truncate">
                      {activeDebate.topic}
                    </h2>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-2xs text-blade-muted">
                      {frameworks.find((f) => f.id === activeDebate.frameworkId)?.name}
                    </span>
                    <span className="text-2xs text-blade-muted">
                      {activeDebate.positions.length} positions
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <StatusBadge status={activeDebate.status} />
                </div>
              </div>
            </div>

            {/* Action bar */}
            <div className="flex items-center gap-2">
              <button
                onClick={handleStartAll}
                disabled={generating}
                className={`px-4 py-2 rounded-lg text-xs font-medium transition-all flex items-center gap-2 ${
                  generating
                    ? "bg-blade-surface-hover text-blade-muted cursor-not-allowed"
                    : "bg-blade-accent hover:bg-blade-accent-hover text-white shadow-sm shadow-blade-accent/20"
                }`}
              >
                {generating ? (
                  <>
                    <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none">
                      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
                      <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                    </svg>
                    Generating...
                  </>
                ) : (
                  "Generate All Arguments"
                )}
              </button>

              <button
                onClick={handleSummarize}
                disabled={generating || !hasAnyArguments}
                className={`px-4 py-2 rounded-lg text-xs font-medium transition-all ${
                  generating || !hasAnyArguments
                    ? "bg-blade-surface-hover text-blade-muted cursor-not-allowed"
                    : "bg-blade-surface border border-blade-border hover:border-blade-accent/40 text-blade-secondary hover:text-blade-accent"
                }`}
              >
                Summarize & Verdict
              </button>

              <div className="flex-1" />

              {/* Add custom perspective */}
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  value={customPerspective}
                  onChange={(e) => setCustomPerspective(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleAddPosition();
                  }}
                  placeholder="Add perspective..."
                  className="w-36 bg-blade-bg border border-blade-border rounded-lg px-2 py-1.5 text-2xs text-blade-text placeholder-blade-muted focus:outline-none focus:border-blade-accent/50 transition-colors"
                />
                <button
                  onClick={handleAddPosition}
                  disabled={!customPerspective.trim()}
                  className={`p-1.5 rounded-lg transition-colors ${
                    customPerspective.trim()
                      ? "text-blade-accent hover:bg-blade-accent-muted"
                      : "text-blade-muted cursor-not-allowed"
                  }`}
                  title="Add perspective"
                >
                  <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Position columns */}
            <div className={`grid gap-3 ${gridClass}`}>
              {activeDebate.positions.map((position, index) => (
                <PositionColumn
                  key={position.id}
                  position={position}
                  index={index}
                  debateId={activeDebate.id}
                  generating={generating}
                  onGenerateArgs={generateArguments}
                  onGenerateCounter={generateCounterarguments}
                />
              ))}
            </div>

            {/* Summary panel */}
            {activeDebate.summary && (
              <SummaryPanel debate={activeDebate} onSendToChat={onSendToChat} />
            )}

            {/* Quick stats */}
            {hasAnyArguments && (
              <div className="bg-blade-surface rounded-lg border border-blade-border px-4 py-3">
                <p className="text-2xs text-blade-muted mb-2 uppercase tracking-wider font-medium">
                  Position Strengths
                </p>
                <div className="space-y-2">
                  {activeDebate.positions
                    .filter((p) => p.strength > 0)
                    .sort((a, b) => b.strength - a.strength)
                    .map((p, i) => {
                      const color = getPositionColor(
                        activeDebate.positions.findIndex((pos) => pos.id === p.id)
                      );
                      return (
                        <div key={p.id} className="flex items-center gap-3">
                          {i === 0 && (
                            <span className="text-2xs px-1.5 py-0.5 rounded bg-green-500/15 text-green-400 flex-shrink-0">
                              leading
                            </span>
                          )}
                          {i > 0 && <span className="w-[52px]" />}
                          <span className={`text-xs ${color.text} w-40 truncate flex-shrink-0`}>
                            {p.perspective}
                          </span>
                          <div className="flex-1">
                            <StrengthMeter value={p.strength} color={color.accent} />
                          </div>
                          <span className="text-2xs text-blade-muted flex-shrink-0">
                            {p.arguments.length} args / {p.counterarguments.length} counters
                          </span>
                        </div>
                      );
                    })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* -------- Debate History -------- */}
        {debates.length > 0 && (
          <div className="bg-blade-surface rounded-lg border border-blade-border overflow-hidden">
            <button
              onClick={() => setHistoryOpen((p) => !p)}
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-blade-surface-hover transition-colors"
            >
              <span className="text-xs font-medium text-blade-secondary uppercase tracking-wider">
                Debate History ({debates.length})
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
                {debates.map((debate) => (
                  <DebateHistoryItem
                    key={debate.id}
                    debate={debate}
                    onLoad={handleLoadDebate}
                    onDelete={deleteDebate}
                  />
                ))}
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
