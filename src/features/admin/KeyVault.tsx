// src/features/admin/KeyVault.tsx — placeholder shipped by Plan 07-02.
// Real body ships in Plan 07-06.
// @see D-185 — keys masked to last-4 only.
import { GlassPanel } from '@/design-system/primitives';
import './admin.css';

export function KeyVault() {
  return (
    <GlassPanel tier={1} className="admin-surface">
      <div className="admin-placeholder" data-testid="key-vault-placeholder">
        <h2>Key Vault</h2>
        <p className="admin-placeholder-hint">Ships in Plan 07-06.</p>
      </div>
    </GlassPanel>
  );
}
