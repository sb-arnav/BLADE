import { useMemo, useRef, useState } from "react";
import { ConversationSummary, Message, ToolApprovalRequest, ToolExecution } from "../types";
import { detectClipboardType } from "../utils/clipboardDetect";
import { MessageList } from "./MessageList";
import { InputBar } from "./InputBar";
import { SearchInput } from "./SearchInput";
import { ToolApprovalDialog } from "./ToolApprovalDialog";

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
  onRetry: () => void;
  provider?: string;
  model?: string;
  streakDays?: number;
  totalMessages?: number;
  lastResponseTime?: number | null;
  ttsEnabled: boolean;
  ttsSpeaking: boolean;
  onToggleTTS: () => void;
  onStopTTS: () => void;
}

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
  onRetry,
  provider,
  model,
  streakDays,
  totalMessages,
  lastResponseTime,
  ttsEnabled,
  ttsSpeaking,
  onToggleTTS,
  onStopTTS,
}: Props) {
  const [search, setSearch] = useState("");
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const titleInputRef = useRef<HTMLInputElement>(null);

  const filteredConversations = useMemo(() => {
    if (!search.trim()) return conversations;
    const q = search.toLowerCase();
    return conversations.filter((c) => (c.title || "").toLowerCase().includes(q));
  }, [conversations, search]);

  const [sidebarOpen, setSidebarOpen] = useState(() => {
    try { return localStorage.getItem("blade-sidebar") === "open"; } catch { return false; }
  });

  const toggleSidebar = (open: boolean) => {
    setSidebarOpen(open);
    try { localStorage.setItem("blade-sidebar", open ? "open" : "closed"); } catch {}
  };

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

  return (
    <div className="flex h-full bg-blade-bg text-blade-text">
      {/* Sidebar overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 backdrop-blur-[2px] transition-opacity"
          onClick={() => toggleSidebar(false)}
        />
      )}

      {/* Sidebar */}
      <div
        className={`fixed inset-y-0 left-0 z-40 w-60 bg-blade-surface border-r border-blade-border flex flex-col transition-transform duration-200 ease-out ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
        style={{ top: "2.25rem" }}
      >
        <div className="flex items-center justify-between px-3 py-2.5">
          <span className="text-2xs font-medium tracking-widest uppercase text-blade-muted">History</span>
          <button
            onClick={() => { onNewConversation(); toggleSidebar(false); }}
            className="w-6 h-6 rounded-md flex items-center justify-center text-blade-muted hover:text-blade-secondary hover:bg-blade-surface-hover transition-colors"
            title="New conversation"
          >
            <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
        </div>
        <div className="px-2 pb-1.5">
          <SearchInput value={search} onChange={setSearch} placeholder="Search conversations…" />
        </div>
        <div className="flex-1 overflow-y-auto px-1.5 pb-2">
          {filteredConversations.map((conv) => {
            const isActive = conv.id === currentConversationId;
            return (
              <button
                key={conv.id}
                onClick={() => { onSwitchConversation(conv.id); toggleSidebar(false); }}
                className={`group w-full text-left rounded-lg px-2.5 py-2 mb-0.5 transition-colors ${
                  isActive
                    ? "bg-blade-accent-muted text-blade-text"
                    : "text-blade-secondary hover:bg-blade-surface-hover hover:text-blade-text"
                }`}
              >
                <p className="text-xs truncate">{conv.title || "New conversation"}</p>
                <div className="flex items-center justify-between mt-0.5">
                  <span className="text-2xs text-blade-muted">{formatTime(conv.updated_at)}</span>
                  {conversations.length > 1 && (
                    <span
                      onClick={(e) => { e.stopPropagation(); onDeleteConversation(conv.id); }}
                      className="text-2xs text-blade-muted hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all cursor-pointer"
                    >
                      delete
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
        <div className="border-t border-blade-border px-3 py-2 space-y-1">
          {(streakDays || totalMessages) ? (
            <div className="flex items-center gap-3 text-2xs text-blade-muted/50 py-0.5">
              {streakDays ? <span>🔥 {streakDays}d streak</span> : null}
              {totalMessages ? <span>{totalMessages} msgs</span> : null}
            </div>
          ) : null}
          <button
            onClick={() => { onOpenSettings(); toggleSidebar(false); }}
            className="flex items-center gap-2 text-xs text-blade-muted hover:text-blade-secondary transition-colors py-1 w-full"
          >
            <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="3" />
              <path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83" />
            </svg>
            Settings
          </button>
        </div>
      </div>

      {/* Main */}
      <div className="flex flex-col flex-1 min-w-0">
        {/* Header */}
        <div className="flex items-center justify-between h-10 px-4 border-b border-blade-border/50 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => toggleSidebar(true)}
              className="text-blade-muted hover:text-blade-secondary transition-colors shrink-0"
              aria-label="History"
            >
              <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M3.5 7h17M3.5 12h17M3.5 17h17" />
              </svg>
            </button>
            {editingTitle ? (
              <input
                ref={titleInputRef}
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                onBlur={() => setEditingTitle(false)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === "Escape") setEditingTitle(false);
                }}
                className="text-xs text-blade-secondary bg-transparent border-b border-blade-accent/30 outline-none w-40"
                autoFocus
              />
            ) : (
              <span
                className="text-xs text-blade-secondary truncate cursor-default"
                onDoubleClick={() => {
                  const title = conversations.find((c) => c.id === currentConversationId)?.title ?? "";
                  setTitleDraft(title);
                  setEditingTitle(true);
                }}
                title="Double-click to rename"
              >
                {conversations.find((c) => c.id === currentConversationId)?.title ?? "New conversation"}
              </span>
            )}
            {provider && (
              <span className="text-2xs text-blade-muted/60 bg-blade-surface px-1.5 py-0.5 rounded-md font-mono shrink-0">
                {provider}{model ? ` · ${model.split("/").pop()?.split("-").slice(0, 2).join("-")}` : ""}
                {lastResponseTime != null && (
                  <span className="text-blade-muted/40 ml-1.5">
                    {lastResponseTime < 1000 ? `${lastResponseTime}ms` : `${(lastResponseTime / 1000).toFixed(1)}s`}
                  </span>
                )}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={ttsSpeaking ? onStopTTS : onToggleTTS}
              className={`w-7 h-7 rounded-md flex items-center justify-center transition-colors ${
                ttsEnabled
                  ? "text-blade-accent hover:bg-blade-surface"
                  : "text-blade-muted hover:text-blade-secondary hover:bg-blade-surface"
              }`}
              title={ttsEnabled ? (ttsSpeaking ? "Stop speaking" : "TTS on — click to disable") : "Enable TTS"}
            >
              {ttsSpeaking ? (
                <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="6" y="4" width="4" height="16" rx="1" />
                  <rect x="14" y="4" width="4" height="16" rx="1" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                  <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                  {ttsEnabled && <path d="M15.54 8.46a5 5 0 0 1 0 7.07M19.07 4.93a10 10 0 0 1 0 14.14" />}
                </svg>
              )}
            </button>
            <button
              onClick={onClear}
              className="h-7 px-2 rounded-md text-2xs text-blade-muted hover:text-blade-secondary hover:bg-blade-surface transition-colors"
            >
              clear
            </button>
            <button
              onClick={onOpenSettings}
              className="w-7 h-7 rounded-md text-blade-muted hover:text-blade-secondary hover:bg-blade-surface transition-colors flex items-center justify-center"
              aria-label="Settings"
            >
              <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="3" />
                <path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83" />
              </svg>
            </button>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="mx-4 mt-3 px-3 py-2 rounded-lg bg-red-500/8 border border-red-500/15 text-red-400 text-xs animate-fade-in flex items-center justify-between gap-2">
            <span className="truncate">{error}</span>
            <button
              onClick={onRetry}
              className="shrink-0 px-2 py-0.5 rounded-md bg-red-500/10 hover:bg-red-500/20 text-red-400 text-2xs transition-colors"
            >
              retry
            </button>
          </div>
        )}

        <MessageList messages={messages} loading={loading} toolExecutions={toolExecutions} onQuickAction={onSend} />

        {/* Smart clipboard bar */}
        {clipboardDetection && !loading && (
          <div className="mx-4 mb-2 px-3 py-2 rounded-lg bg-blade-surface border border-blade-border animate-fade-in">
            <div className="flex items-center gap-2">
              <span className="text-2xs font-mono text-blade-accent shrink-0 w-5 text-center">
                {TYPE_ICONS[clipboardDetection.type] ?? "T"}
              </span>
              <span className="text-2xs text-blade-muted truncate flex-1" title={clipboardDetection.preview}>
                <span className="text-blade-secondary/60 uppercase tracking-wider mr-1.5">{clipboardDetection.type}</span>
                {clipboardDetection.preview}
              </span>
              <button
                onClick={onDismissClipboard}
                className="text-blade-muted hover:text-blade-secondary transition-colors shrink-0"
              >
                <svg viewBox="0 0 24 24" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>
            <div className="flex items-center gap-1.5 mt-1.5">
              {clipboardDetection.actions.map((action) => (
                <button
                  key={action.label}
                  onClick={() => { onSend(action.prompt); onDismissClipboard(); }}
                  className="text-2xs px-2 py-0.5 rounded-md bg-blade-surface-hover text-blade-secondary hover:text-blade-text transition-colors"
                >
                  {action.label}
                </button>
              ))}
            </div>
          </div>
        )}

        <InputBar onSend={onSend} disabled={loading} />
      </div>

      {pendingApproval && (
        <ToolApprovalDialog request={pendingApproval} onRespond={onRespondApproval} />
      )}
    </div>
  );
}
