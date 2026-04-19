// src/features/admin/IntegrationStatus.tsx — placeholder shipped by Plan 07-02.
// Real body ships in Plan 07-06.
import { GlassPanel } from '@/design-system/primitives';
import './admin.css';

export function IntegrationStatus() {
  return (
    <GlassPanel tier={1} className="admin-surface">
      <div className="admin-placeholder" data-testid="integration-status-placeholder">
        <h2>Integration Status</h2>
        <p className="admin-placeholder-hint">Ships in Plan 07-06.</p>
      </div>
    </GlassPanel>
  );
}
