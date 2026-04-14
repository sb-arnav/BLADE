// src/components/HiveView.tsx
// BLADE Hive Control Center — Mission control for the distributed agent mesh.
// Canvas-based network graph, live feed, pending decisions, and stats strip.

import { useState, useEffect, useRef, useCallback } from "react";
import { TentacleDetail, TentacleNode } from "./TentacleDetail";

// ── Types ─────────────────────────────────────────────────────────────────────

interface HeadModel {
  id: string;
  name: string;
  tentacleIds: string[];
}

interface Report {
  id: string;
  tentacleId: string;
  platform: string;
  icon: string;
  timestamp: number;
  priority: "critical" | "high" | "normal" | "low";
  summary: string;
  needsApproval: boolean;
  approved?: boolean;
  rejected?: boolean;
}

interface PendingDecision {
  id: string;
  what: string;
  why: string;
  confidence: number; // 0–100
  tentacleId: string;
  platform: string;
  icon: string;
  status: "pending" | "approved" | "rejected" | "executing" | "done";
}

interface HiveStats {
  msgsToday: number;
  actionsToday: number;
  autoDecisions: number;
  manualDecisions: number;
  avgResponseMs: number;
}

interface HiveViewProps {
  onBack: () => void;
}

// ── Mock seed data ─────────────────────────────────────────────────────────────

const SEED_TENTACLES: TentacleNode[] = [
  {
    id: "t-gmail",
    platform: "Gmail",
    icon: "✉",
    status: "online",
    uptime: 83400,
    messageCount: 47,
    actionsToday: 12,
    headModel: "openrouter/anthropic/claude-3.5-sonnet",
    notificationsEnabled: true,
    lastSeen: Math.floor(Date.now() / 1000) - 45,
    recentMessages: [
      { id: "m1", summary: "Invoice from AWS — $312.40 due Friday", priority: "high", timestamp: Math.floor(Date.now() / 1000) - 120 },
      { id: "m2", summary: "Meeting request from Sarah re: Q2 planning", priority: "normal", timestamp: Math.floor(Date.now() / 1000) - 900 },
    ],
    recentActions: [
      { id: "a1", action: "Drafted reply to Sarah confirming Thursday 2pm", status: "done", timestamp: Math.floor(Date.now() / 1000) - 880 },
    ],
  },
  {
    id: "t-slack",
    platform: "Slack",
    icon: "💬",
    status: "online",
    uptime: 72000,
    messageCount: 134,
    actionsToday: 28,
    headModel: "openrouter/anthropic/claude-3.5-sonnet",
    notificationsEnabled: true,
    lastSeen: Math.floor(Date.now() / 1000) - 8,
    recentMessages: [
      { id: "m3", summary: "#engineering: prod deploy blocked — pipeline red", priority: "critical", timestamp: Math.floor(Date.now() / 1000) - 15 },
      { id: "m4", summary: "@arnav mentioned in #general: great demo yesterday!", priority: "low", timestamp: Math.floor(Date.now() / 1000) - 1800 },
    ],
    recentActions: [
      { id: "a2", action: "Summarized 47-message thread in #engineering", status: "done", timestamp: Math.floor(Date.now() / 1000) - 600 },
      { id: "a3", action: "Drafted response to prod-blocking question", status: "pending", timestamp: Math.floor(Date.now() / 1000) - 14 },
    ],
  },
  {
    id: "t-github",
    platform: "GitHub",
    icon: "⎇",
    status: "online",
    uptime: 91200,
    messageCount: 23,
    actionsToday: 7,
    headModel: "openrouter/google/gemini-pro-1.5",
    notificationsEnabled: true,
    lastSeen: Math.floor(Date.now() / 1000) - 320,
    recentMessages: [
      { id: "m5", summary: "PR #287 review requested — 'feat: hive control center'", priority: "high", timestamp: Math.floor(Date.now() / 1000) - 320 },
    ],
    recentActions: [
      { id: "a4", action: "Posted code review comment on PR #281", status: "done", timestamp: Math.floor(Date.now() / 1000) - 7200 },
    ],
  },
  {
    id: "t-calendar",
    platform: "Calendar",
    icon: "📅",
    status: "online",
    uptime: 91200,
    messageCount: 8,
    actionsToday: 3,
    headModel: "openrouter/google/gemini-pro-1.5",
    notificationsEnabled: true,
    lastSeen: Math.floor(Date.now() / 1000) - 1800,
    recentMessages: [
      { id: "m6", summary: "Conflict detected: standup and dentist both at 9am tomorrow", priority: "high", timestamp: Math.floor(Date.now() / 1000) - 1800 },
    ],
    recentActions: [
      { id: "a5", action: "Identified free slot at 10am to reschedule dentist", status: "done", timestamp: Math.floor(Date.now() / 1000) - 1790 },
    ],
  },
  {
    id: "t-browser",
    platform: "Browser",
    icon: "🌐",
    status: "degraded",
    uptime: 14400,
    messageCount: 15,
    actionsToday: 9,
    headModel: "openrouter/anthropic/claude-3-haiku",
    notificationsEnabled: false,
    lastSeen: Math.floor(Date.now() / 1000) - 240,
    recentMessages: [
      { id: "m7", summary: "Completed price comparison for standing desk — 3 results", priority: "normal", timestamp: Math.floor(Date.now() / 1000) - 240 },
    ],
    recentActions: [
      { id: "a6", action: "Scraped pricing data from 3 vendor sites", status: "done", timestamp: Math.floor(Date.now() / 1000) - 250 },
    ],
  },
  {
    id: "t-desktop",
    platform: "Desktop",
    icon: "🖥",
    status: "online",
    uptime: 91200,
    messageCount: 61,
    actionsToday: 19,
    headModel: "openrouter/anthropic/claude-3.5-sonnet",
    notificationsEnabled: true,
    lastSeen: Math.floor(Date.now() / 1000) - 3,
    recentMessages: [
      { id: "m8", summary: "File watcher: /src/App.tsx modified — 847 lines changed", priority: "normal", timestamp: Math.floor(Date.now() / 1000) - 3 },
    ],
    recentActions: [
      { id: "a7", action: "Notified dev loop about large file change", status: "done", timestamp: Math.floor(Date.now() / 1000) - 3 },
    ],
  },
  {
    id: "t-telegram",
    platform: "Telegram",
    icon: "✈",
    status: "offline",
    uptime: 0,
    messageCount: 0,
    actionsToday: 0,
    headModel: "openrouter/anthropic/claude-3-haiku",
    notificationsEnabled: false,
    lastSeen: Math.floor(Date.now() / 1000) - 14400,
    recentMessages: [],
    recentActions: [],
  },
];

