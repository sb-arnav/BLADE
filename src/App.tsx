import React, { Suspense, lazy, useCallback, useRef, useState, useEffect, Component } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { ActivityFeed, useActivityFeed } from "./components/ActivityFeed";
import { OnboardingModal } from "./components/OnboardingModal";
import { ChatWindow } from "./components/ChatWindow";
import { CommandPalette } from "./components/CommandPalette";
import { NotificationCenter, useNotifications } from "./components/NotificationCenter";
import { TitleBar } from "./components/TitleBar";
import { GlowOverlay } from "./components/GlowOverlay";
import { useChat } from "./hooks/useChat";
import { useTTS } from "./hooks/useTTS";
import { useKeyboard } from "./hooks/useKeyboard";
import { useNotificationSound } from "./hooks/useNotificationSound";
import { useStats } from "./hooks/useStats";
import { useFileDrop } from "./hooks/useFileDrop";
import { useContextAwareness } from "./hooks/useContextAwareness";
import { useProactiveMode } from "./hooks/useProactiveMode";
import { useVoiceCommands } from "./hooks/useVoiceCommands";
import { useVoiceMode } from "./hooks/useVoiceMode";
import { VoiceOrb } from "./components/VoiceOrb";
import { useVoiceConversation } from "./hooks/useVoiceConversation";
import { useRuntimes } from "./hooks/useRuntimes";
import { copyConversation } from "./utils/exportConversation";
import { BladeConfig } from "./types";
import { ToastProvider } from "./components/Toast";
// import { Sidebar } from "./components/Sidebar";
import { StatusBar } from "./components/StatusBar";
// DashboardGlance available for future sidebar layout
// import { DashboardGlance } from "./components/DashboardGlance";

// ── Error boundary ────────────────────────────────────────────────────────────
interface EBState { error: Error | null }
class ErrorBoundary extends Component<{ children: React.ReactNode }, EBState> {
  state: EBState = { error: null };
  static getDerivedStateFromError(error: Error): EBState { return { error }; }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[BLADE] Render crash:", error, info.componentStack);
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ position: "fixed", inset: 0, background: "#1a0000", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, padding: 24 }}>
          <div style={{ width: 12, height: 12, borderRadius: "50%", background: "#ff4444" }} />
          <p style={{ fontSize: 16, fontWeight: 700, color: "#ff6666" }}>BLADE crashed</p>
          <p style={{ fontSize: 13, color: "#ff9999", textAlign: "center", maxWidth: 400, wordBreak: "break-all", fontFamily: "monospace" }}>
            {this.state.error.message}
          </p>
          <pre style={{ fontSize: 11, color: "#ff777766", maxWidth: 500, maxHeight: 200, overflow: "auto", whiteSpace: "pre-wrap" }}>
            {this.state.error.stack}
          </pre>
          <button
            onClick={() => this.setState({ error: null })}
            className="px-4 py-1.5 rounded-lg bg-blade-surface border border-blade-border text-xs text-blade-secondary hover:text-blade-text transition-colors"
          >
            Reload UI
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

type Route = "chat" | "settings" | "discovery" | "diagnostics" | "analytics" | "knowledge" | "comparison" | "agents" | "terminal" | "files" | "canvas" | "workflows" | "activity" | "sync" | "managed-agents" | "email" | "docs" | "web-auto" | "agent-teams" | "git" | "character" | "reports" | "init" | "deeplearn" | "computer-use" | "bg-agents" | "screen-timeline" | "swarm" | "soul" | "dashboard" | "skill-packs" | "goals" | "kali" | "agents-authority" | "accountability" | "sidecar" | "workflow-builder" | "code-sandbox" | "persona" | "negotiation" | "financial" | "context-engine" | "reasoning" | "social-graph" | "health" | "documents" | "habits" | "knowledge-graph" | "meetings" | "predictions" | "emotional-intel" | "decision-log" | "security" | "health-panel" | "temporal" | "integrations" | "smart-home" | "finance" | "hive" | "agent-factory" | "rewind" | "live-notes";

const Analytics = lazy(() => import("./components/Analytics").then((m) => ({ default: m.Analytics })));
const Canvas = lazy(() => import("./components/Canvas"));
const ConversationInsightsPanel = lazy(() => import("./components/ConversationInsightsPanel").then((m) => ({ default: m.ConversationInsightsPanel })));
const Diagnostics = lazy(() => import("./components/Diagnostics").then((m) => ({ default: m.Diagnostics })));
const Discovery = lazy(() => import("./components/Discovery").then((m) => ({ default: m.Discovery })));
const FileBrowser = lazy(() => import("./components/FileBrowser").then((m) => ({ default: m.FileBrowser })));
const FocusMode = lazy(() => import("./components/FocusMode"));
const KnowledgeBase = lazy(() => import("./components/KnowledgeBase").then((m) => ({ default: m.KnowledgeBase })));
const ModelComparison = lazy(() => import("./components/ModelComparison").then((m) => ({ default: m.ModelComparison })));
const OperatorCenter = lazy(() => import("./components/OperatorCenter"));
const SystemPromptPreview = lazy(() => import("./components/SystemPromptPreview"));
const InitWizard = lazy(() => import("./components/InitWizard").then((m) => ({ default: m.InitWizard })));
const Settings = lazy(() => import("./components/Settings").then((m) => ({ default: m.Settings })));
const SyncSettings = lazy(() => import("./components/SyncStatus").then((m) => ({ default: m.SyncSettings })));
const TemplateManager = lazy(() => import("./components/TemplateManager"));
const Terminal = lazy(() => import("./components/Terminal").then((m) => ({ default: m.Terminal })));
const ThemePicker = lazy(() => import("./components/ThemePicker").then((m) => ({ default: m.ThemePicker })));
const ShortcutHelp = lazy(() => import("./components/ShortcutHelp"));
const BranchNavigator = lazy(() => import("./components/BranchNavigator"));
const WorkflowBuilder = lazy(() => import("./components/WorkflowBuilder"));
const EmailAssistant = lazy(() => import("./components/EmailAssistant").then((m) => ({ default: m.EmailAssistant })));
const DocumentGenerator = lazy(() => import("./components/DocumentGenerator"));
const WebAutomation = lazy(() => import("./components/WebAutomation"));
const AgentTeamPanel = lazy(() => import("./components/AgentTeamPanel").then((m) => ({ default: m.AgentTeamPanel })));
const GitPanel = lazy(() => import("./components/GitPanel").then((m) => ({ default: m.GitPanel })));
const DeepLearn = lazy(() => import("./components/DeepLearn").then((m) => ({ default: m.DeepLearn })));
const CharacterBible = lazy(() => import("./components/CharacterBible").then((m) => ({ default: m.CharacterBible })));
const CapabilityReports = lazy(() => import("./components/CapabilityReports").then((m) => ({ default: m.CapabilityReports })));
const ComputerUsePanel = lazy(() => import("./components/ComputerUsePanel").then((m) => ({ default: m.ComputerUsePanel })));
const BackgroundAgentsPanel = lazy(() => import("./components/BackgroundAgentsPanel").then((m) => ({ default: m.BackgroundAgentsPanel })));
const ScreenTimeline = lazy(() => import("./components/ScreenTimeline").then((m) => ({ default: m.ScreenTimeline })));
const SwarmView = lazy(() => import("./components/SwarmView").then((m) => ({ default: m.SwarmView })));
const SoulView = lazy(() => import("./components/SoulView").then((m) => ({ default: m.SoulView })));
import { Dashboard } from "./components/Dashboard";
const SkillPackView = lazy(() => import("./components/SkillPackView").then((m) => ({ default: m.SkillPackView })));
const GoalView = lazy(() => import("./components/GoalView").then((m) => ({ default: m.GoalView })));
const KaliView = lazy(() => import("./components/KaliView").then((m) => ({ default: m.KaliView })));
const AgentDashboard = lazy(() => import("./components/AgentDashboard").then(m => ({ default: m.AgentDashboard })));
const AccountabilityView = lazy(() => import("./components/AccountabilityView").then(m => ({ default: m.AccountabilityView })));
const SidecarView = lazy(() => import("./components/SidecarView").then(m => ({ default: m.SidecarView })));
const WorkflowBuilderView = lazy(() => import("./components/WorkflowBuilderView").then(m => ({ default: m.WorkflowBuilderView })));
const CodeSandboxView = lazy(() => import("./components/CodeSandboxView").then(m => ({ default: m.CodeSandboxView })));
const PersonaView = lazy(() => import("./components/PersonaView").then(m => ({ default: m.PersonaView })));
const NegotiationView = lazy(() => import("./components/NegotiationView").then(m => ({ default: m.NegotiationView })));
const FinancialView = lazy(() => import("./components/FinancialView").then(m => ({ default: m.FinancialView })));
const ContextEngineView = lazy(() => import("./components/ContextEngineView").then(m => ({ default: m.ContextEngineView })));
const ReasoningView = lazy(() => import("./components/ReasoningView").then(m => ({ default: m.ReasoningView })));
const SocialGraphView = lazy(() => import("./components/SocialGraphView").then(m => ({ default: m.SocialGraphView })));
const HealthView = lazy(() => import("./components/HealthView").then(m => ({ default: m.HealthView })));
const DocumentView = lazy(() => import("./components/DocumentView").then(m => ({ default: m.DocumentView })));
const HabitView = lazy(() => import("./components/HabitView").then(m => ({ default: m.HabitView })));
const KnowledgeGraphView = lazy(() => import("./components/KnowledgeGraphView").then(m => ({ default: m.KnowledgeGraphView })));
const MeetingView = lazy(() => import("./components/MeetingView").then(m => ({ default: m.MeetingView })));
const PredictionView = lazy(() => import("./components/PredictionView").then(m => ({ default: m.PredictionView })));
const EmotionalIntelligenceView = lazy(() => import("./components/EmotionalIntelligenceView").then(m => ({ default: m.EmotionalIntelligenceView })));
const DecisionLog = lazy(() => import("./components/DecisionLog").then(m => ({ default: m.DecisionLog })));
const SecurityDashboard = lazy(() => import("./components/SecurityDashboard").then(m => ({ default: m.SecurityDashboard })));
const HealthPanel = lazy(() => import("./components/HealthPanel").then(m => ({ default: m.HealthPanel })));
const TemporalPanel = lazy(() => import("./components/TemporalPanel").then(m => ({ default: m.TemporalPanel })));
const IntegrationStatus = lazy(() => import("./components/IntegrationStatus").then(m => ({ default: m.IntegrationStatus })));
const SmartHomePanel = lazy(() => import("./components/SmartHomePanel").then(m => ({ default: m.SmartHomePanel })));
const FinanceView = lazy(() => import("./components/FinanceView").then(m => ({ default: m.FinanceView })));
const HiveView = lazy(() => import("./components/HiveView").then(m => ({ default: m.HiveView })));
const RewindTimeline = lazy(() => import("./components/RewindTimeline").then(m => ({ default: m.RewindTimeline })));
const LiveNotes = lazy(() => import("./components/LiveNotes").then(m => ({ default: m.LiveNotes })));
const AgentFactoryView = lazy(() => import("./components/AgentFactory").then(m => ({ default: m.AgentFactory })));

