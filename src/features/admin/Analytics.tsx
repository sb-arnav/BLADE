// src/features/admin/Analytics.tsx — placeholder shipped by Plan 07-02.
// Real body ships in Plan 07-05.
import { GlassPanel } from '@/design-system/primitives';
import './admin.css';

export function Analytics() {
  return (
    <GlassPanel tier={1} className="admin-surface">
      <div className="admin-placeholder" data-testid="analytics-placeholder">
        <h2>Analytics</h2>
        <p className="admin-placeholder-hint">Ships in Plan 07-05.</p>
      </div>
    </GlassPanel>
  );
}