const SEED_HEAD_MODELS: HeadModel[] = [
  { id: "h1", name: "Claude 3.5 Sonnet", tentacleIds: ["t-gmail", "t-slack", "t-desktop"] },
  { id: "h2", name: "Gemini Pro 1.5",    tentacleIds: ["t-github", "t-calendar"] },
  { id: "h3", name: "Claude 3 Haiku",    tentacleIds: ["t-browser", "t-telegram"] },
];

const SEED_REPORTS: Report[] = [
  {
    id: "r1", tentacleId: "t-slack", platform: "Slack", icon: "💬",
    timestamp: Math.floor(Date.now() / 1000) - 15, priority: "critical",
    summary: "Production deploy blocked — pipeline failure in #engineering. 4 engineers waiting.",
    needsApproval: true,
  },
  {
    id: "r2", tentacleId: "t-calendar", platform: "Calendar", icon: "📅",
    timestamp: Math.floor(Date.now() / 1000) - 1800, priority: "high",
    summary: "Schedule conflict tomorrow: standup overlaps dentist. Suggest reschedule.",
    needsApproval: true,
  },
  {
    id: "r3", tentacleId: "t-github", platform: "GitHub", icon: "⎇",
    timestamp: Math.floor(Date.now() / 1000) - 320, priority: "high",
    summary: "PR #287 review requested on feat/hive-control. Diff: +1,204 / -87 lines.",
    needsApproval: false,
  },
  {
    id: "r4", tentacleId: "t-gmail", platform: "Gmail", icon: "✉",
    timestamp: Math.floor(Date.now() / 1000) - 120, priority: "high",
    summary: "AWS invoice $312.40 due Friday. No action required unless budget alert threshold exceeded.",
    needsApproval: false,
  },
  {
    id: "r5", tentacleId: "t-desktop", platform: "Desktop", icon: "🖥",
    timestamp: Math.floor(Date.now() / 1000) - 3, priority: "normal",
    summary: "Large edit in /src/App.tsx (847 lines). Dev loop is active.",
    needsApproval: false,
  },
  {
    id: "r6", tentacleId: "t-browser", platform: "Browser", icon: "🌐",
    timestamp: Math.floor(Date.now() / 1000) - 240, priority: "normal",
    summary: "Price comparison complete: Uplift $1,399, FlexiSpot $899, IKEA $549.",
    needsApproval: false,
  },
];

const SEED_DECISIONS: PendingDecision[] = [
  {
    id: "d1", what: "Reply to Sarah: 'Thursday 2pm works, confirmed.'",
    why: "Meeting request was positive, slot is free in your calendar, matches your communication style.",
    confidence: 94, tentacleId: "t-gmail", platform: "Gmail", icon: "✉", status: "pending",
  },
  {
    id: "d2", what: "Reschedule dentist to Wednesday 10am via Google Calendar.",
    why: "Conflict detected with team standup at 9am. Wednesday 10am is your next free block.",
    confidence: 88, tentacleId: "t-calendar", platform: "Calendar", icon: "📅", status: "pending",
  },
  {
    id: "d3", what: "Post to #engineering: 'Looking at the pipeline — may have a fix in 15m'",
    why: "You have context on the failing config from last week. Team has been waiting 12m.",
    confidence: 71, tentacleId: "t-slack", platform: "Slack", icon: "💬", status: "pending",
  },
];

// ── Canvas network graph ──────────────────────────────────────────────────────

interface GraphLayout {
  tentacles: Array<{ id: string; x: number; y: number; node: TentacleNode }>;
  heads: Array<{ id: string; x: number; y: number; model: HeadModel }>;
  center: { x: number; y: number };
}

