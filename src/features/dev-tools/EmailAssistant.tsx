// src/features/dev-tools/EmailAssistant.tsx — placeholder shipped by Plan 07-02.
// Real body ships in Plan 07-04.
import { GlassPanel } from '@/design-system/primitives';
import './dev-tools.css';

export function EmailAssistant() {
  return (
    <GlassPanel tier={1} className="dev-surface">
      <div className="dev-placeholder" data-testid="email-assistant-placeholder">
        <h2>Email Assistant</h2>
        <p className="dev-placeholder-hint">Ships in Plan 07-04.</p>
      </div>
    </GlassPanel>
  );
}
