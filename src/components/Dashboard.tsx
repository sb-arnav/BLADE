import { useState, useEffect, useCallback, type CSSProperties, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";

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

interface Props {
  onBack: () => void;
  onNavigate: (route: string) => void;
}

const palette = {
  bg: "#0a0a0a",
  panel: "#10150f",
  panelAlt: "#0d120d",
  green: "#00ff41",
  amber: "#ffb000",
  red: "#ff0040",
  line: "rgba(0, 255, 65, 0.24)",
  dim: "rgba(0, 255, 65, 0.54)",
  muted: "rgba(164, 255, 188, 0.74)",
  glow: "rgba(0, 255, 65, 0.18)",
} as const;

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

function tickStyle(delay = "0s"): CSSProperties {
  return {
    animation: `dashboard-tick 1.1s steps(2, end) infinite`,
    animationDelay: delay,
  };
}

function PixelStatus({
  active,
  label,
  color = palette.green,
}: {
  active: boolean;
  label: string;
  color?: string;
}) {
  const inactiveColor = "rgba(0, 255, 65, 0.18)";

  return (
    <div
      className="flex min-h-[2.25rem] items-center gap-2 border px-2 py-1 uppercase tracking-[0.22em]"
      style={{
        borderColor: active ? color : palette.line,
        backgroundColor: active ? `${color}12` : "rgba(0,0,0,0.18)",
        boxShadow: active ? `inset 0 0 0 1px ${color}33, 0 0 12px ${color}22` : "none",
        color: active ? color : palette.muted,
      }}
    >
      <div className="grid grid-cols-2 gap-[2px] shrink-0">
        {Array.from({ length: 4 }).map((_, i) => (
          <span
            key={i}
            className="block h-[6px] w-[6px]"
            style={{
              backgroundColor: active ? color : inactiveColor,
              opacity: active ? 1 : 0.55,
              animation: active ? "dashboard-blink 1.6s steps(2, end) infinite" : undefined,
              animationDelay: `${i * 0.08}s`,
            }}
          />
        ))}
      </div>
      <span className="text-[10px] font-bold">{label}</span>
    </div>
  );
}

function SectionFrame({
  title,
  children,
  className = "",
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`relative overflow-hidden border p-4 ${className}`}
      style={{
        borderColor: palette.line,
        background: `linear-gradient(180deg, ${palette.panel} 0%, ${palette.panelAlt} 100%)`,
        boxShadow: `inset 0 0 0 1px rgba(0, 255, 65, 0.06), 0 0 18px ${palette.glow}`,
      }}
    >
      <div
        className="pointer-events-none absolute inset-0 opacity-30"
        style={{
          background:
            "repeating-linear-gradient(180deg, rgba(255,255,255,0.02) 0px, rgba(255,255,255,0.02) 1px, transparent 1px, transparent 3px)",
        }}
      />
      <div className="relative">
        <div className="mb-4 text-[11px] font-bold uppercase tracking-[0.28em]" style={{ color: palette.amber }}>
          {`=== ${title} ===`}
        </div>
        {children}
      </div>
    </section>
  );
}

function StatLine({
  label,
  value,
  accent = palette.green,
}: {
  label: string;
  value: ReactNode;
  accent?: string;
}) {
  return (
    <div
      className="flex items-end justify-between gap-4 border-b pb-2 text-[11px] uppercase tracking-[0.18em]"
      style={{ borderColor: "rgba(0, 255, 65, 0.14)" }}
    >
      <span style={{ color: palette.muted }}>{label}</span>
      <span className="text-right text-base font-bold tabular-nums" style={{ color: accent, ...tickStyle() }}>
        {value}
      </span>
    </div>
  );
}

