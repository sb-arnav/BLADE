/**
 * DashboardGlance — BLADE's 6-card command center.
 *
 * Six cards only:
 *   1. Right Now  — active app + user state from perception
 *   2. Messages   — unread across all platforms
 *   3. Code       — open PRs, CI, last commit
 *   4. Today      — next meeting, screen time, breaks
 *   5. BLADE      — facts known, decisions made, streak
 *   6. Alerts     — anything needing attention
 */

import { useState, useEffect, useCallback, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

// ── Types ────────────────────────────────────────────────────────────────────

interface PerceptionState {
  active_app: string;
  active_title: string;
  user_state: string;
  delta_summary: string;
  context_tags: string[];
}

interface IntegrationState {
  unread_emails: number;
  upcoming_events: number;
  slack_mentions: number;
  github_notifications: number;
  last_updated: string | null;
}

interface HealthStats {
  current_streak_minutes: number;
  daily_total_minutes: number;
  breaks_taken: number;
  status: string;
}

interface SecurityOverview {
  network: { total_connections: number; suspicious_count: number };
  last_scan: string | null;
}

interface MemorySummary {
  total_facts: number;
  total_decisions: number;
  streak_days: number;
}

interface GitStatus {
  open_prs: number;
  last_commit: string | null;
  branch: string | null;
}

interface ProactiveTask {
  id: string;
  suggestion: string;
  category: string;
  created_at: number;
}

interface Props {
  onNavigate: (route: string) => void;
  onOpenChat: () => void;
}

// ── Design tokens ─────────────────────────────────────────────────────────────

const c = {
  bg:       "#000000",
  surface:  "#1c1c1e",
  border:   "rgba(255,255,255,0.06)",
  text:     "#ffffff",
  muted:    "#8e8e93",
  blue:     "#007AFF",
  purple:   "#5856D6",
  green:    "#30d158",
  orange:   "#ff9f0a",
  red:      "#ff453a",
  teal:     "#5ac8fa",
  yellow:   "#ffd60a",
} as const;

// ── Helpers ───────────────────────────────────────────────────────────────────

function userStateColor(state: string): string {
  if (state === "focused") return c.green;
  if (state === "idle")    return c.orange;
  return c.muted;
}

function userStateLabel(state: string): string {
  if (state === "focused") return "Focused";
  if (state === "idle")    return "Idle";
  if (state === "active")  return "Active";
  return state || "Unknown";
}

// ── Card wrapper ──────────────────────────────────────────────────────────────

function Card({
  title,
  accent = c.blue,
  onClick,
  children,
}: {
  title: string;
  accent?: string;
  onClick?: () => void;
  children: ReactNode;
}) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={`
        relative flex flex-col rounded-2xl text-left w-full
        transition-all duration-200
        ${onClick ? "active:scale-[0.99] hover:brightness-110" : ""}
      `}
      style={{
        background: c.surface,
        border: `1px solid ${c.border}`,
        boxShadow: "0 0 0 1px rgba(0,0,0,0.04), 0 2px 8px rgba(0,0,0,0.10)",
        padding: "18px 20px",
        minHeight: 140,
      }}
    >
      {/* Accent bar */}
      <span
        className="absolute top-0 left-6 right-6 h-[2px] rounded-b-full"
        style={{ background: `linear-gradient(90deg, ${accent}00, ${accent}60, ${accent}00)` }}
      />

      {/* Header */}
      <div className="flex items-center gap-2 mb-3">
        <span
          className="w-1.5 h-1.5 rounded-full shrink-0"
          style={{ background: accent }}
        />
        <span
          className="text-[10px] font-semibold uppercase tracking-[0.18em]"
          style={{ color: c.muted }}
        >
          {title}
        </span>
      </div>

      {children}
    </Tag>
  );
}

// ── Stat line ─────────────────────────────────────────────────────────────────

