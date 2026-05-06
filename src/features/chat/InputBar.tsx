// src/features/chat/InputBar.tsx — Send / cancel / Enter-to-send composer.
//
// Layout: single-row flex — text input expands, trailing button flips between
// Send (idle) and Cancel (streaming / thinking / awaiting_tool / error).
//
// Keyboard: Enter submits, Shift+Enter inserts a newline. The Input primitive
// is a plain <input> (not textarea) so Shift+Enter won't visually wrap; the
// plan tolerates this until Phase 9 upgrades to a textarea composer.
//
// Send discipline: the `send` closure in useChatCtx already guards against
// empty messages; this file additionally guards the Send button's `disabled`
// prop and the onSend handler so the UX is responsive (no blank submissions).
//
// Phase 34 / Plan 34-11 — RES-03 cost-meter chip. Subscribes to
// blade_loop_event { kind: 'cost_update' } via useTauriEvent (D-13). Every
// loop_engine iteration emits a cost_update tick (Plan 34-06; unconditional
// emit at iteration end), so the chip stays current even when smart features
// are off (the backend still emits at $0/$25). Color-shifts at 50% (mid),
// 80% (warn), 100% (danger) per CONTEXT lock §RES-03.
//
// @see .planning/phases/03-dashboard-chat-settings/03-CONTEXT.md §D-67
// @see .planning/phases/03-dashboard-chat-settings/03-PATTERNS.md §5
// @see .planning/phases/34-resilience-session/34-CONTEXT.md §RES-03

import {
  useCallback,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { Button, Input } from '@/design-system/primitives';
import { BLADE_EVENTS, useTauriEvent } from '@/lib/events';
import type { BladeLoopEventPayload } from '@/lib/events/payloads';
import { useChatCtx } from './useChat';

interface CostState {
  spent_usd: number;
  cap_usd: number;
  percent: number;
}

export function InputBar() {
  const { send, cancel, status } = useChatCtx();
  const [text, setText] = useState('');
  const busy = status !== 'idle' && status !== 'error';

  // Phase 34 / RES-03 — live cost-meter state. Null until the first
  // blade_loop_event { kind: 'cost_update' } tick arrives. Polling
  // get_conversation_cost on session load is a v1.6 follow-up — currently
  // the chat surface does not expose the active session_id at the InputBar
  // level (the Rust side resolves it implicitly via send_message_stream).
  // The live subscription below covers the steady-state UX; the chip
  // appears on the first iteration of the next conversation turn.
  const [cost, setCost] = useState<CostState | null>(null);

  useTauriEvent<BladeLoopEventPayload>(BLADE_EVENTS.BLADE_LOOP_EVENT, (e) => {
    const p = e.payload;
    if (p.kind === 'cost_update') {
      setCost({ spent_usd: p.spent_usd, cap_usd: p.cap_usd, percent: p.percent });
    }
  });

  const onSend = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setText('');
    await send(trimmed);
  }, [text, busy, send]);

  const onChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    setText(e.target.value);
  }, []);

  const onKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        void onSend();
      }
    },
    [onSend],
  );

  return (
    <div className="chat-input-bar">
      {cost && <CostMeterChip cost={cost} />}
      <Input
        value={text}
        onChange={onChange}
        onKeyDown={onKeyDown}
        placeholder={busy ? 'Streaming…' : 'Message BLADE'}
        aria-label="Message input"
      />
      {busy ? (
        <Button variant="secondary" onClick={() => void cancel()}>
          Cancel
        </Button>
      ) : (
        <Button
          variant="primary"
          onClick={() => void onSend()}
          disabled={!text.trim()}
        >
          Send
        </Button>
      )}
    </div>
  );
}

/**
 * Phase 34 / Plan 34-11 — cost-meter chip.
 *
 * Color tier:
 *   percent < 50  → neutral (default text)
 *   50..79        → mid (subtle warning tint)
 *   80..99        → warn (RES-04 80% threshold matched)
 *   100+          → danger (per-conversation halt has fired Rust-side)
 *
 * Reuses CSS custom-property tokens (var(--…)) with conservative fallbacks
 * so the chip inherits the project's palette without bespoke styling.
 */
function CostMeterChip({ cost }: { cost: CostState }) {
  const tier =
    cost.percent >= 100 ? 'danger' :
    cost.percent >= 80 ? 'warn' :
    cost.percent >= 50 ? 'mid' : 'normal';

  const style: CSSProperties = {
    fontSize: 11,
    padding: '3px 8px',
    borderRadius: 4,
    marginRight: 8,
    whiteSpace: 'nowrap',
    fontFeatureSettings: '"tnum"',
    background:
      tier === 'danger' ? 'var(--danger-bg, rgba(220,80,80,0.18))' :
      tier === 'warn'   ? 'var(--warn-bg,   rgba(220,180,60,0.16))' :
      tier === 'mid'    ? 'var(--mid-bg,    rgba(180,180,80,0.10))' :
                          'var(--surface-2, rgba(255,255,255,0.05))',
    color:
      tier === 'danger' ? 'var(--danger-fg, tomato)' :
      tier === 'warn'   ? 'var(--warn-fg,   #f1c84b)' :
                          'var(--t-2, #aaa)',
    border: '1px solid var(--surface-border, rgba(255,255,255,0.08))',
  };

  return (
    <span
      className={`cost-meter cost-meter--${tier}`}
      style={style}
      title={`Per-conversation spend: ${cost.percent}% of cap`}
      aria-label={`Cost meter: ${cost.percent} percent of cap`}
    >
      ${cost.spent_usd.toFixed(2)} / ${cost.cap_usd.toFixed(2)}
    </span>
  );
}
