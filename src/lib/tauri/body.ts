// src/lib/tauri/body.ts
//
// Typed wrappers for the Body Visualization cluster — one per registered Rust
// #[tauri::command] across body_registry.rs, organ.rs, dna.rs, world_model.rs,
// cardiovascular.rs, urinary.rs, reproductive.rs, joints.rs (D-196 inventory —
// ~22 commands across 10 modules).
//
// D-193: per-cluster wrapper module lives HERE (body cluster only).
// D-194: homeostasis.ts (Phase 3) is NOT duplicated — re-exported below for
//        convenience so per-route files can reach it via either the body.ts
//        barrel or the canonical @/lib/tauri/homeostasis path.
// D-196: zero Rust expansion in Phase 8 — every command below is already
//        registered in src-tauri/src/lib.rs generate_handler!.
// D-206: @see Rust cite in JSDoc; invokeTyped only; ESLint no-raw-tauri.
// D-38:  camelCase JS API, snake_case at the invoke boundary.
//        Return types mirror Rust #[derive(Serialize)] shape verbatim.
//
// supervisor_get_health + integration_bridge wrappers are already in admin.ts
// (Phase 7 D-166). BodySystemDetail + HiveMesh cross-import those — same
// cross-cluster read pattern Phase 6 D-148 established.
//
// @see .planning/phases/08-body-hive/08-CONTEXT.md §D-193..D-210
// @see .planning/phases/08-body-hive/08-PATTERNS.md §1
// @see src-tauri/src/lib.rs:1284-1338 generate_handler!

import { invokeTyped } from './_base';

// Re-export homeostasis wrappers for convenience (D-194).
export * as homeostasis from './homeostasis';

// ═══════════════════════════════════════════════════════════════════════════
// Types — mirror Rust Serialize shape verbatim (snake_case preserved).
// Every interface carries [k: string]: unknown for forward-compat (D-207).
// ═══════════════════════════════════════════════════════════════════════════

// ─── body_registry.rs types ─────────────────────────────────────────────────

/** @see src-tauri/src/body_registry.rs:11 ModuleMapping */
export interface ModuleMapping {
  module: string;
  body_system: string;
  organ: string;
  description: string;
  [k: string]: unknown;
}

// ─── organ.rs types ──────────────────────────────────────────────────────────

/** @see src-tauri/src/organ.rs:21 OrganCapability */
export interface OrganCapability {
  action: string;
  description: string;
  mutating: boolean;
  autonomy_level: number; // 0-5
  [k: string]: unknown;
}

/** @see src-tauri/src/organ.rs:34 OrganStatus */
export interface OrganStatus {
  name: string;
  health: string; // 'active' | 'dormant' | 'error' | 'disconnected'
  summary: string;
  recent_observations: string[];
  capabilities: OrganCapability[];
  [k: string]: unknown;
}

// ─── world_model.rs types ────────────────────────────────────────────────────

/** @see src-tauri/src/world_model.rs:23 GitRepoState */
export interface GitRepoState {
  path: string;
  branch: string;
  uncommitted: number;
  untracked: number;
  ahead: number;
  last_commit: string;
  [k: string]: unknown;
}

/** @see src-tauri/src/world_model.rs:33 ProcessInfo */
export interface ProcessInfo {
  name: string;
  pid: number;
  interesting: boolean;
  [k: string]: unknown;
}

/** @see src-tauri/src/world_model.rs:40 PortInfo */
export interface PortInfo {
  port: number;
  process: string;
  protocol: string;
  [k: string]: unknown;
}

/** @see src-tauri/src/world_model.rs:47 FileChange */
export interface FileChange {
  path: string;
  changed_at: number;
  change_type: string; // 'created' | 'modified' | 'deleted'
  [k: string]: unknown;
}

/** @see src-tauri/src/world_model.rs:54 SystemLoad */
export interface SystemLoad {
  cpu_cores: number;
  memory_total_mb: number;
  memory_used_mb: number;
  disk_free_gb: number;
  [k: string]: unknown;
}

/** @see src-tauri/src/world_model.rs:62 TodoItem */
export interface TodoItem {
  file: string;
  line: number;
  text: string;
  [k: string]: unknown;
}

