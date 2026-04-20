// src/features/providers/CAPABILITY_SURFACES.ts — Phase 11 Plan 11-05 (D-54).
//
// Registry of routes requiring each capability. Consumers:
//   • useCapability hook → openAddFlow deep-link target ('settings-providers')
//   • Tests / docs surfaces → enumerate "which views need what"
//
// PROV-07/08 acceptance (Plan 11-06 verify:providers-capability) requires
// ≥ 2 entries per capability. This file ships 8 entries (2 × 4 caps) minimum.
//
// @see .planning/phases/11-smart-provider-setup/11-CONTEXT.md §D-54
// @see .planning/phases/11-smart-provider-setup/11-UI-SPEC.md §Surface C
// @see .planning/phases/11-smart-provider-setup/11-PATTERNS.md §11

export const CAPABILITY_SURFACES = {
  vision: [
    { route: 'screen-timeline', label: 'Screen Timeline' },
    { route: 'quickask',        label: 'QuickAsk image input' },
  ],
  audio: [
    { route: 'voice-orb',       label: 'Voice Orb TTS' },
    { route: 'meeting-ghost',   label: 'Meeting Ghost transcription' },
  ],
  long_context: [
    { route: 'chat',                label: 'Chat with long input' },
    { route: 'knowledge-full-repo', label: 'Full-repo indexing' },
  ],
  tools: [
    { route: 'agents-swarm',    label: 'Multi-agent swarm' },
    { route: 'web-automation',  label: 'Web automation' },
  ],
} as const;

/** Keys of the CAPABILITY_SURFACES map — canonical capability identifiers. */
export type Capability = keyof typeof CAPABILITY_SURFACES;

/** Ordered list of all capabilities for iteration (registry coverage checks). */
export const CAPABILITIES: readonly Capability[] = [
  'vision',
  'audio',
  'long_context',
  'tools',
] as const;