function buildLayout(tentacles: TentacleNode[], heads: HeadModel[], w: number, h: number): GraphLayout {
  const cx = w / 2;
  const cy = h / 2;

  // Heads in inner ring
  const headR = Math.min(w, h) * 0.22;
  const headPositions = heads.map((hm, i) => {
    const angle = (i / heads.length) * Math.PI * 2 - Math.PI / 2;
    return { id: hm.id, x: cx + Math.cos(angle) * headR, y: cy + Math.sin(angle) * headR, model: hm };
  });

  // Tentacles in outer ring, clustered by head
  const tentacleR = Math.min(w, h) * 0.41;
  const tentaclePositions: GraphLayout["tentacles"] = [];

  heads.forEach((hm, hi) => {
    const baseAngle = (hi / heads.length) * Math.PI * 2 - Math.PI / 2;
    const spread = (Math.PI * 2) / heads.length * 0.7;
    hm.tentacleIds.forEach((tid, ti) => {
      const node = tentacles.find((t) => t.id === tid);
      if (!node) return;
      const offsetAngle = baseAngle + spread * (ti - (hm.tentacleIds.length - 1) / 2) * 0.55;
      tentaclePositions.push({
        id: tid,
        x: cx + Math.cos(offsetAngle) * tentacleR,
        y: cy + Math.sin(offsetAngle) * tentacleR,
        node,
      });
    });
  });

  return { tentacles: tentaclePositions, heads: headPositions, center: { x: cx, y: cy } };
}

const STATUS_COLORS_CANVAS = {
  online:   { stroke: "#22c55e", fill: "rgba(34,197,94,0.15)",  glow: "rgba(34,197,94,0.5)" },
  degraded: { stroke: "#f59e0b", fill: "rgba(245,158,11,0.15)", glow: "rgba(245,158,11,0.5)" },
  offline:  { stroke: "#ef4444", fill: "rgba(239,68,68,0.1)",   glow: "rgba(239,68,68,0.4)" },
  dormant:  { stroke: "#4b5563", fill: "rgba(75,85,99,0.08)",   glow: "rgba(75,85,99,0.2)" },
};

