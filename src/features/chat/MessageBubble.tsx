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
// Phase 36 Plan 36-08 (INTEL-06):
//   • Committed user messages flow through `renderWithAnchors`, which
//     splits on the unified backend regex and substitutes inline AnchorChip
//     components for @screen / @file: / @memory: tokens. Disabled
//     (verbatim text) when `config.intelligence.context_anchor_enabled =
//     false` — mirrors the backend toggle (anchor_parser.rs gate).
//   • Streaming bubbles (assistant) are NOT walked through the renderer;
//     project_chat_streaming_contract (MEMORY.md) requires per-token
//     append-only for the live bubble, and assistant tokens never contain
//     user-typed @-syntax anyway.
//
// Phase 47 (FORGE-02):
//   • Forge chat-lines (system-role messages with `forgePhase` set) get
//     a dedicated `chat-bubble-forge chat-bubble-forge-<phase>` class
//     pair and a hammer-glyph prefix so the gap_detected → writing →
//     testing → registered → retrying sequence reads as a distinct band
//     of the chat stream, not as a stack of system errors.
//
// @see .planning/phases/03-dashboard-chat-settings/03-CONTEXT.md §D-70, §D-72
// @see .planning/phases/03-dashboard-chat-settings/03-PATTERNS.md §5
// @see .planning/phases/36-context-intelligence/36-08-PLAN.md
// @see .planning/phases/47-forge-wire/47-CONTEXT.md
// @see ./AnchorChip.tsx

import { useConfig } from '@/lib/context';
import { renderWithAnchors } from './AnchorChip';
import { ReasoningThinking } from './ReasoningThinking';
import type { ChatStreamMessage } from './useChat';

interface MessageBubbleProps {
  msg: ChatStreamMessage;
  /** True when this bubble is the live in-progress assistant turn (pulsing). */
  streaming?: boolean;
}

export function MessageBubble({ msg, streaming = false }: MessageBubbleProps) {
  const { config } = useConfig();
  // Phase 47 (FORGE-02) — forge chat-lines are system-role messages with a
  // `forgePhase` tag. They get a dedicated class + phase-coded modifier so
  // CSS can tint the border per phase (failed = error red, registered =
  // success green, others = neutral forge accent).
  const forgePhase = msg.forgePhase;
  const cls =
    `chat-bubble chat-bubble-${msg.role}` +
    (streaming ? ' chat-bubble-streaming' : '') +
    (forgePhase ? ` chat-bubble-forge chat-bubble-forge-${forgePhase}` : '');
  // Zero-width non-breaking space keeps an empty streaming bubble tall enough
  // to be visible before the first token lands (prevents layout snap).
  // Forge lines are prefixed with the hammer/anvil glyph so the eye can
  // scan past them in the chat stream.
  const body = forgePhase
    ? `⚒ ${msg.content}`
    : msg.content || (streaming ? '' : ' ');

  // BladeConfig ships the IntelligenceConfig sub-struct via get_config's
  // serde_json passthrough (`[k: string]: unknown` in the TS type). Default
  // to `true` if the field is absent — matches the Rust default
  // (`default_context_anchor_enabled() -> true`, config.rs:693).
  const intelligence = (config as Record<string, unknown>).intelligence as
    | { context_anchor_enabled?: boolean }
    | undefined;
  const anchorEnabled = intelligence?.context_anchor_enabled ?? true;

  // Committed user messages get the anchor renderer; streaming bubbles +
  // assistant/system messages render verbatim. msg.content is a plain string
  // (not user-controlled markup), so the renderer's React-children path is
  // safe for any user-typed payload.
  const renderContent =
    !streaming && msg.role === 'user' && typeof body === 'string'
      ? renderWithAnchors(body, anchorEnabled)
      : body;

  return (
    <article
      className={cls}
      data-message-id={msg.id}
      data-role={msg.role}
      data-forge-phase={forgePhase ?? undefined}
    >
      {msg.thinking ? (
        <ReasoningThinking thinking={msg.thinking} defaultOpen={streaming} />
      ) : null}
      <div className="chat-content">{renderContent}</div>
    </article>
  );
}
