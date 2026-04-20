// src/features/providers/index.ts — Phase 11 Plan 11-03 barrel.
//
// Exports the 3 Phase 11 paste/capability components consumed by onboarding
// (ProviderPicker) and Settings (ProvidersPane). Re-export pattern mirrors
// src/design-system/primitives/index.ts (named exports only, no `export *`).

export { ProviderPasteForm } from './ProviderPasteForm';
export type { ProviderPasteFormProps } from './ProviderPasteForm';

export { CapabilityPillStrip } from './CapabilityPillStrip';
export type { CapabilityPillStripProps } from './CapabilityPillStrip';

export { FallbackOrderList } from './FallbackOrderList';
export type { FallbackOrderListProps } from './FallbackOrderList';
