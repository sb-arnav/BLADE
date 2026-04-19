// src/features/dev-tools/GitPanel.tsx — placeholder shipped by Plan 07-02.
// Real body ships in Plan 07-03.
import { GlassPanel } from '@/design-system/primitives';
import './dev-tools.css';

export function GitPanel() {
  return (
    <GlassPanel tier={1} className="dev-surface">
      <div className="dev-placeholder" data-testid="git-panel-placeholder">
        <h2>Git</h2>
        <p className="dev-placeholder-hint">Ships in Plan 07-03.</p>
      </div>
    </GlassPanel>
  );
}
