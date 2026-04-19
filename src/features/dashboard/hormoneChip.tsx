// src/features/dashboard/hormoneChip.tsx — Single hormone chip.
//
// Extracted to its own file so Phase 4 HUD bar (HUD-01..05) can reuse this
// component verbatim without pulling the entire Dashboard feature tree
// (D-75 rationale). HormoneChip is visual-only — no event subscription, no
// IPC — a pure function of (name, value, dominant?).
//
// Color map keys the 10 hormone scalar field names defined in HormoneState
// (src/types/hormones.ts). Values outside 0..1 are clamped; NaN → 0.
// A11y: role="status" + aria-label encodes the human-readable label + value
// so screen readers announce changes without visual parsing.
//
// The color is exposed as a CSS custom property `--chip-color` so dashboard.css
// can use it for the left-border accent and value text color — that keeps the
// palette in one place (here) and CSS rules generic (no per-hormone selectors).
//
// @see .planning/phases/03-dashboard-chat-settings/03-CONTEXT.md §D-75
// @see .planning/phases/03-dashboard-chat-settings/03-PATTERNS.md §8

import type { CSSProperties } from 'react';

/**
 * Colorblind-safe palette per D-75 "must respect WCAG 4.5:1 on glass-1".
 * Warm (red/orange) for arousal / urgency / adrenaline — high-salience
 * states. Cool (blue) for trust. Green for exploration (growth). Amber for
 * energy_mode. Remaining secondary hormones follow a perceptual ordering
 * (hunger warm, thirst cool, insulin amber, leptin violet).
 */
const HORMONE_COLORS: Record<string, string> = {
  arousal:     '#ff8a8a',
  energy_mode: '#ffd2a6',
  exploration: '#8affc7',
  trust:       '#7fb6ff',
  urgency:     '#ff8a8a',
  hunger:      '#ffa87f',
  thirst:      '#a8d8ff',
  insulin:     '#ffd27f',
  adrenaline:  '#ff9ab0',
  leptin:      '#c8a6ff',
};

const HORMONE_LABELS: Record<string, string> = {
  arousal:     'Arousal',
  energy_mode: 'Energy',
  exploration: 'Exploration',
  trust:       'Trust',
  urgency:     'Urgency',
  hunger:      'Hunger',
  thirst:      'Thirst',
  insulin:     'Budget',
  adrenaline:  'Adrenaline',
  leptin:      'Satiation',
};

export interface HormoneChipProps {
  /** Hormone field name — one of the 10 HormoneState scalars. */
  name: string;
  /** Raw value — clamped to 0.0..1.0 for display. */
  value: number;
  /** When true, the chip renders larger with a subtle glow (D-75 dominant). */
  dominant?: boolean;
}

export function HormoneChip({ name, value, dominant = false }: HormoneChipProps) {
  const color = HORMONE_COLORS[name] ?? 'rgba(255,255,255,0.6)';
  const label = HORMONE_LABELS[name] ?? name;
  const clamped = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
  const display = clamped.toFixed(2);
  const style = { '--chip-color': color } as CSSProperties & Record<string, string>;
  return (
    <span
      className={`hormone-chip${dominant ? ' is-dominant' : ''}`}
      style={style}
      role="status"
      aria-label={`${label} ${display}${dominant ? ' (dominant)' : ''}`}
      data-hormone={name}
    >
      <span className="hormone-chip-label">{label}</span>
      <span className="hormone-chip-value">{display}</span>
    </span>
  );
}
