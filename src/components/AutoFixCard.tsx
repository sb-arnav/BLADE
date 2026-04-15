// src/components/AutoFixCard.tsx
// BLADE AutoFix Card — shown in Dashboard when the Hive triggers an auto-fix pipeline.
// Tracks pipeline progress: analyzing → editing → verifying → pushing → monitoring.

import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

// ── Types ─────────────────────────────────────────────────────────────────────

type PipelineStep =
  | "idle"
  | "analyzing"
  | "editing"
  | "verifying"
  | "pushing"
  | "monitoring"
  | "complete"
  | "failed";

interface FixResult {
  type: "Fixed" | "NeedHumanHelp" | "AlreadyFixed";
  data?: {
    files_changed?: string[];
    commit_hash?: string;
    reason?: string;
    suggestion?: string;
  };
}

interface AutoFixState {
  repoName: string;
  workflowName: string;
  runId: number;
  errorSummary: string;
  step: PipelineStep;
  filesEdited: number;
  filesTotal: number;
  result: FixResult | null;
  ciPassed: boolean | null;
}

interface AutoFixStartedPayload {
  repo_path: string;
  workflow_name: string;
  run_id: number;
  summary: string;
}

interface AutoFixCardProps {
  /** Called when the user dismisses the card. */
  onDismiss: () => void;
}

// ── Step metadata ─────────────────────────────────────────────────────────────

const STEPS: { key: PipelineStep; label: string; index: number }[] = [
  { key: "analyzing",  label: "Analyzing errors",  index: 0 },
  { key: "editing",    label: "Applying edits",    index: 1 },
  { key: "verifying",  label: "Verifying fix",     index: 2 },
  { key: "pushing",    label: "Pushing commit",    index: 3 },
  { key: "monitoring", label: "Monitoring CI",     index: 4 },
  { key: "complete",   label: "Done",              index: 5 },
  { key: "failed",     label: "Failed",            index: 5 },
];

function stepIndex(step: PipelineStep): number {
  return STEPS.find((s) => s.key === step)?.index ?? 0;
}

// @ts-ignore
function _stepLabel(step: PipelineStep): string {
  return STEPS.find((s) => s.key === step)?.label ?? step;
}

// ── Palette ───────────────────────────────────────────────────────────────────

const p = {
  bg: "#07090a",
  panel: "#0b0f10",
  border: "#1a2426",
  green: "#00ff41",
  cyan: "#00e5ff",
  amber: "#ffb000",
  red: "#ff0040",
  violet: "#b388ff",
  muted: "#4a6068",
  text: "#c8d8dc",
  textDim: "#6b8a90",
};

// ── Component ─────────────────────────────────────────────────────────────────

