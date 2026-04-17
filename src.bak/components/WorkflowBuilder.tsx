import { useState, useCallback, useRef, useEffect } from "react";
import { useWorkflows, WorkflowStep } from "../hooks/useWorkflows";
import { WorkflowStepCard, AddStepButton } from "./WorkflowStep";

// ── Props ──────────────────────────────────────────────────────────────────────

interface WorkflowBuilderProps {
  onBack: () => void;
  onRunOutput: (output: string) => void;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function createEmptyStep(type: WorkflowStep["type"], order: number): WorkflowStep {
  const defaults: Record<WorkflowStep["type"], Partial<WorkflowStep["config"]>> = {
    prompt: { prompt: "" },
    condition: { condition: "", trueStepId: "", falseStepId: "" },
    transform: { operation: "trim" },
    output: { destination: "chat" },
    loop: { maxIterations: 3, loopStepId: "" },
    mcp_tool: { toolName: "", arguments: "{}" },
  };

  const labels: Record<WorkflowStep["type"], string> = {
    prompt: "New Prompt",
    condition: "New Condition",
    transform: "New Transform",
    output: "New Output",
    loop: "New Loop",
    mcp_tool: "New MCP Tool",
  };

  return {
    id: crypto.randomUUID(),
    type,
    label: labels[type],
    order,
    config: defaults[type] || {},
  };
}

const TRANSFORM_OPERATIONS = [
  { value: "uppercase", label: "Uppercase" },
  { value: "lowercase", label: "Lowercase" },
  { value: "trim", label: "Trim whitespace" },
  { value: "extract_json", label: "Extract JSON" },
  { value: "split_lines", label: "Number lines" },
  { value: "word_count", label: "Word count" },
  { value: "reverse_lines", label: "Reverse lines" },
  { value: "remove_empty_lines", label: "Remove empty lines" },
  { value: "extract_urls", label: "Extract URLs" },
];

const OUTPUT_DESTINATIONS = [
  { value: "chat", label: "Send to Chat" },
  { value: "clipboard", label: "Copy to Clipboard" },
  { value: "file", label: "Save to File" },
];

// ── Main Component ─────────────────────────────────────────────────────────────

export function WorkflowBuilder({ onBack, onRunOutput }: WorkflowBuilderProps) {
  const {
    workflows,
    addWorkflow,
    updateWorkflow,
    deleteWorkflow,
    duplicateWorkflow,
    runWorkflow,
    activeRun,
    stopRun,
  } = useWorkflows();

  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string | null>(null);
  const [editingStep, setEditingStep] = useState<WorkflowStep | null>(null);
  const [runInput, setRunInput] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newIcon, setNewIcon] = useState("\u{1F916}");
  const [editingName, setEditingName] = useState(false);
  const [editingDesc, setEditingDesc] = useState(false);
  const [showRunInput, setShowRunInput] = useState(false);
  const [sidebarFilter, setSidebarFilter] = useState<"all" | "builtin" | "custom">("all");
  const runInputRef = useRef<HTMLTextAreaElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  const selectedWorkflow = workflows.find((w) => w.id === selectedWorkflowId) || null;

  // Focus run input when shown
  useEffect(() => {
    if (showRunInput && runInputRef.current) {
      runInputRef.current.focus();
    }
  }, [showRunInput]);

  useEffect(() => {
    if (isCreating && nameInputRef.current) {
      nameInputRef.current.focus();
    }
  }, [isCreating]);

  // ── Workflow CRUD ────────────────────────────────────────────────────────────

  const handleCreateWorkflow = useCallback(() => {
    if (!newName.trim()) return;
    const wf = addWorkflow({
      name: newName.trim(),
      description: newDescription.trim(),
      icon: newIcon,
      steps: [],
    });
    setSelectedWorkflowId(wf.id);
    setIsCreating(false);
    setNewName("");
    setNewDescription("");
    setNewIcon("\u{1F916}");
  }, [newName, newDescription, newIcon, addWorkflow]);

  const handleDeleteWorkflow = useCallback(
    (id: string) => {
      if (selectedWorkflowId === id) {
        setSelectedWorkflowId(null);
        setEditingStep(null);
      }
      deleteWorkflow(id);
    },
    [selectedWorkflowId, deleteWorkflow]
  );

