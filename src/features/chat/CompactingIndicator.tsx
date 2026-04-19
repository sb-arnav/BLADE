// src/features/chat/CompactingIndicator.tsx — Compacting pill (D-73 / CHAT-09).
//
// Rendered absolute-positioned in the top-right of ChatPanel (anchored by
// .chat-panel { position: relative; } in chat.css) when:
//   - tokenRatio is populated (BLADE_TOKEN_RATIO event has fired), AND
//   - tokenRatio.ratio > 0.65 (D-16 / D-73 threshold — do NOT parameterize
//     without revisiting those decisions), AND
//   - status !== 'idle' (don't surface compaction between turns; D-73).
//
// Displays "Compacting… N%" where N = Math.round(ratio * 100). Pill animates
// a 1.6s opacity pulse via keyframe `chatCompactPulse` defined in chat.css.
//
// Role=status + aria-live=polite so screen readers announce the compaction
// state change without interrupting.
//
// @see .planning/phases/03-dashboard-chat-settings/03-CONTEXT.md §D-16, §D-73
// @see .planning/phases/03-dashboard-chat-settings/03-PATTERNS.md §6

import { useChatCtx } from './useChat';

export function CompactingIndicator() {
  const { tokenRatio, status } = useChatCtx();
  if (!tokenRatio || tokenRatio.ratio <= 0.65 || status === 'idle') {
    return null;
  }
  const pct = Math.round(tokenRatio.ratio * 100);
  return (
    <div className="chat-compacting" role="status" aria-live="polite">
      Compacting… {pct}%
    </div>
  );
}
