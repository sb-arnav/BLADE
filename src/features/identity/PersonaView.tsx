// src/features/identity/PersonaView.tsx — placeholder shipped by Plan 06-02.
// Real body ships in Plan 06-05 (D-154 — 4-tab surface: Traits / Relationship / Model / People).
// @see .planning/phases/06-life-os-identity/06-CONTEXT.md §D-154
import { GlassPanel } from '@/design-system/primitives';
import './identity.css';

export function PersonaView() {
  return (
    <GlassPanel tier={1} className="identity-surface">
      <div className="identity-placeholder" data-testid="persona-view-placeholder">
        <h2>Persona</h2>
        <p className="identity-placeholder-hint">Ships in Plan 06-05.</p>
      </div>
    </GlassPanel>
  );
}
