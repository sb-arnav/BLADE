// src/features/chat/ChatPanel.tsx — Composed chat layout shell.
//
// Structure:
//   <section.chat-panel data-status={status}>
//     <header.chat-header>  [title] [routing pill]
//     <CompactingIndicator/>  (absolute top-right; appears only when ratio > 0.65)
//     <MessageList />         (committed messages + live streaming bubble)
//     <ToolApprovalDialog />  (renders portal-style via Dialog primitive when
//                              a tool_approval_needed event is pending)
//     <ConsentDialog  />      (Phase 18 — opens on consent_request events
//                              before any cross-app write)
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
// Phase 18 (JARVIS-05 / D-08): subscribes to BLADE_EVENTS.CONSENT_REQUEST via
// useTauriEvent (D-13 lock — only permitted listen surface). On a consent
// request payload, opens ConsentDialog and routes the user's decision.
//
// Plan 18-14 — `handleDecide` is a single `consentRespond(request_id, choice)`
// call. The Rust dispatcher AWAITS the user's choice via a tokio::oneshot
// channel (consent::request_consent / consent::consent_respond). No re-invoke
// of jarvisDispatchAction needed; the original action verb is preserved in
// the dispatcher's local scope. Plan 11's Wave-4 simplification (which
// hardcoded `action: 'post'` in a re-invoke) is REMOVED.
//
// @see .planning/phases/03-dashboard-chat-settings/03-CONTEXT.md §D-67..D-73
// @see .planning/phases/03-dashboard-chat-settings/03-PATTERNS.md §3,§4,§5,§6
// @see .planning/phases/18-jarvis-ptt-cross-app/18-CONTEXT.md §D-08, §D-13
// @see .planning/phases/18-jarvis-ptt-cross-app/18-14-PLAN.md (oneshot handler)

import { useCallback, useState } from 'react';
import { Pill } from '@/design-system/primitives';
import { BLADE_EVENTS, useTauriEvent, type Event } from '@/lib/events';
import type { ConsentRequestPayload } from '@/lib/events/payloads';
import { consentRespond } from '@/lib/tauri/admin';
import { CompactingIndicator } from './CompactingIndicator';
import { ConsentDialog, type ConsentChoice } from './ConsentDialog';
import { InputBar } from './InputBar';
import { MessageList } from './MessageList';
import { ToolApprovalDialog } from './ToolApprovalDialog';
import { useChatCtx } from './useChat';

export function ChatPanel() {
  const { routing, status } = useChatCtx();

  // ── Phase 18 — consent_request mount (D-08, JARVIS-05) ────────────────────
  const [pendingConsent, setPendingConsent] = useState<ConsentRequestPayload | null>(null);
  const handleConsentRequest = useCallback((e: Event<ConsentRequestPayload>) => {
    setPendingConsent(e.payload);
  }, []);
  useTauriEvent<ConsentRequestPayload>(
    BLADE_EVENTS.CONSENT_REQUEST,
    handleConsentRequest,
  );

  // Plan 18-14 — single consentRespond invocation. The Rust dispatcher's
  // oneshot await resumes in-place; allow_always/denied persistence is now
  // owned by the dispatcher (consent_set_decision is called inside the
  // AllowAlways arm of consent::request_consent). No re-invoke needed.
  const handleDecide = useCallback(
    async (decision: ConsentChoice) => {
      const cur = pendingConsent;
      if (!cur) return;
      try {
        await consentRespond(cur.request_id, decision);
      } catch (err) {
        if (import.meta.env.DEV) {
          console.error('[consent_respond] failed:', err);
        }
      }
    },
    [pendingConsent],
  );

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
      </header>
      <CompactingIndicator />
      <MessageList />
      <ToolApprovalDialog />
      <ConsentDialog
        open={!!pendingConsent}
        onClose={() => setPendingConsent(null)}
        payload={pendingConsent}
        onDecide={handleDecide}
      />
      <InputBar />
    </section>
  );
}
