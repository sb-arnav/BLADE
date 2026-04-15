// src/components/HiveView.tsx
// BLADE Hive Control Center — 4 domain heads, 10 tentacles, Big Agent cross-domain insights.

import { useState, useEffect, useRef, useCallback } from "react";
import { TentacleDetail, TentacleNode } from "./TentacleDetail";

// ── Types ─────────────────────────────────────────────────────────────────────

type HeadDomain = "communications" | "development" | "operations" | "intelligence";

interface HeadModel {
  id: string;
  name: string;
  domain: HeadDomain;
  label: string; // short display label
  tentacleIds: string[];
  recentDecisions: Array<{ text: string; approved: boolean; ts: number }>;
  approvalRate: number; // 0-100
  pendingReports: number;
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
  confidence: number;
  tentacleId: string;
  platform: string;
  icon: string;
  status: "pending" | "approved" | "rejected" | "executing" | "done";
}

interface CrossDomainInsight {
  id: string;
  timestamp: number;
  domains: HeadDomain[];
  summary: string;
  highlight: string; // the "wow" part
}

interface AutoFixCard {
  id: string;
  repo: string;
  issue: string;
  status: "running" | "done" | "failed";
  progress: number; // 0-100
  startedAt: number;
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

// ── Platform icon map ──────────────────────────────────────────────────────────

// SVG icon paths for recognised platforms
function PlatformIcon({ platform, size = 14 }: { platform: string; size?: number }) {
  const s = size;
  const h = s / 2;

  switch (platform.toLowerCase()) {
    case "slack":
      // Hash / pound
      return (
        <svg width={s} height={s} viewBox="0 0 16 16" fill="currentColor">
          <path d="M6 2v4H2v2h4v4h2v-4h4V6h-4V2H6z" />
        </svg>
      );
    case "discord":
      // Game controller / headset shape
      return (
        <svg width={s} height={s} viewBox="0 0 16 16" fill="currentColor">
          <path d="M13.5 3.5A11 11 0 0 0 8 2a11 11 0 0 0-5.5 1.5C1.3 5.4.5 7.2.5 9c0 1.4.4 2.7 1.1 3.7.3.4.7.8 1.1 1 .4.2.8.3 1.3.3.5 0 1-.2 1.4-.5L6 13v.5c.5.3 1.3.5 2 .5s1.5-.2 2-.5V13l.6.5c.4.3.9.5 1.4.5.5 0 .9-.1 1.3-.3.4-.2.8-.6 1.1-1 .7-1 1.1-2.3 1.1-3.7 0-1.8-.8-3.6-2-5zm-9 5.5a1 1 0 1 1 0-2 1 1 0 0 1 0 2zm7 0a1 1 0 1 1 0-2 1 1 0 0 1 0 2z" />
        </svg>
      );
    case "whatsapp":
      // Phone with wave
      return (
        <svg width={s} height={s} viewBox="0 0 16 16" fill="currentColor">
          <path d="M11 10c-.5 0-1 .2-1.4.5l-1.3-.5C8.8 9.4 9 8.7 9 8s-.2-1.4-.7-2l1.3-.5c.4.3.9.5 1.4.5 1.1 0 2-.9 2-2s-.9-2-2-2c-.8 0-1.5.5-1.8 1.2L7.8 3.8C7.3 3.3 6.7 3 6 3a3 3 0 0 0 0 6c.7 0 1.3-.3 1.8-.8l1.4.6C9 9.5 9 9.7 9 10a2 2 0 0 0 4 0c0-1.1-.9-2-2-2z" />
        </svg>
      );
    case "email":
    case "gmail":
      // Envelope
      return (
        <svg width={s} height={s} viewBox="0 0 16 16" fill="currentColor">
          <path d="M1 3h14v10H1V3zm1.5 1.5L8 9l5.5-4.5M2 13l4-4m8 4-4-4" stroke="currentColor" strokeWidth="1" fill="none"/>
          <path d="M2 4.5 8 9l6-4.5" stroke="currentColor" strokeWidth="1.2" fill="none"/>
        </svg>
      );
    case "linkedin":
      // in box
      return (
        <svg width={s} height={s} viewBox="0 0 16 16" fill="currentColor">
          <path d="M2 2h3v3H2V2zm0 4h3v8H2V6zm4 0h3v1.1C9.6 6.4 10.3 6 11 6c2 0 3 1.3 3 3.5V14h-3v-4c0-.8-.3-1.5-1-1.5s-1 .7-1 1.5v4H6V6z" />
        </svg>
      );
    case "twitter":
      // Bird / X shape
      return (
        <svg width={s} height={s} viewBox="0 0 16 16" fill="currentColor">
          <path d="M2 2 8 9.5 2 14h1.5l4.9-5.7L13 14h3L9.5 6l5.7-4H14l-4.5 5.3L3 2H2z" />
        </svg>
      );
    case "github":
      // Code branch
      return (
        <svg width={s} height={s} viewBox="0 0 16 16" fill="currentColor">
          <path d="M4 2a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zm0 5C2.9 7 2 6.1 2 5s.9-2 2-2 2 .9 2 2a2 2 0 0 1-1 1.73V11a2 2 0 0 1-1 1.73V13h-2v-.27A2 2 0 0 1 1 11V8c0-1.1.9-2 2-2h6a2 2 0 0 0 2-2V3.27A2 2 0 0 1 12 1.5a1.5 1.5 0 1 1 0 3A2 2 0 0 1 10 6H6a2 2 0 0 0-2 2" />
        </svg>
      );
    case "ci":
      // Gear / cog
      return (
        <svg width={s} height={s} viewBox="0 0 16 16" fill="currentColor">
          <path d="M8 5a3 3 0 1 0 0 6A3 3 0 0 0 8 5zm6.8 1.6-1.5-.4-.9-1.6.7-1.4-1.3-1.3-1.4.7-1.6-.9-.4-1.5h-1.8l-.4 1.5-1.6.9-1.4-.7-1.3 1.3.7 1.4-.9 1.6-1.5.4v1.8l1.5.4.9 1.6-.7 1.4 1.3 1.3 1.4-.7 1.6.9.4 1.5h1.8l.4-1.5 1.6-.9 1.4.7 1.3-1.3-.7-1.4.9-1.6 1.5-.4V6.6z" />
        </svg>
      );
    case "terminal":
      // Chevron-right prompt
      return (
        <svg width={s} height={s} viewBox="0 0 16 16" fill="currentColor">
          <path d="M2 4h12v8H2V4zm2 2 3 2-3 2m4 0h4" stroke="currentColor" strokeWidth="1.3" fill="none" strokeLinecap="round"/>
        </svg>
      );
    case "linear":
    case "jira":
      // Ticket / checklist
      return (
        <svg width={s} height={s} viewBox="0 0 16 16" fill="currentColor">
          <path d="M3 3h10v10H3V3zm2 2v2h6V5H5zm0 4v2h4V9H5z" />
        </svg>
      );
    case "logs":
      // File with lines
      return (
        <svg width={s} height={s} viewBox="0 0 16 16" fill="currentColor">
          <path d="M3 2h7l3 3v9H3V2zm7 0v3h3M5 8h6M5 10h4M5 6h3" stroke="currentColor" strokeWidth="1" fill="none"/>
        </svg>
      );
    case "cloud":
    case "cloud costs":
      // Cloud shape
      return (
        <svg width={s} height={s} viewBox="0 0 16 16" fill="currentColor">
          <path d="M12 11a3 3 0 0 0 0-6 3 3 0 0 0-5.8-1A3 3 0 0 0 4 11h8z" />
        </svg>
      );
    case "backend":
      // Server stack
      return (
        <svg width={s} height={s} viewBox="0 0 16 16" fill="currentColor">
          <rect x="2" y="2" width="12" height="3" rx="1"/>
          <rect x="2" y="6.5" width="12" height="3" rx="1"/>
          <rect x="2" y="11" width="12" height="3" rx="1"/>
        </svg>
      );
    case "filesystem":
      // Folder
      return (
        <svg width={s} height={s} viewBox="0 0 16 16" fill="currentColor">
          <path d="M2 4h4l2 2h6v7H2V4z" />
        </svg>
      );
    default:
      // Generic node
      return (
        <svg width={s} height={s} viewBox="0 0 16 16" fill="currentColor">
          <circle cx={h} cy={h} r={h - 1} />
        </svg>
      );
  }
}

// ── Seed data ─────────────────────────────────────────────────────────────────

const now = () => Math.floor(Date.now() / 1000);

const SEED_TENTACLES: TentacleNode[] = [
  // Communications domain
  {
    id: "t-slack", platform: "Slack", icon: "#",
    status: "online", uptime: 72000, messageCount: 134, actionsToday: 28,
    messagesProcessed: 2841, lastPollTime: now() - 8,
    headModel: "openrouter/anthropic/claude-3.5-sonnet",
    notificationsEnabled: true, lastSeen: now() - 8,
    recentMessages: [
      { id: "m1", summary: "#engineering: prod deploy blocked — pipeline red", priority: "critical", timestamp: now() - 15 },
      { id: "m2", summary: "@arnav mentioned in #general: great demo!", priority: "low", timestamp: now() - 1800 },
    ],
    recentActions: [
      { id: "a1", action: "Summarised 47-message thread in #engineering", status: "done", timestamp: now() - 600 },
      { id: "a2", action: "Drafted response to prod-blocking question", status: "pending", timestamp: now() - 14 },
    ],
  },
  {
    id: "t-discord", platform: "Discord", icon: "🎮",
    status: "online", uptime: 48000, messageCount: 22, actionsToday: 5,
    messagesProcessed: 940, lastPollTime: now() - 62,
    headModel: "openrouter/anthropic/claude-3.5-sonnet",
    notificationsEnabled: true, lastSeen: now() - 62,
    recentMessages: [
      { id: "m3", summary: "#announcements: v0.4.6 release discussion", priority: "normal", timestamp: now() - 200 },
    ],
    recentActions: [
      { id: "a3", action: "Pinged release notes to #changelog", status: "done", timestamp: now() - 180 },
    ],
  },
  {
    id: "t-whatsapp", platform: "WhatsApp", icon: "📱",
    status: "online", uptime: 83400, messageCount: 18, actionsToday: 4,
    messagesProcessed: 1205, lastPollTime: now() - 30,
    headModel: "openrouter/anthropic/claude-3.5-sonnet",
    notificationsEnabled: true, lastSeen: now() - 30,
    recentMessages: [
      { id: "m4", summary: "Mom: are you free Sunday for dinner?", priority: "normal", timestamp: now() - 1200 },
    ],
    recentActions: [
      { id: "a4", action: "Drafted reply: 'Yes, around 7pm works!'", status: "pending", timestamp: now() - 1100 },
    ],
  },
  {
    id: "t-email", platform: "Email", icon: "✉",
    status: "online", uptime: 91200, messageCount: 47, actionsToday: 12,
    messagesProcessed: 4230, lastPollTime: now() - 45,
    headModel: "openrouter/anthropic/claude-3.5-sonnet",
    notificationsEnabled: true, lastSeen: now() - 45,
    recentMessages: [
      { id: "m5", summary: "Invoice from AWS — $312.40 due Friday", priority: "high", timestamp: now() - 120 },
      { id: "m6", summary: "Meeting request from Sarah re: Q2 planning", priority: "normal", timestamp: now() - 900 },
    ],
    recentActions: [
      { id: "a5", action: "Drafted reply to Sarah confirming Thursday 2pm", status: "done", timestamp: now() - 880 },
    ],
  },
  {
    id: "t-linkedin", platform: "LinkedIn", icon: "in",
    status: "dormant", uptime: 0, messageCount: 3, actionsToday: 0,
    messagesProcessed: 87, lastPollTime: now() - 7200,
    headModel: "openrouter/anthropic/claude-3.5-sonnet",
    notificationsEnabled: false, lastSeen: now() - 7200,
    recentMessages: [],
    recentActions: [],
  },
  {
    id: "t-twitter", platform: "Twitter", icon: "𝕏",
    status: "offline", uptime: 0, messageCount: 0, actionsToday: 0,
    messagesProcessed: 0, lastPollTime: now() - 86400,
    headModel: "openrouter/anthropic/claude-3.5-sonnet",
    notificationsEnabled: false, lastSeen: now() - 86400,
    recentMessages: [],
    recentActions: [],
  },

  // Development domain
  {
    id: "t-github", platform: "GitHub", icon: "⎇",
    status: "online", uptime: 91200, messageCount: 23, actionsToday: 7,
    messagesProcessed: 1840, lastPollTime: now() - 320,
    headModel: "openrouter/google/gemini-pro-1.5",
    notificationsEnabled: true, lastSeen: now() - 320,
    recentMessages: [
      { id: "m7", summary: "PR #287 review requested — 'feat: hive control center'", priority: "high", timestamp: now() - 320 },
    ],
    recentActions: [
      { id: "a6", action: "Posted code review comment on PR #281", status: "done", timestamp: now() - 7200 },
    ],
  },
  {
    id: "t-ci", platform: "CI", icon: "⚙",
    status: "degraded", uptime: 14400, messageCount: 11, actionsToday: 4,
    messagesProcessed: 320, lastPollTime: now() - 90,
    headModel: "openrouter/google/gemini-pro-1.5",
    notificationsEnabled: true, lastSeen: now() - 90,
    recentMessages: [
      { id: "m8", summary: "Build #442 FAILED: test suite 'hive_view.spec.ts' timeout", priority: "critical", timestamp: now() - 90 },
    ],
    recentActions: [
      { id: "a7", action: "Filed auto-fix task for failing test suite", status: "pending", timestamp: now() - 85 },
    ],
  },
  {
    id: "t-terminal", platform: "Terminal", icon: ">",
    status: "online", uptime: 91200, messageCount: 61, actionsToday: 19,
    messagesProcessed: 3102, lastPollTime: now() - 3,
    headModel: "openrouter/google/gemini-pro-1.5",
    notificationsEnabled: true, lastSeen: now() - 3,
    recentMessages: [
      { id: "m9", summary: "/src/App.tsx modified — 847 lines changed", priority: "normal", timestamp: now() - 3 },
    ],
    recentActions: [
      { id: "a8", action: "Notified dev loop about large file change", status: "done", timestamp: now() - 3 },
    ],
  },
  {
    id: "t-linear", platform: "Linear", icon: "▲",
    status: "online", uptime: 64800, messageCount: 9, actionsToday: 3,
    messagesProcessed: 410, lastPollTime: now() - 480,
    headModel: "openrouter/google/gemini-pro-1.5",
    notificationsEnabled: true, lastSeen: now() - 480,
    recentMessages: [
      { id: "m10", summary: "Issue BLA-142 moved to In Progress by Arnav", priority: "normal", timestamp: now() - 500 },
    ],
    recentActions: [
      { id: "a9", action: "Linked CI failure to BLA-138 ticket", status: "done", timestamp: now() - 80 },
    ],
  },

  // Operations domain
  {
    id: "t-logs", platform: "Logs", icon: "📄",
    status: "online", uptime: 91200, messageCount: 88, actionsToday: 14,
    messagesProcessed: 12840, lastPollTime: now() - 2,
    headModel: "openrouter/anthropic/claude-3-haiku",
    notificationsEnabled: true, lastSeen: now() - 2,
    recentMessages: [
      { id: "m11", summary: "5 ERR_CONNECTION_RESET in /api/v2/stream last 60s", priority: "high", timestamp: now() - 5 },
    ],
    recentActions: [
      { id: "a10", action: "Correlated log spike with deploy BLA-v0.4.5", status: "done", timestamp: now() - 400 },
    ],
  },
  {
    id: "t-cloud", platform: "Cloud", icon: "☁",
    status: "online", uptime: 72000, messageCount: 6, actionsToday: 1,
    messagesProcessed: 250, lastPollTime: now() - 900,
    headModel: "openrouter/anthropic/claude-3-haiku",
    notificationsEnabled: true, lastSeen: now() - 900,
    recentMessages: [
      { id: "m12", summary: "AWS spend: $312.40 this cycle, $28 above last month", priority: "normal", timestamp: now() - 1800 },
    ],
    recentActions: [],
  },
  {
    id: "t-backend", platform: "Backend", icon: "⬡",
    status: "online", uptime: 86400, messageCount: 41, actionsToday: 8,
    messagesProcessed: 7200, lastPollTime: now() - 10,
    headModel: "openrouter/anthropic/claude-3-haiku",
    notificationsEnabled: true, lastSeen: now() - 10,
    recentMessages: [
      { id: "m13", summary: "P99 latency spiked to 480ms on /api/v2/stream", priority: "high", timestamp: now() - 15 },
    ],
    recentActions: [
      { id: "a11", action: "Correlated latency spike with CI deploy artifact", status: "done", timestamp: now() - 80 },
    ],
  },
  {
    id: "t-filesystem", platform: "Filesystem", icon: "📁",
    status: "online", uptime: 91200, messageCount: 74, actionsToday: 22,
    messagesProcessed: 9800, lastPollTime: now() - 1,
    headModel: "openrouter/anthropic/claude-3-haiku",
    notificationsEnabled: true, lastSeen: now() - 1,
    recentMessages: [
      { id: "m14", summary: "/src/components/HiveView.tsx modified (14 674 tokens)", priority: "normal", timestamp: now() - 1 },
    ],
    recentActions: [
      { id: "a12", action: "Indexed new file snapshot for memory recall", status: "done", timestamp: now() - 1 },
    ],
  },
];

// 4 domain head models
const SEED_HEAD_MODELS: HeadModel[] = [
  {
    id: "h-comms", name: "Communications Head", domain: "communications", label: "COMMS",
    tentacleIds: ["t-slack", "t-discord", "t-whatsapp", "t-email", "t-linkedin", "t-twitter"],
    recentDecisions: [
      { text: "Reply to Sarah — confirmed Thu 2pm", approved: true, ts: now() - 880 },
      { text: "Summarise #engineering thread", approved: true, ts: now() - 600 },
      { text: "Forward LinkedIn recruiter to spam", approved: false, ts: now() - 7000 },
    ],
    approvalRate: 87,
    pendingReports: 3,
  },
  {
    id: "h-dev", name: "Development Head", domain: "development", label: "DEV",
    tentacleIds: ["t-github", "t-ci", "t-terminal", "t-linear"],
    recentDecisions: [
      { text: "Post CI failure to #engineering on Slack", approved: true, ts: now() - 85 },
      { text: "Review PR #287 diff automatically", approved: true, ts: now() - 320 },
      { text: "Auto-merge dependabot PR", approved: false, ts: now() - 3600 },
    ],
    approvalRate: 71,
    pendingReports: 2,
  },
  {
    id: "h-ops", name: "Operations Head", domain: "operations", label: "OPS",
    tentacleIds: ["t-logs", "t-cloud", "t-backend", "t-filesystem"],
    recentDecisions: [
      { text: "Correlate log spike with deploy BLA-v0.4.5", approved: true, ts: now() - 400 },
      { text: "Alert on P99 latency > 300ms threshold", approved: true, ts: now() - 15 },
      { text: "Rotate cloud credentials automatically", approved: false, ts: now() - 14400 },
    ],
    approvalRate: 78,
    pendingReports: 4,
  },
  {
    id: "h-intel", name: "Intelligence Head", domain: "intelligence", label: "INTEL",
    tentacleIds: [], // connects to all other heads, not individual tentacles
    recentDecisions: [
      { text: "Synthesise CI + Slack + Backend signals → incident brief", approved: true, ts: now() - 60 },
      { text: "Predict meeting conflict from calendar + email patterns", approved: true, ts: now() - 3600 },
    ],
    approvalRate: 95,
    pendingReports: 1,
  },
];

const SEED_REPORTS: Report[] = [
  {
    id: "r1", tentacleId: "t-slack", platform: "Slack", icon: "#",
    timestamp: now() - 15, priority: "critical",
    summary: "Production deploy blocked — pipeline failure in #engineering. 4 engineers waiting.",
    needsApproval: true,
  },
  {
    id: "r2", tentacleId: "t-ci", platform: "CI", icon: "⚙",
    timestamp: now() - 90, priority: "critical",
    summary: "Build #442 FAILED: hive_view.spec.ts test timeout. Auto-fix card is active.",
    needsApproval: false,
  },
  {
    id: "r3", tentacleId: "t-backend", platform: "Backend", icon: "⬡",
    timestamp: now() - 15, priority: "high",
    summary: "P99 latency spike: 480ms on /api/v2/stream. Correlates with latest deploy.",
    needsApproval: false,
  },
  {
    id: "r4", tentacleId: "t-email", platform: "Email", icon: "✉",
    timestamp: now() - 120, priority: "high",
    summary: "AWS invoice $312.40 due Friday. No action required unless budget threshold exceeded.",
    needsApproval: false,
  },
  {
    id: "r5", tentacleId: "t-github", platform: "GitHub", icon: "⎇",
    timestamp: now() - 320, priority: "high",
    summary: "PR #287 review requested on feat/hive-control. Diff: +1,204 / -87 lines.",
    needsApproval: false,
  },
  {
    id: "r6", tentacleId: "t-filesystem", platform: "Filesystem", icon: "📁",
    timestamp: now() - 1, priority: "normal",
    summary: "Large edit in /src/components/HiveView.tsx (14 674 tokens). Dev loop active.",
    needsApproval: false,
  },
  {
    id: "r7", tentacleId: "t-logs", platform: "Logs", icon: "📄",
    timestamp: now() - 5, priority: "high",
    summary: "5× ERR_CONNECTION_RESET on /api/v2/stream in last 60 seconds.",
    needsApproval: false,
  },
];

const SEED_DECISIONS: PendingDecision[] = [
  {
    id: "d1", what: "Reply to Sarah: 'Thursday 2pm works, confirmed.'",
    why: "Meeting request was positive, slot is free in calendar, matches communication style.",
    confidence: 94, tentacleId: "t-email", platform: "Email", icon: "✉", status: "pending",
  },
  {
    id: "d2", what: "Post to #engineering: 'Looking at the pipeline — fix in 15m'",
    why: "You have context on the failing config from last week. Team has been waiting 12m.",
    confidence: 71, tentacleId: "t-slack", platform: "Slack", icon: "#", status: "pending",
  },
  {
    id: "d3", what: "Link CI failure Build #442 to Linear ticket BLA-138.",
    why: "Auto-detected matching issue title and branch name. Saves manual triage.",
    confidence: 88, tentacleId: "t-linear", platform: "Linear", icon: "▲", status: "pending",
  },
];

const SEED_INSIGHTS: CrossDomainInsight[] = [
  {
    id: "i1", timestamp: now() - 20,
    domains: ["development", "communications"],
    highlight: "CI failure on BLADE repo + Sarah asking about it on Slack",
    summary: "Detected: CI Build #442 failed on feat/hive-control → Sarah messaged #engineering asking for status → drafted reply with CI error summary and ETA.",
  },
  {
    id: "i2", timestamp: now() - 420,
    domains: ["operations", "development"],
    highlight: "P99 latency spike → correlates with the last deploy artifact",
    summary: "Backend P99 jumped to 480ms 8 minutes after BLA-v0.4.5 deploy. Logs show connection resets on stream endpoint. Filed BLA-143 automatically.",
  },
  {
    id: "i3", timestamp: now() - 1800,
    domains: ["communications", "operations"],
    highlight: "AWS invoice arriving + cloud spend trending 9% above budget",
    summary: "Email: AWS invoice $312.40. Cloud head confirms spend is $28 above last month, driven by extra CI runs. Drafted spend report for Arnav.",
  },
];

const SEED_AUTO_FIX: AutoFixCard = {
  id: "af1",
  repo: "blade",
  issue: "hive_view.spec.ts timeout — test exceeded 5000ms deadline",
  status: "running",
  progress: 43,
  startedAt: now() - 55,
};

// ── Domain colours ─────────────────────────────────────────────────────────────

const DOMAIN_COLORS: Record<HeadDomain, { primary: string; fill: string; rgb: string }> = {
  communications: { primary: "#818cf8", fill: "rgba(129,140,248,0.1)", rgb: "129,140,248" },
  development:    { primary: "#34d399", fill: "rgba(52,211,153,0.1)",  rgb: "52,211,153" },
  operations:     { primary: "#fb923c", fill: "rgba(251,146,60,0.1)",  rgb: "251,146,60" },
  intelligence:   { primary: "#e879f9", fill: "rgba(232,121,249,0.1)", rgb: "232,121,249" },
};

const STATUS_COLORS_CANVAS = {
  online:   { stroke: "#34c759", fill: "rgba(52,199,89,0.1)" },
  degraded: { stroke: "#f59e0b", fill: "rgba(245,158,11,0.1)" },
  offline:  { stroke: "#ff3b30", fill: "rgba(255,59,48,0.07)" },
  dormant:  { stroke: "#6b7280", fill: "rgba(107,114,128,0.05)" },
};

// ── Graph layout ──────────────────────────────────────────────────────────────

interface GraphLayout {
  tentacles: Array<{ id: string; x: number; y: number; node: TentacleNode; domain: HeadDomain }>;
  heads: Array<{ id: string; x: number; y: number; model: HeadModel }>;
  intel: { x: number; y: number };
  center: { x: number; y: number };
}

// Domain angular positions (intel at top, others spread around)
const DOMAIN_ANGLES: Record<HeadDomain, number> = {
  communications: (-Math.PI / 2) + (Math.PI * 2 / 3),    // upper-right
  development:    (-Math.PI / 2) + (Math.PI * 4 / 3),    // lower-right → lower-left area
  operations:     (-Math.PI / 2) + (Math.PI * 2 / 3 * 2), // upper-left
  intelligence:   -Math.PI / 2,                            // top
};

function buildLayout(
  tentacles: TentacleNode[],
  heads: HeadModel[],
  w: number,
  h: number
): GraphLayout {
  const cx = w / 2;
  const cy = h / 2 + 10; // slight offset so intel head has space above

  const headR    = Math.min(w, h) * 0.2;
  const tentacleR = Math.min(w, h) * 0.39;

  const domainHeads = heads.filter((hm) => hm.domain !== "intelligence");
  const intelHead   = heads.find((hm) => hm.domain === "intelligence");

  const headPositions: GraphLayout["heads"] = heads.map((hm) => {
    const angle = DOMAIN_ANGLES[hm.domain];
    const r = hm.domain === "intelligence" ? headR * 0.85 : headR;
    return { id: hm.id, x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r, model: hm };
  });

  const tentaclePositions: GraphLayout["tentacles"] = [];

  domainHeads.forEach((hm) => {
    const baseAngle = DOMAIN_ANGLES[hm.domain];
    const spread = (Math.PI * 0.55);
    hm.tentacleIds.forEach((tid, ti) => {
      const node = tentacles.find((t) => t.id === tid);
      if (!node) return;
      const count = hm.tentacleIds.length;
      const offset = count > 1 ? spread * (ti / (count - 1) - 0.5) : 0;
      const angle = baseAngle + offset;
      tentaclePositions.push({
        id: tid,
        x: cx + Math.cos(angle) * tentacleR,
        y: cy + Math.sin(angle) * tentacleR,
        node,
        domain: hm.domain,
      });
    });
  });

  const intelPos = intelHead
    ? headPositions.find((h) => h.id === intelHead.id)!
    : { x: cx, y: cy - headR * 0.85 };

  return {
    tentacles: tentaclePositions,
    heads: headPositions,
    intel: { x: intelPos.x, y: intelPos.y },
    center: { x: cx, y: cy },
  };
}

// ── NetworkCanvas ─────────────────────────────────────────────────────────────

function NetworkCanvas({
  tentacles,
  heads,
  selectedId,
  selectedHeadId,
  onSelect,
  onSelectHead,
}: {
  tentacles: TentacleNode[];
  heads: HeadModel[];
  selectedId: string | null;
  selectedHeadId: string | null;
  onSelect: (id: string | null) => void;
  onSelectHead: (id: string | null) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef  = useRef<number>(0);
  const tickRef   = useRef(0);
  const layoutRef = useRef<GraphLayout | null>(null);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;
    tickRef.current++;

    ctx.clearRect(0, 0, W, H);

    const layout = layoutRef.current;
    if (!layout) return;

    // ── Edges: tentacle → domain head ──
    for (const t of layout.tentacles) {
      const hm = heads.find((h) => h.tentacleIds.includes(t.id));
      if (!hm) continue;
      const hp = layout.heads.find((h) => h.id === hm.id);
      if (!hp) continue;

      const dc = DOMAIN_COLORS[t.domain];
      const isActive = t.node.status === "online" || t.node.status === "degraded";

      ctx.beginPath();
      ctx.moveTo(t.x, t.y);
      ctx.lineTo(hp.x, hp.y);
      ctx.strokeStyle = isActive ? `rgba(${dc.rgb},0.22)` : "rgba(255,255,255,0.05)";
      ctx.lineWidth = t.id === selectedId ? 1.5 : 0.8;
      ctx.setLineDash([]);
      ctx.stroke();
    }

    // ── Edges: domain heads → Big Agent center ──
    for (const hp of layout.heads) {
      if (hp.model.domain === "intelligence") continue;
      const dc = DOMAIN_COLORS[hp.model.domain];
      ctx.beginPath();
      ctx.moveTo(hp.x, hp.y);
      ctx.lineTo(layout.center.x, layout.center.y);
      ctx.strokeStyle = `rgba(${dc.rgb},0.14)`;
      ctx.lineWidth = 0.8;
      ctx.setLineDash([3, 7]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // ── Edges: intel head ↔ all domain heads ──
    for (const hp of layout.heads) {
      if (hp.model.domain === "intelligence") continue;
      ctx.beginPath();
      ctx.moveTo(layout.intel.x, layout.intel.y);
      ctx.lineTo(hp.x, hp.y);
      ctx.strokeStyle = "rgba(232,121,249,0.16)";
      ctx.lineWidth = 0.8;
      ctx.setLineDash([2, 5]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // ── Tentacle nodes ──
    for (const t of layout.tentacles) {
      const sc = STATUS_COLORS_CANVAS[t.node.status];
      const dc = DOMAIN_COLORS[t.domain];
      const isSelected = t.id === selectedId;
      const radius = 20;

      // Selection ring
      if (isSelected) {
        ctx.beginPath();
        ctx.arc(t.x, t.y, radius + 4, 0, Math.PI * 2);
        ctx.strokeStyle = dc.primary;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

      // Node fill
      ctx.beginPath();
      ctx.arc(t.x, t.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = isSelected ? `rgba(${dc.rgb},0.18)` : sc.fill;
      ctx.fill();
      ctx.strokeStyle = isSelected ? dc.primary : sc.stroke;
      ctx.lineWidth = isSelected ? 1.5 : 1;
      ctx.stroke();

      // Status dot (top-right corner)
      ctx.beginPath();
      ctx.arc(t.x + radius - 5, t.y - radius + 5, 3, 0, Math.PI * 2);
      ctx.fillStyle = sc.stroke;
      ctx.fill();

      // Platform label
      ctx.font = "500 9px Inter, sans-serif";
      ctx.textAlign = "center";
      ctx.fillStyle = t.node.status === "dormant" ? "rgba(255,255,255,0.2)" : "rgba(255,255,255,0.65)";
      ctx.fillText(t.node.platform.slice(0, 9), t.x, t.y + radius + 13);
    }

    // ── Head nodes ──
    for (const hp of layout.heads) {
      const dc = DOMAIN_COLORS[hp.model.domain];
      const isSelected = hp.id === selectedHeadId;
      const radius = hp.model.domain === "intelligence" ? 28 : 26;

      // Selection ring
      if (isSelected) {
        ctx.beginPath();
        ctx.arc(hp.x, hp.y, radius + 5, 0, Math.PI * 2);
        ctx.strokeStyle = dc.primary;
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      // Node
      ctx.beginPath();
      ctx.arc(hp.x, hp.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = dc.fill;
      ctx.fill();
      ctx.strokeStyle = isSelected ? dc.primary : `rgba(${dc.rgb},0.5)`;
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Label
      ctx.font = "600 9px Inter, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = dc.primary;
      ctx.fillText(hp.model.label, hp.x, hp.y);
      ctx.textBaseline = "alphabetic";
    }

    // ── Big Agent center ──
    const { x: bx, y: by } = layout.center;
    const bigR = 38;

    ctx.beginPath();
    ctx.arc(bx, by, bigR, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(99,102,241,0.1)";
    ctx.fill();
    ctx.strokeStyle = "rgba(99,102,241,0.45)";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.font = "600 10px Inter, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#c7d2fe";
    ctx.fillText("BLADE", bx, by - 4);
    ctx.font = "500 8px Inter, sans-serif";
    ctx.fillStyle = "rgba(165,180,252,0.5)";
    ctx.fillText("BIG AGENT", bx, by + 8);
    ctx.textBaseline = "alphabetic";

    frameRef.current = requestAnimationFrame(draw);
  }, [tentacles, heads, selectedId, selectedHeadId]);

  // Resize observer
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ro = new ResizeObserver(() => {
      canvas.width  = canvas.offsetWidth;
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
    canvas.width  = canvas.offsetWidth || 400;
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
    const mx   = e.clientX - rect.left;
    const my   = e.clientY - rect.top;

    // Check tentacles first
    for (const t of layoutRef.current.tentacles) {
      const dx = t.x - mx, dy = t.y - my;
      if (Math.sqrt(dx * dx + dy * dy) < 24) {
        onSelect(t.id === selectedId ? null : t.id);
        onSelectHead(null);
        return;
      }
    }
    // Check heads
    for (const hp of layoutRef.current.heads) {
      const dx = hp.x - mx, dy = hp.y - my;
      if (Math.sqrt(dx * dx + dy * dy) < 32) {
        onSelectHead(hp.id === selectedHeadId ? null : hp.id);
        onSelect(null);
        return;
      }
    }
    onSelect(null);
    onSelectHead(null);
  }, [selectedId, selectedHeadId, onSelect, onSelectHead]);

  return (
    <canvas
      ref={canvasRef}
      className="w-full h-full cursor-pointer"
      onClick={handleCanvasClick}
    />
  );
}

// ── Priority styles (dot colors only) ────────────────────────────────────────

function relTime(ts: number): string {
  const diff = Math.floor(Date.now() / 1000) - ts;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

// ── ReportCard ────────────────────────────────────────────────────────────────

const PRIORITY_DOT: Record<string, string> = {
  critical: "#ff3b30",
  high:     "#f59e0b",
  normal:   "rgba(255,255,255,0.25)",
  low:      "rgba(255,255,255,0.15)",
};

function ReportCard({
  report,
  onApprove,
  onReject,
}: {
  report: Report;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
}) {
  const dotColor = PRIORITY_DOT[report.priority] ?? "rgba(255,255,255,0.2)";
  const isDone = report.approved || report.rejected;

  return (
    <div
      style={{
        padding: "12px 0",
        borderBottom: "1px solid rgba(255,255,255,0.06)",
        opacity: isDone ? 0.4 : 1,
        transition: "opacity 0.25s ease",
      }}
    >
      <div className="flex items-start gap-3">
        {/* Priority dot */}
        <span
          style={{
            width: 6, height: 6, borderRadius: "50%",
            background: dotColor, flexShrink: 0, marginTop: 5,
          }}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span
              style={{
                fontSize: 12, fontWeight: 500,
                color: "rgba(255,255,255,0.75)",
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}
            >
              {report.platform}
            </span>
            <span style={{ fontSize: 11, color: "rgba(255,255,255,0.3)" }}>
              {relTime(report.timestamp)}
            </span>
          </div>
          <p style={{ fontSize: 13, lineHeight: 1.55, color: "rgba(255,255,255,0.85)" }}>
            {report.summary}
          </p>
          {report.needsApproval && !isDone && (
            <div className="flex gap-2 mt-2.5">
              <button
                onClick={() => onApprove(report.id)}
                style={{
                  padding: "5px 14px", borderRadius: 8, border: "none",
                  background: "rgba(52,199,89,0.15)",
                  color: "#34c759", fontSize: 12, fontWeight: 500,
                  cursor: "pointer", transition: "background 0.25s ease",
                }}
              >
                Approve
              </button>
              <button
                onClick={() => onReject(report.id)}
                style={{
                  padding: "5px 14px", borderRadius: 8, border: "none",
                  background: "rgba(255,59,48,0.12)",
                  color: "#ff3b30", fontSize: 12, fontWeight: 500,
                  cursor: "pointer", transition: "background 0.25s ease",
                }}
              >
                Reject
              </button>
            </div>
          )}
          {report.approved && <span style={{ fontSize: 12, color: "#34c759", marginTop: 4, display: "block" }}>Approved</span>}
          {report.rejected && <span style={{ fontSize: 12, color: "#ff3b30", marginTop: 4, display: "block" }}>Rejected</span>}
        </div>
      </div>
    </div>
  );
}

// ── DecisionCard ──────────────────────────────────────────────────────────────

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
  const confColor =
    decision.confidence >= 85 ? "#34c759"
    : decision.confidence >= 60 ? "#f59e0b"
    : "#ff3b30";

  const isPending   = decision.status === "pending";
  const isExecuting = decision.status === "executing";

  return (
    <div
      style={{
        background: "rgba(255,255,255,0.03)",
        borderRadius: 12,
        padding: "14px 16px",
        marginBottom: 8,
        border: "1px solid rgba(255,255,255,0.08)",
      }}
    >
      <div className="flex items-center gap-2 mb-2.5">
        <span style={{ fontSize: 12, color: "rgba(255,255,255,0.5)" }}>{decision.platform}</span>
        <div className="ml-auto flex items-center gap-1.5">
          <span
            style={{
              width: 6, height: 6, borderRadius: "50%",
              background: confColor, flexShrink: 0,
            }}
          />
          <span style={{ fontSize: 12, color: confColor, fontWeight: 500 }}>{decision.confidence}%</span>
        </div>
      </div>
      <p style={{ fontSize: 13, color: "rgba(255,255,255,0.88)", fontWeight: 500, marginBottom: 6, lineHeight: 1.5 }}>{decision.what}</p>
      <p style={{ fontSize: 12, color: "rgba(255,255,255,0.45)", marginBottom: 14, lineHeight: 1.6 }}>{decision.why}</p>

      {isExecuting && (
        <div className="flex items-center gap-2">
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#818cf8" }} />
          <span style={{ fontSize: 12, color: "#818cf8" }}>Executing…</span>
        </div>
      )}
      {decision.status === "done" && (
        <div className="flex items-center gap-1.5">
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#34c759" }} />
          <span style={{ fontSize: 12, color: "#34c759" }}>Done</span>
        </div>
      )}
      {decision.status === "approved" && !isExecuting && <span style={{ fontSize: 12, color: "#34c759" }}>Approved — queued</span>}
      {decision.status === "rejected" && <span style={{ fontSize: 12, color: "#ff3b30" }}>Rejected</span>}

      {isPending && (
        <div className="flex gap-2">
          {[
            { label: "Approve", bg: "rgba(52,199,89,0.15)",   color: "#34c759", cb: onApprove },
            { label: "Edit",    bg: "rgba(245,158,11,0.12)",  color: "#f59e0b", cb: onEdit },
            { label: "Reject",  bg: "rgba(255,59,48,0.12)",   color: "#ff3b30", cb: onReject },
          ].map((btn) => (
            <button
              key={btn.label}
              onClick={() => btn.cb(decision.id)}
              style={{
                flex: 1, padding: "6px 0", borderRadius: 8, border: "none",
                background: btn.bg, color: btn.color,
                fontSize: 12, fontWeight: 500, cursor: "pointer",
                transition: "background 0.25s ease",
              }}
            >
              {btn.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── HeadPanel ─────────────────────────────────────────────────────────────────

function HeadPanel({
  head,
  tentacles,
  onClose,
}: {
  head: HeadModel;
  tentacles: TentacleNode[];
  onClose: () => void;
}) {
  const dc = DOMAIN_COLORS[head.domain];
  const domainTentacles = tentacles.filter((t) => head.tentacleIds.includes(t.id));

  return (
    <div
      className="fixed inset-0 z-50 flex items-stretch justify-end"
      style={{ background: "rgba(0,0,0,0.4)", backdropFilter: "blur(4px)" }}
      onClick={onClose}
    >
      <div
        className="w-[380px] flex flex-col overflow-hidden"
        style={{
          background: "rgba(14,14,18,0.97)",
          backdropFilter: "blur(24px) saturate(1.8)",
          borderLeft: "1px solid rgba(255,255,255,0.08)",
          boxShadow: "-20px 0 60px rgba(0,0,0,0.5)",
          animation: "slideInRight 0.25s ease",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 shrink-0" style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: dc.fill, border: `1px solid rgba(${dc.rgb},0.2)` }}
          >
            <span style={{ fontSize: 11, fontWeight: 700, color: dc.primary }}>{head.label}</span>
          </div>
          <div className="flex-1 min-w-0">
            <div style={{ fontSize: 14, fontWeight: 600, color: "rgba(255,255,255,0.88)" }} className="truncate">{head.name}</div>
            <div style={{ fontSize: 12, color: dc.primary, marginTop: 2 }}>
              {domainTentacles.filter((t) => t.status === "online").length}/{head.tentacleIds.length} online
            </div>
          </div>
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", color: "rgba(255,255,255,0.3)", cursor: "pointer", fontSize: 20, lineHeight: 1 }}
          >
            ×
          </button>
        </div>

        {/* Stats strip */}
        <div className="grid grid-cols-3 shrink-0" style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
          {[
            { label: "APPROVAL", value: `${head.approvalRate}%` },
            { label: "PENDING",  value: head.pendingReports.toString() },
            { label: "DECISIONS", value: head.recentDecisions.length.toString() },
          ].map((s) => (
            <div key={s.label} className="px-4 py-3" style={{ borderRight: "1px solid rgba(255,255,255,0.06)" }}>
              <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", letterSpacing: "0.12em", marginBottom: 4 }}>{s.label}</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: dc.primary }}>{s.value}</div>
            </div>
          ))}
        </div>

        {/* Scroll body */}
        <div className="flex-1 overflow-y-auto min-h-0 px-5 py-4 space-y-6">

          {/* Tentacles */}
          <div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 10 }}>Tentacles</div>
            {head.domain === "intelligence" ? (
              <p style={{ fontSize: 13, color: "rgba(255,255,255,0.4)" }}>Connected to all domain heads. No direct tentacles.</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {domainTentacles.map((t) => (
                  <div
                    key={t.id}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-lg"
                    style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}
                  >
                    <span
                      style={{
                        width: 6, height: 6, borderRadius: "50%", flexShrink: 0,
                        background: STATUS_COLORS_CANVAS[t.status].stroke,
                      }}
                    />
                    <div className="text-gray-400 shrink-0">
                      <PlatformIcon platform={t.platform} size={12} />
                    </div>
                    <span style={{ fontSize: 13, color: "rgba(255,255,255,0.75)", flex: 1 }} className="truncate">{t.platform}</span>
                    <span style={{ fontSize: 12, color: "rgba(255,255,255,0.35)" }}>{t.messageCount} msgs</span>
                    <span style={{ fontSize: 11, color: STATUS_COLORS_CANVAS[t.status].stroke }}>{t.status}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Recent decisions */}
          <div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 10 }}>Recent Decisions</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {head.recentDecisions.map((d, i) => (
                <div
                  key={i}
                  className="flex items-start gap-3 px-3 py-2.5 rounded-lg"
                  style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}
                >
                  <span
                    style={{
                      width: 6, height: 6, borderRadius: "50%", flexShrink: 0, marginTop: 4,
                      background: d.approved ? "#34c759" : "#ff3b30",
                    }}
                  />
                  <div className="flex-1 min-w-0">
                    <p style={{ fontSize: 13, color: "rgba(255,255,255,0.75)", lineHeight: 1.5 }}>{d.text}</p>
                    <span style={{ fontSize: 11, color: "rgba(255,255,255,0.3)" }}>{relTime(d.ts)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Approval rate bar */}
          <div>
            <div className="flex justify-between items-center mb-2">
              <span style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", letterSpacing: "0.1em", textTransform: "uppercase" }}>Approval Rate</span>
              <span style={{ fontSize: 16, fontWeight: 700, color: dc.primary }}>{head.approvalRate}%</span>
            </div>
            <div style={{ height: 4, borderRadius: 2, background: "rgba(255,255,255,0.07)", overflow: "hidden" }}>
              <div
                style={{
                  height: "100%", borderRadius: 2,
                  width: `${head.approvalRate}%`,
                  background: dc.primary,
                  transition: "width 0.4s ease",
                }}
              />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-4 shrink-0" style={{ borderTop: "1px solid rgba(255,255,255,0.07)" }}>
          <button
            onClick={onClose}
            style={{
              width: "100%", padding: "9px 0", borderRadius: 10,
              background: "rgba(255,255,255,0.06)", border: "none",
              color: "rgba(255,255,255,0.55)", fontSize: 13, fontWeight: 500,
              cursor: "pointer", transition: "background 0.25s ease",
            }}
          >
            Close
          </button>
        </div>
      </div>

      <style>{`
        @keyframes slideInRight {
          from { opacity: 0; transform: translateX(20px); }
          to   { opacity: 1; transform: translateX(0); }
        }
      `}</style>
    </div>
  );
}

// ── CrossDomainInsightCard ────────────────────────────────────────────────────

function InsightCard({ insight }: { insight: CrossDomainInsight }) {
  return (
    <div
      style={{
        padding: "14px 0",
        borderBottom: "1px solid rgba(255,255,255,0.06)",
      }}
    >
      <div className="flex items-center gap-2 mb-2">
        <div className="flex gap-1.5">
          {insight.domains.map((d) => (
            <span
              key={d}
              style={{
                width: 6, height: 6, borderRadius: "50%",
                background: DOMAIN_COLORS[d].primary, flexShrink: 0,
              }}
            />
          ))}
        </div>
        <span style={{ fontSize: 11, color: "rgba(255,255,255,0.3)" }}>{relTime(insight.timestamp)}</span>
      </div>
      <p style={{ fontSize: 13, fontWeight: 500, color: "rgba(255,255,255,0.85)", marginBottom: 6, lineHeight: 1.5 }}>
        {insight.highlight}
      </p>
      <p style={{ fontSize: 12, color: "rgba(255,255,255,0.45)", lineHeight: 1.6 }}>{insight.summary}</p>
    </div>
  );
}

// ── AutoFixBanner ─────────────────────────────────────────────────────────────

function AutoFixBanner({ card, onDismiss }: { card: AutoFixCard; onDismiss: () => void }) {
  const statusColor =
    card.status === "running" ? "#f59e0b"
    : card.status === "done"  ? "#34c759"
    : "#ff3b30";

  return (
    <div
      style={{
        margin: "8px 12px",
        borderRadius: 10,
        padding: "12px 14px",
        background: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(255,255,255,0.08)",
        flexShrink: 0,
      }}
    >
      <div className="flex items-center gap-2 mb-2">
        <span style={{ width: 6, height: 6, borderRadius: "50%", background: statusColor, flexShrink: 0 }} />
        <span style={{ fontSize: 12, fontWeight: 500, color: "rgba(255,255,255,0.6)", flex: 1 }}>
          Auto-Fix · {card.repo}
        </span>
        <button
          onClick={onDismiss}
          style={{ background: "none", border: "none", color: "rgba(255,255,255,0.3)", cursor: "pointer", fontSize: 16, lineHeight: 1 }}
        >
          ×
        </button>
      </div>
      <p style={{ fontSize: 12, color: "rgba(255,255,255,0.75)", lineHeight: 1.5, marginBottom: 10 }}>{card.issue}</p>
      <div style={{ height: 4, borderRadius: 2, background: "rgba(255,255,255,0.07)", overflow: "hidden" }}>
        <div
          style={{
            height: "100%", borderRadius: 2,
            width: `${card.progress}%`,
            background: statusColor,
            transition: "width 0.4s ease",
          }}
        />
      </div>
    </div>
  );
}

// ── TentacleQuickInfo ─────────────────────────────────────────────────────────

function TentacleQuickInfo({
  tentacle,
  onDetails,
}: {
  tentacle: TentacleNode;
  onDetails: () => void;
}) {
  const statusColor = STATUS_COLORS_CANVAS[tentacle.status].stroke;

  return (
    <div
      style={{
        flexShrink: 0, margin: "0 12px 8px", borderRadius: 10,
        background: "rgba(255,255,255,0.03)",
        border: "1px solid rgba(255,255,255,0.08)",
        padding: "10px 14px",
      }}
    >
      <div className="flex items-center gap-2.5 mb-1.5">
        <span style={{ width: 6, height: 6, borderRadius: "50%", background: statusColor, flexShrink: 0 }} />
        <div className="text-gray-400 shrink-0">
          <PlatformIcon platform={tentacle.platform} size={12} />
        </div>
        <span style={{ fontSize: 13, fontWeight: 500, color: "rgba(255,255,255,0.8)", flex: 1 }}>{tentacle.platform}</span>
        <button
          onClick={onDetails}
          style={{ background: "none", border: "none", fontSize: 12, color: "#818cf8", cursor: "pointer" }}
        >
          Details →
        </button>
      </div>
      <div className="flex gap-4">
        <span style={{ fontSize: 12, color: "rgba(255,255,255,0.4)" }}>{tentacle.messageCount} msgs</span>
        <span style={{ fontSize: 12, color: "rgba(255,255,255,0.4)" }}>{tentacle.actionsToday} actions</span>
        <span style={{ fontSize: 12, color: "rgba(255,255,255,0.3)" }}>
          {relTime(tentacle.lastPollTime ?? tentacle.lastSeen)}
        </span>
      </div>
    </div>
  );
}

// ── Main HiveView ──────────────────────────────────────────────────────────────

export function HiveView({ onBack }: HiveViewProps) {
  const [tentacles, setTentacles] = useState<TentacleNode[]>(SEED_TENTACLES);
  const [heads]                   = useState<HeadModel[]>(SEED_HEAD_MODELS);
  const [reports, setReports]     = useState<Report[]>(SEED_REPORTS);
  const [decisions, setDecisions] = useState<PendingDecision[]>(SEED_DECISIONS);
  const [insights]                = useState<CrossDomainInsight[]>(SEED_INSIGHTS);
  const [autoFix, setAutoFix]     = useState<AutoFixCard | null>(SEED_AUTO_FIX);
  const [autonomy, setAutonomy]   = useState(42);
  const [paused, setPaused]       = useState(false);

  const [selectedTentacleId, setSelectedTentacleId] = useState<string | null>(null);
  const [selectedHeadId,     setSelectedHeadId]     = useState<string | null>(null);

  // Right panel tab: "feed" | "insights" | "decisions"
  const [rightTab, setRightTab] = useState<"feed" | "insights" | "decisions">("feed");

  const feedRef = useRef<HTMLDivElement>(null);
  const [feedPaused, setFeedPaused] = useState(false);

  // Computed stats
  const stats: HiveStats = {
    msgsToday:      tentacles.reduce((s, t) => s + t.messageCount, 0),
    actionsToday:   tentacles.reduce((s, t) => s + t.actionsToday, 0),
    autoDecisions:  decisions.filter((d) => d.status !== "pending").length + 14,
    manualDecisions: decisions.filter((d) => d.status === "approved" || d.status === "rejected").length + 3,
    avgResponseMs:  340,
  };

  const onlineCount    = tentacles.filter((t) => t.status === "online").length;
  const totalCount     = tentacles.length;
  const pendingCount   = decisions.filter((d) => d.status === "pending").length;

  const hiveStatusColor =
    paused          ? "#6b7280"
    : onlineCount === totalCount ? "#22c55e"
    : onlineCount >= totalCount * 0.6 ? "#f59e0b"
    : "#ef4444";

  const hiveStatusLabel =
    paused          ? "PAUSED"
    : onlineCount === totalCount ? "HIVE ACTIVE"
    : onlineCount >= totalCount * 0.6 ? "HIVE DEGRADED"
    : "HIVE CRITICAL";

  // Auto-scroll feed
  useEffect(() => {
    if (feedPaused) return;
    const el = feedRef.current;
    if (!el) return;
    const iv = setInterval(() => { el.scrollTop += 1; }, 80);
    return () => clearInterval(iv);
  }, [feedPaused]);

  // Simulate executing → done
  useEffect(() => {
    const iv = setInterval(() => {
      setDecisions((prev) =>
        prev.map((d) => d.status === "executing" ? { ...d, status: "done" as const } : d)
      );
    }, 3000);
    return () => clearInterval(iv);
  }, []);

  // Simulate auto-fix progress
  useEffect(() => {
    if (!autoFix || autoFix.status !== "running") return;
    const iv = setInterval(() => {
      setAutoFix((prev) => {
        if (!prev || prev.status !== "running") return prev;
        const next = Math.min(prev.progress + 1, 100);
        return { ...prev, progress: next, status: next === 100 ? "done" : "running" };
      });
    }, 1200);
    return () => clearInterval(iv);
  }, [autoFix?.status]);

  const selectedTentacle = tentacles.find((t) => t.id === selectedTentacleId) ?? null;
  const selectedHead     = heads.find((h) => h.id === selectedHeadId) ?? null;

  const handleReportApprove = (id: string) =>
    setReports((prev) => prev.map((r) => r.id === id ? { ...r, approved: true, needsApproval: false } : r));
  const handleReportReject = (id: string) =>
    setReports((prev) => prev.map((r) => r.id === id ? { ...r, rejected: true, needsApproval: false } : r));

  const handleDecisionApprove = (id: string) =>
    setDecisions((prev) => prev.map((d) => d.id === id ? { ...d, status: "executing" as const } : d));
  const handleDecisionEdit = (id: string) => {
    const d = decisions.find((x) => x.id === id);
    if (!d) return;
    const next = prompt("Edit decision:", d.what);
    if (next !== null && next.trim())
      setDecisions((prev) => prev.map((x) => x.id === id ? { ...x, what: next.trim(), status: "pending" as const } : x));
  };
  const handleDecisionReject = (id: string) =>
    setDecisions((prev) => prev.map((d) => d.id === id ? { ...d, status: "rejected" as const } : d));

  const handleTentacleUpdate = (id: string, patch: Partial<TentacleNode>) =>
    setTentacles((prev) => prev.map((t) => t.id === id ? { ...t, ...patch } : t));
  const handleReconnect = (id: string) =>
    setTentacles((prev) => prev.map((t) => t.id === id ? { ...t, status: "online", uptime: 0 } : t));

  return (
    <div
      className="flex flex-col h-full overflow-hidden select-none"
      style={{ background: "#0a0a0e", color: "rgba(255,255,255,0.85)", fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}
    >

      {/* ── Top bar ─────────────────────────────────────────────────────────── */}
      <div
        className="flex items-center gap-4 px-4 shrink-0"
        style={{
          height: 44,
          background: "rgba(10,10,14,0.95)",
          borderBottom: "1px solid rgba(255,255,255,0.07)",
        }}
      >
        {/* Back */}
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 shrink-0"
          style={{ background: "none", border: "none", color: "rgba(255,255,255,0.45)", fontSize: 13, cursor: "pointer", transition: "color 0.25s ease" }}
        >
          <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor">
            <path d="M3.828 8l4.95 4.95-1.414 1.414L1 8l6.364-6.364L8.778 3.05 3.828 8z" />
          </svg>
          Back
        </button>

        {/* Hive status */}
        <div className="flex items-center gap-2 shrink-0">
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: hiveStatusColor, flexShrink: 0 }} />
          <span style={{ fontSize: 13, fontWeight: 500, color: "rgba(255,255,255,0.75)" }}>
            {hiveStatusLabel}
          </span>
          <span style={{ fontSize: 12, color: "rgba(255,255,255,0.3)" }}>
            {onlineCount}/{totalCount}
          </span>
        </div>

        {/* Domain legend */}
        <div className="hidden md:flex items-center gap-4 shrink-0">
          {(Object.entries(DOMAIN_COLORS) as [HeadDomain, typeof DOMAIN_COLORS[HeadDomain]][]).map(([domain, dc]) => (
            <div key={domain} className="flex items-center gap-1.5">
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: dc.primary, flexShrink: 0 }} />
              <span style={{ fontSize: 12, color: "rgba(255,255,255,0.4)" }}>{domain.slice(0, 5)}</span>
            </div>
          ))}
        </div>

        <div className="flex-1" />

        {/* Autonomy slider */}
        <div className="flex items-center gap-2.5 shrink-0">
          <span style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", letterSpacing: "0.08em", textTransform: "uppercase" }}>Autonomy</span>
          <input
            type="range" min={0} max={100} value={autonomy}
            onChange={(e) => setAutonomy(Number(e.target.value))}
            className="w-24 accent-indigo-500"
          />
          <span
            style={{
              fontSize: 13, fontWeight: 600, width: 32, textAlign: "right",
              color: autonomy >= 80 ? "#ff3b30" : autonomy >= 50 ? "#f59e0b" : "#34c759",
              transition: "color 0.25s ease",
            }}
          >
            {autonomy}%
          </span>
        </div>

        {/* Kill switch */}
        <button
          onClick={() => setPaused((p) => !p)}
          className="flex items-center gap-1.5 shrink-0"
          style={{
            padding: "5px 12px", borderRadius: 8, border: "none",
            background: paused ? "rgba(52,199,89,0.15)" : "rgba(255,59,48,0.12)",
            color:      paused ? "#34c759" : "#ff3b30",
            fontSize: 12, fontWeight: 500, cursor: "pointer",
            transition: "all 0.25s ease",
          }}
        >
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "currentColor", flexShrink: 0 }} />
          {paused ? "Resume" : "Pause"}
        </button>
      </div>

      {/* ── Main body ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* Left panel — Network Map */}
        <div
          className="w-[340px] shrink-0 flex flex-col overflow-hidden"
          style={{ borderRight: "1px solid rgba(255,255,255,0.07)" }}
        >
          <div
            className="px-4 shrink-0 flex items-center justify-between"
            style={{ height: 36, borderBottom: "1px solid rgba(255,255,255,0.06)" }}
          >
            <span style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", letterSpacing: "0.1em", textTransform: "uppercase" }}>Network Map</span>
            <span style={{ fontSize: 12, color: "rgba(255,255,255,0.25)" }}>{onlineCount} active</span>
          </div>

          {autoFix && (
            <AutoFixBanner card={autoFix} onDismiss={() => setAutoFix(null)} />
          )}

          <div className="flex-1 min-h-0">
            <NetworkCanvas
              tentacles={tentacles}
              heads={heads}
              selectedId={selectedTentacleId}
              selectedHeadId={selectedHeadId}
              onSelect={setSelectedTentacleId}
              onSelectHead={setSelectedHeadId}
            />
          </div>

          {selectedTentacle && (
            <TentacleQuickInfo
              tentacle={selectedTentacle}
              onDetails={() => {}}
            />
          )}
        </div>

        {/* Center + Right — tabbed panel */}
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden">

          {/* Tab header */}
          <div
            className="flex items-center shrink-0"
            style={{ height: 36, borderBottom: "1px solid rgba(255,255,255,0.07)" }}
          >
            {(["feed", "insights", "decisions"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setRightTab(tab)}
                className="flex items-center gap-1.5"
                style={{
                  height: 36, padding: "0 16px", border: "none",
                  fontSize: 12, fontWeight: 500,
                  color:        rightTab === tab ? "rgba(255,255,255,0.88)" : "rgba(255,255,255,0.35)",
                  borderBottom: rightTab === tab ? "1px solid rgba(255,255,255,0.5)" : "1px solid transparent",
                  background:   "transparent",
                  cursor: "pointer",
                  transition: "color 0.25s ease",
                  marginBottom: -1,
                }}
              >
                {tab === "feed" && "Feed"}
                {tab === "insights" && "Big Agent"}
                {tab === "decisions" && (
                  <>
                    Decisions
                    {pendingCount > 0 && (
                      <span
                        style={{
                          fontSize: 11, fontWeight: 600,
                          padding: "1px 6px", borderRadius: 10,
                          background: "rgba(99,102,241,0.2)",
                          color: "#818cf8", marginLeft: 4,
                        }}
                      >
                        {pendingCount}
                      </span>
                    )}
                  </>
                )}
              </button>
            ))}
          </div>

          {/* Tab bodies */}
          {rightTab === "feed" && (
            <>
              {reports.filter((r) => r.priority === "critical" && !r.approved && !r.rejected).length > 0 && (
                <div
                  className="px-4 shrink-0 flex items-center gap-2"
                  style={{ height: 32, background: "rgba(255,59,48,0.06)", borderBottom: "1px solid rgba(255,59,48,0.15)" }}
                >
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#ff3b30" }} />
                  <span style={{ fontSize: 12, fontWeight: 500, color: "#ff3b30" }}>
                    {reports.filter((r) => r.priority === "critical" && !r.approved && !r.rejected).length} critical
                  </span>
                </div>
              )}
              <div
                ref={feedRef}
                className="flex-1 min-h-0 overflow-y-auto"
                style={{ padding: "0 16px" }}
                onMouseEnter={() => setFeedPaused(true)}
                onMouseLeave={() => setFeedPaused(false)}
              >
                {[
                  ...reports.filter((r) => r.priority === "critical"),
                  ...reports.filter((r) => r.priority !== "critical").sort((a, b) => b.timestamp - a.timestamp),
                ].map((r) => (
                  <ReportCard key={r.id} report={r} onApprove={handleReportApprove} onReject={handleReportReject} />
                ))}
              </div>
            </>
          )}

          {rightTab === "insights" && (
            <div className="flex-1 min-h-0 overflow-y-auto" style={{ padding: "8px 16px" }}>
              <p style={{ fontSize: 12, color: "rgba(255,255,255,0.35)", lineHeight: 1.6, marginBottom: 8 }}>
                Cross-domain connections detected by BLADE's Big Agent.
              </p>
              {insights.map((ins) => <InsightCard key={ins.id} insight={ins} />)}
            </div>
          )}

          {rightTab === "decisions" && (
            <div className="flex-1 min-h-0 overflow-y-auto" style={{ padding: "8px 12px" }}>
              {decisions.length === 0 ? (
                <p style={{ fontSize: 13, color: "rgba(255,255,255,0.3)", textAlign: "center", paddingTop: 32 }}>No pending decisions</p>
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
          )}
        </div>
      </div>

      {/* ── Bottom stats strip ─────────────────────────────────────────────────── */}
      <div
        className="flex items-center gap-5 px-4 shrink-0 overflow-x-auto"
        style={{
          height: 36,
          background: "#0a0a0e",
          borderTop: "1px solid rgba(255,255,255,0.07)",
        }}
      >
        {[
          { label: "Messages", value: stats.msgsToday.toLocaleString() },
          { label: "Actions",  value: stats.actionsToday.toLocaleString() },
          { label: "Auto",     value: stats.autoDecisions.toString() },
          { label: "Manual",   value: stats.manualDecisions.toString() },
          { label: "Latency",  value: `${stats.avgResponseMs}ms` },
          { label: "Online",   value: `${onlineCount}/${totalCount}` },
        ].map((s) => (
          <div key={s.label} className="flex items-center gap-2 shrink-0">
            <span style={{ fontSize: 11, color: "rgba(255,255,255,0.28)", textTransform: "uppercase", letterSpacing: "0.07em" }}>{s.label}</span>
            <span style={{ fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.7)" }}>{s.value}</span>
          </div>
        ))}
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

      {/* Head panel slide-out */}
      {selectedHead && (
        <HeadPanel
          head={selectedHead}
          tentacles={tentacles}
          onClose={() => setSelectedHeadId(null)}
        />
      )}
    </div>
  );
}
