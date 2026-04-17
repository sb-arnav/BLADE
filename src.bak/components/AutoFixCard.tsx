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
  green: "#34c759",
  amber: "#f59e0b",
  red: "#ff3b30",
  accent: "#6366f1",
  muted: "rgba(255,255,255,0.35)",
  text: "rgba(255,255,255,0.85)",
  textDim: "rgba(255,255,255,0.45)",
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
    // Collect all listen() promises; on cleanup, await each and call fn
    // (safe against unmount-before-resolve races).
    const promises: Promise<() => void>[] = [
      listen<AutoFixStartedPayload>("hive_auto_fix_started", (e) => {
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
      }),
      listen("auto_fix_analyzing", () => {
        setState((prev) => ({ ...prev, step: "analyzing" }));
      }),
      listen<{ edits: number; files: string[] }>("auto_fix_editing", (e) => {
        setState((prev) => ({
          ...prev,
          step: "editing",
          filesTotal: e.payload.edits ?? 0,
        }));
      }),
      listen<{ step: string; files_changed?: number }>("auto_fix_verifying", (e) => {
        setState((prev) => ({
          ...prev,
          step: "verifying",
          filesEdited: e.payload.files_changed ?? prev.filesEdited,
        }));
      }),
      listen("auto_fix_pushing", () => {
        setState((prev) => ({ ...prev, step: "pushing" }));
      }),
      listen("auto_fix_monitoring", () => {
        setState((prev) => ({ ...prev, step: "monitoring" }));
      }),
      listen<{ result: FixResult; ci_passed: boolean }>("auto_fix_complete", (e) => {
        setState((prev) => ({
          ...prev,
          step: "complete",
          result: e.payload.result,
          ciPassed: e.payload.ci_passed,
        }));
      }),
      listen<{ result: FixResult }>("auto_fix_failed", (e) => {
        setState((prev) => ({
          ...prev,
          step: "failed",
          result: e.payload.result,
        }));
      }),
    ];

    return () => {
      promises.forEach((p) => p.then((fn) => fn()));
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
  const resultLabel = isSuccess
    ? `Fixed${state.result?.data?.commit_hash ? ` · ${state.result.data.commit_hash}` : ""}`
    : state.result?.data?.reason ?? "Fix failed";

  if (state.step === "idle" && !state.repoName) {
    return null;
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div
      style={{
        background: "rgba(18,18,22,0.96)",
        border: "1px solid rgba(255,255,255,0.1)",
        borderRadius: 12,
        padding: "16px 18px",
        position: "relative",
        minWidth: 320,
        maxWidth: 480,
        boxShadow: "0 4px 24px rgba(0,0,0,0.4)",
        fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 14, color: p.text, fontWeight: 600 }}>Auto-Fix</span>
          {state.repoName && (
            <span style={{
              color: p.textDim,
              fontSize: 12,
              background: "rgba(255,255,255,0.06)",
              borderRadius: 6,
              padding: "2px 7px",
            }}>
              {state.repoName}
            </span>
          )}
        </div>

        {!isFinished ? (
          <button
            onClick={handleCancel}
            style={{
              background: "rgba(255,255,255,0.06)",
              border: "none",
              color: p.textDim,
              borderRadius: 6,
              padding: "4px 10px",
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
        ) : (
          <button
            onClick={handleDismiss}
            style={{ background: "none", border: "none", color: p.muted, fontSize: 18, cursor: "pointer", lineHeight: 1 }}
          >
            ×
          </button>
        )}
      </div>

      {/* Error summary */}
      {state.errorSummary && (
        <p style={{
          color: p.textDim,
          fontSize: 13,
          marginBottom: 14,
          lineHeight: 1.5,
          borderLeft: `2px solid ${p.amber}`,
          paddingLeft: 10,
          wordBreak: "break-word",
        }}>
          {state.errorSummary.length > 120 ? state.errorSummary.slice(0, 120) + "…" : state.errorSummary}
        </p>
      )}

      {/* Step list — checkmarks, not progress bars */}
      <div style={{ marginBottom: 16 }}>
        {STEPS.filter((s) => s.key !== "failed").map((s) => {
          const isDone = currentIdx > s.index;
          const isActive = state.step !== "failed" && state.step !== "complete" && state.step === s.key;
          const isFailed = state.step === "failed" && currentIdx === s.index;

          return (
            <div
              key={s.key}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "5px 0",
                opacity: !isDone && !isActive && !isFailed ? 0.3 : 1,
                transition: "opacity 0.25s ease",
              }}
            >
              {/* Step icon */}
              <span style={{
                width: 16,
                fontSize: 13,
                textAlign: "center",
                color: isFailed ? p.red : isDone ? p.green : isActive ? p.accent : p.muted,
                flexShrink: 0,
              }}>
                {isFailed ? "✕" : isDone ? "✓" : isActive ? "›" : "·"}
              </span>

              <span style={{
                fontSize: 13,
                color: isActive ? p.text : isDone ? "rgba(255,255,255,0.65)" : p.muted,
                fontWeight: isActive ? 500 : 400,
                transition: "color 0.25s ease",
              }}>
                {s.label}
                {s.key === "editing" && state.filesTotal > 0 && isActive ? ` (${state.filesTotal} file${state.filesTotal !== 1 ? "s" : ""})` : ""}
                {s.key === "editing" && state.filesEdited > 0 && isDone ? ` · ${state.filesEdited} edited` : ""}
              </span>

              {/* Active indicator dot */}
              {isActive && !isFinished && (
                <span style={{
                  width: 6, height: 6, borderRadius: "50%",
                  background: p.accent, flexShrink: 0,
                  animation: "activeDot 1.4s ease-in-out infinite",
                }} />
              )}
            </div>
          );
        })}
      </div>

      {/* Progress bar — thin, rounded, accent color */}
      <div style={{ height: 4, background: "rgba(255,255,255,0.07)", borderRadius: 2, overflow: "hidden", marginBottom: 14 }}>
        <div
          style={{
            height: "100%",
            width: `${progress}%`,
            background: isFinished ? (isSuccess ? p.green : p.red) : p.accent,
            borderRadius: 2,
            transition: "width 0.4s ease",
          }}
        />
      </div>

      {/* Result banner */}
      {isFinished && state.result && (
        <div style={{
          display: "flex", alignItems: "flex-start", gap: 10,
          background: isSuccess ? "rgba(52,199,89,0.08)" : "rgba(255,59,48,0.08)",
          border: `1px solid ${isSuccess ? "rgba(52,199,89,0.2)" : "rgba(255,59,48,0.2)"}`,
          borderRadius: 8,
          padding: "10px 12px",
          marginBottom: state.result.type === "NeedHumanHelp" ? 12 : 0,
        }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: resultColor, flexShrink: 0, marginTop: 5 }} />
          <div>
            <div style={{ color: resultColor, fontSize: 13, fontWeight: 500, marginBottom: 2 }}>{resultLabel}</div>
            {state.result.type === "NeedHumanHelp" && state.result.data?.suggestion && (
              <div style={{ color: p.textDim, fontSize: 12, lineHeight: 1.5 }}>{state.result.data.suggestion}</div>
            )}
            {state.result.type === "Fixed" && state.result.data?.files_changed && state.result.data.files_changed.length > 0 && (
              <div style={{ color: p.textDim, fontSize: 12 }}>
                {state.result.data.files_changed.length} file{state.result.data.files_changed.length !== 1 ? "s" : ""} changed
              </div>
            )}
          </div>
        </div>
      )}

      {/* Retry */}
      {isFinished && !isSuccess && (
        <button
          onClick={handleRetry}
          style={{
            marginTop: 10, width: "100%",
            background: "rgba(99,102,241,0.12)",
            border: "none",
            color: "#a5b4fc",
            borderRadius: 8,
            padding: "8px 0",
            fontSize: 13,
            fontWeight: 500,
            cursor: "pointer",
            transition: "background 0.25s ease",
          }}
        >
          Retry Pipeline
        </button>
      )}

      {/* Workflow label */}
      {state.workflowName && (
        <div style={{ marginTop: 10, color: p.muted, fontSize: 11, textAlign: "right" }}>
          {state.workflowName}{state.runId > 0 ? ` · run #${state.runId}` : ""}
        </div>
      )}

      <style>{`
        @keyframes activeDot {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
      `}</style>
    </div>
  );
}
