// src/features/ghost/speakerColor.ts — Phase 4 Plan 04-04
//
// Deterministic 6-color palette hashed by speaker name + 3-tier confidence
// color scale.
//
// Recipe RETYPED (NOT imported) from src.bak/components/GhostOverlay.tsx per
// D-17 (src.bak is dead-reference; consult-but-do-not-import). The palette
// values + the (hash * 31 + charCode) FNV-style mix are preserved verbatim
// because they are part of the established speaker-attribution UX contract.
//
// @see .planning/phases/01-foundation/01-CONTEXT.md §D-17 (src.bak read-only)
// @see .planning/phases/04-overlay-windows/04-CONTEXT.md §D-109 (speaker dot)

const PALETTE: readonly string[] = [
  '#818cf8',
  '#34d399',
  '#fbbf24',
  '#f472b6',
  '#60a5fa',
  '#a78bfa',
];

/**
 * Returns a stable RGB hex color for a speaker name. Same name always maps to
 * the same color across sessions; null/empty falls back to a low-contrast neutral.
 *
 * @param name — speaker label from `GhostSuggestionPayload.speaker`.
 */
export function speakerColor(name: string | null | undefined): string {
  if (!name) return 'rgba(255,255,255,0.55)';
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  return PALETTE[hash % PALETTE.length];
}

/**
 * Returns a confidence-tier color (green / amber / red) for the suggestion's
 * confidence dot. Thresholds match src.bak recipe (≥0.85 high, ≥0.65 medium).
 *
 * @param c — confidence in 0..1 from `GhostSuggestionPayload.confidence`.
 */
export function confColor(c: number): string {
  if (c >= 0.85) return '#34c759';
  if (c >= 0.65) return '#f59e0b';
  return '#ff3b30';
}
