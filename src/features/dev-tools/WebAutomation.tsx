// src/features/dev-tools/WebAutomation.tsx — placeholder shipped by Plan 07-02.
// Real body ships in Plan 07-04.
import { GlassPanel } from '@/design-system/primitives';
import './dev-tools.css';

export function WebAutomation() {
  return (
    <GlassPanel tier={1} className="dev-surface">
      <div className="dev-placeholder" data-testid="web-automation-placeholder">
        <h2>Web Automation</h2>
        <p className="dev-placeholder-hint">Ships in Plan 07-04.</p>
      </div>
    </GlassPanel>
  );
}
