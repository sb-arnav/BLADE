// src/features/providers/index.ts — Phase 11 barrel.
//
// Exports the capability surface API (Plan 11-05):
//   • CapabilityGap — empty-state composer with locked copy
//   • useCapability — hook returning { hasCapability, openAddFlow }
//   • CAPABILITY_SURFACES — route registry for PROV-07/08 coverage checks
//   • Capability — type alias for the 4-valued capability union
//
// Plan 11-03 (wave-1 sibling) ALSO adds exports to this barrel for the
// paste-form components (ProviderPasteForm, CapabilityPillStrip,
// FallbackOrderList). Both plans extend this file additively; the final
// barrel is the union of both plans' exports once both waves land.
//
// @see .planning/phases/11-smart-provider-setup/11-05-PLAN.md

export { CapabilityGap } from './CapabilityGap';
export type { CapabilityGapProps } from './CapabilityGap';
export { useCapability } from './useCapability';
export type { UseCapabilityResult } from './useCapability';
export { CAPABILITY_SURFACES, CAPABILITIES } from './CAPABILITY_SURFACES';
export type { Capability } from './CAPABILITY_SURFACES';
