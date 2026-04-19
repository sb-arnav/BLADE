// src/features/identity/NegotiationView.tsx — placeholder shipped by Plan 06-02.
// Real body ships in Plan 06-05 (D-156 — Debate / Scenarios / Analyze / Tools tabs).
// @see .planning/phases/06-life-os-identity/06-CONTEXT.md §D-156
import { GlassPanel } from '@/design-system/primitives';
import './identity.css';

export function NegotiationView() {
  return (
    <GlassPanel tier={1} className="identity-surface">
      <div className="identity-placeholder" data-testid="negotiation-view-placeholder">
        <h2>Negotiation</h2>
        <p className="identity-placeholder-hint">Ships in Plan 06-05.</p>
      </div>
    </GlassPanel>
  );
}
