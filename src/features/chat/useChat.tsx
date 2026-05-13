// src/features/chat/useChat.tsx — ChatProvider context + useChatCtx hook.
//
// Architectural spine of Phase 3 Chat (D-67, D-68, D-69 — streaming substrate):
//   • D-67 — useChat state lives ONLY inside the chat subtree; MainShell never
//     re-renders during a stream because route-id is stable.
//   • D-68 — per-token chunks accumulate in a useRef buffer; only
//     requestAnimationFrame drives React commits during streaming. Commit count
//     ≤ refresh rate regardless of emit cadence. Falsifiable by Plan 03-07
//     chat-stream.spec.ts.
//   • D-69 — ChatProvider originally mounted at the route level (inside the
//     lazy ChatPanelRoute wrapper). Phase 4 Plan 04-06 (D-116) HOISTS the
//     provider up to MainShell so the QuickAskBridge can inject bridged
//     user-turns via `injectUserMessage` regardless of the currently-active
//     route. Route changes no longer unmount the provider — but the event
//     subscriptions are still deduped (P-06) because useTauriEvent has a
//     single listen() per mount and MainShell mounts exactly once per session.
//
// The provider subscribes to 9 BLADE_EVENTS:
//   BLADE_MESSAGE_START / CHAT_TOKEN / BLADE_THINKING_CHUNK / CHAT_DONE /
//   CHAT_THINKING_DONE / BLADE_TOKEN_RATIO / CHAT_ROUTING /
//   TOOL_APPROVAL_NEEDED / CHAT_CANCELLED.
//
// Plan 03-04 consumes `toolApprovalRequest` + `approveTool` / `denyTool` for
// the dialog; `thinkingContent` for the <details> section in MessageBubble;
// `tokenRatio` for the CompactingIndicator. All four hooks are shipped here
// Day-1 so Plan 03-04 can compose without touching this file.
//
// @see .planning/phases/03-dashboard-chat-settings/03-CONTEXT.md §D-67..D-73
// @see .planning/phases/03-dashboard-chat-settings/03-PATTERNS.md §3

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { BLADE_EVENTS, useTauriEvent } from '@/lib/events';
import type {
  BladeForgeLinePayload,
  BladeMessageStartPayload,
  BladeReincarnationPayload,
  BladeThinkingChunkPayload,
  BladeTokenRatioPayload,
  ChatErrorPayload,
  ChatRoutingPayload,
  ChatTokenPayload,
  ToolApprovalNeededPayload,
} from '@/lib/events';
import { cancelChat, respondToolApproval, sendMessageStream } from '@/lib/tauri';
import type { ChatMessage } from '@/types/messages';

// ---------------------------------------------------------------------------
// Public shapes
// ---------------------------------------------------------------------------

export interface ChatStreamMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  thinking?: string;
  createdAt: number;
  /** Marks the message as an error-surface rather than a normal reply. */
  isError?: boolean;
  /**
   * Phase 47 (FORGE-02) — when set, this system-role message represents a
   * single transition in the forge loop. MessageBubble renders it with a
   * forge-specific visual treatment (monospace, glyph prefix, phase-coded
   * border tint) instead of the default system-error styling.
   */
  forgePhase?: 'gap_detected' | 'writing' | 'testing' | 'registered' | 'retrying' | 'failed';
}

export type ChatStatus =
  | 'idle'
  | 'streaming'
  | 'thinking'
  | 'awaiting_tool'
  | 'error';

