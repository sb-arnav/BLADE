// src/features/chat/index.tsx — Chat feature routes.
// Phase 1 stub per D-26 step 7, D-44. Phase 3 replaces with real streaming Chat
// (CHAT-01..10, WIRE-03/04/06 consumers).
//
// @see .planning/phases/01-foundation/01-CONTEXT.md §D-40

import { lazy } from 'react';
import type { RouteDefinition } from '@/lib/router';

const skeleton = (label: string, phase: number) =>
  lazy(async () => {
    const { ComingSoonSkeleton } = await import('@/design-system/primitives');
    const Component = () => <ComingSoonSkeleton routeLabel={label} phase={phase} />;
    return { default: Component };
  });

export const routes: RouteDefinition[] = [
  {
    id: 'chat',
    label: 'Chat',
    section: 'core',
    component: skeleton('Chat', 3),
    phase: 3,
    shortcut: 'Mod+/',
    description: 'Conversational AI',
  },
];
