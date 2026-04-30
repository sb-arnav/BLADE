// src/features/chat/ConsentDialog.tsx — Phase 18 (JARVIS-05 / D-08 / D-09)
// modal consent dialog before any cross-app write action.
//
// Composes the Dialog primitive (native <dialog>) — NO blur layers (D-70 invariant)
// and NO new design tokens (memory project_ghost_css_tokens.md).
//
// D-09 content layout:
//   Title:    "Allow BLADE to {action_verb} on {target_service}?"
//   Body:     [target service] [action] [content preview <pre>]
//   Buttons:  [Allow once] (default focus, primary)
//             [Allow always]
//             [Deny] (danger)
//
// T-18-03 RENDER-LAYER LOCK (Tampering / Spoofing):
//   content_preview is rendered via React's text-node interpolation
//   (`<pre>{content_preview}</pre>`) — React auto-escapes text nodes.
//   The unsafe innerHTML attribute prop (the React API whose name combines
//   "dangerously" + "Set" + "Inner" + "HTML") is BANNED in this file by
//   acceptance grep. Backend already safe_slice's the preview to 200 chars
//   at the emit boundary (jarvis_dispatch.rs:69) — defense in depth.
//
// Wave 4 simplification: `allow_once` does NOT persist a decision; ChatPanel
// re-invokes dispatch which re-checks consent. For `allow_once` the dispatch
// will see NeedsPrompt again — acceptable v1.2 limitation. Plan 14 replaces
// this whole flow with consentRespond + tokio::oneshot so the dispatcher
// awaits the choice in-place.
//
// @see src-tauri/src/jarvis_dispatch.rs:61 emit_consent_request (sender)
// @see .planning/phases/18-jarvis-ptt-cross-app/18-CONTEXT.md §D-08, §D-09
// @see .planning/phases/18-jarvis-ptt-cross-app/18-PATTERNS.md § ConsentDialog (CREATE)

import { Dialog } from '@/design-system/primitives';
import type { ConsentRequestPayload } from '@/lib/events/payloads';

export type ConsentChoice = 'allow_once' | 'allow_always' | 'denied';

interface ConsentDialogProps {
  open: boolean;
  onClose: () => void;
  payload: ConsentRequestPayload | null;
  onDecide: (decision: ConsentChoice) => void;
  triggerRef?: React.RefObject<HTMLElement>;
}

export function ConsentDialog({
  open,
  onClose,
  payload,
  onDecide,
  triggerRef,
}: ConsentDialogProps) {
  if (!payload) return null;

  const { target_service, action_verb, content_preview } = payload;

  const decide = (choice: ConsentChoice) => {
    onDecide(choice);
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      ariaLabel={`Allow BLADE to ${action_verb} on ${target_service}?`}
      triggerRef={triggerRef}
    >
      <div className="consent-dialog">
        <header className="consent-dialog-header">
          <h3 className="consent-dialog-title">
            Allow BLADE to {action_verb} on {target_service}?
          </h3>
        </header>

        <div className="consent-dialog-body">
          <div className="consent-dialog-row">
            <span className="consent-dialog-label">Target service</span>
            <span className="consent-dialog-value">{target_service}</span>
          </div>
          <div className="consent-dialog-row">
            <span className="consent-dialog-label">Action</span>
            <span className="consent-dialog-value">{action_verb}</span>
          </div>
          <div className="consent-dialog-row consent-dialog-row-stack">
            <span className="consent-dialog-label">Content preview</span>
            {/* T-18-03: PLAIN TEXT only — React text-node interpolation
             *  auto-escapes. The unsafe innerHTML attribute prop is BANNED
             *  in this file by acceptance grep. */}
            <pre className="consent-dialog-preview">{content_preview}</pre>
          </div>
        </div>

        <footer className="consent-dialog-actions">
          <button
            type="button"
            autoFocus
            onClick={() => decide('allow_once')}
            className="btn btn-primary consent-dialog-btn"
          >
            Allow once
          </button>
          <button
            type="button"
            onClick={() => decide('allow_always')}
            className="btn btn-secondary consent-dialog-btn"
          >
            Allow always
          </button>
          <button
            type="button"
            onClick={() => decide('denied')}
            className="btn btn-secondary consent-dialog-btn consent-dialog-btn-danger"
          >
            Deny
          </button>
        </footer>
      </div>
    </Dialog>
  );
}
