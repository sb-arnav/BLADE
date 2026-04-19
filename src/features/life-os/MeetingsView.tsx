// src/features/life-os/MeetingsView.tsx — placeholder shipped by Plan 06-02.
// Real body ships in Plan 06-03 (D-148 — meetings sidebar + detail pane + actions).
// @see .planning/phases/06-life-os-identity/06-CONTEXT.md §D-148
import { GlassPanel } from '@/design-system/primitives';
import './life-os.css';

export function MeetingsView() {
  return (
    <GlassPanel tier={1} className="life-surface">
      <div className="life-placeholder" data-testid="meetings-view-placeholder">
        <h2>Meetings</h2>
        <p className="life-placeholder-hint">Ships in Plan 06-03.</p>
      </div>
    </GlassPanel>
  );
}
