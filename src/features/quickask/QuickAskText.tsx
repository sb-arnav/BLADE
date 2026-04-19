// src/features/quickask/QuickAskText.tsx (QUICK-03, QUICK-06)
//
// Text sub-view — stateless renderer. Owner (QuickAskWindow) threads query,
// busy, streaming, and history props through.
//
// Layout per docs/design/quickask.html:
//   1. <Input> — autofocus, disabled while streaming.
//   2. Response area — shown when busy || streaming; GlassSpinner placeholder
//      while awaiting first token; streaming text once tokens arrive.
//      aria-live="polite" for a11y.
//   3. History list — up to 5 recent queries, click to prefill (D-99 says
//      click-to-prefill, not click-to-submit; user confirms with Enter).
//
// Slash commands (/screenshot, /voice, /lock, /break from src.bak) are
// deferred to Phase 9 per D-99. This view handles plain text only.

import type { ChangeEvent } from 'react';
import { GlassSpinner, Input } from '@/design-system/primitives';

export interface QuickAskTextProps {
  query: string;
  onQueryChange: (e: ChangeEvent<HTMLInputElement>) => void;
  busy: boolean;
  streaming: string;
  history: string[];
  onPickHistory: (q: string) => void;
}

export function QuickAskText({
  query,
  onQueryChange,
  busy,
  streaming,
  history,
  onPickHistory,
}: QuickAskTextProps) {
  const showResponse = busy || streaming.length > 0;
  const showHistory = !busy && history.length > 0;
  return (
    <div className="quickask-text" role="region" aria-label="Quick ask text mode">
      <Input
        // eslint-disable-next-line jsx-a11y/no-autofocus
        autoFocus
        value={query}
        onChange={onQueryChange}
        placeholder="Ask BLADE…"
        disabled={busy}
        aria-label="Quick ask query"
        aria-busy={busy}
      />
      {showResponse && (
        <div className="quickask-response" aria-live="polite">
          {busy && !streaming && <GlassSpinner size={16} label="Thinking…" />}
          {streaming}
        </div>
      )}
      {showHistory && (
        <ul className="quickask-history" aria-label="Recent queries">
          {history.map((h, i) => (
            <li key={`${i}-${h}`}>
              <button type="button" onClick={() => onPickHistory(h)}>
                {h}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