export function AutoFixCard({ onDismiss }: AutoFixCardProps) {
  const [state, setState] = useState<AutoFixState>({
    repoName: "",
    workflowName: "",
    runId: 0,
    errorSummary: "",
    step: "idle",
    filesEdited: 0,
    filesTotal: 0,
    result: null,
    ciPassed: null,
  });

  const [_cancelled, setCancelled] = useState(false);

  // ── Event listeners ──────────────────────────────────────────────────────

  useEffect(() => {
    const unlisteners: (() => void)[] = [];

    // Pipeline started by Hive.
    const started = listen<AutoFixStartedPayload>("hive_auto_fix_started", (e) => {
      const { repo_path, workflow_name, run_id, summary } = e.payload;
      const parts = repo_path.split("/");
      const repoName = parts[parts.length - 1] ?? repo_path;
      setState((prev) => ({
        ...prev,
        repoName,
        workflowName: workflow_name,
        runId: run_id,
        errorSummary: summary,
        step: "analyzing",
        result: null,
        ciPassed: null,
        filesEdited: 0,
        filesTotal: 0,
      }));
    });
    started.then((fn) => unlisteners.push(fn));

    // Step: analyzing
    const analyzing = listen("auto_fix_analyzing", () => {
      setState((prev) => ({ ...prev, step: "analyzing" }));
    });
    analyzing.then((fn) => unlisteners.push(fn));

    // Step: editing
    const editing = listen<{ edits: number; files: string[] }>(
      "auto_fix_editing",
      (e) => {
        setState((prev) => ({
          ...prev,
          step: "editing",
          filesTotal: e.payload.edits ?? 0,
        }));
      }
    );
    editing.then((fn) => unlisteners.push(fn));

    // Step: verifying (two sub-steps: local_check + llm_retry)
    const verifying = listen<{ step: string; files_changed?: number }>(
      "auto_fix_verifying",
      (e) => {
        setState((prev) => ({
          ...prev,
          step: "verifying",
          filesEdited: e.payload.files_changed ?? prev.filesEdited,
        }));
      }
    );
    verifying.then((fn) => unlisteners.push(fn));

    // Step: pushing
    const pushing = listen("auto_fix_pushing", () => {
      setState((prev) => ({ ...prev, step: "pushing" }));
    });
    pushing.then((fn) => unlisteners.push(fn));

    // Step: monitoring
    const monitoring = listen("auto_fix_monitoring", () => {
      setState((prev) => ({ ...prev, step: "monitoring" }));
    });
    monitoring.then((fn) => unlisteners.push(fn));

    // Complete
    const complete = listen<{ result: FixResult; ci_passed: boolean }>(
      "auto_fix_complete",
      (e) => {
        setState((prev) => ({
          ...prev,
          step: "complete",
          result: e.payload.result,
          ciPassed: e.payload.ci_passed,
        }));
      }
    );
    complete.then((fn) => unlisteners.push(fn));

    // Failed
    const failed = listen<{ result: FixResult }>("auto_fix_failed", (e) => {
      setState((prev) => ({
        ...prev,
        step: "failed",
        result: e.payload.result,
      }));
    });
    failed.then((fn) => unlisteners.push(fn));

    return () => {
      unlisteners.forEach((fn) => fn());
    };
  }, []);

  // ── Handlers ─────────────────────────────────────────────────────────────

  const handleCancel = useCallback(() => {
    setCancelled(true);
    // No explicit cancel command yet — the pipeline checks BLADE's cancel signal
    // via its own logic. We just hide the card.
    onDismiss();
  }, [onDismiss]);

  const handleDismiss = useCallback(() => {
    onDismiss();
  }, [onDismiss]);

  // Trigger a full pipeline manually (e.g. from a "Retry" button or direct invoke).
  const handleRetry = useCallback(async () => {
    if (!state.repoName) return;
    setState((prev) => ({
      ...prev,
      step: "analyzing",
      result: null,
      ciPassed: null,
    }));
    try {
      await invoke("auto_fix_full_pipeline", {
        failure: {
          repo_path: state.repoName,
          workflow_name: state.workflowName,
          run_id: state.runId,
          job_name: "unknown",
          step_name: "unknown",
          error_log: state.errorSummary,
          error_type: "Unknown",
        },
      });
    } catch (e) {
      console.error("[AutoFixCard] retry failed:", e);
    }
  }, [state]);

  // ── Computed values ───────────────────────────────────────────────────────

  const totalSteps = 5; // analyzing → editing → verifying → pushing → monitoring
  const currentIdx = stepIndex(state.step);
  const progress =
    state.step === "complete" || state.step === "failed"
      ? 100
      : Math.round((currentIdx / totalSteps) * 100);

  const isFinished = state.step === "complete" || state.step === "failed";
  const isSuccess =
    state.step === "complete" &&
    state.result?.type === "Fixed" &&
    state.ciPassed !== false;

  const resultColor = isSuccess ? p.green : p.red;
  const resultIcon = isSuccess ? "✓" : "✗";
  const resultLabel = isSuccess
    ? `Fixed · ${state.result?.data?.commit_hash ?? ""}`
    : state.result?.data?.reason ?? "Fix failed";

  if (state.step === "idle" && !state.repoName) {
    return null;
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div
      style={{
        background: p.panel,
        border: `1px solid ${p.border}`,
        borderRadius: 10,
        padding: "16px 20px",
        position: "relative",
        minWidth: 320,
        maxWidth: 480,
        boxShadow: "0 4px 24px rgba(0,0,0,0.5)",
        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 12,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 16 }}>🔧</span>
          <span
            style={{
              color: p.cyan,
              fontSize: 13,
              fontWeight: 700,
              letterSpacing: "0.04em",
            }}
          >
            AUTO-FIX
          </span>
          <span
            style={{
              color: p.textDim,
              fontSize: 11,
              background: "#111c1f",
              borderRadius: 4,
              padding: "1px 6px",
            }}
          >
            {state.repoName || "repo"}
          </span>
        </div>

        {/* Close / Cancel */}
        {!isFinished ? (
          <button
            onClick={handleCancel}
            title="Cancel auto-fix"
            style={{
              background: "transparent",
              border: `1px solid ${p.muted}`,
              color: p.muted,
              borderRadius: 4,
              padding: "2px 8px",
              fontSize: 11,
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
        ) : (
          <button
            onClick={handleDismiss}
            title="Dismiss"
            style={{
              background: "transparent",
              border: "none",
              color: p.muted,
              fontSize: 16,
              cursor: "pointer",
              lineHeight: 1,
            }}
          >
            ×
          </button>
        )}
      </div>

      {/* Error summary */}
      {state.errorSummary && (
        <div
          style={{
            color: p.textDim,
            fontSize: 11,
            marginBottom: 12,
            lineHeight: 1.5,
            borderLeft: `2px solid ${p.amber}`,
            paddingLeft: 8,
            wordBreak: "break-word",
          }}
        >
          {state.errorSummary.length > 120
            ? state.errorSummary.slice(0, 120) + "…"
            : state.errorSummary}
        </div>
      )}

      {/* Step list */}
      <div style={{ marginBottom: 14 }}>
        {STEPS.filter((s) => s.key !== "failed").map((s) => {
          const isDone = currentIdx > s.index;
          const isActive =
            state.step !== "failed" && state.step !== "complete" && state.step === s.key;
          const isFailed = state.step === "failed" && currentIdx === s.index;

          return (
            <div
              key={s.key}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                marginBottom: 4,
                opacity: isDone || isActive ? 1 : 0.35,
              }}
            >
              <span
                style={{
                  fontSize: 12,
                  color: isFailed ? p.red : isDone ? p.green : isActive ? p.amber : p.muted,
                  minWidth: 14,
                  textAlign: "center",
                }}
              >
                {isFailed ? "✗" : isDone ? "✓" : isActive ? "›" : "·"}
              </span>
              <span
                style={{
                  fontSize: 12,
                  color: isFailed ? p.red : isDone ? p.green : isActive ? p.text : p.muted,
                }}
              >
                {s.label}
                {s.key === "editing" && state.filesTotal > 0 && isActive
                  ? ` (${state.filesTotal} file${state.filesTotal !== 1 ? "s" : ""})`
                  : ""}
                {s.key === "editing" && state.filesEdited > 0 && isDone
                  ? ` · ${state.filesEdited} edited`
                  : ""}
              </span>
              {isActive && !isFinished && (
                <span
                  style={{
                    fontSize: 10,
                    color: p.amber,
                    animation: "pulse 1.2s ease-in-out infinite",
                  }}
                >
                  ···
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Progress bar */}
      <div
        style={{
          height: 3,
          background: "#1a2426",
          borderRadius: 2,
          overflow: "hidden",
          marginBottom: 12,
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${progress}%`,
            background: isFinished
              ? isSuccess
                ? p.green
                : p.red
              : p.cyan,
            borderRadius: 2,
            transition: "width 0.4s ease",
          }}
        />
      </div>

      {/* Result banner */}
      {isFinished && state.result && (
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 8,
            background: isSuccess ? "rgba(0,255,65,0.06)" : "rgba(255,0,64,0.06)",
            border: `1px solid ${resultColor}33`,
            borderRadius: 6,
            padding: "8px 10px",
            marginBottom: state.result.type === "NeedHumanHelp" ? 10 : 0,
          }}
        >
          <span
            style={{
              color: resultColor,
              fontSize: 16,
              lineHeight: 1,
              marginTop: 1,
              flexShrink: 0,
            }}
          >
            {resultIcon}
          </span>
          <div>
            <div
              style={{
                color: resultColor,
                fontSize: 12,
                fontWeight: 700,
                marginBottom: 2,
              }}
            >
              {resultLabel}
            </div>
            {state.result.type === "NeedHumanHelp" &&
              state.result.data?.suggestion && (
                <div style={{ color: p.textDim, fontSize: 11, lineHeight: 1.4 }}>
                  {state.result.data.suggestion}
                </div>
              )}
            {state.result.type === "Fixed" &&
              state.result.data?.files_changed &&
              state.result.data.files_changed.length > 0 && (
                <div style={{ color: p.textDim, fontSize: 11 }}>
                  {state.result.data.files_changed.length} file
                  {state.result.data.files_changed.length !== 1 ? "s" : ""} changed
                </div>
              )}
          </div>
        </div>
      )}

      {/* Retry button for failures */}
      {isFinished && !isSuccess && (
        <button
          onClick={handleRetry}
          style={{
            marginTop: 8,
            width: "100%",
            background: "transparent",
            border: `1px solid ${p.cyan}44`,
            color: p.cyan,
            borderRadius: 5,
            padding: "6px 0",
            fontSize: 12,
            cursor: "pointer",
            letterSpacing: "0.04em",
          }}
        >
          Retry Pipeline
        </button>
      )}

      {/* Workflow label */}
      {state.workflowName && (
        <div
          style={{
            marginTop: 8,
            color: p.muted,
            fontSize: 10,
            textAlign: "right",
          }}
        >
          {state.workflowName}
          {state.runId > 0 ? ` · run #${state.runId}` : ""}
        </div>
      )}
    </div>
  );
}
