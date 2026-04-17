import React, { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { convertFileSrc } from "@tauri-apps/api/core";
import { NavRail, NavRailRoute } from "./NavRail";
import { HistoryDrawer } from "./HistoryDrawer";
import { ChatPanel, ChatPanelProps } from "./ChatPanel";

// ── Types ─────────────────────────────────────────────────────────────────────

interface DashboardProps {
  onNavigate: (route: string) => void;
  chatPanelProps: Omit<ChatPanelProps, "open" | "onClose">;
  activeRoute: string;
}

interface PerceptionState {
  active_app: string;
  active_title: string;
  user_state: string;
  ram_used_gb: number;
  disk_free_gb: number;
  context_tags: string[];
}

interface CalendarEvent {
  title: string;
  start_ts: number;
  minutes_until: number;
}

interface IntegrationState {
  unread_emails: number;
  upcoming_events: CalendarEvent[];
  slack_mentions: number;
  github_notifications: number;
  last_updated: number;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function Dot({ color, glow }: { color: string; glow?: boolean }) {
  return (
    <span
      className="w-[6px] h-[6px] rounded-full flex-shrink-0 inline-block"
      style={{
        background: color,
        boxShadow: glow ? `0 0 7px ${color}` : undefined,
        animation: glow ? "blade-pulse 2s ease-in-out infinite" : undefined,
      }}
    />
  );
}

function Chip({ children, color = "accent" }: { children: React.ReactNode; color?: "accent" | "green" | "amber" | "dim" }) {
  const styles = {
    accent: "bg-[rgba(129,140,248,0.15)] text-[#818cf8] border-[rgba(129,140,248,0.28)]",
    green:  "bg-[rgba(74,222,128,0.12)] text-[#4ade80] border-[rgba(74,222,128,0.22)]",
    amber:  "bg-[rgba(251,191,36,0.1)] text-[#fbbf24] border-[rgba(251,191,36,0.2)]",
    dim:    "bg-[rgba(255,255,255,0.05)] text-[rgba(255,255,255,0.28)] border-[rgba(255,255,255,0.08)]",
  }[color];
  return (
    <span className={`text-[9.5px] font-bold tracking-[0.05em] px-[8px] py-[2px] rounded-full border ${styles}`}>
      {children}
    </span>
  );
}

function CardLabel({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-[7px] text-[9.5px] font-bold tracking-[0.14em] uppercase text-[rgba(255,255,255,0.28)]">
      <span className="w-[18px] h-[18px] rounded-[5px] flex items-center justify-center bg-[rgba(129,140,248,0.15)] text-[#818cf8]">
        {icon}
      </span>
      {children}
    </div>
  );
}

// ── Wallpaper hook ─────────────────────────────────────────────────────────────

function useWallpaper() {
  const [wallpaperUrl, setWallpaperUrl] = useState<string | null>(null);
  useEffect(() => {
    invoke<string>("get_wallpaper_path")
      .then((path) => {
        if (path) setWallpaperUrl(convertFileSrc(path));
      })
      .catch(() => null); // fallback to gradient
  }, []);
  return wallpaperUrl;
}

// ── Live data hooks ─────────────────────────────────────────────────────────────

function usePerception() {
  const [perception, setPerception] = useState<PerceptionState | null>(null);
  useEffect(() => {
    const load = () => {
      invoke<PerceptionState | null>("perception_get_latest")
        .then((p) => { if (p) setPerception(p); })
        .catch(() => null);
    };
    load();
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, []);
  return perception;
}

function useHiveDigest() {
  const [digest, setDigest] = useState<string>("");
  const [organsActive, setOrgansActive] = useState(0);
  useEffect(() => {
    const load = () => {
      invoke<string>("hive_get_digest").then(setDigest).catch(() => null);
      invoke<{ active_tentacles: number }>("hive_get_status")
        .then((s) => setOrgansActive(s.active_tentacles))
        .catch(() => null);
    };
    load();
    const interval = setInterval(load, 10000);
    return () => clearInterval(interval);
  }, []);
  return { digest, organsActive };
}

function useIntegrations() {
  const [integrations, setIntegrations] = useState<IntegrationState>({
    unread_emails: 0,
    upcoming_events: [],
    slack_mentions: 0,
    github_notifications: 0,
    last_updated: 0,
  });
  useEffect(() => {
    const load = () => invoke<IntegrationState>("integration_get_state").then(setIntegrations).catch(() => null);
    load();
    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
  }, []);
  return integrations;
}

// ── Card components ────────────────────────────────────────────────────────────

function GodModeCard({ perception }: { perception: PerceptionState | null }) {
  const appName = perception?.active_app || "Scanning…";
  const filePath = perception?.active_title || "BLADE is learning your environment";
  const userState = perception?.user_state || "Initializing";

  const [stats, setStats] = useState({ agents: 0, services: 0, apiPerMin: 0, focus: 0 });
  useEffect(() => {
    const load = () => {
      Promise.all([
        invoke<Array<unknown>>("agent_list_background").catch(() => []),
        invoke<{ services_alive: number; blood_pressure: { api_calls_per_minute: number }; focus_score: number }>("blade_vital_signs").catch(() => null),
      ]).then(([agents, vitals]) => {
        setStats({
          agents: (agents as Array<unknown>).length,
          services: vitals?.services_alive || 0,
          apiPerMin: vitals?.blood_pressure?.api_calls_per_minute || 0,
          focus: vitals?.focus_score || 0,
        });
      });
    };
    load();
    const interval = setInterval(load, 15000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="blade-glass flex flex-col p-5 gap-0 animate-[blade-card-in_0.5s_cubic-bezier(0.22,1,0.36,1)_0.03s_both]">
      <div className="flex items-center justify-between mb-4">
        <CardLabel icon={<svg viewBox="0 0 12 12" className="w-[10px] h-[10px]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="6" r="4.5" strokeDasharray="1.8 2.5"/></svg>}>
          God Mode
        </CardLabel>
        <Chip color="accent">Extreme</Chip>
      </div>

      <div className="flex-1 flex flex-col justify-center">
        <div className="text-[11px] font-semibold tracking-[0.06em] uppercase text-[rgba(255,255,255,0.28)] mb-1">
          Currently in
        </div>
        <div className="text-[44px] font-extrabold leading-[0.95] tracking-[-0.03em] text-white mb-2 truncate">
          {appName}
        </div>
        <div className="font-mono text-[12px] text-[#60a5fa] mb-4 truncate">
          {filePath.length > 50 ? `…${filePath.slice(-48)}` : filePath}
        </div>
        <div className="inline-flex items-center gap-[6px] px-3 py-[5px] rounded-full
          bg-[rgba(74,222,128,0.1)] border border-[rgba(74,222,128,0.22)]
          text-[#4ade80] text-[11px] font-semibold self-start">
          <Dot color="#4ade80" glow />
          {userState}
        </div>
      </div>

      <div className="mt-4 pt-4 border-t border-[rgba(255,255,255,0.07)] flex gap-4">
        {[
          { label: "Agents", value: String(stats.agents), color: stats.agents > 0 ? "text-white" : "text-[rgba(255,255,255,0.35)]" },
          { label: "Services", value: String(stats.services), color: "text-[#60a5fa]" },
          { label: "API/min", value: String(stats.apiPerMin), color: stats.apiPerMin > 10 ? "text-[#fbbf24]" : "text-[#4ade80]" },
          { label: "Focus", value: `${stats.focus}%`, color: stats.focus >= 60 ? "text-[#4ade80]" : "text-[#fbbf24]" },
        ].map(({ label, value, color }, i) => (
          <React.Fragment key={label}>
            {i > 0 && <div className="w-px bg-[rgba(255,255,255,0.08)] self-stretch" />}
            <div className="flex flex-col gap-[2px]">
              <div className={`text-[18px] font-bold tracking-[-0.03em] leading-none ${color}`}>{value}</div>
              <div className="text-[9.5px] font-semibold tracking-[0.08em] uppercase text-[rgba(255,255,255,0.28)]">{label}</div>
            </div>
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

function HiveCard({ organsActive, digest }: { organsActive: number; digest: string }) {
  // Parse organ names from digest (line starting with "**Active organs:**")
  const organLine = digest.split("\n").find(l => l.includes("Active organs:"));
  const organNames = organLine
    ? organLine.replace("**Active organs:**", "").trim().split(", ").filter(Boolean)
    : [];

  // Parse urgent items (lines starting with "- **platform** URGENT:")
  const urgentLines = digest.split("\n").filter(l => l.includes("URGENT:"));

  const statusColor = organsActive > 0 ? "#4ade80" : "#fbbf24";
  const statusLabel = organsActive > 0 ? `${organsActive} active` : "dormant";

  return (
    <div className="blade-glass flex flex-col p-4 gap-3 animate-[blade-card-in_0.5s_cubic-bezier(0.22,1,0.36,1)_0.08s_both]">
      <div className="flex items-center justify-between">
        <CardLabel icon={<svg viewBox="0 0 12 12" className="w-[10px] h-[10px]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="4" cy="4" r="1.5"/><circle cx="9" cy="3" r="1.5"/><circle cx="9" cy="9" r="1.5"/><path d="M5.5 4h1.5a2 2 0 010 4H4M9 4.5v3"/></svg>}>
          Hive
        </CardLabel>
        <Chip color={organsActive > 0 ? "green" : "amber"}>{statusLabel}</Chip>
      </div>
      <div className="flex flex-col gap-[10px] flex-1">
        {organNames.length > 0 ? organNames.map((name) => (
          <div key={name} className="flex items-center gap-[6px]">
            <Dot color={statusColor} glow />
            <span className="text-[12px] font-semibold capitalize">{name}</span>
          </div>
        )) : (
          <div className="flex flex-col items-center justify-center py-3 gap-2">
            <div className="w-[28px] h-[28px] rounded-full border border-[rgba(129,140,248,0.2)] flex items-center justify-center"
              style={{ animation: "blade-pulse 3s ease-in-out infinite" }}>
              <div className="w-[10px] h-[10px] rounded-full bg-[rgba(129,140,248,0.3)]" />
            </div>
            <div className="text-[10px] text-[rgba(255,255,255,0.3)] text-center">
              Hive is scanning your environment…<br/>
              <span className="text-[rgba(129,140,248,0.5)]">Connect APIs in Settings to activate tentacles</span>
            </div>
          </div>
        )}
        {urgentLines.length > 0 && (
          <div className="mt-1 pt-2 border-t border-[rgba(255,255,255,0.07)]">
            {urgentLines.map((line, i) => (
              <div key={i} className="text-[11px] text-[#fbbf24] truncate">{line.replace(/^- \*\*\w+\*\* /, "")}</div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function IntegrationsCard({ integrations }: { integrations: IntegrationState }) {
  const eventCount = integrations.upcoming_events.length;
  const tiles = [
    { name: "Email", value: String(integrations.unread_emails || 0), sub: "unread", color: integrations.unread_emails > 0 ? "#fbbf24" : "#4ade80" },
    { name: "Slack", value: String(integrations.slack_mentions || 0), sub: "mentions", color: integrations.slack_mentions > 0 ? "#fbbf24" : "#4ade80" },
    { name: "GitHub", value: integrations.github_notifications > 0 ? String(integrations.github_notifications) : "✓", sub: integrations.github_notifications > 0 ? "notifs" : "CI passing", color: "#4ade80" },
    { name: "Calendar", value: String(eventCount), sub: "today", color: "#818cf8" },
  ];
  return (
    <div className="blade-glass flex flex-col p-4 gap-3 animate-[blade-card-in_0.5s_cubic-bezier(0.22,1,0.36,1)_0.13s_both]">
      <div className="flex items-center justify-between">
        <CardLabel icon={<svg viewBox="0 0 12 12" className="w-[10px] h-[10px]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><rect x="1" y="1" width="4" height="4" rx="1"/><rect x="7" y="1" width="4" height="4" rx="1"/><rect x="1" y="7" width="4" height="4" rx="1"/><path d="M9 7v4M11 9H7"/></svg>}>
          Integrations
        </CardLabel>
      </div>
      <div className="grid grid-cols-2 gap-[6px] flex-1">
        {tiles.map((t) => (
          <div key={t.name} className="p-[9px_10px] rounded-[11px] bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.07)] flex flex-col gap-[3px] hover:bg-[rgba(255,255,255,0.07)] transition-colors cursor-default">
            <div className="text-[9.5px] font-semibold tracking-[0.1em] uppercase text-[rgba(255,255,255,0.28)]">{t.name}</div>
            <div className="text-[24px] font-bold tracking-[-0.04em] leading-none" style={{ color: t.color }}>{t.value}</div>
            <div className="text-[10px] text-[rgba(255,255,255,0.55)]">{t.sub}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function CalendarCard({ integrations }: { integrations: IntegrationState }) {
  const events = integrations.upcoming_events.slice(0, 3).map((ev, i) => ({
    time: new Date(ev.start_ts * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    name: ev.title,
    meta: ev.minutes_until > 0 ? `in ${ev.minutes_until} min` : "happening now",
    badge: i === 0 && ev.minutes_until > 0 ? `in ${ev.minutes_until} min` : null as string | null,
    isNext: i === 0,
  }));

  return (
    <div className="blade-glass flex flex-col p-[18px] gap-[14px] animate-[blade-card-in_0.5s_cubic-bezier(0.22,1,0.36,1)_0.18s_both]">
      <CardLabel icon={<svg viewBox="0 0 12 12" className="w-[10px] h-[10px]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><rect x="1" y="2" width="10" height="9" rx="1.5"/><path d="M1 5h10M4 1v2M8 1v2"/></svg>}>
        Calendar
      </CardLabel>
      {events.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-5 gap-2">
          <svg viewBox="0 0 24 24" className="w-[20px] h-[20px] text-[rgba(255,255,255,0.15)]" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>
          </svg>
          <div className="text-[10px] text-[rgba(255,255,255,0.25)] text-center">
            No events yet<br/>
            <span className="text-[rgba(129,140,248,0.5)]">Connect Google Calendar in Settings</span>
          </div>
        </div>
      ) : (
      <div className="flex flex-col relative">
        <div className="absolute left-[6px] top-[8px] bottom-[8px] w-px bg-[rgba(255,255,255,0.08)]" />
        {events.map((ev, i) => (
          <div key={i} className="flex gap-[14px] items-start py-[10px] rounded-[11px] hover:bg-[rgba(255,255,255,0.04)] transition-colors cursor-default pl-0 pr-2">
            <div className="w-[13px] h-[13px] rounded-full flex-shrink-0 flex items-center justify-center mt-[2px] relative z-[1]"
              style={{
                border: ev.isNext ? "1.5px solid #818cf8" : "1.5px solid rgba(255,255,255,0.12)",
                background: ev.isNext ? "rgba(129,140,248,0.15)" : "rgba(255,255,255,0.04)",
              }}>
              <span className="w-[7px] h-[7px] rounded-full block"
                style={{
                  background: ev.isNext ? "#818cf8" : "rgba(255,255,255,0.2)",
                  boxShadow: ev.isNext ? "0 0 8px #818cf8" : undefined,
                  animation: ev.isNext ? "blade-pulse 2s ease-in-out infinite" : undefined,
                }} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-mono text-[10px] mb-[2px]" style={{ color: ev.isNext ? "#818cf8" : "rgba(255,255,255,0.28)" }}>{ev.time}</div>
              <div className="text-[13px] font-semibold truncate">{ev.name}</div>
              <div className="text-[11px] text-[rgba(255,255,255,0.55)] mt-[2px]">{ev.meta}</div>
              {ev.badge && (
                <span className="mt-[5px] inline-block text-[9px] font-bold tracking-[0.07em] uppercase px-[7px] py-[2px] rounded-full bg-[rgba(129,140,248,0.14)] text-[#818cf8]">
                  {ev.badge}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
      )}
    </div>
  );
}

function VitalSignsCard() {
  const [vitals, setVitals] = useState<{
    overall: string;
    hormones: { arousal: number; energy_mode: number; trust: number; insulin: number; adrenaline: number; leptin: number };
    blood_pressure: { events_per_minute: number; api_calls_per_minute: number; status: string };
    services_alive: number;
    services_dead: string[];
    hive_organs_active: number;
    focus_score: number;
  } | null>(null);

  useEffect(() => {
    const load = () => invoke<typeof vitals>("blade_vital_signs").then(setVitals).catch(() => null);
    load();
    const interval = setInterval(load, 15000);
    return () => clearInterval(interval);
  }, []);

  const overall = vitals?.overall || "unknown";

  const hormones = vitals?.hormones;
  const bars = hormones ? [
    { label: "Energy", value: hormones.energy_mode, color: "#818cf8" },
    { label: "Arousal", value: hormones.arousal, color: "#60a5fa" },
    { label: "Trust", value: hormones.trust, color: "#4ade80" },
    { label: "Insulin", value: hormones.insulin, color: hormones.insulin > 0.6 ? "#f87171" : "#4ade80" },
  ] : [];

  return (
    <div className="blade-glass flex flex-col p-4 gap-3 flex-1 min-h-0 animate-[blade-card-in_0.5s_cubic-bezier(0.22,1,0.36,1)_0.22s_both]">
      <div className="flex items-center justify-between">
        <CardLabel icon={<svg viewBox="0 0 12 12" className="w-[10px] h-[10px]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M6 2v3l2 2"/><circle cx="6" cy="6" r="5"/></svg>}>
          Body Status
        </CardLabel>
        <Chip color={overall === "healthy" ? "green" : overall === "critical" ? "accent" : "amber"}>
          {overall}
        </Chip>
      </div>
      <div className="flex flex-col gap-[6px] flex-1 overflow-hidden">
        {bars.map((bar) => (
          <div key={bar.label} className="flex items-center gap-[8px]">
            <span className="text-[10px] text-[rgba(255,255,255,0.45)] w-[50px] text-right">{bar.label}</span>
            <div className="flex-1 h-[4px] bg-[rgba(255,255,255,0.07)] rounded-full overflow-hidden">
              <div className="h-full rounded-full transition-all duration-700" style={{ width: `${(bar.value * 100).toFixed(0)}%`, background: bar.color }} />
            </div>
            <span className="text-[10px] text-[rgba(255,255,255,0.35)] w-[28px]">{(bar.value * 100).toFixed(0)}%</span>
          </div>
        ))}
        {vitals && (
          <div className="mt-auto pt-2 border-t border-[rgba(255,255,255,0.06)] flex items-center justify-between text-[10px] text-[rgba(255,255,255,0.35)]">
            <span>{vitals.services_alive} services</span>
            <span>{vitals.blood_pressure?.api_calls_per_minute || 0} API/min</span>
            <span>Focus: {vitals.focus_score}%</span>
          </div>
        )}
      </div>
    </div>
  );
}

function ProactiveCardsPanel() {
  const [cards, setCards] = useState<Array<{
    card_type: string; title: string; body: string; source_app: string; confidence: number; timestamp: number;
  }>>([]);

  useEffect(() => {
    const load = () => invoke<typeof cards>("proactive_get_cards", { limit: 4 }).then(setCards).catch(() => null);
    load();
    const interval = setInterval(load, 10000);
    return () => clearInterval(interval);
  }, []);

  const iconForType = (t: string) => {
    switch (t) {
      case "task": return "📋";
      case "focus": return "🎯";
      case "insight": return "💡";
      case "memory": return "🧠";
      default: return "•";
    }
  };

  if (cards.length === 0) {
    return (
      <div className="blade-glass p-4 flex-shrink-0 animate-[blade-card-in_0.5s_cubic-bezier(0.22,1,0.36,1)_0.26s_both]">
        <div className="flex items-center justify-between mb-2">
          <CardLabel icon={<svg viewBox="0 0 12 12" className="w-[10px] h-[10px]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M6 1v4M4 3l2 2 2-2M1 7h10M3 9h6"/></svg>}>
            Proactive
          </CardLabel>
          <Chip color="dim">quiet</Chip>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-[6px] h-[6px] rounded-full bg-[rgba(129,140,248,0.4)]" style={{ animation: "blade-pulse 3s ease-in-out infinite" }} />
          <span className="text-[11px] text-[rgba(255,255,255,0.3)]">Watching and learning your patterns…</span>
        </div>
      </div>
    );
  }

  return (
    <div className="blade-glass flex flex-col p-4 gap-2 flex-shrink-0 animate-[blade-card-in_0.5s_cubic-bezier(0.22,1,0.36,1)_0.26s_both]">
      <div className="flex items-center justify-between">
        <CardLabel icon={<svg viewBox="0 0 12 12" className="w-[10px] h-[10px]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M6 1v4M4 3l2 2 2-2M1 7h10M3 9h6"/></svg>}>
          Proactive
        </CardLabel>
        <Chip color="amber">{cards.length} cards</Chip>
      </div>
      <div className="flex flex-col gap-[4px] overflow-hidden">
        {cards.slice(0, 3).map((card, i) => (
          <div key={i} className="flex items-start gap-[6px] px-[8px] py-[6px] rounded-[8px] bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.06)] group">
            <span className="text-[12px] flex-shrink-0 mt-[1px]">{iconForType(card.card_type)}</span>
            <div className="flex-1 min-w-0">
              <div className="text-[11px] font-semibold truncate">{card.title}</div>
              <div className="text-[10px] text-[rgba(255,255,255,0.5)] truncate">{card.body}</div>
            </div>
            <button
              onClick={() => {
                invoke("send_message_stream", {
                  messages: [{ role: "user", content: `Handle this: ${card.body}`, image_base64: null }],
                }).catch(() => null);
              }}
              className="text-[9px] px-[6px] py-[2px] rounded bg-[rgba(129,140,248,0.15)] text-[#818cf8] border border-[rgba(129,140,248,0.2)] opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 hover:bg-[rgba(129,140,248,0.25)]"
            >
              act
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Dashboard (shell) ─────────────────────────────────────────────────────────

export function Dashboard({ onNavigate, chatPanelProps, activeRoute }: DashboardProps) {
  const [chatOpen, setChatOpen] = useState(false);
  const [histOpen, setHistOpen] = useState(false);
  const wallpaperUrl = useWallpaper();
  const perception = usePerception();
  const integrations = useIntegrations();
  const { digest: hiveDigest, organsActive } = useHiveDigest();

  const handleNavigate = useCallback((route: NavRailRoute) => {
    onNavigate(route);
  }, [onNavigate]);

  return (
    <div className="relative w-full h-full overflow-hidden">
      {/* Wallpaper background */}
      <div
        className="fixed inset-0 z-0 bg-cover bg-center"
        style={{
          backgroundImage: wallpaperUrl
            ? `url(${wallpaperUrl})`
            : "radial-gradient(ellipse 90% 70% at 15% 25%, rgba(88,50,220,0.65) 0%, transparent 65%), radial-gradient(ellipse 70% 90% at 85% 15%, rgba(40,20,140,0.55) 0%, transparent 60%), radial-gradient(ellipse 80% 60% at 70% 85%, rgba(160,30,90,0.4) 0%, transparent 65%), #06060f",
        }}
      />
      {/* Dark scrim */}
      <div className="fixed inset-0 z-[1] pointer-events-none" style={{ background: "rgba(0,0,0,0.38)" }} />

      {/* Nav rail */}
      <div className="relative z-[200]">
        <NavRail
          activeRoute={activeRoute}
          onNavigate={handleNavigate}
          onOpenHistory={() => setHistOpen((v) => !v)}
        />
      </div>

      {/* History drawer */}
      <HistoryDrawer
        open={histOpen}
        conversations={chatPanelProps.conversations}
        currentConversationId={chatPanelProps.currentConversationId}
        onClose={() => setHistOpen(false)}
        onSelect={(id) => { chatPanelProps.onSwitchConversation(id); setChatOpen(true); }}
        onNew={() => { chatPanelProps.onNewConversation(); setChatOpen(true); setHistOpen(false); }}
      />

      {/* Main grid */}
      <div
        className="relative z-[10] flex flex-col ml-[62px] mt-[34px] h-[calc(100vh-34px-26px)] p-[12px] gap-[10px] overflow-hidden transition-[margin-right] duration-[460ms]"
        style={{
          transitionTimingFunction: "cubic-bezier(0.32,0.72,0,1)",
          marginRight: chatOpen ? "400px" : "0px",
        }}
      >
        {/* Top row: 1.7fr 1fr 0.75fr */}
        <div className="grid gap-[10px] min-h-0" style={{ gridTemplateColumns: "1.7fr 1fr 0.75fr", flex: "0 0 47%" }}>
          <GodModeCard perception={perception} />
          <HiveCard organsActive={organsActive} digest={hiveDigest} />
          <IntegrationsCard integrations={integrations} />
        </div>

        {/* Bottom row: 1.05fr 1.3fr */}
        <div className="grid gap-[10px] flex-1 min-h-0" style={{ gridTemplateColumns: "1.05fr 1.3fr" }}>
          <CalendarCard integrations={integrations} />
          <div className="flex flex-col gap-[10px] min-h-0">
            <VitalSignsCard />
            <ProactiveCardsPanel />
          </div>
        </div>
      </div>

      {/* Chat panel */}
      <ChatPanel
        open={chatOpen}
        onClose={() => setChatOpen(false)}
        {...chatPanelProps}
      />

      {/* FAB — opens chat */}
      {!chatOpen && (
        <button
          onClick={() => setChatOpen(true)}
          className="fixed bottom-[20px] right-[20px] w-[50px] h-[50px] rounded-[16px] z-[170]
            bg-[#818cf8] border-none cursor-pointer flex items-center justify-center text-white
            shadow-[0_6px_24px_rgba(129,140,248,0.45),0_12px_40px_rgba(0,0,0,0.4)]
            hover:scale-105 hover:shadow-[0_8px_32px_rgba(129,140,248,0.55)]
            active:scale-[0.92] transition-all duration-200"
        >
          <svg viewBox="0 0 20 20" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 13a2 2 0 01-2 2H6l-4 3V4a2 2 0 012-2h12a2 2 0 012 2v9z"/>
          </svg>
        </button>
      )}
    </div>
  );
}