/** @see src-tauri/src/world_model.rs:9 WorldState */
export interface WorldState {
  timestamp: number;
  git_repos: GitRepoState[];
  running_processes: ProcessInfo[];
  open_ports: PortInfo[];
  recent_file_changes: FileChange[];
  system_load: SystemLoad;
  active_window: string;
  workspace_cwd: string;
  pending_todos: TodoItem[];
  network_activity: string;
  [k: string]: unknown;
}

// ─── cardiovascular.rs types ─────────────────────────────────────────────────

/** @see src-tauri/src/cardiovascular.rs:82 BloodPressure */
export interface BloodPressure {
  events_per_minute: number;
  api_calls_per_minute: number;
  errors_per_minute: number;
  total_events: number;
  total_api_calls: number;
  hottest_channels: Array<[string, number]>;
  [k: string]: unknown;
}

/** @see src-tauri/src/cardiovascular.rs:136 EventInfo */
export interface EventInfo {
  name: string;
  direction: string; // 'backend→frontend' | 'frontend→backend' | 'internal'
  category: string; // 'chat' | 'voice' | 'hive' | 'vision' | 'system' | 'agent'
  description: string;
  [k: string]: unknown;
}

/** @see src-tauri/src/cardiovascular.rs:241 VitalSigns */
export interface VitalSigns {
  hormones: unknown; // HormoneState — re-exported from @/types/hormones
  blood_pressure: BloodPressure;
  immune: ImmuneStatus;
  services_alive: number;
  services_dead: string[];
  brain_working_memory_active: boolean;
  [k: string]: unknown;
}

// ─── urinary.rs types ────────────────────────────────────────────────────────

/** @see src-tauri/src/urinary.rs:195 ImmuneStatus */
export interface ImmuneStatus {
  threats_last_hour: number;
  blocked_actions: number;
  status: string;
  [k: string]: unknown;
}

// ─── reproductive.rs types ───────────────────────────────────────────────────

/** @see src-tauri/src/reproductive.rs:28 InheritedDna */
export interface InheritedDna {
  identity: string;
  voice: string;
  trust_level: number;
  current_context: string;
  preferences: string[];
  active_project: string;
  [k: string]: unknown;
}

// ═══════════════════════════════════════════════════════════════════════════
// Wrappers — one per Rust #[tauri::command]. JSDoc cites file:line.
// Arg keys in invokeTyped payload MUST be snake_case (D-38).
// ═══════════════════════════════════════════════════════════════════════════

// ─── body_registry.rs (3 commands) ───────────────────────────────────────────

/**
 * @see src-tauri/src/body_registry.rs:239
 *   `pub fn body_get_map() -> Vec<ModuleMapping>`
 *
 * Complete anatomy chart — every module mapped to its body system + organ.
 * BodyMap renders from this; BodySystemDetail filters by system.
 */
export function bodyGetMap(): Promise<ModuleMapping[]> {
  return invokeTyped<ModuleMapping[]>('body_get_map');
}

/**
 * @see src-tauri/src/body_registry.rs:244
 *   `pub fn body_get_system(system: String) -> Vec<ModuleMapping>`
 *
 * Returns modules whose body_system matches. Used by BodySystemDetail.
 */
export function bodyGetSystem(args: { system: string }): Promise<ModuleMapping[]> {
  return invokeTyped<ModuleMapping[], { system: string }>('body_get_system', {
    system: args.system,
  });
}

/**
 * @see src-tauri/src/body_registry.rs:249
 *   `pub fn body_get_summary() -> Vec<(String, usize)>`
 *
 * Aggregated (body_system, module_count) tuples — one per known system.
 * BodyMap hero uses this for the "12 body systems, N modules" line + card grid.
 */
export function bodyGetSummary(): Promise<Array<[string, number]>> {
  return invokeTyped<Array<[string, number]>>('body_get_summary');
}

// ─── organ.rs (4 commands) ───────────────────────────────────────────────────

/**
 * @see src-tauri/src/organ.rs:361
 *   `pub fn organ_get_registry() -> Vec<OrganStatus>`
 *
 * Full organ registry — each row carries health + summary + capabilities[].
 */
export function organGetRegistry(): Promise<OrganStatus[]> {
  return invokeTyped<OrganStatus[]>('organ_get_registry');
}

