// src/features/admin/SecurityDashboard.tsx — placeholder shipped by Plan 07-02.
// Real body ships in Plan 07-05.
// @see .planning/phases/07-dev-tools-admin/07-PATTERNS.md §4 (Dialog-gated pentest)
import { GlassPanel } from '@/design-system/primitives';
import './admin.css';

export function SecurityDashboard() {
  return (
    <GlassPanel tier={1} className="admin-surface">
      <div className="admin-placeholder" data-testid="security-dashboard-placeholder">
        <h2>Security</h2>
        <p className="admin-placeholder-hint">Ships in Plan 07-05.</p>
      </div>
    </GlassPanel>
  );
}
