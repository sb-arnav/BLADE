// src/features/identity/ReasoningView.tsx — placeholder shipped by Plan 06-02.
// Real body ships in Plan 06-06 (D-157 — prompt input + 4 tool buttons + recent traces).
// @see .planning/phases/06-life-os-identity/06-CONTEXT.md §D-157
import { GlassPanel } from '@/design-system/primitives';
import './identity.css';

export function ReasoningView() {
  return (
    <GlassPanel tier={1} className="identity-surface">
      <div className="identity-placeholder" data-testid="reasoning-view-placeholder">
        <h2>Reasoning</h2>
        <p className="identity-placeholder-hint">Ships in Plan 06-06.</p>
      </div>
    </GlassPanel>
  );
}
