import { useRef, useState, KeyboardEvent } from "react";
import { useAgents } from "../hooks/useAgents";
import { Agent } from "../types";
import { AgentDetail } from "./AgentDetail";

// ── Status badge ───────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<
  Agent["status"],
  { label: string; dot: string; text: string }
> = {
  Planning: {
    label: "Planning",
    dot: "bg-amber-400 animate-pulse",
    text: "text-amber-400",
  },
  Executing: {
    label: "Executing",
    dot: "bg-[#6366f1] animate-pulse",
    text: "text-[#6366f1]",
  },
  WaitingApproval: {
    label: "Waiting",
    dot: "bg-amber-400",
    text: "text-amber-400",
  },
  Paused: {
    label: "Paused",
    dot: "bg-[#666]",
    text: "text-[#666]",
  },
  Completed: {
    label: "Completed",
    dot: "bg-emerald-400",
    text: "text-emerald-400",
  },
  Failed: {
    label: "Failed",
    dot: "bg-red-400",
    text: "text-red-400",
  },
};

function StatusBadge({ status }: { status: Agent["status"] }) {
  const cfg = STATUS_CONFIG[status];
  return (
    <span className={`flex items-center gap-1.5 text-xs ${cfg.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${cfg.dot}`} />
      {cfg.label}
    </span>
  );
}

// ── Time helper ────────────────────────────────────────────────────────────────

function relativeTime(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

// ── Agent row ──────────────────────────────────────────────────────────────────

interface AgentRowProps {
  agent: Agent;
  expanded: boolean;
  onToggle: () => void;
  onPause: () => void;
  onResume: () => void;
  onCancel: () => void;
  onApproveDesktopAction: () => void;
  onDenyDesktopAction: () => void;
}

function AgentRow({
  agent,
  expanded,
  onToggle,
  onPause,
  onResume,
  onCancel,
  onApproveDesktopAction,
  onDenyDesktopAction,
}: AgentRowProps) {
  const completedSteps = agent.steps.filter((s) => s.status === "Completed").length;
  const totalSteps = agent.steps.length;
  const isDesktopAgent = agent.context?.mode === "desktop_control";
  const desktopExecutionMode = agent.context?.execution_mode ?? "supervised";

  return (
    <div
      className={`rounded-xl border transition-all duration-200 overflow-hidden ${
        expanded
          ? "border-[#6366f1]/30 bg-[#111]"
          : "border-[#1f1f1f] bg-[#111] hover:border-[#2a2a2a]"
      }`}
    >
      {/* Header row — always visible */}
      <button
        className="w-full flex items-center gap-3 px-4 py-3 text-left"
        onClick={onToggle}
      >
        {/* Chevron */}
        <svg
          viewBox="0 0 16 16"
          className={`w-3.5 h-3.5 text-[#666] flex-shrink-0 transition-transform duration-200 ${
            expanded ? "rotate-90" : ""
          }`}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
        >
          <path d="M6 4l4 4-4 4" />
        </svg>

        {/* Goal */}
        <div className="flex-1 min-w-0">
          <p className="text-sm text-[#e5e5e5] truncate leading-snug">{agent.goal}</p>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-xs text-[#444]">{relativeTime(agent.created_at)}</span>
            {isDesktopAgent && (
              <>
                <span className="text-[#2a2a2a]">·</span>
                <span className="text-[10px] uppercase tracking-[0.18em] text-[#6366f1]">
                  {desktopExecutionMode === "auto" ? "desktop auto" : "desktop beta"}
                </span>
              </>
            )}
            {totalSteps > 0 && (
              <>
                <span className="text-[#2a2a2a]">·</span>
                <span className="text-xs text-[#444]">
                  {completedSteps}/{totalSteps} steps
                </span>
              </>
            )}
          </div>
        </div>

        {/* Status */}
        <StatusBadge status={agent.status} />
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div className="border-t border-[#1f1f1f] animate-fade-in">
          <AgentDetail
            agent={agent}
            onPause={onPause}
            onResume={onResume}
            onCancel={onCancel}
            onApproveDesktopAction={onApproveDesktopAction}
            onDenyDesktopAction={onDenyDesktopAction}
          />
        </div>
      )}
    </div>
  );
}