export interface ChatStateValue {
  messages: ChatStreamMessage[];
  status: ChatStatus;
  streamingContent: string;
  thinkingContent: string;
  currentMessageId: string | null;
  toolApprovalRequest: ToolApprovalNeededPayload | null;
  tokenRatio: { ratio: number; used: number; window: number } | null;
  routing: ChatRoutingPayload | null;
  /**
   * Phase 34 / BL-01 + BL-02 (REVIEW finding) — currently-active conversation
   * session_id. `null` for a brand-new chat that hasn't sent its first message
   * yet; populated by `setActiveSessionId` after `resumeSession` returns. When
   * non-null, every `send` call threads this id through `sendMessageStream` so
   * the Rust side appends to the SAME JSONL and the per-conversation
   * carry-over registry hits the same bucket. Cleared on `cancel`-then-new
   * is the user's call (we do not auto-clear to avoid surprising fork).
   */
  activeSessionId: string | null;
  send: (text: string) => Promise<void>;
  cancel: () => Promise<void>;
  approveTool: (approvalId: string) => Promise<void>;
  denyTool: (approvalId: string) => Promise<void>;
  /**
   * Phase 4 Plan 04-06 (D-102/D-116) — retroactive user-turn injection.
   *
   * Appends a user message to `messages[]` WITHOUT invoking
   * `sendMessageStream`. The Rust side already kicked off streaming from
   * `quickask_submit` (Plan 04-01, D-93) — this action exists solely to
   * sync the main-window chat history UI with the bridged conversation so
   * the user sees their own turn alongside the assistant reply when they
   * expand `/chat` after submitting from QuickAsk.
   *
   * Called by QuickAskBridge (Plan 04-06) on BLADE_QUICKASK_BRIDGED.
   */
  injectUserMessage: (m: { id: string; content: string }) => void;
  /**
   * Phase 34 / BL-02 (REVIEW finding) — replace the chat history wholesale.
   * Called by `SessionsView.handleResume` after `resumeSession` returns the
   * `ResumedConversation.messages` so the chat surface re-renders with the
   * resumed turns. Without this hook, the `Resume` button is a visual no-op:
   * the user clicks Resume, the chat opens empty, and the next message starts
   * a fresh session.
   */
  setHistory: (messages: ChatStreamMessage[]) => void;
  /**
   * Phase 34 / BL-01 + BL-02 — set the active conversation session_id. The
   * next `send` call will thread this id through to Rust so the cumulative
   * cost cap + JSONL append target the resumed conversation.
   */
  setActiveSessionId: (id: string | null) => void;
}

const Ctx = createContext<ChatStateValue | null>(null);

// ---------------------------------------------------------------------------
// ChatProvider
// ---------------------------------------------------------------------------

