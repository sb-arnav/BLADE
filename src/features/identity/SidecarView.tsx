// src/features/identity/SidecarView.tsx — placeholder shipped by Plan 06-02.
// Real body ships in Plan 06-06 (D-158 — devices table + run controls + Kali pentest sub-section).
// sidecar_start_server + kali_* lifecycle/pentest commands MUST gate behind Dialog confirm per D-158.
// @see .planning/phases/06-life-os-identity/06-CONTEXT.md §D-158
import { GlassPanel } from '@/design-system/primitives';
import './identity.css';

export function SidecarView() {
  return (
    <GlassPanel tier={1} className="identity-surface">
      <div className="identity-placeholder" data-testid="sidecar-view-placeholder">
        <h2>Sidecar</h2>
        <p className="identity-placeholder-hint">Ships in Plan 06-06.</p>
      </div>
    </GlassPanel>
  );
}
