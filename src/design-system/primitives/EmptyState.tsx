// src/design-system/primitives/EmptyState.tsx — Phase 9 Plan 09-02 (D-215, D-217).
//
// Functional empty-state renderer — the single primitive that POL-02 coverage
// depends on. Renders a centered glass tier-1 card with icon / label / optional
// description / optional CTA. role="status" (non-blocking announcement) per
// WAI-ARIA so a11y readers surface the empty state without interrupting.
//
// Token-light on purpose: consumers pass their own icon, label, description
// and action — the primitive owns only layout + spacing + typography classes.
//
// @see .planning/phases/09-polish/09-PATTERNS.md §2

import type { ReactNode } from 'react';
import { GlassPanel } from './GlassPanel';
import { Button } from './Button';

interface EmptyStateProps {
  /** Short label (e.g., "No agents yet"). */
  label: string;
  /** Optional longer description. */
  description?: string;
  /** Call-to-action label (only rendered if onAction provided). */
  actionLabel?: string;
  /** Click handler for the CTA button. */
  onAction?: () => void;
  /** Optional icon/emoji element rendered above the label. */
  icon?: ReactNode;
  /** Optional data-testid override (default: 'empty-state'). */
  testId?: string;
}

export function EmptyState({
  label,
  description,
  actionLabel,
  onAction,
  icon,
  testId = 'empty-state',
}: EmptyStateProps) {
  return (
    <GlassPanel
      tier={1}
      role="status"
      data-testid={testId}
      style={{
        textAlign: 'center',
        padding: 'var(--s-8)',
        margin: 'var(--s-6) auto',
        maxWidth: 420,
      }}
    >
      {icon && <div style={{ fontSize: 32, marginBottom: 'var(--s-3)' }}>{icon}</div>}
      <h3 className="t-h3" style={{ margin: 0 }}>{label}</h3>
      {description && (
        <p className="t-body" style={{ color: 'var(--t-2)', marginTop: 'var(--s-3)' }}>
          {description}
        </p>
      )}
      {actionLabel && onAction && (
        <div style={{ marginTop: 'var(--s-5)' }}>
          <Button onClick={onAction}>{actionLabel}</Button>
        </div>
      )}
    </GlassPanel>
  );
}
