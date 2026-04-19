// src/lib/tauri/agents.ts
//
// Typed wrappers for the Agents cluster — one per registered Rust #[tauri::command]
// across agent_commands.rs, background_agent.rs, swarm_commands.rs, agent_factory.rs,
// and managed_agents.rs (D-119 inventory).
//
// D-118: per-cluster wrapper module lives HERE (agents cluster only).
// D-119: zero Rust expansion in Phase 5 — every command below is already registered
//        in src-tauri/src/lib.rs generate_handler!.
// D-126: camelCase JS API, snake_case at invoke boundary. No raw invoke.
// D-38:  @see Rust cite in JSDoc; invokeTyped only; ESLint no-raw-tauri.
// D-127: return types mirror Rust #[derive(Serialize)] shape verbatim — snake_case fields
//        preserved to match the wire payload.
//
// @see .planning/phases/05-agents-knowledge/05-CONTEXT.md §D-118..D-128
// @see .planning/phases/05-agents-knowledge/05-PATTERNS.md §1
// @see src-tauri/src/lib.rs:690,723-730,879-887,937-946,1389-1393

import { invokeTyped } from './_base';

// ═══════════════════════════════════════════════════════════════════════════
// Types — mirror Rust Serialize shape verbatim (snake_case preserved).
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @see src-tauri/src/agents/mod.rs:172 AgentStatus (Rust enum, serde-default casing)
 * Rust variants: Planning | Executing | WaitingApproval | Paused | Completed | Failed.
 * Serde serializes PascalCase (no rename_all), so JS sees these exact strings on the wire.
 */
export type AgentStatus =
  | 'Planning'
  | 'Executing'
  | 'WaitingApproval'
  | 'Paused'
  | 'Completed'
  | 'Failed';

/** @see src-tauri/src/agents/mod.rs:201 StepStatus */
export type StepStatus =
  | 'Pending'
  | 'Running'
  | 'Completed'
  | 'Failed'
  | 'WaitingApproval';

/** @see src-tauri/src/agents/mod.rs:182 AgentStep */
export interface AgentStep {
  id: string;
  description: string;
  tool_name?: string | null;
  tool_args?: unknown;
  status: StepStatus;
  result?: string | null;
  started_at?: number | null;
  completed_at?: number | null;
  dependencies?: string[];
  reflections?: string[];
  [k: string]: unknown;
}

/** @see src-tauri/src/agents/mod.rs:155 Agent */
export interface Agent {
  id: string;
  goal: string;
  status: AgentStatus;
  steps: AgentStep[];
  current_step: number;
  context: Record<string, string>;
  created_at: number;
  updated_at: number;
  error?: string | null;
  synthesis_prompt?: string;
  [k: string]: unknown;
}

/** @see src-tauri/src/background_agent.rs:40 BackgroundAgent */
export interface BackgroundAgent {
  id: string;
  agent_type: string; // "claude-code" | "aider" | "goose" | "custom"
  task: string;
  cwd: string;
  status: AgentStatus;
  output: string[];
  exit_code?: number | null;
  started_at: number;
  finished_at?: number | null;
  [k: string]: unknown;
}

/** @see src-tauri/src/swarm.rs:104 SwarmStatus — serde rename_all="lowercase" */
export type SwarmStatus = 'planning' | 'running' | 'paused' | 'completed' | 'failed';

/** @see src-tauri/src/swarm.rs:72 SwarmTaskStatus */
export type SwarmTaskStatus =
  | 'Pending'
  | 'Blocked'
  | 'Ready'
  | 'Running'
  | 'Completed'
  | 'Failed';

/** @see src-tauri/src/swarm.rs:136 SwarmTask */
export interface SwarmTask {
  id: string;
  swarm_id: string;
  title: string;
  goal: string;
  task_type: string;
  depends_on: string[];
  agent_id?: string | null;
  status: SwarmTaskStatus;
  result?: string | null;
  scratchpad_key?: string | null;
  created_at: number;
  started_at?: number | null;
  completed_at?: number | null;
  error?: string | null;
  role?: string;
  required_tools?: string[];
  estimated_duration?: string;
  [k: string]: unknown;
}

/** @see src-tauri/src/swarm.rs:17 ScratchpadEntry */
export interface ScratchpadEntry {
  key: string;
  value: string;
  source_task: string;
  timestamp: number;
  [k: string]: unknown;
}

/** @see src-tauri/src/swarm.rs:165 Swarm */
export interface Swarm {
  id: string;
  goal: string;
  status: SwarmStatus;
  scratchpad: Record<string, string>;
  scratchpad_entries?: ScratchpadEntry[];
  final_result?: string | null;
  tasks: SwarmTask[];
  created_at: number;
  updated_at: number;
  [k: string]: unknown;
}

