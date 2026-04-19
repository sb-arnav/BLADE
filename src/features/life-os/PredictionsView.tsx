// src/features/life-os/PredictionsView.tsx — placeholder shipped by Plan 06-02.
// Real body ships in Plan 06-04 (D-150 — pending list + accept/dismiss + patterns).
// @see .planning/phases/06-life-os-identity/06-CONTEXT.md §D-150
import { GlassPanel } from '@/design-system/primitives';
import './life-os.css';

export function PredictionsView() {
  return (
    <GlassPanel tier={1} className="life-surface">
      <div className="life-placeholder" data-testid="predictions-view-placeholder">
        <h2>Predictions</h2>
        <p className="life-placeholder-hint">Ships in Plan 06-04.</p>
      </div>
    </GlassPanel>
  );
}
