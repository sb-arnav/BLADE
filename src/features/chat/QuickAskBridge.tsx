// src/features/chat/QuickAskBridge.tsx
//
// Phase 4 Plan 04-06 (D-102, D-116) — main-window consumer of the
// `blade_quickask_bridged` cross-window event emitted by the Rust
// `quickask_submit` bridge (Plan 04-01 D-93).
//
// Flow:
//   QuickAsk window submit → Rust quickask_submit
//     → emits blade_quickask_bridged to main
//     → this component (mounted inside <ChatProvider> in MainShell):
//         1. `injectUserMessage({id, content: query})` — syncs the user turn
//            into the shared ChatProvider history so /chat shows it.
//         2. `openRoute('chat')` — auto-navigates main-window to /chat so
//            the conversation is immediately visible.
//         3. `show({type: 'info', title: 'Quick ask bridged', ...})` —
//            surfaces a non-intrusive confirmation toast (query truncated
//            to 80 chars per T-04-06-02 mitigation).
//
// Returns null — zero DOM, event subscription only.
//
// @see .planning/phases/04-overlay-windows/04-CONTEXT.md §D-102, §D-116
// @see .planning/phases/04-overlay-windows/04-06-PLAN.md Task 2
// @see .planning/phases/04-overlay-windows/04-PATTERNS.md §10, §11

import { BLADE_EVENTS, useTauriEvent } from '@/lib/events';
import type { BladeQuickAskBridgedPayload } from '@/lib/events';
import { useToast } from '@/lib/context';
import { useRouterCtx } from '@/windows/main/useRouter';
import { useChatCtx } from './useChat';

/**
 * Extended payload shape: Rust Plan 04-01 emits both `message_id`
 * (assistant turn) and `user_message_id` (user turn) alongside the Phase 3
 * stub's original fields. The intersection type is defensive in case
 * payloads.ts is tightened later — today the extra fields arrive but are
 * not declared on the interface.
 */
type QuickAskBridgedExtended = BladeQuickAskBridgedPayload & {
  message_id?: string;
  user_message_id?: string;
  source_window?: string;
};

/** Toast preview — cap at 80 chars so a long query doesn't overflow the toast. */
const TOAST_PREVIEW_MAX = 80;
function truncatePreview(q: string): string {
  if (q.length <= TOAST_PREVIEW_MAX) return q;
  return q.slice(0, TOAST_PREVIEW_MAX) + '…';
}

export function QuickAskBridge() {
  const { injectUserMessage } = useChatCtx();
  const { openRoute } = useRouterCtx();
  const { show } = useToast();

  useTauriEvent<QuickAskBridgedExtended>(
    BLADE_EVENTS.BLADE_QUICKASK_BRIDGED,
    (e) => {
      const { query, user_message_id, message_id } = e.payload;
      // Prefer the user_message_id from Rust (Plan 04-01); fall back to a
      // derived id keyed off message_id so the UI still gets a stable key
      // even if the Phase 3 shape is emitted unexpectedly.
      const userId =
        user_message_id ??
        (message_id ? `u-${message_id}` : `u-${Date.now()}`);
      injectUserMessage({ id: userId, content: query });
      openRoute('chat');
      show({
        type: 'info',
        title: 'Quick ask bridged',
        message: truncatePreview(query),
      });
    },
  );

  return null;
}
