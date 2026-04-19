// src/features/ghost/clipHeadline.ts — Phase 4 Plan 04-04
//
// Clip a Ghost suggestion response into D-10-compliant {headline, bullets}:
//   - headline: first ≤6 words of the response (D-10 locked).
//   - bullets:  first 1–2 sentences from the remainder.
//   - line-length cap (≤60 chars) is enforced visually via CSS `max-width: 60ch`
//     on `.ghost-headline` and `.ghost-bullets li` (see ghost.css).
//
// Pure function — no React, no Tauri. Easy to unit-test from a Playwright
// isolation route (Plan 04-07 ghost-overlay-headline.spec.ts).
//
// @see .planning/phases/01-foundation/01-CONTEXT.md §D-10 (locked headline format)
// @see .planning/phases/04-overlay-windows/04-CONTEXT.md §D-109 (idle pill + card states)

export interface ClippedSuggestion {
  headline: string;
  bullets: string[];
}

/**
 * Clip a Ghost suggestion response into D-10-compliant headline + bullets.
 *
 * Behaviour:
 *   - Whitespace is normalised (consecutive spaces / newlines collapse to one).
 *   - Empty / whitespace-only input returns `{ headline: '', bullets: [] }`.
 *   - The first ≤6 words become the headline. Punctuation that ends a sentence
 *     stays attached to its word (no stripping); UI handles the display.
 *   - The remainder is split on sentence terminators (`.`, `!`, `?`) followed
 *     by whitespace. Up to 2 non-empty sentences become bullets.
 *
 * @param text — free-form suggestion string from `ghost_suggestion_ready_to_speak`.
 */
export function clipHeadline(text: string): ClippedSuggestion {
  const normalized = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!normalized) return { headline: '', bullets: [] };
  const words = normalized.split(' ');
  const headline = words.slice(0, 6).join(' ');
  const rest = words.slice(6).join(' ').trim();
  if (!rest) return { headline, bullets: [] };
  const sentences = rest
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const bullets = sentences.slice(0, 2);
  return { headline, bullets };
}
