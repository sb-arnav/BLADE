import { useState } from "react";

/**
 * Agent Verification Panel — Validates agent claims before marking tasks complete.
 *
 * Built because developers complained:
 * "agents report 'fixed!' when they just suppressed the error"
 * "sanitised optimism" — agents lie about success
 *
 * This component provides:
 * 1. Diff-level verification of file changes
 * 2. PASS/FAIL/UNKNOWN status with evidence
 * 3. Test execution results
 * 4. Before/after comparisons
 */

export interface VerificationCheck {
  id: string;
  type: "file_diff" | "test_run" | "build_check" | "lint_check" | "manual" | "ai_review";
  name: string;
  status: "pending" | "running" | "pass" | "fail" | "unknown" | "skipped";
  evidence: string;
  startedAt?: number;
  completedAt?: number;
  details?: {
    before?: string;
    after?: string;
    diff?: string;
    output?: string;
    errorCount?: number;
    warningCount?: number;
  };
}

export interface VerificationReport {
  agentRunId: string;
  agentClaim: string;
  overallStatus: "verified" | "failed" | "partial" | "pending";
  checks: VerificationCheck[];
  createdAt: number;
  completedAt?: number;
  confidence: number; // 0-1
  summary: string;
}

const STATUS_ICONS: Record<VerificationCheck["status"], string> = {
  pending: "⏳",
  running: "🔄",
  pass: "✅",
  fail: "❌",
  unknown: "❓",
  skipped: "⏭️",
};

const STATUS_COLORS: Record<VerificationCheck["status"], string> = {
  pending: "text-blade-muted",
  running: "text-blade-accent",
  pass: "text-emerald-400",
  fail: "text-red-400",
  unknown: "text-amber-400",
  skipped: "text-blade-muted/50",
};

