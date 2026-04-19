// src/features/chat/ChatPanel.tsx — Composed chat layout shell.
//
// Structure:
//   <section.chat-panel data-status={status}>
//     <header.chat-header> [title] [routing pill] [Plan 03-04: compacting indicator]
//     <MessageList />      (committed messages + live streaming bubble)
//     [Plan 03-04: <ToolApprovalDialog/>]
//     <InputBar />
//   </section>
//
// The `data-status` attribute is a styling hook for status-specific
// decorations (idle pulse on empty state, etc.) without prop drilling.
//
// Routing pill (CHAT-05): reads the most recent chat_routing payload from
// ChatProvider state. Shows '—' when no routing event has arrived yet
// (pre-first-message state).
//
// ChatProvider is mounted by index.tsx ChatPanelRoute so this component can
// call useChatCtx() safely.
//
// @see .planning/phases/03-dashboard-chat-settings/03-CONTEXT.md §D-67..D-73
// @see .planning/phases/03-dashboard-chat-settings/03-PATTERNS.md §3,§5

import { Pill } from '@/design-system/primitives';
import { InputBar } from './InputBar';
import { MessageList } from './MessageList';
import { useChatCtx } from './useChat';

export function ChatPanel() {
  const { routing, status } = useChatCtx();
  return (
    <section className="chat-panel" data-status={status}>
      <header className="chat-header">
        <h2 className="chat-title t-h2">Chat</h2>
        {routing ? (
          <Pill>
            {routing.provider} · {routing.model}
            {routing.hive_active ? ' · hive' : ''}
          </Pill>
        ) : (
          <Pill>—</Pill>
        )}
        {/* Plan 03-04 slot: <CompactingIndicator /> absolute-positioned above the pill */}
      </header>
      <MessageList />
      {/* Plan 03-04 slot: <ToolApprovalDialog /> */}
      <InputBar />
    </section>
  );
}
