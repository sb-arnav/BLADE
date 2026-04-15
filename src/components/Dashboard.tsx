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

// ── Apple color palette ───────────────────────────────────────────────────────

const ap = {
  bg:          "#000000",
  surface:     "#1c1c1e",
  surface2:    "#2c2c2e",
  separator:   "rgba(255,255,255,0.08)",
  text:        "#ffffff",
  secondary:   "rgba(235,235,245,0.6)",
  muted:       "#8e8e93",
  green:       "#30d158",
  blue:        "#007AFF",
  purple:      "#5856D6",
  orange:      "#ff9f0a",
  red:         "#ff453a",
  yellow:      "#ffd60a",
  teal:        "#5ac8fa",
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
  if (state === "focused") return ap.green;
  if (state === "idle") return ap.orange;
  return ap.muted;
}

function securityColor(overview: SecurityOverview | null): string {
  if (!overview) return ap.muted;
  if (overview.network.suspicious_count > 0) return ap.red;
  return ap.green;
}

function integrationCount(state: IntegrationState | null): number {
  if (!state) return 0;
  return state.unread_emails + state.slack_mentions + state.github_notifications;
}

function tierColor(tier: string): string {
  if (tier === "extreme") return ap.red;
  if (tier === "intermediate") return ap.orange;
  return ap.green;
}


function categoryColor(cat: string): string {
  if (cat === "error") return ap.red;
  if (cat === "optimization") return ap.blue;
  if (cat === "reminder") return ap.orange;
  if (cat === "insight") return ap.purple;
  return ap.muted;
}

// ── Animation style helpers ───────────────────────────────────────────────────


function breatheStyle(delay = "0s", active = true): CSSProperties {
  if (!active) return {};
  return {
    animation: `statusPulse 2.5s ease-in-out infinite`,
    animationDelay: delay,
  };
}

/** Animated number that counts up/down to `target` with easing */
function AnimatedNumber({ target, suffix = "", decimals = 0 }: { target: number; suffix?: string; decimals?: number }) {
  const [display, setDisplay] = useState(target);
  const prev = useRef(target);
  const raf = useRef<number>(0);

  useEffect(() => {
    const from = prev.current;
    const to = target;
    if (from === to) return;
    const duration = 600;
    const start = performance.now();
    const animate = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      // ease-out cubic
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(from + (to - from) * eased);
      if (t < 1) {
        raf.current = requestAnimationFrame(animate);
      } else {
        prev.current = to;
        setDisplay(to);
      }
    };
    raf.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(raf.current);
  }, [target]);

  const formatted = decimals > 0 ? display.toFixed(decimals) : Math.round(display).toString();
  return <>{formatted}{suffix}</>;
}

// ── Sub-components ────────────────────────────────────────────────────────────

/** Single status pill — Apple style: small dot + label + value */
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
      onClick={onClick as React.MouseEventHandler | undefined}
      className="relative flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] transition-all duration-250"
      style={{
        background: active ? `${color}14` : "rgba(255,255,255,0.04)",
        border: `1px solid ${active ? `${color}30` : "rgba(255,255,255,0.06)"}`,
        color: active ? ap.text : ap.muted,
        cursor: onClick ? "pointer" : "default",
      }}
    >
      <span
        className="block h-1.5 w-1.5 shrink-0 rounded-full"
        style={{
          backgroundColor: active ? color : "rgba(142,142,147,0.4)",
          ...breatheStyle("0s", active),
        }}
      />
      <span className="font-normal" style={{ color: ap.muted }}>{label}</span>
      <span className="font-semibold tabular-nums">{value}</span>
    </Tag>
  );
}

/** Section card — Apple Health/Home dashboard style */
function Panel({
  title,
  accent = ap.blue,
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
      className={`relative overflow-hidden rounded-xl ${className}`}
      style={{
        background: ap.surface,
        border: "1px solid rgba(255,255,255,0.06)",
        boxShadow: "0 0 0 1px rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.06), 0 4px 12px rgba(0,0,0,0.08)",
        ...style,
      }}
    >
      <div className="flex flex-col h-full">
        {/* Section header — small uppercase tracking */}
        <div
          className="flex items-center gap-2 px-4 pt-4 pb-2 shrink-0"
        >
          <span
            className="block h-1.5 w-1.5 rounded-full shrink-0"
            style={{ backgroundColor: accent }}
          />
          <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: ap.muted }}>
            {title}
          </span>
        </div>
        <div className="flex-1 px-4 pb-4">{children}</div>
      </div>
    </section>
  );
}

