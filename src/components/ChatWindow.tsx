import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ConversationSummary, Message, RuntimeDescriptor, ToolApprovalRequest, ToolExecution } from "../types";
import { ActiveWindowInfo, ContextSuggestion } from "../hooks/useContextAwareness";
import { detectClipboardType } from "../utils/clipboardDetect";
import { copyConversation } from "../utils/exportConversation";
import { MessageList } from "./MessageList";
import { InputBar } from "./InputBar";
import { SearchInput } from "./SearchInput";
import { ToolApprovalDialog } from "./ToolApprovalDialog";
import { InsightsBar } from "./InsightsBar";
import { useVoiceConversation } from "../hooks/useVoiceConversation";

interface Props {
  messages: Message[];
  loading: boolean;
  error: string | null;
  toolExecutions: ToolExecution[];
  clipboardText: string | null;
  conversations: ConversationSummary[];
  currentConversationId: string | null;
  onSend: (message: string, imageBase64?: string) => void;
  onClear: () => void;
  onNewConversation: () => void | Promise<void>;
  onSwitchConversation: (conversationId: string) => void | Promise<void>;
  onOpenSettings: () => void;
  onDismissClipboard: () => void;
  pendingApproval: ToolApprovalRequest | null;
  onRespondApproval: (approved: boolean) => void;
  onDeleteConversation: (id: string) => void;
  onUpdateConversationTitle?: (id: string, title: string) => void;
  onRetry: () => void;
  onSlashCommand?: (action: string) => void;
  provider?: string;
  model?: string;
  streakDays?: number;
  totalMessages?: number;
  lastResponseTime?: number | null;
  ttsEnabled: boolean;
  ttsSpeaking: boolean;
  onToggleTTS: () => void;
  onStopTTS: () => void;
  activeWindow?: ActiveWindowInfo | null;
  contextSuggestions?: ContextSuggestion[];
  onOpenWorkspace?: (workspace: "terminal" | "files" | "canvas" | "workflows" | "agents") => void;
  runtimes?: RuntimeDescriptor[];
  onOpenOperators?: () => void;
  voiceDraft?: string | null;
  onVoiceDraftConsumed?: () => void;
  voiceModeStatus?: string;
  voiceModeOnPttDown?: () => void;
  voiceModeOnPttUp?: () => void;
  thinkingText?: string | null;
  onOpenNotifications?: () => void;
  unreadNotificationCount?: number;
}

// ─── Context Ribbon ──────────────────────────────────────────────────────────

interface ContextRibbonProps {
  provider: string | null;
  model: string | null;
  perceptionState: string | null;
  godModeOn: boolean;
  memoryCount: number | null;
  toolCount: number | null;
  lastResponseTime: number | null | undefined;
  onOpenSettings: () => void;
}

