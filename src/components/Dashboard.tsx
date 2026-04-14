import { useState, useEffect, useCallback, useRef, type CSSProperties, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { AgentPixelWorld } from "./AgentPixelWorld";

// ── Types ────────────────────────────────────────────────────────────────────

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
  god_mode_tier: string;
  wake_word_enabled: boolean;
  screen_timeline_enabled: boolean;
  background_ai_enabled: boolean;
  provider: string;
  model: string;
  voice_mode: string;
}

interface PerceptionState {
  timestamp: number;
  active_app: string;
  active_title: string;
  user_state: string;
  delta_summary: string;
  context_tags: string[];
  ram_used_gb: number;
  disk_free_gb: number;
  top_cpu_process: string;
  visible_errors: string[];
}

interface HealthStats {
  current_streak_minutes: number;
  daily_total_minutes: number;
  breaks_taken: number;
  status: string;
}

interface IntegrationState {
  unread_emails: number;
  upcoming_events: number;
  slack_mentions: number;
  github_notifications: number;
  last_updated: string | null;
}

interface SecurityOverview {
  network: { total_connections: number; suspicious_count: number };
  sensitive_files: unknown[];
  last_scan: string | null;
}

interface GodModeUpdate {
  bytes: number;
  tier: string;
  delta: string;
  user_state: string;
}

interface ProactiveTask {
  id: string;
  suggestion: string;
  category: string;
  created_at: number;
}

interface Props {
  onBack: () => void;
  onNavigate: (route: string) => void;
}

// ── Palette ──────────────────────────────────────────────────────────────────

const p = {
  bg: "#07090a",
  panel: "#0b0f10",
  panelAlt: "#0e1314",
  panelBright: "#111819",
  green: "#00ff41",
  cyan: "#00e5ff",
  amber: "#ffb000",
  red: "#ff0040",
  violet: "#b388ff",
  blue: "#448aff",
  line: "rgba(0, 229, 255, 0.15)",
  lineDim: "rgba(0, 229, 255, 0.08)",
  dim: "rgba(0, 229, 255, 0.5)",
  muted: "rgba(160, 220, 230, 0.6)",
  glow: "rgba(0, 229, 255, 0.08)",
  glowGreen: "rgba(0, 255, 65, 0.12)",
} as const;

// ── Helpers ───────────────────────────────────────────────────────────────────

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
  return `${Math.floor(diff / 3600)}h ${Math.floor((diff % 3600) / 60)}m`;
}

function fmtMinutes(m: number): string {
  if (m <= 0) return "0m";
  const h = Math.floor(m / 60);
  const rem = m % 60;
  if (h === 0) return `${rem}m`;
  if (rem === 0) return `${h}h`;
  return `${h}h ${rem}m`;
}

function userStateColor(state: string): string {
  if (state === "focused") return p.green;
  if (state === "idle") return p.amber;
  return p.muted;
}

function securityColor(overview: SecurityOverview | null): string {
  if (!overview) return p.muted;
  if (overview.network.suspicious_count > 0) return p.red;
  return p.green;
}

function integrationCount(state: IntegrationState | null): number {
  if (!state) return 0;
  return state.unread_emails + state.slack_mentions + state.github_notifications;
}

function tierColor(tier: string): string {
  if (tier === "extreme") return p.red;
  if (tier === "intermediate") return p.amber;
  return p.green;
}

function categoryIcon(cat: string): string {
  if (cat === "error") return "!";
  if (cat === "optimization") return "◈";
  if (cat === "reminder") return "◷";
  if (cat === "insight") return "◉";
  return "◆";
}

function categoryColor(cat: string): string {
  if (cat === "error") return p.red;
  if (cat === "optimization") return p.cyan;
  if (cat === "reminder") return p.amber;
  if (cat === "insight") return p.violet;
  return p.muted;
}

// ── Animation style helpers ───────────────────────────────────────────────────

function blinkStyle(delay = "0s", active = true): CSSProperties {
  if (!active) return {};
  return {
    animation: `db-blink 1.6s steps(2, end) infinite`,
    animationDelay: delay,
  };
}

function breatheStyle(delay = "0s", active = true): CSSProperties {
  if (!active) return {};
  return {
    animation: `db-breathe 2.4s ease-in-out infinite`,
    animationDelay: delay,
  };
}

// ── Sub-components ────────────────────────────────────────────────────────────

/** Single pill in the status strip */
function StatusPill({
  label,
  value,
  active,
  color,
  onClick,
}: {
  label: string;
  value: ReactNode;
  active: boolean;
  color: string;
  onClick?: () => void;
}) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className="flex items-center gap-2 border px-3 py-2 text-[10px] uppercase tracking-[0.2em] transition-all"
      style={{
        borderColor: active ? `${color}55` : p.lineDim,
        background: active ? `${color}0d` : "rgba(0,0,0,0.25)",
        color: active ? color : p.muted,
        cursor: onClick ? "pointer" : "default",
        boxShadow: active ? `0 0 14px ${color}18` : "none",
      }}
    >
      <span
        className="block h-2 w-2 shrink-0 rounded-full"
        style={{
          backgroundColor: active ? color : "rgba(120,130,140,0.4)",
          boxShadow: active ? `0 0 8px ${color}cc, 0 0 3px ${color}` : "none",
          ...breatheStyle("0s", active),
        }}
      />
      <span style={{ color: p.muted }} className="font-normal">{label}</span>
      <span className="font-bold tabular-nums">{value}</span>
    </Tag>
  );
}

