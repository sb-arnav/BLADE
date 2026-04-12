import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

// ── Types ──────────────────────────────────────────────────────────────────

interface EvolutionLevel {
  level: number;
  score: number;
  breakdown: string[];
  next_unlock: string | null;
}

interface BackgroundAgent {
  id: string;
  agent_type: string;
  task: string;
  cwd: string;
  status: "Running" | "Completed" | "Failed" | "Cancelled";
  output: string[];
  exit_code: number | null;
  started_at: number;
  finished_at: number | null;
}

interface CronTask {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  last_run: number | null;
  next_run: number | null;
  run_count: number;
}

interface TimelineStats {
  total_entries: number;
  disk_bytes: number;
  oldest_timestamp: number | null;
  newest_timestamp: number | null;
}

interface BladeConfig {
  god_mode: boolean;
  wake_word_enabled: boolean;
  screen_timeline_enabled: boolean;
  provider: string;
  model: string;
}

interface SoulState {
  preferences: { id: string }[];
  snapshots: { id: number }[];
}

interface DashboardData {
  level: EvolutionLevel | null;
  agents: BackgroundAgent[];
  crons: CronTask[];
  timeline: TimelineStats | null;
  config: BladeConfig | null;
  wakeWordActive: boolean;
  prefCount: number;
  snapshotCount: number;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function fmt(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function relTime(ts: number | null): string {
  if (!ts) return "never";
  const diff = Math.floor(Date.now() / 1000) - ts;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function countdown(ts: number | null): string {
  if (!ts) return "—";
  const diff = ts - Math.floor(Date.now() / 1000);
  if (diff <= 0) return "now";
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ${Math.floor((diff % 3600) / 60)}m`;
  return `${Math.floor(diff / 86400)}d`;
}

// ── Sub-components ─────────────────────────────────────────────────────────

function StatusPill({
  active,
  label,
  dim,
}: {
  active: boolean;
  label: string;
  dim?: boolean;
}) {
  return (
    <div
      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-medium border transition-colors ${
        active
          ? "border-blade-accent/40 bg-blade-accent/10 text-blade-accent"
          : dim
          ? "border-blade-border/40 bg-transparent text-blade-muted/40"
          : "border-blade-border bg-blade-surface text-blade-muted"
      }`}
    >
      <div
        className={`w-1.5 h-1.5 rounded-full ${
          active ? "bg-blade-accent animate-pulse" : "bg-blade-muted/30"
        }`}
      />
      {label}
    </div>
  );
}

function Card({
  title,
  children,
  className = "",
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`bg-blade-surface border border-blade-border rounded-lg p-4 ${className}`}>
      <div className="text-[10px] uppercase tracking-widest text-blade-muted mb-3">{title}</div>
      {children}
    </div>
  );
}

function AgentRow({ agent }: { agent: BackgroundAgent }) {
  const statusColor = {
    Running: "text-blade-accent",
    Completed: "text-green-400",
    Failed: "text-red-400",
    Cancelled: "text-blade-muted",
  }[agent.status];

  const typeIcon = {
    "claude-code": "⚡",
    "aider": "🔧",
    "goose": "🪿",
  }[agent.agent_type] ?? "🤖";

  return (
    <div className="flex items-start gap-3 py-2 border-b border-blade-border/40 last:border-0">
      <span className="text-sm shrink-0 mt-0.5">{typeIcon}</span>
      <div className="flex-1 min-w-0">
        <div className="text-xs text-blade-text truncate">{agent.task}</div>
        <div className="text-[10px] text-blade-muted mt-0.5">
          {agent.agent_type} · started {relTime(agent.started_at)}
        </div>
      </div>
      <div className={`text-[10px] font-medium shrink-0 ${statusColor}`}>
        {agent.status === "Running" && (
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-blade-accent animate-pulse mr-1" />
        )}
        {agent.status}
      </div>
    </div>
  );
}

function CronRow({ task }: { task: CronTask }) {
  return (
    <div className="flex items-center gap-3 py-2 border-b border-blade-border/40 last:border-0">
      <div
        className={`w-1.5 h-1.5 rounded-full shrink-0 ${
          task.enabled ? "bg-blade-accent" : "bg-blade-muted/30"
        }`}
      />
      <div className="flex-1 min-w-0">
        <div className="text-xs text-blade-text truncate">{task.name}</div>
        <div className="text-[10px] text-blade-muted mt-0.5">
          run {task.run_count}× · last {relTime(task.last_run)}
        </div>
      </div>
      <div className="text-[10px] font-mono text-blade-accent shrink-0">
        {task.enabled ? `in ${countdown(task.next_run)}` : "paused"}
      </div>
    </div>
  );
}

