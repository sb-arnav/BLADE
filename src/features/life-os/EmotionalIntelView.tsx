// src/features/life-os/EmotionalIntelView.tsx — placeholder shipped by Plan 06-02.
// Real body ships in Plan 06-04 (D-151 — current state + trend + readings + analysis).
// @see .planning/phases/06-life-os-identity/06-CONTEXT.md §D-151
import { GlassPanel } from '@/design-system/primitives';
import './life-os.css';

export function EmotionalIntelView() {
  return (
    <GlassPanel tier={1} className="life-surface">
      <div className="life-placeholder" data-testid="emotional-intel-view-placeholder">
        <h2>Emotional Intelligence</h2>
        <p className="life-placeholder-hint">Ships in Plan 06-04.</p>
      </div>
    </GlassPanel>
  );
}
