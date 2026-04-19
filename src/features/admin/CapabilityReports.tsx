// src/features/admin/CapabilityReports.tsx — placeholder shipped by Plan 07-02.
// Real body ships in Plan 07-05.
import { GlassPanel } from '@/design-system/primitives';
import './admin.css';

export function CapabilityReports() {
  return (
    <GlassPanel tier={1} className="admin-surface">
      <div className="admin-placeholder" data-testid="capability-reports-placeholder">
        <h2>Capability Reports</h2>
        <p className="admin-placeholder-hint">Ships in Plan 07-05.</p>
      </div>
    </GlassPanel>
  );
}
