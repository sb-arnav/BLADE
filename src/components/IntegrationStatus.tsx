// src/components/IntegrationStatus.tsx
// BLADE integration bridge status — Gmail, Calendar, Slack, GitHub.

import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

// ── Types ─────────────────────────────────────────────────────────────────────

interface IntegrationState {
  unread_emails: number;
  upcoming_events: number;
  slack_mentions: number;
  github_notifications: number;
  last_updated: string | null;
}

type ServiceKey = "gmail" | "calendar" | "slack" | "github";

interface ServiceConfig {
  key: ServiceKey;
  name: string;
  icon: string;
  dataLabel: (state: IntegrationState) => string;
  color: string;
}

const SERVICES: ServiceConfig[] = [
  {
    key: "gmail",
    name: "Gmail",
    icon: "✉",
    dataLabel: (s) => s.unread_emails === 0 ? "No unread emails" : `${s.unread_emails} unread email${s.unread_emails !== 1 ? "s" : ""}`,
    color: "text-red-400",
  },
  {
    key: "calendar",
    name: "Calendar",
    icon: "📅",
    dataLabel: (s) => s.upcoming_events === 0 ? "No upcoming events" : `${s.upcoming_events} upcoming event${s.upcoming_events !== 1 ? "s" : ""}`,
    color: "text-blue-400",
  },
  {
    key: "slack",
    name: "Slack",
    icon: "💬",
    dataLabel: (s) => s.slack_mentions === 0 ? "No unread mentions" : `${s.slack_mentions} mention${s.slack_mentions !== 1 ? "s" : ""}`,
    color: "text-purple-400",
  },
  {
    key: "github",
    name: "GitHub",
    icon: "🐙",
    dataLabel: (s) => s.github_notifications === 0 ? "No notifications" : `${s.github_notifications} notification${s.github_notifications !== 1 ? "s" : ""}`,
    color: "text-[rgba(255,255,255,0.7)]",
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatLastUpdated(ts: string | null): string {
  if (!ts) return "Never";
  const d = new Date(ts);
  if (isNaN(d.getTime())) return ts;
  const diff = Math.floor((Date.now() - d.getTime()) / 1000);
  if (diff < 60) return "Just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return d.toLocaleDateString();
}

function buildSummaryLine(state: IntegrationState, enabled: Record<ServiceKey, boolean>): string {
  const parts: string[] = [];

  if (enabled.gmail && state.unread_emails > 0) {
    parts.push(`${state.unread_emails} unread email${state.unread_emails !== 1 ? "s" : ""}`);
  }
  if (enabled.calendar && state.upcoming_events > 0) {
    parts.push(`${state.upcoming_events} upcoming event${state.upcoming_events !== 1 ? "s" : ""}`);
  }
  if (enabled.slack && state.slack_mentions > 0) {
    parts.push(`${state.slack_mentions} Slack mention${state.slack_mentions !== 1 ? "s" : ""}`);
  }
  if (enabled.github && state.github_notifications > 0) {
    parts.push(`${state.github_notifications} GitHub notification${state.github_notifications !== 1 ? "s" : ""}`);
  }

  if (parts.length === 0) return "All clear — nothing pending.";
  return parts.join(", ") + ".";
}

// ── Toggle switch ─────────────────────────────────────────────────────────────

function ToggleSwitch({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      onClick={() => !disabled && onChange(!checked)}
      disabled={disabled}
      className={`relative inline-flex w-9 h-5 rounded-full transition-colors duration-200 flex-shrink-0 focus:outline-none
        ${checked ? "bg-blade-accent" : "bg-blade-border"}
        ${disabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer"}`}
      role="switch"
      aria-checked={checked}
    >
      <span
        className={`inline-block w-3.5 h-3.5 rounded-full bg-white shadow transition-transform duration-200 mt-0.5
          ${checked ? "translate-x-4.5" : "translate-x-0.5"}`}
        style={{ marginLeft: checked ? "1.25rem" : "0.125rem", marginTop: "0.125rem" }}
      />
    </button>
  );
}

// ── Service card ──────────────────────────────────────────────────────────────

function ServiceCard({
  service,
  state,
  enabled,
  polling,
  onToggle,
  onPollNow,
}: {
  service: ServiceConfig;
  state: IntegrationState | null;
  enabled: boolean;
  polling: boolean;
  onToggle: (key: ServiceKey, value: boolean) => void;
  onPollNow: (key: ServiceKey) => void;
}) {
  return (
    <div className={`p-4 rounded-xl border transition-colors ${enabled ? "bg-blade-surface border-blade-border/60" : "bg-blade-bg border-blade-border/30 opacity-60"}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <span className={`text-xl flex-shrink-0 ${service.color}`}>{service.icon}</span>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-blade-text">{service.name}</span>
              <span className={`text-2xs px-1.5 py-0.5 rounded-full font-mono ${enabled ? "bg-green-900/40 text-green-400" : "bg-blade-border/30 text-blade-muted"}`}>
                {enabled ? "on" : "off"}
              </span>
            </div>
            {state && enabled && (
              <p className="text-xs text-blade-secondary mt-0.5 truncate">
                {service.dataLabel(state)}
              </p>
            )}
            {!enabled && (
              <p className="text-xs text-blade-muted mt-0.5">Integration disabled</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={() => onPollNow(service.key)}
            disabled={!enabled || polling}
            className="px-2 py-1 rounded-lg bg-blade-bg border border-blade-border text-2xs text-blade-muted hover:text-blade-text hover:border-blade-accent/60 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            title="Force poll now"
          >
            {polling ? "..." : "Poll"}
          </button>
          <ToggleSwitch
            checked={enabled}
            onChange={(v) => onToggle(service.key, v)}
          />
        </div>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface IntegrationStatusProps {
  onBack: () => void;
}

export function IntegrationStatus({ onBack }: IntegrationStatusProps) {
  const [state, setState] = useState<IntegrationState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [enabled, setEnabled] = useState<Record<ServiceKey, boolean>>({
    gmail: true,
    calendar: true,
    slack: true,
    github: true,
  });
  const [polling, setPolling] = useState<Record<ServiceKey, boolean>>({
    gmail: false,
    calendar: false,
    slack: false,
    github: false,
  });

  const fetchState = useCallback(async () => {
    setError(null);
    try {
      const s = await invoke<IntegrationState>("integration_get_state");
      setState(s);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchState();
  }, [fetchState]);

  const handleToggle = useCallback(async (service: ServiceKey, value: boolean) => {
    setEnabled((prev) => ({ ...prev, [service]: value }));
    try {
      await invoke("integration_toggle", { service, enabled: value });
    } catch {
      // Revert on error
      setEnabled((prev) => ({ ...prev, [service]: !value }));
    }
  }, []);

  const handlePollNow = useCallback(async (service: ServiceKey) => {
    setPolling((prev) => ({ ...prev, [service]: true }));
    try {
      await invoke("integration_poll_now", { service });
      await fetchState();
    } catch {
      // ignore
    } finally {
      setPolling((prev) => ({ ...prev, [service]: false }));
    }
  }, [fetchState]);

  const summaryLine = state ? buildSummaryLine(state, enabled) : null;

  return (
    <div className="flex flex-col h-full bg-blade-bg text-blade-text overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-3 border-b border-blade-border/60 flex-shrink-0">
        <button
          onClick={onBack}
          className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-blade-surface transition-colors text-blade-muted hover:text-blade-text"
          title="Back"
        >
          <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 5l-7 7 7 7" />
          </svg>
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="text-sm font-semibold text-blade-text">Integration Bridge</h1>
          <p className="text-2xs text-blade-muted">Gmail, Calendar, Slack, GitHub</p>
        </div>
        <button
          onClick={fetchState}
          className="px-2.5 py-1.5 rounded-lg bg-blade-surface border border-blade-border text-2xs text-blade-muted hover:text-blade-text transition-colors"
        >
          Refresh
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-5 space-y-4">

        {/* Summary line */}
        {summaryLine && !loading && (
          <div className="px-4 py-3 rounded-xl bg-blade-surface border border-blade-accent/20 flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-blade-accent flex-shrink-0" />
            <p className="text-xs text-blade-secondary">{summaryLine}</p>
          </div>
        )}

        {loading && (
          <div className="space-y-3 animate-pulse">
            {[0,1,2,3].map(i => (
              <div key={i} className="rounded-xl border border-blade-border/40 h-16 bg-blade-surface/40" />
            ))}
          </div>
        )}

        {!loading && error && (
          <div className="flex flex-col items-center justify-center py-10 gap-4 text-center">
            <div className="w-10 h-10 rounded-xl bg-red-900/20 border border-red-700/40 flex items-center justify-center">
              <svg viewBox="0 0 24 24" className="w-5 h-5 text-red-400" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <circle cx="12" cy="12" r="9" />
                <path d="M12 8v4M12 15v1" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-medium text-blade-secondary">Something went wrong</p>
              <p className="text-xs text-blade-muted mt-1 max-w-xs">Integration bridge could not be reached.</p>
            </div>
            <button
              onClick={fetchState}
              className="px-4 py-1.5 rounded-lg bg-blade-surface border border-blade-border text-xs text-blade-secondary hover:text-blade-text hover:border-blade-accent/60 transition-colors"
            >
              Retry
            </button>
          </div>
        )}

        {/* First-time empty state: state loaded but all zeros and last_updated is null */}
        {!loading && !error && state && state.last_updated === null && (
          <div className="rounded-xl border border-blade-accent/20 bg-blade-surface/40 p-5 mb-1">
            <p className="text-sm font-semibold text-blade-text mb-1">Connect your first service</p>
            <p className="text-xs text-blade-muted mb-4 leading-relaxed">
              BLADE can pull in unread emails, calendar events, Slack mentions, and GitHub notifications — all in one place.
            </p>
            <div className="space-y-2 text-xs text-blade-secondary">
              <div className="flex items-start gap-2.5">
                <span className="text-blade-accent font-bold shrink-0 mt-0.5">1.</span>
                <span>Toggle the service on below to enable it</span>
              </div>
              <div className="flex items-start gap-2.5">
                <span className="text-blade-accent font-bold shrink-0 mt-0.5">2.</span>
                <span>Hit <span className="font-mono bg-blade-border/30 px-1 rounded">Poll</span> to fetch the latest data right now</span>
              </div>
              <div className="flex items-start gap-2.5">
                <span className="text-blade-accent font-bold shrink-0 mt-0.5">3.</span>
                <span>BLADE will keep them up to date automatically in the background</span>
              </div>
            </div>
          </div>
        )}

        {/* Service cards */}
        {!loading && !error && (
          <div className="space-y-3">
            {SERVICES.map((service) => (
              <ServiceCard
                key={service.key}
                service={service}
                state={state}
                enabled={enabled[service.key]}
                polling={polling[service.key]}
                onToggle={handleToggle}
                onPollNow={handlePollNow}
              />
            ))}
          </div>
        )}

        {/* Last updated footer */}
        {state && !loading && (
          <p className="text-2xs text-blade-muted text-center pt-2">
            Last updated: {formatLastUpdated(state.last_updated)}
          </p>
        )}
      </div>
    </div>
  );
}