/** @see src-tauri/src/swarm.rs:29 SwarmProgress */
export interface SwarmProgress {
  swarm_id: string;
  total: number;
  completed: number;
  running: number;
  failed: number;
  pending: number;
  percent: number;
  estimated_seconds_remaining?: number | null;
  [k: string]: unknown;
}

/** @see src-tauri/src/agent_factory.rs:110 AgentBlueprint */
export interface AgentBlueprint {
  id: string;
  name: string;
  description: string;
  tentacle_type: string;
  triggers: unknown[];
  actions: unknown[];
  knowledge_sources: string[];
  [k: string]: unknown;
}

// ═══════════════════════════════════════════════════════════════════════════
// agent_commands.rs — 8 commands
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @see src-tauri/src/agent_commands.rs:228 agent_create
 * Rust signature: `agent_create(app, queue, mcp, goal: String) -> Result<String, String>`.
 * Note: Rust takes a single `goal` (not `agent_type` + `task_description`); returns the new agent id.
 */
export function agentCreate(goal: string): Promise<string> {
  return invokeTyped<string, { goal: string }>('agent_create', { goal });
}

/**
 * @see src-tauri/src/agent_commands.rs:295 agent_create_desktop
 * Rust signature: `agent_create_desktop(app, queue, goal: String, max_steps: Option<u32>, execution_mode: Option<String>) -> Result<String, String>`.
 */
export function agentCreateDesktop(args: {
  goal: string;
  maxSteps?: number;
  executionMode?: string;
}): Promise<string> {
  return invokeTyped<string, { goal: string; max_steps?: number; execution_mode?: string }>(
    'agent_create_desktop',
    {
      goal: args.goal,
      max_steps: args.maxSteps,
      execution_mode: args.executionMode,
    },
  );
}

/**
 * @see src-tauri/src/agent_commands.rs:2605 agent_list
 * Rust signature: `agent_list(queue) -> Result<Vec<Agent>, String>`.
 */
export function agentList(): Promise<Agent[]> {
  return invokeTyped<Agent[]>('agent_list', {});
}

/**
 * @see src-tauri/src/agent_commands.rs:2611 agent_get
 * Rust signature: `agent_get(queue, agent_id: String) -> Result<Agent, String>` (not Option — errors if not found).
 */
export function agentGet(agentId: string): Promise<Agent> {
  return invokeTyped<Agent, { agent_id: string }>('agent_get', { agent_id: agentId });
}

/**
 * @see src-tauri/src/agent_commands.rs:2622 agent_pause
 * Rust signature: `agent_pause(queue, agent_id: String) -> Result<(), String>`.
 */
export function agentPause(agentId: string): Promise<void> {
  return invokeTyped<void, { agent_id: string }>('agent_pause', { agent_id: agentId });
}

/**
 * @see src-tauri/src/agent_commands.rs:2632 agent_resume
 * Rust signature: `agent_resume(app, queue, mcp, agent_id: String) -> Result<(), String>`.
 */
export function agentResume(agentId: string): Promise<void> {
  return invokeTyped<void, { agent_id: string }>('agent_resume', { agent_id: agentId });
}

/**
 * @see src-tauri/src/agent_commands.rs:2702 agent_cancel
 * Rust signature: `agent_cancel(queue, agent_id: String) -> Result<(), String>`.
 */
export function agentCancel(agentId: string): Promise<void> {
  return invokeTyped<void, { agent_id: string }>('agent_cancel', { agent_id: agentId });
}

/**
 * @see src-tauri/src/agent_commands.rs:2712 agent_respond_desktop_action
 * Rust signature: `agent_respond_desktop_action(app, queue, agent_id: String, approved: bool) -> Result<(), String>`.
 * Note: Rust takes `approved: bool`, not an action_id/response pair.
 */
