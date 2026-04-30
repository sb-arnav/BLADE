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
// Phase 18 (JARVIS-11): subscribes to BLADE_EVENTS.JARVIS_INTERCEPT via
// useTauriEvent (D-13 lock — only permitted listen surface) and renders an
// inline JarvisPill below the latest assistant bubble. Auto-clears the pill
// on next BLADE_MESSAGE_START unless action='hard_refused' (which stays
// until the user dismisses).
//
// @see .planning/phases/03-dashboard-chat-settings/03-CONTEXT.md §D-67
// @see .planning/phases/03-dashboard-chat-settings/03-PATTERNS.md §5
// @see .planning/phases/18-jarvis-ptt-cross-app/18-CONTEXT.md §D-13, §D-18

import { useCallback, useEffect, useRef, useState } from 'react';
import { BLADE_EVENTS, useTauriEvent, type Event } from '@/lib/events';
import type { JarvisInterceptPayload } from '@/lib/events/payloads';
import { JarvisPill } from './JarvisPill';
import { MessageBubble } from './MessageBubble';
import { useChatCtx } from './useChat';

export function MessageList() {
  const { messages, currentMessageId, streamingContent, thinkingContent, status } =
    useChatCtx();
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // ── Phase 18: jarvis_intercept inline pill (D-18) ─────────────────────────
  const [intercept, setIntercept] = useState<JarvisInterceptPayload | null>(null);
  const handleIntercept = useCallback((e: Event<JarvisInterceptPayload>) => {
    setIntercept(e.payload);
  }, []);
  useTauriEvent<JarvisInterceptPayload>(BLADE_EVENTS.JARVIS_INTERCEPT, handleIntercept);

  // Auto-clear non-hard_refused pills when a new assistant message starts.
  // currentMessageId flips from null → string on BLADE_MESSAGE_START; we read
  // the latest intercept via a ref so the effect doesn't churn on every state
  // tick during streaming.
  const interceptRef = useRef(intercept);
  interceptRef.current = intercept;
  useEffect(() => {
    if (!currentMessageId) return;
    const cur = interceptRef.current;
    if (cur && cur.action !== 'hard_refused') {
      setIntercept(null);
    }
  }, [currentMessageId]);

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
      {intercept ? (
        <JarvisPill
          payload={intercept}
          onDismiss={() => setIntercept(null)}
        />
      ) : null}
    </div>
  );
}
