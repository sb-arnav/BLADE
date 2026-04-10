import React, { Suspense, lazy, useCallback, useRef, useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { ActivityFeed, useActivityFeed } from "./components/ActivityFeed";
import { ChatWindow } from "./components/ChatWindow";
import { CommandPalette } from "./components/CommandPalette";
import { NotificationCenter, useNotifications } from "./components/NotificationCenter";
import { TitleBar } from "./components/TitleBar";
import { useChat } from "./hooks/useChat";
import { useTTS } from "./hooks/useTTS";
import { useKeyboard } from "./hooks/useKeyboard";
import { useNotificationSound } from "./hooks/useNotificationSound";
import { useStats } from "./hooks/useStats";
import { useFileDrop } from "./hooks/useFileDrop";
import { useContextAwareness } from "./hooks/useContextAwareness";
import { useProactiveMode } from "./hooks/useProactiveMode";
import { useVoiceCommands } from "./hooks/useVoiceCommands";
import { useRuntimes } from "./hooks/useRuntimes";
import { copyConversation } from "./utils/exportConversation";
import { BladeConfig } from "./types";

type Route = "chat" | "settings" | "discovery" | "diagnostics" | "analytics" | "knowledge" | "comparison" | "agents" | "terminal" | "files" | "canvas" | "workflows" | "activity" | "sync" | "managed-agents" | "email" | "docs" | "web-auto" | "agent-teams" | "git" | "character";

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
const Onboarding = lazy(() => import("./components/Onboarding").then((m) => ({ default: m.Onboarding })));
const Settings = lazy(() => import("./components/Settings").then((m) => ({ default: m.Settings })));
const SyncSettings = lazy(() => import("./components/SyncStatus").then((m) => ({ default: m.SyncSettings })));
const TemplateManager = lazy(() => import("./components/TemplateManager"));
const Terminal = lazy(() => import("./components/Terminal").then((m) => ({ default: m.Terminal })));
const ThemePicker = lazy(() => import("./components/ThemePicker").then((m) => ({ default: m.ThemePicker })));
const ShortcutHelp = lazy(() => import("./components/ShortcutHelp"));
const WorkflowBuilder = lazy(() => import("./components/WorkflowBuilder"));
const EmailAssistant = lazy(() => import("./components/EmailAssistant").then((m) => ({ default: m.EmailAssistant })));
const DocumentGenerator = lazy(() => import("./components/DocumentGenerator"));
const WebAutomation = lazy(() => import("./components/WebAutomation"));
const AgentTeamPanel = lazy(() => import("./components/AgentTeamPanel").then((m) => ({ default: m.AgentTeamPanel })));
const GitPanel = lazy(() => import("./components/GitPanel").then((m) => ({ default: m.GitPanel })));
const CharacterBible = lazy(() => import("./components/CharacterBible").then((m) => ({ default: m.CharacterBible })));

function ShellFallback({ label = "Loading workspace..." }: { label?: string }) {
  return (
    <div className="flex items-center justify-center h-full bg-blade-bg">
      <div className="text-center">
        <div className="w-2 h-2 rounded-full bg-blade-accent animate-pulse mx-auto" />
        <p className="text-2xs text-blade-muted mt-3">{label}</p>
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
  const [route, setRoute] = useState<Route>("chat");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutHelpOpen, setShortcutHelpOpen] = useState(false);
  const [systemPromptOpen, setSystemPromptOpen] = useState(false);
  const [templateManagerOpen, setTemplateManagerOpen] = useState(false);
  const [themePickerOpen, setThemePickerOpen] = useState(false);
  const [insightsOpen, setInsightsOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [workspaceIntent, setWorkspaceIntent] = useState<{ route: Route; title: string; note: string } | null>(null);
  const chat = useChat();
  const tts = useTTS(chat.messages, chat.loading);
  const sound = useNotificationSound(chat.loading);
  const { stats, recordMessage } = useStats();
  const notifications = useNotifications();
  const activity = useActivityFeed();
  const contextAwareness = useContextAwareness();
  const proactive = useProactiveMode();
  const voiceCommands = useVoiceCommands();
  const runtimeCenter = useRuntimes();
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

  // Auto-focus input when window becomes visible
  useEffect(() => {
    const unlisten = listen("tauri://focus", () => {
      setTimeout(() => inputRef.current?.focus(), 50);
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

  // Handle proactive suggestions
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

  const hideWindow = useCallback(() => {
    getCurrentWindow().hide();
  }, []);

  const closePalette = useCallback(() => setPaletteOpen(false), []);

  const openRoute = useCallback((nextRoute: Route, intent?: { title: string; note: string }) => {
    setRoute(nextRoute);
    setWorkspaceIntent(intent ? { route: nextRoute, ...intent } : ROUTE_INTENT_LABELS[nextRoute] ? { route: nextRoute, ...ROUTE_INTENT_LABELS[nextRoute]! } : null);
  }, []);

  const handleSlashCommand = useCallback((action: string) => {
    switch (action) {
      case "clear": chat.clearMessages(); break;
      case "new": chat.newConversation(); break;
      case "screenshot": invoke<string>("capture_screen").then((png) => chat.sendMessage("What's on my screen?", png)).catch(() => {}); break;
      case "voice": break; // handled by InputBar
      case "focus": setFocusMode(true); break;
      case "export": copyConversation(chat.messages, chat.currentConversation?.title); break;
      case "help": setShortcutHelpOpen(true); break;
    }
    activity.track("message", `Slash command: /${action}`, "");
  }, [chat, activity]);

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

  const handleScreenshot = async () => {
    try {
      const png = await invoke<string>("capture_screen");
      chat.sendMessage("What's on my screen?", png);
      activity.track("screenshot", "Screenshot captured", "");
    } catch {
      // Screenshot failed
    }
  };

  // Keyboard shortcuts
  useKeyboard({
    onNewConversation: () => chat.newConversation(),
    onSettings: () => setRoute((r) => r === "settings" ? "chat" : "settings"),
    onToggleSidebar: undefined,
    onFocusInput: () => inputRef.current?.focus(),
    onPalette: () => setPaletteOpen((p) => !p),
    onEscape: paletteOpen ? () => setPaletteOpen(false) : shortcutHelpOpen ? () => setShortcutHelpOpen(false) : notificationsOpen ? () => setNotificationsOpen(false) : undefined,
    onHideWindow: hideWindow,
    onShortcutHelp: () => setShortcutHelpOpen((p) => !p),
    onFocusMode: () => setFocusMode((p) => !p),
  });

  const commands = [
    { id: "new", label: "Blade: start a new conversation  Ctrl+N", action: () => chat.newConversation() },
    { id: "clear", label: "Blade: clear this thread", action: () => chat.clearMessages() },
    { id: "screenshot", label: "Blade: capture my screen", action: handleScreenshot },
    { id: "tts", label: tts.enabled ? "Blade: disable voice output" : "Blade: enable voice output", action: tts.toggleEnabled },
    { id: "sound", label: sound.enabled ? "Blade: disable notification sound" : "Blade: enable notification sound", action: sound.toggleEnabled },
    { id: "export", label: "Blade: export conversation to clipboard", action: () => copyConversation(chat.messages, chat.currentConversation?.title) },
    { id: "settings", label: "Blade: open settings  Ctrl+,", action: () => openRoute("settings") },
    { id: "templates", label: "Blade: open prompt templates", action: () => setTemplateManagerOpen(true) },
    { id: "themes", label: "Blade: change theme", action: () => setThemePickerOpen(true) },
    { id: "insights", label: "Blade: show conversation insights", action: () => setInsightsOpen(true) },
    { id: "canvas", label: "Blade: open canvas workspace", action: () => openRoute("canvas") },
    { id: "workflows", label: "Blade: open workflow builder", action: () => openRoute("workflows") },
    { id: "analytics", label: "Blade: open analytics", action: () => openRoute("analytics") },
    { id: "activity", label: "Blade: show activity feed", action: () => openRoute("activity") },
    { id: "knowledge", label: "Blade: open knowledge base", action: () => openRoute("knowledge") },
    { id: "comparison", label: "Blade: compare models", action: () => openRoute("comparison") },
    { id: "diagnostics", label: "Blade: view diagnostics", action: () => openRoute("diagnostics") },
    { id: "discovery", label: "Blade: run discovery scan", action: () => openRoute("discovery") },
    { id: "focus", label: "Blade: enter focus mode  Ctrl+F", action: () => setFocusMode(true) },
    { id: "sysprompt", label: "Blade: view system prompt", action: () => setSystemPromptOpen(true) },
    { id: "shortcuts", label: "Blade: show keyboard shortcuts  Ctrl+/", action: () => setShortcutHelpOpen(true) },
    { id: "agents", label: "Blade: open operator center", action: () => openRoute("agents") },
    { id: "managed-agents", label: "Blade: open operator center (Claude focus)", action: () => openRoute("managed-agents") },
    { id: "terminal", label: "Blade: open terminal workspace", action: () => openRoute("terminal") },
    { id: "files", label: "Blade: open file workspace", action: () => openRoute("files") },
    { id: "email", label: "Blade: open email workspace", action: () => openRoute("email") },
    { id: "docs", label: "Blade: open document workspace", action: () => openRoute("docs") },
    { id: "web-auto", label: "Blade: open web automation", action: () => openRoute("web-auto") },
    { id: "agent-teams", label: "Blade: open agent teams", action: () => openRoute("agent-teams") },
    { id: "git", label: "Blade: open git workspace", action: () => openRoute("git") },
    { id: "character", label: "Blade: open Character Bible", action: () => openRoute("character") },
    { id: "sync", label: "Blade: open sync settings", action: () => openRoute("sync") },
    { id: "notifications", label: "Blade: show notifications", action: () => setNotificationsOpen(true) },
    { id: "chat", label: "Blade: return to chat", action: () => openRoute("chat") },
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
          <Onboarding onComplete={async () => {
            await loadConfig();
            setRoute("discovery");
          }} />
        </Suspense>
      </div>
    );
  }

  // Full-page routes
  const fullPageRoutes: Record<string, React.ReactNode> = {
    analytics: <Analytics onBack={() => openRoute("chat")} />,
    knowledge: <KnowledgeBase onBack={() => openRoute("chat")} onInsertToChat={(content) => { sendWithStats(content); openRoute("chat"); }} />,
    comparison: <ModelComparison onBack={() => openRoute("chat")} />,
    diagnostics: <Diagnostics onBack={() => openRoute("chat")} />,
    discovery: <Discovery onComplete={() => openRoute("chat")} onSkip={() => openRoute("chat")} />,
    agents: <OperatorCenter onBack={() => openRoute("chat")} onSendToChat={(text) => { sendWithStats(text); openRoute("chat"); }} runtimeCenter={runtimeCenter} defaultTab="mission" />,
    terminal: <Terminal onBack={() => openRoute("chat")} onSendToChat={(text) => { sendWithStats(text); openRoute("chat"); }} />,
    files: <FileBrowser onBack={() => openRoute("chat")} onSendToChat={(content, name) => { sendWithStats(`Analyze ${name}:\n\n\`\`\`\n${content.slice(0, 3000)}\n\`\`\``); openRoute("chat"); }} />,
    canvas: <Canvas onBack={() => openRoute("chat")} onSendToChat={(text) => { sendWithStats(text); openRoute("chat"); }} />,
    workflows: <WorkflowBuilder onBack={() => openRoute("chat")} onRunOutput={(output) => { sendWithStats(output); openRoute("chat"); }} />,
    activity: <ActivityFeed items={activity.items} onBack={() => openRoute("chat")} />,
    sync: <SyncSettings onBack={() => openRoute("chat")} />,
    "managed-agents": <OperatorCenter onBack={() => openRoute("chat")} onSendToChat={(text) => { sendWithStats(text); openRoute("chat"); }} runtimeCenter={runtimeCenter} defaultTab="managed" />,
    "email": <EmailAssistant onBack={() => openRoute("chat")} onSendToChat={(text) => { sendWithStats(text); openRoute("chat"); }} />,
    "docs": <DocumentGenerator onBack={() => openRoute("chat")} />,
    "web-auto": <WebAutomation onBack={() => openRoute("chat")} onSendToChat={(text) => { sendWithStats(text); openRoute("chat"); }} />,
    "agent-teams": <AgentTeamPanel onBack={() => openRoute("chat")} onSendToChat={(text) => { sendWithStats(text); openRoute("chat"); }} />,
    "git": <GitPanel onBack={() => openRoute("chat")} onSendToChat={(text) => { sendWithStats(text); openRoute("chat"); }} />,
    "character": <CharacterBible onBack={() => openRoute("chat")} />,
  };

  if (route !== "chat" && route !== "settings" && fullPageRoutes[route]) {
    return (
        <div className="h-screen flex flex-col bg-blade-bg text-blade-text">
        <TitleBar />
        {workspaceIntent && workspaceIntent.route === route ? (
          <div className="px-4 py-2 border-b border-blade-border/40 bg-blade-bg/90">
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
        ) : null}
        <Suspense fallback={<ShellFallback />}>
          {fullPageRoutes[route]}
        </Suspense>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-blade-bg text-blade-text relative">
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
      <TitleBar />
      <CommandPalette commands={commands} open={paletteOpen} onClose={closePalette} />
      <Suspense fallback={null}>
        <ShortcutHelp open={shortcutHelpOpen} onClose={() => setShortcutHelpOpen(false)} />
        <SystemPromptPreview open={systemPromptOpen} onClose={() => setSystemPromptOpen(false)} />
        <TemplateManager open={templateManagerOpen} onClose={() => setTemplateManagerOpen(false)} onUseTemplate={(content: string) => { sendWithStats(content); setTemplateManagerOpen(false); }} />
        <ThemePicker open={themePickerOpen} onClose={() => setThemePickerOpen(false)} />
        <ConversationInsightsPanel messages={chat.messages} open={insightsOpen} onClose={() => setInsightsOpen(false)} />
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
      <div className="flex-1 min-h-0">
        <Suspense fallback={<ShellFallback label={route === "settings" ? "Loading settings..." : "Loading Blade..."} />}>
          {route === "settings" ? (
            <Settings
              config={config}
              onBack={() => openRoute("chat")}
              onSaved={(nextConfig) => {
                setConfig(nextConfig);
                openRoute("chat");
              }}
              onConfigRefresh={loadConfig}
            />
          ) : (
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
              onRetry={chat.retryLastMessage}
              onSlashCommand={handleSlashCommand}
              provider={config?.provider}
              streakDays={stats.streakDays}
              totalMessages={stats.totalMessages}
              lastResponseTime={chat.lastResponseTime}
              model={config?.model}
              ttsEnabled={tts.enabled}
              ttsSpeaking={tts.speaking}
              onToggleTTS={tts.toggleEnabled}
              onStopTTS={tts.stop}
              activeWindow={contextAwareness.context.activeWindow}
              contextSuggestions={contextAwareness.context.suggestedActions}
              onOpenWorkspace={(workspace) => openRoute(workspace)}
              runtimes={runtimeCenter.runtimes}
              onOpenOperators={() => openRoute("agents")}
            />
          )}
        </Suspense>
      </div>
    </div>
  );
}
