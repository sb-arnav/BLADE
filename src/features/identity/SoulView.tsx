// src/features/identity/SoulView.tsx — placeholder shipped by Plan 06-02.
// Real body ships in Plan 06-05 (D-153 — state card + bible tabs + preferences + edit).
// @see .planning/phases/06-life-os-identity/06-CONTEXT.md §D-153
import { GlassPanel } from '@/design-system/primitives';
import './identity.css';

export function SoulView() {
  return (
    <GlassPanel tier={1} className="identity-surface">
      <div className="identity-placeholder" data-testid="soul-view-placeholder">
        <h2>Soul</h2>
        <p className="identity-placeholder-hint">Ships in Plan 06-05.</p>
      </div>
    </GlassPanel>
  );
}
