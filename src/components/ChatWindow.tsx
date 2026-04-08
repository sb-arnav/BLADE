import { ConversationSummary, Message, ToolExecution } from "../types";
import { MessageList } from "./MessageList";
import { InputBar } from "./InputBar";

interface Props {
  messages: Message[];
  loading: boolean;
  error: string | null;
  toolExecutions: ToolExecution[];
  conversations: ConversationSummary[];
  currentConversationId: string | null;
  onSend: (message: string) => void;
  onClear: () => void;
  onNewConversation: () => void | Promise<void>;
  onSwitchConversation: (conversationId: string) => void | Promise<void>;
  onOpenSettings: () => void;
}

function GearIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M12 3.75l1.18 2.4 2.64.38-1.91 1.86.45 2.63L12 9.78l-2.36 1.24.45-2.63-1.91-1.86 2.64-.38L12 3.75Z" />
      <circle cx="12" cy="12" r="3.25" />
      <path d="M4.5 12a7.5 7.5 0 0 1 .08-1.08M19.42 10.92A7.5 7.5 0 0 1 19.5 12M7.1 18.25l1.52-1.54M15.38 16.71l1.52 1.54M7.1 5.75l1.52 1.54M15.38 7.29l1.52-1.54" />
    </svg>
  );
}

export function ChatWindow({
  messages,
  loading,
  error,
  toolExecutions,
  conversations,
  currentConversationId,
  onSend,
  onClear,
  onNewConversation,
  onSwitchConversation,
  onOpenSettings,
}: Props) {
  return (
    <div className="flex flex-col h-full bg-blade-bg text-blade-text">
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-blade-border">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <div className="w-2 h-2 rounded-full bg-blade-accent" />
          <select
            value={currentConversationId ?? ""}
            onChange={(event) => onSwitchConversation(event.target.value)}
            className="min-w-0 flex-1 bg-blade-surface border border-blade-border rounded-lg px-3 py-1.5 text-sm text-blade-text outline-none"
          >
            {conversations.map((conversation) => (
              <option key={conversation.id} value={conversation.id}>
                {conversation.title}
              </option>
            ))}
          </select>
          <button
            onClick={() => onNewConversation()}
            className="text-xs text-blade-muted hover:text-blade-text transition-colors"
          >
            new
          </button>
        </div>
        <div className="flex items-center gap-3">
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
            <GearIcon />
          </button>
        </div>
      </div>

      {error && (
        <div className="px-4 py-2 bg-red-950 border-b border-red-900 text-red-400 text-xs">
          {error}
        </div>
      )}

      <MessageList messages={messages} loading={loading} toolExecutions={toolExecutions} />
      <InputBar onSend={onSend} disabled={loading} />
    </div>
  );
}