// ── Empty state ────────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-3">
      <div className="w-10 h-10 rounded-xl bg-[#111] border border-[#1f1f1f] flex items-center justify-center">
        <svg viewBox="0 0 24 24" className="w-5 h-5 text-[#444]" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M12 2a10 10 0 100 20A10 10 0 0012 2z" />
          <path d="M12 8v4l3 3" />
        </svg>
      </div>
      <p className="text-sm text-[#666] text-center leading-relaxed">
        No agents running yet.<br />Describe a goal and let Blade break it down.
      </p>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export function AgentManager({ onBack }: { onBack?: () => void }) {
  const { agents, creating, error, dismissError, createAgent, createDesktopAgent, respondDesktopAction, pauseAgent, resumeAgent, cancelAgent, refresh } =
    useAgents();

  const [goal, setGoal] = useState("");
  const [desktopExecutionMode, setDesktopExecutionMode] = useState<"supervised" | "auto">("supervised");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleKeyDown = async (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter" || creating || !goal.trim()) return;
    e.preventDefault();
    const trimmed = goal.trim();
    setGoal("");
    const id = await createAgent(trimmed);
    if (id) {
      setExpandedId(id);
    }
  };

  const handleCreateDesktopAgent = async () => {
    if (creating || !goal.trim()) return;
    const trimmed = goal.trim();
    setGoal("");
    const id = await createDesktopAgent(trimmed, 8, desktopExecutionMode);
    if (id) {
      setExpandedId(id);
    }
  };

  const toggleExpand = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  return (
    <div className="flex flex-col h-full bg-[#09090b]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b border-[#1f1f1f] flex-shrink-0">
        <div className="flex items-center gap-3">
          {onBack ? (
            <button
              onClick={onBack}
              className="text-[#666] hover:text-[#e5e5e5] text-xs transition-colors"
            >
              ← back
            </button>
          ) : null}
          <div>
            <h2 className="text-sm font-semibold text-[#e5e5e5]">Agents</h2>
            <p className="text-xs text-[#666] mt-0.5">
              {agents.length > 0 ? `${agents.length} agent${agents.length !== 1 ? "s" : ""}` : "No agents"}
            </p>
          </div>
        </div>
        <button
          onClick={refresh}
          className="w-7 h-7 rounded-lg flex items-center justify-center text-[#666] hover:text-[#e5e5e5] hover:bg-[#1f1f1f] transition-colors"
          title="Refresh"
        >
          <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.75">
            <path d="M13.5 8A5.5 5.5 0 112.5 8" />
            <path d="M13.5 4v4h-4" />
          </svg>
        </button>
      </div>

      {/* Create input */}
      <div className="px-4 py-3 border-b border-[#1f1f1f] flex-shrink-0">
        <div
          className={`flex items-center gap-2.5 rounded-xl border px-3 py-2.5 transition-colors ${
            creating
              ? "border-[#6366f1]/40 bg-[#111]"
              : "border-[#1f1f1f] bg-[#111] focus-within:border-[#6366f1]/40"
          }`}
        >
          {creating ? (
            <span className="w-4 h-4 flex-shrink-0 rounded-full border-2 border-[#6366f1] border-t-transparent animate-spin" />
          ) : (
            <svg viewBox="0 0 16 16" className="w-4 h-4 text-[#444] flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="1.75">
              <path d="M8 3v10M3 8h10" />
            </svg>
          )}
          <input
            ref={inputRef}
            type="text"
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Describe a goal for the agent..."
            disabled={creating}
            className="flex-1 bg-transparent text-sm text-[#e5e5e5] placeholder-[#444] outline-none disabled:opacity-50"
          />
          {goal.trim() && !creating && (
            <kbd className="text-xs text-[#444] border border-[#2a2a2a] rounded px-1 py-0.5 flex-shrink-0">
              Enter
            </kbd>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 mt-2">
          <div className="flex items-center gap-1 p-0.5 rounded-md border border-[#1f1f1f] bg-[#0d0d0f]">
            <button
              onClick={() => setDesktopExecutionMode("supervised")}
              className={`text-2xs px-2 py-1 rounded ${
                desktopExecutionMode === "supervised"
                  ? "bg-[#1a1a1f] text-[#e5e5e5]"
                  : "text-[#666] hover:text-[#e5e5e5]"
              } transition-colors`}
            >
              Supervised
            </button>
            <button
              onClick={() => setDesktopExecutionMode("auto")}
              className={`text-2xs px-2 py-1 rounded ${
                desktopExecutionMode === "auto"
                  ? "bg-[#1a1a1f] text-[#e5e5e5]"
                  : "text-[#666] hover:text-[#e5e5e5]"
              } transition-colors`}
            >
              Auto
            </button>
          </div>
          <button
            onClick={handleCreateDesktopAgent}
            disabled={creating || !goal.trim()}
            className="text-2xs px-2.5 py-1 rounded-md bg-[#6366f1]/10 text-[#818cf8] border border-[#6366f1]/20 hover:bg-[#6366f1]/15 transition-colors disabled:opacity-40"
          >
            Start desktop control
          </button>
          <span className="text-2xs text-[#666]">
            {desktopExecutionMode === "supervised"
              ? "Blade will capture the screen, propose one UI action at a time, and wait for your approval."
              : "Blade will capture the screen, choose one UI action at a time, and execute it automatically unless the action looks risky."}
          </span>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="mx-4 mt-3 flex-shrink-0 flex items-start gap-2.5 rounded-xl bg-red-500/8 border border-red-500/20 px-3 py-2.5">
          <svg viewBox="0 0 16 16" className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" strokeWidth="1.75">
            <circle cx="8" cy="8" r="6.5" />
            <path d="M8 5v3.5M8 11v.5" />
          </svg>
          <p className="text-xs text-red-400 flex-1 leading-relaxed">{error}</p>
          <button onClick={dismissError} className="text-red-400/60 hover:text-red-400 transition-colors flex-shrink-0">
            <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.75">
              <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />
            </svg>
          </button>
        </div>
      )}

      {/* Agent list */}
      <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-2">
        {agents.length === 0 ? (
          <EmptyState />
        ) : (
          agents.map((agent) => (
            <AgentRow
              key={agent.id}
              agent={agent}
              expanded={expandedId === agent.id}
              onToggle={() => toggleExpand(agent.id)}
              onPause={() => pauseAgent(agent.id)}
              onResume={() => resumeAgent(agent.id)}
              onCancel={() => cancelAgent(agent.id)}
              onApproveDesktopAction={() => respondDesktopAction(agent.id, true)}
              onDenyDesktopAction={() => respondDesktopAction(agent.id, false)}
            />
          ))
        )}
      </div>
    </div>
  );
}

export default AgentManager;
