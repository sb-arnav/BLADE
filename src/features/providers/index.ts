// src/features/providers/index.ts — Phase 11 barrel.
//
// Combined exports from Plan 11-03 (paste-form components) and
// Plan 11-05 (capability surface API). Both plans contributed to this
// barrel in Wave 1 — the final file is their union.
//
// Plan 11-03:
//   • ProviderPasteForm — paste-any-config textarea + 6-state machine
//   • CapabilityPillStrip — per-provider capability pill row
//   • FallbackOrderList — drag-reorder fallback provider chain
//
// Plan 11-05:
//   • CapabilityGap — empty-state composer with locked copy
//   • useCapability — hook returning { hasCapability, openAddFlow }
//   • CAPABILITY_SURFACES — route registry for PROV-07/08 coverage checks
//   • Capability — type alias for the 4-valued capability union

export { ProviderPasteForm } from './ProviderPasteForm';
export type { ProviderPasteFormProps } from './ProviderPasteForm';

export { CapabilityPillStrip } from './CapabilityPillStrip';
export type { CapabilityPillStripProps } from './CapabilityPillStrip';

export { FallbackOrderList } from './FallbackOrderList';
export type { FallbackOrderListProps } from './FallbackOrderList';

export { CapabilityGap } from './CapabilityGap';
export type { CapabilityGapProps } from './CapabilityGap';
export { useCapability } from './useCapability';
export type { UseCapabilityResult } from './useCapability';
export { CAPABILITY_SURFACES, CAPABILITIES } from './CAPABILITY_SURFACES';
export type { Capability } from './CAPABILITY_SURFACES';
