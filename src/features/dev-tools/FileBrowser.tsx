// src/features/dev-tools/FileBrowser.tsx — placeholder shipped by Plan 07-02.
// Real body ships in Plan 07-03.
// @see .planning/phases/07-dev-tools-admin/07-PATTERNS.md §6
import { GlassPanel } from '@/design-system/primitives';
import './dev-tools.css';

export function FileBrowser() {
  return (
    <GlassPanel tier={1} className="dev-surface">
      <div className="dev-placeholder" data-testid="file-browser-placeholder">
        <h2>File Browser</h2>
        <p className="dev-placeholder-hint">Ships in Plan 07-03.</p>
      </div>
    </GlassPanel>
  );
}
