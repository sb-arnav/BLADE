import { useState, useRef, useEffect } from "react";
import type { WorkflowStep as WorkflowStepType } from "../hooks/useWorkflows";

// ── Props ──────────────────────────────────────────────────────────────────────

interface WorkflowStepProps {
  step: WorkflowStepType;
  index: number;
  isActive: boolean;
  output?: string;
  onEdit: (step: WorkflowStepType) => void;
  onDelete: () => void;
  onMove: (direction: "up" | "down") => void;
  isFirst?: boolean;
  isLast?: boolean;
}

// ── Step type metadata ─────────────────────────────────────────────────────────

const STEP_ICONS: Record<WorkflowStepType["type"], string> = {
  prompt: "\u{1F4AC}",
  condition: "\u{1F500}",
  transform: "\u2699\uFE0F",
  output: "\u{1F4E4}",
  loop: "\u{1F504}",
  mcp_tool: "\u{1F527}",
};

const STEP_TYPE_LABELS: Record<WorkflowStepType["type"], string> = {
  prompt: "Prompt",
  condition: "Condition",
  transform: "Transform",
  output: "Output",
  loop: "Loop",
  mcp_tool: "MCP Tool",
};

const STEP_TYPE_COLORS: Record<WorkflowStepType["type"], string> = {
  prompt: "bg-indigo-500/15 text-indigo-400 border-indigo-500/30",
  condition: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  transform: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  output: "bg-cyan-500/15 text-cyan-400 border-cyan-500/30",
  loop: "bg-purple-500/15 text-purple-400 border-purple-500/30",
  mcp_tool: "bg-rose-500/15 text-rose-400 border-rose-500/30",
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function getConfigPreview(step: WorkflowStepType): string {
  switch (step.type) {
    case "prompt":
      return step.config.prompt
        ? step.config.prompt.slice(0, 120) + (step.config.prompt.length > 120 ? "..." : "")
        : "No prompt configured";
    case "condition":
      return step.config.condition || "No condition set";
    case "transform":
      return step.config.operation
        ? `Operation: ${step.config.operation}`
        : "No operation set";
    case "output":
      return step.config.destination
        ? `Destination: ${step.config.destination}`
        : "No destination set";
    case "loop":
      return `Max ${step.config.maxIterations || 3} iterations`;
    case "mcp_tool":
      return step.config.toolName
        ? `Tool: ${step.config.toolName}`
        : "No tool configured";
    default:
      return "";
  }
}

// ── Component ──────────────────────────────────────────────────────────────────

export function WorkflowStepCard({
  step,
  index,
  isActive,
  output,
  onEdit,
  onDelete,
  onMove,
  isFirst = false,
  isLast = false,
}: WorkflowStepProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [outputExpanded, setOutputExpanded] = useState(false);
  const [isEditingLabel, setIsEditingLabel] = useState(false);
  const [editLabel, setEditLabel] = useState(step.label);
  const labelInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditingLabel && labelInputRef.current) {
      labelInputRef.current.focus();
      labelInputRef.current.select();
    }
  }, [isEditingLabel]);

  const handleLabelSubmit = () => {
    const trimmed = editLabel.trim();
    if (trimmed && trimmed !== step.label) {
      onEdit({ ...step, label: trimmed });
    } else {
      setEditLabel(step.label);
    }
    setIsEditingLabel(false);
  };

  const handleLabelKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleLabelSubmit();
    } else if (e.key === "Escape") {
      setEditLabel(step.label);
      setIsEditingLabel(false);
    }
  };

  const configPreview = getConfigPreview(step);
  const typeColor = STEP_TYPE_COLORS[step.type];
  const icon = STEP_ICONS[step.type];

  return (
    <div className="relative">
      {/* Vertical connector line (before this step) */}
      {!isFirst && (
        <div className="absolute left-6 -top-4 w-px h-4 bg-blade-border" />
      )}

      {/* Step card */}
      <div
        className={`
          relative group rounded-xl border transition-all duration-200
          ${isActive
            ? "bg-blade-surface border-blade-accent shadow-lg shadow-blade-accent/10 ring-1 ring-blade-accent/30"
            : "bg-blade-surface border-blade-border hover:border-blade-border-hover"
          }
        `}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        {/* Active pulse indicator */}
        {isActive && (
          <div className="absolute -left-px top-1/2 -translate-y-1/2 w-1 h-8 rounded-r-full bg-blade-accent animate-pulse" />
        )}

        <div className="p-3.5">
          {/* Top row: badge + label + actions */}
          <div className="flex items-start gap-3">
            {/* Step number + type icon */}
            <div className="flex flex-col items-center gap-1 flex-shrink-0">
              <div
                className={`
                  w-8 h-8 rounded-lg flex items-center justify-center text-sm border
                  ${typeColor}
                `}
              >
                {icon}
              </div>
              <span className="text-2xs text-blade-muted font-mono">
                #{index + 1}
              </span>
            </div>

            {/* Label + type + preview */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                {isEditingLabel ? (
                  <input
                    ref={labelInputRef}
                    type="text"
                    value={editLabel}
                    onChange={(e) => setEditLabel(e.target.value)}
                    onBlur={handleLabelSubmit}
                    onKeyDown={handleLabelKeyDown}
                    className="text-sm font-medium text-blade-text bg-blade-bg border border-blade-border rounded px-1.5 py-0.5 outline-none focus:border-blade-accent w-full"
                  />
                ) : (
                  <h4
                    className="text-sm font-medium text-blade-text truncate cursor-pointer hover:text-blade-accent-hover transition-colors"
                    onDoubleClick={() => setIsEditingLabel(true)}
                    title="Double-click to rename"
                  >
                    {step.label}
                  </h4>
                )}

                <span
                  className={`
                    text-2xs px-1.5 py-0.5 rounded-full border flex-shrink-0
                    ${typeColor}
                  `}
                >
                  {STEP_TYPE_LABELS[step.type]}
                </span>
              </div>

              {/* Config preview */}
              <p className="text-2xs text-blade-muted leading-relaxed line-clamp-2 break-words">
                {configPreview}
              </p>
            </div>

            {/* Action buttons (visible on hover) */}
            <div
              className={`
                flex flex-col gap-0.5 flex-shrink-0 transition-opacity duration-150
                ${isHovered ? "opacity-100" : "opacity-0"}
              `}
            >
              <button
                onClick={() => onMove("up")}
                disabled={isFirst}
                className="w-6 h-6 rounded flex items-center justify-center text-blade-muted hover:text-blade-text hover:bg-blade-surface-hover disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                title="Move up"
              >
                <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M8 12V4M4 7l4-4 4 4" />
                </svg>
              </button>
              <button
                onClick={() => onMove("down")}
                disabled={isLast}
                className="w-6 h-6 rounded flex items-center justify-center text-blade-muted hover:text-blade-text hover:bg-blade-surface-hover disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                title="Move down"
              >
                <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M8 4v8M4 9l4 4 4-4" />
                </svg>
              </button>
              <button
                onClick={() => onEdit(step)}
                className="w-6 h-6 rounded flex items-center justify-center text-blade-muted hover:text-blade-accent hover:bg-blade-accent-muted transition-colors"
                title="Edit step"
              >
                <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M11 2.5l2.5 2.5M2 14l1-4L11.5 1.5 14 4 5.5 12.5z" />
                </svg>
              </button>
              <button
                onClick={onDelete}
                className="w-6 h-6 rounded flex items-center justify-center text-blade-muted hover:text-red-400 hover:bg-red-400/10 transition-colors"
                title="Delete step"
              >
                <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M4 4l8 8M12 4l-8 8" />
                </svg>
              </button>
            </div>
          </div>

          {/* Output preview (when available) */}
          {output && (
            <div className="mt-2.5 pt-2.5 border-t border-blade-border/50">
              <button
                onClick={() => setOutputExpanded(!outputExpanded)}
                className="flex items-center gap-1.5 text-2xs text-blade-secondary hover:text-blade-text transition-colors w-full text-left"
              >
                <svg
                  viewBox="0 0 16 16"
                  className={`w-3 h-3 transition-transform duration-150 ${outputExpanded ? "rotate-90" : ""}`}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                >
                  <path d="M6 4l4 4-4 4" />
                </svg>
                <span className="font-medium">Output</span>
                <span className="text-blade-muted ml-auto">
                  {output.length > 200
                    ? `${(output.length / 1000).toFixed(1)}k chars`
                    : `${output.length} chars`}
                </span>
              </button>

              {outputExpanded && (
                <div className="mt-2 rounded-lg bg-blade-bg border border-blade-border p-2.5 max-h-48 overflow-y-auto">
                  <pre className="text-2xs text-blade-secondary font-mono whitespace-pre-wrap break-words leading-relaxed">
                    {output.length > 2000
                      ? output.slice(0, 2000) + "\n\n... (truncated)"
                      : output}
                  </pre>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Vertical connector line (after this step) */}
      {!isLast && (
        <div className="absolute left-6 -bottom-4 w-px h-4 bg-blade-border" />
      )}
    </div>
  );
}

// ── Add Step Button (floating between steps) ───────────────────────────────────

interface AddStepButtonProps {
  onAdd: (type: WorkflowStepType["type"]) => void;
}

export function AddStepButton({ onAdd }: AddStepButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [isOpen]);

  const stepTypes: { type: WorkflowStepType["type"]; label: string; icon: string; desc: string }[] = [
    { type: "prompt", label: "Prompt", icon: "\u{1F4AC}", desc: "Send a prompt to the AI model" },
    { type: "condition", label: "Condition", icon: "\u{1F500}", desc: "Branch based on output content" },
    { type: "transform", label: "Transform", icon: "\u2699\uFE0F", desc: "Transform text (uppercase, extract, etc.)" },
    { type: "output", label: "Output", icon: "\u{1F4E4}", desc: "Send result to chat, clipboard, or file" },
    { type: "loop", label: "Loop", icon: "\u{1F504}", desc: "Repeat a step multiple times" },
    { type: "mcp_tool", label: "MCP Tool", icon: "\u{1F527}", desc: "Call an MCP tool with arguments" },
  ];

  return (
    <div className="relative flex justify-center py-2" ref={dropdownRef}>
      {/* Vertical line through the button */}
      <div className="absolute left-6 top-0 bottom-0 w-px bg-blade-border" />

      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`
          relative z-10 w-7 h-7 rounded-full border flex items-center justify-center
          transition-all duration-200
          ${isOpen
            ? "bg-blade-accent border-blade-accent text-white scale-110"
            : "bg-blade-surface border-blade-border text-blade-muted hover:border-blade-accent hover:text-blade-accent hover:bg-blade-accent-muted"
          }
        `}
        title="Add step"
      >
        <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M8 3v10M3 8h10" />
        </svg>
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div className="absolute top-full mt-1 left-1/2 -translate-x-1/2 z-30 w-64 bg-blade-surface border border-blade-border rounded-xl shadow-xl shadow-black/40 overflow-hidden animate-fade-in">
          <div className="px-3 py-2 border-b border-blade-border">
            <span className="text-2xs text-blade-muted font-medium uppercase tracking-wider">
              Add Step
            </span>
          </div>
          {stepTypes.map((st) => (
            <button
              key={st.type}
              onClick={() => {
                onAdd(st.type);
                setIsOpen(false);
              }}
              className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-blade-surface-hover transition-colors text-left"
            >
              <span className="text-base flex-shrink-0">{st.icon}</span>
              <div className="min-w-0">
                <div className="text-sm text-blade-text font-medium">{st.label}</div>
                <div className="text-2xs text-blade-muted truncate">{st.desc}</div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default WorkflowStepCard;
