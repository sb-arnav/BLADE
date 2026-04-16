// src/components/CapabilityReports.tsx
// Dashboard for capability gap reports — view, triage, configure webhook.

import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { CapabilityReport, ReportStatus } from "../types";

function relTime(ts: number) {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const SEVERITY_STYLE: Record<string, string> = {
  critical: "text-red-300 bg-red-500/10 border-red-500/20",
  high: "text-orange-300 bg-orange-500/10 border-orange-500/20",
  medium: "text-yellow-300 bg-yellow-500/10 border-yellow-500/20",
  low: "text-[rgba(255,255,255,0.7)] bg-[rgba(255,255,255,0.04)]/10 border-[rgba(255,255,255,0.2)]/20",
};

const STATUS_STYLE: Record<string, string> = {
  open: "text-sky-300 bg-sky-500/10 border-sky-500/20",
  investigating: "text-violet-300 bg-violet-500/10 border-violet-500/20",
  resolved: "text-emerald-300 bg-emerald-500/10 border-emerald-500/20",
  wont_fix: "text-[rgba(255,255,255,0.5)] bg-[rgba(255,255,255,0.04)]/10 border-[rgba(255,255,255,0.2)]/20",
};

const CATEGORY_EMOJI: Record<string, string> = {
  capability_gap: "🚫",
  missing_tool: "🔧",
  runtime_error: "💥",
  failed_mission: "❌",
  user_friction: "😤",
};

function ReportCard({
  report,
  onStatusChange,
}: {
  report: CapabilityReport;
  onStatusChange: (id: string, status: ReportStatus) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-xl border border-blade-border bg-blade-surface overflow-hidden">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full text-left px-4 py-3 hover:bg-blade-surface-hover transition-colors"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-base flex-shrink-0">{CATEGORY_EMOJI[report.category] ?? "📋"}</span>
            <div className="min-w-0">
              <div className="text-sm text-blade-text font-medium truncate">{report.title}</div>
              <div className="text-2xs text-blade-muted mt-0.5">
                {report.category.replace(/_/g, " ")} · {relTime(report.reported_at)}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <span className={`text-2xs px-1.5 py-0.5 rounded border ${SEVERITY_STYLE[report.severity] ?? ""}`}>
              {report.severity}
            </span>
            <span className={`text-2xs px-1.5 py-0.5 rounded border ${STATUS_STYLE[report.status] ?? ""}`}>
              {report.status.replace("_", " ")}
            </span>
          </div>
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-3 border-t border-blade-border/60">
          {report.user_request && (
            <div>
              <div className="text-2xs uppercase tracking-[0.18em] text-blade-muted mb-1 mt-3">User asked</div>
              <div className="text-xs text-blade-secondary bg-blade-bg/60 rounded-lg px-3 py-2 font-mono line-clamp-3">
                {report.user_request}
              </div>
            </div>
          )}
          {report.blade_response && (
            <div>
              <div className="text-2xs uppercase tracking-[0.18em] text-blade-muted mb-1">Blade responded</div>
              <div className="text-xs text-blade-muted bg-blade-bg/60 rounded-lg px-3 py-2 line-clamp-4">
                {report.blade_response}
              </div>
            </div>
          )}
          {report.suggested_fix && (
            <div>
              <div className="text-2xs uppercase tracking-[0.18em] text-blade-muted mb-1">Suggested fix</div>
              <div className="text-xs text-emerald-300/80 bg-emerald-500/5 rounded-lg px-3 py-2">
                {report.suggested_fix}
              </div>
            </div>
          )}
          <div className="flex items-center gap-2 pt-1">
            {(["open", "investigating", "resolved", "wont_fix"] as ReportStatus[]).map((s) => (
              <button
                key={s}
                onClick={() => onStatusChange(report.id, s)}
                className={`text-2xs px-2 py-1 rounded-lg border transition-colors ${
                  report.status === s
                    ? STATUS_STYLE[s]
                    : "border-blade-border text-blade-muted hover:text-blade-secondary"
                }`}
              >
                {s.replace("_", " ")}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function CapabilityReports({ onBack }: { onBack: () => void }) {
  const [reports, setReports] = useState<CapabilityReport[]>([]);
  const [webhook, setWebhook] = useState("");
  const [webhookInput, setWebhookInput] = useState("");
  const [filter, setFilter] = useState<ReportStatus | "all">("all");
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [lastLoadedAt, setLastLoadedAt] = useState<number | null>(null);

  const load = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [r, w] = await Promise.all([
        invoke<CapabilityReport[]>("get_reports", { limit: 200 }).catch(() => []),
        invoke<string>("get_report_webhook").catch(() => ""),
      ]);
      setReports(r);
      setWebhook(w);
      setWebhookInput(w);
      setLastLoadedAt(Date.now());
    } catch (cause) {
      setLoadError(typeof cause === "string" ? cause : "Failed to load capability reports");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const handleStatusChange = async (id: string, status: ReportStatus) => {
    await invoke("update_report_status", { id, status }).catch(() => {});
    setReports((prev) => prev.map((r) => r.id === id ? { ...r, status } : r));
  };

  const handleSaveWebhook = async () => {
    await invoke("set_report_webhook", { url: webhookInput.trim() });
    setWebhook(webhookInput.trim());
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const filtered = filter === "all" ? reports : reports.filter((r) => r.status === filter);

  const counts = {
    open: reports.filter((r) => r.status === "open").length,
    investigating: reports.filter((r) => r.status === "investigating").length,
    resolved: reports.filter((r) => r.status === "resolved").length,
  };

  return (
    <div className="flex flex-col h-full bg-[#09090b]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b border-[#1f1f1f] flex-shrink-0">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="text-[#666] hover:text-[#e5e5e5] text-xs transition-colors">
            ← back
          </button>
          <div>
            <h2 className="text-sm font-semibold text-[#e5e5e5]">Capability Reports</h2>
            <p className="text-xs text-[#666] mt-0.5">
              What Blade couldn't do — gaps Blade detected and queued for improvement.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <div className="text-2xs text-blade-secondary">
              {loading ? "Refreshing reports..." : "Local incident queue"}
            </div>
            <div className="text-[10px] text-blade-muted mt-0.5">
              {lastLoadedAt ? `Updated ${relTime(lastLoadedAt)}` : "Not loaded yet"}
            </div>
          </div>
          <button onClick={load} className="w-7 h-7 rounded-lg flex items-center justify-center text-[#666] hover:text-[#e5e5e5] hover:bg-[rgba(255,255,255,0.04)] transition-colors">
            <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.75">
              <path d="M13.5 8A5.5 5.5 0 112.5 8" /><path d="M13.5 4v4h-4" />
            </svg>
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
        {loadError ? (
          <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-200">
            {loadError}
          </div>
        ) : null}

        {/* Stats strip */}
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "Open", value: counts.open, color: "text-sky-300" },
            { label: "Investigating", value: counts.investigating, color: "text-violet-300" },
            { label: "Resolved", value: counts.resolved, color: "text-emerald-300" },
          ].map(({ label, value, color }) => (
            <div key={label} className="rounded-xl border border-blade-border bg-blade-surface px-3 py-3 text-center">
              <div className={`text-2xl font-bold ${color}`}>{value}</div>
              <div className="text-2xs text-blade-muted mt-0.5">{label}</div>
            </div>
          ))}
        </div>

        {/* Webhook config */}
        <div className="rounded-2xl border border-blade-border bg-blade-surface p-4">
          <div className="text-sm font-medium text-blade-text mb-1">Webhook</div>
          <div className="text-xs text-blade-muted mb-3">
            Paste a Discord or Slack webhook URL. Blade will post every new gap here in real-time.
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={webhookInput}
              onChange={(e) => setWebhookInput(e.target.value)}
              placeholder="https://discord.com/api/webhooks/… or Slack webhook"
              className="flex-1 text-xs bg-blade-bg border border-blade-border rounded-lg px-3 py-2 text-blade-text placeholder:text-blade-muted outline-none focus:border-blade-accent/50 font-mono"
            />
            <button
              onClick={handleSaveWebhook}
              className="text-xs px-4 py-2 rounded-lg bg-blade-accent text-white hover:bg-blade-accent/90 transition-colors flex-shrink-0"
            >
              {saved ? "Saved ✓" : "Save"}
            </button>
          </div>
          {webhook && (
            <div className="text-2xs text-emerald-300/70 mt-2">
              Active: {webhook.slice(0, 50)}…
            </div>
          )}
        </div>

        {/* Filter tabs */}
        <div className="flex gap-2">
          {(["all", "open", "investigating", "resolved", "wont_fix"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${
                filter === s
                  ? "bg-[#09090b] text-[#c8cbff] border border-[#6366f1]/30"
                  : "text-[#666] hover:text-[#e5e5e5] hover:bg-[#111]"
              }`}
            >
              {s === "all" ? `All (${reports.length})` : s.replace("_", " ")}
            </button>
          ))}
        </div>

        {/* Reports list */}
        {loading ? (
          <div className="text-center py-8 text-sm text-blade-muted">Loading reports…</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 rounded-2xl border border-blade-border bg-blade-surface">
            <div className="text-3xl mb-3">✅</div>
            <div className="text-sm text-blade-text">No {filter === "all" ? "" : `${filter} `}reports right now.</div>
            <div className="text-xs text-blade-muted mt-1">
              Blade will file a report here whenever it detects a capability gap, runtime failure, or user-friction moment worth triaging.
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map((r) => (
              <ReportCard key={r.id} report={r} onStatusChange={handleStatusChange} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
