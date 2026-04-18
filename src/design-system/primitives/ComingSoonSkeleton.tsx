import { GlassPanel } from './GlassPanel';

/**
 * ComingSoonSkeleton — phase-placeholder renderer for the 59-route stub
 * strategy (D-26 step 7, D-44).
 *
 * Ships in Phase 1 so backend pushes (e.g. `capability_gap_detected →
 * openRoute('reports')`) land on a styled skeleton instead of a 404. No
 * interactive elements — pure visual.
 *
 * The dev-only chip surfaces the resolved route label + target phase so
 * engineers can diff the migration ledger at a glance.
 */
interface ComingSoonSkeletonProps {
  routeLabel: string;
  phase: number;
}

export function ComingSoonSkeleton({ routeLabel, phase }: ComingSoonSkeletonProps) {
  const devBadge = import.meta.env.DEV
    ? `[Route: ${routeLabel.toLowerCase().replace(/\s+/g, '-')} · Phase ${phase}]`
    : null;
  return (
    <GlassPanel
      tier={1}
      role="region"
      aria-label={`${routeLabel} — ships in Phase ${phase}`}
      style={{
        padding: 'var(--s-10)',
        maxWidth: 640,
        margin: 'var(--s-12) auto',
        textAlign: 'center',
      }}
    >
      <h2 className="t-h2" style={{ margin: 0 }}>{routeLabel}</h2>
      <p className="t-body" style={{ color: 'var(--t-2)', marginTop: 'var(--s-3)' }}>
        Ships in Phase {phase}
      </p>
      {devBadge && (
        <span
          className="chip"
          style={{
            display: 'inline-block',
            marginTop: 'var(--s-4)',
            fontFamily: 'var(--font-mono)',
            fontSize: 12,
            color: 'var(--t-3)',
          }}
        >
          {devBadge}
        </span>
      )}
    </GlassPanel>
  );
}
