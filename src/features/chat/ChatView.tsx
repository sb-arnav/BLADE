// src/features/chat/ChatView.tsx — Phase 11 Plan 11-05 (PROV-08, Option B).
//
// Route-level wrapper around <ChatPanel/> that adds the capability-gap
// banner for long-context when the conversation grows past ~65% of the
// active provider's context window AND no long-context-capable provider
// is currently configured.
//
// Design choice (Option B, COMMITTED): the capability wiring lives at the
// consumer (this View) — NOT in useChat.tsx. The hook stays pure and the
// banner follows the same "consumer-site gate" pattern used by the other
// 7 capability surfaces.
//
// Heuristic: totalChars / 4 / context_window. We read the context window
// from `config.provider_capabilities[key].context_window` where the key
// matches the active provider/model; we fall back to 8192 when absent.
// False positives are harmless — the banner is additive (the chat keeps
// rendering below it).
//
// @see src/features/chat/ChatPanel.tsx
// @see src/features/chat/useChat.tsx (UNMODIFIED — Option B invariant)
// @see .planning/phases/11-smart-provider-setup/11-CONTEXT.md §D-54

import { useMemo } from 'react';
import { useConfig } from '@/lib/context';
import { CapabilityGap, useCapability } from '@/features/providers';
import type { ProviderCapabilityRecord } from '@/types/provider';
import { ChatPanel } from './ChatPanel';
import { useChatCtx } from './useChat';

/** Threshold (0..1) at which the long-context banner surfaces. */
const LONG_CTX_RATIO_THRESHOLD = 0.65;
/** Fallback context window when no capability record is available. */
const FALLBACK_CTX = 8192;

export function ChatView() {
  const { config } = useConfig();
  const { messages, tokenRatio } = useChatCtx();
  const { hasCapability: hasLongCtx } = useCapability('long_context');

  const ctxRatio = useMemo(() => {
    // Prefer the authoritative Rust-emitted tokenRatio when present — it's
    // computed at send-time from the actual wire payload.
    if (tokenRatio && tokenRatio.ratio > 0) return tokenRatio.ratio;
    // Otherwise estimate from message content. chars/4 is the canonical
    // BPE rule-of-thumb for English text.
    const totalChars = messages.reduce((sum, m) => sum + (m.content?.length ?? 0), 0);
    const raw = (config as Record<string, unknown>).provider_capabilities;
    let ctxWindow = FALLBACK_CTX;
    if (raw && typeof raw === 'object') {
      const records = Object.values(raw as Record<string, ProviderCapabilityRecord>);
      // Pick the largest context window in the pool — matches the router's
      // "best-available" routing intent for long inputs.
      const best = records.reduce((acc, r) => {
        const cw = r && typeof r === 'object' ? (r.context_window ?? 0) : 0;
        return cw > acc ? cw : acc;
      }, 0);
      if (best > 0) ctxWindow = best;
    }
    return totalChars / 4 / ctxWindow;
  }, [messages, tokenRatio, config]);

  const showLongCtxBanner = !hasLongCtx && ctxRatio > LONG_CTX_RATIO_THRESHOLD;

  return (
    <>
      {showLongCtxBanner && (
        <CapabilityGap capability="long_context" surfaceLabel="Chat with long input" />
      )}
      <ChatPanel />
    </>
  );
}
