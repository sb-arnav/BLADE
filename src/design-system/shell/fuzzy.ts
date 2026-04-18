// src/design-system/shell/fuzzy.ts — Palette fuzzy scoring.
//
// Algorithm re-typed from src.bak/components/CommandPalette.tsx:48-79 (D-17
// REFERENCE ONLY — not imported). Returns a non-negative score (higher is
// better) or -1 for no match.
//
// Strategy (preserved from the legacy palette so muscle memory still works):
//   1) exact label substring          → score 100+
//   2) char-order fuzzy on label       → score 50-70
//   3) description substring           → score 20
//   4) no match                        → -1
//
// Pure function — no regex (T-02-05-04 accept: ReDoS-safe), no allocations
// beyond the two lowercase() strings, O(label.length) per call. Callable ~82
// times per keystroke in CommandPalette without blowing the frame budget
// (T-02-05-03 mitigation reference).
//
// @see .planning/phases/02-onboarding-shell/02-CONTEXT.md §D-57

import type { RouteDefinition } from '@/lib/router';

export function fuzzyScore(cmd: RouteDefinition, q: string): number {
  if (!q) return 0;
  const label = cmd.label.toLowerCase();
  const desc = (cmd.description ?? '').toLowerCase();
  const query = q.toLowerCase();

  // 1) Exact label substring — shorter queries relative to label score higher.
  if (label.includes(query)) {
    return 100 + (1 - query.length / label.length) * 10;
  }

  // 2) Char-order fuzzy: all chars of query appear in label, in order.
  let qi = 0;
  let consecutive = 0;
  let maxConsec = 0;
  for (let i = 0; i < label.length && qi < query.length; i++) {
    if (label[i] === query[qi]) {
      qi++;
      consecutive++;
      if (consecutive > maxConsec) maxConsec = consecutive;
    } else {
      consecutive = 0;
    }
  }
  if (qi === query.length) {
    return 50 + (maxConsec / query.length) * 20;
  }

  // 3) Description substring fallback.
  if (desc.includes(query)) return 20;

  return -1;
}