// ── Main dashboard ─────────────────────────────────────────────────────────

interface Props {
  onBack: () => void;
  onNavigate: (route: string) => void;
}

export function Dashboard({ onBack, onNavigate }: Props) {
  const [data, setData] = useState<DashboardData>({
    level: null,
    agents: [],
    crons: [],
    timeline: null,
    config: null,
    wakeWordActive: false,
    prefCount: 0,
    snapshotCount: 0,
  });
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(Date.now());

  // Tick every second for live countdowns
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  const load = useCallback(async () => {
    const [level, agents, crons, timeline, config, wakeWordActive, soul] = await Promise.allSettled([
      invoke<EvolutionLevel>("evolution_get_level"),
      invoke<BackgroundAgent[]>("agent_list_background"),
      invoke<CronTask[]>("cron_list"),
      invoke<TimelineStats>("timeline_get_stats_cmd"),
      invoke<BladeConfig>("get_config"),
      invoke<boolean>("wake_word_status"),
      invoke<SoulState>("soul_get_state"),
    ]);

    setData({
      level: level.status === "fulfilled" ? level.value : null,
      agents: agents.status === "fulfilled" ? agents.value : [],
      crons: crons.status === "fulfilled" ? crons.value : [],
      timeline: timeline.status === "fulfilled" ? timeline.value : null,
      config: config.status === "fulfilled" ? config.value : null,
      wakeWordActive: wakeWordActive.status === "fulfilled" ? wakeWordActive.value : false,
      prefCount: soul.status === "fulfilled" ? soul.value.preferences.length : 0,
      snapshotCount: soul.status === "fulfilled" ? soul.value.snapshots.length : 0,
    });
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 10_000);
    return () => clearInterval(interval);
  }, [load]);

  const runningAgents = data.agents.filter((a) => a.status === "Running");
  const enabledCrons = data.crons.filter((c) => c.enabled);
  const level = data.level;
  const cfg = data.config;

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center text-blade-muted text-sm">
        Loading…
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-blade-bg text-blade-text">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-blade-border shrink-0">
        <button onClick={onBack} className="text-blade-muted hover:text-blade-text transition-colors text-sm">
          ← Back
        </button>
        <div className="flex-1">
          <div className="text-sm font-semibold">Dashboard</div>
          <div className="text-[10px] text-blade-muted">Mission control — everything BLADE is doing right now</div>
        </div>
        <button
          onClick={load}
          className="text-[10px] text-blade-muted hover:text-blade-text transition-colors px-2"
        >
          Refresh
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-4 pt-3 space-y-3">

        {/* Level + status pills */}
        <Card title="BLADE Status">
          <div className="flex items-center gap-4 mb-3">
            <div className="text-3xl font-bold text-blade-accent tabular-nums">
              {level?.level ?? 0}
            </div>
            <div>
              <div className="text-xs text-blade-text font-medium">
                Level {level?.level ?? 0} · {level?.score ?? 0} pts
              </div>
              {level?.next_unlock && (
                <div className="text-[10px] text-blade-muted mt-0.5">
                  Next: {level.next_unlock}
                </div>
              )}
            </div>
            {/* XP bar */}
            <div className="flex-1">
              <div className="h-1.5 bg-blade-border rounded-full overflow-hidden">
                <div
                  className="h-full bg-blade-accent transition-all duration-500"
                  style={{ width: `${Math.min(100, ((level?.score ?? 0) % 10) * 10)}%` }}
                />
              </div>
            </div>
          </div>

          {/* Active subsystems */}
          <div className="flex flex-wrap gap-2">
            <StatusPill active={!!cfg?.god_mode} label="God Mode" />
            <StatusPill active={data.wakeWordActive} label="Wake Word" />
            <StatusPill active={!!cfg?.screen_timeline_enabled} label="Total Recall" />
            <StatusPill active={runningAgents.length > 0} label={`${runningAgents.length} agents`} />
            <StatusPill active={enabledCrons.length > 0} label={`${enabledCrons.length} crons`} />
            <StatusPill
              active={false}
              label={cfg ? `${cfg.provider} / ${cfg.model.split("-").slice(0, 2).join("-")}` : "no model"}
            />
          </div>

          {/* Level breakdown */}
          {level && level.breakdown.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {level.breakdown.map((item, i) => (
                <span
                  key={i}
                  className="text-[9px] px-1.5 py-0.5 rounded bg-blade-accent/10 text-blade-accent border border-blade-accent/20"
                >
                  {item}
                </span>
              ))}
            </div>
          )}
        </Card>

        {/* 2-col grid */}
        <div className="grid grid-cols-2 gap-3">

          {/* Memory */}
          <Card title="Memory">
            <div className="space-y-2">
              <div className="flex justify-between items-baseline">
                <span className="text-[10px] text-blade-muted">Preferences learned</span>
                <span className="text-sm font-semibold text-blade-text tabular-nums">{data.prefCount}</span>
              </div>
              <div className="flex justify-between items-baseline">
                <span className="text-[10px] text-blade-muted">Soul snapshots</span>
                <span className="text-sm font-semibold text-blade-text tabular-nums">{data.snapshotCount}</span>
              </div>
            </div>
            <button
              onClick={() => onNavigate("soul")}
              className="mt-3 w-full text-[10px] text-blade-muted hover:text-blade-accent transition-colors text-left"
            >
              View SOUL →
            </button>
          </Card>

          {/* Total Recall */}
          <Card title="Total Recall">
            {cfg?.screen_timeline_enabled && data.timeline ? (
              <div className="space-y-2">
                <div className="flex justify-between items-baseline">
                  <span className="text-[10px] text-blade-muted">Screenshots</span>
                  <span className="text-sm font-semibold text-blade-text tabular-nums">
                    {data.timeline.total_entries.toLocaleString()}
                  </span>
                </div>
                <div className="flex justify-between items-baseline">
                  <span className="text-[10px] text-blade-muted">Disk</span>
                  <span className="text-sm font-semibold text-blade-text">{fmt(data.timeline.disk_bytes)}</span>
                </div>
                <div className="flex justify-between items-baseline">
                  <span className="text-[10px] text-blade-muted">Last capture</span>
                  <span className="text-xs text-blade-secondary">{relTime(data.timeline.newest_timestamp)}</span>
                </div>
              </div>
            ) : (
              <div className="text-xs text-blade-muted italic">
                {cfg?.screen_timeline_enabled ? "No captures yet." : "Disabled — enable in Settings."}
              </div>
            )}
            <button
              onClick={() => onNavigate("screen-timeline")}
              className="mt-3 w-full text-[10px] text-blade-muted hover:text-blade-accent transition-colors text-left"
            >
              View timeline →
            </button>
          </Card>
        </div>

        {/* Active agents */}
        <Card title={`Agents (${data.agents.length})`}>
          {data.agents.length === 0 ? (
            <div className="text-xs text-blade-muted italic">
              No agents running. Launch a swarm or spawn a background agent.
            </div>
          ) : (
            <div>
              {data.agents.slice(0, 6).map((a) => (
                <AgentRow key={a.id} agent={a} />
              ))}
              {data.agents.length > 6 && (
                <div className="text-[10px] text-blade-muted pt-2">
                  +{data.agents.length - 6} more
                </div>
              )}
            </div>
          )}
          <div className="flex gap-3 mt-3">
            <button
              onClick={() => onNavigate("swarm")}
              className="text-[10px] text-blade-muted hover:text-blade-accent transition-colors"
            >
              Open Swarm →
            </button>
            <button
              onClick={() => onNavigate("bg-agents")}
              className="text-[10px] text-blade-muted hover:text-blade-accent transition-colors"
            >
              Background agents →
            </button>
          </div>
        </Card>

        {/* Cron queue */}
        <Card title={`Scheduled tasks (${data.crons.length})`}>
          {data.crons.length === 0 ? (
            <div className="text-xs text-blade-muted italic">
              No scheduled tasks. Add one in the Cron panel.
            </div>
          ) : (
            <div>
              {data.crons.slice(0, 5).map((c) => (
                <CronRow key={c.id} task={c} />
              ))}
              {data.crons.length > 5 && (
                <div className="text-[10px] text-blade-muted pt-2">
                  +{data.crons.length - 5} more
                </div>
              )}
            </div>
          )}
        </Card>

        {/* Evolution breakdown */}
        {level?.next_unlock && (
          <Card title="Evolution — next unlock">
            <div className="text-xs text-blade-secondary">{level.next_unlock}</div>
            <div className="mt-2 h-1 bg-blade-border rounded-full overflow-hidden">
              <div
                className="h-full bg-blade-accent/60 transition-all duration-500"
                style={{ width: `${Math.min(100, ((level.score % 10) / 10) * 100)}%` }}
              />
            </div>
            <div className="text-[10px] text-blade-muted mt-1">
              {10 - (level.score % 10)} pts to next level
            </div>
          </Card>
        )}

        {/* Hidden ticker to force re-render for countdown */}
        <span className="hidden">{now}</span>
      </div>
    </div>
  );
}
