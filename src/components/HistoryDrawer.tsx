import { ConversationSummary } from "../types";

interface HistoryDrawerProps {
  open: boolean;
  conversations: ConversationSummary[];
  currentConversationId: string | null;
  onClose: () => void;
  onSelect: (id: string) => void;
  onNew: () => void;
}

export function HistoryDrawer({
  open,
  conversations,
  currentConversationId,
  onClose,
  onSelect,
  onNew,
}: HistoryDrawerProps) {
  return (
    <div
      className={[
        "fixed top-[34px] bottom-0 left-[62px] w-[250px] z-[195] flex flex-col",
        "bg-[rgba(5,5,16,0.72)] backdrop-blur-[60px] border-r border-[rgba(255,255,255,0.12)]",
        "shadow-[16px_0_50px_rgba(0,0,0,0.4)]",
        "transition-transform duration-[430ms]",
        open ? "translate-x-0" : "-translate-x-full",
      ].join(" ")}
      style={{ transitionTimingFunction: "cubic-bezier(0.32,0.72,0,1)" }}
    >
      {/* Header */}
      <div className="h-[52px] flex items-center justify-between px-[14px] border-b border-[rgba(255,255,255,0.08)] flex-shrink-0">
        <span className="text-[10px] font-bold tracking-[0.14em] uppercase text-[rgba(255,255,255,0.28)]">
          Conversations
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={onNew}
            className="w-[26px] h-[26px] rounded-[7px] flex items-center justify-center
              text-[rgba(255,255,255,0.3)] hover:text-white hover:bg-[rgba(255,255,255,0.07)] transition-all"
            title="New conversation"
          >
            <svg viewBox="0 0 12 12" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M6 2v8M2 6h8"/>
            </svg>
          </button>
          <button
            onClick={onClose}
            className="w-[26px] h-[26px] rounded-[7px] flex items-center justify-center
              text-[rgba(255,255,255,0.3)] hover:text-white hover:bg-[rgba(255,255,255,0.07)] transition-all"
          >
            <svg viewBox="0 0 11 11" className="w-[11px] h-[11px]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M1 1l9 9M10 1l-9 9"/>
            </svg>
          </button>
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-px
        [scrollbar-width:thin] [scrollbar-color:rgba(255,255,255,0.07)_transparent]">
        {conversations.length === 0 && (
          <div className="text-center text-[rgba(255,255,255,0.28)] text-xs py-8">No conversations yet</div>
        )}
        {conversations.map((conv) => {
          const isActive = conv.id === currentConversationId;
          return (
            <button
              key={conv.id}
              onClick={() => { onSelect(conv.id); onClose(); }}
              className={[
                "w-full text-left px-[10px] py-[9px] rounded-[9px] border transition-all duration-100",
                isActive
                  ? "bg-[rgba(129,140,248,0.08)] border-[rgba(129,140,248,0.2)]"
                  : "border-transparent hover:bg-[rgba(255,255,255,0.05)]",
              ].join(" ")}
            >
              <div className="text-[12px] font-medium text-[rgba(255,255,255,0.92)] truncate">
                {conv.title || "Untitled"}
              </div>
              <div className="text-[10.5px] text-[rgba(255,255,255,0.3)] mt-[2px]">
                {conv.message_count ? `${conv.message_count} msgs` : ""}
                {conv.updated_at ? ` · ${new Date(conv.updated_at).toLocaleDateString()}` : ""}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
