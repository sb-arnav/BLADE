import { useState } from "react";
import { ConversationSummary, Message, ToolApprovalRequest, ToolExecution } from "../types";
import { MessageList } from "./MessageList";
import { InputBar } from "./InputBar";
import { ToolApprovalDialog } from "./ToolApprovalDialog";

interface Props {
  messages: Message[];
  loading: boolean;
  error: string | null;
  toolExecutions: ToolExecution[];
  clipboardText: string | null;
  conversations: ConversationSummary[];
  currentConversationId: string | null;
  onSend: (message: string) => void;
  onClear: () => void;
  onNewConversation: () => void | Promise<void>;
  onSwitchConversation: (conversationId: string) => void | Promise<void>;
  onOpenSettings: () => void;
  onDismissClipboard: () => void;
  pendingApproval: ToolApprovalRequest | null;
  onRespondApproval: (approved: boolean) => void;
  onDeleteConversation: (id: string) => void;
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
}: Props) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const handleClipboardAction = (action: string) => {
    if (!clipboardText) return;
    const preview = clipboardText.length > 200 ? clipboardText.slice(0, 200) + "..." : clipboardText;
    onSend(`${action} this:\n\n${preview}`);
    onDismissClipboard();
  };

  const currentTitle = conversations.find((c) => c.id === currentConversationId)?.title ?? "New conversation";

  return (
    <div className="flex h-full bg-blade-bg text-blade-text">
      {/* Sidebar overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-30 bg-black/40" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Sidebar */}
      <div
        className={`fixed inset-y-0 left-0 z-40 w-64 bg-blade-surface border-r border-blade-border flex flex-col transition-transform duration-200 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
        style={{ top: "2.5rem" }} // below TitleBar
      >
        <div className="flex items-center justify-between px-3 py-3 border-b border-blade-border">
          <span className="text-xs uppercase tracking-wide text-blade-muted">Conversations</span>
          <button
            onClick={() => {
              onNewConversation();
              setSidebarOpen(false);
            }}
            className="text-xs text-blade-accent hover:text-blade-accent-hover transition-colors"
          >
            + new
          </button>
        </div>
        <div className="flex-1 overflow-y-auto py-1">
          {conversations.map((conv) => {
            const isActive = conv.id === currentConversationId;
            return (
              <div
                key={conv.id}
                className={`group flex items-start gap-2 px-3 py-2.5 cursor-pointer transition-colors ${
                  isActive ? "bg-blade-bg" : "hover:bg-blade-bg/50"
                }`}
                onClick={() => {
                  onSwitchConversation(conv.id);
                  setSidebarOpen(false);
                }}
              >
                <div className="flex-1 min-w-0">
                  <p className={`text-sm truncate ${isActive ? "text-blade-text" : "text-blade-muted"}`}>
                    {conv.title || "New conversation"}
                  </p>
                  <p className="text-[10px] text-blade-muted mt-0.5">
                    {formatTime(conv.updated_at)}
                  </p>
                </div>
                {conversations.length > 1 && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteConversation(conv.id);
                    }}
                    className="opacity-0 group-hover:opacity-100 text-[10px] text-blade-muted hover:text-red-400 transition-all mt-0.5"
                  >
                    del
                  </button>
                )}
              </div>
            );
          })}
        </div>
        <div className="border-t border-blade-border px-3 py-2">
          <button
            onClick={() => {
              onOpenSettings();
              setSidebarOpen(false);
            }}
            className="w-full text-left text-xs text-blade-muted hover:text-blade-text transition-colors py-1"
          >
            Settings
          </button>
        </div>
      </div>

      {/* Main chat area */}
      <div className="flex flex-col flex-1 min-w-0">
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-blade-border">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => setSidebarOpen(true)}
              className="text-blade-muted hover:text-blade-text transition-colors shrink-0"
              aria-label="Open conversation list"
            >
              <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            <div className="w-2 h-2 rounded-full bg-blade-accent shrink-0" />
            <span className="text-sm truncate">{currentTitle}</span>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <button
              onClick={onClear}
              className="text-blade-muted hover:text-blade-text text-xs transition-colors"
            >
              clear
            </button>
            <button
              onClick={onOpenSettings}
              aria-label="Open settings"
              className="text-blade-muted hover:text-blade-text transition-colors"
            >
              <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.8">
                <circle cx="12" cy="12" r="3" />
                <path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83" />
              </svg>
            </button>
          </div>
        </div>

        {error && (
          <div className="px-4 py-2 bg-red-950 border-b border-red-900 text-red-400 text-xs">
            {error}
          </div>
        )}

        <MessageList messages={messages} loading={loading} toolExecutions={toolExecutions} />

        {clipboardText && !loading && (
          <div className="px-4 py-2 border-t border-blade-border bg-blade-surface/50 flex items-center gap-2">
            <span className="text-xs text-blade-muted truncate flex-1">
              Clipboard: {clipboardText.slice(0, 60)}{clipboardText.length > 60 ? "..." : ""}
            </span>
            <button
              onClick={() => handleClipboardAction("Explain")}
              className="text-[11px] px-2.5 py-1 rounded-lg border border-blade-border text-blade-muted hover:text-blade-text hover:border-blade-muted transition-colors"
            >
              Explain
            </button>
            <button
              onClick={() => handleClipboardAction("Summarize")}
              className="text-[11px] px-2.5 py-1 rounded-lg border border-blade-border text-blade-muted hover:text-blade-text hover:border-blade-muted transition-colors"
            >
              Summarize
            </button>
            <button
              onClick={onDismissClipboard}
              className="text-blade-muted hover:text-blade-text text-xs transition-colors ml-1"
            >
              x
            </button>
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