/** Section container with CRT-style border */
function Panel({
  title,
  accent = p.cyan,
  children,
  className = "",
  style,
}: {
  title: string;
  accent?: string;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <section
      className={`relative overflow-hidden border ${className}`}
      style={{
        borderColor: `${accent}28`,
        background: `linear-gradient(160deg, ${p.panel} 0%, ${p.panelAlt} 100%)`,
        boxShadow: `inset 0 0 0 1px ${accent}0a, 0 0 20px ${accent}08`,
        ...style,
      }}
    >
      {/* scanline overlay */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "repeating-linear-gradient(180deg, rgba(255,255,255,0.018) 0px, rgba(255,255,255,0.018) 1px, transparent 1px, transparent 3px)",
        }}
      />
      <div className="relative flex flex-col h-full">
        <div
          className="flex items-center gap-2 border-b px-3 py-2 text-[9px] font-bold uppercase tracking-[0.3em] shrink-0"
          style={{ borderColor: `${accent}20`, color: accent }}
        >
          <span
            className="block h-1.5 w-1.5 rounded-full"
            style={{ backgroundColor: accent, boxShadow: `0 0 6px ${accent}`, ...breatheStyle("0s", true) }}
          />
          {title}
        </div>
        <div className="flex-1 p-3">{children}</div>
      </div>
    </section>
  );
}

/** Horizontal key/value data line */
function DataRow({
  label,
  value,
  accent = p.cyan,
  mono = true,
}: {
  label: string;
  value: ReactNode;
  accent?: string;
  mono?: boolean;
}) {
  return (
    <div
      className="flex items-baseline justify-between gap-2 border-b py-1.5 text-[10px] uppercase tracking-[0.14em]"
      style={{ borderColor: p.lineDim }}
    >
      <span style={{ color: p.muted }}>{label}</span>
      <span
        className={`text-right font-bold ${mono ? "tabular-nums" : ""}`}
        style={{ color: accent }}
      >
        {value}
      </span>
    </div>
  );
}

/** Compact action button */
function ActionBtn({
  label,
  icon,
  color = p.cyan,
  onClick,
  loading = false,
  disabled = false,
}: {
  label: string;
  icon: ReactNode;
  color?: string;
  onClick: () => void;
  loading?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || loading}
      className="flex flex-col items-center justify-center gap-1.5 border p-3 text-center transition-all hover:brightness-125 active:scale-95 disabled:opacity-40"
      style={{
        borderColor: `${color}33`,
        background: `${color}08`,
        color,
        minHeight: "70px",
      }}
    >
      <span className="text-lg leading-none">{loading ? "…" : icon}</span>
      <span className="text-[9px] font-bold uppercase tracking-[0.18em] leading-tight">{label}</span>
    </button>
  );
}

/** Compact agent row for the agents table */
function AgentRowCompact({ agent }: { agent: BackgroundAgent }) {
  const statusColor = {
    Running: p.green,
    Completed: p.cyan,
    Failed: p.red,
    Cancelled: p.muted,
  }[agent.status];

  return (
    <div
      className="grid gap-2 border-b px-2 py-1.5 text-[10px] uppercase tracking-[0.12em]"
      style={{
        gridTemplateColumns: "4rem minmax(0,1fr) 5.5rem",
        borderColor: p.lineDim,
      }}
    >
      <div style={{ color: p.amber }}>
        <div className="font-bold">{agent.id.slice(0, 4)}</div>
        <div style={{ color: p.muted }}>{agent.agent_type.slice(0, 6)}</div>
      </div>
      <div className="min-w-0">
        <div className="truncate font-bold" style={{ color: "#d0f0f8" }}>{agent.task}</div>
        <div className="truncate text-[9px]" style={{ color: p.dim }}>{agent.cwd.split(/[\\/]/).pop()}</div>
      </div>
      <div className="text-right">
        <div
          className="flex items-center justify-end gap-1 font-bold"
          style={{ color: statusColor }}
        >
          <span
            className="block h-2 w-2 shrink-0 rounded-full"
            style={{
              backgroundColor: statusColor,
              ...blinkStyle("0s", agent.status === "Running"),
            }}
          />
          {agent.status}
        </div>
        <div style={{ color: p.muted }}>{relTime(agent.started_at)}</div>
      </div>
    </div>
  );
}

