// src/features/dev/AgentDetailDev.tsx — DEV-only isolation route for AgentDetail.
//
// Phase 5 Plan 05-07 Task 1. Mounts <AgentDetail/> inside the main-window route
// tree so Playwright (which targets the Vite dev server at :1420) can assert
// the real-time timeline surface (WIRE-05 consumer, 10-subscriber rAF-flush) —
// SC-2 falsifier — without needing a live Rust agent.
//
// Preconditions installed by this route:
//   1. `prefs['agents.selectedAgent']` pinned to `'test-agent-1'` via usePrefs
//      so AgentDetail exits the "No agent selected" empty-state branch and
//      attempts `agentGet('test-agent-1')`. The Playwright shim intercepts
//      that invoke and returns a synthetic Agent.
//   2. Subsequent synthetic events emitted via `__BLADE_TEST_EMIT__` flow
//      through the existing useTauriEvent listeners registered by
//      useAgentTimeline — payload.agent_id === 'test-agent-1' passes the
//      D-130 client-side filter and rows land in the timeline.
//
// The dev route does NOT install its own invoke shim — the shim lives in the
// test (tests/e2e/agent-detail-timeline.spec.ts), same pattern as
// VoiceOrbDev + voice-orb-phases.spec.ts (Phase 4 Plan 04-07).
//
// @see tests/e2e/agent-detail-timeline.spec.ts
// @see .planning/phases/05-agents-knowledge/05-07-PLAN.md Task 1
// @see .planning/phases/04-overlay-windows/04-07-PLAN.md Sub-task 1f (pattern)

import { useEffect } from 'react';
import { AgentDetail } from '@/features/agents/AgentDetail';
import { usePrefs } from '@/hooks/usePrefs';

const PINNED_AGENT_ID = 'test-agent-1';

export function AgentDetailDev() {
  const { prefs, setPref } = usePrefs();

  // Pin the selected agent id so AgentDetail resolves immediately on mount.
  // Idempotent — only write if the current value differs to avoid debounce
  // churn across re-renders.
  useEffect(() => {
    if (prefs['agents.selectedAgent'] !== PINNED_AGENT_ID) {
      setPref('agents.selectedAgent', PINNED_AGENT_ID);
    }
  }, [prefs, setPref]);

  return <AgentDetail />;
}