/**
 * @see src-tauri/src/organ.rs:366
 *   `pub fn organ_get_roster() -> String`
 *
 * Brain-style identity roster (free-form multi-line text) for the system prompt.
 */
export function organGetRoster(): Promise<string> {
  return invokeTyped<string>('organ_get_roster');
}

/**
 * @see src-tauri/src/organ.rs:371
 *   `pub fn organ_set_autonomy(organ: String, action: String, level: u8) -> Result<(), String>`
 *
 * Writes per-organ-per-action autonomy level (0-5). Dialog-gate at call site
 * for level >= 4 (D-203).
 */
export function organSetAutonomy(args: {
  organ: string;
  action: string;
  level: number;
}): Promise<void> {
  return invokeTyped<void, { organ: string; action: string; level: number }>(
    'organ_set_autonomy',
    { organ: args.organ, action: args.action, level: args.level },
  );
}

/**
 * @see src-tauri/src/organ.rs:380
 *   `pub fn organ_get_autonomy(organ: String, action: String) -> u8`
 *
 * Reads the current autonomy level for a single organ + action pair.
 */
export function organGetAutonomy(args: {
  organ: string;
  action: string;
}): Promise<number> {
  return invokeTyped<number, { organ: string; action: string }>(
    'organ_get_autonomy',
    { organ: args.organ, action: args.action },
  );
}

// ─── dna.rs (4 commands) ─────────────────────────────────────────────────────

/**
 * @see src-tauri/src/dna.rs:495
 *   `pub fn dna_get_identity() -> String`
 *
 * Returns the identity.md-equivalent identity text for the user.
 */
export function dnaGetIdentity(): Promise<string> {
  return invokeTyped<string>('dna_get_identity');
}

/**
 * @see src-tauri/src/dna.rs dna_set_identity
 *   `pub fn dna_set_identity(content: String) -> Result<(), String>`
 *
 * Writes the user's identity text to persona.md under the blade config dir.
 * Uses write_blade_file (creates parent dir, 0o600 on Unix). Plan 09-01
 * closes Phase 8 D-203 deferral. DNA Identity tab "Save" button calls this.
 */
export function dnaSetIdentity(args: { content: string }): Promise<void> {
  return invokeTyped<void, { content: string }>('dna_set_identity', {
    content: args.content,
  });
}

/**
 * @see src-tauri/src/dna.rs:500
 *   `pub fn dna_get_goals() -> String`
 *
 * Returns goals text (short-term + long-term, inferred from memory + prefs).
 */
export function dnaGetGoals(): Promise<string> {
  return invokeTyped<string>('dna_get_goals');
}

/**
 * @see src-tauri/src/dna.rs:505
 *   `pub fn dna_get_patterns() -> String`
 *
 * Returns behavioral patterns text (routines, preferences, style).
 */
export function dnaGetPatterns(): Promise<string> {
  return invokeTyped<string>('dna_get_patterns');
}

/**
 * @see src-tauri/src/dna.rs:510
 *   `pub fn dna_query(query: String) -> String`
 *
 * Free-form natural-language lookup into the DNA corpus (identity + goals +
 * patterns + people + teams + companies). Used by the DNA route Query tab.
 */
export function dnaQuery(args: { query: string }): Promise<string> {
  return invokeTyped<string, { query: string }>('dna_query', { query: args.query });
}

// ─── world_model.rs (3 commands) ─────────────────────────────────────────────

/**
 * @see src-tauri/src/world_model.rs:1019
 *   `pub fn world_get_state() -> WorldState`
 *
 * Full world-model snapshot — git_repos, processes, ports, file changes,
 * system load, active window, workspace cwd, todos, network activity.
 */
export function worldGetState(): Promise<WorldState> {
  return invokeTyped<WorldState>('world_get_state');
}

/**
 * @see src-tauri/src/world_model.rs:1024
 *   `pub fn world_get_summary() -> String`
 *
 * Brain-style digest of the world state — suitable for the system prompt.
 */
export function worldGetSummary(): Promise<string> {
  return invokeTyped<string>('world_get_summary');
}

/**
 * @see src-tauri/src/world_model.rs:1029
 *   `pub fn world_refresh() -> WorldState`
 *
 * Forces a fresh snapshot (scans git, processes, ports, etc.) + returns the
 * new state. Also triggers a world_state_updated emit on the main window.
 */
