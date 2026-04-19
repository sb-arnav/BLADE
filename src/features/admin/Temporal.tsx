// src/features/admin/Temporal.tsx — placeholder shipped by Plan 07-02.
// Real body ships in Plan 07-06.
import { GlassPanel } from '@/design-system/primitives';
import './admin.css';

export function Temporal() {
  return (
    <GlassPanel tier={1} className="admin-surface">
      <div className="admin-placeholder" data-testid="temporal-placeholder">
        <h2>Temporal</h2>
        <p className="admin-placeholder-hint">Ships in Plan 07-06.</p>
      </div>
    </GlassPanel>
  );
}