function Stat({
  label,
  value,
  color = c.text,
}: {
  label: string;
  value: ReactNode;
  color?: string;
}) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b" style={{ borderColor: c.border }}>
      <span className="text-xs" style={{ color: c.muted }}>{label}</span>
      <span className="text-xs font-semibold tabular-nums" style={{ color }}>{value}</span>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export function DashboardGlance({ onNavigate, onOpenChat }: Props) {
  const [perception, setPerception]   = useState<PerceptionState | null>(null);
  const [integration, setIntegration] = useState<IntegrationState | null>(null);
  const [health, setHealth]           = useState<HealthStats | null>(null);
  const [security, setSecurity]       = useState<SecurityOverview | null>(null);
  const [memory, setMemory]           = useState<MemorySummary | null>(null);
  const [git, setGit]                 = useState<GitStatus | null>(null);
  const [alerts, setAlerts]           = useState<ProactiveTask[]>([]);
  const [now, setNow]                 = useState(Date.now());

  // Clock tick
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const load = useCallback(async () => {
    const results = await Promise.allSettled([
      invoke<PerceptionState>("perception_get_state"),
      invoke<IntegrationState>("integration_get_state"),
      invoke<HealthStats>("health_get_stats"),
      invoke<SecurityOverview>("security_get_overview"),
      invoke<MemorySummary>("memory_get_summary"),
      invoke<GitStatus>("git_get_status"),
      invoke<ProactiveTask[]>("proactive_get_suggestions"),
    ]);

    if (results[0].status === "fulfilled") setPerception(results[0].value);
    if (results[1].status === "fulfilled") setIntegration(results[1].value);
    if (results[2].status === "fulfilled") setHealth(results[2].value);
    if (results[3].status === "fulfilled") setSecurity(results[3].value);
    if (results[4].status === "fulfilled") setMemory(results[4].value);
    if (results[5].status === "fulfilled") setGit(results[5].value);
    if (results[6].status === "fulfilled") setAlerts(results[6].value);
  }, []);

  useEffect(() => {
    load();

    // Refresh perception live
    const unlistenPerc = listen<PerceptionState>("god_mode_update", (e) => {
      setPerception(e.payload as unknown as PerceptionState);
    });

    // Refresh integration data
    const unlistenInt = listen<IntegrationState>("integration_updated", (e) => {
      setIntegration(e.payload);
    });

    // Proactive task added
    const unlistenTask = listen<ProactiveTask>("proactive_task_added", (e) => {
      setAlerts((prev) => [e.payload, ...prev].slice(0, 5));
    });

    // Refresh on interval
    const id = setInterval(load, 30_000);

    return () => {
      unlistenPerc.then((fn) => fn());
      unlistenInt.then((fn) => fn());
      unlistenTask.then((fn) => fn());
      clearInterval(id);
    };
  }, [load]);

  // Message total
  const totalUnread = integration
    ? integration.unread_emails + integration.slack_mentions + integration.github_notifications
    : 0;

  // Screen time
  const screenTimeHours = health
    ? Math.floor(health.daily_total_minutes / 60)
    : 0;
  const screenTimeMins  = health ? health.daily_total_minutes % 60 : 0;

  // Security status
  const securityOk = security ? security.network.suspicious_count === 0 : true;

  // Time of day greeting
  const hour = new Date(now).getHours();
  const greeting =
    hour < 5  ? "Still up?" :
    hour < 12 ? "Good morning" :
    hour < 17 ? "Good afternoon" :
    hour < 21 ? "Good evening" :
               "Good night";

  return (
    <div
      className="flex-1 min-h-0 overflow-y-auto"
      style={{ background: c.bg }}
    >
      <div className="max-w-4xl mx-auto px-6 py-6">
        {/* Page header */}
        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-white tracking-tight">{greeting}</h1>
          <p className="text-sm mt-0.5" style={{ color: c.muted }}>
            {new Date(now).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
          </p>
        </div>

        {/* 6-card grid: 2 columns, 3 rows */}
        <div className="grid grid-cols-2 gap-4">

          {/* ── Card 1: Right Now ── */}
          <Card
            title="Right Now"
            accent={perception ? userStateColor(perception.user_state) : c.muted}
            onClick={() => onNavigate("temporal")}
          >
            {perception ? (
              <>
                <div className="text-base font-semibold text-white leading-snug mb-1 truncate">
                  {perception.active_app || "Desktop"}
                </div>
                <div className="text-xs mb-3 truncate" style={{ color: c.muted }}>
                  {perception.active_title || "—"}
                </div>
                <div className="flex items-center gap-2 mt-auto">
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ background: userStateColor(perception.user_state) }}
                  />
                  <span className="text-xs font-medium" style={{ color: userStateColor(perception.user_state) }}>
                    {userStateLabel(perception.user_state)}
                  </span>
                </div>
                {perception.context_tags.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {perception.context_tags.slice(0, 3).map((tag) => (
                      <span
                        key={tag}
                        className="text-[10px] px-1.5 py-0.5 rounded-md"
                        style={{ background: "rgba(255,255,255,0.06)", color: c.muted }}
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <div className="text-sm" style={{ color: c.muted }}>Perception loading…</div>
            )}
          </Card>

          {/* ── Card 2: Messages ── */}
          <Card
            title="Messages"
            accent={totalUnread > 0 ? c.blue : c.muted}
            onClick={onOpenChat}
          >
            {integration ? (
              <>
                <div className="text-3xl font-bold text-white tabular-nums mb-3">
                  {totalUnread}
                  <span className="text-sm font-normal ml-1.5" style={{ color: c.muted }}>unread</span>
                </div>
                <div className="space-y-0">
                  <Stat label="Email" value={integration.unread_emails} color={integration.unread_emails > 0 ? c.blue : c.muted} />
                  <Stat label="Slack" value={integration.slack_mentions} color={integration.slack_mentions > 0 ? c.purple : c.muted} />
                  <Stat label="GitHub" value={integration.github_notifications} color={integration.github_notifications > 0 ? c.orange : c.muted} />
                </div>
              </>
            ) : (
              <div className="text-sm" style={{ color: c.muted }}>Connecting…</div>
            )}
          </Card>

          {/* ── Card 3: Code ── */}
          <Card
            title="Code"
            accent={c.teal}
            onClick={() => onNavigate("git")}
          >
            {git ? (
              <>
                <div className="text-base font-semibold text-white mb-3 truncate">
                  {git.branch ? `branch: ${git.branch}` : "No repo"}
                </div>
                <Stat label="Open PRs" value={git.open_prs} color={git.open_prs > 0 ? c.orange : c.green} />
                <Stat
                  label="Last commit"
                  value={
                    git.last_commit
                      ? git.last_commit.slice(0, 28) + (git.last_commit.length > 28 ? "…" : "")
                      : "—"
                  }
                  color={c.muted}
                />
              </>
            ) : (
              <>
                <div className="text-sm mb-3" style={{ color: c.muted }}>No repo data yet</div>
                <button
                  className="text-xs px-3 py-1.5 rounded-lg transition-colors"
                  style={{ background: `${c.teal}18`, color: c.teal, border: `1px solid ${c.teal}30` }}
                  onClick={(e) => { e.stopPropagation(); onNavigate("git"); }}
                >
                  Open Git
                </button>
              </>
            )}
          </Card>

          {/* ── Card 4: Today ── */}
          <Card
            title="Today"
            accent={c.yellow}
            onClick={() => onNavigate("meetings")}
          >
            {health ? (
              <>
                <div className="text-base font-semibold text-white mb-3">
                  {integration?.upcoming_events
                    ? `${integration.upcoming_events} event${integration.upcoming_events !== 1 ? "s" : ""} left`
                    : "Calendar clear"}
                </div>
                <Stat
                  label="Screen time"
                  value={`${screenTimeHours}h ${screenTimeMins}m`}
                  color={health.daily_total_minutes > 360 ? c.orange : c.muted}
                />
                <Stat
                  label="Breaks taken"
                  value={health.breaks_taken}
                  color={health.breaks_taken > 0 ? c.green : c.orange}
                />
                <Stat
                  label="Status"
                  value={health.status || "OK"}
                  color={health.status === "overdue_break" ? c.red : c.green}
                />
              </>
            ) : (
              <div className="text-sm" style={{ color: c.muted }}>Loading health…</div>
            )}
          </Card>

          {/* ── Card 5: BLADE ── */}
          <Card
            title="BLADE"
            accent={c.purple}
            onClick={() => onNavigate("character")}
          >
            {memory ? (
              <>
                <div className="flex items-end gap-1 mb-3">
                  <span className="text-3xl font-bold text-white tabular-nums">{memory.streak_days}</span>
                  <span className="text-sm pb-0.5" style={{ color: c.muted }}>day streak</span>
                </div>
                <Stat label="Facts known" value={memory.total_facts.toLocaleString()} color={c.purple} />
                <Stat label="Decisions logged" value={memory.total_decisions.toLocaleString()} color={c.muted} />
              </>
            ) : (
              <div className="text-sm" style={{ color: c.muted }}>Loading memory…</div>
            )}
          </Card>

          {/* ── Card 6: Alerts ── */}
          <Card
            title="Alerts"
            accent={securityOk && alerts.length === 0 ? c.green : c.red}
            onClick={() => onNavigate("security")}
          >
            {!securityOk && security && (
              <div
                className="flex items-center gap-2 rounded-lg px-3 py-2 mb-2 text-xs"
                style={{ background: `${c.red}12`, border: `1px solid ${c.red}25`, color: c.red }}
              >
                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: c.red }} />
                {security.network.suspicious_count} suspicious connection{security.network.suspicious_count !== 1 ? "s" : ""}
              </div>
            )}
            {alerts.length > 0 ? (
              <div className="space-y-2">
                {alerts.slice(0, 3).map((a) => (
                  <div
                    key={a.id}
                    className="text-xs rounded-lg px-3 py-2"
                    style={{ background: "rgba(255,255,255,0.04)", color: c.muted }}
                  >
                    {a.suggestion.slice(0, 80)}{a.suggestion.length > 80 ? "…" : ""}
                  </div>
                ))}
              </div>
            ) : securityOk ? (
              <div className="flex items-center gap-2 mt-auto">
                <span className="w-2 h-2 rounded-full" style={{ background: c.green }} />
                <span className="text-sm font-medium" style={{ color: c.green }}>All clear</span>
              </div>
            ) : null}
          </Card>

        </div>

        {/* Quick actions row */}
        <div className="mt-6 flex items-center gap-3">
          <span className="text-xs font-semibold uppercase tracking-[0.18em] shrink-0" style={{ color: c.muted }}>
            Quick
          </span>
          <div className="flex gap-2 flex-wrap">
            {[
              { label: "Terminal", route: "terminal", color: c.teal },
              { label: "Agents", route: "bg-agents", color: c.purple },
              { label: "Finance", route: "finance", color: c.green },
              { label: "Security", route: "security", color: c.orange },
              { label: "Timeline", route: "temporal", color: c.blue },
            ].map((a) => (
              <button
                key={a.route}
                onClick={() => onNavigate(a.route)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200 active:scale-95"
                style={{
                  background: `${a.color}10`,
                  border: `1px solid ${a.color}25`,
                  color: a.color,
                }}
              >
                {a.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
