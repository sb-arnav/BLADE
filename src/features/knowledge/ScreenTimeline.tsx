// src/features/knowledge/ScreenTimeline.tsx — Phase 5 Plan 05-02 placeholder.
// Real body ships in Plan 05-05 (KNOW-04: timeline_search_cmd + timeline_browse_cmd
// + timeline_get_screenshot / thumbnail).
// @see .planning/REQUIREMENTS.md §KNOW-04

import { GlassPanel } from '@/design-system/primitives';
import './knowledge.css';

export function ScreenTimeline() {
  return (
    <GlassPanel tier={1} className="knowledge-surface">
      <div className="knowledge-placeholder" data-testid="screen-timeline-placeholder">
        <h2>Screen Timeline</h2>
        <p className="knowledge-placeholder-hint">Ships in Plan 05-05.</p>
      </div>
    </GlassPanel>
  );
}
