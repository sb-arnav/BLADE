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

const ChatPanelRoute = lazy(async () => {
  const { ChatPanel } = await import('./ChatPanel');
  return { default: ChatPanel };
});

export const routes: RouteDefinition[] = [
  {
    id: 'chat',
    label: 'Chat',
    section: 'core',
    component: ChatPanelRoute,
    phase: 3,
    shortcut: 'Mod+/',
    description: 'Conversational AI',
  },
];
