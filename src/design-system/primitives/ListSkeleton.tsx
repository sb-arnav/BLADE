// src/design-system/primitives/ListSkeleton.tsx — Phase 9 Plan 09-04 (D-220).
//
// Cheap async-list placeholder. Rendered in place of GlassSpinner on panels
// where the pending data is a list (AgentDetail timeline, BodySystemDetail
// module list, HiveMesh tentacle grid, etc). Shows N animated shimmer rows
// (default 5) matching the row height of the destination list.
//
// role="status" + aria-label="Loading" so screen readers announce the async
// wait without interrupting (non-blocking). prefers-reduced-motion disables
// the shimmer (see primitives.css .list-skeleton-row @media rule).
//
// Barrel export is deferred to Plan 09-06 per D-229 (Wave 2 disjoint-files
// invariant — Plan 09-02 owns index.ts in Wave 2). Consumers in Plan 09-04
// import directly: `import { ListSkeleton } from '@/design-system/primitives/ListSkeleton';`
//
// @see .planning/phases/09-polish/09-PATTERNS.md §3
// @see .planning/phases/09-polish/09-CONTEXT.md §D-220

interface ListSkeletonProps {
  /** Number of placeholder rows to render (default 5). */
  rows?: number;
  /** Row height in px (default 56). */
  rowHeight?: number;
}

export function ListSkeleton({ rows = 5, rowHeight = 56 }: ListSkeletonProps) {
  return (
    <div
      role="status"
      aria-label="Loading"
      data-testid="list-skeleton"
      style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s-2)' }}
    >
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="list-skeleton-row"
          style={{ height: rowHeight }}
        />
      ))}
    </div>
  );
}
