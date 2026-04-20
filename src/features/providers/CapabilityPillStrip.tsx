// src/features/providers/CapabilityPillStrip.tsx — Phase 11 Plan 11-03.
//
// Renders a 4-pill capability strip (vision / audio / tools / ctx) derived
// from a ProviderCapabilityRecord, plus an optional Re-probe icon button.
// Used in two places:
//   1. Settings → Providers row (per-provider capability display, D-52)
//   2. ProviderPasteForm probe-success state (after paste probe, UI-SPEC
//      Cross-Surface Consistency Invariant #2)
//
// The component never infers capabilities client-side — every pill tone is
// driven by the ProviderCapabilityRecord fields returned by Rust's
// probe_provider_capabilities (Plan 11-02). This keeps the strip tamper-proof
// against user JS (T-11-15 threat register entry).
//
// Props:
//   provider: string     — provider id ('anthropic', 'openai', etc.)
//   record:   ProviderCapabilityRecord | null — null = not probed yet
//   onReprobe: () => void | undefined — when provided, renders the ↻ button
//   busy:     boolean — spinner inside the re-probe button while in flight
//
// Copy is locked per UI-SPEC Copywriting Contract (re-probe aria-label is
// verbatim: `Re-probe {provider} capabilities`).
//
// @see .planning/phases/11-smart-provider-setup/11-UI-SPEC.md Surface B
// @see .planning/phases/11-smart-provider-setup/11-PATTERNS.md §8
// @see src/types/provider.ts ProviderCapabilityRecord

import { Button, GlassSpinner, Pill } from '@/design-system/primitives';
import type { ProviderCapabilityRecord } from '@/types/provider';

import './providers.css';

export interface CapabilityPillStripProps {
  provider: string;
  record: ProviderCapabilityRecord | null;
  onReprobe?: () => void;
  busy?: boolean;
}

/**
 * Format a context window count as a short label — 128000 → "128k",
 * 200000 → "200k", 1_000_000 → "1m", 2_097_152 → "2m". Round-down
 * truncation so we never over-promise (UI-SPEC Copywriting: pill text).
 */
function formatCtx(n: number): string {
  if (n >= 1_000_000) return `${Math.floor(n / 1_000_000)}m`;
  if (n >= 1000) return `${Math.floor(n / 1000)}k`;
  return String(n);
}

export function CapabilityPillStrip({
  provider,
  record,
  onReprobe,
  busy = false,
}: CapabilityPillStripProps) {
  const visionTone = record?.vision ? 'free' : 'default';
  const audioTone = record?.audio ? 'free' : 'default';
  const toolsTone = record?.tool_calling ? 'free' : 'default';
  // Long-context pill (>=100k) is visually distinct — `pro` tone uses
  // var(--a-cool) per UI-SPEC Color table.
  const ctxTone = record
    ? record.context_window >= 100_000
      ? 'pro'
      : 'free'
    : 'default';

  return (
    <ul
      className="capability-strip"
      role="list"
      aria-label={`${provider} capabilities`}
    >
      <li className="capability-strip__item">
        <Pill tone={visionTone}>
          {record ? (record.vision ? '✓ vision' : '✗ vision') : '— vision'}
        </Pill>
      </li>
      <li className="capability-strip__item">
        <Pill tone={audioTone}>
          {record ? (record.audio ? '✓ audio' : '✗ audio') : '— audio'}
        </Pill>
      </li>
      <li className="capability-strip__item">
        <Pill tone={toolsTone}>
          {record ? (record.tool_calling ? '✓ tools' : '✗ tools') : '— tools'}
        </Pill>
      </li>
      <li className="capability-strip__item">
        <Pill tone={ctxTone}>
          {record ? `✓ ${formatCtx(record.context_window)} ctx` : '— ctx ?'}
        </Pill>
      </li>
      {onReprobe ? (
        <li className="capability-strip__item">
          <Button
            variant="icon"
            size="sm"
            onClick={onReprobe}
            aria-label={`Re-probe ${provider} capabilities`}
            disabled={busy}
          >
            {busy ? <GlassSpinner size={12} /> : '↻'}
          </Button>
        </li>
      ) : null}
    </ul>
  );
}
