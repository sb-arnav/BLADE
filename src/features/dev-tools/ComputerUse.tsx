// src/features/dev-tools/ComputerUse.tsx — placeholder shipped by Plan 07-02.
// Real body ships in Plan 07-04.
// @see .planning/phases/07-dev-tools-admin/07-PATTERNS.md §4 (Dialog-gated)
import { GlassPanel } from '@/design-system/primitives';
import './dev-tools.css';

export function ComputerUse() {
  return (
    <GlassPanel tier={1} className="dev-surface">
      <div className="dev-placeholder" data-testid="computer-use-placeholder">
        <h2>Computer Use</h2>
        <p className="dev-placeholder-hint">Ships in Plan 07-04.</p>
      </div>
    </GlassPanel>
  );
}
