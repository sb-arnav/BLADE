// src/features/admin/Reports.tsx — placeholder shipped by Plan 07-02.
// Real body ships in Plan 07-05.
// Synthetic route — backend openRoute target for capability_gap_detected (P-03).
import { GlassPanel } from '@/design-system/primitives';
import './admin.css';

export function Reports() {
  return (
    <GlassPanel tier={1} className="admin-surface">
      <div className="admin-placeholder" data-testid="reports-placeholder">
        <h2>Reports</h2>
        <p className="admin-placeholder-hint">Ships in Plan 07-05.</p>
      </div>
    </GlassPanel>
  );
}
