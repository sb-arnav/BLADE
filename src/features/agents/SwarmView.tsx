// src/features/agents/SwarmView.tsx — Phase 5 Plan 05-02 placeholder.
// Real body ships in Plan 05-04 (AGENT-08: DAG view from swarm_list/get/progress).
// @see .planning/phases/05-agents-knowledge/05-CONTEXT.md §D-124
// @see .planning/REQUIREMENTS.md §AGENT-08

import { GlassPanel } from '@/design-system/primitives';
import './agents.css';

export function SwarmView() {
  return (
    <GlassPanel tier={1} className="agents-surface">
      <div className="agents-placeholder" data-testid="swarm-view-placeholder">
        <h2>Swarm</h2>
        <p className="agents-placeholder-hint">Ships in Plan 05-04.</p>
      </div>
    </GlassPanel>
  );
}
