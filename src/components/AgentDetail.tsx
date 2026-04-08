import { useState } from "react";
import { Agent, AgentStep } from "../types";

// ── Props ──────────────────────────────────────────────────────────────────────

interface AgentDetailProps {
  agent: Agent;
  onPause: () => void;
  onResume: () => void;
  onCancel: () => void;
}

// ── Step status icon ───────────────────────────────────────────────────────────

function StepStatusIcon({ status }: { status: AgentStep["status"] }) {
  if (status === "Completed") {
    return (
      <svg viewBox="0 0 16 16" className="w-4 h-4 text-emerald-400 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="1.75">
        <circle cx="8" cy="8" r="6.5" />
        <path d="M5 8.5l2 2 4-4" />
      </svg>
    );
  }

  if (status === "Failed") {
    return (
      <svg viewBox="0 0 16 16" className="w-4 h-4 text-red-400 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="1.75">
        <circle cx="8" cy="8" r="6.5" />
        <path d="M5.5 5.5l5 5M10.5 5.5l-5 5" />
      </svg>
    );
  }

  if (status === "Running") {
    return (
      <span className="w-4 h-4 flex-shrink-0 flex items-center justify-center">
        <span className="w-3.5 h-3.5 rounded-full border-2 border-[#6366f1] border-t-transparent animate-spin block" />
      </span>
    );
  }

  if (status === "Skipped") {
    return (
      <svg viewBox="0 0 16 16" className="w-4 h-4 text-[#666] flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="1.75">
        <circle cx="8" cy="8" r="6.5" strokeDasharray="2 2" />
        <path d="M6 5.5l4 2.5-4 2.5V5.5z" fill="currentColor" stroke="none" />
      </svg>
    );
  }

  // Pending
  return (
    <span className="w-4 h-4 flex-shrink-0 rounded-full border border-[#1f1f1f] bg-[#111]" />
  );
}

// ── Step row ───────────────────────────────────────────────────────────────────