export function worldRefresh(): Promise<WorldState> {
  return invokeTyped<WorldState>('world_refresh');
}

// ─── cardiovascular.rs (3 commands) — BodySystemDetail cardio drill-in ──────

/**
 * @see src-tauri/src/cardiovascular.rs:304
 *   `pub fn cardio_get_blood_pressure() -> BloodPressure`
 *
 * Data-flow health metrics — event/API/error rates over the last minute.
 */
export function cardioGetBloodPressure(): Promise<BloodPressure> {
  return invokeTyped<BloodPressure>('cardio_get_blood_pressure');
}

/**
 * @see src-tauri/src/cardiovascular.rs:309
 *   `pub fn cardio_get_event_registry() -> Vec<EventInfo>`
 *
 * Central registry of every known event (arteries + veins) — for the
 * BodySystemDetail Events tab.
 */
export function cardioGetEventRegistry(): Promise<EventInfo[]> {
  return invokeTyped<EventInfo[]>('cardio_get_event_registry');
}

/**
 * @see src-tauri/src/cardiovascular.rs:315
 *   `pub fn blade_vital_signs() -> VitalSigns`
 *
 * Composite vital-signs reading — hormones + blood pressure + immune +
 * services liveness + brain working-memory state. Used by BodySystemDetail
 * cardiovascular drill-in.
 */
export function bladeVitalSigns(): Promise<VitalSigns> {
  return invokeTyped<VitalSigns>('blade_vital_signs');
}

// ─── urinary.rs (2 commands) — BodySystemDetail urinary drill-in ────────────

/**
 * @see src-tauri/src/urinary.rs:204
 *   `pub fn urinary_flush() -> u64`
 *
 * Flushes expired cache / stale state. Returns the number of bytes reclaimed.
 * Dialog-gate at call site (D-205 destructive-op discipline).
 */
export function urinaryFlush(): Promise<number> {
  return invokeTyped<number>('urinary_flush');
}

/**
 * @see src-tauri/src/urinary.rs:209
 *   `pub fn immune_get_status() -> ImmuneStatus`
 *
 * Immune-system status — threats_last_hour + blocked_actions + status string.
 */
export function immuneGetStatus(): Promise<ImmuneStatus> {
  return invokeTyped<ImmuneStatus>('immune_get_status');
}

// ─── reproductive.rs (2 commands) — BodySystemDetail reproductive drill-in ──

/**
 * @see src-tauri/src/reproductive.rs:217
 *   `pub fn reproductive_get_dna() -> InheritedDna`
 *
 * Returns the DNA package a spawned agent would inherit — identity + voice +
 * trust_level + current_context + preferences + active_project.
 */
export function reproductiveGetDna(): Promise<InheritedDna> {
  return invokeTyped<InheritedDna>('reproductive_get_dna');
}

/**
 * @see src-tauri/src/reproductive.rs:222
 *   `pub async fn reproductive_spawn(agent_type: String, task: String, working_dir: Option<String>) -> Result<String, String>`
 *
 * Spawns a child agent carrying the inherited DNA. Dialog-gate at call site
 * (D-205 destructive-op discipline — this forks a new process).
 */
export function reproductiveSpawn(args: {
  agentType: string;
  task: string;
  workingDir?: string;
}): Promise<string> {
  return invokeTyped<
    string,
    { agent_type: string; task: string; working_dir?: string }
  >('reproductive_spawn', {
    agent_type: args.agentType,
    task: args.task,
    working_dir: args.workingDir,
  });
}

// ─── joints.rs (2 commands) — BodySystemDetail skeleton drill-in ────────────

/**
 * @see src-tauri/src/joints.rs:285
 *   `pub fn joints_list_providers() -> Vec<String>`
 *
 * Lists all registered context providers (the connective tissue between
 * organs and memory stores).
 */
export function jointsListProviders(): Promise<string[]> {
  return invokeTyped<string[]>('joints_list_providers');
}

/**
 * @see src-tauri/src/joints.rs:294
 *   `pub fn joints_list_stores() -> Vec<String>`
 *
 * Lists all registered memory stores (knowledge graph, embeddings, typed
 * memory, etc.).
 */
export function jointsListStores(): Promise<string[]> {
  return invokeTyped<string[]>('joints_list_stores');
}
