// src/features/agents/TaskAgents.tsx — Phase 5 Plan 05-02 placeholder.
// Real body ships in Plan 05-04 (AGENT-07: agent_list filtered by task kind).
// @see .planning/REQUIREMENTS.md §AGENT-07

import { GlassPanel } from '@/design-system/primitives';
import './agents.css';

export function TaskAgents() {
  return (
    <GlassPanel tier={1} className="agents-surface">
      <div className="agents-placeholder" data-testid="task-agents-placeholder">
        <h2>Task Agents</h2>
        <p className="agents-placeholder-hint">Ships in Plan 05-04.</p>
      </div>
    </GlassPanel>
  );
}
