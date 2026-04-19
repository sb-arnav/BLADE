// src/features/dashboard/ComingSoonCard.tsx — Phase-labelled placeholder card.
//
// Rendered by Dashboard for the three non-Phase-3 clusters (Hive / Calendar /
// Integrations) per D-76. Visually reads as a placeholder — not a broken
// card — so users see honest phase status ("Ships in Phase N") rather than a
// blank square.
//
// Composes design-system primitives ONLY (GlassPanel, Pill). No imports from
// other features/* — keeps the component self-contained for future extraction
// if the pattern generalizes beyond the dashboard.
//
// @see .planning/phases/03-dashboard-chat-settings/03-CONTEXT.md §D-76

import { GlassPanel, Pill } from '@/design-system/primitives';

export interface ComingSoonCardProps {
  /** Card title — e.g. "Hive signals". */
  title: string;
  /** Phase number this cluster ships in — drives the pill label. */
  phase: number;
  /** Optional one-line teaser; omitted → just title + pill. */
  description?: string;
}

export function ComingSoonCard({ title, phase, description }: ComingSoonCardProps) {
  return (
    <GlassPanel
      tier={1}
      className="coming-soon-card"
      role="region"
      aria-label={`${title} — ships in Phase ${phase}`}
    >
      <header className="coming-soon-card-head">
        <h3 className="coming-soon-card-title t-h3">{title}</h3>
        <Pill tone="new">Phase {phase}</Pill>
      </header>
      {description ? (
        <p className="coming-soon-card-desc t-small">{description}</p>
      ) : null}
    </GlassPanel>
  );
}
