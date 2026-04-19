// src/features/life-os/AccountabilityView.tsx — placeholder shipped by Plan 06-02.
// Real body ships in Plan 06-04 (D-152 — daily plan + objectives + checkin flow).
// @see .planning/phases/06-life-os-identity/06-CONTEXT.md §D-152
import { GlassPanel } from '@/design-system/primitives';
import './life-os.css';

export function AccountabilityView() {
  return (
    <GlassPanel tier={1} className="life-surface">
      <div className="life-placeholder" data-testid="accountability-view-placeholder">
        <h2>Accountability</h2>
        <p className="life-placeholder-hint">Ships in Plan 06-04.</p>
      </div>
    </GlassPanel>
  );
}
