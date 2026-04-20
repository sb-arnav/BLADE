// src/features/providers/useCapability.ts — Phase 11 Plan 11-05 (D-54).
//
// Hook that answers "does any currently-configured provider support
// `capability`?" + returns a ready-to-call deep-link opener that navigates
// the main shell to Settings → Providers with a { needs: capability } hint
// so ProvidersPane scroll-focuses the paste textarea.
//
// Contract:
//   - `hasCapability === false` whenever provider_capabilities is empty
//     (cold install) or no record has the relevant flag set.
//   - `openAddFlow()` is a stable callback; safe to pass to onClick without
//     memoizing at the consumer.
//
// `tools` is derived from `tool_calling` on the ProviderCapabilityRecord —
// the record shape uses snake_case verbatim (D-38).
//
// @see src/features/providers/CAPABILITY_SURFACES.ts
// @see src/types/provider.ts (ProviderCapabilityRecord)
// @see .planning/phases/11-smart-provider-setup/11-RESEARCH.md §useCapability hook
// @see .planning/phases/11-smart-provider-setup/11-CONTEXT.md §D-54

import { useCallback, useMemo } from 'react';
import { useConfig } from '@/lib/context';
import { useRouterCtx } from '@/windows/main/useRouter';
import type { ProviderCapabilityRecord } from '@/types/provider';
import type { Capability } from './CAPABILITY_SURFACES';

export interface UseCapabilityResult {
  /** True when at least one configured provider's record has the flag set. */
  hasCapability: boolean;
  /** Deep-link: opens Settings → Providers with { needs: capability }. */
  openAddFlow: () => void;
}

export function useCapability(capability: Capability): UseCapabilityResult {
  const { config } = useConfig();
  const { openRoute } = useRouterCtx();

  const hasCapability = useMemo(() => {
    const raw = (config as Record<string, unknown>).provider_capabilities;
    if (!raw || typeof raw !== 'object') return false;
    const records = Object.values(raw as Record<string, ProviderCapabilityRecord>);
    if (records.length === 0) return false;
    return records.some((rec) => {
      if (!rec || typeof rec !== 'object') return false;
      if (capability === 'tools') return rec.tool_calling === true;
      // 'vision' | 'audio' | 'long_context'
      return (rec as unknown as Record<string, unknown>)[capability] === true;
    });
  }, [config, capability]);

  const openAddFlow = useCallback(() => {
    openRoute('settings-providers', { needs: capability });
  }, [openRoute, capability]);

  return { hasCapability, openAddFlow };
}
