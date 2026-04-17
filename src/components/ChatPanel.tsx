import { ChatWindow } from "./ChatWindow";
import { ConversationSummary, Message, RuntimeDescriptor, ToolApprovalRequest, ToolExecution } from "../types";
import { ActiveWindowInfo, ContextSuggestion } from "../hooks/useContextAwareness";

export interface ChatPanelProps {
  open: boolean;
  onClose: () => void;
  // All ChatWindow props forwarded:
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

export function ChatPanel({ open, onClose, ...chatProps }: ChatPanelProps) {
  return (
    <div
      className={[
        "fixed top-[34px] right-0 bottom-0 w-[420px] z-[180] flex flex-col",
        "border-l border-[rgba(255,255,255,0.1)]",
        "transition-transform duration-[460ms]",
        open ? "translate-x-0" : "translate-x-full",
      ].join(" ")}
      style={{
        transitionTimingFunction: "cubic-bezier(0.32,0.72,0,1)",
        background: "linear-gradient(180deg, rgba(10,10,18,0.88) 0%, rgba(6,6,14,0.92) 100%)",
        backdropFilter: "blur(56px) saturate(1.8)",
        WebkitBackdropFilter: "blur(56px) saturate(1.8)",
        boxShadow:
          "inset 1px 0 0 rgba(255,255,255,0.06), -32px 0 90px rgba(0,0,0,0.55), -8px 0 24px rgba(0,0,0,0.3)",
      }}
    >
      {/* Close handle */}
      <div className="absolute top-3 left-[-32px] z-10">
        {open && (
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-[7px] flex items-center justify-center
              bg-[rgba(0,0,0,0.5)] backdrop-blur-xl border border-[rgba(255,255,255,0.12)]
              text-[rgba(255,255,255,0.4)] hover:text-white transition-all"
          >
            <svg viewBox="0 0 11 11" className="w-[11px] h-[11px]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M9 1l-8 8M1 1l8 8"/>
            </svg>
          </button>
        )}
      </div>

      {/* ChatWindow fills the panel */}
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        <ChatWindow {...chatProps} />
      </div>
    </div>
  );
}
