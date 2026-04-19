// src/features/chat/MessageBubble.tsx — Single message visual (D-70).
//
// Plan 03-03 shipped the bubble structure + content rendering. Plan 03-04
// extends with the ReasoningThinking <details> element above the content
// when `msg.thinking` is populated (reasoning-capable model). Default-open
// while the bubble is still streaming so the user sees thinking land live;
// default-closed once committed.
//
// Rendering discipline (D-70 / SC-5):
//   • Bubble background is a solid rgba() fill from chat.css — NO
//     backdrop-filter. The phase-level budget of 3 backdrop-filter layers
//     per viewport is consumed by the dashboard hero + ambient strip +
//     nav rail; adding blur per bubble during streaming blows past the cap.
//
// @see .planning/phases/03-dashboard-chat-settings/03-CONTEXT.md §D-70, §D-72
// @see .planning/phases/03-dashboard-chat-settings/03-PATTERNS.md §5

import { ReasoningThinking } from './ReasoningThinking';
import type { ChatStreamMessage } from './useChat';

interface MessageBubbleProps {
  msg: ChatStreamMessage;
  /** True when this bubble is the live in-progress assistant turn (pulsing). */
  streaming?: boolean;
}

export function MessageBubble({ msg, streaming = false }: MessageBubbleProps) {
  const cls =
    `chat-bubble chat-bubble-${msg.role}` + (streaming ? ' chat-bubble-streaming' : '');
  // Zero-width non-breaking space keeps an empty streaming bubble tall enough
  // to be visible before the first token lands (prevents layout snap).
  const body = msg.content || (streaming ? '' : '\u00A0');
  return (
    <article className={cls} data-message-id={msg.id} data-role={msg.role}>
      {msg.thinking ? (
        <ReasoningThinking thinking={msg.thinking} defaultOpen={streaming} />
      ) : null}
      <div className="chat-content">{body}</div>
    </article>
  );
}