  const handleDuplicateWorkflow = useCallback(
    (id: string) => {
      const dup = duplicateWorkflow(id);
      if (dup) setSelectedWorkflowId(dup.id);
    },
    [duplicateWorkflow]
  );

  // ── Step management ──────────────────────────────────────────────────────────

  const handleAddStep = useCallback(
    (type: WorkflowStep["type"], afterIndex?: number) => {
      if (!selectedWorkflow) return;
      const steps = [...selectedWorkflow.steps].sort((a, b) => a.order - b.order);
      const insertAt = afterIndex !== undefined ? afterIndex + 1 : steps.length;
      const newStep = createEmptyStep(type, insertAt);

      // Reorder existing steps
      const updatedSteps = steps.map((s, i) => ({
        ...s,
        order: i < insertAt ? i : i + 1,
      }));
      updatedSteps.splice(insertAt, 0, newStep);

      // Renumber
      const renumbered = updatedSteps.map((s, i) => ({ ...s, order: i }));
      updateWorkflow(selectedWorkflow.id, { steps: renumbered });
      setEditingStep(newStep);
    },
    [selectedWorkflow, updateWorkflow]
  );

  const handleUpdateStep = useCallback(
    (updatedStep: WorkflowStep) => {
      if (!selectedWorkflow) return;
      const steps = selectedWorkflow.steps.map((s) =>
        s.id === updatedStep.id ? updatedStep : s
      );
      updateWorkflow(selectedWorkflow.id, { steps });
      setEditingStep(updatedStep);
    },
    [selectedWorkflow, updateWorkflow]
  );

  const handleDeleteStep = useCallback(
    (stepId: string) => {
      if (!selectedWorkflow) return;
      const steps = selectedWorkflow.steps
        .filter((s) => s.id !== stepId)
        .sort((a, b) => a.order - b.order)
        .map((s, i) => ({ ...s, order: i }));
      updateWorkflow(selectedWorkflow.id, { steps });
      if (editingStep?.id === stepId) setEditingStep(null);
    },
    [selectedWorkflow, updateWorkflow, editingStep]
  );

  const handleMoveStep = useCallback(
    (stepId: string, direction: "up" | "down") => {
      if (!selectedWorkflow) return;
      const steps = [...selectedWorkflow.steps].sort((a, b) => a.order - b.order);
      const idx = steps.findIndex((s) => s.id === stepId);
      if (idx === -1) return;
      const swapIdx = direction === "up" ? idx - 1 : idx + 1;
      if (swapIdx < 0 || swapIdx >= steps.length) return;

      const tempOrder = steps[idx].order;
      steps[idx] = { ...steps[idx], order: steps[swapIdx].order };
      steps[swapIdx] = { ...steps[swapIdx], order: tempOrder };

      updateWorkflow(selectedWorkflow.id, { steps });
    },
    [selectedWorkflow, updateWorkflow]
  );

  // ── Run workflow ─────────────────────────────────────────────────────────────

  const handleRun = useCallback(async () => {
    if (!selectedWorkflow || !runInput.trim()) return;
    setIsRunning(true);
    setShowRunInput(false);

    try {
      const result = await runWorkflow(selectedWorkflow.id, runInput.trim());
      if (result.status === "completed") {
        // Find the last output step's result, or the last step's output
        const sortedSteps = [...selectedWorkflow.steps].sort((a, b) => a.order - b.order);
        const outputStep = sortedSteps.reverse().find((s) => s.type === "output");
        const finalOutput = outputStep
          ? result.stepOutputs[outputStep.id] || ""
          : Object.values(result.stepOutputs).pop() || "";
        if (finalOutput) {
          onRunOutput(finalOutput);
        }
      }
    } catch {
      // Error is captured in activeRun
    } finally {
      setIsRunning(false);
      setRunInput("");
    }
  }, [selectedWorkflow, runInput, runWorkflow, onRunOutput]);

  // ── Filtered workflows ───────────────────────────────────────────────────────

  const filteredWorkflows = workflows.filter((w) => {
    if (sidebarFilter === "builtin") return w.isBuiltIn;
    if (sidebarFilter === "custom") return !w.isBuiltIn;
    return true;
  });

  const builtInCount = workflows.filter((w) => w.isBuiltIn).length;
  const customCount = workflows.filter((w) => !w.isBuiltIn).length;

  // ── Render: Left Sidebar ─────────────────────────────────────────────────────

