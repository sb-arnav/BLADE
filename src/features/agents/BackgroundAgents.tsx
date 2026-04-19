// src/features/agents/BackgroundAgents.tsx — Phase 5 Plan 05-02 placeholder.
// Real body ships in Plan 05-03 (AGENT-06: agent_spawn / agent_list_background /
// agent_get_output).
// @see .planning/REQUIREMENTS.md §AGENT-06

import { GlassPanel } from '@/design-system/primitives';
import './agents.css';

export function BackgroundAgents() {
  return (
    <GlassPanel tier={1} className="agents-surface">
      <div className="agents-placeholder" data-testid="background-agents-placeholder">
        <h2>Background Agents</h2>
        <p className="agents-placeholder-hint">Ships in Plan 05-03.</p>
      </div>
    </GlassPanel>
  );
}