/** Proactive suggestion card */
function SuggestionCard({
  task,
  onDismiss,
  onApprove,
}: {
  task: ProactiveTask;
  onDismiss: (id: string) => void;
  onApprove: (task: ProactiveTask) => void;
}) {
  const color = categoryColor(task.category);
  const icon = categoryIcon(task.category);

  return (
    <div
      className="border p-2.5 flex flex-col gap-2"
      style={{
        borderColor: `${color}33`,
        background: `${color}08`,
        animation: "db-slidein 0.2s ease",
      }}
    >
      <div className="flex items-start gap-2">
        <span
          className="text-sm font-bold shrink-0 mt-0.5"
          style={{ color }}
        >
          {icon}
        </span>
        <div className="flex-1 min-w-0">
          <div
            className="text-[9px] font-bold uppercase tracking-[0.22em] mb-1"
            style={{ color }}
          >
            {task.category}
          </div>
          <div
            className="text-[10px] leading-snug"
            style={{ color: "#cce8ee" }}
          >
            {task.suggestion}
          </div>
        </div>
      </div>
      <div className="flex gap-1.5 justify-end">
        <button
          type="button"
          onClick={() => onDismiss(task.id)}
          className="border px-2 py-1 text-[9px] font-bold uppercase tracking-[0.16em] transition-colors hover:brightness-125"
          style={{ borderColor: p.line, color: p.muted }}
        >
          Dismiss
        </button>
        <button
          type="button"
          onClick={() => onApprove(task)}
          className="border px-2 py-1 text-[9px] font-bold uppercase tracking-[0.16em] transition-colors hover:brightness-125"
          style={{ borderColor: `${color}55`, color, background: `${color}12` }}
        >
          Approve
        </button>
      </div>
    </div>
  );
}

// ── Main Dashboard ────────────────────────────────────────────────────────────

