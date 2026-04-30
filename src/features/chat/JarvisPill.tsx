// src/features/chat/JarvisPill.tsx — Phase 18 (JARVIS-11) inline pill rendered
// in MessageList on `jarvis_intercept` events.
//
// D-18 state mapping (CONTEXT.md):
//   intercepting → "Detecting capability gap…"          tone="default"
//   installing   → "Installing {capability}…"           tone="warn"
//   retrying     → "Retrying with {capability}…"        tone="warn"
//   hard_refused → "Couldn't complete: {reason}"        tone="hot" + dismiss
//
// Composes the existing Badge primitive — NO new design tokens introduced
// (memory project_ghost_css_tokens.md: ghost tokens broke v1.1; never again).
//
// Auto-clear semantics (non-hard_refused): owned by MessageList parent —
// when the next BLADE_MESSAGE_START / CHAT_DONE arrives the parent clears
// the pill state. Hard-refused stays until user dismisses.
//
// T-18-06 mitigation: JarvisInterceptPayload only carries action/capability/
// reason — no token/secret fields. Backend emit signature precludes addition.
//
// @see .planning/phases/18-jarvis-ptt-cross-app/18-CONTEXT.md §D-18
// @see .planning/phases/18-jarvis-ptt-cross-app/18-PATTERNS.md § JarvisPill (CREATE)

import type { HTMLAttributes } from 'react';
import { Badge } from '@/design-system/primitives';
import type { JarvisInterceptPayload } from '@/lib/events/payloads';

interface JarvisPillProps extends HTMLAttributes<HTMLDivElement> {
  payload: JarvisInterceptPayload | null;
  onDismiss?: () => void;
}

export function JarvisPill({ payload, onDismiss, className = '', ...rest }: JarvisPillProps) {
  if (!payload) return null;

  const { action, capability, reason } = payload;

  const text = (() => {
    switch (action) {
      case 'intercepting':
        return 'Detecting capability gap…';
      case 'installing':
        return `Installing ${capability ?? 'capability'}…`;
      case 'retrying':
        return `Retrying with ${capability ?? 'capability'}…`;
      case 'hard_refused':
        return `Couldn't complete: ${reason ?? 'no capability'}`;
    }
  })();

  const tone = (() => {
    switch (action) {
      case 'intercepting':
        return 'default' as const;
      case 'installing':
      case 'retrying':
        return 'warn' as const;
      case 'hard_refused':
        return 'hot' as const;
    }
  })();

  const cls = ['jarvis-pill', className].filter(Boolean).join(' ');

  return (
    <div className={cls} aria-live="polite" {...rest}>
      <Badge tone={tone}>{text}</Badge>
      {action === 'hard_refused' && onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          className="jarvis-pill-dismiss"
          aria-label="Dismiss JARVIS notification"
        >
          ×
        </button>
      ) : null}
    </div>
  );
}