function ContextRibbon({
  provider,
  model,
  perceptionState,
  godModeOn,
  memoryCount,
  toolCount,
  lastResponseTime,
  onOpenSettings,
}: ContextRibbonProps) {
  const modelShort = model
    ? model.split("/").pop()?.split("-").slice(0, 3).join("-") ?? model
    : null;

  return (
    <div className="flex items-center justify-between px-3 py-1 border-b border-blade-border/20 bg-blade-bg/30 shrink-0 min-h-[1.75rem] gap-2">
      {/* Left: model + provider */}
      <button
        onClick={onOpenSettings}
        className="flex items-center gap-1.5 text-blade-muted/40 hover:text-blade-muted/80 transition-all duration-200 min-w-0 group"
        title="Open settings"
      >
        <svg viewBox="0 0 24 24" className="w-2.5 h-2.5 shrink-0 opacity-50 group-hover:opacity-80" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="3" />
          <path d="M12 2v3M12 19v3M4.22 4.22l2.12 2.12M17.66 17.66l2.12 2.12M2 12h3M19 12h3M4.22 19.78l2.12-2.12M17.66 6.34l2.12-2.12" />
        </svg>
        <span className="text-[0.65rem] font-mono truncate max-w-[140px]">
          {provider && modelShort
            ? `${provider} / ${modelShort}`
            : provider ?? modelShort ?? "no model"}
        </span>
        {lastResponseTime != null && (
          <span className="text-blade-muted/25 text-[0.6rem] font-mono shrink-0">
            {lastResponseTime < 1000 ? `${lastResponseTime}ms` : `${(lastResponseTime / 1000).toFixed(1)}s`}
          </span>
        )}
      </button>

      {/* Center: perception / god mode */}
      {godModeOn && perceptionState && (
        <div className="flex items-center gap-1.5 text-emerald-400/50 text-[0.6rem] font-mono shrink-0 px-2 py-0.5 rounded-full bg-emerald-500/5 border border-emerald-500/10">
          <span className="w-1 h-1 rounded-full bg-emerald-400/60 animate-pulse" />
          <span className="truncate max-w-[120px]">{perceptionState}</span>
        </div>
      )}

      {/* Right: memory + tool count */}
      <div className="flex items-center gap-2.5 text-blade-muted/30 text-[0.6rem] font-mono shrink-0">
        {memoryCount != null && (
          <span title="Memories" className="flex items-center gap-1">
            <span className="text-blade-muted/20">◈</span>
            {memoryCount}
          </span>
        )}
        {toolCount != null && toolCount > 0 && (
          <span title="Available tools" className="flex items-center gap-1">
            <span className="text-blade-muted/20">⬡</span>
            {toolCount}
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Error Card ───────────────────────────────────────────────────────────────

function classifyError(error: string): "provider" | "config" | "network" | "generic" {
  const e = error.toLowerCase();
  if (e.includes("api key") || e.includes("authentication") || e.includes("unauthorized") || e.includes("401")) return "config";
  if (e.includes("rate limit") || e.includes("quota") || e.includes("overloaded") || e.includes("502") || e.includes("503")) return "provider";
  if (e.includes("network") || e.includes("connection") || e.includes("timeout") || e.includes("fetch")) return "network";
  return "generic";
}

interface ErrorCardProps {
  error: string;
  onRetry: () => void;
  onOpenSettings: () => void;
}

function ErrorCard({ error, onRetry, onOpenSettings }: ErrorCardProps) {
  const kind = classifyError(error);
  return (
    <div className="mx-3 mt-2.5 mb-1 rounded-xl border border-red-500/15 bg-red-500/5 animate-fade-up overflow-hidden">
      <div className="flex items-start gap-2.5 px-3 py-2.5">
        <div className="shrink-0 mt-0.5 w-4 h-4 rounded-full bg-red-500/12 flex items-center justify-center">
          <svg viewBox="0 0 24 24" className="w-2.5 h-2.5 text-red-400" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M12 9v4M12 17h.01" />
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[0.7rem] font-semibold text-red-400/90 mb-0.5">
            {kind === "provider" ? "Provider error" :
             kind === "config" ? "Configuration error" :
             kind === "network" ? "Network error" :
             "Something went wrong"}
          </p>
          <p className="text-2xs text-red-400/60 break-words whitespace-pre-wrap leading-relaxed line-clamp-3" title={error}>
            {error}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-1.5 px-3 pb-2.5">
        <button
          onClick={onRetry}
          className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 text-2xs font-medium transition-colors"
        >
          <svg viewBox="0 0 24 24" className="w-2.5 h-2.5" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M1 4v6h6M23 20v-6h-6" />
            <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10M23 14l-4.64 4.36A9 9 0 0 1 3.51 15" />
          </svg>
          Retry
        </button>
        {(kind === "provider" || kind === "config") && (
          <button
            onClick={onOpenSettings}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-blade-surface hover:bg-blade-surface-hover text-blade-muted hover:text-blade-secondary text-2xs font-medium transition-colors border border-blade-border"
          >
            {kind === "config" ? (
              <>
                <svg viewBox="0 0 24 24" className="w-2.5 h-2.5" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="3" />
                  <path d="M12 2v3M12 19v3M4.22 4.22l2.12 2.12M17.66 17.66l2.12 2.12M2 12h3M19 12h3" />
                </svg>
                Open Settings
              </>
            ) : (
              <>
                <svg viewBox="0 0 24 24" className="w-2.5 h-2.5" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="15 3 21 3 21 9" />
                  <path d="M10 14L21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                </svg>
                Switch Model
              </>
            )}
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Welcome Tour ─────────────────────────────────────────────────────────────

const TOUR_STEPS = [
  {
    title: "Talk to BLADE like a person",
    body: "This is your chat. Ask BLADE to write code, search the web, manage files, or just think through a problem with you. It knows your context.",
    cta: "Got it",
  },
  {
    title: "Ctrl+K opens everything",
    body: "The command palette gives you instant access to every BLADE feature — panels, actions, settings, and more. Try it anytime.",
    cta: "Nice",
  },
  {
    title: "Enable God Mode for ambient intelligence",
    body: "God Mode watches your screen in the background and quietly builds context. Open Settings to turn it on and unlock the Intelligence Brief.",
    cta: "Let's go",
  },
] as const;

// ─────────────────────────────────────────────────────────────────────────────

function formatTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function ChatWindow({
  messages,
  loading,
  error,
  toolExecutions,
  clipboardText,
  conversations,
  currentConversationId,
  onSend,
  onClear,
  onNewConversation,
  onSwitchConversation,
  onOpenSettings,
  onDismissClipboard,
  pendingApproval,
  onRespondApproval,
  onDeleteConversation,
  onUpdateConversationTitle,
  onRetry,
  onSlashCommand,
  provider,
  model,
  streakDays,
  totalMessages,
  lastResponseTime,
  ttsEnabled,
  ttsSpeaking,
  onToggleTTS,
  onStopTTS,
  activeWindow,
  contextSuggestions,
  runtimes,
  onOpenOperators,
  voiceDraft,
  onVoiceDraftConsumed,
  voiceModeStatus,
  voiceModeOnPttDown,
  voiceModeOnPttUp,
  thinkingText,
  onOpenNotifications,
  unreadNotificationCount,
}: Props) {
  const [search, setSearch] = useState("");
  const [composerDraft, setComposerDraft] = useState<string | null>(null);
  const [godModeStatus, setGodModeStatus] = useState<{ bytes: number; tier: string } | null>(null);

  // Welcome tour — show once after onboarding
  const [tourStep, setTourStep] = useState<number>(() => {
    try {
      return localStorage.getItem("blade_tour_complete") ? -1 : 0;
    } catch {
      return -1;
    }
  });

  function advanceTour() {
    const next = tourStep + 1;
    if (next >= TOUR_STEPS.length) {
      setTourStep(-1);
      try { localStorage.setItem("blade_tour_complete", "1"); } catch {}
    } else {
      setTourStep(next);
    }
  }

  function dismissTour() {
    setTourStep(-1);
    try { localStorage.setItem("blade_tour_complete", "1"); } catch {}
  }
  const godModeFadeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [thinkingExpanded, setThinkingExpanded] = useState(false);
  const renameInputRef = useRef<HTMLInputElement>(null);

  // Live routing — updated by chat_routing event from Rust
  const [liveRouting, setLiveRouting] = useState<{ provider: string; model: string } | null>(null);
  // Live tool executing — name of the currently-executing tool (for typing indicator)
  const [activeToolName, setActiveToolName] = useState<string | null>(null);
  // Context ribbon counts — loaded once and kept fresh
  const [memoryCount, setMemoryCount] = useState<number | null>(null);
  const [toolCount, setToolCount] = useState<number | null>(null);
  // God Mode perception state
  const [perceptionState, setPerceptionState] = useState<string | null>(null);

  // Phase 6 — conversational voice mode
  const {
    conversationState,
    transcript: voiceTranscript,
    isActive: voiceConvActive,
    startConversation,
    stopConversation,
  } = useVoiceConversation();

  const startRename = useCallback((conv: ConversationSummary, e: React.MouseEvent) => {
    e.stopPropagation();
    setRenamingId(conv.id);
    setRenameValue(conv.title || "");
    requestAnimationFrame(() => {
      requestAnimationFrame(() => renameInputRef.current?.select());
    });
  }, []);

  const commitRename = useCallback((id: string) => {
    const title = renameValue.trim();
    if (title && title.length <= 80) {
      invoke("history_rename_conversation", { conversationId: id, title }).catch(() => {});
      onUpdateConversationTitle?.(id, title);
    }
    setRenamingId(null);
  }, [renameValue, onUpdateConversationTitle]);

  const filteredConversations = useMemo(() => {
    if (!search.trim()) return conversations;
    const q = search.toLowerCase();
    return conversations.filter((c) => (c.title || "").toLowerCase().includes(q));
  }, [conversations, search]);

  // Group conversations by recency when not searching
  const groupedConversations = useMemo(() => {
    if (search.trim()) return [{ label: null as string | null, items: filteredConversations }];
    const now = Date.now();
    const todayStart   = new Date(); todayStart.setHours(0,0,0,0);
    const yesterdayStart = new Date(todayStart); yesterdayStart.setDate(yesterdayStart.getDate() - 1);
    const weekStart    = new Date(todayStart); weekStart.setDate(weekStart.getDate() - 7);

    const today: typeof conversations = [];
    const yesterday: typeof conversations = [];
    const thisWeek: typeof conversations = [];
    const older: typeof conversations = [];

    for (const c of filteredConversations) {
      const ts = c.updated_at > 1e10 ? c.updated_at : c.updated_at * 1000; // handle both ms and s
      if (ts >= todayStart.getTime()) today.push(c);
      else if (ts >= yesterdayStart.getTime()) yesterday.push(c);
      else if (ts >= weekStart.getTime()) thisWeek.push(c);
      else older.push(c);
    }
    void now;

    return [
      { label: "Today" as string | null, items: today },
      { label: "Yesterday" as string | null, items: yesterday },
      { label: "This week" as string | null, items: thisWeek },
      { label: "Older" as string | null, items: older },
    ].filter((g) => g.items.length > 0);
  }, [filteredConversations, search]);

  // Merge external voice draft into composer draft
  useEffect(() => {
    if (voiceDraft) {
      setComposerDraft(voiceDraft);
      onVoiceDraftConsumed?.();
    }
  }, [voiceDraft, onVoiceDraftConsumed]);

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [exportCopied, setExportCopied] = useState(false);
  const [showInsightsBar, setShowInsightsBar] = useState(false);

  const handleExportConversation = useCallback(async () => {
    const currentConv = conversations.find((c) => c.id === currentConversationId);
    await copyConversation(messages, currentConv?.title);
    setExportCopied(true);
    setTimeout(() => setExportCopied(false), 1800);
  }, [messages, conversations, currentConversationId]);

  const toggleSidebar = (open: boolean) => {
    setSidebarOpen(open);
    try { localStorage.setItem("blade-sidebar", open ? "open" : "closed"); } catch {}
  };

  // GOD MODE — listen for context update events and show a brief status badge
  useEffect(() => {
    const unlisten = listen<{ bytes: number; tier: string }>("godmode_update", (event) => {
      setGodModeStatus(event.payload);
      if (godModeFadeTimer.current) clearTimeout(godModeFadeTimer.current);
      godModeFadeTimer.current = setTimeout(() => setGodModeStatus(null), 8000);
    });
    return () => {
      unlisten.then((fn) => fn());
      if (godModeFadeTimer.current) clearTimeout(godModeFadeTimer.current);
    };
  }, []);

  // Live routing — update ribbon when chat_routing fires
  useEffect(() => {
    const unlisten = listen<{ provider: string; model: string }>("chat_routing", (e) => {
      setLiveRouting(e.payload);
    });
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  // Track the name of the currently-executing tool for the typing indicator
  useEffect(() => {
    const unlistenExec = listen<{ name: string }>("tool_executing", (e) => {
      setActiveToolName(e.payload.name);
    });
    const unlistenDone = listen<{ name: string }>("tool_completed", () => {
      setActiveToolName(null);
    });
    return () => {
      unlistenExec.then((fn) => fn());
      unlistenDone.then((fn) => fn());
    };
  }, []);

  // Clear activeToolName when loading stops
  useEffect(() => {
    if (!loading) setActiveToolName(null);
  }, [loading]);

  // Load memory + tool counts for the context ribbon
  useEffect(() => {
    invoke<{ id: string }[]>("brain_get_memories", { limit: 9999 })
      .then((m) => setMemoryCount(m.length))
      .catch(() => {});
    invoke<{ name: string }[]>("mcp_get_tools")
      .then((t) => setToolCount(t.length))
      .catch(() => {});
  }, []);

  // Godmode perception label (e.g. active window + duration)
  useEffect(() => {
    if (!activeWindow) { setPerceptionState(null); return; }
    const appName = activeWindow.title?.trim() || activeWindow.process_name?.trim() || null;
    if (appName) setPerceptionState(appName);
  }, [activeWindow]);

  const clipboardDetection = useMemo(
    () => clipboardText ? detectClipboardType(clipboardText) : null,
    [clipboardText]
  );

  const TYPE_ICONS: Record<string, string> = {
    code: "{ }",
    error: "!",
    url: "🔗",
    json: "{ }",
    command: "$",
    text: "T",
  };
  const runtimeStrip = (runtimes ?? []).slice(0, 4);

  return (
    <div className="flex h-full bg-blade-bg text-blade-text">
      {/* Welcome tour overlay */}
      {tourStep >= 0 && tourStep < TOUR_STEPS.length && (
        <div className="fixed inset-0 z-50 flex items-end justify-center pb-24 pointer-events-none">
          <div
            className="pointer-events-auto mx-4 max-w-sm w-full rounded-2xl border border-blade-accent/30 bg-blade-surface shadow-xl shadow-black/40 animate-fade-in"
            style={{ animation: "fadeInUp 0.25s ease" }}
          >
            <style>{`@keyframes fadeInUp { from { opacity:0; transform:translateY(12px) } to { opacity:1; transform:translateY(0) } }`}</style>
            <div className="flex items-center justify-between px-4 pt-4 pb-1">
              <div className="flex items-center gap-2">
                <span className="text-blade-accent text-xs font-mono font-semibold">
                  {tourStep + 1}/{TOUR_STEPS.length}
                </span>
                <span className="text-sm font-semibold text-blade-text">
                  {TOUR_STEPS[tourStep].title}
                </span>
              </div>
              <button
                onClick={dismissTour}
                className="text-blade-muted hover:text-blade-secondary transition-colors text-xs"
                aria-label="Dismiss tour"
              >
                <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>
            <p className="px-4 pb-3 text-xs text-blade-secondary leading-relaxed">
              {TOUR_STEPS[tourStep].body}
            </p>
            <div className="flex items-center justify-between px-4 pb-4">
              <div className="flex gap-1">
                {TOUR_STEPS.map((_, i) => (
                  <span
                    key={i}
                    className={`w-1.5 h-1.5 rounded-full transition-colors ${i === tourStep ? "bg-blade-accent" : "bg-blade-border"}`}
                  />
                ))}
              </div>
              <button
                onClick={advanceTour}
                className="px-4 py-1.5 rounded-lg bg-blade-accent/15 border border-blade-accent/40 text-xs font-semibold text-blade-accent hover:bg-blade-accent/25 transition-colors"
              >
                {TOUR_STEPS[tourStep].cta}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Sidebar overlay */}
      {sidebarOpen && (
        <div
          className="fixed left-0 right-0 bottom-0 z-30 bg-black/60 backdrop-blur-sm transition-opacity"
          style={{ top: "2.25rem" }}
          onClick={() => toggleSidebar(false)}
        />
      )}

      {/* Sidebar */}
      <div
        className={`fixed left-0 bottom-0 z-40 w-56 bg-blade-surface/98 backdrop-blur-xl border-r border-blade-border/50 flex flex-col shadow-surface-xl transition-transform duration-200 ease-out ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
        style={{ top: "2.25rem" }}
      >
        <div className="flex items-center justify-between px-3 py-2.5 border-b border-blade-border/40">
          <span className="text-2xs font-semibold tracking-[0.2em] uppercase text-blade-muted/50">History</span>
          <div className="flex items-center gap-1">
            {messages.length > 0 && (
              <button
                onClick={handleExportConversation}
                className="w-6 h-6 rounded-md flex items-center justify-center text-blade-muted/50 hover:text-blade-secondary hover:bg-blade-surface-hover transition-all duration-150"
                title={exportCopied ? "Copied!" : "Copy conversation as markdown"}
              >
                {exportCopied ? (
                  <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 text-blade-accent" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M20 6L9 17l-5-5" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="9" y="9" width="13" height="13" rx="2" />
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                  </svg>
                )}
              </button>
            )}
            <button
              onClick={() => { onNewConversation(); toggleSidebar(false); }}
              className="w-6 h-6 rounded-md flex items-center justify-center text-blade-muted/50 hover:text-blade-secondary hover:bg-blade-surface-hover transition-all duration-150"
              title="New conversation"
            >
              <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 5v14M5 12h14" />
              </svg>
            </button>
          </div>
        </div>
        <div className="px-2 pb-1.5">
          <SearchInput value={search} onChange={setSearch} placeholder="Search conversations…" />
        </div>
        <div className="flex-1 overflow-y-auto px-1.5 pb-2">
          {groupedConversations.map((group) => (
            <div key={group.label ?? "results"}>
              {group.label && (
                <div className="px-2.5 pt-3.5 pb-1 text-3xs font-semibold uppercase tracking-[0.25em] text-blade-muted/35">
                  {group.label}
                </div>
              )}
              {group.items.map((conv) => {
                const isActive = conv.id === currentConversationId;
                const convTitle = conv.title || "New conversation";
                const convPreviewLines = [
                  conv.message_count ? `${conv.message_count} messages` : null,
                  `Last active ${formatTime(conv.updated_at)}`,
                ].filter(Boolean).join(" · ");
                return (
                  <div
                    key={conv.id}
                    className={`group relative rounded-lg px-2.5 py-2 mb-0.5 cursor-pointer transition-all duration-150 ${
                      isActive
                        ? "bg-blade-accent/10 border-l-2 border-blade-accent text-blade-text pl-2"
                        : "border-l-2 border-transparent text-blade-secondary hover:bg-blade-surface-hover hover:text-blade-text"
                    }`}
                    onClick={() => { if (renamingId !== conv.id) { onSwitchConversation(conv.id); toggleSidebar(false); } }}
                  >
                    {/* Hover preview tooltip */}
                    {renamingId !== conv.id && (
                      <div className="pointer-events-none absolute left-full top-0 ml-2 z-50 w-48 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                        <div className="bg-blade-surface/98 backdrop-blur-xl border border-blade-border rounded-lg px-3 py-2.5 shadow-surface-lg">
                          <p className="text-2xs font-semibold text-blade-text leading-tight line-clamp-2">{convTitle}</p>
                          {convPreviewLines && (
                            <p className="text-2xs text-blade-muted/50 mt-1 leading-relaxed">{convPreviewLines}</p>
                          )}
                        </div>
                      </div>
                    )}
                    {renamingId === conv.id ? (
                      <input
                        ref={renameInputRef}
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onBlur={() => commitRename(conv.id)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") commitRename(conv.id);
                          if (e.key === "Escape") setRenamingId(null);
                        }}
                        className="w-full text-xs bg-blade-bg border border-blade-accent/40 rounded-md px-1.5 py-0.5 outline-none text-blade-text focus:border-blade-accent/60 focus:shadow-inner-focus transition-all"
                        onClick={(e) => e.stopPropagation()}
                        autoFocus
                      />
                    ) : (
                      <p
                        className="text-xs truncate leading-tight"
                        onDoubleClick={(e) => startRename(conv, e)}
                        title="Double-click to rename"
                      >
                        {convTitle}
                      </p>
                    )}
                    <div className="flex items-center justify-between mt-0.5">
                      <span className={`text-2xs ${isActive ? "text-blade-muted/60" : "text-blade-muted/40"}`}>
                        {formatTime(conv.updated_at)}
                        {conv.message_count ? <span className="ml-1.5 opacity-50">{conv.message_count}m</span> : null}
                      </span>
                      {conversations.length > 1 && renamingId !== conv.id && (
                        <span
                          onClick={(e) => { e.stopPropagation(); onDeleteConversation(conv.id); }}
                          className="text-2xs text-blade-muted/30 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all cursor-pointer"
                        >
                          ×
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        <div className="border-t border-blade-border/40 px-3 py-2.5 space-y-1">
          {(streakDays || totalMessages) ? (
            <div className="flex items-center gap-3 text-2xs text-blade-muted/40 py-0.5 font-mono">
              {streakDays ? <span>{streakDays}d</span> : null}
              {totalMessages ? <span>{totalMessages} msgs</span> : null}
            </div>
          ) : null}
          <button
            onClick={() => { onOpenSettings(); toggleSidebar(false); }}
            className="flex items-center gap-2 text-xs text-blade-muted/50 hover:text-blade-secondary transition-all duration-150 py-1 w-full rounded-md px-1 hover:bg-blade-surface-hover"
          >
            <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 opacity-70" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="3" />
              <path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83" />
            </svg>
            Settings
          </button>
        </div>
      </div>

      {/* Main + optional InsightsBar */}
      <div className="flex flex-1 min-w-0 overflow-hidden">
      <div className="flex flex-col flex-1 min-w-0">
        {/* Header */}
        <div className="flex items-center justify-between h-10 px-3 border-b border-blade-border/30 bg-blade-bg/60 backdrop-blur-sm shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <button
              onClick={() => toggleSidebar(true)}
              className="text-blade-muted/50 hover:text-blade-secondary transition-all duration-150 shrink-0 hover:bg-blade-surface w-7 h-7 rounded-md flex items-center justify-center"
              aria-label="History"
            >
              <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M3.5 7h17M3.5 12h17M3.5 17h17" />
              </svg>
            </button>
            <span className="text-xs text-blade-secondary/80 truncate max-w-[150px] font-medium">
              {conversations.find((c) => c.id === currentConversationId)?.title ?? "New conversation"}
            </span>
            {provider && (
              <button
                onClick={onOpenSettings}
                className="text-2xs text-blade-muted/40 bg-blade-surface/60 px-2 py-0.5 rounded-md font-mono shrink-0 hover:text-blade-muted hover:bg-blade-surface hover:border-blade-border/60 border border-blade-border/20 transition-all duration-150"
                title="Open provider and model settings"
              >
                {provider}{model ? ` · ${model.split("/").pop()?.split("-").slice(0, 2).join("-")}` : ""}
                {lastResponseTime != null && (
                  <span className="text-blade-muted/25 ml-1.5">
                    {lastResponseTime < 1000 ? `${lastResponseTime}ms` : `${(lastResponseTime / 1000).toFixed(1)}s`}
                  </span>
                )}
              </button>
            )}
          </div>
          <div className="flex items-center gap-0.5">
            {/* InsightsBar toggle */}
            <button
              onClick={() => setShowInsightsBar((v) => !v)}
              className={`h-7 px-2 rounded-md text-2xs flex items-center gap-1.5 transition-all duration-150 ${
                showInsightsBar
                  ? "text-blade-accent bg-blade-accent/10 border border-blade-accent/20"
                  : "text-blade-muted/50 hover:text-blade-secondary hover:bg-blade-surface border border-transparent"
              }`}
              title={showInsightsBar ? "Hide Intel bar" : "Show Intel bar"}
            >
              <span style={{ fontSize: "10px" }}>◧</span>
              <span className="font-medium tracking-wide">Intel</span>
            </button>
            {/* Runtime status indicator */}
            {runtimeStrip.length > 0 && onOpenOperators && (
              <button
                onClick={onOpenOperators}
                className="relative h-7 px-2 rounded-md text-2xs flex items-center gap-1.5 text-blade-muted/50 hover:text-blade-secondary hover:bg-blade-surface transition-all duration-150"
                title="Operators"
              >
                {(() => {
                  const hasIssue = runtimeStrip.some(r => !r.installed || !r.authenticated);
                  const activeTasks = runtimeStrip.reduce((s, r) => s + r.active_tasks, 0);
                  if (activeTasks > 0) return <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />;
                  if (hasIssue) return <span className="w-1.5 h-1.5 rounded-full bg-amber-400/80" />;
                  return <span className="w-1.5 h-1.5 rounded-full bg-blade-muted/30" />;
                })()}
                <span className="font-mono">ops</span>
                {runtimeStrip.reduce((s, r) => s + r.active_tasks, 0) > 0 && (
                  <span className="text-emerald-400">{runtimeStrip.reduce((s, r) => s + r.active_tasks, 0)}</span>
                )}
              </button>
            )}
            {/* Voice status pill — only when active */}
            {voiceModeStatus && !["idle", "off"].includes(voiceModeStatus) && (
              <span className={`h-7 px-2.5 rounded-md text-2xs flex items-center gap-1.5 border font-medium ${
                voiceModeStatus === "listening"  ? "text-emerald-400 bg-emerald-400/10 border-emerald-500/20" :
                voiceModeStatus === "recording" || voiceModeStatus === "detecting" ? "text-red-400 bg-red-500/10 border-red-500/20" :
                voiceModeStatus === "processing" ? "text-amber-400 bg-amber-500/10 border-amber-500/20" :
                voiceModeStatus === "error"      ? "text-red-500 bg-red-500/10 border-red-500/20" :
                "text-blade-muted border-transparent"
              }`}>
                <span className={`w-1.5 h-1.5 rounded-full ${
                  voiceModeStatus === "listening"  ? "bg-emerald-400 animate-pulse" :
                  voiceModeStatus === "recording" || voiceModeStatus === "detecting" ? "bg-red-400 animate-pulse" :
                  voiceModeStatus === "processing" ? "bg-amber-400 animate-pulse" :
                  "bg-blade-muted/50"
                }`} />
                {voiceModeStatus}
              </span>
            )}
            {onOpenNotifications && (
              <button
                onClick={onOpenNotifications}
                className="relative w-7 h-7 rounded-md flex items-center justify-center text-blade-muted/50 hover:text-blade-secondary hover:bg-blade-surface transition-all duration-150"
                title="Notifications"
              >
                <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0" />
                </svg>
                {(unreadNotificationCount ?? 0) > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-blade-accent text-white text-[8px] font-bold flex items-center justify-center leading-none shadow-glow-accent-sm">
                    {unreadNotificationCount! > 9 ? "9+" : unreadNotificationCount}
                  </span>
                )}
              </button>
            )}
            {/* Voice conversation button */}
            <button
              onClick={voiceConvActive ? stopConversation : () => { startConversation(); }}
              className={`w-7 h-7 rounded-md flex items-center justify-center transition-all duration-150 ${
                voiceConvActive
                  ? "text-emerald-400 bg-emerald-400/10 hover:bg-emerald-400/15 border border-emerald-500/20"
                  : "text-blade-muted/50 hover:text-blade-secondary hover:bg-blade-surface border border-transparent"
              }`}
              title={voiceConvActive ? "Stop voice conversation" : "Start voice conversation"}
            >
              {conversationState === "speaking" ? (
                <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                  <line x1="12" y1="19" x2="12" y2="23" />
                  <line x1="8" y1="23" x2="16" y2="23" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" className={`w-3.5 h-3.5 ${conversationState === "listening" ? "animate-pulse" : ""}`} fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                  <line x1="12" y1="19" x2="12" y2="23" />
                  <line x1="8" y1="23" x2="16" y2="23" />
                </svg>
              )}
            </button>
            <button
              onClick={ttsSpeaking ? onStopTTS : onToggleTTS}
              className={`w-7 h-7 rounded-md flex items-center justify-center transition-all duration-150 ${
                ttsEnabled
                  ? "text-blade-accent bg-blade-accent/10 hover:bg-blade-accent/15"
                  : "text-blade-muted/50 hover:text-blade-secondary hover:bg-blade-surface"
              }`}
              title={ttsEnabled ? (ttsSpeaking ? "Stop speaking" : "TTS on — click to disable") : "Enable TTS"}
            >
              {ttsSpeaking ? (
                <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <rect x="6" y="4" width="4" height="16" rx="1" />
                  <rect x="14" y="4" width="4" height="16" rx="1" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                  {ttsEnabled && <path d="M15.54 8.46a5 5 0 0 1 0 7.07M19.07 4.93a10 10 0 0 1 0 14.14" />}
                </svg>
              )}
            </button>
            <button
              onClick={onClear}
              className="h-7 px-2 rounded-md text-2xs text-blade-muted/40 hover:text-blade-secondary hover:bg-blade-surface transition-all duration-150 font-mono"
            >
              clr
            </button>
            <button
              onClick={onOpenSettings}
              className="w-7 h-7 rounded-md text-blade-muted/50 hover:text-blade-secondary hover:bg-blade-surface transition-all duration-150 flex items-center justify-center"
              aria-label="Settings"
            >
              <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.8">
                <circle cx="12" cy="12" r="3" />
                <path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83" />
              </svg>
            </button>
          </div>
        </div>

        {/* Context ribbon */}
        <ContextRibbon
          provider={liveRouting?.provider ?? provider ?? null}
          model={liveRouting?.model ?? model ?? null}
          perceptionState={perceptionState}
          godModeOn={!!activeWindow}
          memoryCount={memoryCount}
          toolCount={toolCount}
          lastResponseTime={lastResponseTime}
          onOpenSettings={onOpenSettings}
        />

        {/* Error card — actionable, not just red text */}
        {error && (
          <ErrorCard
            error={error}
            onRetry={onRetry}
            onOpenSettings={onOpenSettings}
          />
        )}

        <MessageList
          messages={messages}
          loading={loading}
          toolExecutions={toolExecutions}
          onQuickAction={setComposerDraft}
          onRetry={!loading ? onRetry : undefined}
          activeWindow={activeWindow}
          contextSuggestions={contextSuggestions}
          activeToolName={activeToolName}
        />

        {/* Smart clipboard bar */}
        {clipboardDetection && !loading && (
          <div className="mx-3 mb-2 px-3 py-2.5 rounded-xl bg-blade-surface/80 border border-blade-border/50 animate-fade-up backdrop-blur-sm shadow-surface-sm">
            <div className="flex items-center gap-2">
              <span className="text-2xs font-mono text-blade-accent/70 shrink-0 w-5 text-center font-semibold">
                {TYPE_ICONS[clipboardDetection.type] ?? "T"}
              </span>
              <span className="text-2xs text-blade-muted/70 truncate flex-1" title={clipboardDetection.preview}>
                <span className="text-blade-secondary/50 uppercase tracking-[0.12em] mr-1.5 text-[9px]">{clipboardDetection.type}</span>
                {clipboardDetection.preview}
              </span>
              <button
                onClick={onDismissClipboard}
                className="text-blade-muted/40 hover:text-blade-secondary transition-all duration-150 shrink-0 hover:bg-blade-surface-hover rounded p-0.5"
              >
                <svg viewBox="0 0 24 24" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>
            <div className="flex items-center gap-1.5 mt-2">
              {clipboardDetection.actions.map((action) => (
                <button
                  key={action.label}
                  onClick={() => { onSend(action.prompt); onDismissClipboard(); }}
                  className="text-2xs px-2.5 py-1 rounded-lg bg-blade-surface-hover border border-blade-border/50 text-blade-secondary hover:text-blade-text hover:border-blade-accent/30 transition-all duration-150 font-medium"
                >
                  {action.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Extended thinking indicator — shown when Claude is reasoning */}
        {thinkingText && loading && (
          <div className="mx-3 mb-2 px-3 py-2.5 rounded-xl border border-blade-accent/15 bg-blade-accent/5 backdrop-blur-sm shadow-surface-sm">
            <div className="flex items-start gap-2.5">
              <div className="shrink-0 mt-1 w-1.5 h-1.5 rounded-full bg-blade-accent/70 animate-pulse-subtle" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <p className="text-2xs font-semibold text-blade-accent/60 uppercase tracking-[0.15em]">Thinking</p>
                  {thinkingText.length > 200 && (
                    <button
                      onClick={() => setThinkingExpanded((e) => !e)}
                      className="text-2xs text-blade-accent/40 hover:text-blade-accent/70 transition-all duration-150 font-mono"
                    >
                      {thinkingExpanded ? "collapse ↑" : `+${thinkingText.length - 200} chars ↓`}
                    </button>
                  )}
                </div>
                <p className={`text-2xs text-blade-muted/60 leading-relaxed font-mono ${thinkingExpanded ? "" : "line-clamp-2"}`}>
                  {thinkingExpanded ? thinkingText : thinkingText.slice(-200)}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* God Mode indicator — appears briefly after each context refresh */}
        {godModeStatus && (
          <div className="flex items-center gap-2 px-3 py-1.5 mx-3 mb-1.5 rounded-lg border border-emerald-500/15 bg-emerald-500/5 text-emerald-400/60 font-mono text-2xs tracking-widest uppercase animate-fade-up">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400/60 animate-pulse" />
            <span className="font-semibold">GOD MODE</span>
            <span className="text-emerald-400/30 mx-0.5">·</span>
            <span className="opacity-80">{godModeStatus.tier}</span>
            <span className="text-emerald-400/30 mx-0.5">·</span>
            <span>{(godModeStatus.bytes / 1024).toFixed(1)}KB</span>
          </div>
        )}

        <InputBar
          onSend={onSend}
          onSlashCommand={onSlashCommand}
          disabled={loading}
          loading={loading}
          draftValue={composerDraft}
          onDraftConsumed={() => setComposerDraft(null)}
          onPttMouseDown={voiceModeOnPttDown}
          onPttMouseUp={voiceModeOnPttUp}
          modelLabel={
            liveRouting
              ? `${liveRouting.provider} / ${liveRouting.model.split("/").pop()}`
              : model
              ? `${provider ?? ""} / ${model.split("/").pop()}`
              : null
          }
          suggestions={contextSuggestions}
          clipboardText={clipboardText}
        />
      </div>

      {/* InsightsBar — collapsible intelligence sidebar */}
      {showInsightsBar && (
        <InsightsBar onNavigate={(route) => {
          // Best-effort: try to use the onOpenSettings callback as a fallback
          // route navigation is handled by the parent (App.tsx) in production
          void route;
          onOpenSettings();
        }} />
      )}
      </div>

      {pendingApproval && (
        <ToolApprovalDialog request={pendingApproval} onRespond={onRespondApproval} />
      )}

      {/* Voice Conversation Overlay — shown when conversational mode is active */}
      {voiceConvActive && (
        <div
          className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-blade-bg/96 backdrop-blur-xl"
          style={{ top: "2.25rem" }}
        >
          {/* Card */}
          <div className="flex flex-col items-center gap-5 px-8 py-8 rounded-2xl bg-blade-surface/80 border border-blade-border/60 shadow-surface-xl backdrop-blur-sm">
            <p className="text-2xs font-semibold uppercase tracking-[0.3em] text-blade-muted/50">
              Voice Conversation
            </p>

            {/* Waveform */}
            <div className="flex items-end gap-1.5 h-12">
              {Array.from({ length: 9 }).map((_, i) => (
                <div
                  key={i}
                  className={`w-1 rounded-full transition-colors duration-300 ${
                    conversationState === "listening"  ? "bg-emerald-400/80"
                    : conversationState === "thinking" ? "bg-amber-400/80"
                    : conversationState === "speaking" ? "bg-blade-accent/90"
                    : "bg-blade-muted/20"
                  }`}
                  style={{
                    height: conversationState === "listening"
                      ? `${14 + Math.sin(i * 1.4) * 10}px`
                      : conversationState === "thinking"
                      ? `${8 + ((i % 3) * 7)}px`
                      : conversationState === "speaking"
                      ? `${12 + Math.abs(Math.sin(i * 0.9)) * 22}px`
                      : "6px",
                    animation: conversationState !== "idle"
                      ? `voice-bar-${(i % 3) + 1} ${0.7 + (i % 3) * 0.1}s ease-in-out infinite alternate`
                      : "none",
                    animationDelay: `${i * 0.08}s`,
                  }}
                />
              ))}
            </div>

            {/* State label */}
            <p className={`text-sm font-semibold tracking-widest uppercase ${
              conversationState === "listening" ? "text-emerald-400"
              : conversationState === "thinking" ? "text-amber-400"
              : conversationState === "speaking" ? "text-blade-accent"
              : "text-blade-muted/60"
            }`}>
              {conversationState === "listening" && "Listening"}
              {conversationState === "thinking"  && "Thinking"}
              {conversationState === "speaking"  && "Speaking"}
              {(!conversationState || conversationState === "idle") && "Ready"}
            </p>
          </div>

          {/* Recent transcript — last 4 turns */}
          {voiceTranscript.length > 0 && (
            <div className="w-full max-w-xs mt-4 mb-2 space-y-1.5 max-h-40 overflow-y-auto px-1">
              {voiceTranscript.slice(-4).map((turn, i) => (
                <div
                  key={i}
                  className={`px-3 py-2 rounded-xl text-xs leading-relaxed animate-fade-up ${
                    turn.role === "user"
                      ? "bg-blade-surface/80 text-blade-secondary ml-6 border border-blade-border/40"
                      : "bg-blade-accent/10 text-blade-text mr-6 border border-blade-accent/15"
                  }`}
                >
                  <span className={`text-3xs uppercase tracking-[0.15em] font-bold mr-1.5 ${
                    turn.role === "user" ? "text-blade-muted/40" : "text-blade-accent/50"
                  }`}>
                    {turn.role === "user" ? "You" : "BLADE"}
                  </span>
                  {turn.text}
                </div>
              ))}
            </div>
          )}

          {/* Stop button */}
          <button
            onClick={stopConversation}
            className="mt-4 flex items-center gap-2 px-5 py-2.5 rounded-xl bg-blade-surface/80 border border-blade-border/60 text-blade-secondary hover:text-blade-text hover:bg-blade-surface-hover hover:border-red-400/30 transition-all duration-200 text-xs font-medium shadow-surface-sm"
          >
            <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="currentColor">
              <rect x="4" y="4" width="16" height="16" rx="3" />
            </svg>
            Stop conversation
          </button>

          <p className="mt-3 text-2xs text-blade-muted/30">
            Say "stop", "bye", or "that's all" to end naturally
          </p>
        </div>
      )}
    </div>
  );
}