export function agentRespondDesktopAction(args: {
  agentId: string;
  approved: boolean;
}): Promise<void> {
  return invokeTyped<void, { agent_id: string; approved: boolean }>(
    'agent_respond_desktop_action',
    { agent_id: args.agentId, approved: args.approved },
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// background_agent.rs — 9 commands
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @see src-tauri/src/background_agent.rs:152 agent_spawn
 * Rust signature: `agent_spawn(app, agent_type: String, task: String, cwd: Option<String>) -> Result<String, String>`.
 * Returns the new background agent id.
 */
export function agentSpawn(args: {
  agentType: string; // "claude-code" | "aider" | "goose" | "codex" | ...
  task: string;
  cwd?: string;
}): Promise<string> {
  return invokeTyped<string, { agent_type: string; task: string; cwd?: string }>(
    'agent_spawn',
    { agent_type: args.agentType, task: args.task, cwd: args.cwd },
  );
}

/** @see src-tauri/src/background_agent.rs:377 agent_list_background */
export function agentListBackground(): Promise<BackgroundAgent[]> {
  return invokeTyped<BackgroundAgent[]>('agent_list_background', {});
}

/**
 * @see src-tauri/src/background_agent.rs:386 agent_get_background
 * Returns Option<BackgroundAgent> — TS surface it as `BackgroundAgent | null`.
 */
export function agentGetBackground(id: string): Promise<BackgroundAgent | null> {
  return invokeTyped<BackgroundAgent | null, { id: string }>('agent_get_background', { id });
}

/** @see src-tauri/src/background_agent.rs:393 agent_cancel_background */
export function agentCancelBackground(id: string): Promise<void> {
  return invokeTyped<void, { id: string }>('agent_cancel_background', { id });
}

/**
 * @see src-tauri/src/background_agent.rs:405 agent_detect_available
 * Returns the list of installed agent binaries detected on PATH (e.g. "claude-code", "aider").
 */
export function agentDetectAvailable(): Promise<string[]> {
  return invokeTyped<string[]>('agent_detect_available', {});
}

/** @see src-tauri/src/background_agent.rs:411 agent_get_output */
export function agentGetOutput(id: string): Promise<string> {
  return invokeTyped<string, { id: string }>('agent_get_output', { id });
}

/** @see src-tauri/src/background_agent.rs:644 get_active_agents */
export function getActiveAgents(): Promise<BackgroundAgent[]> {
  return invokeTyped<BackgroundAgent[]>('get_active_agents', {});
}

/**
 * @see src-tauri/src/background_agent.rs:711 agent_auto_spawn
 * Rust signature: `agent_auto_spawn(app, task: String, project_dir: String) -> Result<String, String>`.
 */
export function agentAutoSpawn(args: { task: string; projectDir: string }): Promise<string> {
  return invokeTyped<string, { task: string; project_dir: string }>('agent_auto_spawn', {
    task: args.task,
    project_dir: args.projectDir,
  });
}

/**
 * @see src-tauri/src/background_agent.rs:721 agent_spawn_codex
 * Rust signature: `agent_spawn_codex(app, task: String, project_dir: String) -> Result<String, String>`.
 */
export function agentSpawnCodex(args: { task: string; projectDir: string }): Promise<string> {
  return invokeTyped<string, { task: string; project_dir: string }>('agent_spawn_codex', {
    task: args.task,
    project_dir: args.projectDir,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// swarm_commands.rs — 10 commands
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @see src-tauri/src/swarm_commands.rs:470 swarm_create
 * Rust signature: `swarm_create(app, queue, mcp, goal: String) -> Result<Swarm, String>`.
 */
export function swarmCreate(goal: string): Promise<Swarm> {
  return invokeTyped<Swarm, { goal: string }>('swarm_create', { goal });
}

/**
 * @see src-tauri/src/swarm_commands.rs:541 swarm_list
 * Rust signature: `swarm_list(limit: Option<usize>) -> Vec<Swarm>`.
 */
export function swarmList(limit?: number): Promise<Swarm[]> {
  return invokeTyped<Swarm[], { limit?: number }>('swarm_list', { limit });
}

/**
 * @see src-tauri/src/swarm_commands.rs:546 swarm_get
 * Returns Option<Swarm>.
 */
export function swarmGet(swarmId: string): Promise<Swarm | null> {
  return invokeTyped<Swarm | null, { swarm_id: string }>('swarm_get', { swarm_id: swarmId });
}

/** @see src-tauri/src/swarm_commands.rs:551 swarm_pause */
export function swarmPause(swarmId: string): Promise<void> {
  return invokeTyped<void, { swarm_id: string }>('swarm_pause', { swarm_id: swarmId });
}

/** @see src-tauri/src/swarm_commands.rs:557 swarm_resume */
export function swarmResume(swarmId: string): Promise<void> {
  return invokeTyped<void, { swarm_id: string }>('swarm_resume', { swarm_id: swarmId });
}

/** @see src-tauri/src/swarm_commands.rs:574 swarm_cancel */
export function swarmCancel(swarmId: string): Promise<void> {
  return invokeTyped<void, { swarm_id: string }>('swarm_cancel', { swarm_id: swarmId });
}

/**
 * @see src-tauri/src/swarm_commands.rs:580 swarm_write_scratchpad
 * Rust signature: `swarm_write_scratchpad(swarm_id, key, value) -> Result<(), String>`.
 */
export function swarmWriteScratchpad(args: {
  swarmId: string;
  key: string;
  value: string;
}): Promise<void> {
  return invokeTyped<void, { swarm_id: string; key: string; value: string }>(
    'swarm_write_scratchpad',
    { swarm_id: args.swarmId, key: args.key, value: args.value },
  );
}

/**
 * @see src-tauri/src/swarm_commands.rs:589 swarm_write_scratchpad_entry
 * Rust signature: `swarm_write_scratchpad_entry(swarm_id, key, value, source_task) -> Result<(), String>`.
 * Note: Rust takes `source_task: String` (not an optional `appended_by`).
 */
export function swarmWriteScratchpadEntry(args: {
  swarmId: string;
  key: string;
  value: string;
  sourceTask: string;
}): Promise<void> {
  return invokeTyped<
    void,
    { swarm_id: string; key: string; value: string; source_task: string }
  >('swarm_write_scratchpad_entry', {
    swarm_id: args.swarmId,
    key: args.key,
    value: args.value,
    source_task: args.sourceTask,
  });
}

/**
 * @see src-tauri/src/swarm_commands.rs:609 swarm_read_scratchpad
 * Returns Option<String>.
 */
export function swarmReadScratchpad(args: {
  swarmId: string;
  key: string;
}): Promise<string | null> {
  return invokeTyped<string | null, { swarm_id: string; key: string }>(
    'swarm_read_scratchpad',
    { swarm_id: args.swarmId, key: args.key },
  );
}

/**
 * @see src-tauri/src/swarm_commands.rs:617 swarm_get_progress
 * Returns Option<SwarmProgress>.
 */
export function swarmGetProgress(swarmId: string): Promise<SwarmProgress | null> {
  return invokeTyped<SwarmProgress | null, { swarm_id: string }>('swarm_get_progress', {
    swarm_id: swarmId,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// agent_factory.rs — 5 commands
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @see src-tauri/src/agent_factory.rs:539 factory_create_agent
 * Rust signature: `factory_create_agent(description: String) -> Result<AgentBlueprint, String>`.
 * Note: the Rust API takes a single natural-language `description`; it synthesises the blueprint.
 */
export function factoryCreateAgent(description: string): Promise<AgentBlueprint> {
  return invokeTyped<AgentBlueprint, { description: string }>('factory_create_agent', {
    description,
  });
}

/**
 * @see src-tauri/src/agent_factory.rs:545 factory_deploy_agent
 * Rust signature: `factory_deploy_agent(blueprint: AgentBlueprint) -> Result<String, String>`.
 * Returns the deployed agent id (string).
 */
export function factoryDeployAgent(blueprint: AgentBlueprint): Promise<string> {
  return invokeTyped<string, { blueprint: AgentBlueprint }>('factory_deploy_agent', {
    blueprint,
  });
}

/** @see src-tauri/src/agent_factory.rs:551 factory_list_agents */
export function factoryListAgents(): Promise<AgentBlueprint[]> {
  return invokeTyped<AgentBlueprint[]>('factory_list_agents', {});
}

/**
 * @see src-tauri/src/agent_factory.rs:557 factory_pause_agent
 * Rust signature: `factory_pause_agent(agent_id: String) -> Result<(), String>`.
 */
export function factoryPauseAgent(agentId: string): Promise<void> {
  return invokeTyped<void, { agent_id: string }>('factory_pause_agent', { agent_id: agentId });
}

/**
 * @see src-tauri/src/agent_factory.rs:563 factory_delete_agent
 * Rust signature: `factory_delete_agent(agent_id: String) -> Result<(), String>`.
 */
export function factoryDeleteAgent(agentId: string): Promise<void> {
  return invokeTyped<void, { agent_id: string }>('factory_delete_agent', { agent_id: agentId });
}

// ═══════════════════════════════════════════════════════════════════════════
// managed_agents.rs — 1 command
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @see src-tauri/src/managed_agents.rs:23 run_managed_agent
 * Rust signature:
 *   run_managed_agent(app, run_id, prompt, tools, mcp_servers: Option<String>,
 *                     permission_mode, max_turns: u32, session_id: Option<String>,
 *                     working_directory: Option<String>, subagents: Option<String>)
 *     -> Result<String, String>
 */
export function runManagedAgent(args: {
  runId: string;
  prompt: string;
  tools: string[];
  permissionMode: string;
  maxTurns: number;
  mcpServers?: string;
  sessionId?: string;
  workingDirectory?: string;
  subagents?: string;
}): Promise<string> {
  return invokeTyped<
    string,
    {
      run_id: string;
      prompt: string;
      tools: string[];
      mcp_servers?: string;
      permission_mode: string;
      max_turns: number;
      session_id?: string;
      working_directory?: string;
      subagents?: string;
    }
  >('run_managed_agent', {
    run_id: args.runId,
    prompt: args.prompt,
    tools: args.tools,
    mcp_servers: args.mcpServers,
    permission_mode: args.permissionMode,
    max_turns: args.maxTurns,
    session_id: args.sessionId,
    working_directory: args.workingDirectory,
    subagents: args.subagents,
  });
}
