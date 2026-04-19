// src/features/agents/AgentTimeline.tsx — Phase 5 Plan 05-02 placeholder.
// Real body ships in Plan 05-04 (AGENT-05: agent_list + cross-agent event stream).
// @see .planning/REQUIREMENTS.md §AGENT-05

import { GlassPanel } from '@/design-system/primitives';
import './agents.css';

export function AgentTimeline() {
  return (
    <GlassPanel tier={1} className="agents-surface">
      <div className="agents-placeholder" data-testid="agent-timeline-placeholder">
        <h2>Agent Timeline</h2>
        <p className="agents-placeholder-hint">Ships in Plan 05-04.</p>
      </div>
    </GlassPanel>
  );
}
