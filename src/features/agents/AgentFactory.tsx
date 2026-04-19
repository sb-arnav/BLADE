// src/features/agents/AgentFactory.tsx — Phase 5 Plan 05-02 placeholder.
// Real body ships in Plan 05-04 (AGENT-03: factory_create/deploy/list/pause/delete).
// @see .planning/REQUIREMENTS.md §AGENT-03

import { GlassPanel } from '@/design-system/primitives';
import './agents.css';

export function AgentFactory() {
  return (
    <GlassPanel tier={1} className="agents-surface">
      <div className="agents-placeholder" data-testid="agent-factory-placeholder">
        <h2>Agent Factory</h2>
        <p className="agents-placeholder-hint">Ships in Plan 05-04.</p>
      </div>
    </GlassPanel>
  );
}
