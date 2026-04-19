// src/features/agents/types.ts
// Cluster-local barrel — re-exports Tauri wrapper types + agents-cluster UI-only types.
// D-128: per-cluster types module lets per-route files import a single barrel rather
// than the wrapper file directly.
//
// @see .planning/phases/05-agents-knowledge/05-CONTEXT.md §D-128

export type {
  Agent,
  AgentStatus,
  AgentStep,
  StepStatus,
  BackgroundAgent,
  Swarm,
  SwarmStatus,
  SwarmTask,
  SwarmTaskStatus,
  SwarmProgress,
  ScratchpadEntry,
  AgentBlueprint,
} from '@/lib/tauri/agents';

// ── Cluster-local UI types (not on the wire) ────────────────────────────────

/** AgentDashboard filter pill state. Persisted via usePrefs `agents.filterStatus` (D-133). */
export type AgentFilterStatus = 'all' | 'running' | 'idle' | 'failed';

/** Row in AgentDetail timeline — client-side synthesised (D-125). */
export interface TimelineRow {
  seq: number;
  ts: number;
  event: string;
  agentId: string;
  preview: string;
}