function AgentRow({ agent }: { agent: BackgroundAgent }) {
  const statusColor = {
    Running: palette.green,
    Completed: palette.amber,
    Failed: palette.red,
    Cancelled: "rgba(160, 255, 180, 0.5)",
  }[agent.status];

  return (
    <div
      className="grid grid-cols-[5rem_minmax(0,1fr)_6.5rem] gap-3 border-b px-2 py-2 text-[11px] uppercase tracking-[0.14em]"
      style={{ borderColor: "rgba(0, 255, 65, 0.14)" }}
    >
      <div style={{ color: palette.amber }}>
        <div>PID {agent.id.slice(0, 4)}</div>
        <div className="mt-1 text-[10px]" style={{ color: palette.muted }}>
          {agent.agent_type}
        </div>
      </div>
      <div className="min-w-0">
        <div className="truncate font-bold" style={{ color: "#d5ffd8" }}>
          {agent.task}
        </div>
        <div className="mt-1 truncate text-[10px]" style={{ color: palette.dim }}>
          CWD {agent.cwd}
        </div>
      </div>
      <div className="text-right">
        <div className="flex items-center justify-end gap-2 font-bold" style={{ color: statusColor }}>
          <span
            className="block h-2.5 w-2.5 shrink-0"
            style={{
              backgroundColor: statusColor,
              boxShadow: `0 0 10px ${statusColor}66`,
              animation: agent.status === "Running" ? "dashboard-blink 1.1s steps(2, end) infinite" : undefined,
            }}
          />
          <span>{agent.status}</span>
        </div>
        <div className="mt-1 text-[10px]" style={{ color: palette.muted }}>
          {relTime(agent.started_at)}
        </div>
      </div>
    </div>
  );
}

