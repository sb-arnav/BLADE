// src/features/admin/Diagnostics.tsx — placeholder shipped by Plan 07-02.
// Real body ships in Plan 07-06.
// @see .planning/phases/07-dev-tools-admin/07-PATTERNS.md §5 (supervisor health grid)
import { GlassPanel } from '@/design-system/primitives';
import './admin.css';

export function Diagnostics() {
  return (
    <GlassPanel tier={1} className="admin-surface">
      <div className="admin-placeholder" data-testid="diagnostics-placeholder">
        <h2>Diagnostics</h2>
        <p className="admin-placeholder-hint">Ships in Plan 07-06.</p>
      </div>
    </GlassPanel>
  );
}