function NetworkCanvas({
  tentacles,
  heads,
  selectedId,
  onSelect,
}: {
  tentacles: TentacleNode[];
  heads: HeadModel[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef<number>(0);
  const tickRef = useRef(0);
  const layoutRef = useRef<GraphLayout | null>(null);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;
    const tick = ++tickRef.current;

    ctx.clearRect(0, 0, W, H);

    const layout = layoutRef.current!;
    if (!layout) return;

    // Draw edge lines: tentacle → head
    for (const t of layout.tentacles) {
      const hm = heads.find((h) => h.tentacleIds.includes(t.id));
      if (!hm) continue;
      const hp = layout.heads.find((h) => h.id === hm.id);
      if (!hp) continue;

      const sc = STATUS_COLORS_CANVAS[t.node.status];
      const isActive = t.node.status === "online" || t.node.status === "degraded";
      const alpha = isActive ? 0.25 + Math.sin(tick * 0.04 + t.x) * 0.1 : 0.08;

      ctx.beginPath();
      ctx.moveTo(t.x, t.y);
      ctx.lineTo(hp.x, hp.y);
      ctx.strokeStyle = sc.stroke.replace(")", `, ${alpha})`).replace("rgb", "rgba").replace("rgba(", "rgba(");
      // Rebuild color with alpha properly
      if (isActive) {
        ctx.strokeStyle = `rgba(${t.node.status === "online" ? "34,197,94" : "245,158,11"}, ${alpha})`;
      } else {
        ctx.strokeStyle = `rgba(75,85,99, ${alpha})`;
      }
      ctx.lineWidth = t.id === selectedId ? 1.5 : 0.8;
      ctx.stroke();
    }

    // Draw head→center lines
    for (const hp of layout.heads) {
      const pulse = 0.15 + Math.sin(tick * 0.03 + hp.x * 0.01) * 0.08;
      ctx.beginPath();
      ctx.moveTo(hp.x, hp.y);
      ctx.lineTo(layout.center.x, layout.center.y);
      ctx.strokeStyle = `rgba(99,102,241,${pulse})`;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 6]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Draw tentacle nodes
    for (const t of layout.tentacles) {
      const sc = STATUS_COLORS_CANVAS[t.node.status];
      const isSelected = t.id === selectedId;
      const isActive = t.node.status === "online";
      const radius = 22;
      const pulseAmt = isActive ? Math.sin(tick * 0.05 + t.x * 0.01) * 4 : 0;
      const glowR = radius + 10 + pulseAmt;

      // Glow
      if (isActive || t.node.status === "degraded") {
        const grd = ctx.createRadialGradient(t.x, t.y, radius * 0.5, t.x, t.y, glowR);
        grd.addColorStop(0, sc.glow);
        grd.addColorStop(1, "transparent");
        ctx.beginPath();
        ctx.arc(t.x, t.y, glowR, 0, Math.PI * 2);
        ctx.fillStyle = grd;
        ctx.fill();
      }

      // Selection ring
      if (isSelected) {
        ctx.beginPath();
        ctx.arc(t.x, t.y, radius + 5, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(99,102,241,0.7)";
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

      // Node fill
      ctx.beginPath();
      ctx.arc(t.x, t.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = sc.fill;
      ctx.fill();
      ctx.strokeStyle = isSelected ? "#818cf8" : sc.stroke;
      ctx.lineWidth = isSelected ? 1.5 : 1;
      ctx.stroke();

      // Icon
      ctx.font = "14px serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.globalAlpha = t.node.status === "dormant" ? 0.35 : 1;
      ctx.fillText(t.node.icon, t.x, t.y - 3);
      ctx.globalAlpha = 1;

      // Label
      ctx.font = "600 9px Inter, sans-serif";
      ctx.textAlign = "center";
      ctx.fillStyle = t.node.status === "dormant" ? "#4b5563" : "#d1d5db";
      ctx.fillText(t.node.platform, t.x, t.y + 30);

      // Message count badge
      if (t.node.messageCount > 0 && t.node.status !== "dormant") {
        const bx = t.x + 14;
        const by = t.y - 14;
        ctx.beginPath();
        ctx.arc(bx, by, 9, 0, Math.PI * 2);
        ctx.fillStyle = t.node.status === "online" ? "rgba(34,197,94,0.9)" : "rgba(245,158,11,0.9)";
        ctx.fill();
        ctx.font = "bold 7px Inter, sans-serif";
        ctx.fillStyle = "#000";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(t.node.messageCount > 99 ? "99+" : String(t.node.messageCount), bx, by);
      }
    }

    // Draw head model nodes (larger)
    for (const hp of layout.heads) {
      const isSelected = false; // heads not selectable in this pass
      const radius = 30;
      const pulse = Math.sin(tick * 0.04 + hp.x * 0.01) * 3;

      // Glow
      const grd = ctx.createRadialGradient(hp.x, hp.y, radius * 0.5, hp.x, hp.y, radius + 18 + pulse);
      grd.addColorStop(0, "rgba(99,102,241,0.3)");
      grd.addColorStop(1, "transparent");
      ctx.beginPath();
      ctx.arc(hp.x, hp.y, radius + 18 + pulse, 0, Math.PI * 2);
      ctx.fillStyle = grd;
      ctx.fill();

      // Node
      ctx.beginPath();
      ctx.arc(hp.x, hp.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(99,102,241,0.12)";
      ctx.fill();
      ctx.strokeStyle = isSelected ? "#818cf8" : "rgba(99,102,241,0.6)";
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.font = "bold 9px Inter, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "#818cf8";
      const label = hp.model.name.split(" ").slice(-2).join(" ");
      ctx.fillText(label, hp.x, hp.y);

      // Label below
      ctx.font = "600 8px Inter, sans-serif";
      ctx.fillStyle = "rgba(129,140,248,0.6)";
      ctx.fillText("HEAD", hp.x, hp.y + 38);
    }

    // Draw Big Agent center node
    const { x: cx, y: cy } = layout.center;
    const bigR = 40;
    const bigPulse = Math.sin(tick * 0.03) * 5;

    // Big glow
    const bigGrd = ctx.createRadialGradient(cx, cy, bigR * 0.3, cx, cy, bigR + 40 + bigPulse);
    bigGrd.addColorStop(0, "rgba(99,102,241,0.4)");
    bigGrd.addColorStop(0.5, "rgba(99,102,241,0.1)");
    bigGrd.addColorStop(1, "transparent");
    ctx.beginPath();
    ctx.arc(cx, cy, bigR + 40 + bigPulse, 0, Math.PI * 2);
    ctx.fillStyle = bigGrd;
    ctx.fill();

    // Ring
    ctx.beginPath();
    ctx.arc(cx, cy, bigR + 8, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(99,102,241,${0.2 + Math.sin(tick * 0.05) * 0.1})`;
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 4]);
    ctx.stroke();
    ctx.setLineDash([]);

    // Node fill
    ctx.beginPath();
    ctx.arc(cx, cy, bigR, 0, Math.PI * 2);
    const fillGrd = ctx.createRadialGradient(cx, cy, 0, cx, cy, bigR);
    fillGrd.addColorStop(0, "rgba(99,102,241,0.3)");
    fillGrd.addColorStop(1, "rgba(99,102,241,0.08)");
    ctx.fillStyle = fillGrd;
    ctx.fill();
    ctx.strokeStyle = "rgba(99,102,241,0.8)";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Label
    ctx.font = "bold 10px Inter, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#c7d2fe";
    ctx.fillText("BLADE", cx, cy - 5);
    ctx.font = "8px Inter, sans-serif";
    ctx.fillStyle = "rgba(165,180,252,0.6)";
    ctx.fillText("BIG AGENT", cx, cy + 7);

    frameRef.current = requestAnimationFrame(draw);
  }, [tentacles, heads, selectedId]);

  // Resize observer
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ro = new ResizeObserver(() => {
      canvas.width = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
      layoutRef.current = buildLayout(tentacles, heads, canvas.width, canvas.height);
    });
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [tentacles, heads]);

  // Start animation
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = canvas.offsetWidth || 400;
    canvas.height = canvas.offsetHeight || 400;
    layoutRef.current = buildLayout(tentacles, heads, canvas.width, canvas.height);
    frameRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frameRef.current);
  }, [draw]);

  // Click detection
  const handleCanvasClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || !layoutRef.current) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    for (const t of layoutRef.current.tentacles) {
      const dx = t.x - mx;
      const dy = t.y - my;
      if (Math.sqrt(dx * dx + dy * dy) < 26) {
        onSelect(t.id === selectedId ? null : t.id);
        return;
      }
    }
    onSelect(null);
  }, [selectedId, onSelect]);

  return (
    <canvas
      ref={canvasRef}
      className="w-full h-full cursor-pointer"
      onClick={handleCanvasClick}
    />
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

const PRIORITY_STYLES = {
  critical: {
    bg: "rgba(239,68,68,0.08)",
    border: "rgba(239,68,68,0.5)",
    badge: "rgba(239,68,68,0.2)",
    badgeText: "#fca5a5",
    text: "#ef4444",
  },
  high: {
    bg: "rgba(245,158,11,0.06)",
    border: "rgba(245,158,11,0.35)",
    badge: "rgba(245,158,11,0.2)",
    badgeText: "#fcd34d",
    text: "#f59e0b",
  },
  normal: {
    bg: "rgba(255,255,255,0.02)",
    border: "rgba(255,255,255,0.07)",
    badge: "rgba(99,102,241,0.15)",
    badgeText: "#a5b4fc",
    text: "#6366f1",
  },
  low: {
    bg: "rgba(255,255,255,0.01)",
    border: "rgba(255,255,255,0.04)",
    badge: "rgba(107,114,128,0.15)",
    badgeText: "#9ca3af",
    text: "#6b7280",
  },
};

function relTime(ts: number): string {
  const diff = Math.floor(Date.now() / 1000) - ts;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function ReportCard({
  report,
  onApprove,
  onReject,
}: {
  report: Report;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
}) {
  const ps = PRIORITY_STYLES[report.priority];
  const isDone = report.approved || report.rejected;

  return (
    <div
      className="rounded-lg p-3 mb-2 transition-all"
      style={{
        background: ps.bg,
        border: `1px solid ${ps.border}`,
        opacity: isDone ? 0.5 : 1,
      }}
    >
      <div className="flex items-start gap-2.5">
        <div className="text-base leading-none mt-0.5 shrink-0">{report.icon}</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span
              className="text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded"
              style={{ background: ps.badge, color: ps.badgeText }}
            >
              {report.priority}
            </span>
            <span className="text-[9px] text-gray-600">{report.platform}</span>
            <span className="text-[9px] text-gray-700">{relTime(report.timestamp)}</span>
          </div>
          <p className="text-[11px] text-gray-300 leading-relaxed">{report.summary}</p>
          {report.needsApproval && !isDone && (
            <div className="flex gap-1.5 mt-2">
              <button
                onClick={() => onApprove(report.id)}
                className="px-2.5 py-1 rounded text-[10px] font-semibold transition-all"
                style={{ background: "rgba(34,197,94,0.15)", border: "1px solid rgba(34,197,94,0.35)", color: "#4ade80" }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(34,197,94,0.25)"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(34,197,94,0.15)"; }}
              >
                Approve
              </button>
              <button
                onClick={() => onReject(report.id)}
                className="px-2.5 py-1 rounded text-[10px] font-semibold transition-all"
                style={{ background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.3)", color: "#f87171" }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(239,68,68,0.22)"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(239,68,68,0.12)"; }}
              >
                Reject
              </button>
            </div>
          )}
          {report.approved && (
            <span className="text-[10px] text-green-400 mt-1 inline-block">Approved</span>
          )}
          {report.rejected && (
            <span className="text-[10px] text-red-400 mt-1 inline-block">Rejected</span>
          )}
        </div>
      </div>
    </div>
  );
}

function DecisionCard({
  decision,
  onApprove,
  onEdit,
  onReject,
}: {
  decision: PendingDecision;
  onApprove: (id: string) => void;
  onEdit: (id: string) => void;
  onReject: (id: string) => void;
}) {
  const confidenceColor =
    decision.confidence >= 85 ? "#4ade80"
    : decision.confidence >= 60 ? "#fbbf24"
    : "#f87171";

  const isPending = decision.status === "pending";
  const isExecuting = decision.status === "executing";

  return (
    <div
      className="rounded-lg p-3 mb-2"
      style={{
        background: "rgba(99,102,241,0.05)",
        border: `1px solid ${
          decision.status === "approved" ? "rgba(34,197,94,0.4)"
          : decision.status === "rejected" ? "rgba(239,68,68,0.3)"
          : "rgba(99,102,241,0.2)"
        }`,
      }}
    >
      {/* Header */}
      <div className="flex items-center gap-2 mb-2">
        <span className="text-sm leading-none">{decision.icon}</span>
        <span className="text-[10px] text-gray-500">{decision.platform}</span>
        <div className="ml-auto flex items-center gap-1">
          <span className="text-[9px] text-gray-600">confidence</span>
          <span className="text-[10px] font-bold font-mono" style={{ color: confidenceColor }}>
            {decision.confidence}%
          </span>
        </div>
      </div>

      {/* Confidence bar */}
      <div className="h-0.5 rounded-full mb-2" style={{ background: "rgba(255,255,255,0.06)" }}>
        <div
          className="h-full rounded-full transition-all"
          style={{
            width: `${decision.confidence}%`,
            background: `linear-gradient(90deg, ${confidenceColor}88, ${confidenceColor})`,
          }}
        />
      </div>

      {/* What */}
      <p className="text-[11px] text-white font-medium mb-1 leading-snug">{decision.what}</p>

      {/* Why */}
      <p className="text-[10px] text-gray-500 mb-2.5 leading-relaxed">{decision.why}</p>

      {/* Status / Actions */}
      {decision.status === "executing" && (
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse" />
          <span className="text-[10px] text-indigo-400">Executing…</span>
        </div>
      )}
      {decision.status === "done" && (
        <div className="flex items-center gap-1.5">
          <div className="w-1.5 h-1.5 rounded-full bg-green-400" />
          <span className="text-[10px] text-green-400">Done</span>
        </div>
      )}
      {decision.status === "approved" && !isExecuting && (
        <span className="text-[10px] text-green-400">Approved — queued</span>
      )}
      {decision.status === "rejected" && (
        <span className="text-[10px] text-red-400">Rejected</span>
      )}

      {isPending && (
        <div className="flex gap-1.5">
          <button
            onClick={() => onApprove(decision.id)}
            className="flex-1 py-1.5 rounded text-[10px] font-semibold transition-all"
            style={{ background: "rgba(34,197,94,0.15)", border: "1px solid rgba(34,197,94,0.35)", color: "#4ade80" }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(34,197,94,0.25)"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(34,197,94,0.15)"; }}
          >
            Approve
          </button>
          <button
            onClick={() => onEdit(decision.id)}
            className="flex-1 py-1.5 rounded text-[10px] font-semibold transition-all"
            style={{ background: "rgba(245,158,11,0.12)", border: "1px solid rgba(245,158,11,0.3)", color: "#fbbf24" }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(245,158,11,0.22)"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(245,158,11,0.12)"; }}
          >
            Edit
          </button>
          <button
            onClick={() => onReject(decision.id)}
            className="flex-1 py-1.5 rounded text-[10px] font-semibold transition-all"
            style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.25)", color: "#f87171" }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(239,68,68,0.2)"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(239,68,68,0.1)"; }}
          >
            Reject
          </button>
        </div>
      )}
    </div>
  );
}

// ── Main view ─────────────────────────────────────────────────────────────────

export function HiveView({ onBack }: HiveViewProps) {
  const [tentacles, setTentacles] = useState<TentacleNode[]>(SEED_TENTACLES);
  const [heads] = useState<HeadModel[]>(SEED_HEAD_MODELS);
  const [reports, setReports] = useState<Report[]>(SEED_REPORTS);
  const [decisions, setDecisions] = useState<PendingDecision[]>(SEED_DECISIONS);
  const [autonomy, setAutonomy] = useState(42);
  const [paused, setPaused] = useState(false);
  const [selectedTentacleId, setSelectedTentacleId] = useState<string | null>(null);
  const [feedPaused, setFeedPaused] = useState(false);
  const feedRef = useRef<HTMLDivElement>(null);

  const stats: HiveStats = {
    msgsToday: tentacles.reduce((s, t) => s + t.messageCount, 0),
    actionsToday: tentacles.reduce((s, t) => s + t.actionsToday, 0),
    autoDecisions: decisions.filter((d) => d.status !== "pending").length + 14,
    manualDecisions: decisions.filter((d) => d.status === "approved" || d.status === "rejected").length + 3,
    avgResponseMs: 340,
  };

  const onlineCount = tentacles.filter((t) => t.status === "online").length;
  const totalCount = tentacles.length;

  const hiveStatusColor =
    paused ? "#6b7280"
    : onlineCount === totalCount ? "#22c55e"
    : onlineCount >= totalCount * 0.7 ? "#f59e0b"
    : "#ef4444";

  const hiveStatusLabel =
    paused ? "PAUSED"
    : onlineCount === totalCount ? "HIVE ACTIVE"
    : onlineCount >= totalCount * 0.7 ? "HIVE DEGRADED"
    : "HIVE CRITICAL";

  // Auto-scroll feed unless hovered
  useEffect(() => {
    if (feedPaused) return;
    const el = feedRef.current;
    if (!el) return;
    const interval = setInterval(() => {
      el.scrollTop += 1;
    }, 80);
    return () => clearInterval(interval);
  }, [feedPaused]);

  const selectedTentacle = tentacles.find((t) => t.id === selectedTentacleId) ?? null;

  const handleReportApprove = (id: string) =>
    setReports((prev) => prev.map((r) => r.id === id ? { ...r, approved: true, needsApproval: false } : r));

  const handleReportReject = (id: string) =>
    setReports((prev) => prev.map((r) => r.id === id ? { ...r, rejected: true, needsApproval: false } : r));

  const handleDecisionApprove = (id: string) =>
    setDecisions((prev) => prev.map((d) =>
      d.id === id ? { ...d, status: "executing" as const } : d
    ));

  const handleDecisionEdit = (id: string) => {
    const d = decisions.find((x) => x.id === id);
    if (!d) return;
    const next = prompt("Edit decision:", d.what);
    if (next !== null && next.trim()) {
      setDecisions((prev) => prev.map((x) => x.id === id ? { ...x, what: next.trim(), status: "pending" as const } : x));
    }
  };

  const handleDecisionReject = (id: string) =>
    setDecisions((prev) => prev.map((d) =>
      d.id === id ? { ...d, status: "rejected" as const } : d
    ));

  const handleTentacleUpdate = (id: string, patch: Partial<TentacleNode>) =>
    setTentacles((prev) => prev.map((t) => t.id === id ? { ...t, ...patch } : t));

  const handleReconnect = (id: string) =>
    setTentacles((prev) => prev.map((t) => t.id === id ? { ...t, status: "online", uptime: 0 } : t));

  // Simulate executing → done
  useEffect(() => {
    const timer = setInterval(() => {
      setDecisions((prev) => prev.map((d) =>
        d.status === "executing" ? { ...d, status: "done" as const } : d
      ));
    }, 3000);
    return () => clearInterval(timer);
  }, []);

  const pendingCount = decisions.filter((d) => d.status === "pending").length;

  return (
    <div className="flex flex-col h-full bg-[#08080a] text-gray-200 overflow-hidden select-none">
      {/* ── Top strip ─────────────────────────────────────────────────────────── */}
      <div
        className="flex items-center gap-4 px-4 py-2.5 shrink-0"
        style={{
          background: "linear-gradient(180deg, #0e0e14 0%, #0a0a0f 100%)",
          borderBottom: "1px solid rgba(99,102,241,0.15)",
          boxShadow: "0 2px 20px rgba(0,0,0,0.5)",
        }}
      >
        {/* Back */}
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-gray-600 hover:text-gray-300 transition-colors text-[11px] shrink-0"
        >
          <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="currentColor">
            <path d="M3.828 8l4.95 4.95-1.414 1.414L1 8l6.364-6.364L8.778 3.05 3.828 8z" />
          </svg>
          Back
        </button>

        {/* Status indicator */}
        <div className="flex items-center gap-2 shrink-0">
          <div
            className="w-2.5 h-2.5 rounded-full"
            style={{
              background: hiveStatusColor,
              boxShadow: `0 0 8px ${hiveStatusColor}, 0 0 20px ${hiveStatusColor}55`,
              animation: paused ? "none" : "pulse 2s ease-in-out infinite",
            }}
          />
          <span className="text-[11px] font-bold tracking-widest uppercase" style={{ color: hiveStatusColor }}>
            {hiveStatusLabel}
          </span>
          <span className="text-[10px] text-gray-600">
            — {onlineCount}/{totalCount} tentacles online
          </span>
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Autonomy slider */}
        <div className="flex items-center gap-2.5 shrink-0">
          <span className="text-[10px] text-gray-600 uppercase tracking-wider">Autonomy</span>
          <input
            type="range"
            min={0}
            max={100}
            value={autonomy}
            onChange={(e) => setAutonomy(Number(e.target.value))}
            className="w-28 accent-indigo-500"
          />
          <span
            className="text-[11px] font-bold font-mono w-8 text-right"
            style={{
              color: autonomy >= 80 ? "#ef4444" : autonomy >= 50 ? "#f59e0b" : "#4ade80",
            }}
          >
            {autonomy}%
          </span>
        </div>

        {/* Kill switch */}
        <button
          onClick={() => setPaused((p) => !p)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-semibold transition-all shrink-0"
          style={{
            background: paused ? "rgba(34,197,94,0.15)" : "rgba(239,68,68,0.15)",
            border: paused ? "1px solid rgba(34,197,94,0.4)" : "1px solid rgba(239,68,68,0.4)",
            color: paused ? "#4ade80" : "#f87171",
          }}
        >
          <div
            className="w-1.5 h-1.5 rounded-full"
            style={{ background: paused ? "#4ade80" : "#f87171" }}
          />
          {paused ? "Resume tentacles" : "Pause all tentacles"}
        </button>
      </div>

      {/* ── Main body ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* Left panel — Tentacle Map */}
        <div
          className="w-[340px] shrink-0 flex flex-col overflow-hidden"
          style={{ borderRight: "1px solid rgba(99,102,241,0.12)" }}
        >
          <div
            className="px-3 py-2 shrink-0 flex items-center justify-between"
            style={{ borderBottom: "1px solid rgba(99,102,241,0.08)" }}
          >
            <span className="text-[9px] uppercase tracking-[0.2em] text-gray-600 font-bold">Tentacle Map</span>
            <span className="text-[9px] text-gray-700">{onlineCount} active</span>
          </div>
          <div className="flex-1 min-h-0">
            <NetworkCanvas
              tentacles={tentacles}
              heads={heads}
              selectedId={selectedTentacleId}
              onSelect={setSelectedTentacleId}
            />
          </div>
          {/* Selected tentacle quick info */}
          {selectedTentacle && (
            <div
              className="shrink-0 px-3 py-2"
              style={{
                borderTop: "1px solid rgba(99,102,241,0.12)",
                background: "rgba(99,102,241,0.04)",
              }}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-sm">{selectedTentacle.icon}</span>
                  <span className="text-[11px] font-medium text-gray-300">{selectedTentacle.platform}</span>
                </div>
                <button
                  onClick={() => setSelectedTentacleId(selectedTentacle.id)}
                  className="text-[9px] text-indigo-400 hover:text-indigo-300 transition-colors"
                >
                  Details →
                </button>
              </div>
              <div className="flex gap-3 mt-1">
                <span className="text-[9px] text-gray-600">{selectedTentacle.messageCount} msgs</span>
                <span className="text-[9px] text-gray-600">{selectedTentacle.actionsToday} actions</span>
              </div>
            </div>
          )}
        </div>

        {/* Center panel — Live Feed */}
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
          <div
            className="px-3 py-2 shrink-0 flex items-center justify-between"
            style={{ borderBottom: "1px solid rgba(99,102,241,0.08)" }}
          >
            <div className="flex items-center gap-2">
              <span className="text-[9px] uppercase tracking-[0.2em] text-gray-600 font-bold">Live Feed</span>
              <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
            </div>
            <span className="text-[9px] text-gray-700">{feedPaused ? "paused" : "auto-scroll"}</span>
          </div>

          {/* Critical reports banner */}
          {reports.filter((r) => r.priority === "critical" && !r.approved && !r.rejected).length > 0 && (
            <div
              className="px-3 py-2 shrink-0"
              style={{
                background: "rgba(239,68,68,0.06)",
                borderBottom: "1px solid rgba(239,68,68,0.25)",
              }}
            >
              <span className="text-[9px] uppercase tracking-widest font-bold text-red-400">Critical</span>
            </div>
          )}

          <div
            ref={feedRef}
            className="flex-1 min-h-0 overflow-y-auto px-3 py-2"
            onMouseEnter={() => setFeedPaused(true)}
            onMouseLeave={() => setFeedPaused(false)}
          >
            {/* Critical reports first */}
            {reports
              .filter((r) => r.priority === "critical")
              .map((r) => (
                <ReportCard key={r.id} report={r} onApprove={handleReportApprove} onReject={handleReportReject} />
              ))}
            {/* Rest sorted by timestamp desc */}
            {reports
              .filter((r) => r.priority !== "critical")
              .sort((a, b) => b.timestamp - a.timestamp)
              .map((r) => (
                <ReportCard key={r.id} report={r} onApprove={handleReportApprove} onReject={handleReportReject} />
              ))}
          </div>
        </div>

        {/* Right panel — Pending Decisions */}
        <div
          className="w-[300px] shrink-0 flex flex-col overflow-hidden"
          style={{ borderLeft: "1px solid rgba(99,102,241,0.12)" }}
        >
          <div
            className="px-3 py-2 shrink-0 flex items-center justify-between"
            style={{ borderBottom: "1px solid rgba(99,102,241,0.08)" }}
          >
            <span className="text-[9px] uppercase tracking-[0.2em] text-gray-600 font-bold">Pending Decisions</span>
            {pendingCount > 0 && (
              <span
                className="text-[9px] font-bold px-1.5 py-0.5 rounded-full"
                style={{ background: "rgba(99,102,241,0.2)", color: "#818cf8" }}
              >
                {pendingCount}
              </span>
            )}
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto px-3 py-2">
            {decisions.length === 0 ? (
              <p className="text-[11px] text-gray-700 text-center py-8">No pending decisions</p>
            ) : (
              decisions.map((d) => (
                <DecisionCard
                  key={d.id}
                  decision={d}
                  onApprove={handleDecisionApprove}
                  onEdit={handleDecisionEdit}
                  onReject={handleDecisionReject}
                />
              ))
            )}
          </div>
        </div>
      </div>

      {/* ── Bottom stats strip ─────────────────────────────────────────────────── */}
      <div
        className="flex items-center gap-6 px-4 py-2 shrink-0"
        style={{
          background: "linear-gradient(180deg, #0a0a0f 0%, #0e0e14 100%)",
          borderTop: "1px solid rgba(99,102,241,0.1)",
        }}
      >
        {[
          { label: "Messages today", value: stats.msgsToday.toLocaleString() },
          { label: "Actions today", value: stats.actionsToday.toLocaleString() },
          { label: "Auto decisions", value: stats.autoDecisions.toString() },
          { label: "Manual decisions", value: stats.manualDecisions.toString() },
          { label: "Avg response", value: `${stats.avgResponseMs}ms` },
        ].map((s) => (
          <div key={s.label} className="flex items-center gap-2">
            <span className="text-[9px] uppercase tracking-wider text-gray-700">{s.label}</span>
            <span className="text-[11px] font-semibold font-mono text-gray-300">{s.value}</span>
          </div>
        ))}
        <div className="ml-auto text-[9px] text-gray-800 font-mono">
          HIVE v0.1 — {new Date().toLocaleTimeString()}
        </div>
      </div>

      {/* Tentacle detail slide-out */}
      {selectedTentacle && (
        <TentacleDetail
          tentacle={selectedTentacle}
          onClose={() => setSelectedTentacleId(null)}
          onUpdate={handleTentacleUpdate}
          onReconnect={handleReconnect}
        />
      )}
    </div>
  );
}
