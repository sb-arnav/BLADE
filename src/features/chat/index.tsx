// src/features/chat/index.tsx — Phase 3 Chat feature route (D-67 mounting site).
//
// ChatPanelRoute mounts <ChatProvider> + <ChatPanel/>. The provider lives at
// route level — NOT at MainShell — so unmount-on-navigate cleanly tears down
// all event subscriptions (P-06 listener-leak guarantee preserved across
// Chat → Dashboard × 5 route churn).
//
// Lazy wrapper imports useChat + ChatPanel in parallel (Promise.all) so the
// chunk split minimizes first-paint work. chat.css is imported here at the
// module top so Vite bundles the styles alongside the route chunk.
//
// RouteDefinition id stays 'chat' (Phase 1 registration preserved — D-40 +
// migration-ledger row unchanged). shortcut 'Mod+/' also preserved.
//
// @see .planning/phases/03-dashboard-chat-settings/03-CONTEXT.md §D-67, §D-69
// @see .planning/phases/03-dashboard-chat-settings/03-PATTERNS.md §3

import { lazy } from 'react';
import type { RouteDefinition } from '@/lib/router';
import './chat.css';

const ChatPanelRoute = lazy(async () => {
  const [{ ChatProvider }, { ChatPanel }] = await Promise.all([
    import('./useChat'),
    import('./ChatPanel'),
  ]);
  const Component = () => (
    <ChatProvider>
      <ChatPanel />
    </ChatProvider>
  );
  return { default: Component };
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