export function Dashboard({ onBack, onNavigate }: Props) {
  // ── Core data ───────────────────────────────────────────────────────────────
  const [level, setLevel] = useState<EvolutionLevel | null>(null);
  const [agents, setAgents] = useState<BackgroundAgent[]>([]);
  const [crons, setCrons] = useState<CronTask[]>([]);
  const [timeline, setTimeline] = useState<TimelineStats | null>(null);
  const [config, setConfig] = useState<BladeConfig | null>(null);
  const [loading, setLoading] = useState(true);

  // ── Live status strip data ──────────────────────────────────────────────────
  const [perception, setPerception] = useState<PerceptionState | null>(null);
  const [health, setHealth] = useState<HealthStats | null>(null);
  const [integration, setIntegration] = useState<IntegrationState | null>(null);
  const [security, setSecurity] = useState<SecurityOverview | null>(null);
  const [voiceActive, setVoiceActive] = useState(false);

  // ── Intelligence brief ─────────────────────────────────────────────────────
  const [godModeUpdate, setGodModeUpdate] = useState<GodModeUpdate | null>(null);
  const [briefFile, setBriefFile] = useState<string | null>(null);

  // ── Proactive suggestions ──────────────────────────────────────────────────
  const [suggestions, setSuggestions] = useState<ProactiveTask[]>([]);

  // ── Quick action loading states ─────────────────────────────────────────────
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});

  // ── Ticker ─────────────────────────────────────────────────────────────────
  const [now, setNow] = useState(Date.now());
  const tickRef = useRef(0);
  useEffect(() => {
    tickRef.current = window.setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tickRef.current);
  }, []);

  // ── Load core data ──────────────────────────────────────────────────────────
  const loadCore = useCallback(async () => {
    const results = await Promise.allSettled([
      invoke<EvolutionLevel>("evolution_get_level"),
      invoke<BackgroundAgent[]>("agent_list_background"),
      invoke<CronTask[]>("cron_list"),
      invoke<TimelineStats>("timeline_get_stats_cmd"),
      invoke<BladeConfig>("get_config"),
    ]);
    if (results[0].status === "fulfilled") setLevel(results[0].value);
    if (results[1].status === "fulfilled") setAgents(results[1].value);
    if (results[2].status === "fulfilled") setCrons(results[2].value);
    if (results[3].status === "fulfilled") setTimeline(results[3].value);
    if (results[4].status === "fulfilled") setConfig(results[4].value);
    setLoading(false);
  }, []);

  // ── Load live status data ───────────────────────────────────────────────────
  const loadStatus = useCallback(async () => {
    const results = await Promise.allSettled([
      invoke<PerceptionState>("perception_get_latest"),
      invoke<HealthStats>("health_guardian_stats"),
      invoke<IntegrationState>("integration_get_state"),
      invoke<SecurityOverview>("security_overview"),
      invoke<boolean>("voice_conversation_active"),
      invoke<ProactiveTask[]>("get_proactive_tasks"),
    ]);
    if (results[0].status === "fulfilled" && results[0].value) setPerception(results[0].value);
    if (results[1].status === "fulfilled") setHealth(results[1].value as HealthStats);
    if (results[2].status === "fulfilled") setIntegration(results[2].value);
    if (results[3].status === "fulfilled") setSecurity(results[3].value);
    if (results[4].status === "fulfilled") setVoiceActive(results[4].value);
    if (results[5].status === "fulfilled") setSuggestions(results[5].value);
  }, []);

  // ── Polling ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    loadCore();
    loadStatus();
    const coreInterval = setInterval(loadCore, 15_000);
    const statusInterval = setInterval(loadStatus, 5_000);
    return () => {
      clearInterval(coreInterval);
      clearInterval(statusInterval);
    };
  }, [loadCore, loadStatus]);

  // ── Live event listeners ────────────────────────────────────────────────────
  useEffect(() => {
    let unlistenGodMode: (() => void) | null = null;
    let unlistenSuggestion: (() => void) | null = null;

    listen<GodModeUpdate>("godmode_update", (e) => {
      setGodModeUpdate(e.payload);
      // Also refresh config + perception on god mode tick
      invoke<BladeConfig>("get_config").then(setConfig).catch(() => {});
      invoke<PerceptionState>("perception_get_latest").then((p) => { if (p) setPerception(p); }).catch(() => {});
    }).then((fn) => { unlistenGodMode = fn; });

    listen<ProactiveTask>("proactive_suggestion", (e) => {
      setSuggestions((prev) => {
        const exists = prev.some((t) => t.id === e.payload.id);
        if (exists) return prev;
        return [e.payload, ...prev].slice(0, 8);
      });
    }).then((fn) => { unlistenSuggestion = fn; });

    return () => {
      unlistenGodMode?.();
      unlistenSuggestion?.();
    };
  }, []);

  // ── Intelligence brief file reader ─────────────────────────────────────────
  useEffect(() => {
    // Refresh brief content whenever godModeUpdate fires
    if (!godModeUpdate) return;
    invoke<string>("get_god_mode_context").then(setBriefFile).catch(() => {});
  }, [godModeUpdate]);

  // ── Derived values ───────────────────────────────────────────────────────────
  const runningAgents = agents.filter((a) => a.status === "Running");
  const unreadCount = integrationCount(integration);
  const secColor = securityColor(security);

  // ── Handlers ────────────────────────────────────────────────────────────────
  async function quickAction(key: string, fn: () => Promise<unknown>) {
    setActionLoading((prev) => ({ ...prev, [key]: true }));
    try { await fn(); } catch { /* ignore */ }
    setActionLoading((prev) => ({ ...prev, [key]: false }));
    loadStatus();
  }

  function dismissSuggestion(id: string) {
    setSuggestions((prev) => prev.filter((t) => t.id !== id));
    invoke("dismiss_proactive_task", { taskId: id }).catch(() => {});
  }

  function approveSuggestion(task: ProactiveTask) {
    // Navigate to chat with the suggestion pre-loaded — best we can do without a specific action invoke
    onNavigate("chat");
    dismissSuggestion(task.id);
  }

  // ── Loading screen ──────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div
        className="flex h-full items-center justify-center font-mono text-sm uppercase tracking-[0.3em]"
        style={{ color: p.cyan, backgroundColor: p.bg, textShadow: `0 0 10px ${p.cyan}88` }}
      >
        <span style={{ animation: "db-blink 0.9s steps(2,end) infinite" }}>
          Initializing BLADE HUD...
        </span>
      </div>
    );
  }

  const cfg = config;
  const godActive = !!cfg?.god_mode;
  const godTier = cfg?.god_mode_tier ?? "normal";
  const voiceMode = cfg?.voice_mode ?? "off";

  // XP bar
  const xpBlockCount = 20;
  const xpProgress = Math.min(100, ((level?.score ?? 0) % 10) * 10);
  const xpFilledBlocks = Math.round((xpProgress / 100) * xpBlockCount);

  // Brief lines from godmode_context.md
  const briefLines: string[] = briefFile
    ? briefFile.split("\n").filter((l) => l.trim().length > 0).slice(0, 12)
    : [];

  return (
    <div
      className="relative flex h-full flex-col overflow-hidden font-mono"
      style={{ background: `radial-gradient(ellipse at 50% 0%, rgba(0,229,255,0.06) 0%, transparent 55%), ${p.bg}`, color: p.cyan }}
    >
      {/* ── Global animations ── */}
      <style>{`
        @keyframes db-blink { 0%,49%{opacity:1} 50%,100%{opacity:0.35} }
        @keyframes db-pulse { 0%,100%{opacity:0.7} 50%{opacity:1} }
        @keyframes db-slidein { from{opacity:0;transform:translateY(-4px)} to{opacity:1;transform:translateY(0)} }
        @keyframes db-scan {
          0%{background-position:0 0}
          100%{background-position:0 100%}
        }
        @keyframes db-breathe {
          0%,100% { opacity:1; transform:scale(1); filter:blur(0px); }
          50% { opacity:0.55; transform:scale(0.78); filter:blur(0.5px); }
        }
      `}</style>

      {/* CRT scanline overlay */}
      <div
        className="pointer-events-none absolute inset-0 z-0 opacity-30"
        style={{
          background:
            "repeating-linear-gradient(180deg, rgba(255,255,255,0.03) 0px, rgba(255,255,255,0.03) 1px, transparent 1px, transparent 4px)",
        }}
      />
      {/* Vignette */}
      <div
        className="pointer-events-none absolute inset-0 z-0"
        style={{ boxShadow: "inset 0 0 100px rgba(0,0,0,0.65)" }}
      />

      {/* ── Header bar ── */}
      <header
        className="relative z-10 flex shrink-0 items-center gap-3 border-b px-4 py-2.5"
        style={{ borderColor: p.line, background: "rgba(7,9,10,0.96)" }}
      >
        <button
          onClick={onBack}
          className="border px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] transition-colors hover:brightness-125"
          style={{ borderColor: p.line, color: p.amber }}
        >
          ← Back
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold uppercase tracking-[0.35em]" style={{ color: "#c0e8f0" }}>
              BLADE
            </span>
            <span className="text-[10px] uppercase tracking-[0.28em]" style={{ color: p.dim }}>
              Mission Control
            </span>
            {godActive && (
              <span
                className="border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.2em]"
                style={{
                  borderColor: `${tierColor(godTier)}55`,
                  color: tierColor(godTier),
                  background: `${tierColor(godTier)}0f`,
                  ...blinkStyle("0s", true),
                }}
              >
                God Mode · {godTier}
              </span>
            )}
          </div>
          <div className="text-[9px] uppercase tracking-[0.22em] mt-0.5" style={{ color: p.dim }}>
            {new Date(now).toLocaleTimeString()} · auto-refresh 5s
            {godModeUpdate && (
              <span style={{ color: p.muted }}> · last scan {godModeUpdate.bytes}b</span>
            )}
          </div>
        </div>
        <button
          onClick={async () => {
            try { await invoke("toggle_background_ai", { enabled: false }); } catch { /* ignore */ }
          }}
          className="border px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] transition-colors hover:brightness-125"
          style={{ borderColor: `${p.red}55`, color: p.red, background: `${p.red}0a` }}
        >
          Kill BG AI
        </button>
        <button
          onClick={() => { loadCore(); loadStatus(); }}
          className="border px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] transition-colors hover:brightness-125"
          style={{ borderColor: p.line, color: p.cyan }}
        >
          Refresh
        </button>
      </header>

      {/* ── STATUS STRIP ── */}
      <div
        className="relative z-10 shrink-0 flex flex-wrap gap-1 border-b px-3 py-2"
        style={{ borderColor: p.line, background: "rgba(7,9,10,0.9)" }}
      >
        <StatusPill
          label="God Mode"
          value={godActive ? godTier : "off"}
          active={godActive}
          color={tierColor(godTier)}
          onClick={async () => {
            const next = !godActive;
            try { await invoke("toggle_god_mode", { enabled: next, tier: next ? godTier : null }); } catch { /* ignore */ }
            loadCore();
          }}
        />
        <StatusPill
          label="Perception"
          value={perception?.user_state ?? "unknown"}
          active={!!perception}
          color={userStateColor(perception?.user_state ?? "")}
        />
        <StatusPill
          label="Screen Time"
          value={health ? fmtMinutes(health.current_streak_minutes) : "—"}
          active={!!health && health.current_streak_minutes > 0}
          color={health && health.current_streak_minutes > 90 ? p.red : health && health.current_streak_minutes > 45 ? p.amber : p.green}
        />
        <StatusPill
          label="Integrations"
          value={unreadCount > 0 ? `${unreadCount} unread` : "clear"}
          active={unreadCount > 0}
          color={unreadCount > 5 ? p.amber : p.cyan}
          onClick={() => onNavigate("integrations")}
        />
        <StatusPill
          label="Security"
          value={security ? (security.network.suspicious_count > 0 ? `${security.network.suspicious_count} suspicious` : "clear") : "—"}
          active={!!security}
          color={secColor}
          onClick={() => onNavigate("security")}
        />
        <StatusPill
          label="Voice"
          value={voiceActive ? "active" : voiceMode === "off" ? "off" : voiceMode}
          active={voiceActive}
          color={p.violet}
          onClick={async () => {
            if (voiceActive) {
              try { await invoke("stop_voice_conversation"); } catch { /* ignore */ }
            } else {
              try { await invoke("start_voice_conversation"); } catch { /* ignore */ }
            }
            loadStatus();
          }}
        />
        {runningAgents.length > 0 && (
          <StatusPill
            label="Agents"
            value={`${runningAgents.length} running`}
            active
            color={p.green}
            onClick={() => onNavigate("bg-agents")}
          />
        )}
      </div>

      {/* ── Main grid ── */}
      <div className="relative z-10 flex-1 overflow-y-auto px-3 pb-3 pt-2">

        {/* Row 1: Brief + Suggestions */}
        <div className="grid gap-2 mb-2" style={{ gridTemplateColumns: "minmax(0,1fr) 280px" }}>

          {/* ── INTELLIGENCE BRIEF ── */}
          <Panel title="Intelligence Brief" accent={p.cyan}>
            {godActive ? (
              <div className="h-full flex flex-col gap-2">
                {/* Perception vitals */}
                {perception && (
                  <div className="grid grid-cols-3 gap-1.5 border-b pb-2" style={{ borderColor: p.lineDim }}>
                    <div className="flex flex-col gap-0.5">
                      <div className="text-[9px] uppercase tracking-[0.2em]" style={{ color: p.muted }}>Focus</div>
                      <div className="text-[11px] font-bold truncate" style={{ color: userStateColor(perception.user_state) }}>
                        {perception.user_state}
                      </div>
                      <div className="text-[9px] truncate" style={{ color: p.dim }}>{perception.active_app}</div>
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <div className="text-[9px] uppercase tracking-[0.2em]" style={{ color: p.muted }}>System</div>
                      <div className="text-[10px] font-bold tabular-nums" style={{ color: p.cyan }}>
                        RAM {perception.ram_used_gb.toFixed(1)}GB
                      </div>
                      <div className="text-[9px]" style={{ color: p.dim }}>
                        DISK {perception.disk_free_gb.toFixed(0)}GB free
                      </div>
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <div className="text-[9px] uppercase tracking-[0.2em]" style={{ color: p.muted }}>Delta</div>
                      <div className="text-[10px] leading-tight" style={{ color: p.amber }}>
                        {perception.delta_summary.slice(0, 60) || "No changes"}
                      </div>
                    </div>
                  </div>
                )}

                {/* Context tags */}
                {perception && perception.context_tags.length > 0 && (
                  <div className="flex flex-wrap gap-1 border-b pb-2" style={{ borderColor: p.lineDim }}>
                    {perception.context_tags.slice(0, 8).map((tag) => (
                      <span
                        key={tag}
                        className="border px-1.5 py-0.5 text-[9px] uppercase tracking-[0.12em]"
                        style={{ borderColor: `${p.cyan}30`, color: p.cyan, background: `${p.cyan}0a` }}
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}

                {/* Brief content lines */}
                {briefLines.length > 0 ? (
                  <div className="flex-1 overflow-y-auto space-y-1">
                    {briefLines.map((line, i) => {
                      const isBold = line.startsWith("**") && line.includes("**:");
                      const key = line.replace(/\*\*/g, "").split(":")[0];
                      const val = line.replace(/\*\*/g, "").split(":").slice(1).join(":").trim();
                      const lineColor =
                        key.includes("Focus") ? p.cyan :
                        key.includes("Delta") || key.includes("Changed") ? p.amber :
                        key.includes("Error") ? p.red :
                        key.includes("Memory") || key.includes("Recall") ? p.violet :
                        "#b0d8e0";
                      return isBold ? (
                        <div key={i} className="flex gap-2 text-[10px]">
                          <span className="font-bold shrink-0 uppercase tracking-[0.1em]" style={{ color: lineColor }}>
                            {key}
                          </span>
                          <span style={{ color: "#c0e0e8" }}>{val}</span>
                        </div>
                      ) : (
                        <div key={i} className="text-[10px] leading-snug" style={{ color: p.muted }}>
                          {line}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="flex-1 flex items-center justify-center">
                    <div className="text-center">
                      <div className="text-[11px] font-bold uppercase tracking-[0.2em]" style={{ color: p.dim }}>
                        Waiting for scan...
                      </div>
                      {godModeUpdate && (
                        <div className="mt-1 text-[10px]" style={{ color: p.muted }}>
                          Last update: {godModeUpdate.bytes}b · {godModeUpdate.tier} tier
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Visible errors */}
                {perception && perception.visible_errors.length > 0 && (
                  <div className="border-t pt-2 space-y-1" style={{ borderColor: `${p.red}30` }}>
                    {perception.visible_errors.slice(0, 3).map((err, i) => (
                      <div
                        key={i}
                        className="flex gap-1.5 text-[10px]"
                        style={{ color: p.red }}
                      >
                        <span className="shrink-0">!</span>
                        <span className="truncate">{err}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-3 py-6 text-center">
                <div
                  className="text-[11px] uppercase tracking-[0.22em]"
                  style={{ color: p.dim }}
                >
                  God Mode offline
                </div>
                <div className="text-[10px] max-w-[200px] leading-snug" style={{ color: p.muted }}>
                  Enable God Mode in Settings to see live context — active app, system state, and AI-generated briefs.
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    try { await invoke("toggle_god_mode", { enabled: true, tier: "normal" }); loadCore(); } catch { /* ignore */ }
                  }}
                  className="border px-4 py-2 text-[10px] font-bold uppercase tracking-[0.2em] transition-all hover:brightness-125"
                  style={{ borderColor: `${p.amber}55`, color: p.amber, background: `${p.amber}0d` }}
                >
                  Enable God Mode
                </button>
              </div>
            )}
          </Panel>

          {/* ── PROACTIVE SUGGESTIONS ── */}
          <Panel title={`Suggestions [${suggestions.length}]`} accent={p.violet}>
            {suggestions.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full py-6 gap-2">
                <div className="text-[11px] uppercase tracking-[0.2em]" style={{ color: p.dim }}>
                  All clear
                </div>
                <div className="text-[10px]" style={{ color: p.muted }}>
                  No pending suggestions
                </div>
              </div>
            ) : (
              <div className="space-y-1.5 overflow-y-auto max-h-52">
                {suggestions.map((task) => (
                  <SuggestionCard
                    key={task.id}
                    task={task}
                    onDismiss={dismissSuggestion}
                    onApprove={approveSuggestion}
                  />
                ))}
              </div>
            )}
          </Panel>
        </div>

        {/* Row 2: Stats panels */}
        <div className="grid grid-cols-3 gap-2 mb-2">

          {/* God Mode / Evolution */}
          <Panel title="Evolution" accent={p.amber}>
            <div className="space-y-1.5">
              <div className="flex items-end justify-between gap-2 mb-2">
                <div>
                  <div className="text-[9px] uppercase tracking-[0.2em]" style={{ color: p.muted }}>Level</div>
                  <div
                    className="text-4xl font-bold leading-none tabular-nums"
                    style={{ color: p.amber, textShadow: `0 0 16px ${p.amber}66` }}
                  >
                    {level?.level ?? 0}
                  </div>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between text-[9px] uppercase tracking-[0.14em] mb-1">
                    <span style={{ color: p.muted }}>XP {(level?.score ?? 0).toLocaleString()}</span>
                    <span style={{ color: p.amber }}>{xpProgress}%</span>
                  </div>
                  <div className="grid gap-0.5" style={{ gridTemplateColumns: `repeat(${xpBlockCount}, 1fr)` }}>
                    {Array.from({ length: xpBlockCount }).map((_, i) => (
                      <div
                        key={i}
                        className="h-3"
                        style={{
                          background: i < xpFilledBlocks ? p.amber : `${p.amber}15`,
                          boxShadow: i < xpFilledBlocks ? `0 0 6px ${p.amber}55` : "none",
                        }}
                      />
                    ))}
                  </div>
                  {level?.next_unlock && (
                    <div className="mt-1 text-[9px] truncate" style={{ color: p.muted }}>
                      Next: {level.next_unlock}
                    </div>
                  )}
                </div>
              </div>
              {level && level.breakdown.slice(0, 3).map((item, i) => (
                <div
                  key={i}
                  className="border-l-2 pl-2 text-[10px]"
                  style={{ borderColor: `${p.amber}44`, color: p.muted }}
                >
                  {item}
                </div>
              ))}
            </div>
          </Panel>

          {/* Health */}
          <Panel title="Health Guardian" accent={p.green}>
            {health ? (
              <div className="space-y-1.5">
                <DataRow label="Streak" value={fmtMinutes(health.current_streak_minutes)} accent={health.current_streak_minutes > 90 ? p.red : p.green} />
                <DataRow label="Daily Total" value={fmtMinutes(health.daily_total_minutes)} accent={p.cyan} />
                <DataRow label="Breaks Taken" value={health.breaks_taken} accent={p.amber} />
                <DataRow label="Status" value={health.status} accent={p.green} mono={false} />
              </div>
            ) : (
              <div className="text-[10px]" style={{ color: p.muted }}>Health guardian offline</div>
            )}
            <button
              type="button"
              onClick={() => onNavigate("health-panel")}
              className="mt-3 w-full border py-1.5 text-[9px] font-bold uppercase tracking-[0.18em] transition-all hover:brightness-125"
              style={{ borderColor: `${p.green}33`, color: p.green }}
            >
              Health Panel →
            </button>
          </Panel>

          {/* Total Recall */}
          <Panel title="Total Recall" accent={p.blue}>
            {cfg?.screen_timeline_enabled && timeline ? (
              <div className="space-y-1.5">
                <DataRow label="Captures" value={timeline.total_entries.toLocaleString()} accent={p.blue} />
                <DataRow label="Disk Used" value={fmt(timeline.disk_bytes)} accent={p.cyan} />
                <DataRow label="Last Cap" value={relTime(timeline.newest_timestamp)} accent={p.muted} mono={false} />
              </div>
            ) : (
              <div className="text-[10px]" style={{ color: p.muted }}>
                {cfg?.screen_timeline_enabled ? "No captures yet" : "Disabled"}
              </div>
            )}
            <button
              type="button"
              onClick={() => onNavigate("screen-timeline")}
              className="mt-3 w-full border py-1.5 text-[9px] font-bold uppercase tracking-[0.18em] transition-all hover:brightness-125"
              style={{ borderColor: `${p.blue}33`, color: p.blue }}
            >
              Open Timeline →
            </button>
          </Panel>
        </div>

        {/* Row 3: Active Agents (compact) */}
        <div className="mb-2">
          <Panel title={`Active Agents [${agents.length}]`} accent={p.green}>
            <div className="flex gap-3">
              {agents.length > 0 ? (
                <>
                  <div className="shrink-0" style={{ width: 160 }}>
                    <AgentPixelWorld agents={agents} height={80} width={160} />
                  </div>
                  <div className="flex-1 min-w-0 border" style={{ borderColor: p.lineDim }}>
                    <div
                      className="grid gap-2 border-b px-2 py-1 text-[9px] font-bold uppercase tracking-[0.22em]"
                      style={{ gridTemplateColumns: "4rem minmax(0,1fr) 5.5rem", borderColor: p.lineDim, color: p.amber }}
                    >
                      <div>PID</div>
                      <div>Task</div>
                      <div className="text-right">Status</div>
                    </div>
                    {agents.slice(0, 4).map((a) => (
                      <AgentRowCompact key={a.id} agent={a} />
                    ))}
                    {agents.length > 4 && (
                      <div className="px-2 py-1 text-[9px]" style={{ color: p.dim }}>
                        +{agents.length - 4} more
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <div className="text-[10px]" style={{ color: p.muted }}>No agents running</div>
              )}
            </div>
            <div className="flex gap-2 mt-2">
              <button
                type="button"
                onClick={() => onNavigate("swarm")}
                className="border px-3 py-1.5 text-[9px] font-bold uppercase tracking-[0.18em] transition-all hover:brightness-125"
                style={{ borderColor: `${p.green}33`, color: p.green }}
              >
                Swarm →
              </button>
              <button
                type="button"
                onClick={() => onNavigate("bg-agents")}
                className="border px-3 py-1.5 text-[9px] font-bold uppercase tracking-[0.18em] transition-all hover:brightness-125"
                style={{ borderColor: `${p.amber}33`, color: p.amber }}
              >
                BG Agents →
              </button>
            </div>
          </Panel>
        </div>

        {/* Row 4: Cron Queue (compact) */}
        {crons.length > 0 && (
          <div className="mb-2">
            <Panel title={`Cron Queue [${crons.length}]`} accent={p.muted}>
              <div className="grid grid-cols-2 gap-1 sm:grid-cols-3">
                {crons.slice(0, 6).map((c) => (
                  <div
                    key={c.id}
                    className="border px-2 py-1.5 text-[10px]"
                    style={{
                      borderColor: c.enabled ? `${p.cyan}28` : p.lineDim,
                      background: c.enabled ? `${p.cyan}05` : "transparent",
                    }}
                  >
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <span
                        className="h-1.5 w-1.5 rounded-full shrink-0"
                        style={{ background: c.enabled ? p.green : p.muted }}
                      />
                      <span className="truncate font-bold" style={{ color: c.enabled ? "#c0e8f0" : p.muted }}>
                        {c.name}
                      </span>
                    </div>
                    <div className="text-[9px]" style={{ color: p.dim }}>
                      {c.enabled ? `in ${countdown(c.next_run)}` : "paused"} · {c.run_count}x
                    </div>
                  </div>
                ))}
              </div>
            </Panel>
          </div>
        )}

        {/* Row 5: Quick Actions */}
        <div>
          <Panel title="Quick Actions" accent={p.amber}>
            <div className="grid grid-cols-6 gap-1.5">
              <ActionBtn
                label="Lock Screen"
                icon="🔒"
                color={p.red}
                loading={actionLoading["lock"]}
                onClick={() => quickAction("lock", () => invoke("lock_screen"))}
              />
              <ActionBtn
                label="Take Break"
                icon="☕"
                color={p.green}
                loading={actionLoading["break"]}
                onClick={() => quickAction("break", () => invoke("health_take_break"))}
              />
              <ActionBtn
                label="Standup"
                icon="📋"
                color={p.cyan}
                onClick={() => onNavigate("temporal")}
              />
              <ActionBtn
                label="Scan System"
                icon="⬡"
                color={p.amber}
                loading={actionLoading["scan"]}
                onClick={() => quickAction("scan", () => invoke("deep_scan_start"))}
              />
              <ActionBtn
                label="Security"
                icon="⚿"
                color={p.violet}
                onClick={() => onNavigate("security")}
              />
              <ActionBtn
                label="Voice Mode"
                icon={voiceActive ? "◉" : "◎"}
                color={p.violet}
                loading={actionLoading["voice"]}
                onClick={() => quickAction("voice", () =>
                  voiceActive ? invoke("stop_voice_conversation") : invoke("start_voice_conversation")
                )}
              />
            </div>
          </Panel>
        </div>

        <span className="sr-only">{now}</span>
      </div>
    </div>
  );
}
