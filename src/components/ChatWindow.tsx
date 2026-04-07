import { useChat } from "../hooks/useChat";
import { MessageList } from "./MessageList";
import { InputBar } from "./InputBar";

export function ChatWindow() {
  const { messages, loading, error, sendMessage, clearMessages } = useChat();

  return (
    <div className="flex flex-col h-screen bg-blade-bg text-blade-text">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-blade-border">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-blade-accent" />
          <span className="text-sm font-medium text-blade-text">Blade</span>
        </div>
        <button
          onClick={clearMessages}
          className="text-blade-muted hover:text-blade-text text-xs transition-colors"
        >
          clear
        </button>
      </div>

      {/* Error banner */}
      {error && (
        <div className="px-4 py-2 bg-red-950 border-b border-red-900 text-red-400 text-xs">
          {error}
        </div>
      )}

      <MessageList messages={messages} loading={loading} />
      <InputBar onSend={sendMessage} disabled={loading} />
    </div>
  );
}
