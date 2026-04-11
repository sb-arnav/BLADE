// ComputerUsePanel — live view of BLADE's autonomous screen operations.
// Shows each step as it executes: action type, description, and terminal status.
// Appears as an overlay when computer use is active, dismisses on completion.

import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

interface Step {
  step: number;
  kind: string;
  description: string;
  status: "executing" | "done" | "error";
  error?: string;
}

interface Props {
  onDismiss: () => void;
}

const KIND_ICON: Record<string, string> = {
  click: "⊙",
  type: "⌨",
  key: "⌨",
  scroll: "↕",
  open_url: "↗",
  open_app: "⊞",
  wait: "⧗",
  done: "✓",
  failed: "✗",
  need_approval: "⚠",
};

interface ApprovalRequest {
  approval_id: string;
  step: number;
  description: string;
  action: string;
}

export function ComputerUsePanel({ onDismiss }: Props) {
  const [steps, setSteps] = useState<Step[]>([]);
  const [finished, setFinished] = useState<{ success: boolean; result: string; steps: number } | null>(null);
  const [goal, setGoal] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [input, setInput] = useState("");
  const [pendingApproval, setPendingApproval] = useState<ApprovalRequest | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const unlistenStep = listen<{
      step: number;
      action: Record<string, unknown>;
      status: string;
      error?: string;
    }>("computer_use_step", (event) => {
      const { step, action, status, error } = event.payload;
      const kind = (action.kind as string) ?? "action";
      const description =
        (action.description as string) ??
        (action.text as string) ??
        (action.key as string) ??
        (action.url as string) ??
        (action.name as string) ??
        kind;

      setSteps((prev) => {
        const existing = prev.findIndex((s) => s.step === step);
        const updated: Step = {
          step,
          kind,
          description,
          status: status as Step["status"],
          error,
        };
        if (existing >= 0) {
          const next = [...prev];
          next[existing] = updated;
          return next;
        }
        return [...prev, updated];
      });
    });

    const unlistenComplete = listen<{ success: boolean; result: string; steps: number }>(
      "computer_use_complete",
      (event) => {
        setFinished(event.payload);
        setIsRunning(false);
        setPendingApproval(null);
      }
    );

    const unlistenApproval = listen<ApprovalRequest>(
      "computer_use_approval_needed",
      (event) => {
        setPendingApproval(event.payload);
        setIsRunning(false); // Task is paused waiting for approval
      }
    );

    return () => {
      unlistenStep.then((fn) => fn());
      unlistenComplete.then((fn) => fn());
      unlistenApproval.then((fn) => fn());
    };
  }, []);

  // Auto-scroll to latest step
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [steps]);

  const startTask = () => {
    if (!input.trim()) return;
    setGoal(input.trim());
    setSteps([]);
    setFinished(null);
    setIsRunning(true);
    void invoke("computer_use_task", { goal: input.trim() });
    setInput("");
  };

  const stopTask = () => {
    void invoke("computer_use_stop");
    setIsRunning(false);
  };

  const respondApproval = (approved: boolean) => {
    if (!pendingApproval) return;
    void invoke("respond_tool_approval", {
      approvalId: pendingApproval.approval_id,
      approved,
    });
    setPendingApproval(null);
    if (approved) setIsRunning(true);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-blade-border flex-shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-blade-accent font-mono text-sm font-semibold">COMPUTER USE</span>
          {isRunning && (
            <span className="flex items-center gap-1 text-xs text-blade-muted">
              <span className="w-1.5 h-1.5 rounded-full bg-blade-accent animate-pulse" />
              running
            </span>
          )}
        </div>
        <button
          onClick={onDismiss}
          className="text-blade-muted hover:text-blade-text transition text-sm"
        >
          ✕
        </button>
      </div>

      {/* Goal input */}
      {!isRunning && !finished && (
        <div className="px-4 py-3 border-b border-blade-border flex-shrink-0">
          <div className="flex gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && startTask()}
              placeholder="What should BLADE do on screen?"
              autoFocus
              className="flex-1 bg-blade-surface border border-blade-border rounded-lg px-3 py-2 text-sm text-blade-text placeholder:text-blade-muted/50 focus:outline-none focus:border-blade-accent/50"
            />
            <button
              onClick={startTask}
              disabled={!input.trim()}
              className="px-3 py-2 bg-blade-accent text-white rounded-lg text-sm font-medium disabled:opacity-40 hover:opacity-90 transition"
            >
              Go
            </button>
          </div>
        </div>
      )}

      {/* Goal recap when running */}
      {(isRunning || finished) && goal && (
        <div className="px-4 py-2 border-b border-blade-border bg-blade-surface/50 flex-shrink-0">
          <span className="text-xs text-blade-muted">Goal: </span>
          <span className="text-xs text-blade-text">{goal}</span>
        </div>
      )}

      {/* Step trace */}
      <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-1.5">
        {steps.length === 0 && isRunning && (
          <div className="text-sm text-blade-muted animate-pulse">Taking first screenshot…</div>
        )}
        {steps.map((step) => (
          <div
            key={step.step}
            className={[
              "flex items-start gap-2 rounded-lg px-3 py-1.5 text-sm transition",
              step.status === "error"
                ? "bg-red-500/10 border border-red-500/20"
                : step.status === "done"
                ? "bg-blade-surface/50"
                : "bg-blade-surface animate-pulse",
            ].join(" ")}
          >
            <span className="text-blade-accent font-mono text-xs pt-0.5 flex-shrink-0 w-4">
              {step.status === "error" ? "✗" : step.status === "done" ? "✓" : KIND_ICON[step.kind] ?? "·"}
            </span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-blade-muted font-mono uppercase">
                  {step.kind.replace("_", " ")}
                </span>
                <span className="text-[10px] text-blade-muted/50">#{step.step}</span>
              </div>
              <div className="text-blade-text/80 truncate">{step.description}</div>
              {step.error && (
                <div className="text-red-400 text-xs mt-0.5">{step.error}</div>
              )}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Approval request */}
      {pendingApproval && (
        <div className="mx-4 mb-2 rounded-lg border border-yellow-500/40 bg-yellow-500/10 p-3 flex-shrink-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-yellow-400 text-sm">⚠</span>
            <span className="text-sm font-medium text-blade-text">Approval needed — step {pendingApproval.step}</span>
          </div>
          <div className="text-xs text-blade-text/80 mb-2">{pendingApproval.description}</div>
          {pendingApproval.action && (
            <div className="text-[10px] font-mono text-blade-muted bg-blade-bg rounded p-1 mb-2 truncate">
              {pendingApproval.action}
            </div>
          )}
          <div className="flex gap-2">
            <button
              onClick={() => respondApproval(true)}
              className="flex-1 text-xs py-1.5 rounded border border-green-500/40 text-green-400 hover:bg-green-500/10 transition"
            >
              Allow
            </button>
            <button
              onClick={() => respondApproval(false)}
              className="flex-1 text-xs py-1.5 rounded border border-red-500/30 text-red-400 hover:bg-red-500/10 transition"
            >
              Deny
            </button>
          </div>
        </div>
      )}

      {/* Result */}
      {finished && (
        <div
          className={[
            "px-4 py-3 border-t border-blade-border flex-shrink-0",
            finished.success ? "bg-green-500/10" : "bg-red-500/10",
          ].join(" ")}
        >
          <div className="flex items-start gap-2">
            <span className={finished.success ? "text-green-400" : "text-red-400"}>
              {finished.success ? "✓" : "✗"}
            </span>
            <div className="flex-1 min-w-0">
              <div className="text-sm text-blade-text">{finished.result}</div>
              <div className="text-xs text-blade-muted mt-0.5">{finished.steps} steps taken</div>
            </div>
          </div>
          <div className="flex gap-2 mt-2">
            <button
              onClick={() => {
                setSteps([]);
                setFinished(null);
                setGoal("");
              }}
              className="text-xs px-3 py-1 rounded border border-blade-border hover:bg-blade-surface-hover transition text-blade-muted"
            >
              New task
            </button>
            <button
              onClick={onDismiss}
              className="text-xs px-3 py-1 rounded border border-blade-border hover:bg-blade-surface-hover transition text-blade-muted"
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* Stop button while running */}
      {isRunning && (
        <div className="px-4 py-3 border-t border-blade-border flex-shrink-0">
          <button
            onClick={stopTask}
            className="w-full text-sm py-1.5 rounded-lg border border-red-500/30 text-red-400 hover:bg-red-500/10 transition"
          >
            Stop
          </button>
        </div>
      )}
    </div>
  );
}