  const renderSidebar = () => (
    <div className="w-64 flex-shrink-0 border-r border-blade-border bg-blade-bg flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b border-blade-border">
        <div className="flex items-center gap-2 mb-3">
          <button
            onClick={onBack}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-blade-muted hover:text-blade-text hover:bg-blade-surface-hover transition-colors"
            title="Back"
          >
            <svg viewBox="0 0 16 16" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M10 3L5 8l5 5" />
            </svg>
          </button>
          <h2 className="text-sm font-semibold text-blade-text tracking-tight">
            Workflows
          </h2>
        </div>

        <button
          onClick={() => setIsCreating(true)}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-blade-accent hover:bg-blade-accent-hover text-white text-sm font-medium transition-colors"
        >
          <svg viewBox="0 0 16 16" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M8 3v10M3 8h10" />
          </svg>
          Create Workflow
        </button>
      </div>

      {/* Filter tabs */}
      <div className="flex items-center gap-1 px-3 py-2 border-b border-blade-border">
        {(["all", "builtin", "custom"] as const).map((filter) => (
          <button
            key={filter}
            onClick={() => setSidebarFilter(filter)}
            className={`
              flex-1 text-2xs py-1.5 rounded-md font-medium transition-colors
              ${sidebarFilter === filter
                ? "bg-blade-accent-muted text-blade-accent"
                : "text-blade-muted hover:text-blade-secondary hover:bg-blade-surface-hover"
              }
            `}
          >
            {filter === "all" && `All (${workflows.length})`}
            {filter === "builtin" && `Built-in (${builtInCount})`}
            {filter === "custom" && `Custom (${customCount})`}
          </button>
        ))}
      </div>

      {/* Workflow list */}
      <div className="flex-1 overflow-y-auto py-2">
        {filteredWorkflows.length === 0 && (
          <div className="px-4 py-8 text-center">
            <p className="text-2xs text-blade-muted">No workflows yet</p>
          </div>
        )}

        {filteredWorkflows.map((wf) => (
          <button
            key={wf.id}
            onClick={() => {
              setSelectedWorkflowId(wf.id);
              setEditingStep(null);
              setShowRunInput(false);
            }}
            className={`
              w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors group
              ${selectedWorkflowId === wf.id
                ? "bg-blade-accent-muted border-r-2 border-blade-accent"
                : "hover:bg-blade-surface-hover"
              }
            `}
          >
            <span className="text-lg flex-shrink-0">{wf.icon}</span>
            <div className="min-w-0 flex-1">
              <div className="text-sm text-blade-text font-medium truncate">
                {wf.name}
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-2xs text-blade-muted">
                  {wf.steps.length} step{wf.steps.length !== 1 ? "s" : ""}
                </span>
                {wf.runCount > 0 && (
                  <span className="text-2xs text-blade-muted">
                    {wf.runCount} run{wf.runCount !== 1 ? "s" : ""}
                  </span>
                )}
                {wf.isBuiltIn && (
                  <span className="text-2xs px-1.5 py-0.5 rounded bg-blade-accent-muted text-blade-accent">
                    built-in
                  </span>
                )}
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );

  // ── Render: Create Workflow Modal ────────────────────────────────────────────

  const renderCreateModal = () => {
    if (!isCreating) return null;

    const icons = [
      "\u{1F916}", "\u{1F680}", "\u{1F4A1}", "\u{1F50D}", "\u{1F4DD}", "\u{2699}\uFE0F",
      "\u{1F3AF}", "\u{1F4CA}", "\u{1F517}", "\u{1F4E6}", "\u{1F9EA}", "\u{1F525}",
      "\u{1F3A8}", "\u{1F4AC}", "\u{1F5C2}\uFE0F", "\u26A1",
    ];

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
        <div className="w-full max-w-md bg-blade-surface border border-blade-border rounded-2xl shadow-2xl animate-fade-in">
          <div className="p-5 border-b border-blade-border">
            <h3 className="text-base font-semibold text-blade-text">Create New Workflow</h3>
            <p className="text-2xs text-blade-muted mt-1">
              Build a multi-step AI agent that runs automatically.
            </p>
          </div>

          <div className="p-5 space-y-4">
            {/* Icon picker */}
            <div>
              <label className="block text-xs text-blade-secondary font-medium mb-2">Icon</label>
              <div className="flex flex-wrap gap-1.5">
                {icons.map((icon) => (
                  <button
                    key={icon}
                    onClick={() => setNewIcon(icon)}
                    className={`
                      w-9 h-9 rounded-lg flex items-center justify-center text-base transition-all
                      ${newIcon === icon
                        ? "bg-blade-accent-muted border-2 border-blade-accent scale-110"
                        : "bg-blade-bg border border-blade-border hover:border-blade-border-hover"
                      }
                    `}
                  >
                    {icon}
                  </button>
                ))}
              </div>
            </div>

            {/* Name */}
            <div>
              <label className="block text-xs text-blade-secondary font-medium mb-1.5">Name</label>
              <input
                ref={nameInputRef}
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCreateWorkflow()}
                placeholder="My Workflow"
                className="w-full px-3 py-2 rounded-lg bg-blade-bg border border-blade-border text-sm text-blade-text placeholder-blade-muted outline-none focus:border-blade-accent transition-colors"
              />
            </div>

            {/* Description */}
            <div>
              <label className="block text-xs text-blade-secondary font-medium mb-1.5">Description</label>
              <textarea
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                placeholder="What does this workflow do?"
                rows={2}
                className="w-full px-3 py-2 rounded-lg bg-blade-bg border border-blade-border text-sm text-blade-text placeholder-blade-muted outline-none focus:border-blade-accent transition-colors resize-none"
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-blade-border">
            <button
              onClick={() => {
                setIsCreating(false);
                setNewName("");
                setNewDescription("");
                setNewIcon("\u{1F916}");
              }}
              className="px-4 py-2 rounded-lg text-sm text-blade-secondary hover:text-blade-text hover:bg-blade-surface-hover transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleCreateWorkflow}
              disabled={!newName.trim()}
              className="px-4 py-2 rounded-lg text-sm font-medium bg-blade-accent hover:bg-blade-accent-hover text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Create
            </button>
          </div>
        </div>
      </div>
    );
  };

  // ── Render: Step Editor Panel ────────────────────────────────────────────────

  const renderStepEditor = () => {
    if (!editingStep || !selectedWorkflow) return null;

    const step = editingStep;
    const allSteps = [...selectedWorkflow.steps].sort((a, b) => a.order - b.order);

    return (
      <div className="border-t border-blade-border bg-blade-bg p-4 max-h-[40vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-blade-text">
            Edit: {step.label}
          </h3>
          <button
            onClick={() => setEditingStep(null)}
            className="w-6 h-6 rounded flex items-center justify-center text-blade-muted hover:text-blade-text hover:bg-blade-surface-hover transition-colors"
          >
            <svg viewBox="0 0 16 16" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>

        {/* Label */}
        <div className="mb-4">
          <label className="block text-xs text-blade-secondary font-medium mb-1.5">Label</label>
          <input
            type="text"
            value={step.label}
            onChange={(e) => handleUpdateStep({ ...step, label: e.target.value })}
            className="w-full px-3 py-2 rounded-lg bg-blade-surface border border-blade-border text-sm text-blade-text outline-none focus:border-blade-accent transition-colors"
          />
        </div>

        {/* Type-specific config */}
        {step.type === "prompt" && (
          <div>
            <label className="block text-xs text-blade-secondary font-medium mb-1.5">
              Prompt Template
            </label>
            <p className="text-2xs text-blade-muted mb-2">
              Use <code className="px-1 py-0.5 bg-blade-surface rounded text-blade-accent font-mono">{"{{input}}"}</code> for the initial input and{" "}
              <code className="px-1 py-0.5 bg-blade-surface rounded text-blade-accent font-mono">{"{{previous_output}}"}</code> for the previous step's output.
            </p>
            <textarea
              value={step.config.prompt || ""}
              onChange={(e) =>
                handleUpdateStep({
                  ...step,
                  config: { ...step.config, prompt: e.target.value },
                })
              }
              rows={8}
              placeholder="Enter your prompt template..."
              className="w-full px-3 py-2 rounded-lg bg-blade-surface border border-blade-border text-sm text-blade-text font-mono placeholder-blade-muted outline-none focus:border-blade-accent transition-colors resize-y leading-relaxed"
            />
          </div>
        )}

        {step.type === "condition" && (
          <div className="space-y-4">
            <div>
              <label className="block text-xs text-blade-secondary font-medium mb-1.5">
                Condition Expression
              </label>
              <p className="text-2xs text-blade-muted mb-2">
                Format: <code className="px-1 py-0.5 bg-blade-surface rounded text-blade-accent font-mono">contains:keyword1,keyword2</code> or{" "}
                <code className="px-1 py-0.5 bg-blade-surface rounded text-blade-accent font-mono">equals:value</code> or{" "}
                <code className="px-1 py-0.5 bg-blade-surface rounded text-blade-accent font-mono">{"length>100"}</code>
              </p>
              <input
                type="text"
                value={step.config.condition || ""}
                onChange={(e) =>
                  handleUpdateStep({
                    ...step,
                    config: { ...step.config, condition: e.target.value },
                  })
                }
                placeholder="contains:fix,solution"
                className="w-full px-3 py-2 rounded-lg bg-blade-surface border border-blade-border text-sm text-blade-text font-mono placeholder-blade-muted outline-none focus:border-blade-accent transition-colors"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-blade-secondary font-medium mb-1.5">
                  If True, go to
                </label>
                <select
                  value={step.config.trueStepId || ""}
                  onChange={(e) =>
                    handleUpdateStep({
                      ...step,
                      config: { ...step.config, trueStepId: e.target.value },
                    })
                  }
                  className="w-full px-3 py-2 rounded-lg bg-blade-surface border border-blade-border text-sm text-blade-text outline-none focus:border-blade-accent transition-colors"
                >
                  <option value="">Next step</option>
                  {allSteps
                    .filter((s) => s.id !== step.id)
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        #{s.order + 1} {s.label}
                      </option>
                    ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-blade-secondary font-medium mb-1.5">
                  If False, go to
                </label>
                <select
                  value={step.config.falseStepId || ""}
                  onChange={(e) =>
                    handleUpdateStep({
                      ...step,
                      config: { ...step.config, falseStepId: e.target.value },
                    })
                  }
                  className="w-full px-3 py-2 rounded-lg bg-blade-surface border border-blade-border text-sm text-blade-text outline-none focus:border-blade-accent transition-colors"
                >
                  <option value="">Next step</option>
                  {allSteps
                    .filter((s) => s.id !== step.id)
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        #{s.order + 1} {s.label}
                      </option>
                    ))}
                </select>
              </div>
            </div>
          </div>
        )}

        {step.type === "transform" && (
          <div>
            <label className="block text-xs text-blade-secondary font-medium mb-1.5">
              Operation
            </label>
            <div className="grid grid-cols-3 gap-2">
              {TRANSFORM_OPERATIONS.map((op) => (
                <button
                  key={op.value}
                  onClick={() =>
                    handleUpdateStep({
                      ...step,
                      config: { ...step.config, operation: op.value },
                    })
                  }
                  className={`
                    px-3 py-2 rounded-lg text-xs font-medium border transition-colors text-center
                    ${step.config.operation === op.value
                      ? "bg-blade-accent-muted border-blade-accent text-blade-accent"
                      : "bg-blade-surface border-blade-border text-blade-secondary hover:border-blade-border-hover hover:text-blade-text"
                    }
                  `}
                >
                  {op.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {step.type === "output" && (
          <div>
            <label className="block text-xs text-blade-secondary font-medium mb-1.5">
              Destination
            </label>
            <div className="flex gap-2">
              {OUTPUT_DESTINATIONS.map((dest) => (
                <button
                  key={dest.value}
                  onClick={() =>
                    handleUpdateStep({
                      ...step,
                      config: { ...step.config, destination: dest.value },
                    })
                  }
                  className={`
                    flex-1 px-3 py-2.5 rounded-lg text-sm font-medium border transition-colors text-center
                    ${step.config.destination === dest.value
                      ? "bg-blade-accent-muted border-blade-accent text-blade-accent"
                      : "bg-blade-surface border-blade-border text-blade-secondary hover:border-blade-border-hover hover:text-blade-text"
                    }
                  `}
                >
                  {dest.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {step.type === "loop" && (
          <div className="space-y-4">
            <div>
              <label className="block text-xs text-blade-secondary font-medium mb-1.5">
                Max Iterations
              </label>
              <input
                type="number"
                min={1}
                max={20}
                value={step.config.maxIterations || 3}
                onChange={(e) =>
                  handleUpdateStep({
                    ...step,
                    config: {
                      ...step.config,
                      maxIterations: Math.max(1, Math.min(20, parseInt(e.target.value) || 3)),
                    },
                  })
                }
                className="w-32 px-3 py-2 rounded-lg bg-blade-surface border border-blade-border text-sm text-blade-text outline-none focus:border-blade-accent transition-colors"
              />
            </div>
            <div>
              <label className="block text-xs text-blade-secondary font-medium mb-1.5">
                Loop Back To Step
              </label>
              <select
                value={step.config.loopStepId || ""}
                onChange={(e) =>
                  handleUpdateStep({
                    ...step,
                    config: { ...step.config, loopStepId: e.target.value },
                  })
                }
                className="w-full px-3 py-2 rounded-lg bg-blade-surface border border-blade-border text-sm text-blade-text outline-none focus:border-blade-accent transition-colors"
              >
                <option value="">Select step...</option>
                {allSteps
                  .filter((s) => s.id !== step.id)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      #{s.order + 1} {s.label}
                    </option>
                  ))}
              </select>
            </div>
          </div>
        )}

        {step.type === "mcp_tool" && (
          <div className="space-y-4">
            <div>
              <label className="block text-xs text-blade-secondary font-medium mb-1.5">
                Tool Name
              </label>
              <input
                type="text"
                value={step.config.toolName || ""}
                onChange={(e) =>
                  handleUpdateStep({
                    ...step,
                    config: { ...step.config, toolName: e.target.value },
                  })
                }
                placeholder="e.g. read_file, search_code"
                className="w-full px-3 py-2 rounded-lg bg-blade-surface border border-blade-border text-sm text-blade-text font-mono placeholder-blade-muted outline-none focus:border-blade-accent transition-colors"
              />
            </div>
            <div>
              <label className="block text-xs text-blade-secondary font-medium mb-1.5">
                Arguments Template (JSON)
              </label>
              <p className="text-2xs text-blade-muted mb-2">
                Use <code className="px-1 py-0.5 bg-blade-surface rounded text-blade-accent font-mono">{"{{input}}"}</code> and{" "}
                <code className="px-1 py-0.5 bg-blade-surface rounded text-blade-accent font-mono">{"{{previous_output}}"}</code> in values.
              </p>
              <textarea
                value={step.config.arguments || "{}"}
                onChange={(e) =>
                  handleUpdateStep({
                    ...step,
                    config: { ...step.config, arguments: e.target.value },
                  })
                }
                rows={4}
                placeholder='{"path": "{{input}}"}'
                className="w-full px-3 py-2 rounded-lg bg-blade-surface border border-blade-border text-sm text-blade-text font-mono placeholder-blade-muted outline-none focus:border-blade-accent transition-colors resize-y"
              />
            </div>
          </div>
        )}
      </div>
    );
  };

  // ── Render: Empty State ──────────────────────────────────────────────────────

  const renderEmptyState = () => (
    <div className="flex-1 flex items-center justify-center">
      <div className="text-center max-w-sm">
        <div className="w-16 h-16 rounded-2xl bg-blade-accent-muted flex items-center justify-center mx-auto mb-4">
          <svg viewBox="0 0 24 24" className="w-8 h-8 text-blade-accent" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
        </div>
        <h3 className="text-base font-semibold text-blade-text mb-2">
          Build AI Workflows
        </h3>
        <p className="text-sm text-blade-secondary leading-relaxed mb-4">
          Chain prompts, add conditions, loop, and run multi-step AI agents.
          Select a workflow from the sidebar or create a new one.
        </p>
        <button
          onClick={() => setIsCreating(true)}
          className="px-4 py-2 rounded-lg bg-blade-accent hover:bg-blade-accent-hover text-white text-sm font-medium transition-colors"
        >
          Create Your First Workflow
        </button>
      </div>
    </div>
  );

  // ── Render: Workflow Editor ──────────────────────────────────────────────────

  const renderWorkflowEditor = () => {
    if (!selectedWorkflow) return renderEmptyState();

    const sortedSteps = [...selectedWorkflow.steps].sort((a, b) => a.order - b.order);
    const isBuiltIn = selectedWorkflow.isBuiltIn;

    return (
      <div className="flex-1 flex flex-col min-h-0">
        {/* Workflow header */}
        <div className="flex-shrink-0 px-6 py-4 border-b border-blade-border bg-blade-bg">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3 min-w-0 flex-1">
              <span className="text-2xl flex-shrink-0 mt-0.5">{selectedWorkflow.icon}</span>
              <div className="min-w-0 flex-1">
                {editingName && !isBuiltIn ? (
                  <input
                    type="text"
                    defaultValue={selectedWorkflow.name}
                    autoFocus
                    onBlur={(e) => {
                      const val = e.target.value.trim();
                      if (val) updateWorkflow(selectedWorkflow.id, { name: val });
                      setEditingName(false);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                      if (e.key === "Escape") setEditingName(false);
                    }}
                    className="text-lg font-semibold text-blade-text bg-blade-surface border border-blade-border rounded-lg px-2 py-1 outline-none focus:border-blade-accent w-full"
                  />
                ) : (
                  <h2
                    className={`text-lg font-semibold text-blade-text truncate ${!isBuiltIn ? "cursor-pointer hover:text-blade-accent-hover" : ""}`}
                    onClick={() => !isBuiltIn && setEditingName(true)}
                    title={isBuiltIn ? undefined : "Click to rename"}
                  >
                    {selectedWorkflow.name}
                  </h2>
                )}

                {editingDesc && !isBuiltIn ? (
                  <input
                    type="text"
                    defaultValue={selectedWorkflow.description}
                    autoFocus
                    onBlur={(e) => {
                      updateWorkflow(selectedWorkflow.id, { description: e.target.value.trim() });
                      setEditingDesc(false);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                      if (e.key === "Escape") setEditingDesc(false);
                    }}
                    className="mt-1 text-sm text-blade-secondary bg-blade-surface border border-blade-border rounded-lg px-2 py-1 outline-none focus:border-blade-accent w-full"
                  />
                ) : (
                  <p
                    className={`text-sm text-blade-secondary mt-0.5 truncate ${!isBuiltIn ? "cursor-pointer hover:text-blade-text" : ""}`}
                    onClick={() => !isBuiltIn && setEditingDesc(true)}
                  >
                    {selectedWorkflow.description || (isBuiltIn ? "" : "Click to add description...")}
                  </p>
                )}
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2 flex-shrink-0">
              {isBuiltIn && (
                <button
                  onClick={() => handleDuplicateWorkflow(selectedWorkflow.id)}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium text-blade-secondary border border-blade-border hover:border-blade-border-hover hover:text-blade-text hover:bg-blade-surface-hover transition-colors"
                  title="Duplicate to edit"
                >
                  Duplicate
                </button>
              )}

              {!isBuiltIn && (
                <button
                  onClick={() => handleDeleteWorkflow(selectedWorkflow.id)}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium text-red-400/70 border border-red-500/20 hover:border-red-500/40 hover:text-red-400 hover:bg-red-400/10 transition-colors"
                >
                  Delete
                </button>
              )}

              {sortedSteps.length > 0 && (
                <button
                  onClick={() => setShowRunInput(true)}
                  disabled={isRunning}
                  className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium bg-blade-accent hover:bg-blade-accent-hover text-white transition-colors disabled:opacity-50"
                >
                  {isRunning ? (
                    <>
                      <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Running...
                    </>
                  ) : (
                    <>
                      <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="currentColor">
                        <path d="M4 2.5v11l9-5.5z" />
                      </svg>
                      Run
                    </>
                  )}
                </button>
              )}
            </div>
          </div>

          {/* Run status bar */}
          {activeRun && activeRun.workflowId === selectedWorkflow.id && (
            <div className="mt-3 flex items-center gap-3 px-3 py-2 rounded-lg bg-blade-surface border border-blade-border">
              {activeRun.status === "running" && (
                <>
                  <div className="w-2 h-2 rounded-full bg-blade-accent animate-pulse" />
                  <span className="text-xs text-blade-secondary">
                    Running step {activeRun.currentStepIndex + 1} of {sortedSteps.length}...
                  </span>
                  <button
                    onClick={stopRun}
                    className="ml-auto text-xs text-red-400 hover:text-red-300 transition-colors"
                  >
                    Stop
                  </button>
                </>
              )}
              {activeRun.status === "completed" && (
                <>
                  <div className="w-2 h-2 rounded-full bg-emerald-400" />
                  <span className="text-xs text-emerald-400">
                    Completed in {((activeRun.completedAt! - activeRun.startedAt) / 1000).toFixed(1)}s
                  </span>
                </>
              )}
              {activeRun.status === "error" && (
                <>
                  <div className="w-2 h-2 rounded-full bg-red-400" />
                  <span className="text-xs text-red-400 truncate">
                    Error: {activeRun.error}
                  </span>
                </>
              )}
              {activeRun.status === "paused" && (
                <>
                  <div className="w-2 h-2 rounded-full bg-amber-400" />
                  <span className="text-xs text-amber-400">Paused</span>
                </>
              )}
            </div>
          )}
        </div>

        {/* Run input modal */}
        {showRunInput && (
          <div className="flex-shrink-0 px-6 py-4 border-b border-blade-border bg-blade-surface">
            <label className="block text-xs text-blade-secondary font-medium mb-2">
              Input for this workflow run
            </label>
            <textarea
              ref={runInputRef}
              value={runInput}
              onChange={(e) => setRunInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  handleRun();
                }
                if (e.key === "Escape") {
                  setShowRunInput(false);
                  setRunInput("");
                }
              }}
              rows={4}
              placeholder="Paste code, error message, topic, or any input for the workflow..."
              className="w-full px-3 py-2 rounded-lg bg-blade-bg border border-blade-border text-sm text-blade-text placeholder-blade-muted outline-none focus:border-blade-accent transition-colors resize-y font-mono leading-relaxed"
            />
            <div className="flex items-center justify-between mt-2">
              <span className="text-2xs text-blade-muted">
                Ctrl+Enter to run / Esc to cancel
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    setShowRunInput(false);
                    setRunInput("");
                  }}
                  className="px-3 py-1.5 rounded-lg text-xs text-blade-secondary hover:text-blade-text hover:bg-blade-surface-hover transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleRun}
                  disabled={!runInput.trim()}
                  className="px-4 py-1.5 rounded-lg text-xs font-medium bg-blade-accent hover:bg-blade-accent-hover text-white transition-colors disabled:opacity-40"
                >
                  Run Workflow
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Steps list */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          <div className="max-w-2xl mx-auto">
            {sortedSteps.length === 0 && (
              <div className="text-center py-12">
                <div className="w-12 h-12 rounded-xl bg-blade-surface border border-blade-border flex items-center justify-center mx-auto mb-3">
                  <svg viewBox="0 0 24 24" className="w-6 h-6 text-blade-muted" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                </div>
                <p className="text-sm text-blade-secondary mb-1">No steps yet</p>
                <p className="text-2xs text-blade-muted mb-4">
                  Add your first step to start building this workflow.
                </p>
                <AddStepButton onAdd={(type) => handleAddStep(type)} />
              </div>
            )}

            {sortedSteps.map((step, idx) => {
              const isActiveStep =
                activeRun?.workflowId === selectedWorkflow.id &&
                activeRun?.status === "running" &&
                activeRun?.currentStepIndex === idx;

              const stepOutput =
                activeRun?.workflowId === selectedWorkflow.id
                  ? activeRun.stepOutputs[step.id]
                  : undefined;

              return (
                <div key={step.id}>
                  {/* Add step button before first step */}
                  {idx === 0 && !isBuiltIn && (
                    <div className="mb-2">
                      <AddStepButton onAdd={(type) => handleAddStep(type, -1)} />
                    </div>
                  )}

                  <WorkflowStepCard
                    step={step}
                    index={idx}
                    isActive={!!isActiveStep}
                    output={stepOutput}
                    onEdit={(s) => {
                      if (isBuiltIn) {
                        // Can't edit built-in — prompt to duplicate
                        return;
                      }
                      setEditingStep(s);
                    }}
                    onDelete={() => {
                      if (!isBuiltIn) handleDeleteStep(step.id);
                    }}
                    onMove={(dir) => {
                      if (!isBuiltIn) handleMoveStep(step.id, dir);
                    }}
                    isFirst={idx === 0}
                    isLast={idx === sortedSteps.length - 1}
                  />

                  {/* Add step button between steps */}
                  {!isBuiltIn && (
                    <div className="my-2">
                      <AddStepButton onAdd={(type) => handleAddStep(type, idx)} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Step editor panel (bottom) */}
        {renderStepEditor()}
      </div>
    );
  };

  // ── Main render ──────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full max-w-5xl mx-auto">
      {renderCreateModal()}
      {renderSidebar()}
      {renderWorkflowEditor()}
    </div>
  );
}

export default WorkflowBuilder;