function ShellFallback({ label = "Loading workspace..." }: { label?: string }) {
  return (
    <div className="flex items-center justify-center h-full bg-blade-bg">
      <div className="flex flex-col items-center gap-4 w-48">
        {/* Skeleton lines */}
        <div className="w-full space-y-2">
          <div className="skeleton h-2.5 w-3/4 rounded-full" />
          <div className="skeleton h-2 w-full rounded-full" />
          <div className="skeleton h-2 w-5/6 rounded-full" />
          <div className="skeleton h-2 w-2/3 rounded-full" />
        </div>
        <p className="text-2xs text-blade-muted/40 font-mono">{label}</p>
      </div>
    </div>
  );
}

const ROUTE_INTENT_LABELS: Partial<Record<Route, { title: string; note: string }>> = {
  terminal: {
    title: "Terminal workspace",
    note: "Blade opened the terminal so you can run commands and send output back into the conversation.",
  },
  files: {
    title: "File workspace",
    note: "Blade opened your files so you can inspect local context and send anything important back into chat.",
  },
  canvas: {
    title: "Canvas workspace",
    note: "Blade opened a visual thinking space so you can sketch, map ideas, and bring them back into the conversation.",
  },
  workflows: {
    title: "Workflow workspace",
    note: "Blade opened workflows so you can turn repeated tasks into reusable execution flows.",
  },
  agents: {
    title: "Operator center",
    note: "Blade opened operator center so you can route work across Blade native execution, Claude, and Codex runtimes.",
  },
  "managed-agents": {
    title: "Operator center",
    note: "Blade opened operator center with Claude-focused tools so you can work across managed runs and imported runtimes in one place.",
  },
  email: {
    title: "Email workspace",
    note: "Blade opened email tools so you can read, draft, and move decisions back into your main thread.",
  },
  docs: {
    title: "Document workspace",
    note: "Blade opened document generation so you can produce a structured draft and continue from chat.",
  },
  "web-auto": {
    title: "Web automation",
    note: "Blade opened web automation so you can turn browsing or scraping tasks into guided actions.",
  },
  "agent-teams": {
    title: "Agent teams",
    note: "Blade opened agent teams for coordinated multi-role execution.",
  },
  git: {
    title: "Git workspace",
    note: "Blade opened git tools so you can inspect repo state and push decisions back into chat.",
  },
};

