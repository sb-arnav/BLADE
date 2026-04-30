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
// FORWARD-POINTER (Plan 14 supersedes — same wave): the handleDecide handler
// below ships a Wave-4 SIMPLIFICATION:
//   - allow_always / denied → consentSetDecision(...) then re-invoke
//     jarvisDispatchAction(...) which re-checks consent.
//   - allow_once → re-invoke without persisting; the dispatcher will see
//     NeedsPrompt again (acceptable v1.2 limitation).
//   - The re-invoke uses target_service from the payload but loses the
//     original action verb (TODO marker below). It assumes 'post' as the
//     default — covers the cold-install demo prompt only.
// Plan 14 Task 4 REPLACES this whole handler with a single
// `consentRespond(payload.request_id, choice)` call: the dispatcher then
// resumes via tokio::oneshot in-place, no re-invoke needed, and the original
// action verb is preserved. Plan 14 lands AFTER Plan 11 in Wave 4.
//
// @see .planning/phases/03-dashboard-chat-settings/03-CONTEXT.md §D-67..D-73
// @see .planning/phases/03-dashboard-chat-settings/03-PATTERNS.md §3,§4,§5,§6
// @see .planning/phases/18-jarvis-ptt-cross-app/18-CONTEXT.md §D-08, §D-13
// @see .planning/phases/18-jarvis-ptt-cross-app/18-14-PLAN.md (final handler shape)

import { useCallback, useState } from 'react';
import { Pill } from '@/design-system/primitives';
import { BLADE_EVENTS, useTauriEvent, type Event } from '@/lib/events';
import type { ConsentRequestPayload } from '@/lib/events/payloads';
import { consentSetDecision, jarvisDispatchAction } from '@/lib/tauri/admin';
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

  const handleDecide = useCallback(
    async (decision: ConsentChoice) => {
      const cur = pendingConsent;
      if (!cur) return;
      const { intent_class, target_service } = cur;

      // Persist allow_always / denied. allow_once is NEVER persisted
      // (RESEARCH Open Q1 / T-18-CARRY-15) — Rust-side validation will reject
      // it, so we don't even attempt.
      if (decision === 'allow_always' || decision === 'denied') {
        try {
          await consentSetDecision(intent_class, target_service, decision);
        } catch (err) {
          if (import.meta.env.DEV) {
            console.error('[consent] persist failed:', err);
          }
        }
      }

      // Re-invoke dispatch with persisted (or one-shot) decision.
      // FORWARD-POINTER: Plan 14 Task 4 replaces this entire branch with a
      // single consentRespond(request_id, choice) call — the dispatcher
      // awaits the oneshot and resumes in-place, preserving the original
      // action verb. Plan 11 ships the Wave-4 simplification below.
      if (decision !== 'denied') {
        try {
          await jarvisDispatchAction({
            kind: 'action_required',
            service: target_service,
            // TODO(plan-14): preserve original action — Wave-4 simplification.
            action: 'post',
          });
        } catch (err) {
          if (import.meta.env.DEV) {
            console.error('[dispatch] re-invoke failed:', err);
          }
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
