// src/features/life-os/HealthView.tsx — placeholder shipped by Plan 06-02.
// Real body ships in Plan 06-03 (D-145 — today's snapshot + streak + insights).
// @see .planning/phases/06-life-os-identity/06-CONTEXT.md §D-145
import { GlassPanel } from '@/design-system/primitives';
import './life-os.css';

export function HealthView() {
  return (
    <GlassPanel tier={1} className="life-surface">
      <div className="life-placeholder" data-testid="health-view-placeholder">
        <h2>Health</h2>
        <p className="life-placeholder-hint">Ships in Plan 06-03.</p>
      </div>
    </GlassPanel>
  );
}