function CronRow({ task }: { task: CronTask }) {
  const cronColor = task.enabled ? palette.green : palette.red;

  return (
    <div
      className="grid grid-cols-[1.2rem_minmax(0,1fr)_6rem] gap-3 border-b px-2 py-2 text-[11px] uppercase tracking-[0.14em]"
      style={{ borderColor: "rgba(0, 255, 65, 0.14)" }}
    >
      <div
        className="mt-[2px] h-3 w-3"
        style={{
          backgroundColor: cronColor,
          opacity: task.enabled ? 1 : 0.85,
          boxShadow: `0 0 10px ${cronColor}55`,
        }}
      />
      <div className="min-w-0">
        <div className="truncate font-bold" style={{ color: "#d5ffd8" }}>
          {`*/${Math.max(1, task.run_count || 1)} * * * * ${task.name}`}
        </div>
        <div className="mt-1 truncate text-[10px]" style={{ color: palette.dim }}>
          {task.description || `last ${relTime(task.last_run)}`}
        </div>
      </div>
      <div className="text-right">
        <div className="font-bold" style={{ color: cronColor, ...tickStyle("0.2s") }}>
          {task.enabled ? `IN ${countdown(task.next_run)}` : "PAUSED"}
        </div>
        <div className="mt-1 text-[10px]" style={{ color: palette.muted }}>
          RUN {task.run_count}X
        </div>
      </div>
    </div>
  );
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
  const xpBlockCount = 20;
  const xpProgress = Math.min(100, ((level?.score ?? 0) % 10) * 10);
  const xpFilledBlocks = Math.round((xpProgress / 100) * xpBlockCount);

  if (loading) {
    return (
      <div
        className="flex h-full items-center justify-center font-mono text-sm uppercase tracking-[0.3em]"
        style={{
          color: palette.green,
          backgroundColor: palette.bg,
          textShadow: `0 0 10px ${palette.green}88`,
        }}
      >
        Booting dashboard...
      </div>
    );
  }

  return (
    <div
      className="relative flex h-full flex-col overflow-hidden font-mono"
      style={{
        background:
          "radial-gradient(circle at top, rgba(0,255,65,0.1) 0%, rgba(0,255,65,0.02) 18%, rgba(10,10,10,1) 55%), #0a0a0a",
        color: palette.green,
      }}
    >
      <style>{`
        @keyframes dashboard-blink {
          0%, 49% { opacity: 1; }
          50%, 100% { opacity: 0.45; }
        }
        @keyframes dashboard-tick {
          0%, 20% { transform: translateY(0); opacity: 0.9; }
          21% { transform: translateY(-1px); opacity: 1; }
          22%, 100% { transform: translateY(0); opacity: 0.9; }
        }
        @keyframes dashboard-flicker {
          0%, 100% { opacity: 0.18; }
          50% { opacity: 0.24; }
        }
      `}</style>

      <div
        className="pointer-events-none absolute inset-0 opacity-40"
        style={{
          background:
            "repeating-linear-gradient(180deg, rgba(255,255,255,0.045) 0px, rgba(255,255,255,0.045) 1px, transparent 1px, transparent 4px)",
          animation: "dashboard-flicker 4s linear infinite",
        }}
      />
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          boxShadow: "inset 0 0 90px rgba(0, 0, 0, 0.72)",
        }}
      />

      <header
        className="relative z-10 flex shrink-0 items-center gap-3 border-b px-4 py-3"
        style={{ borderColor: palette.line, backgroundColor: "rgba(10, 16, 10, 0.92)" }}
      >
        <button
          onClick={onBack}
          className="border px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] transition-colors"
          style={{ borderColor: palette.line, color: palette.amber }}
        >
          &lt; Back
        </button>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold uppercase tracking-[0.32em]" style={{ color: "#d5ffd8" }}>
            BLADE Dashboard
          </div>
          <div className="mt-1 text-[10px] uppercase tracking-[0.2em]" style={{ color: palette.dim }}>
            Mission control online | auto-refresh 10s | CRT telemetry feed
          </div>
        </div>
        <button
          onClick={load}
          className="border px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] transition-colors"
          style={{ borderColor: palette.line, color: palette.green }}
        >
          Refresh
        </button>
      </header>

      <div className="relative z-10 flex-1 overflow-y-auto px-4 pb-4 pt-3">
        <div className="space-y-3">
          <SectionFrame title="BLADE STATUS">
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(16rem,0.85fr)]">
              <div className="space-y-4">
                <div className="flex flex-wrap items-end justify-between gap-4 border-b pb-3" style={{ borderColor: palette.line }}>
                  <div>
                    <div className="text-[10px] uppercase tracking-[0.22em]" style={{ color: palette.amber }}>
                      LEVEL
                    </div>
                    <div
                      className="mt-1 text-5xl font-bold leading-none tabular-nums"
                      style={{ color: palette.green, textShadow: `0 0 16px ${palette.green}88`, ...tickStyle() }}
                    >
                      {level?.level ?? 0}
                    </div>
                  </div>
                  <div className="min-w-[14rem] flex-1">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] uppercase tracking-[0.18em]">
                      <span style={{ color: "#d5ffd8" }}>{`XP ${(level?.score ?? 0).toLocaleString()}`}</span>
                      <span style={{ color: palette.amber }}>
                        {level?.next_unlock ? `NEXT ${level.next_unlock}` : "NEXT UNKNOWN"}
                      </span>
                    </div>
                    <div className="mt-3 grid grid-cols-10 gap-1 sm:grid-cols-20">
                      {Array.from({ length: xpBlockCount }).map((_, index) => {
                        const filled = index < xpFilledBlocks;
                        return (
                          <div
                            key={index}
                            className="h-4 border"
                            style={{
                              borderColor: filled ? `${palette.green}99` : "rgba(0, 255, 65, 0.14)",
                              backgroundColor: filled ? palette.green : "rgba(0, 255, 65, 0.05)",
                              boxShadow: filled ? `0 0 10px ${palette.green}55` : "none",
                            }}
                          />
                        );
                      })}
                    </div>
                    <div className="mt-2 text-[10px] uppercase tracking-[0.18em]" style={{ color: palette.muted }}>
                      Progress to next checkpoint: {xpProgress}%
                    </div>
                  </div>
                </div>

                <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                  <PixelStatus active={!!cfg?.god_mode} label="God Mode" color={palette.amber} />
                  <PixelStatus active={data.wakeWordActive} label="Wake Word" />
                  <PixelStatus active={!!cfg?.screen_timeline_enabled} label="Total Recall" />
                  <PixelStatus active={runningAgents.length > 0} label={`${runningAgents.length} Agents`} />
                  <PixelStatus active={enabledCrons.length > 0} label={`${enabledCrons.length} Crons`} />
                  <PixelStatus
                    active={false}
                    label={cfg ? `${cfg.provider} / ${cfg.model.split("-").slice(0, 2).join("-")}` : "No Model"}
                    color={palette.red}
                  />
                </div>
              </div>

              <div
                className="border p-3"
                style={{ borderColor: palette.line, backgroundColor: "rgba(0, 0, 0, 0.22)" }}
              >
                <div className="text-[10px] uppercase tracking-[0.22em]" style={{ color: palette.amber }}>
                  LEVEL LOG
                </div>
                {level && level.breakdown.length > 0 ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {level.breakdown.map((item, i) => (
                      <span
                        key={i}
                        className="border px-2 py-1 text-[10px] uppercase tracking-[0.16em]"
                        style={{
                          borderColor: palette.line,
                          color: palette.green,
                          backgroundColor: "rgba(0, 255, 65, 0.08)",
                        }}
                      >
                        {item}
                      </span>
                    ))}
                  </div>
                ) : (
                  <div className="mt-3 text-[11px] uppercase tracking-[0.16em]" style={{ color: palette.muted }}>
                    No score events recorded.
                  </div>
                )}
              </div>
            </div>
          </SectionFrame>

          <div className="grid gap-3 lg:grid-cols-2">
            <SectionFrame title="MEMORY">
              <div className="space-y-3">
                <StatLine label="Preferences Learned" value={data.prefCount} />
                <StatLine label="Soul Snapshots" value={data.snapshotCount} accent={palette.amber} />
              </div>
              <button
                onClick={() => onNavigate("soul")}
                className="mt-4 border px-3 py-2 text-[11px] font-bold uppercase tracking-[0.2em]"
                style={{ borderColor: palette.line, color: palette.green }}
              >
                Open Soul &gt;
              </button>
            </SectionFrame>

            <SectionFrame title="TOTAL RECALL">
              {cfg?.screen_timeline_enabled && data.timeline ? (
                <div className="space-y-3">
                  <StatLine label="Screenshots" value={data.timeline.total_entries.toLocaleString()} />
                  <StatLine label="Disk Usage" value={fmt(data.timeline.disk_bytes)} accent={palette.amber} />
                  <StatLine label="Last Capture" value={relTime(data.timeline.newest_timestamp)} />
                </div>
              ) : (
                <div className="text-[11px] uppercase tracking-[0.16em]" style={{ color: palette.muted }}>
                  {cfg?.screen_timeline_enabled ? "No captures yet." : "Disabled. Enable in settings."}
                </div>
              )}
              <button
                onClick={() => onNavigate("screen-timeline")}
                className="mt-4 border px-3 py-2 text-[11px] font-bold uppercase tracking-[0.2em]"
                style={{ borderColor: palette.line, color: palette.green }}
              >
                Open Timeline &gt;
              </button>
            </SectionFrame>
          </div>

          <SectionFrame title={`ACTIVE AGENTS [${data.agents.length}]`}>
            {data.agents.length === 0 ? (
              <div className="text-[11px] uppercase tracking-[0.16em]" style={{ color: palette.muted }}>
                No agents running. Launch a swarm or spawn a background agent.
              </div>
            ) : (
              <div className="border" style={{ borderColor: palette.line, backgroundColor: "rgba(0, 0, 0, 0.22)" }}>
                <div
                  className="grid grid-cols-[5rem_minmax(0,1fr)_6.5rem] gap-3 border-b px-2 py-2 text-[10px] font-bold uppercase tracking-[0.24em]"
                  style={{ borderColor: palette.line, color: palette.amber }}
                >
                  <div>PID / TYPE</div>
                  <div>Agent Task / CWD</div>
                  <div className="text-right">Status</div>
                </div>
                {data.agents.slice(0, 6).map((a) => (
                  <AgentRow key={a.id} agent={a} />
                ))}
              </div>
            )}
            {data.agents.length > 6 && (
              <div className="mt-3 text-[10px] uppercase tracking-[0.18em]" style={{ color: palette.muted }}>
                +{data.agents.length - 6} more processes queued off-screen
              </div>
            )}
            <div className="mt-4 flex flex-wrap gap-3">
              <button
                onClick={() => onNavigate("swarm")}
                className="border px-3 py-2 text-[11px] font-bold uppercase tracking-[0.2em]"
                style={{ borderColor: palette.line, color: palette.green }}
              >
                Open Swarm &gt;
              </button>
              <button
                onClick={() => onNavigate("bg-agents")}
                className="border px-3 py-2 text-[11px] font-bold uppercase tracking-[0.2em]"
                style={{ borderColor: palette.line, color: palette.amber }}
              >
                Background Agents &gt;
              </button>
            </div>
          </SectionFrame>

          <SectionFrame title={`CRON QUEUE [${data.crons.length}]`}>
            {data.crons.length === 0 ? (
              <div className="text-[11px] uppercase tracking-[0.16em]" style={{ color: palette.muted }}>
                No scheduled tasks. Add one in the cron panel.
              </div>
            ) : (
              <div className="border" style={{ borderColor: palette.line, backgroundColor: "rgba(0, 0, 0, 0.22)" }}>
                <div
                  className="grid grid-cols-[1.2rem_minmax(0,1fr)_6rem] gap-3 border-b px-2 py-2 text-[10px] font-bold uppercase tracking-[0.24em]"
                  style={{ borderColor: palette.line, color: palette.amber }}
                >
                  <div>#</div>
                  <div>Crontab Entry</div>
                  <div className="text-right">Next Run</div>
                </div>
                {data.crons.slice(0, 5).map((c) => (
                  <CronRow key={c.id} task={c} />
                ))}
              </div>
            )}
            {data.crons.length > 5 && (
              <div className="mt-3 text-[10px] uppercase tracking-[0.18em]" style={{ color: palette.muted }}>
                +{data.crons.length - 5} more scheduled entries
              </div>
            )}
          </SectionFrame>

          {level?.next_unlock && (
            <SectionFrame title="EVOLUTION NEXT UNLOCK">
              <div className="flex flex-wrap items-end justify-between gap-3 border-b pb-3" style={{ borderColor: palette.line }}>
                <div>
                  <div className="text-[10px] uppercase tracking-[0.22em]" style={{ color: palette.amber }}>
                    Unlock Target
                  </div>
                  <div className="mt-2 text-lg font-bold uppercase tracking-[0.14em]" style={{ color: "#d5ffd8" }}>
                    {level.next_unlock}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[10px] uppercase tracking-[0.22em]" style={{ color: palette.muted }}>
                    Remaining
                  </div>
                  <div className="mt-2 text-2xl font-bold tabular-nums" style={{ color: palette.green, ...tickStyle("0.15s") }}>
                    {10 - (level.score % 10)} PTS
                  </div>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-10 gap-1">
                {Array.from({ length: 10 }).map((_, index) => {
                  const filled = index < level.score % 10;
                  return (
                    <div
                      key={index}
                      className="h-5 border"
                      style={{
                        borderColor: filled ? `${palette.amber}99` : "rgba(255, 176, 0, 0.2)",
                        backgroundColor: filled ? palette.amber : "rgba(255, 176, 0, 0.08)",
                        boxShadow: filled ? `0 0 10px ${palette.amber}44` : "none",
                      }}
                    />
                  );
                })}
              </div>
            </SectionFrame>
          )}

          <span className="hidden">{now}</span>
        </div>
      </div>
    </div>
  );
}
