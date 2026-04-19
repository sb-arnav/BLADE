// src/features/chat/MessageList.tsx — Committed history + live streaming bubble.
//
// Renders committed `messages` followed by (when active) a single "live"
// bubble sourced from the streaming buffer state on ChatProvider. The live
// bubble is not written to `messages` until CHAT_DONE — flush-then-commit
// ordering mitigates T-03-03-01 double-render races.
//
// Virtualization: Phase 3 intentionally does NOT virtualize. Threshold for
// Phase 9 polish = ~200 messages (once the conversation persistence + load
// surfaces land). `@tanstack/react-virtual` is already a dependency so the
// swap is drop-in later. Rationale: virtualization adds complexity to
// auto-scroll + streaming-bubble-tail behavior; Phase 3 UX happens under
// ~20 messages per conversation.
//
// Auto-scroll: `useEffect` keyed on [messages.length, streamingContent.length,
// thinkingContent.length] keeps the viewport pinned to bottom as content
// grows. `behavior: 'smooth'` matches the prototype.
//
// @see .planning/phases/03-dashboard-chat-settings/03-CONTEXT.md §D-67
// @see .planning/phases/03-dashboard-chat-settings/03-PATTERNS.md §5

import { useEffect, useRef } from 'react';
import { MessageBubble } from './MessageBubble';
import { useChatCtx } from './useChat';

export function MessageList() {
  const { messages, currentMessageId, streamingContent, thinkingContent, status } =
    useChatCtx();
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [messages.length, streamingContent.length, thinkingContent.length]);

  const showLive =
    currentMessageId !== null &&
    (status === 'streaming' || status === 'thinking');

  return (
    <div
      ref={scrollRef}
      className="chat-message-list"
      role="log"
      aria-live="polite"
      aria-relevant="additions"
    >
      {messages.map((m) => (
        <MessageBubble key={m.id} msg={m} />
      ))}
      {showLive && currentMessageId ? (
        <MessageBubble
          msg={{
            id: currentMessageId,
            role: 'assistant',
            content: streamingContent,
            thinking: thinkingContent || undefined,
            createdAt: Date.now(),
          }}
          streaming
        />
      ) : null}
    </div>
  );
}
