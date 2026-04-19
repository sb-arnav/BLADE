// src/features/knowledge/RewindTimeline.tsx — Phase 5 Plan 05-02 placeholder.
// Real body ships in Plan 05-05 (KNOW-05: timeline_browse_cmd + playback slider;
// shares ScreenTimelineList sub-component with ScreenTimeline).
// @see .planning/REQUIREMENTS.md §KNOW-05

import { GlassPanel } from '@/design-system/primitives';
import './knowledge.css';

export function RewindTimeline() {
  return (
    <GlassPanel tier={1} className="knowledge-surface">
      <div className="knowledge-placeholder" data-testid="rewind-timeline-placeholder">
        <h2>Rewind Timeline</h2>
        <p className="knowledge-placeholder-hint">Ships in Plan 05-05.</p>
      </div>
    </GlassPanel>
  );
}
