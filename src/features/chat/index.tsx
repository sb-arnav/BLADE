// src/features/chat/index.tsx — Chat feature route + ChatProvider barrel.
//
// Phase 3 originally mounted <ChatProvider> here (D-69 route-level). Phase 4
// Plan 04-06 (D-116) hoists the provider to MainShell so QuickAskBridge can
// inject bridged user-turns into `messages[]` regardless of the current
// route. ChatPanelRoute now just renders <ChatPanel/> — it relies on the
// ambient ChatProvider supplied by MainShell.
//
// Lazy wrapper keeps the ChatPanel chunk split so the initial bundle stays
// lean. chat.css is imported here at the module top so Vite bundles the
// styles alongside the route chunk.
//
// RouteDefinition id stays 'chat' (Phase 1 registration preserved — D-40 +
// migration-ledger row unchanged). shortcut 'Mod+/' also preserved.
//
// @see .planning/phases/03-dashboard-chat-settings/03-CONTEXT.md §D-67, §D-69
// @see .planning/phases/04-overlay-windows/04-CONTEXT.md §D-116
// @see .planning/phases/03-dashboard-chat-settings/03-PATTERNS.md §3

import { lazy } from 'react';
import type { RouteDefinition } from '@/lib/router';
import './chat.css';

// Re-export ChatProvider + useChatCtx from the feature barrel so MainShell
// (Phase 4 D-116 hoist) and QuickAskBridge (Plan 04-06) can import via
// `@/features/chat` without reaching into useChat.tsx directly.
export { ChatProvider, useChatCtx } from './useChat';
export type {
  ChatStateValue,
  ChatStatus,
  ChatStreamMessage,
} from './useChat';

// Phase 4 Plan 04-06 — cross-window bridge consumer (mounted in MainShell).
export { QuickAskBridge } from './QuickAskBridge';

// Phase 11 Plan 11-05 — long-context capability-gap wrapper. Consumers can
// import this directly in e2e tests or dev-isolation routes.
export { ChatView } from './ChatView';
export { ChatPanel } from './ChatPanel';

// Phase 11 Plan 11-05 — route mounts ChatView (consumer-site long-context
// capability-gap wrapper around ChatPanel). useChat.tsx is untouched; the
// capability wiring lives at this consumer only (committed Option B).
const ChatRoute = lazy(async () => {
  const { ChatView } = await import('./ChatView');
  return { default: ChatView };
});

export const routes: RouteDefinition[] = [
  {
    id: 'chat',
    label: 'Chat',
    section: 'core',
    component: ChatRoute,
    phase: 3,
    shortcut: 'Mod+/',
    description: 'Conversational AI',
  },
];