/** Horizontal key/value data line — Apple-style clean row */
function DataRow({
  label,
  value,
  accent = ap.blue,
  mono = true,
}: {
  label: string;
  value: ReactNode;
  accent?: string;
  mono?: boolean;
}) {
  return (
    <div
      className="flex items-center justify-between gap-2 py-2 border-b"
      style={{ borderColor: "rgba(255,255,255,0.06)" }}
    >
      <span className="text-xs" style={{ color: ap.muted }}>{label}</span>
      <span
        className={`text-xs font-semibold ${mono ? "tabular-nums" : ""}`}
        style={{ color: accent }}
      >
        {value}
      </span>
    </div>
  );
}

/** Compact action button — Apple-style rounded card */
function ActionBtn({
  label,
  icon,
  color = ap.blue,
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
      className="flex flex-col items-center justify-center gap-1.5 rounded-xl p-3 text-center transition-all duration-250 active:scale-95 disabled:opacity-30"
      style={{
        background: `${color}12`,
        border: `1px solid ${color}25`,
        color,
        minHeight: "68px",
      }}
    >
      <span className="text-lg leading-none">{loading ? "…" : icon}</span>
      <span className="text-[10px] font-medium leading-tight" style={{ color: ap.muted }}>{label}</span>
    </button>
  );
}

/** Compact agent row */
function AgentRowCompact({ agent }: { agent: BackgroundAgent }) {
  const statusColor = {
    Running: ap.green,
    Completed: ap.teal,
    Failed: ap.red,
    Cancelled: ap.muted,
  }[agent.status];

  const elapsedSecs = agent.status === "Running"
    ? Math.floor((Date.now() / 1000) - agent.started_at)
    : null;
  const estimatedPct = elapsedSecs !== null
    ? Math.min(95, Math.round((1 - Math.exp(-elapsedSecs / 40)) * 100))
    : null;

  return (
    <div
      className="grid gap-2 border-b px-3 py-2 text-[11px]"
      style={{
        gridTemplateColumns: "3.5rem minmax(0,1fr) 5rem",
        borderColor: "rgba(255,255,255,0.06)",
      }}
    >
      <div>
        <div className="font-semibold" style={{ color: ap.orange }}>{agent.id.slice(0, 4)}</div>
        <div className="text-[10px]" style={{ color: ap.muted }}>{agent.agent_type.slice(0, 6)}</div>
      </div>
      <div className="min-w-0">
        <div className="truncate font-medium" style={{ color: ap.text }}>{agent.task}</div>
        {estimatedPct !== null && (
          <div className="mt-1 h-1 w-full rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.08)" }}>
            <div
              className="h-full rounded-full"
              style={{
                width: `${estimatedPct}%`,
                background: ap.green,
                transition: "width 1s linear",
              }}
            />
          </div>
        )}
        <div className="truncate text-[10px]" style={{ color: ap.muted }}>{agent.cwd.split(/[\\/]/).pop()}</div>
      </div>
      <div className="text-right">
        <div className="flex items-center justify-end gap-1 font-semibold" style={{ color: statusColor }}>
          <span
            className="block h-1.5 w-1.5 shrink-0 rounded-full"
            style={{ backgroundColor: statusColor }}
          />
          {agent.status}
        </div>
        <div className="text-[10px]" style={{ color: ap.muted }}>{relTime(agent.started_at)}</div>
      </div>
    </div>
  );
}