export default function App() {
  const [config, setConfig] = useState<BladeConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [route, setRoute] = useState<Route>("dashboard");
  const [chatPanelOpen, setChatPanelOpen] = useState(true);
  const [personaOnboardingOpen, setPersonaOnboardingOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutHelpOpen, setShortcutHelpOpen] = useState(false);
  const [systemPromptOpen, setSystemPromptOpen] = useState(false);
  const [templateManagerOpen, setTemplateManagerOpen] = useState(false);
  const [themePickerOpen, setThemePickerOpen] = useState(false);
  const [insightsOpen, setInsightsOpen] = useState(false);
  const [branchOpen, setBranchOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [workspaceIntent, setWorkspaceIntent] = useState<{ route: Route; title: string; note: string } | null>(null);
  const chat = useChat();
  const tts = useTTS(chat.messages, chat.loading, config);
  const sound = useNotificationSound(chat.loading);
  const { stats, recordMessage } = useStats();
  const notifications = useNotifications();
  const activity = useActivityFeed();
  const contextAwareness = useContextAwareness();
  const proactive = useProactiveMode();
  const voiceCommands = useVoiceCommands();
  const runtimeCenter = useRuntimes();

  const [voiceDraft, setVoiceDraft] = useState<string | null>(null);
  void voiceDraft;
  const voiceSendRef = useRef<(text: string) => void>(() => {});
  const voiceMode = useVoiceMode({
    config: config ?? { provider: "", api_key: "", model: "", onboarded: false, mcp_servers: [] },
    onTranscription: (text, autoSend) => {
      if (autoSend) voiceSendRef.current(text);
      else setVoiceDraft(text);
    },
  });

  // Hoisted voice conversation — controls the VoiceOrb's primary interaction
  const voiceConv = useVoiceConversation();

  // Track last assistant response for the orb tooltip
  const [lastOrbResponse, setLastOrbResponse] = useState<string | null>(null);
  useEffect(() => {
    if (!chat.loading && chat.messages.length > 0) {
      const last = chat.messages[chat.messages.length - 1];
      if (last.role === "assistant" && last.content) {
        setLastOrbResponse(last.content.slice(0, 160));
      }
    }
  }, [chat.loading, chat.messages]);

  const inputRef = useRef<HTMLTextAreaElement>(null);

  const handleImageDrop = useCallback((dataUrl: string) => {
    const base64 = dataUrl.split(",")[1];
    if (base64) sendWithStats("Analyze this image", base64);
  }, []);

  const handleTextDrop = useCallback((text: string) => {
    const preview = text.length > 2000 ? text.slice(0, 2000) + "\n...[truncated]" : text;
    sendWithStats(`Analyze this file:\n\n\`\`\`\n${preview}\n\`\`\``);
  }, []);

  const { isDragging } = useFileDrop(handleImageDrop, handleTextDrop);

  const loadConfig = async () => {
    try {
      const debug = await invoke("debug_config");
      console.log("[Blade] Config debug:", debug);
      const cfg = await invoke<BladeConfig>("get_config");
      console.log("[Blade] Config loaded:", { onboarded: cfg.onboarded, provider: cfg.provider, hasKey: !!cfg.api_key });
      setConfig(cfg);
      // Check persona onboarding: only show after the main API-key onboarding is done
      if (cfg.onboarded) {
        const personaDone = await invoke<boolean>("get_onboarding_status").catch(() => true);
        if (!personaDone) {
          setPersonaOnboardingOpen(true);
        }
      }
    } catch {
      setConfig({
        provider: "",
        api_key: "",
        model: "",
        onboarded: false,
        mcp_servers: [],
      });
    }
    setLoading(false);
  };

  useEffect(() => {
    loadConfig();
    // Log context awareness greeting for proactive suggestions
    console.log("[Blade]", contextAwareness.getGreeting());
  }, []);

  // Open external links in OS browser
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      const anchor = (e.target as HTMLElement).closest("a");
      if (!anchor) return;
      const href = anchor.getAttribute("href");
      if (href && (href.startsWith("http://") || href.startsWith("https://"))) {
        e.preventDefault();
        window.open(href, "_blank");
      }
    };
    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, []);

  // Auto-focus input + force WebView2 repaint when window regains focus.
  // On Windows with decorations:false, WebView2 stops painting when another
  // app takes focus. Dispatching a resize event forces it to redraw.
  useEffect(() => {
    const unlisten = listen("tauri://focus", () => {
      window.dispatchEvent(new Event("resize"));
      setTimeout(() => inputRef.current?.focus(), 50);
    });
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  // Capability gap detected
  useEffect(() => {
    const unlisten = listen<{ user_request: string }>("capability_gap_detected", (event) => {
      activity.track("knowledge", "Capability gap filed", event.payload.user_request);
      notifications.add({
        type: "warning",
        title: "Capability gap detected",
        message: event.payload.user_request,
        action: { label: "View reports", callback: () => openRoute("reports") },
      });
    });
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  // Brain entity extraction notifications
  useEffect(() => {
    const unlisten = listen<{ new_entities: number }>("brain_grew", (event) => {
      const n = event.payload.new_entities;
      if (n > 0) {
        activity.track("knowledge", `Brain grew`, `+${n} new entit${n === 1 ? "y" : "ies"} added to knowledge graph`);
      }
    });
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  // Notify when response completes (if window is hidden)
  useEffect(() => {
    if (!chat.loading && chat.messages.length > 0) {
      const last = chat.messages[chat.messages.length - 1];
      if (last.role === "assistant" && last.content) {
        activity.track("message", "Response received", last.content.slice(0, 80));
      }
    }
  }, [chat.loading]);

  // Handle proactive suggestions (time-based)
  useEffect(() => {
    if (proactive.suggestions.length > 0) {
      const latest = proactive.suggestions[proactive.suggestions.length - 1];
      notifications.add({
        type: "info",
        title: latest.title,
        message: latest.description,
        action: { label: "Try it", callback: () => sendWithStats(latest.prompt) },
      });
    }
  }, [proactive.suggestions.length]);

  // Multi-monitor detection — offer to claim the second screen as BLADE's JARVIS display
  useEffect(() => {
    const unlisten = listen<{ count: number; message: string }>("multiple_monitors_detected", (event) => {
      notifications.add({
        type: "info",
        title: `${event.payload.count} monitors detected`,
        message: event.payload.message,
        action: {
          label: "Claim Monitor 2 →",
          callback: () => {
            invoke("move_to_monitor", { monitorIndex: 1 }).catch(() => {});
          },
        },
      });
      if (tts.enabled) tts.speak(event.payload.message);
    });
    return () => { unlisten.then((fn) => fn()); };
  }, [tts.enabled]);

  // Ambient proactive nudges from background monitor — Blade speaks without being asked
  useEffect(() => {
    const unlisten = listen<{ message: string; type: string; raw?: string }>("proactive_nudge", (event) => {
      const { message, type: nudgeType, raw } = event.payload;
      // For error detections, send the raw error so Blade can actually diagnose it
      const replyText = nudgeType === "error_detected" && raw
        ? `Diagnose this error:\n\`\`\`\n${raw}\n\`\`\``
        : message;
      notifications.add({
        type: "info",
        title: "Blade",
        message,
        action: { label: nudgeType === "error_detected" ? "Diagnose" : "Reply", callback: () => sendWithStats(replyText) },
      });
      if (tts.enabled) {
        tts.speak(message);
      }
      activity.track("message", "Blade nudge", message.slice(0, 80));
    });
    return () => { unlisten.then((fn) => fn()); };
  }, [tts.enabled]);

  // PULSE — Blade's heartbeat. A thought from a mind that's been watching.
  useEffect(() => {
    // Load last thought on startup
    invoke<string | null>("pulse_get_last_thought").then((t) => {
      void t;
    }).catch(() => {});

    const unlisten = listen<{ thought: string; timestamp: number }>("blade_pulse", (event) => {
      const { thought } = event.payload;
      void thought;
      notifications.add({
        type: "info",
        title: "Blade",
        message: thought,
        action: { label: "Reply", callback: () => sendWithStats(`${thought} — what do you think I should do?`) },
      });
      if (tts.enabled) tts.speak(thought);
      activity.track("message", "Blade pulse", thought.slice(0, 80));
    });

    // MORNING BRIEFING — richer once-per-day context summary
    const unlistenBriefing = listen<{ briefing: string; date: string }>("blade_briefing", (event) => {
      void event.payload;
    });

    // REMINDERS — fire notification + toast when a scheduled reminder fires
    const unlistenReminderFired = listen<{ id: string; title: string; note: string; timestamp: number }>(
      "blade_reminder_fired",
      (event) => {
        const { title, note } = event.payload;
        const message = note ? `${title} — ${note}` : title;
        notifications.add({
          type: "warning",
          title: "Reminder",
          message,
          action: { label: "Dismiss", callback: () => {} },
        });
        if (tts.enabled) tts.speak(`Reminder: ${message}`);
      }
    );

    // REMINDER CREATED (auto-extracted from conversation) — quiet toast
    const unlistenReminderCreated = listen<{ id: string; title: string; source: string }>(
      "blade_reminder_created",
      (event) => {
        if (event.payload.source === "auto_extract") {
          notifications.add({
            type: "info",
            title: "Reminder set",
            message: event.payload.title,
          });
        }
      }
    );

    const unlistenSkillLearned = listen<{ name: string; trigger_pattern: string }>(
      "skill_learned",
      (event) => {
        notifications.add({
          type: "success",
          title: `Skill learned: ${event.payload.name}`,
          message: event.payload.trigger_pattern,
        });
      }
    );

    const unlistenWatcher = listen<{ url: string; label: string; summary: string }>(
      "watcher_alert",
      (event) => {
        const { label, summary } = event.payload;
        notifications.add({
          type: "info",
          title: `Watch: ${label}`,
          message: summary,
          action: {
            label: "Discuss",
            callback: () => sendWithStats(`Something changed on ${label}:\n\n${summary}\n\nWhat should I know about this?`),
          },
        });
      }
    );

    // EVOLUTION — BLADE leveled up after wiring in a new capability
    const unlistenLevelUp = listen<{ level: number; score: number; next_unlock: string | null }>(
      "blade_leveled_up",
      (event) => {
        const { level, next_unlock } = event.payload;
        notifications.add({
          type: "success",
          title: `BLADE reached Level ${level}`,
          message: next_unlock ?? "New capabilities unlocked.",
          action: { label: "View", callback: () => { /* open settings */ } },
        });
      }
    );

    // EVOLUTION — BLADE auto-installed something (no token needed)
    const unlistenAutoUpgraded = listen<{ installed: string[]; message: string }>(
      "blade_auto_upgraded",
      (event) => {
        notifications.add({
          type: "info",
          title: "BLADE upgraded itself",
          message: event.payload.message,
        });
      }
    );

    // EVOLUTION — new suggestion surfaced (app detected, needs a token)
    const unlistenEvolutionSuggestion = listen<{ name: string; description: string; trigger_app: string }>(
      "evolution_suggestion",
      (event) => {
        const { name, description, trigger_app } = event.payload;
        notifications.add({
          type: "info",
          title: `New capability: ${name}`,
          message: `Detected via ${trigger_app} — ${description}`,
          action: { label: "View", callback: () => openRoute("dashboard") },
        });
      }
    );

    // WAKE WORD — "Hey BLADE" detected → start voice recording as if Ctrl+Shift+V was pressed
    const unlistenWakeWord = listen("wake_word_detected", () => {
      window.dispatchEvent(new CustomEvent("blade_wake_word_triggered"));
    });

    // AUTOSKILLS — BLADE auto-installed a new capability
    const unlistenAutoskillInstalled = listen<{ name: string; tool_count: number; message: string }>("autoskill_installed", (event) => {
      notifications.add({
        type: "success",
        title: `Acquired: ${event.payload.name}`,
        message: event.payload.message,
      });
    });

    const unlistenAutoskillSuggestion = listen<{ name: string; message: string }>("autoskill_suggestion", (event) => {
      notifications.add({
        type: "info",
        title: `Need credentials: ${event.payload.name}`,
        message: event.payload.message,
      });
    });

    // Background AI auto-disabled on 402 (out of credits)
    const unlistenBgAiDisabled = listen<{ message: string }>("background_ai_auto_disabled", (event) => {
      notifications.add({ type: "warning", title: "Background AI disabled", message: event.payload.message });
    });

    // Shortcut registration failure — OS conflict, tell user to change it in Settings
    const unlistenShortcutFailed = listen<{ name: string; shortcut: string; error: string }>(
      "shortcut_registration_failed",
      (event) => {
        notifications.add({
          type: "warning",
          title: `Shortcut conflict: ${event.payload.name}`,
          message: `"${event.payload.shortcut}" couldn't be registered (${event.payload.error}). Change it in Settings → General.`,
          action: { label: "Fix", callback: () => openRoute("settings") },
        });
      }
    );

    // Provider fallback notification — emitted when BLADE auto-switches to fallback provider
    const unlistenFallback = listen<{ type: string; message: string }>("blade_notification", (event) => {
      notifications.add({ type: event.payload.type as "info" | "success" | "error", title: "BLADE", message: event.payload.message });
    });

    // Monitor disconnected — clear dedicated monitor setting notification
    const unlistenMonitorOff = listen<{ count: number }>("monitor_disconnected", (event) => {
      notifications.add({ type: "info", title: "Monitor disconnected", message: `Down to ${event.payload.count} monitor${event.payload.count !== 1 ? "s" : ""}. Dedicated screen cleared.` });
    });

    // JITRO — self-coding started
    const unlistenSelfCode = listen<{ agent_id: string; feature: string; source_path: string }>(
      "blade_self_code_started",
      (event) => {
        notifications.add({
          type: "info",
          title: "BLADE is coding itself",
          message: `Working on: "${event.payload.feature.slice(0, 80)}" — Agent ${event.payload.agent_id.slice(0, 8)}`,
          action: { label: "Watch agents", callback: () => openRoute("bg-agents") },
        });
      }
    );

    // Clipboard pre-analysis ready — subtle indicator that BLADE already has the answer
    const unlistenClipPrefetch = listen<{ content_type: string; preview: string }>(
      "clipboard_prefetch_ready",
      (event) => {
        const { content_type, preview } = event.payload;
        const label = content_type === "error" ? "error" : content_type === "code" ? "code snippet" : "content";
        notifications.add({
          type: "info",
          title: "Ready to help",
          message: `Pre-analyzed ${label}: "${preview.slice(0, 60)}…" — ask me about it`,
          action: { label: "Ask now", callback: () => sendWithStats(`What do you make of what I just copied?`) },
        });
      }
    );

    // AI delegate decisions — show brief notification when Claude Code approves/denies for BLADE
    const unlistenDelegateApproved = listen<{ tool: string; delegate: string; reasoning: string }>(
      "ai_delegate_approved",
      (event) => {
        notifications.add({
          type: "info",
          title: `${event.payload.delegate} approved`,
          message: `Approved "${event.payload.tool}": ${event.payload.reasoning.slice(0, 80)}`,
        });
      }
    );
    const unlistenDelegateDenied = listen<{ tool: string; delegate: string; reasoning: string }>(
      "ai_delegate_denied",
      (event) => {
        notifications.add({
          type: "warning",
          title: `${event.payload.delegate} denied action`,
          message: `Blocked "${event.payload.tool}": ${event.payload.reasoning.slice(0, 80)}`,
        });
      }
    );

    // Proactive suggestion from God Mode — surfaces when BLADE detects an insight (no user prompt needed)
    const unlistenProactiveSuggestion = listen<{ id: string; suggestion: string; category: string }>(
      "proactive_suggestion",
      (event) => {
        const { suggestion, category } = event.payload;
        const categoryLabel: Record<string, string> = {
          error: "Error spotted", optimization: "Optimization", reminder: "Reminder", insight: "Insight",
        };
        notifications.add({
          type: category === "error" ? "warning" : "info",
          title: categoryLabel[category] ?? "BLADE suggests",
          message: suggestion.slice(0, 120),
          action: { label: "Ask Blade", callback: () => sendWithStats(suggestion) },
        });
        if (tts.enabled) tts.speak(suggestion.slice(0, 80));
        activity.track("message", "proactive_suggestion", suggestion.slice(0, 80));
      }
    );

    // Proactive action from the engine — high-confidence signal passed decision gate
    const unlistenProactiveAction = listen<{ id: string; action_type: string; trigger: string; content: string; confidence: number }>(
      "proactive_action",
      (event) => {
        const { action_type, content } = event.payload;
        notifications.add({
          type: "info",
          title: `BLADE: ${action_type.replace(/_/g, " ")}`,
          message: content.slice(0, 120),
          action: { label: "Discuss", callback: () => sendWithStats(content) },
        });
      }
    );

    // Smart interrupt — user stuck on same error for 5+ minutes
    const unlistenSmartInterrupt = listen<{ error_preview: string; elapsed_minutes: number; suggested_prompt: string }>(
      "smart_interrupt",
      (event) => {
        const { elapsed_minutes, suggested_prompt } = event.payload;
        notifications.add({
          type: "warning",
          title: `Stuck for ${elapsed_minutes}m — want help?`,
          message: "BLADE noticed the same error is still in your environment. Click to ask now.",
          action: {
            label: "Debug it",
            callback: () => {
              sendWithStats(suggested_prompt);
              setChatPanelOpen(true);
            },
          },
        });
      }
    );

    // Auto-title conversations after first exchange
    const unlistenTitled = listen<{ conversation_id: string; title: string }>(
      "conversation_titled",
      (event) => {
        chat.updateConversationTitle(event.payload.conversation_id, event.payload.title);
      }
    );

    return () => {
      unlisten.then((fn) => fn());
      unlistenBriefing.then((fn) => fn());
      unlistenReminderFired.then((fn) => fn());
      unlistenReminderCreated.then((fn) => fn());
      unlistenSkillLearned.then((fn) => fn());
      unlistenWatcher.then((fn) => fn());
      unlistenLevelUp.then((fn) => fn());
      unlistenAutoUpgraded.then((fn) => fn());
      unlistenEvolutionSuggestion.then((fn) => fn());
      unlistenWakeWord.then((fn) => fn());
      unlistenAutoskillInstalled.then((fn) => fn());
      unlistenAutoskillSuggestion.then((fn) => fn());
      unlistenBgAiDisabled.then((fn) => fn());
      unlistenShortcutFailed.then((fn) => fn());
      unlistenFallback.then((fn) => fn());
      unlistenMonitorOff.then((fn) => fn());
      unlistenSelfCode.then((fn) => fn());
      unlistenClipPrefetch.then((fn) => fn());
      unlistenDelegateApproved.then((fn) => fn());
      unlistenDelegateDenied.then((fn) => fn());
      unlistenSmartInterrupt.then((fn) => fn());
      unlistenTitled.then((fn) => fn());
      unlistenProactiveSuggestion.then((fn) => fn());
      unlistenProactiveAction.then((fn) => fn());
    };
  }, [tts.enabled]);

  // WHILE YOU WERE AWAY — digest of what happened when window was hidden
  useEffect(() => {
    let hiddenAt: number | null = null;

    const handleVisibility = () => {
      if (document.hidden) {
        hiddenAt = Math.floor(Date.now() / 1000);
      } else if (hiddenAt !== null) {
        const since = hiddenAt;
        hiddenAt = null;
        // Ask Blade what happened while we were away
        invoke<string | null>("pulse_get_digest", { hiddenSince: since })
          .then((digest) => {
            void digest;
          })
          .catch(() => {});
      }
    };

    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, []);

  // TRAY — handle tray menu events
  useEffect(() => {
    const unlistenScreenshot = listen("tray_screenshot_requested", () => {
      handleScreenshot();
    });
    const unlistenSettings = listen<string>("open_settings_tab", (event) => {
      setRoute("settings");
      // Could extend to pre-select a tab, but for now just opens settings
      void event;
    });
    return () => {
      unlistenScreenshot.then((fn) => fn());
      unlistenSettings.then((fn) => fn());
    };
  }, []);

  // COMPUTER USE — show step progress as notifications
  useEffect(() => {
    const unlistenStep = listen<{ step: number; action: Record<string, unknown>; status: string }>(
      "computer_use_step",
      (event) => {
        const { step, action } = event.payload;
        const kind = (action as { kind: string }).kind ?? "action";
        const desc = (action as { description?: string }).description ?? kind;
        notifications.add({
          type: "info",
          title: `Computer use — step ${step}`,
          message: desc,
        });
      }
    );
    const unlistenComplete = listen<{ success: boolean; result: string; steps: number }>(
      "computer_use_complete",
      (event) => {
        const { success, result, steps } = event.payload;
        notifications.add({
          type: success ? "success" : "error",
          title: `Computer use — ${success ? "done" : "stopped"} (${steps} steps)`,
          message: result,
        });
      }
    );
    return () => {
      unlistenStep.then((fn) => fn());
      unlistenComplete.then((fn) => fn());
    };
  }, []);

  // BACKGROUND AGENTS — notify when agents spawn/complete
  useEffect(() => {
    const unlistenSpawned = listen<{ id: string; agent_type: string; task: string }>(
      "agent_spawned",
      (event) => {
        const { agent_type, task } = event.payload;
        notifications.add({
          type: "info",
          title: `Agent spawned: ${agent_type}`,
          message: task.slice(0, 80),
          action: { label: "Watch", callback: () => openRoute("bg-agents") },
        });
        activity.track("message", `Background agent started`, `${agent_type}: ${task.slice(0, 60)}`);
      }
    );
    const unlistenComplete = listen<{ id: string; exit_code: number; status: string }>(
      "agent_complete",
      (event) => {
        const { status, exit_code } = event.payload;
        notifications.add({
          type: status === "completed" ? "success" : "error",
          title: status === "completed" ? "Agent finished" : "Agent failed",
          message: `Exit code ${exit_code}`,
          action: { label: "View output", callback: () => openRoute("bg-agents") },
        });
      }
    );
    return () => {
      unlistenSpawned.then((fn) => fn());
      unlistenComplete.then((fn) => fn());
    };
  }, []);

  // THREAD — load working memory state on startup + listen for updates
  useEffect(() => {
    invoke<{ title: string; content: string; project: string } | null>("blade_thread_get")
      .catch(() => {});
    const unlisten = listen<{ title: string; project: string }>("thread_updated", () => {
      // thread tracking is internal only; no banner displayed
    });
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  const hideWindow = useCallback(() => {
    getCurrentWindow().hide();
  }, []);

  const closePalette = useCallback(() => setPaletteOpen(false), []);

  const openRoute = useCallback((nextRoute: Route, intent?: { title: string; note: string }) => {
    setRoute(nextRoute);
    setWorkspaceIntent(intent ? { route: nextRoute, ...intent } : ROUTE_INTENT_LABELS[nextRoute] ? { route: nextRoute, ...ROUTE_INTENT_LABELS[nextRoute]! } : null);
  }, []);

  // Open the chat panel (toggle if already open when triggered from sidebar "Chat" item)
  const openChatPanel = useCallback(() => {
    setChatPanelOpen((prev) => !prev);
  }, []);

  const handleSlashCommand = useCallback((action: string) => {
    switch (action) {
      case "clear": chat.clearMessages(); break;
      case "new": chat.newConversation(); break;
      case "init": openRoute("init"); break;
      case "screenshot": invoke<string>("capture_screen").then((png) => chat.sendMessage("What's on my screen?", png)).catch(() => {}); break;
      case "voice": break; // handled by InputBar
      case "focus": setFocusMode(true); break;
      case "export": copyConversation(chat.messages, chat.currentConversation?.title); break;
      case "help": setShortcutHelpOpen(true); break;
      case "memory":
        chat.sendMessage("Search my memory and tell me the 5 most interesting things you know about me, my projects, and my recent work. Be specific.");
        break;
      case "research":
        chat.sendMessage("Enter deep research mode. For the next question I ask, break it into sub-questions, search each one thoroughly, then synthesize a comprehensive answer with sources.");
        break;
      case "think":
        chat.sendMessage("Think deeply and carefully about the last message in our conversation. Show your reasoning step by step before giving your final answer.");
        break;
      case "swarm":
        openRoute("agents");
        break;
      case "timeline":
        openRoute("screen-timeline");
        break;
    }
    activity.track("message", `Slash command: /${action}`, "");
  }, [chat, activity, openRoute]);

  const sendWithStats = useCallback((content: string, imageBase64?: string) => {
    recordMessage();
    activity.track("message", "Message sent", content.slice(0, 80));

    // Check for voice commands
    const cmd = voiceCommands.processTranscription(content);
    if (cmd && cmd.action !== "ask") {
      handleSlashCommand(cmd.action);
      return;
    }

    chat.sendMessage(content, imageBase64);
  }, [chat.sendMessage, recordMessage, activity, voiceCommands, handleSlashCommand]);

  // Keep voice send ref in sync so voice mode can call sendWithStats
  useEffect(() => { voiceSendRef.current = sendWithStats; }, [sendWithStats]);

  // Send a message and open the chat panel to show the conversation
  const sendToChatPanel = useCallback((text: string) => {
    sendWithStats(text);
    setChatPanelOpen(true);
  }, [sendWithStats]);

  const handleScreenshot = async () => {
    try {
      const png = await invoke<string>("capture_screen");
      chat.sendMessage("What's on my screen?", png);
      activity.track("screenshot", "Screenshot captured", "");
    } catch {
      // Screenshot failed
    }
  };

  // Chat panel keyboard shortcuts: Enter or / opens it, Escape closes it
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't hijack when typing in an input/textarea
      const target = e.target as HTMLElement;
      const inInput = target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;

      if (e.key === "Escape" && chatPanelOpen) {
        e.preventDefault();
        setChatPanelOpen(false);
        return;
      }

      if (!inInput && !paletteOpen && !chatPanelOpen) {
        if (e.key === "Enter" || e.key === "/") {
          e.preventDefault();
          setChatPanelOpen(true);
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [chatPanelOpen, paletteOpen]);

  // Keyboard shortcuts
  useKeyboard({
    onNewConversation: () => chat.newConversation(),
    onSettings: () => setRoute((r) => r === "settings" ? "dashboard" : "settings"),
    onToggleSidebar: () => setBranchOpen((p) => !p),
    onFocusInput: () => { setChatPanelOpen(true); setTimeout(() => inputRef.current?.focus(), 50); },
    onPalette: () => setPaletteOpen((p) => !p),
    onEscape: paletteOpen ? () => setPaletteOpen(false) : chatPanelOpen ? () => setChatPanelOpen(false) : shortcutHelpOpen ? () => setShortcutHelpOpen(false) : notificationsOpen ? () => setNotificationsOpen(false) : undefined,
    onHideWindow: hideWindow,
    onShortcutHelp: () => setShortcutHelpOpen((p) => !p),
    onFocusMode: () => setFocusMode((p) => !p),
  });

  const commands = [
    // ── Home ──────────────────────────────────────────────────────────────────
    { id: "dashboard", label: "Home", description: "Go to the dashboard overview", section: "Home", shortcut: "Ctrl+H", action: () => openRoute("dashboard") },
    { id: "chat", label: "Chat", description: "Open the chat panel", section: "Home", action: () => setChatPanelOpen((p) => !p) },
    { id: "new", label: "New conversation", description: "Start a fresh thread in chat", section: "Home", shortcut: "Ctrl+N", action: () => chat.newConversation() },
    { id: "clear", label: "Clear thread", description: "Remove messages from the current conversation", section: "Home", action: () => chat.clearMessages() },
    { id: "export", label: "Export conversation", description: "Copy the current conversation as Markdown", section: "Home", action: () => copyConversation(chat.messages, chat.currentConversation?.title) },
    { id: "branches", label: "Conversation branches", description: "Fork the conversation and explore alternate paths", section: "Home", shortcut: "Ctrl+B", action: () => setBranchOpen(true) },
    { id: "insights", label: "Conversation insights", description: "Surface metadata and patterns from the current thread", section: "Home", action: () => setInsightsOpen(true) },
    { id: "notifications", label: "Show notifications", description: "Review unread activity and alerts", section: "Home", action: () => setNotificationsOpen(true) },
    { id: "focus", label: "Focus mode", description: "Switch into the distraction-free chat view", section: "Home", shortcut: "Ctrl+F", action: () => setFocusMode(true) },
    { id: "pulse", label: "Pulse — what is Blade thinking?", description: "Trigger an unsolicited thought from Blade's background mind", section: "Home", action: () => invoke<string>("pulse_now").then((t) => { if (t) sendWithStats(t); }).catch(() => {}) },
    { id: "pulse-explain", label: "Explain last pulse", description: "Ask Blade to reveal the reasoning behind its last observation", section: "Home", action: () => invoke<string>("pulse_explain").then((e) => sendWithStats(`Explain your reasoning: ${e}`)).catch(() => {}) },

    // ── Work ──────────────────────────────────────────────────────────────────
    { id: "terminal", label: "Terminal", description: "Run commands and send output back into chat", section: "Work", action: () => openRoute("terminal") },
    { id: "git", label: "Git", description: "Inspect repository state and share it back to chat", section: "Work", action: () => openRoute("git") },
    { id: "files", label: "Files", description: "Inspect local files and feed context back into Blade", section: "Work", action: () => openRoute("files") },
    { id: "web-auto", label: "Browser automation", description: "Drive browser and scraping workflows", section: "Work", action: () => openRoute("web-auto") },
    { id: "canvas", label: "Canvas", description: "Sketch ideas visually and move them back into chat", section: "Work", action: () => openRoute("canvas") },
    { id: "workflows", label: "Workflow builder", description: "Turn repeated tasks into reusable flows", section: "Work", action: () => openRoute("workflows") },
    { id: "hive", label: "Hive Control Center", description: "Mission control for BLADE's distributed agent mesh", section: "Work", action: () => openRoute("hive") },
    { id: "rewind", label: "Rewind", description: "Scrub through your day — visual screenshot timeline", section: "Features", action: () => openRoute("rewind") },
    { id: "live-notes", label: "Live Notes", description: "Real-time meeting transcript and action items", section: "Features", action: () => openRoute("live-notes") },
    { id: "agent-factory", label: "Agent Factory", description: "Describe an agent in plain English and deploy it as a live Hive tentacle", section: "Work", action: () => openRoute("agent-factory") },
    { id: "agents", label: "Operator Center", description: "Launch the multi-runtime control plane", section: "Work", action: () => openRoute("agents") },
    { id: "agent-teams", label: "Agent teams", description: "Coordinate multi-role execution plans", section: "Work", action: () => openRoute("agent-teams") },
    { id: "bg-agents", label: "Background agents", description: "See Claude Code, Aider, Goose agents BLADE has spawned", section: "Work", action: () => openRoute("bg-agents") },
    { id: "swarm", label: "Agent swarm", description: "Launch parallel DAG-based agent orchestration", section: "Work", action: () => openRoute("swarm") },
    { id: "computer-use", label: "Computer use", description: "BLADE takes control: screenshots + clicks + types to complete a task", section: "Work", action: () => openRoute("computer-use") },
    { id: "computer-use-stop", label: "Stop computer use", description: "Halt any ongoing autonomous screen operation", section: "Work", action: () => { void invoke("computer_use_stop"); } },
    { id: "email", label: "Email workspace", description: "Read and draft email with Blade assistance", section: "Work", action: () => openRoute("email") },
    { id: "docs", label: "Document generator", description: "Generate longer-form structured drafts", section: "Work", action: () => openRoute("docs") },
    { id: "self-code", label: "JITRO — Blade codes itself", description: "Ask BLADE to add a feature to itself using Claude Code on its own source", section: "Work", action: () => { const f = prompt("What feature should BLADE add to itself?"); if (f) invoke("blade_self_code", { feature: f }).then(() => notifications.add({ type: "success", title: "BLADE is coding itself", message: `Claude Code is working on: ${f.slice(0, 60)}` })).catch((e: unknown) => notifications.add({ type: "error", title: "Self-code failed", message: String(e) })); } },
    { id: "skill-packs", label: "Skill packs", description: "Browse and install domain MCP tools for your active role", section: "Work", action: () => openRoute("skill-packs") },
    { id: "kali", label: "Kali workspace", description: "Security-focused Linux environment", section: "Work", action: () => openRoute("kali") },
    { id: "code-sandbox", label: "Code sandbox", description: "Isolated code execution environment", section: "Work", action: () => openRoute("code-sandbox") },
    { id: "screenshot", label: "Capture screen", description: "Send the current screen into chat for analysis", section: "Work", action: handleScreenshot },

    // ── Life ──────────────────────────────────────────────────────────────────
    { id: "health", label: "Health", description: "Screen time, break reminders, vitals", section: "Life", action: () => openRoute("health") },
    { id: "finance", label: "Finance", description: "View spending summary, categories, and recurring charges", section: "Life", action: () => openRoute("finance") },
    { id: "meetings", label: "Calendar", description: "Upcoming meetings and schedule", section: "Life", action: () => openRoute("meetings") },
    { id: "social-graph", label: "People", description: "Contacts, relationships, and communication history", section: "Life", action: () => openRoute("social-graph") },
    { id: "habits", label: "Habits", description: "Track routines and behavioral patterns", section: "Life", action: () => openRoute("habits") },
    { id: "goals", label: "Goals", description: "Long-term objectives and milestones", section: "Life", action: () => openRoute("goals") },
    { id: "emotional-intel", label: "Emotional intelligence", description: "Sentiment patterns and mood tracking", section: "Life", action: () => openRoute("emotional-intel") },
    { id: "predictions", label: "Predictions", description: "Forecast patterns from your data", section: "Life", action: () => openRoute("predictions") },
    { id: "decision-log", label: "Decision log", description: "Browse decisions BLADE has logged across conversations", section: "Life", action: () => openRoute("decision-log") },
    { id: "smart-home", label: "Smart Home", description: "Control IoT devices and Spotify via Home Assistant", section: "Life", action: () => openRoute("smart-home") },
    { id: "obsidian-daily", label: "Today's Obsidian note", description: "Create or open today's daily note in your vault", section: "Life", action: () => invoke("obsidian_ensure_daily_note").catch(() => {}) },
    { id: "obsidian-save", label: "Save to Obsidian", description: "Write a summary of this conversation to your vault", section: "Life", action: async () => {
      const msgs = chat.messages;
      if (!msgs.length) return;
      const title = chat.currentConversation?.title ?? `Conversation ${new Date().toLocaleDateString()}`;
      const summary = msgs.slice(-10).map((m) => `**${m.role}:** ${m.content.slice(0, 500)}`).join("\n\n");
      const id = chat.currentConversation?.id ?? "unknown";
      await invoke("obsidian_save_conversation", { title, summary, conversationId: id }).catch(() => {});
    }},

    // ── System (Settings + Security) ─────────────────────────────────────────
    { id: "security", label: "Security", description: "Audit permissions, secrets, and active tool access", section: "System", action: () => openRoute("security") },
    { id: "settings", label: "Settings", description: "Configure providers, memory, and Blade behavior", section: "System", shortcut: "Ctrl+,", action: () => openRoute("settings") },
    { id: "knowledge", label: "Knowledge base", description: "Search and reuse saved notes and context", section: "System", action: () => openRoute("knowledge") },
    { id: "character", label: "Character Bible", description: "Inspect Blade's learned identity and memory", section: "System", action: () => openRoute("character") },
    { id: "soul", label: "Blade's soul", description: "See who Blade has become through experience", section: "System", action: () => invoke<string>("blade_get_soul").then((s) => { if (s) sendWithStats(`Read your own self-characterization back to me:\n\n${s}`); else sendWithStats("You haven't developed a self-characterization yet. Use the app more and it will evolve."); }).catch(() => {}) },
    { id: "journal", label: "Blade's journal", description: "See what Blade has been writing about in its internal log", section: "System", action: () => invoke<string>("journal_get_recent", { days: 7 }).then((j) => { if (j) { sendWithStats(`Show me what you've written in your journal recently.\n\n${j}`); } else { sendWithStats("What have you been reflecting on lately? (Your journal is empty so far.)"); } }).catch(() => {}) },
    { id: "journal-write", label: "Write journal entry now", description: "Force Blade to write tonight's journal entry now", section: "System", action: () => { void invoke("journal_write_now").then(() => notifications.add({ type: "success", title: "Journal written", message: "Today's entry is ready" })).catch(() => {}); } },
    { id: "reports", label: "Capability reports", description: "Review what Blade could not do and why", section: "System", action: () => openRoute("reports") },
    { id: "analytics", label: "Analytics", description: "Inspect activity and usage trends", section: "System", action: () => openRoute("analytics") },
    { id: "activity", label: "Activity feed", description: "See recent events across the app", section: "System", action: () => openRoute("activity") },
    { id: "comparison", label: "Model comparison", description: "Inspect model behavior side by side", section: "System", action: () => openRoute("comparison") },
    { id: "temporal", label: "Temporal intelligence", description: "Replay what you were doing, detect work patterns, generate standups", section: "System", action: () => openRoute("temporal") },
    { id: "knowledge-graph", label: "Knowledge graph", description: "Visual entity-relationship map of your memory", section: "System", action: () => openRoute("knowledge-graph") },
    { id: "screen-timeline", label: "Screen timeline", description: "Visual history of your screen activity", section: "System", action: () => openRoute("screen-timeline") },
    { id: "integrations", label: "Integrations", description: "Manage Gmail, Calendar, Slack, and GitHub integration status", section: "System", action: () => openRoute("integrations") },
    { id: "deeplearn", label: "Deep Learn", description: "Re-run Blade's ingestion of your shell history, git, notes, and conversations", section: "System", action: () => openRoute("deeplearn") },
    { id: "sync", label: "Sync settings", description: "Inspect sync and persistence controls", section: "System", action: () => openRoute("sync") },
    { id: "diagnostics", label: "Diagnostics", description: "Inspect system status and troubleshooting data", section: "System", action: () => openRoute("diagnostics") },
    { id: "discovery", label: "Discovery scan", description: "Refresh local tooling and environment discovery", section: "System", action: () => openRoute("discovery") },
    { id: "health-panel", label: "System health panel", description: "Memory usage, background process status", section: "System", action: () => openRoute("health-panel") },
    { id: "sysprompt", label: "View system prompt", description: "Inspect the prompt Blade assembles behind the scenes", section: "System", action: () => setSystemPromptOpen(true) },
    { id: "templates", label: "Prompt templates", description: "Use a saved template as a starting point", section: "System", action: () => setTemplateManagerOpen(true) },
    { id: "themes", label: "Theme", description: "Adjust Blade's visual style", section: "System", action: () => setThemePickerOpen(true) },
    { id: "shortcuts", label: "Keyboard shortcuts", description: "Reveal the keyboard cheat sheet", section: "System", shortcut: "Ctrl+/", action: () => setShortcutHelpOpen(true) },
    { id: "tts", label: tts.enabled ? "Disable voice output" : "Enable voice output", description: "Toggle spoken responses", section: "System", action: tts.toggleEnabled },
    { id: "sound", label: sound.enabled ? "Disable notification sound" : "Enable notification sound", description: "Toggle Blade's audible alerts", section: "System", action: sound.toggleEnabled },
    { id: "init", label: "Re-run setup", description: "Reset onboarding and configure Blade from scratch", section: "System", action: () => openRoute("init") },
  ];

  if (focusMode && config?.onboarded) {
    return (
      <Suspense fallback={<ShellFallback label="Entering focus mode..." />}>
        <FocusMode
          messages={chat.messages}
          loading={chat.loading}
          onSend={sendWithStats}
          onExit={() => setFocusMode(false)}
        />
      </Suspense>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-blade-bg">
        <div className="w-2 h-2 rounded-full bg-blade-accent animate-pulse" />
      </div>
    );
  }

  if (!config?.onboarded) {
    return (
      <div className="h-screen flex flex-col bg-blade-bg text-blade-text">
        <TitleBar />
        <Suspense fallback={<ShellFallback label="Preparing Blade..." />}>
          <InitWizard onComplete={async () => {
            await loadConfig();
            setRoute("deeplearn"); // Mission zero: become the user
          }} />
        </Suspense>
      </div>
    );
  }

  // All workspaces — dashboard is the default home.
  // onBack goes to "dashboard"; onSendToChat opens the chat slide-out panel.
  const fullPageRoutes: Record<string, React.ReactNode> = {
    analytics: <Analytics onBack={() => openRoute("dashboard")} />,
    knowledge: <KnowledgeBase onBack={() => openRoute("dashboard")} onInsertToChat={(content) => { sendToChatPanel(content); openRoute("dashboard"); }} />,
    comparison: <ModelComparison onBack={() => openRoute("dashboard")} />,
    diagnostics: <Diagnostics onBack={() => openRoute("dashboard")} />,
    discovery: <Discovery onComplete={() => openRoute("dashboard")} onSkip={() => openRoute("dashboard")} />,
    agents: <OperatorCenter onBack={() => openRoute("dashboard")} onSendToChat={(text) => { sendToChatPanel(text); openRoute("dashboard"); }} runtimeCenter={runtimeCenter} defaultTab="mission" />,
    terminal: <Terminal onBack={() => openRoute("dashboard")} onSendToChat={(text) => { sendToChatPanel(text); openRoute("dashboard"); }} />,
    files: <FileBrowser onBack={() => openRoute("dashboard")} onSendToChat={(content, name) => { sendToChatPanel(`Analyze ${name}:\n\n\`\`\`\n${content.slice(0, 3000)}\n\`\`\``); openRoute("dashboard"); }} />,
    canvas: <Canvas onBack={() => openRoute("dashboard")} onSendToChat={(text) => { sendToChatPanel(text); openRoute("dashboard"); }} />,
    workflows: <WorkflowBuilder onBack={() => openRoute("dashboard")} onRunOutput={(output) => { sendToChatPanel(output); openRoute("dashboard"); }} />,
    activity: <ActivityFeed items={activity.items} onBack={() => openRoute("dashboard")} />,
    sync: <SyncSettings onBack={() => openRoute("dashboard")} />,
    "managed-agents": <OperatorCenter onBack={() => openRoute("dashboard")} onSendToChat={(text) => { sendToChatPanel(text); openRoute("dashboard"); }} runtimeCenter={runtimeCenter} defaultTab="managed" />,
    "email": <EmailAssistant onBack={() => openRoute("dashboard")} onSendToChat={(text) => { sendToChatPanel(text); openRoute("dashboard"); }} />,
    "docs": <DocumentGenerator onBack={() => openRoute("dashboard")} />,
    "web-auto": <WebAutomation onBack={() => openRoute("dashboard")} onSendToChat={(text) => { sendToChatPanel(text); openRoute("dashboard"); }} />,
    "agent-teams": <AgentTeamPanel onBack={() => openRoute("dashboard")} onSendToChat={(text) => { sendToChatPanel(text); openRoute("dashboard"); }} />,
    "git": <GitPanel onBack={() => openRoute("dashboard")} onSendToChat={(text) => { sendToChatPanel(text); openRoute("dashboard"); }} />,
    "character": <CharacterBible onBack={() => openRoute("dashboard")} />,
    "reports": <CapabilityReports onBack={() => openRoute("dashboard")} />,
    "init": <InitWizard onComplete={async () => { await loadConfig(); openRoute("deeplearn"); }} isReinit />,
    "deeplearn": (
      <DeepLearn
        onComplete={(summary) => {
          void summary;
          openRoute("dashboard");
        }}
        onSkip={() => openRoute("dashboard")}
      />
    ),
    "computer-use": <ComputerUsePanel onDismiss={() => openRoute("dashboard")} />,
    "bg-agents": <BackgroundAgentsPanel onBack={() => openRoute("dashboard")} onSendToChat={(text) => { sendToChatPanel(text); openRoute("dashboard"); }} />,
    "screen-timeline": <ScreenTimeline onBack={() => openRoute("dashboard")} />,
    "swarm": <SwarmView onBack={() => openRoute("dashboard")} />,
    "soul": <SoulView onBack={() => openRoute("dashboard")} />,
    "skill-packs": <SkillPackView onBack={() => openRoute("dashboard")} />,
    "goals": <GoalView onBack={() => openRoute("dashboard")} />,
    "kali": <KaliView onBack={() => openRoute("dashboard")} />,
    "agents-authority": <AgentDashboard onBack={() => openRoute("dashboard")} />,
    "accountability": <AccountabilityView onBack={() => openRoute("dashboard")} />,
    "sidecar": <SidecarView onBack={() => openRoute("dashboard")} />,
    "workflow-builder": <WorkflowBuilderView onBack={() => openRoute("dashboard")} />,
    "code-sandbox": <CodeSandboxView onBack={() => openRoute("dashboard")} />,
    "persona": <PersonaView onBack={() => openRoute("dashboard")} />,
    "negotiation": <NegotiationView onBack={() => openRoute("dashboard")} />,
    "financial": <FinancialView onBack={() => openRoute("dashboard")} />,
    "context-engine": <ContextEngineView onBack={() => openRoute("dashboard")} />,
    "reasoning": <ReasoningView onBack={() => openRoute("dashboard")} />,
    "social-graph": <SocialGraphView onBack={() => openRoute("dashboard")} />,
    "health": <HealthView onBack={() => openRoute("dashboard")} />,
    "documents": <DocumentView onBack={() => openRoute("dashboard")} />,
    "habits": <HabitView onBack={() => openRoute("dashboard")} />,
    "knowledge-graph": <KnowledgeGraphView onBack={() => openRoute("dashboard")} />,
    "meetings": <MeetingView onBack={() => openRoute("dashboard")} />,
    "predictions": <PredictionView onBack={() => openRoute("dashboard")} />,
    "emotional-intel": <EmotionalIntelligenceView onBack={() => openRoute("dashboard")} />,
    "decision-log": <DecisionLog onBack={() => openRoute("dashboard")} />,
    "security": <SecurityDashboard onBack={() => openRoute("dashboard")} />,
    "health-panel": <HealthPanel onBack={() => openRoute("dashboard")} />,
    "temporal": <TemporalPanel onBack={() => openRoute("dashboard")} />,
    "integrations": <IntegrationStatus onBack={() => openRoute("dashboard")} />,
    "smart-home": <SmartHomePanel onBack={() => openRoute("dashboard")} />,
    "finance": <FinanceView onBack={() => openRoute("dashboard")} />,
    "hive": <HiveView onBack={() => openRoute("dashboard")} />,
    "rewind": <RewindTimeline onBack={() => openRoute("dashboard")} />,
    "live-notes": <LiveNotes onBack={() => openRoute("dashboard")} />,
    "agent-factory": <AgentFactoryView onBack={() => openRoute("dashboard")} />,
  };

  // Resolve what to render in the main area
  const mainContent = route === "settings" ? (
    <Suspense fallback={<ShellFallback label="Loading settings..." />}>
      <Settings
        config={config}
        onBack={() => openRoute("dashboard")}
        onSaved={(nextConfig) => {
          setConfig(nextConfig);
          openRoute("dashboard");
        }}
        onConfigRefresh={loadConfig}
      />
    </Suspense>
  ) : (
    <>
      {workspaceIntent && workspaceIntent.route === route && (
        <div className="px-4 py-2 border-b border-blade-border/40 bg-blade-bg/90 shrink-0">
          <div className="max-w-5xl mx-auto flex items-start justify-between gap-4">
            <div>
              <div className="text-2xs uppercase tracking-[0.2em] text-blade-muted">Blade handoff</div>
              <div className="text-sm text-blade-secondary mt-1">{workspaceIntent.title}</div>
              <div className="text-2xs text-blade-muted mt-1">{workspaceIntent.note}</div>
            </div>
            <button
              onClick={() => setWorkspaceIntent(null)}
              className="text-2xs text-blade-muted hover:text-blade-secondary transition-colors"
            >
              dismiss
            </button>
          </div>
        </div>
      )}
      <Suspense fallback={<ShellFallback />}>
        <div key={route} className="route-enter flex-1 min-h-0 flex flex-col">
          {fullPageRoutes[route] ?? fullPageRoutes["dashboard"]}
        </div>
      </Suspense>
    </>
  );

  // Sidebar nav handler (for future sidebar integration)
  void chatPanelOpen; void setChatPanelOpen;

  return (
    <ToastProvider>
    <ErrorBoundary>
    <div className="h-screen flex flex-col bg-[#09090b] text-[#e4e4e7] relative overflow-hidden">
      {/* File drop overlay */}
      {isDragging && (
        <div className="absolute inset-0 z-50 bg-blade-bg/90 backdrop-blur-sm flex items-center justify-center border-2 border-dashed border-blade-accent/40 rounded-xl m-2 pointer-events-none animate-fade-in">
          <div className="text-center">
            <div className="w-12 h-12 rounded-xl bg-blade-accent-muted flex items-center justify-center mx-auto mb-3">
              <svg viewBox="0 0 24 24" className="w-6 h-6 text-blade-accent" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M12 5v14M5 12l7-7 7 7" />
              </svg>
            </div>
            <p className="text-sm text-blade-secondary">Drop file to analyze</p>
            <p className="text-2xs text-blade-muted mt-1">Images or text files</p>
          </div>
        </div>
      )}

      {/* Glow overlay — BLADE's visual heartbeat */}
      <GlowOverlay />
      {/* TitleBar is now embedded in Sidebar's logo row via drag region — keep for window controls */}
      <TitleBar />
      <CommandPalette commands={commands} open={paletteOpen} onClose={closePalette} />
      <Suspense fallback={null}>
        <ShortcutHelp open={shortcutHelpOpen} onClose={() => setShortcutHelpOpen(false)} />
        <SystemPromptPreview open={systemPromptOpen} onClose={() => setSystemPromptOpen(false)} />
        <TemplateManager open={templateManagerOpen} onClose={() => setTemplateManagerOpen(false)} onUseTemplate={(content: string) => { sendWithStats(content); setTemplateManagerOpen(false); }} />
        <ThemePicker open={themePickerOpen} onClose={() => setThemePickerOpen(false)} />
        <ConversationInsightsPanel messages={chat.messages} open={insightsOpen} onClose={() => setInsightsOpen(false)} />
        {chat.currentConversationId && (
          <BranchNavigator
            conversationId={chat.currentConversationId}
            open={branchOpen}
            onClose={() => setBranchOpen(false)}
            onBranchSwitch={(_messages) => {
              setBranchOpen(false);
            }}
          />
        )}
      </Suspense>
      <NotificationCenter
        open={notificationsOpen}
        onClose={() => setNotificationsOpen(false)}
        notifications={notifications.notifications}
        onMarkRead={notifications.markRead}
        onMarkAllRead={notifications.markAllRead}
        onDismiss={notifications.dismiss}
        onClearAll={notifications.clearAll}
        onAction={(r) => { openRoute(r as Route); setNotificationsOpen(false); }}
      />

      {/* ── Main content ── */}
      <div className="flex-1 min-h-0 flex flex-row overflow-hidden">
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
          {route === "dashboard" ? (
            <Dashboard
              activeRoute={route}
              onNavigate={(r) => openRoute(r as Route)}
              chatPanelProps={{
                messages: chat.messages,
                loading: chat.loading,
                error: chat.error,
                toolExecutions: chat.toolExecutions,
                clipboardText: chat.clipboardText,
                conversations: chat.conversations,
                currentConversationId: chat.currentConversationId,
                onSend: sendWithStats,
                onClear: chat.clearMessages,
                onNewConversation: chat.newConversation,
                onSwitchConversation: chat.switchConversation,
                onOpenSettings: () => openRoute("settings"),
                onDismissClipboard: chat.dismissClipboard,
                pendingApproval: chat.pendingApproval,
                onRespondApproval: chat.respondToApproval,
                onDeleteConversation: chat.deleteConversation,
                onUpdateConversationTitle: chat.updateConversationTitle,
                onRetry: chat.retryLastMessage,
                onSlashCommand: handleSlashCommand,
                provider: config?.provider,
                model: config?.model,
                streakDays: stats.streakDays,
                totalMessages: stats.totalMessages,
                lastResponseTime: chat.lastResponseTime,
                ttsEnabled: tts.enabled,
                ttsSpeaking: tts.speaking,
                onToggleTTS: tts.toggleEnabled,
                onStopTTS: tts.stop,
                activeWindow: contextAwareness.context.activeWindow,
                contextSuggestions: contextAwareness.context.suggestedActions,
                onOpenWorkspace: (workspace) => openRoute(workspace),
                runtimes: runtimeCenter.runtimes,
                onOpenOperators: () => openRoute("agents"),
                voiceDraft: voiceDraft,
                onVoiceDraftConsumed: () => setVoiceDraft(null),
                voiceModeStatus: voiceMode.status,
                voiceModeOnPttDown: voiceMode.onPttMouseDown,
                voiceModeOnPttUp: voiceMode.onPttMouseUp,
                thinkingText: chat.thinkingText,
                onOpenNotifications: () => setNotificationsOpen(true),
                unreadNotificationCount: notifications.unreadCount,
              }}
            />
          ) : route === "chat" ? (
            <ChatWindow
              messages={chat.messages}
              loading={chat.loading}
              error={chat.error}
              toolExecutions={chat.toolExecutions}
              clipboardText={chat.clipboardText}
              conversations={chat.conversations}
              currentConversationId={chat.currentConversationId}
              onSend={sendWithStats}
              onClear={chat.clearMessages}
              onNewConversation={chat.newConversation}
              onSwitchConversation={chat.switchConversation}
              onOpenSettings={() => openRoute("settings")}
              onDismissClipboard={chat.dismissClipboard}
              pendingApproval={chat.pendingApproval}
              onRespondApproval={chat.respondToApproval}
              onDeleteConversation={chat.deleteConversation}
              onUpdateConversationTitle={chat.updateConversationTitle}
              onRetry={chat.retryLastMessage}
              onSlashCommand={handleSlashCommand}
              provider={config?.provider}
              model={config?.model}
              streakDays={stats.streakDays}
              totalMessages={stats.totalMessages}
              lastResponseTime={chat.lastResponseTime}
              ttsEnabled={tts.enabled}
              ttsSpeaking={tts.speaking}
              onToggleTTS={tts.toggleEnabled}
              onStopTTS={tts.stop}
              activeWindow={contextAwareness.context.activeWindow}
              contextSuggestions={contextAwareness.context.suggestedActions}
              onOpenWorkspace={(workspace) => openRoute(workspace)}
              runtimes={runtimeCenter.runtimes}
              onOpenOperators={() => openRoute("agents")}
              voiceDraft={voiceDraft}
              onVoiceDraftConsumed={() => setVoiceDraft(null)}
              voiceModeStatus={voiceMode.status}
              voiceModeOnPttDown={voiceMode.onPttMouseDown}
              voiceModeOnPttUp={voiceMode.onPttMouseUp}
              thinkingText={chat.thinkingText}
              onOpenNotifications={() => setNotificationsOpen(true)}
              unreadNotificationCount={notifications.unreadCount}
            />
          ) : (
            <Suspense fallback={<div className="flex-1 flex items-center justify-center text-white/30">Loading...</div>}>
              <div className="flex-1 min-h-0 flex flex-col overflow-y-auto">
                {mainContent}
              </div>
            </Suspense>
          )}

        </div>
      </div>

      {/* ── Status bar — full width, bottom ── */}
      <StatusBar
        provider={config?.provider}
        model={config?.model}
        streakDays={stats.streakDays}
      />

      {/* ── VoiceOrb: PRIMARY input — always visible, wired to voice conversation ── */}
      <VoiceOrb
        status={voiceMode.status}
        mode={voiceMode.mode}
        onDismissError={voiceMode.stopEverything}
        conversationState={voiceConv.conversationState}
        isConversationActive={voiceConv.isActive}
        onStartConversation={voiceConv.startConversation}
        onStopConversation={voiceConv.stopConversation}
        onPttDown={voiceMode.onPttMouseDown}
        onPttUp={voiceMode.onPttMouseUp}
        onOpenChat={openChatPanel}
        lastResponse={lastOrbResponse}
        micVolume={voiceConv.micVolume}
      />

      {personaOnboardingOpen && (
        <OnboardingModal
          onComplete={() => setPersonaOnboardingOpen(false)}
        />
      )}
    </div>
    </ErrorBoundary>
    </ToastProvider>
  );
}