export function ChatProvider({ children }: { children: ReactNode }) {
  const [messages, setMessages] = useState<ChatStreamMessage[]>([]);
  const [status, setStatus] = useState<ChatStatus>('idle');
  const [streamingContent, setStreamingContent] = useState('');
  const [thinkingContent, setThinkingContent] = useState('');
  const [currentMessageId, setCurrentMessageId] = useState<string | null>(null);
  const [toolApprovalRequest, setToolApprovalRequest] =
    useState<ToolApprovalNeededPayload | null>(null);
  const [tokenRatio, setTokenRatio] = useState<ChatStateValue['tokenRatio']>(null);
  const [routing, setRouting] = useState<ChatRoutingPayload | null>(null);
  // Phase 34 / BL-01 + BL-02 (REVIEW finding) — active conversation session_id.
  // Populated by setActiveSessionId after resumeSession returns; threaded into
  // every send() so the Rust side hits the same SessionWriter target + the
  // same per-conversation carry-over bucket.
  const [activeSessionId, setActiveSessionIdState] = useState<string | null>(null);

  // ── rAF-flushed buffers (D-68) ────────────────────────────────────────────
  // Buffers accumulate synchronously inside the event handlers; a single
  // scheduled animation frame copies them into state and clears the refs.
  // `rafScheduledRef` guards against scheduling multiple frames per burst.
  const tokenBufRef = useRef('');
  const thinkBufRef = useRef('');
  const rafScheduledRef = useRef(false);

  // ── Ref mirrors of the committed streaming content (D-68 correctness) ────
  // The CHAT_DONE handler needs to flush remaining buffer AND commit the
  // combined final content as a message. Reading `streamingContent` from the
  // closure would return the value at subscription time (stale). These refs
  // are updated alongside every state set so the done handler always reads
  // the latest committed content.
  const streamingContentRef = useRef('');
  const thinkingContentRef = useRef('');
  const currentMessageIdRef = useRef<string | null>(null);

  const scheduleFlush = useCallback(() => {
    if (rafScheduledRef.current) return;
    rafScheduledRef.current = true;
    requestAnimationFrame(() => {
      rafScheduledRef.current = false;
      if (tokenBufRef.current) {
        const chunk = tokenBufRef.current;
        tokenBufRef.current = '';
        streamingContentRef.current += chunk;
        setStreamingContent(streamingContentRef.current);
      }
      if (thinkBufRef.current) {
        const chunk = thinkBufRef.current;
        thinkBufRef.current = '';
        thinkingContentRef.current += chunk;
        setThinkingContent(thinkingContentRef.current);
      }
    });
  }, []);

  // ── Event subscriptions ───────────────────────────────────────────────────

  useTauriEvent<BladeMessageStartPayload>(BLADE_EVENTS.BLADE_MESSAGE_START, (e) => {
    currentMessageIdRef.current = e.payload.message_id;
    streamingContentRef.current = '';
    thinkingContentRef.current = '';
    tokenBufRef.current = '';
    thinkBufRef.current = '';
    setCurrentMessageId(e.payload.message_id);
    setStreamingContent('');
    setThinkingContent('');
    setStatus('streaming');
  });

  useTauriEvent<ChatTokenPayload>(BLADE_EVENTS.CHAT_TOKEN, (e) => {
    tokenBufRef.current += e.payload;
    scheduleFlush();
  });

  useTauriEvent<BladeThinkingChunkPayload>(BLADE_EVENTS.BLADE_THINKING_CHUNK, (e) => {
    thinkBufRef.current += e.payload.chunk;
    scheduleFlush();
    // Do NOT downgrade awaiting_tool → thinking; tool approval stays active
    // until the user responds. Otherwise, thinking takes priority over the
    // default idle/streaming transitions.
    setStatus((prev) => (prev === 'awaiting_tool' ? prev : 'thinking'));
  });

  useTauriEvent<null>(BLADE_EVENTS.CHAT_DONE, () => {
    // Synchronous final flush — commit any buffered chunks before building
    // the final message so no content is dropped on the race between the
    // last chat_token and chat_done (T-03-03-01 mitigation).
    const finalContent = streamingContentRef.current + tokenBufRef.current;
    const finalThinking = thinkingContentRef.current + thinkBufRef.current;
    tokenBufRef.current = '';
    thinkBufRef.current = '';

    const msgId = currentMessageIdRef.current;
    if (msgId) {
      const committed: ChatStreamMessage = {
        id: msgId,
        role: 'assistant',
        content: finalContent,
        thinking: finalThinking || undefined,
        createdAt: Date.now(),
      };
      setMessages((prev) => [...prev, committed]);
    }

    streamingContentRef.current = '';
    thinkingContentRef.current = '';
    currentMessageIdRef.current = null;
    setStreamingContent('');
    setThinkingContent('');
    setCurrentMessageId(null);
    setStatus('idle');
  });

  // CHAT_THINKING_DONE is a provider-side boundary marker; no state change
  // needed — the next CHAT_TOKEN / CHAT_DONE drives the transition.
  useTauriEvent<null>(BLADE_EVENTS.CHAT_THINKING_DONE, () => {
    /* intentional no-op */
  });

  useTauriEvent<BladeTokenRatioPayload>(BLADE_EVENTS.BLADE_TOKEN_RATIO, (e) => {
    setTokenRatio({
      ratio: e.payload.ratio,
      used: e.payload.tokens_used,
      window: e.payload.context_window,
    });
  });

  useTauriEvent<ChatRoutingPayload>(BLADE_EVENTS.CHAT_ROUTING, (e) => {
    setRouting(e.payload);
  });

  useTauriEvent<ChatErrorPayload>(BLADE_EVENTS.CHAT_ERROR, (e) => {
    // Surface provider failures inline so the chat never sits silent. The
    // Rust side also emits chat_done so streaming state resets naturally.
    const errMsg: ChatStreamMessage = {
      id: crypto.randomUUID(),
      role: 'system',
      content: e.payload.message,
      createdAt: Date.now(),
      isError: true,
    };
    // Drop in-flight streaming content — the provider never produced any.
    tokenBufRef.current = '';
    thinkBufRef.current = '';
    streamingContentRef.current = '';
    thinkingContentRef.current = '';
    currentMessageIdRef.current = null;
    setStreamingContent('');
    setThinkingContent('');
    setCurrentMessageId(null);
    setMessages((prev) => [...prev, errMsg]);
    setStatus('error');
  });

  useTauriEvent<ToolApprovalNeededPayload>(BLADE_EVENTS.TOOL_APPROVAL_NEEDED, (e) => {
    setToolApprovalRequest(e.payload);
    setStatus('awaiting_tool');
  });

  useTauriEvent<null>(BLADE_EVENTS.CHAT_CANCELLED, () => {
    // Flush and clear without committing — the stream was aborted.
    tokenBufRef.current = '';
    thinkBufRef.current = '';
    streamingContentRef.current = '';
    thinkingContentRef.current = '';
    currentMessageIdRef.current = null;
    setStreamingContent('');
    setThinkingContent('');
    setCurrentMessageId(null);
    setStatus('idle');
  });

  // Phase 29 / D-23: reincarnation system message.
  // On blade_reincarnation, inject a system message acknowledging BLADE's
  // return. Same setMessages pattern as CHAT_ERROR handler above.
  useTauriEvent<BladeReincarnationPayload>(BLADE_EVENTS.BLADE_REINCARNATION, () => {
    const reincarnationMsg: ChatStreamMessage = {
      id: crypto.randomUUID(),
      role: 'system',
      content: 'BLADE has reincarnated. Memories intact. Rebuilding vitality.',
      createdAt: Date.now(),
    };
    setMessages((prev) => [...prev, reincarnationMsg]);
  });

  // Phase 47 (FORGE-02) — forge chat-line subscriber.
  // On blade_forge_line, append a system-role message tagged with the forge
  // phase. MessageBubble inspects msg.forgePhase and applies the forge
  // visual treatment so the gap_detected → writing → testing → registered
  // → retrying sequence renders as distinct chat lines visually separable
  // from user/assistant turns. Same setMessages pattern as the
  // reincarnation handler above — append-only, no replace.
  useTauriEvent<BladeForgeLinePayload>(BLADE_EVENTS.BLADE_FORGE_LINE, (e) => {
    const { phase, detail } = e.payload;
    const forgeMsg: ChatStreamMessage = {
      id: crypto.randomUUID(),
      role: 'system',
      // Content carries the phase label + detail so the bubble renders
      // readable text even if MessageBubble doesn't (yet) consume
      // forgePhase. Keeps the surface graceful-degrading.
      content: `${phase.replace('_', ' ')} — ${detail}`,
      createdAt: Date.now(),
      forgePhase: phase,
    };
    setMessages((prev) => [...prev, forgeMsg]);
  });

  // Cancel any pending rAF when the provider unmounts (route change).
  useEffect(() => {
    return () => {
      rafScheduledRef.current = false;
    };
  }, []);

  // ── Public actions ────────────────────────────────────────────────────────

  // Hold the latest committed `messages` in a ref so `send` doesn't churn its
  // identity on every message append (avoids re-subscribing downstream
  // consumers unnecessarily).
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  // Phase 34 / BL-01 + BL-02 — keep activeSessionId in a ref so `send` can
  // read the latest value without re-subscribing every consumer when the id
  // changes (e.g. immediately after resumeSession).
  const activeSessionIdRef = useRef<string | null>(activeSessionId);
  activeSessionIdRef.current = activeSessionId;

  const send = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    const userMsg: ChatStreamMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: trimmed,
      createdAt: Date.now(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setStatus('streaming');

    // wireMsgs: only user/assistant turns map cleanly to ChatMessage.role.
    // Tool / system rows synthesized on resume have role values that the
    // ChatMessage type already accepts, so this filter narrows by content
    // existence, not role.
    const wireMsgs: ChatMessage[] = [...messagesRef.current, userMsg].map((m) => ({
      role: m.role,
      content: m.content,
      // image_base64 optional per src/types/messages.ts — omit for text turns.
    }));

    try {
      // Phase 34 / BL-01 + BL-02 — thread the active session_id through. When
      // null (fresh chat that hasn't sent its first message yet), Rust generates
      // a fresh ULID. When set (resumed conversation OR set on the first turn
      // of a fresh chat by the future "claim id" path), the Rust SessionWriter
      // appends to the SAME JSONL and the carry-over registry persists.
      await sendMessageStream(wireMsgs, activeSessionIdRef.current ?? undefined);
    } catch (err) {
      // Fallback surface — Rust emits chat_error with a friendly message on
      // most error paths (fast path + provider failures), but any path that
      // bubbles an Err without emitting lands here. Render something visible
      // so the chat is never silent.
      const alreadySurfacedViaEvent = messagesRef.current.some(
        (m) => m.role === 'system' && m.isError && Date.now() - m.createdAt < 2000,
      );
      if (!alreadySurfacedViaEvent) {
        const errText =
          err instanceof Error ? err.message : typeof err === 'string' ? err : 'Unknown error';
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: 'system',
            content: errText,
            createdAt: Date.now(),
            isError: true,
          },
        ]);
      }
      setStatus('error');
      if (import.meta.env.DEV) {
        // Message content intentionally NOT logged (T-03-03-05 accept).
        console.error('[chat] send failed', err);
      }
    }
  }, []);

  const cancel = useCallback(async () => {
    try {
      await cancelChat();
    } catch (err) {
      if (import.meta.env.DEV) console.error('[chat] cancel failed', err);
    }
    // Note: the Rust-side cancel emits CHAT_CANCELLED which performs the
    // authoritative state reset. We call it eagerly here for snappy UI in
    // case the event is delayed.
    setStatus('idle');
  }, []);

  const approveTool = useCallback(async (approvalId: string) => {
    try {
      await respondToolApproval({ approvalId, approved: true });
    } finally {
      setToolApprovalRequest(null);
    }
  }, []);

  const denyTool = useCallback(async (approvalId: string) => {
    try {
      await respondToolApproval({ approvalId, approved: false });
    } finally {
      setToolApprovalRequest(null);
    }
  }, []);

  // ── Phase 4 Plan 04-06 (D-102/D-116) — retroactive user-turn injection ────
  // The Rust side (commands.rs::quickask_submit, Plan 04-01 D-93) already
  // kicked off streaming before the main-window UI knew about the query.
  // This action syncs the user's turn into the history array so the chat
  // panel shows the full conversation when the user pops /chat open.
  // Does NOT call sendMessageStream — the backend stream is already live.
  const injectUserMessage = useCallback(
    (m: { id: string; content: string }) => {
      setMessages((prev) => [
        ...prev,
        { id: m.id, role: 'user', content: m.content, createdAt: Date.now() },
      ]);
    },
    [],
  );

  // Phase 34 / BL-02 (REVIEW finding) — replace the chat history wholesale
  // for the resume hand-off. Wipes any in-flight streaming buffers so the
  // resumed turns render cleanly even if the user clicked Resume mid-stream.
  const setHistory = useCallback((nextMessages: ChatStreamMessage[]) => {
    tokenBufRef.current = '';
    thinkBufRef.current = '';
    streamingContentRef.current = '';
    thinkingContentRef.current = '';
    currentMessageIdRef.current = null;
    setStreamingContent('');
    setThinkingContent('');
    setCurrentMessageId(null);
    setMessages(nextMessages);
    setStatus('idle');
  }, []);

  // Phase 34 / BL-01 + BL-02 — set the active session_id (typically right
  // after `resumeSession` returns). Subsequent `send` calls will thread this
  // id to the Rust side so the JSONL append target + carry-over registry
  // bucket match the resumed conversation.
  const setActiveSessionId = useCallback((id: string | null) => {
    setActiveSessionIdState(id);
  }, []);

  const value: ChatStateValue = {
    messages,
    status,
    streamingContent,
    thinkingContent,
    currentMessageId,
    toolApprovalRequest,
    tokenRatio,
    routing,
    activeSessionId,
    send,
    cancel,
    approveTool,
    denyTool,
    injectUserMessage,
    setHistory,
    setActiveSessionId,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

// ---------------------------------------------------------------------------
// useChatCtx hook — consumer entry point.
// ---------------------------------------------------------------------------

export function useChatCtx(): ChatStateValue {
  const v = useContext(Ctx);
  if (!v) {
    throw new Error(
      'useChatCtx must be used inside <ChatProvider> — mounted by src/windows/main/MainShell.tsx (Phase 4 D-116 hoist).',
    );
  }
  return v;
}