function StepRow({ step, isLast }: { step: AgentStep; isLast: boolean }) {
  const [resultOpen, setResultOpen] = useState(false);

  const isRunning = step.status === "Running";
  const hasMeta = step.tool_name !== null;

  return (
    <div className="relative flex gap-3">
      {/* Connector line */}
      {!isLast && (
        <div className="absolute left-[7px] top-5 bottom-0 w-px bg-[#1f1f1f]" />
      )}

      {/* Icon column */}
      <div className="relative z-10 mt-0.5">
        <StepStatusIcon status={step.status} />
      </div>

      {/* Content */}
      <div
        className={`flex-1 min-w-0 pb-4 ${
          isRunning
            ? "bg-[#6366f1]/5 -mx-2 px-2 rounded-lg border border-[#6366f1]/20"
            : ""
        }`}
      >
        <p
          className={`text-sm leading-snug ${
            isRunning ? "text-[#e5e5e5]" : step.status === "Pending" ? "text-[#666]" : "text-[#e5e5e5]"
          }`}
        >
          {step.description}
        </p>

        {/* Tool badge */}
        {hasMeta && (
          <span className="inline-block mt-1 text-xs px-1.5 py-0.5 rounded border border-[#1f1f1f] text-[#666] font-mono bg-[#111]">
            {step.tool_name}
          </span>
        )}

        {/* Timing */}
        {step.started_at !== null && step.completed_at !== null && (
          <span className="block mt-1 text-xs text-[#444]">
            {((step.completed_at - step.started_at) / 1000).toFixed(1)}s
          </span>
        )}

        {/* Error inline */}
        {step.status === "Failed" && step.result && (
          <div className="mt-2 rounded-lg bg-red-500/5 border border-red-500/20 px-3 py-2">
            <p className="text-xs text-red-400 font-mono leading-relaxed break-words">
              {step.result}
            </p>
          </div>
        )}

        {/* Result collapsible */}
        {step.status === "Completed" && step.result && (
          <div className="mt-2">
            <button
              onClick={() => setResultOpen((o) => !o)}
              className="flex items-center gap-1.5 text-xs text-[#666] hover:text-[#e5e5e5] transition-colors"
            >
              <svg
                viewBox="0 0 16 16"
                className={`w-3 h-3 transition-transform duration-150 ${resultOpen ? "rotate-90" : ""}`}
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
              >
                <path d="M6 4l4 4-4 4" />
              </svg>
              Result
            </button>

            {resultOpen && (
              <div className="mt-1.5 rounded-lg bg-[#09090b] border border-[#1f1f1f] px-3 py-2 max-h-40 overflow-y-auto animate-fade-in">
                <pre className="text-xs text-[#a1a1aa] font-mono whitespace-pre-wrap break-words leading-relaxed">
                  {step.result.length > 2000
                    ? step.result.slice(0, 2000) + "\n\n... (truncated)"
                    : step.result}
                </pre>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export function AgentDetail({ agent, onPause, onResume, onCancel }: AgentDetailProps) {
  const isActive = agent.status === "Executing" || agent.status === "Planning";
  const isPaused = agent.status === "Paused";
  const isDone = agent.status === "Completed" || agent.status === "Failed";

  const completedCount = agent.steps.filter((s) => s.status === "Completed").length;
  const totalCount = agent.steps.length;

  return (
    <div className="flex flex-col gap-4">
      {/* Goal */}
      <div className="px-4 pt-4">
        <p className="text-xs text-[#666] uppercase tracking-wider font-medium mb-1">Goal</p>
        <p className="text-sm text-[#e5e5e5] leading-relaxed">{agent.goal}</p>
      </div>

      {/* Progress bar */}
      {totalCount > 0 && (
        <div className="px-4">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs text-[#666]">
              {completedCount} / {totalCount} steps
            </span>
            {isActive && (
              <span className="text-xs text-[#6366f1]">Running</span>
            )}
          </div>
          <div className="h-1 rounded-full bg-[#1f1f1f] overflow-hidden">
            <div
              className="h-full rounded-full bg-[#6366f1] transition-all duration-500"
              style={{ width: totalCount > 0 ? `${(completedCount / totalCount) * 100}%` : "0%" }}
            />
          </div>
        </div>
      )}

      {/* Error banner */}
      {agent.status === "Failed" && agent.error && (
        <div className="mx-4 rounded-lg bg-red-500/8 border border-red-500/20 px-3 py-2.5">
          <p className="text-xs text-red-400 leading-relaxed break-words">{agent.error}</p>
        </div>
      )}

      {/* Steps */}
      {agent.steps.length > 0 ? (
        <div className="px-4 pb-2 flex flex-col gap-0">
          {agent.steps.map((step, i) => (
            <StepRow key={step.id} step={step} isLast={i === agent.steps.length - 1} />
          ))}
        </div>
      ) : (
        <div className="px-4 pb-4">
          <p className="text-xs text-[#666] italic">No steps yet — agent is planning.</p>
        </div>
      )}

      {/* Controls */}
      {!isDone && (
        <div className="flex gap-2 px-4 pb-4">
          {isActive && (
            <button
              onClick={onPause}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-[#e5e5e5] bg-[#1f1f1f] hover:bg-[#2a2a2a] border border-[#2a2a2a] hover:border-[#3a3a3a] transition-colors"
            >
              <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="currentColor">
                <rect x="4" y="3" width="3" height="10" rx="1" />
                <rect x="9" y="3" width="3" height="10" rx="1" />
              </svg>
              Pause
            </button>
          )}
          {isPaused && (
            <button
              onClick={onResume}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-[#e5e5e5] bg-[#1f1f1f] hover:bg-[#2a2a2a] border border-[#2a2a2a] hover:border-[#3a3a3a] transition-colors"
            >
              <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="currentColor">
                <path d="M5 3.5l8 4.5-8 4.5V3.5z" />
              </svg>
              Resume
            </button>
          )}
          <button
            onClick={onCancel}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-red-400 bg-red-500/8 hover:bg-red-500/15 border border-red-500/20 hover:border-red-500/35 transition-colors"
          >
            <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.75">
              <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />
            </svg>
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}

export default AgentDetail;