/** Proactive suggestion card — Apple-style */
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

  return (
    <div
      className="rounded-xl p-3 flex flex-col gap-2 animate-fade-up"
      style={{
        background: `${color}0e`,
        border: `1px solid ${color}25`,
      }}
    >
      <div className="flex items-start gap-2.5">
        <span className="w-1.5 h-1.5 rounded-full shrink-0 mt-1.5" style={{ backgroundColor: color }} />
        <div className="flex-1 min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color }}>
            {task.category}
          </div>
          <div className="text-xs leading-relaxed" style={{ color: ap.secondary }}>
            {task.suggestion}
          </div>
        </div>
      </div>
      <div className="flex gap-2 justify-end">
        <button
          type="button"
          onClick={() => onDismiss(task.id)}
          className="px-3 py-1 rounded-lg text-xs font-medium transition-all duration-250 active:scale-95"
          style={{ background: "rgba(255,255,255,0.06)", color: ap.muted, border: "1px solid rgba(255,255,255,0.08)" }}
        >
          Dismiss
        </button>
        <button
          type="button"
          onClick={() => onApprove(task)}
          className="px-3 py-1 rounded-lg text-xs font-medium transition-all duration-250 active:scale-95"
          style={{ background: `${color}18`, color, border: `1px solid ${color}40` }}
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

  // ── Ticker — updates every second for real-time clock ──────────────────────
  const [now, setNow] = useState(Date.now());
  const tickRef = useRef(0);
  useEffect(() => {
    // Sync to nearest second boundary for clean ticking
    const msToNextSecond = 1000 - (Date.now() % 1000);
    const syncTimeout = setTimeout(() => {
      setNow(Date.now());
      tickRef.current = window.setInterval(() => setNow(Date.now()), 1000);
    }, msToNextSecond);
    return () => {
      clearTimeout(syncTimeout);
      clearInterval(tickRef.current);
    };
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
        className="flex h-full items-center justify-center text-sm"
        style={{ color: ap.muted, backgroundColor: ap.bg }}
      >
        <div className="flex flex-col items-center gap-3">
          <div className="w-5 h-5 rounded-full border-2 border-t-blade-accent border-blade-surface-2 animate-spin" />
          <span className="text-xs uppercase tracking-wider">Loading</span>
        </div>
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
  void Math.round((xpProgress / 100) * xpBlockCount); // xpFilledBlocks used in legacy view

  // Brief lines from godmode_context.md
  const briefLines: string[] = briefFile
    ? briefFile.split("\n").filter((l) => l.trim().length > 0).slice(0, 12)
    : [];

  return (
    <div
      className="relative flex h-full flex-col overflow-hidden"
      style={{ background: ap.bg, color: ap.text }}
    >
      {/* ── Header — clean Apple-style ── */}
      <header
        className="relative z-10 flex shrink-0 items-center gap-3 border-b px-4 py-3"
        style={{
          borderColor: "rgba(255,255,255,0.08)",
          background: "rgba(28,28,30,0.9)",
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
        }}
      >
        <button
          onClick={onBack}
          className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-250 active:scale-95"
          style={{ background: "rgba(255,255,255,0.06)", color: ap.muted, border: "1px solid rgba(255,255,255,0.08)" }}
        >
          ← Back
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold" style={{ color: ap.text }}>
              BLADE
            </span>
            <span className="text-xs uppercase tracking-wider" style={{ color: ap.muted }}>
              Dashboard
            </span>
            {godActive && (
              <span
                className="px-2 py-0.5 rounded-full text-[10px] font-semibold"
                style={{
                  background: `${tierColor(godTier)}14`,
                  color: tierColor(godTier),
                  border: `1px solid ${tierColor(godTier)}30`,
                }}
              >
                God Mode · {godTier}
              </span>
            )}
          </div>
          <div className="text-xs mt-0.5 flex items-center gap-1.5" style={{ color: ap.muted }}>
            <span className="tabular-nums font-medium" style={{ color: ap.secondary }}>
              {new Date(now).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </span>
            {godModeUpdate && (
              <span>· {godModeUpdate.bytes}b last scan</span>
            )}
          </div>
        </div>
        <button
          onClick={async () => {
            try { await invoke("toggle_background_ai", { enabled: false }); } catch { /* ignore */ }
          }}
          className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-250 active:scale-95"
          style={{ background: "rgba(255,69,58,0.1)", color: ap.red, border: "1px solid rgba(255,69,58,0.2)" }}
        >
          Kill BG AI
        </button>
        <button
          onClick={() => { loadCore(); loadStatus(); }}
          className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-250 active:scale-95"
          style={{ background: "rgba(255,255,255,0.06)", color: ap.muted, border: "1px solid rgba(255,255,255,0.08)" }}
        >
          Refresh
        </button>
      </header>

      {/* ── STATUS STRIP — clean pills ── */}
      <div
        className="relative z-10 shrink-0 flex flex-wrap gap-1.5 border-b px-4 py-2.5"
        style={{ borderColor: "rgba(255,255,255,0.08)", background: "rgba(0,0,0,0.3)" }}
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
          color={health && health.current_streak_minutes > 90 ? ap.red : health && health.current_streak_minutes > 45 ? ap.orange : ap.green}
        />
        <StatusPill
          label="Integrations"
          value={unreadCount > 0 ? `${unreadCount} unread` : "clear"}
          active={unreadCount > 0}
          color={unreadCount > 5 ? ap.orange : ap.blue}
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
          color={ap.purple}
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
            color={ap.green}
            onClick={() => onNavigate("bg-agents")}
          />
        )}
      </div>

      {/* ── Main grid ── */}
      <div className="relative z-10 flex-1 overflow-y-auto px-4 pb-4 pt-4">

        {/* Row 1: Brief + Suggestions */}
        <div className="grid gap-3 mb-3" style={{ gridTemplateColumns: "minmax(0,1fr) 280px" }}>

          {/* ── INTELLIGENCE BRIEF ── */}
          <Panel title="Intelligence Brief" accent={ap.blue}>
            {godActive ? (
              <div className="h-full flex flex-col gap-3">
                {/* Perception vitals */}
                {perception && (
                  <div className="grid grid-cols-3 gap-3 border-b pb-3" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
                    <div className="flex flex-col gap-1">
                      <div className="text-[10px] uppercase tracking-wider" style={{ color: ap.muted }}>Focus</div>
                      <div className="text-sm font-semibold truncate" style={{ color: userStateColor(perception.user_state) }}>
                        {perception.user_state}
                      </div>
                      <div className="text-xs truncate" style={{ color: ap.muted }}>{perception.active_app}</div>
                    </div>
                    <div className="flex flex-col gap-1">
                      <div className="text-[10px] uppercase tracking-wider" style={{ color: ap.muted }}>System</div>
                      <div className="text-xs font-semibold tabular-nums" style={{ color: ap.teal }}>
                        RAM {perception.ram_used_gb.toFixed(1)}GB
                      </div>
                      <div className="text-xs" style={{ color: ap.muted }}>
                        DISK {perception.disk_free_gb.toFixed(0)}GB free
                      </div>
                    </div>
                    <div className="flex flex-col gap-1">
                      <div className="text-[10px] uppercase tracking-wider" style={{ color: ap.muted }}>Delta</div>
                      <div className="text-xs leading-tight" style={{ color: ap.orange }}>
                        {perception.delta_summary.slice(0, 60) || "No changes"}
                      </div>
                    </div>
                  </div>
                )}

                {/* Context tags */}
                {perception && perception.context_tags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 border-b pb-3" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
                    {perception.context_tags.slice(0, 8).map((tag) => (
                      <span
                        key={tag}
                        className="px-2 py-0.5 rounded-full text-[10px] font-medium"
                        style={{ background: `${ap.blue}14`, color: ap.blue, border: `1px solid ${ap.blue}25` }}
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}

                {/* Brief content lines */}
                {briefLines.length > 0 ? (
                  <div className="flex-1 overflow-y-auto space-y-1.5">
                    {briefLines.map((line, i) => {
                      const isBold = line.startsWith("**") && line.includes("**:");
                      const key = line.replace(/\*\*/g, "").split(":")[0];
                      const val = line.replace(/\*\*/g, "").split(":").slice(1).join(":").trim();
                      const lineColor =
                        key.includes("Focus") ? ap.teal :
                        key.includes("Delta") || key.includes("Changed") ? ap.orange :
                        key.includes("Error") ? ap.red :
                        key.includes("Memory") || key.includes("Recall") ? ap.purple :
                        ap.secondary;
                      return isBold ? (
                        <div key={i} className="flex gap-2 text-xs">
                          <span className="font-semibold shrink-0 uppercase tracking-wider" style={{ color: lineColor }}>
                            {key}
                          </span>
                          <span style={{ color: ap.secondary }}>{val}</span>
                        </div>
                      ) : (
                        <div key={i} className="text-xs leading-relaxed" style={{ color: ap.muted }}>
                          {line}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="flex-1 flex items-center justify-center">
                    <div className="text-center">
                      <div className="text-xs font-medium" style={{ color: ap.muted }}>
                        Waiting for scan...
                      </div>
                      {godModeUpdate && (
                        <div className="mt-1 text-xs" style={{ color: ap.muted }}>
                          Last update: {godModeUpdate.bytes}b · {godModeUpdate.tier}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Visible errors */}
                {perception && perception.visible_errors.length > 0 && (
                  <div className="border-t pt-2 space-y-1" style={{ borderColor: "rgba(255,69,58,0.2)" }}>
                    {perception.visible_errors.slice(0, 3).map((err, i) => (
                      <div key={i} className="flex gap-1.5 text-xs" style={{ color: ap.red }}>
                        <span className="shrink-0">!</span>
                        <span className="truncate">{err}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-3 py-6 text-center">
                <div className="text-xs font-medium" style={{ color: ap.muted }}>
                  God Mode offline
                </div>
                <div className="text-xs max-w-[200px] leading-relaxed" style={{ color: ap.muted }}>
                  Enable God Mode in Settings to see live context — active app, system state, and AI-generated briefs.
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    try { await invoke("toggle_god_mode", { enabled: true, tier: "normal" }); loadCore(); } catch { /* ignore */ }
                  }}
                  className="px-4 py-2 rounded-lg text-xs font-semibold transition-all duration-250 active:scale-95"
                  style={{ background: `${ap.orange}14`, color: ap.orange, border: `1px solid ${ap.orange}30` }}
                >
                  Enable God Mode
                </button>
              </div>
            )}
          </Panel>

          {/* ── PROACTIVE SUGGESTIONS ── */}
          <Panel title={`Suggestions (${suggestions.length})`} accent={ap.purple}>
            {suggestions.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full py-6 gap-2">
                <div className="text-xs font-medium" style={{ color: ap.muted }}>
                  All clear
                </div>
                <div className="text-xs" style={{ color: ap.muted }}>
                  No pending suggestions
                </div>
              </div>
            ) : (
              <div className="space-y-2 overflow-y-auto max-h-52">
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
        <div className="grid grid-cols-3 gap-3 mb-3">

          {/* Evolution */}
          <Panel title="Evolution" accent={ap.orange}>
            <div className="space-y-3">
              <div className="flex items-end justify-between gap-3">
                <div>
                  <div className="text-xs uppercase tracking-wider mb-1" style={{ color: ap.muted }}>Level</div>
                  <div
                    className="text-5xl font-bold leading-none tabular-nums"
                    style={{ color: ap.orange }}
                  >
                    {level?.level ?? 0}
                  </div>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between text-xs mb-1.5">
                    <span style={{ color: ap.muted }}>XP {(level?.score ?? 0).toLocaleString()}</span>
                    <span style={{ color: ap.orange }}>{xpProgress}%</span>
                  </div>
                  {/* Progress bar */}
                  <div className="h-1.5 w-full rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.08)" }}>
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{ width: `${xpProgress}%`, background: ap.orange }}
                    />
                  </div>
                  {level?.next_unlock && (
                    <div className="mt-1.5 text-xs truncate" style={{ color: ap.muted }}>
                      Next: {level.next_unlock}
                    </div>
                  )}
                </div>
              </div>
              {level && level.breakdown.slice(0, 3).map((item, i) => (
                <div
                  key={i}
                  className="border-l-2 pl-2.5 text-xs"
                  style={{ borderColor: `${ap.orange}50`, color: ap.muted }}
                >
                  {item}
                </div>
              ))}
            </div>
          </Panel>

          {/* Health */}
          <Panel title="Health Guardian" accent={ap.green}>
            {health ? (
              <div className="space-y-0">
                <DataRow label="Streak" value={fmtMinutes(health.current_streak_minutes)} accent={health.current_streak_minutes > 90 ? ap.red : ap.green} />
                <DataRow label="Daily Total" value={fmtMinutes(health.daily_total_minutes)} accent={ap.teal} />
                <DataRow label="Breaks Taken" value={<AnimatedNumber target={health.breaks_taken} />} accent={ap.orange} />
                <DataRow label="Status" value={health.status} accent={ap.green} mono={false} />
              </div>
            ) : (
              <div className="text-xs" style={{ color: ap.muted }}>Health guardian offline</div>
            )}
            <button
              type="button"
              onClick={() => onNavigate("health-panel")}
              className="mt-3 w-full py-2 rounded-lg text-xs font-medium transition-all duration-250 active:scale-95"
              style={{ background: `${ap.green}10`, color: ap.green, border: `1px solid ${ap.green}25` }}
            >
              Health Panel →
            </button>
          </Panel>

          {/* Total Recall */}
          <Panel title="Total Recall" accent={ap.blue}>
            {cfg?.screen_timeline_enabled && timeline ? (
              <div className="space-y-0">
                <DataRow label="Captures" value={<AnimatedNumber target={timeline.total_entries} />} accent={ap.blue} />
                <DataRow label="Disk Used" value={fmt(timeline.disk_bytes)} accent={ap.teal} />
                <DataRow label="Last Cap" value={relTime(timeline.newest_timestamp)} accent={ap.muted} mono={false} />
              </div>
            ) : (
              <div className="text-xs" style={{ color: ap.muted }}>
                {cfg?.screen_timeline_enabled ? "No captures yet" : "Disabled"}
              </div>
            )}
            <button
              type="button"
              onClick={() => onNavigate("screen-timeline")}
              className="mt-3 w-full py-2 rounded-lg text-xs font-medium transition-all duration-250 active:scale-95"
              style={{ background: `${ap.blue}10`, color: ap.blue, border: `1px solid ${ap.blue}25` }}
            >
              Open Timeline →
            </button>
          </Panel>
        </div>

        {/* Row 3: Active Agents */}
        <div className="mb-3">
          <Panel title={`Active Agents (${agents.length})`} accent={ap.green}>
            <div className="flex gap-3">
              {agents.length > 0 ? (
                <>
                  <div className="shrink-0" style={{ width: 160 }}>
                    <AgentPixelWorld agents={agents} height={80} width={160} />
                  </div>
                  <div className="flex-1 min-w-0 rounded-lg overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.06)" }}>
                    <div
                      className="grid gap-2 border-b px-3 py-2 text-[10px] font-semibold uppercase tracking-wider"
                      style={{ gridTemplateColumns: "3.5rem minmax(0,1fr) 5rem", borderColor: "rgba(255,255,255,0.06)", color: ap.muted }}
                    >
                      <div>PID</div>
                      <div>Task</div>
                      <div className="text-right">Status</div>
                    </div>
                    {agents.slice(0, 4).map((a) => (
                      <AgentRowCompact key={a.id} agent={a} />
                    ))}
                    {agents.length > 4 && (
                      <div className="px-3 py-1.5 text-xs" style={{ color: ap.muted }}>
                        +{agents.length - 4} more
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <div className="text-xs" style={{ color: ap.muted }}>No agents running</div>
              )}
            </div>
            <div className="flex gap-2 mt-3">
              <button
                type="button"
                onClick={() => onNavigate("swarm")}
                className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-250 active:scale-95"
                style={{ background: `${ap.green}10`, color: ap.green, border: `1px solid ${ap.green}25` }}
              >
                Swarm →
              </button>
              <button
                type="button"
                onClick={() => onNavigate("bg-agents")}
                className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-250 active:scale-95"
                style={{ background: `${ap.orange}10`, color: ap.orange, border: `1px solid ${ap.orange}25` }}
              >
                BG Agents →
              </button>
            </div>
          </Panel>
        </div>

        {/* Row 4: Cron Queue */}
        {crons.length > 0 && (
          <div className="mb-3">
            <Panel title={`Scheduled Tasks (${crons.length})`} accent={ap.muted}>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {crons.slice(0, 6).map((c) => (
                  <div
                    key={c.id}
                    className="rounded-lg px-3 py-2 text-xs"
                    style={{
                      background: c.enabled ? `${ap.blue}0a` : "rgba(255,255,255,0.03)",
                      border: `1px solid ${c.enabled ? `${ap.blue}20` : "rgba(255,255,255,0.06)"}`,
                    }}
                  >
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <span
                        className="h-1.5 w-1.5 rounded-full shrink-0"
                        style={{ background: c.enabled ? ap.green : ap.muted }}
                      />
                      <span className="truncate font-medium" style={{ color: c.enabled ? ap.text : ap.muted }}>
                        {c.name}
                      </span>
                    </div>
                    <div className="text-[10px]" style={{ color: ap.muted }}>
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
          <Panel title="Quick Actions" accent={ap.orange}>
            <div className="grid grid-cols-6 gap-2">
              <ActionBtn
                label="Lock Screen"
                icon="🔒"
                color={ap.red}
                loading={actionLoading["lock"]}
                onClick={() => quickAction("lock", () => invoke("lock_screen"))}
              />
              <ActionBtn
                label="Take Break"
                icon="☕"
                color={ap.green}
                loading={actionLoading["break"]}
                onClick={() => quickAction("break", () => invoke("health_take_break"))}
              />
              <ActionBtn
                label="Standup"
                icon="📋"
                color={ap.blue}
                onClick={() => onNavigate("temporal")}
              />
              <ActionBtn
                label="Scan System"
                icon="⬡"
                color={ap.orange}
                loading={actionLoading["scan"]}
                onClick={() => quickAction("scan", () => invoke("deep_scan_start"))}
              />
              <ActionBtn
                label="Security"
                icon="⚿"
                color={ap.purple}
                onClick={() => onNavigate("security")}
              />
              <ActionBtn
                label="Voice Mode"
                icon={voiceActive ? "◉" : "◎"}
                color={ap.purple}
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
