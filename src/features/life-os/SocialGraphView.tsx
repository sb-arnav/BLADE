// src/features/life-os/SocialGraphView.tsx — placeholder shipped by Plan 06-02.
// Real body ships in Plan 06-04 (D-149 — contacts list + insights + how-to-approach).
// @see .planning/phases/06-life-os-identity/06-CONTEXT.md §D-149
import { GlassPanel } from '@/design-system/primitives';
import './life-os.css';

export function SocialGraphView() {
  return (
    <GlassPanel tier={1} className="life-surface">
      <div className="life-placeholder" data-testid="social-graph-view-placeholder">
        <h2>Social Graph</h2>
        <p className="life-placeholder-hint">Ships in Plan 06-04.</p>
      </div>
    </GlassPanel>
  );
}
