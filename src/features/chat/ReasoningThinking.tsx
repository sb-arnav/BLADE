// src/features/chat/ReasoningThinking.tsx — Collapsible thinking block (D-72 / CHAT-08).
//
// Native <details>/<summary> for keyboard + a11y for free. No third-party
// disclosure widget; the browser handles open/close, focus, and ARIA.
//
// Default closed for committed messages; default open while streaming so the
// user sees reasoning land in real time. Once collapsed by the user, native
// <details> remembers the state for the lifetime of the element — re-opening
// only happens on remount (next assistant turn).
//
// Selectors `.chat-thinking-details` + `.chat-thinking-summary` + `.chat-thinking`
// are styled in chat.css (Plan 03-03 + extensions in this plan).
//
// @see .planning/phases/03-dashboard-chat-settings/03-CONTEXT.md §D-72
// @see .planning/phases/03-dashboard-chat-settings/03-PATTERNS.md §5

interface ReasoningThinkingProps {
  thinking: string;
  /** Open by default while the assistant is mid-stream; closed once committed. */
  defaultOpen?: boolean;
}

export function ReasoningThinking({ thinking, defaultOpen = false }: ReasoningThinkingProps) {
  if (!thinking) return null;
  return (
    <details className="chat-thinking-details" open={defaultOpen || undefined}>
      <summary className="chat-thinking-summary">Thinking</summary>
      <div className="chat-thinking">{thinking}</div>
    </details>
  );
}