function CheckRow({ check }: { check: VerificationCheck }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border border-blade-border/50 rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full text-left px-3 py-2 flex items-center gap-2 hover:bg-blade-surface-hover transition-colors"
      >
        <span className="text-xs">{STATUS_ICONS[check.status]}</span>
        <span className={`text-xs flex-1 ${STATUS_COLORS[check.status]}`}>{check.name}</span>
        <span className="text-2xs text-blade-muted/40 font-mono">{check.type}</span>
        {check.completedAt && check.startedAt && (
          <span className="text-2xs text-blade-muted/30">
            {((check.completedAt - check.startedAt) / 1000).toFixed(1)}s
          </span>
        )}
      </button>

      {expanded && (
        <div className="px-3 pb-3 border-t border-blade-border/30 space-y-2">
          {/* Evidence */}
          <div className="mt-2">
            <span className="text-2xs text-blade-muted uppercase tracking-wider">Evidence</span>
            <p className="text-xs text-blade-secondary mt-0.5">{check.evidence || "No evidence provided"}</p>
          </div>

          {/* Diff */}
          {check.details?.diff && (
            <div>
              <span className="text-2xs text-blade-muted uppercase tracking-wider">Diff</span>
              <pre className="mt-0.5 text-2xs font-mono bg-blade-bg rounded p-2 overflow-x-auto max-h-40">
                {check.details.diff.split("\n").map((line, i) => (
                  <div
                    key={i}
                    className={
                      line.startsWith("+") ? "text-emerald-400" :
                      line.startsWith("-") ? "text-red-400" :
                      line.startsWith("@") ? "text-blade-accent" :
                      "text-blade-muted"
                    }
                  >
                    {line}
                  </div>
                ))}
              </pre>
            </div>
          )}

          {/* Command output */}
          {check.details?.output && (
            <div>
              <span className="text-2xs text-blade-muted uppercase tracking-wider">Output</span>
              <pre className="mt-0.5 text-2xs font-mono bg-blade-bg rounded p-2 overflow-x-auto max-h-40 text-blade-secondary">
                {check.details.output}
              </pre>
            </div>
          )}

          {/* Error/warning counts */}
          {(check.details?.errorCount != null || check.details?.warningCount != null) && (
            <div className="flex items-center gap-3">
              {check.details.errorCount != null && (
                <span className={`text-2xs ${check.details.errorCount > 0 ? "text-red-400" : "text-emerald-400"}`}>
                  {check.details.errorCount} errors
                </span>
              )}
              {check.details.warningCount != null && (
                <span className={`text-2xs ${check.details.warningCount > 0 ? "text-amber-400" : "text-blade-muted"}`}>
                  {check.details.warningCount} warnings
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ConfidenceBar({ confidence }: { confidence: number }) {
  const pct = Math.round(confidence * 100);
  const color =
    confidence >= 0.8 ? "bg-emerald-500" :
    confidence >= 0.5 ? "bg-amber-500" :
    "bg-red-500";

  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-blade-border/50 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-2xs text-blade-muted font-mono">{pct}%</span>
    </div>
  );
}

interface Props {
  report: VerificationReport | null;
  onRunCheck?: (checkType: string) => void;
  onDismiss?: () => void;
}

export function AgentVerification({ report, onRunCheck, onDismiss }: Props) {
  if (!report) return null;

  const passCount = report.checks.filter((c) => c.status === "pass").length;
  const failCount = report.checks.filter((c) => c.status === "fail").length;
  const totalChecks = report.checks.length;

  const overallColors: Record<string, string> = {
    verified: "border-emerald-500/30 bg-emerald-500/5",
    failed: "border-red-500/30 bg-red-500/5",
    partial: "border-amber-500/30 bg-amber-500/5",
    pending: "border-blade-border",
  };

  const overallIcons: Record<string, string> = {
    verified: "✅",
    failed: "❌",
    partial: "⚠️",
    pending: "⏳",
  };

  return (
    <div className={`rounded-xl border p-4 space-y-3 ${overallColors[report.overallStatus]}`}>
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <span className="text-lg">{overallIcons[report.overallStatus]}</span>
          <div>
            <p className="text-xs font-semibold">
              Verification: {report.overallStatus.charAt(0).toUpperCase() + report.overallStatus.slice(1)}
            </p>
            <p className="text-2xs text-blade-muted mt-0.5">
              {passCount}/{totalChecks} checks passed
              {failCount > 0 && ` · ${failCount} failed`}
            </p>
          </div>
        </div>
        {onDismiss && (
          <button onClick={onDismiss} className="text-blade-muted hover:text-blade-secondary transition-colors">
            <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        )}
      </div>

      {/* Agent's claim */}
      <div className="bg-blade-bg/50 rounded-lg px-3 py-2">
        <span className="text-2xs text-blade-muted uppercase tracking-wider">Agent claimed</span>
        <p className="text-xs text-blade-secondary mt-0.5">{report.agentClaim}</p>
      </div>

      {/* Confidence */}
      <div>
        <span className="text-2xs text-blade-muted uppercase tracking-wider">Confidence</span>
        <div className="mt-1">
          <ConfidenceBar confidence={report.confidence} />
        </div>
      </div>

      {/* Checks */}
      <div className="space-y-1.5">
        {report.checks.map((check) => (
          <CheckRow key={check.id} check={check} />
        ))}
      </div>

      {/* Run additional checks */}
      {onRunCheck && (
        <div className="flex items-center gap-2 pt-1">
          <span className="text-2xs text-blade-muted">Run:</span>
          {["test_run", "build_check", "lint_check", "ai_review"].map((type) => (
            <button
              key={type}
              onClick={() => onRunCheck(type)}
              className="text-2xs px-2 py-0.5 rounded-md bg-blade-surface-hover text-blade-secondary hover:text-blade-text transition-colors"
            >
              {type.replace("_", " ")}
            </button>
          ))}
        </div>
      )}

      {/* Summary */}
      {report.summary && (
        <p className="text-2xs text-blade-muted border-t border-blade-border/30 pt-2">
          {report.summary}
        </p>
      )}
    </div>
  );
}
