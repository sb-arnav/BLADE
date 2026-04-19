// src/features/life-os/FinanceView.tsx — placeholder shipped by Plan 06-02.
// Real body ships in Plan 06-03 (D-146 — KPI row + transactions + CSV import).
// @see .planning/phases/06-life-os-identity/06-CONTEXT.md §D-146
import { GlassPanel } from '@/design-system/primitives';
import './life-os.css';

export function FinanceView() {
  return (
    <GlassPanel tier={1} className="life-surface">
      <div className="life-placeholder" data-testid="finance-view-placeholder">
        <h2>Finance</h2>
        <p className="life-placeholder-hint">Ships in Plan 06-03.</p>
      </div>
    </GlassPanel>
  );
}
